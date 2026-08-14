"""吊牌 HDA 通道注册表 + 路由测试（见 devlog/tag-hda-plan.md P1）。

ChannelRegistry 单测照 test_registry.py 纯单元风格；路由测试照
test_houdini_mcp.py 的裸 FastAPI 做法（create_app 尚未挂载 channel_routes，
main.py 由主进程粘合），用本地 http.server stub 仿 nodes.get_node_info。
"""
from __future__ import annotations

import http.server
import json
import threading
import time
import urllib.parse
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bridge import houdini_mcp
from bridge.channel_routes import router as channel_router
from bridge.channels import ChannelRegistry
from bridge.protocol import generate_serial
from bridge.state import get_state, reset_state


# --- ChannelRegistry 单元测试 ------------------------------------------------


def test_register_upsert_preserves_registered_at(tmp_path: Path) -> None:
    reg = ChannelRegistry(tmp_path / "channels.json")
    s = generate_serial()
    ref = {"kind": "tag", "serial": s, "nodePath": "/obj/geo1/tag1", "hip": "D:/x.hip", "label": "Tag"}
    r1 = reg.register(dict(ref))
    time.sleep(0.01)
    r2 = reg.register(dict(ref))
    assert r2["registeredAt"] == r1["registeredAt"]  # 重复注册保留 registeredAt
    assert r2["lastSeen"] >= r1["lastSeen"]          # 刷新 lastSeen
    assert len(reg.list()) == 1


def test_key_of_param_vs_serial(tmp_path: Path) -> None:
    reg = ChannelRegistry(tmp_path / "channels.json")
    s = generate_serial()
    assert reg._key_of({"kind": "tag", "serial": s}) == s
    assert reg._key_of({"kind": "hda", "serial": s}) == s
    assert reg._key_of({"kind": "param", "serial": s, "absolutePath": "/obj/geo1/transform1/tx"}) == "/obj/geo1/transform1/tx"


def test_list_sorted_by_registered_at(tmp_path: Path) -> None:
    reg = ChannelRegistry(tmp_path / "channels.json")
    s1 = generate_serial()
    s2 = generate_serial()
    reg.register({"kind": "tag", "serial": s1, "nodePath": "/obj/geo1/a", "hip": "", "label": ""})
    time.sleep(0.01)
    reg.register({"kind": "tag", "serial": s2, "nodePath": "/obj/geo1/b", "hip": "", "label": ""})
    items = reg.list()
    assert [i["serial"] for i in items] == [s1, s2]


def test_touch_and_save_now(tmp_path: Path) -> None:
    reg = ChannelRegistry(tmp_path / "channels.json")
    s = generate_serial()
    reg.register({"kind": "tag", "serial": s, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""})
    before = reg.get(s)["lastSeen"]
    assert reg.touch(s, before + 1.0) is True
    assert reg.get(s)["lastSeen"] == before + 1.0
    assert reg.touch("missing", 0.0) is False
    reg.save_now()
    reg2 = ChannelRegistry(tmp_path / "channels.json")
    assert reg2.get(s) is not None
    assert reg2.get(s)["lastSeen"] == before + 1.0


def test_persistence(tmp_path: Path) -> None:
    path = tmp_path / "channels.json"
    reg = ChannelRegistry(path)
    s = generate_serial()
    reg.register({"kind": "tag", "serial": s, "nodePath": "/obj/x", "hip": "D:/x.hip", "label": "Tag"})
    reg2 = ChannelRegistry(path)
    rec = reg2.get(s)
    assert rec is not None
    assert rec["nodePath"] == "/obj/x"
    assert rec["label"] == "Tag"


def test_load_tolerates_corrupt_file(tmp_path: Path) -> None:
    path = tmp_path / "channels.json"
    path.write_text("{not json", encoding="utf-8")
    reg = ChannelRegistry(path)
    assert reg.list() == []


# --- fxhoudinimcp stub ------------------------------------------------------


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
        self.node_type = "Cyl1nderTag"
        self.error = False
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
            if command == "nodes.get_node_info":
                if self.error:
                    return {"status": "error", "error": {"code": 1, "message": "boom"}, "request_id": rid}
                name = str(params.get("node_path", "")).split("/")[-1]
                # 实机 fxhoudinimcp：type 是 {name,label,category} 字典，不是字符串。
                return {
                    "status": "success",
                    "data": {
                        "type": {"name": self.node_type, "label": self.node_type, "category": "Sop"},
                        "name": name,
                    },
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


# --- 路由测试（裸 FastAPI 挂 channel_router） --------------------------------


def _client(tmp_path: Path) -> TestClient:
    reset_state(tmp_path / "data")
    app = FastAPI()
    app.include_router(channel_router)
    return TestClient(app)


def test_put_register_ok(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    ref = {"kind": "tag", "serial": serial, "nodePath": "/obj/geo1/tag1", "hip": "D:/x.hip", "label": "Tag"}
    r = c.put(f"/api/channels/{serial}", json=ref)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["channelId"] == serial
    assert body["ref"]["registeredAt"] > 0
    assert body["ref"]["lastSeen"] > 0


def test_put_upsert_preserves_registered_at(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    ref = {"kind": "tag", "serial": serial, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""}
    r1 = c.put(f"/api/channels/{serial}", json=ref).json()
    time.sleep(0.01)
    r2 = c.put(f"/api/channels/{serial}", json=ref).json()
    assert r2["ref"]["registeredAt"] == r1["ref"]["registeredAt"]
    assert r2["ref"]["lastSeen"] >= r1["ref"]["lastSeen"]


def test_put_param_channel_with_slash_path(tmp_path: Path) -> None:
    """param 通道路径 id 含 "/"（:path 捕获）→ 服务端回加 "/" 作为 key。"""
    c = _client(tmp_path)
    serial = generate_serial()
    ref = {
        "kind": "param",
        "serial": serial,
        "nodePath": "/obj/geo1/tag1",
        "absolutePath": "/obj/geo1/transform1/tx",
        "hip": "",
        "label": "",
    }
    r = c.put("/api/channels/obj/geo1/transform1/tx", json=ref)
    assert r.status_code == 200
    body = r.json()
    assert body["channelId"] == "/obj/geo1/transform1/tx"
    channels = c.get("/api/channels").json()["channels"]
    assert any(ch["absolutePath"] == "/obj/geo1/transform1/tx" for ch in channels)


def test_put_channel_id_mismatch_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    ref = {"kind": "tag", "serial": serial, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""}
    r = c.put(f"/api/channels/{generate_serial()}", json=ref)
    assert r.status_code == 400
    assert r.json()["detail"] == "channelId mismatch"


def test_put_param_channel_id_mismatch_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    ref = {
        "kind": "param",
        "serial": generate_serial(),
        "nodePath": "/obj/geo1/tag1",
        "absolutePath": "/obj/geo1/transform1/tx",
        "hip": "",
        "label": "",
    }
    r = c.put("/api/channels/obj/geo1/transform1/ty", json=ref)
    assert r.status_code == 400
    assert r.json()["detail"] == "channelId mismatch"


def test_get_channels_list(tmp_path: Path) -> None:
    c = _client(tmp_path)
    st = get_state()
    st.channels.register({"kind": "tag", "serial": generate_serial(), "nodePath": "/obj/geo1/a", "hip": "", "label": ""})
    st.channels.register({"kind": "tag", "serial": generate_serial(), "nodePath": "/obj/geo1/b", "hip": "", "label": ""})
    r = c.get("/api/channels")
    assert r.status_code == 200
    assert len(r.json()["channels"]) == 2


def test_heartbeat_touches_matching(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    other = generate_serial()
    st = get_state()
    st.channels.register({"kind": "tag", "serial": serial, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""})
    st.channels.register(
        {"kind": "param", "serial": serial, "nodePath": "/obj/geo1/tag1", "absolutePath": "/obj/geo1/transform1/tx", "hip": "", "label": ""}
    )
    st.channels.register({"kind": "tag", "serial": other, "nodePath": "/obj/geo1/tag2", "hip": "", "label": ""})
    other_last = st.channels.get(other)["lastSeen"]
    time.sleep(0.01)
    r = c.post(
        f"/api/hda/{serial}/channels/heartbeat",
        json={"serial": serial, "nodePath": "/obj/geo1/tag1", "upstreamNodePath": "", "fingerprint": "abc"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["serial"] == serial and body["lastSeen"] > 0
    assert st.channels.get(serial)["lastSeen"] >= body["lastSeen"] - 0.001
    assert st.channels.get("/obj/geo1/transform1/tx")["lastSeen"] >= body["lastSeen"] - 0.001
    assert st.channels.get(other)["lastSeen"] == other_last


def test_heartbeat_invalid_serial_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r = c.post("/api/hda/zzz/channels/heartbeat", json={"serial": "zzz", "nodePath": "", "upstreamNodePath": "", "fingerprint": ""})
    assert r.status_code == 400


def test_probe_404(tmp_path: Path) -> None:
    c = _client(tmp_path)
    assert c.get("/api/channels/nonexistent/probe").status_code == 404


def test_probe_no_serial(tmp_path: Path) -> None:
    c = _client(tmp_path)
    get_state().channels.register(
        {"kind": "param", "serial": None, "nodePath": "/obj/geo1/transform1", "absolutePath": "/obj/geo1/transform1/tx", "hip": "", "label": ""}
    )
    body = c.get("/api/channels/obj/geo1/transform1/tx/probe").json()
    assert body["ok"] is True
    assert body["alive"] is False
    assert body["matched"] is False
    assert body["serial"] == ""
    assert body["reason"] == "no serial"


def test_probe_no_port(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(houdini_mcp, "discover_by_hip", lambda *a, **k: None)
    monkeypatch.setattr(houdini_mcp, "discover_first", lambda *a, **k: None)
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().channels.register({"kind": "tag", "serial": serial, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""})
    body = c.get(f"/api/channels/{serial}/probe").json()
    assert body["ok"] is True
    assert body["alive"] is False
    assert body["matched"] is False
    assert body["reason"] == "houdini mcp not reachable"


def test_probe_alive_matched(tmp_path: Path, stub: _McpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    st = get_state()
    st.registry.register(serial, hip="D:/x.hip")
    st.registry.set_houdini_mcp(serial, stub.port)
    st.channels.register({"kind": "tag", "serial": serial, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""})
    stub.node_type = "Cyl1nderTag"
    body = c.get(f"/api/channels/{serial}/probe").json()
    assert body["ok"] is True
    assert body["alive"] is True
    assert body["matched"] is True
    assert body["serial"] == serial
    assert body["reason"] is None


def test_probe_alive_not_matched(tmp_path: Path, stub: _McpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    st = get_state()
    st.registry.register(serial, hip="D:/x.hip")
    st.registry.set_houdini_mcp(serial, stub.port)
    st.channels.register({"kind": "tag", "serial": serial, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""})
    stub.node_type = "geo"
    body = c.get(f"/api/channels/{serial}/probe").json()
    assert body["alive"] is True
    assert body["matched"] is False


def test_node_type_name_variants() -> None:
    """_node_type_name: 字符串 type / 字典 type（实机形态）/ 别名键 / 缺失。"""
    from bridge.channel_routes import _node_type_name

    assert _node_type_name({"type": "geo"}) == "geo"
    assert _node_type_name({"type": {"name": "Cyl1nderTag", "label": "x", "category": "Sop"}}) == "Cyl1nderTag"
    assert _node_type_name({"type": {"typeName": "Cyl1nderTag"}}) == "Cyl1nderTag"
    assert _node_type_name({"node_type": "Cyl1nderTag"}) == "Cyl1nderTag"
    assert _node_type_name({}) == ""
