"""WebSocket endpoint: per-serial channel (ws://127.0.0.1:8375/ws?serial=...&proto=msgpack).

Wire format is negotiated per connection via ?proto=:
- default (or proto=json): JSON text frames (unchanged behavior).
- proto=msgpack: binary msgpack frames (server -> client via send_bytes); the
  client may also send JSON/text frames, e.g. {"type":"ping"}.
"""
from __future__ import annotations

import json
import threading

import msgpack
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .protocol import OutputBuffer, is_valid_serial
from .snapshot import maybe_snapshot
from .state import get_state

router = APIRouter()

PROTO_MSGPACK = "msgpack"


def _pack_msg(message: dict) -> bytes:
    """msgpack-encode a server->client frame.

    use_bin_type=False packs strings as the old raw type so they decode back as
    str (the payload dicts are JSON-shaped today).
    """
    return msgpack.packb(message, use_bin_type=False)


class ConnectionManager:
    def __init__(self) -> None:
        self._conns: dict[str, set[WebSocket]] = {}
        self._protos: dict[WebSocket, str] = {}
        self._lock = threading.Lock()

    async def connect(self, serial: str, ws: WebSocket, proto: str = "json") -> None:
        await ws.accept()
        with self._lock:
            self._conns.setdefault(serial, set()).add(ws)
            self._protos[ws] = proto

    async def disconnect(self, serial: str, ws: WebSocket) -> None:
        with self._lock:
            conns = self._conns.get(serial)
            if conns:
                conns.discard(ws)
                if not conns:
                    self._conns.pop(serial, None)
            self._protos.pop(ws, None)

    async def send(self, ws: WebSocket, message: dict) -> None:
        """Send one server->client message in this connection's wire format."""
        if self._protos.get(ws) == PROTO_MSGPACK:
            await ws.send_bytes(_pack_msg(message))
        else:
            await ws.send_json(message)

    async def receive(self, ws: WebSocket) -> dict:
        """Receive one client message in this connection's wire format.

        msgpack connections accept both binary msgpack frames and JSON/text
        frames (the web sends at most a text {"type":"ping"}); default
        connections keep the receive_json behavior unchanged.
        """
        if self._protos.get(ws) != PROTO_MSGPACK:
            return await ws.receive_json()
        raw = await ws.receive()
        if raw["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(code=raw.get("code", 1000))
        data = raw.get("bytes")
        if data is not None:
            # default raw=False: msgpack str/raw decodes back to str
            return msgpack.unpackb(data)
        text = raw.get("text")
        if text is None:
            raise ValueError(f"unexpected ws frame: {raw!r}")
        return json.loads(text)

    async def broadcast(self, serial: str, message: dict) -> None:
        with self._lock:
            targets = list(self._conns.get(serial, ()))
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await self.send(ws, message)
            except Exception:
                dead.append(ws)
        if dead:
            with self._lock:
                conns = self._conns.get(serial)
                if conns:
                    for ws in dead:
                        conns.discard(ws)
                for ws in dead:
                    self._protos.pop(ws, None)


manager = ConnectionManager()


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    serial = websocket.query_params.get("serial", "")
    if not is_valid_serial(serial):
        await websocket.close(code=1008, reason="invalid serial")
        return
    proto = websocket.query_params.get("proto", "json")
    if proto not in ("json", PROTO_MSGPACK):
        proto = "json"
    await manager.connect(serial, websocket, proto)
    st = get_state()
    st.logs.info("ws", f"client connected (proto={proto})", serial)
    ws_summary = st.workspaces.status(serial)
    await manager.send(
        websocket,
        {
            "type": "hello",
            "serial": serial,
            "inputRev": ws_summary["inputRev"],
            "outputRev": ws_summary["outputRev"],
        },
    )
    # replay current state so late-joining tabs see existing inputs/outputs
    ws_cur = st.workspaces.get(serial)
    if ws_cur is not None:
        if ws_cur.inputs:
            await manager.send(
                websocket,
                {"type": "inputs", "inputs": [i.model_dump() for i in ws_cur.inputs], "rev": ws_cur.input_rev, "frame": ws_cur.frame},
            )
        outs = ws_cur.get_outputs_since(0)
        if outs:
            await manager.send(
                websocket,
                {"type": "outputs", "outputs": [o.model_dump() for o in outs], "rev": ws_cur.output_rev()},
            )
    try:
        while True:
            msg = await manager.receive(websocket)
            mtype = msg.get("type")
            if mtype == "ping":
                await manager.send(websocket, {"type": "pong"})
            elif mtype == "edit":
                raw = msg.get("outputs")
                if isinstance(raw, list):
                    parsed = [OutputBuffer.model_validate(o) for o in raw]
                    rev, accepted = st.workspaces.get_or_create(serial).put_outputs(parsed)
                    if accepted:
                        # log only real content changes - no-op echoes would flood the log ring
                        st.logs.info("ws", f"edit pushed ({len(parsed)}, accepted {len(accepted)}), rev={rev}", serial)
                        # trace（P3）：WS 编辑埋点（零行为影响）
                        st.trace.add(
                            actor="web-gizmo",
                            action="outputs-edit",
                            channel=serial,
                            target=f"out[{','.join(str(o.index) for o in accepted)}]",
                            digest=f"rev={rev}, {len(accepted)} outputs",
                        )
                        if st.get_sync_enabled(serial):
                            st.stage_broadcast(serial, accepted, rev)
                            st.notify_stream(serial)
                        # the WS edit branch is the web's primary edit channel - it MUST
                        # snapshot too, otherwise io/outputs.json stays empty and a bridge
                        # restart loses every edit
                        await maybe_snapshot(serial)
    except WebSocketDisconnect:
        st.logs.info("ws", "client disconnected", serial)
        await manager.disconnect(serial, websocket)
    except Exception as exc:  # noqa: BLE001 - keep channel alive on protocol errors
        st.logs.error("ws", f"ws error: {exc}", serial)
        await manager.disconnect(serial, websocket)
