"""WebSocket endpoint: per-serial channel (ws://127.0.0.1:8375/ws?serial=...)."""
from __future__ import annotations

import threading

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .protocol import OutputBuffer, is_valid_serial
from .state import get_state

router = APIRouter()


class ConnectionManager:
    def __init__(self) -> None:
        self._conns: dict[str, set[WebSocket]] = {}
        self._lock = threading.Lock()

    async def connect(self, serial: str, ws: WebSocket) -> None:
        await ws.accept()
        with self._lock:
            self._conns.setdefault(serial, set()).add(ws)

    async def disconnect(self, serial: str, ws: WebSocket) -> None:
        with self._lock:
            conns = self._conns.get(serial)
            if conns:
                conns.discard(ws)
                if not conns:
                    self._conns.pop(serial, None)

    async def broadcast(self, serial: str, message: dict) -> None:
        with self._lock:
            targets = list(self._conns.get(serial, ()))
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        if dead:
            with self._lock:
                conns = self._conns.get(serial)
                if conns:
                    for ws in dead:
                        conns.discard(ws)


manager = ConnectionManager()


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    serial = websocket.query_params.get("serial", "")
    if not is_valid_serial(serial):
        await websocket.close(code=1008, reason="invalid serial")
        return
    await manager.connect(serial, websocket)
    st = get_state()
    ws_summary = st.workspaces.status(serial)
    await websocket.send_json(
        {
            "type": "hello",
            "serial": serial,
            "inputRev": ws_summary["inputRev"],
            "outputRev": ws_summary["outputRev"],
        }
    )
    # replay current state so late-joining tabs see existing inputs/outputs
    ws_cur = st.workspaces.get(serial)
    if ws_cur is not None:
        if ws_cur.inputs:
            await websocket.send_json(
                {"type": "inputs", "inputs": [i.model_dump() for i in ws_cur.inputs], "rev": ws_cur.input_rev}
            )
        outs = ws_cur.get_outputs_since(0)
        if outs:
            await websocket.send_json(
                {"type": "outputs", "outputs": [o.model_dump() for o in outs], "rev": ws_cur.output_rev()}
            )
    try:
        while True:
            msg = await websocket.receive_json()
            mtype = msg.get("type")
            if mtype == "ping":
                await websocket.send_json({"type": "pong"})
            elif mtype == "edit":
                raw = msg.get("outputs")
                if isinstance(raw, list):
                    parsed = [OutputBuffer.model_validate(o) for o in raw]
                    rev = st.workspaces.get_or_create(serial).put_outputs(parsed)
                    st.logs.info("ws", f"edit pushed ({len(parsed)}), rev={rev}", serial)
                    await manager.broadcast(
                        serial,
                        {"type": "outputs", "outputs": [o.model_dump() for o in parsed], "rev": rev},
                    )
    except WebSocketDisconnect:
        await manager.disconnect(serial, websocket)
    except Exception as exc:  # noqa: BLE001 - keep channel alive on protocol errors
        st.logs.error("ws", f"ws error: {exc}", serial)
        await manager.disconnect(serial, websocket)
