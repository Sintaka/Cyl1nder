"""Tests for the fxhoudinimcp integration layer: HTTP RPC client + REST proxy.

A local http.server stub stands in for the fxhoudinimcp process; the unit tests
exercise the wire client against it, and the route tests mount only the
houdini_routes router (never main.py's app) on a bare FastAPI instance.
"""
from __future__ import annotations

import http.server
import json
import socket
import threading
import urllib.parse
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bridge import houdini_mcp
from bridge.houdini_routes import router as houdini_router
from bridge.protocol import generate_serial
from bridge.state import get_state, reset_state


# --- fxhoudinimcp stub ------------------------------------------------------


class _StubHandler(http.server.BaseHTTPRequestHandler):
    server: "_HoudiniMcpStub"

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length)
        form = urllib.parse.parse_qs(raw.decode("utf-8", "replace"), keep_blank_values=True)
        json_str = form.get("json", [""])[0]
        try:
            payload = json.loads(json_str)
        except ValueError:
            payload = []
        self.server.log.append(payload)
        response = self.server.dispatch(payload)
        body = json.dumps(response).encode("utf-8")
        if self.server.bom:
            body = b"\xef\xbb\xbf" + body
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - http.server signature
        return


class _HoudiniMcpStub(http.server.ThreadingHTTPServer):
    def __init__(self, hip_file: str = "D:/project/test.hip") -> None:
        super().__init__(("127.0.0.1", 0), _StubHandler)
        self.hip_file = hip_file
        self.frame = 12.0
        self.fps = 24.0
        self.bom = False
        self.fail_set_frame = False
        self.log: list[list] = []
        self._thread = threading.Thread(target=self.serve_forever, daemon=True)

    @property
    def port(self) -> int:
        return int(self.server_address[1])

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self.shutdown()
        self.server_close()
        self._thread.join(timeout=2)

    def dispatch(self, payload: list) -> dict:
        cmd = payload[0] if isinstance(payload, list) and payload else ""
        if cmd == "mcp.health":
            return {"status": "ok", "houdini_version": "22.0.368", "hip_file": self.hip_file, "pid": 12345}
        if cmd == "mcp.execute":
            kwargs = payload[2] if len(payload) > 2 and isinstance(payload[2], dict) else {}
            command = kwargs.get("command", "")
            params = kwargs.get("params") or {}
            rid = kwargs.get("request_id", "")
            return self._execute(command, params, rid)
        return {"status": "error", "error": {"code": "unknown", "message": f"unknown command {cmd!r}"}}

    def _execute(self, command: str, params: dict, rid: str) -> dict:
        if command == "animation.set_frame":
            if self.fail_set_frame:
                return {"status": "error", "error": {"code": 1, "message": "boom"}, "request_id": rid}
            self.frame = float(params.get("frame", 0.0))
            return {"status": "success", "data": {"frame": self.frame, "status": "ok"}, "request_id": rid}
        if command == "animation.get_frame":
            return {"status": "success", "data": {"frame": self.frame, "fps": self.fps}, "request_id": rid}
        if command == "code.execute_python":
            return {
                "status": "success",
                "data": {"executed": True, "return_value": f"ran:{params.get('code', '')}", "request_id": rid},
            }
        if command == "error.cmd":
            return {"status": "error", "error": {"code": 1, "message": "boom"}, "request_id": rid}
        return {"status": "error", "error": {"code": 404, "message": f"no such command {command}"}, "request_id": rid}


@pytest.fixture
def stub() -> _HoudiniMcpStub:
    s = _HoudiniMcpStub()
    s.start()
    yield s
    s.stop()


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])
    finally:
        s.close()


# --- unit tests: houdini_mcp client -----------------------------------------


def test_rpc_success_shape(stub: _HoudiniMcpStub) -> None:
    data = houdini_mcp.rpc(stub.port, "animation.get_frame")
    assert data["status"] == "success"
    assert data["data"]["fps"] == 24.0


def test_rpc_error_shape_passthrough(stub: _HoudiniMcpStub) -> None:
    data = houdini_mcp.rpc(stub.port, "error.cmd")
    assert data["status"] == "error"
    assert data["error"]["message"] == "boom"


def test_rpc_network_error_raises() -> None:
    with pytest.raises(houdini_mcp.HoudiniMcpError):
        houdini_mcp.rpc(_free_port(), "animation.get_frame", timeout=0.2)


def test_rpc_tolerates_bom(stub: _HoudiniMcpStub) -> None:
    stub.bom = True
    data = houdini_mcp.rpc(stub.port, "animation.get_frame")
    assert data["status"] == "success"


def test_decode_bytes_bom_and_latin1_fallback() -> None:
    from bridge.houdini_mcp import _decode_bytes

    assert _decode_bytes(b"\xef\xbb\xbf{}") == "{}"
    # 0xff is not valid UTF-8: falls back to latin-1 without raising
    assert _decode_bytes(b'{"x": "\xff"}') == '{"x": "\xff"}'


def test_health(stub: _HoudiniMcpStub) -> None:
    h = houdini_mcp.health(stub.port)
    assert h is not None
    assert h["status"] == "ok"
    assert h["hip_file"] == stub.hip_file
    assert h["pid"] == 12345


def test_health_unreachable_is_none() -> None:
    assert houdini_mcp.health(_free_port(), timeout=0.2) is None


def test_discover_first(stub: _HoudiniMcpStub) -> None:
    assert houdini_mcp.discover_first(start=stub.port, end=stub.port) == stub.port


def test_discover_first_none() -> None:
    port = _free_port()
    assert houdini_mcp.discover_first(start=port, end=port, timeout=0.2) is None


def test_discover_by_hip_match(stub: _HoudiniMcpStub) -> None:
    assert houdini_mcp.discover_by_hip(stub.hip_file, start=stub.port, end=stub.port) == stub.port


def test_discover_by_hip_normalizes_case_slashes_quotes(stub: _HoudiniMcpStub) -> None:
    # case-insensitive
    assert houdini_mcp.discover_by_hip("d:/PROJECT/test.hip", start=stub.port, end=stub.port) == stub.port
    # backslash -> forward slash
    assert houdini_mcp.discover_by_hip("D:\\project\\test.hip", start=stub.port, end=stub.port) == stub.port
    # surrounding quotes stripped
    assert houdini_mcp.discover_by_hip('"D:/project/test.hip"', start=stub.port, end=stub.port) == stub.port


def test_discover_by_hip_mismatch_none(stub: _HoudiniMcpStub) -> None:
    assert houdini_mcp.discover_by_hip("D:/other/scene.hip", start=stub.port, end=stub.port, timeout=0.2) is None


def test_discover_by_hip_empty_degrades(stub: _HoudiniMcpStub) -> None:
    assert houdini_mcp.discover_by_hip("", start=stub.port, end=stub.port) == stub.port


def test_set_frame_and_get_frame(stub: _HoudiniMcpStub) -> None:
    res = houdini_mcp.set_frame(stub.port, 42.0)
    assert res["frame"] == 42.0
    assert stub.frame == 42.0
    got = houdini_mcp.get_frame(stub.port)
    assert got["frame"] == 42.0 and got["fps"] == 24.0


def test_set_frame_mcp_error_raises(stub: _HoudiniMcpStub) -> None:
    stub.fail_set_frame = True
    with pytest.raises(houdini_mcp.HoudiniMcpError):
        houdini_mcp.set_frame(stub.port, 1.0)


def test_execute_python(stub: _HoudiniMcpStub) -> None:
    res = houdini_mcp.execute_python(stub.port, "x = 1", "x")
    assert res["executed"] is True
    assert res["return_value"] == "ran:x = 1"


def test_is_command_allowed() -> None:
    assert houdini_mcp.is_command_allowed("animation.set_frame")
    assert houdini_mcp.is_command_allowed("code.execute_python")
    assert houdini_mcp.is_command_allowed("mcp.list_commands")
    assert houdini_mcp.is_command_allowed("nodes.create")
    assert houdini_mcp.is_command_allowed("dops.get_dop_object")
    assert not houdini_mcp.is_command_allowed("evil.delete_all")
    assert not houdini_mcp.is_command_allowed("animation")  # no namespace dot
    assert not houdini_mcp.is_command_allowed("")
    assert not houdini_mcp.is_command_allowed("Animation.set_frame")  # case-sensitive
    assert not houdini_mcp.is_command_allowed(123)  # type: ignore[arg-type]


# --- route tests ------------------------------------------------------------


def _client(tmp_path: Path) -> TestClient:
    reset_state(tmp_path / "data")
    import bridge.houdini_routes as hr

    with hr._LOCK:
        hr._TL.clear()
        hr._LAST_SET.clear()
        hr._LAST_WRITEBACK.clear()
    app = FastAPI()
    app.include_router(houdini_router)
    return TestClient(app)


def test_get_houdini_no_port(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial, hip="D:/x.hip")
    r = c.get(f"/api/hda/{serial}/houdini")
    assert r.status_code == 200
    assert r.json() == {"serial": serial, "mcpPort": 0, "alive": False, "health": None}


def test_get_houdini_alive(tmp_path: Path, stub: _HoudiniMcpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial, hip="D:/x.hip")
    get_state().registry.set_houdini_mcp(serial, stub.port)
    body = c.get(f"/api/hda/{serial}/houdini").json()
    assert body["mcpPort"] == stub.port
    assert body["alive"] is True
    assert body["health"]["hip_file"] == stub.hip_file


def test_put_houdini_matched(tmp_path: Path, stub: _HoudiniMcpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial, hip=stub.hip_file)
    r = c.put(f"/api/hda/{serial}/houdini", json={"mcp_port": stub.port})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["mcpPort"] == stub.port
    assert body["alive"] is True
    assert body["matched"] is True
    assert get_state().registry.get(serial).mcpPort == stub.port


def test_put_houdini_mismatch(tmp_path: Path, stub: _HoudiniMcpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial, hip="D:/other.hip")
    body = c.put(f"/api/hda/{serial}/houdini", json={"mcp_port": stub.port}).json()
    assert body["alive"] is True
    assert body["matched"] is False


def test_put_houdini_invalid_port(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial)
    assert c.put(f"/api/hda/{serial}/houdini", json={"mcp_port": 0}).status_code == 422
    assert c.put(f"/api/hda/{serial}/houdini", json={"mcp_port": 70000}).status_code == 422
    assert get_state().registry.get(serial).mcpPort == 0


def test_put_timeline_sets_frame(tmp_path: Path, stub: _HoudiniMcpStub) -> None:
    import bridge.houdini_routes as hr

    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial, hip=stub.hip_file)
    get_state().registry.set_houdini_mcp(serial, stub.port)
    r = c.put(f"/api/hda/{serial}/timeline", json={"frame": 42.0})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["frame"] == 42.0
    assert body["mcp_port"] == stub.port
    assert stub.frame == 42.0
    assert hr._TL[serial]["frame"] == 42.0
    assert hr._TL[serial]["source"] == "web"


def test_put_timeline_no_port(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(houdini_mcp, "discover_by_hip", lambda *a, **k: None)
    monkeypatch.setattr(houdini_mcp, "discover_first", lambda *a, **k: None)
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial, hip="")
    body = c.put(f"/api/hda/{serial}/timeline", json={"frame": 1.0}).json()
    assert body["ok"] is False
    assert body["error"] == "houdini mcp not reachable"


def test_get_timeline_fetches_from_mcp(tmp_path: Path, stub: _HoudiniMcpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial, hip=stub.hip_file)
    get_state().registry.set_houdini_mcp(serial, stub.port)
    body = c.get(f"/api/hda/{serial}/timeline").json()
    assert body["frame"] == 12.0
    assert body["fps"] == 24.0
    assert body["source"] == "hou"
    assert body["mcpPort"] == stub.port


def test_put_hou_timeline(tmp_path: Path) -> None:
    import bridge.houdini_routes as hr

    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial)
    r = c.put(f"/api/hda/{serial}/hou-timeline", json={"frame": 30.0, "fps": 25.0})
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert hr._TL[serial]["frame"] == 30.0
    assert hr._TL[serial]["fps"] == 25.0
    assert hr._TL[serial]["source"] == "hou"


def test_put_hou_timeline_broadcasts(tmp_path: Path, monkeypatch) -> None:
    import bridge.houdini_routes as hr

    class FakeManager:
        def __init__(self) -> None:
            self.msgs: list[tuple[str, dict]] = []

        async def broadcast(self, serial: str, message: dict) -> None:
            self.msgs.append((serial, message))

    fake = FakeManager()
    monkeypatch.setattr(hr, "manager", fake)
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial)
    r = c.put(f"/api/hda/{serial}/hou-timeline", json={"frame": 5.0})
    assert r.json() == {"ok": True}
    assert len(fake.msgs) == 1
    s, msg = fake.msgs[0]
    assert s == serial
    assert msg["type"] == "timeline"
    assert msg["frame"] == 5.0
    assert msg["source"] == "hou"


def test_cmd_proxy(tmp_path: Path, stub: _HoudiniMcpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial, hip=stub.hip_file)
    get_state().registry.set_houdini_mcp(serial, stub.port)
    r = c.post(f"/api/hda/{serial}/houdini/cmd", json={"command": "animation.get_frame"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["command"] == "animation.get_frame"
    assert body["result"]["status"] == "success"
    assert body["result"]["data"]["fps"] == 24.0


def test_cmd_proxy_mcp_error_is_result_not_failure(tmp_path: Path, stub: _HoudiniMcpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial, hip=stub.hip_file)
    get_state().registry.set_houdini_mcp(serial, stub.port)
    body = c.post(f"/api/hda/{serial}/houdini/cmd", json={"command": "animation.bogus"}).json()
    assert body["ok"] is True
    assert body["result"]["status"] == "error"


def test_cmd_proxy_forbidden(tmp_path: Path, stub: _HoudiniMcpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial)
    assert c.post(f"/api/hda/{serial}/houdini/cmd", json={"command": "evil.delete_all"}).status_code == 403


def test_python_proxy(tmp_path: Path, stub: _HoudiniMcpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial, hip=stub.hip_file)
    get_state().registry.set_houdini_mcp(serial, stub.port)
    body = c.post(
        f"/api/hda/{serial}/houdini/python",
        json={"code": "x = 1", "return_expression": "x"},
    ).json()
    assert body["ok"] is True
    assert body["result"]["executed"] is True


def test_python_proxy_empty_code(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial)
    assert c.post(f"/api/hda/{serial}/houdini/python", json={"code": ""}).status_code == 422


def test_timeline_non_finite_frame_422(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial)
    assert c.put(f"/api/hda/{serial}/timeline", json={}).status_code == 422
    assert c.put(f"/api/hda/{serial}/timeline", json={"frame": "abc"}).status_code == 422
    # 1e400 overflows to inf on JSON parse; the finite check must reject it
    assert (
        c.put(
            f"/api/hda/{serial}/timeline",
            content=b'{"frame": 1e400}',
            headers={"Content-Type": "application/json"},
        ).status_code
        == 422
    )


def test_hou_timeline_invalid_422(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial)
    assert c.put(f"/api/hda/{serial}/hou-timeline", json={"frame": "x"}).status_code == 422
    assert c.put(f"/api/hda/{serial}/hou-timeline", json={"frame": 1.0, "fps": "x"}).status_code == 422


def test_invalid_serial_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    assert c.get("/api/hda/zzz/houdini").status_code == 400
    assert c.get("/api/hda/zzz/timeline").status_code == 400
    assert c.put("/api/hda/zzz/timeline", json={"frame": 1.0}).status_code == 400
    assert c.put("/api/hda/zzz/hou-timeline", json={"frame": 1.0}).status_code == 400
    assert c.put("/api/hda/zzz/houdini", json={"mcp_port": 8100}).status_code == 400
    assert c.post("/api/hda/zzz/houdini/cmd", json={"command": "animation.get_frame"}).status_code == 400
    assert c.post("/api/hda/zzz/houdini/python", json={"code": "x"}).status_code == 400
