"""data 通道值端点 + apex-anim 适配器测试（见 devlog/tag-hda-plan.md P4）。

照 test_channels.py 模板：裸 FastAPI 挂 channel_router + 本地 http.server stub 仿
code.execute_python（read 回 data={"geometry":"abc"}、write 回 True）；stub 记录
收到的 code 文本供断言 setFromData 字样。data 通道由 st.channels 直接注册。
"""
from __future__ import annotations

import http.server
import json
import threading
import urllib.parse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bridge import houdini_mcp
from bridge.channel_routes import router as channel_router
from bridge.protocol import generate_serial
from bridge.state import get_state, reset_state


class _StubHandler(http.server.BaseHTTPRequestHandler):
    server: "_McpStub"

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
        body = json.dumps(self.server.dispatch(payload)).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - http.server signature
        return


class _McpStub(http.server.ThreadingHTTPServer):
    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _StubHandler)
        self.codes: list[str] = []
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
        if cmd == "mcp.execute":
            kwargs = payload[2] if len(payload) > 2 and isinstance(payload[2], dict) else {}
            command = kwargs.get("command", "")
            params = kwargs.get("params") or {}
            rid = kwargs.get("request_id", "")
            if command == "code.execute_python":
                self.codes.append(str(params.get("code", "")))
                expr = str(params.get("return_expression", ""))
                value = {"geometry": "abc"} if "asData" in expr else True
                # 实机信封：mcp.execute 外层 {status,data}，内层 code.execute_python {success,executed,return_value}
                return {
                    "status": "success",
                    "data": {"success": True, "executed": True, "return_value": value},
                    "request_id": rid,
                }
            return {"status": "error", "error": {"code": 404, "message": f"no such command {command}"}, "request_id": rid}
        return {"status": "error", "error": {"code": "unknown", "message": f"unknown command {cmd!r}"}}


@pytest.fixture
def stub() -> _McpStub:
    s = _McpStub()
    s.start()
    yield s
    s.stop()


def _client(tmp_path) -> TestClient:
    reset_state(tmp_path / "data")
    app = FastAPI()
    app.include_router(channel_router)
    return TestClient(app)


# data 通道记录：absolutePath = <node_path>/<parm_name>（P4v1 契约），
# 注册表按 serial 键控（channels.py 迁移期），value 端点按 absolutePath 定位（含兜底扫）。
DATA_REF = {
    "kind": "data",
    "nodePath": "/obj/x/tag",
    "absolutePath": "/obj/geo1/sceneanimate1/animation",
    "adapter": "apex-anim",
    "hip": "",
    "label": "",
}

VALUE_URL = "/api/channels/obj/geo1/sceneanimate1/animation/value"


def _register_data(serial: str, **overrides) -> None:
    get_state().channels.register({**DATA_REF, "serial": serial, **overrides})


def _stub_port(serial: str, stub: _McpStub) -> None:
    st = get_state()
    st.registry.register(serial, hip="D:/x.hip")
    st.registry.set_houdini_mcp(serial, stub.port)


def test_get_value_ok(tmp_path, stub: _McpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    _stub_port(serial, stub)
    _register_data(serial)
    r = c.get(VALUE_URL)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["value"] == {"geometry": "abc"}  # stub 回 data 透传
    events = get_state().trace.list(actor="web-param")
    assert any(e["action"] == "data-get" and e["target"] == "/obj/geo1/sceneanimate1/animation" for e in events)


def test_put_value_ok(tmp_path, stub: _McpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    _stub_port(serial, stub)
    _register_data(serial)
    value = {"geometry": "abc"}
    r = c.put(VALUE_URL, json={"value": value})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["value"] == value  # 原样回显
    code = stub.codes[-1]
    assert code.startswith("import hou, json;")
    assert "setFromData" in code
    assert "json.loads" in code
    assert "geometry" in code and "abc" in code  # value json 已嵌入代码
    events = get_state().trace.list(actor="web-param")
    matched = [e for e in events if e["action"] == "data-set"]
    assert matched and matched[0]["target"] == "/obj/geo1/sceneanimate1/animation"
    assert matched[0]["actor"] == "web-param"


def test_get_value_404(tmp_path) -> None:
    c = _client(tmp_path)
    assert c.get("/api/channels/nonexistent/value").status_code == 404


def test_get_value_not_data_channel_400(tmp_path) -> None:
    c = _client(tmp_path)
    get_state().channels.register(
        {"kind": "param", "serial": generate_serial(), "nodePath": "/obj/geo1/tag1", "absolutePath": "/obj/geo1/transform1/tx", "hip": "", "label": ""}
    )
    r = c.get("/api/channels/obj/geo1/transform1/tx/value")
    assert r.status_code == 400
    assert r.json()["detail"] == "not a data channel"


def test_get_value_unknown_adapter_400(tmp_path) -> None:
    c = _client(tmp_path)
    _register_data(generate_serial(), adapter="bogus")
    r = c.get(VALUE_URL)
    assert r.status_code == 400
    assert r.json()["detail"] == "unknown adapter"


def test_get_value_no_port(tmp_path, monkeypatch) -> None:
    """无端口：HTTP 200 + {"ok": False, "error": ...}（照 test_channels.py test_probe_no_port）。"""
    monkeypatch.setattr(houdini_mcp, "discover_by_hip", lambda *a, **k: None)
    monkeypatch.setattr(houdini_mcp, "discover_first", lambda *a, **k: None)
    c = _client(tmp_path)
    _register_data(generate_serial())
    r = c.get(VALUE_URL)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["error"] == "houdini mcp not reachable"


def test_register_data_channel_via_http(tmp_path) -> None:
    """data 通道经 PUT /api/channels 注册：channelId 走 absolutePath 去前导 "/"（同 param）。"""
    c = _client(tmp_path)
    serial = generate_serial()
    r = c.put("/api/channels/obj/geo1/sceneanimate1/animation", json={**DATA_REF, "serial": serial})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["channelId"] == "/obj/geo1/sceneanimate1/animation"
    assert any(ch["kind"] == "data" for ch in c.get("/api/channels").json()["channels"])
