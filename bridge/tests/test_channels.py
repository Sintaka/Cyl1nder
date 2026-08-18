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


# --- 心跳锚点上报（吊牌自报位置） --------------------------------------------


class _FakeManager:
    """WS 广播替身，照 test_channel_values.py 的做法 monkeypatch cr.manager。"""

    def __init__(self) -> None:
        self.msgs: list[tuple[str, dict]] = []

    async def broadcast(self, serial: str, message: dict) -> None:
        self.msgs.append((serial, message))


class _FakeMappings:
    """upsert_anchor 替身：按 serial 记住上次 nodePath，变化即 moved（真表另一路落地）。"""

    def __init__(self, names: list[str] | None = None) -> None:
        self.names = names or []
        self.calls: list[tuple[str, str, str, str]] = []
        self.kw: list[dict] = []
        self._paths: dict[str, str] = {}
        self.anchors: dict[str, dict] = {}

    def upsert_anchor(
        self, serial: str, node_path: str, hip: str = "", mode: str = "parm",
        pid: int = 0, mcp_port: int = 0,
    ) -> dict:
        self.calls.append((serial, node_path, hip, mode))
        self.kw.append({"pid": pid, "mcp_port": mcp_port})
        old = self._paths.get(serial, "")
        self._paths[serial] = node_path
        moved = bool(old) and old != node_path
        # 照真表规则：0 不覆盖已知好值；pid 变化 = 换进程
        rec = self.anchors.setdefault(serial, {"serial": serial, "pid": 0, "mcpPort": 0})
        old_pid = int(rec.get("pid") or 0)
        pid_changed = bool(pid) and bool(old_pid) and int(pid) != old_pid
        if pid:
            rec["pid"] = int(pid)
        if mcp_port:
            rec["mcpPort"] = int(mcp_port)
        rec.update({"nodePath": node_path, "hip": hip, "mode": mode})
        return {
            "anchor": dict(rec),
            "moved": moved,
            "old": old,
            "names": list(self.names) if moved else [],
            "pid_changed": pid_changed,
            "old_pid": old_pid,
        }


def _heartbeat_env(tmp_path: Path, monkeypatch, names: list[str] | None = None) -> tuple[TestClient, _FakeManager, _FakeMappings]:
    import bridge.channel_routes as cr

    fake_ws = _FakeManager()
    monkeypatch.setattr(cr, "manager", fake_ws)
    c = _client(tmp_path)
    fake_maps = _FakeMappings(names)
    get_state().mappings = fake_maps
    return c, fake_ws, fake_maps


def _post_heartbeat(c: TestClient, serial: str, **extra) -> dict:
    body = {"serial": serial, "nodePath": "", "upstreamNodePath": "", "fingerprint": "fp"}
    body.update(extra)
    r = c.post(f"/api/hda/{serial}/channels/heartbeat", json=body)
    assert r.status_code == 200
    return r.json()


def test_heartbeat_first_anchor_no_move(tmp_path: Path, monkeypatch) -> None:
    """首次心跳建锚点（moved=False）：不广播 anchor-moved、无 anchor-move trace。"""
    c, fake_ws, fake_maps = _heartbeat_env(tmp_path, monkeypatch)
    serial = generate_serial()
    body = _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1", hip="D:/x.hip", mode="apex")
    assert body["ok"] is True
    assert fake_maps.calls == [(serial, "/obj/geo1/tag1", "D:/x.hip", "apex")]
    assert fake_ws.msgs == []
    assert get_state().trace.list(action="anchor-move") == []


def test_heartbeat_moved_broadcasts_anchor_moved(tmp_path: Path, monkeypatch) -> None:
    """nodePath 变化：广播 anchor-moved + 埋 anchor-move trace。"""
    c, fake_ws, fake_maps = _heartbeat_env(tmp_path, monkeypatch, names=["tx", "ty"])
    serial = generate_serial()
    _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1")
    _post_heartbeat(c, serial, nodePath="/obj/geo2/tag1")
    assert len(fake_maps.calls) == 2
    assert len(fake_ws.msgs) == 1
    s, msg = fake_ws.msgs[0]
    assert s == serial
    assert msg == {
        "type": "anchor-moved",
        "serial": serial,
        "oldPath": "/obj/geo1/tag1",
        "newPath": "/obj/geo2/tag1",
        "names": ["tx", "ty"],
    }
    events = get_state().trace.list(actor="tag-hda", action="anchor-move")
    assert len(events) == 1
    assert events[0]["channel"] == serial
    assert events[0]["target"] == "/obj/geo2/tag1"
    assert events[0]["digest"] == "/obj/geo1/tag1 -> /obj/geo2/tag1"


def test_heartbeat_same_path_no_move(tmp_path: Path, monkeypatch) -> None:
    """位置不变的重复心跳：上报但不广播。"""
    c, fake_ws, _ = _heartbeat_env(tmp_path, monkeypatch)
    serial = generate_serial()
    _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1")
    _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1")
    assert fake_ws.msgs == []


def test_heartbeat_no_node_path_skips_anchor(tmp_path: Path, monkeypatch) -> None:
    """无 nodePath（旧 HDA）：完全不碰锚点系统，行为与从前一致。"""
    c, fake_ws, fake_maps = _heartbeat_env(tmp_path, monkeypatch)
    serial = generate_serial()
    body = _post_heartbeat(c, serial)
    assert body["ok"] is True and body["serial"] == serial and body["lastSeen"] > 0
    assert fake_maps.calls == []
    assert fake_ws.msgs == []
    assert get_state().trace.list(actor="tag-hda", action="heartbeat")


def test_heartbeat_without_mappings_attribute(tmp_path: Path, monkeypatch) -> None:
    """state 无 mappings 属性：心跳照常 200（best-effort no-op）。"""
    import bridge.channel_routes as cr

    monkeypatch.setattr(cr, "manager", _FakeManager())
    c = _client(tmp_path)
    st = get_state()
    if hasattr(st, "mappings"):
        delattr(st, "mappings")
    assert _post_heartbeat(c, generate_serial(), nodePath="/obj/geo1/tag1")["ok"] is True


def test_heartbeat_anchor_error_is_swallowed(tmp_path: Path, monkeypatch) -> None:
    """upsert_anchor 抛异常：心跳仍 200、不广播。"""
    import bridge.channel_routes as cr

    fake_ws = _FakeManager()
    monkeypatch.setattr(cr, "manager", fake_ws)
    c = _client(tmp_path)

    class Boom:
        def upsert_anchor(self, *a, **k):
            raise RuntimeError("boom")

    get_state().mappings = Boom()
    assert _post_heartbeat(c, generate_serial(), nodePath="/obj/geo1/tag1")["ok"] is True
    assert fake_ws.msgs == []


# --- 心跳携带 pid / mcpPort（存活实证的判据）---------------------------------


def test_heartbeat_stores_pid_and_port(tmp_path: Path, monkeypatch) -> None:
    c, _, fake_maps = _heartbeat_env(tmp_path, monkeypatch)
    serial = generate_serial()
    _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1", hip="D:/x.hip", pid=4242, mcpPort=8101)
    assert fake_maps.kw == [{"pid": 4242, "mcp_port": 8101}]
    assert fake_maps.anchors[serial]["pid"] == 4242
    assert fake_maps.anchors[serial]["mcpPort"] == 8101


def test_heartbeat_without_pid_leaves_values_intact(tmp_path: Path, monkeypatch) -> None:
    """旧 HDA 不报这两项：行为与从前完全一致，已知好值不被清零。"""
    c, fake_ws, fake_maps = _heartbeat_env(tmp_path, monkeypatch)
    serial = generate_serial()
    _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1", pid=4242, mcpPort=8101)
    _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1")        # 缺省心跳
    assert fake_maps.kw[1] == {"pid": 0, "mcp_port": 0}
    assert fake_maps.anchors[serial]["pid"] == 4242
    assert fake_maps.anchors[serial]["mcpPort"] == 8101
    assert fake_ws.msgs == []


def test_heartbeat_pid_change_is_reported(tmp_path: Path, monkeypatch) -> None:
    """pid 变了 = Houdini 重开：埋 register trace 记下 pid 迁移。"""
    c, _, fake_maps = _heartbeat_env(tmp_path, monkeypatch)
    serial = generate_serial()
    _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1", pid=4242, mcpPort=8101)
    assert get_state().trace.list(actor="tag-hda", action="register") == []

    _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1", pid=5555, mcpPort=8101)
    events = get_state().trace.list(actor="tag-hda", action="register")
    assert len(events) == 1
    assert events[0]["channel"] == serial
    assert events[0]["digest"] == "pid 4242 -> 5555 (houdini restarted)"
    assert fake_maps.anchors[serial]["pid"] == 5555


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


# --- 心跳按 hip 归拢项目（自动登记 + 另存为迁移） ----------------------------


def _no_houdini(monkeypatch) -> None:
    """迁移探测口径：端口解析不出来 = Houdini 不可达 -> 成员一律保留。"""
    import bridge.project_routes as pr

    monkeypatch.setattr(pr, "_resolve_port", lambda serial: 0)


def test_heartbeat_with_hip_auto_registers_member(tmp_path: Path, monkeypatch) -> None:
    """心跳带 hip -> 自动建/找项目并登记成员（用户零操作）。"""
    c, _, _ = _heartbeat_env(tmp_path, monkeypatch)
    _no_houdini(monkeypatch)
    serial = generate_serial()
    _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1", hip="D:/proj/scene.hip")
    projects = get_state().projects.list()
    assert len(projects) == 1
    assert projects[0]["hip"] == "D:/proj/scene.hip"
    assert projects[0]["hipName"] == "scene.hip"
    assert [m["serial"] for m in projects[0]["members"]] == [serial]


def test_heartbeat_two_serials_same_hip_one_project(tmp_path: Path, monkeypatch) -> None:
    """同一个 hip 下的多个吊牌心跳 -> 归进同一个项目（重复项目的正解）。"""
    c, _, _ = _heartbeat_env(tmp_path, monkeypatch)
    _no_houdini(monkeypatch)
    s1, s2 = generate_serial(), generate_serial()
    _post_heartbeat(c, s1, nodePath="/obj/geo1/tag1", hip="D:/proj/scene.hip")
    _post_heartbeat(c, s2, nodePath="/obj/geo1/tag2", hip="D:\\proj\\scene.hip")
    projects = get_state().projects.list()
    assert len(projects) == 1
    assert sorted(m["serial"] for m in projects[0]["members"]) == sorted([s1, s2])


def test_heartbeat_repeated_same_hip_is_stable(tmp_path: Path, monkeypatch) -> None:
    """心跳每次都报 hip：反复上报不得反复迁移（migratedAt 保持 0）。"""
    c, _, _ = _heartbeat_env(tmp_path, monkeypatch)
    _no_houdini(monkeypatch)
    serial = generate_serial()
    for _ in range(3):
        _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1", hip="D:/proj/scene.hip")
    projects = get_state().projects.list()
    assert len(projects) == 1
    assert projects[0]["migratedAt"] == 0.0
    assert len(projects[0]["members"]) == 1


def test_heartbeat_changed_hip_triggers_migration(tmp_path: Path, monkeypatch) -> None:
    """另存为：心跳报了新 hip -> 换绑同一个项目，不新建第二个。"""
    c, _, _ = _heartbeat_env(tmp_path, monkeypatch)
    _no_houdini(monkeypatch)
    serial = generate_serial()
    _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1", hip="D:/proj/a.hip")
    pid = get_state().projects.list()[0]["projectSerial"]
    _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1", hip="D:/proj/b.hip")
    projects = get_state().projects.list()
    assert len(projects) == 1
    assert projects[0]["projectSerial"] == pid
    assert projects[0]["hip"] == "D:/proj/b.hip"
    assert projects[0]["previousHip"] == "D:/proj/a.hip"
    assert projects[0]["migratedAt"] > 0
    assert [m["serial"] for m in projects[0]["members"]] == [serial]  # 探测不到也不丢


def test_heartbeat_without_hip_creates_no_project(tmp_path: Path, monkeypatch) -> None:
    """旧 HDA 不报 hip -> 不碰项目（既有行为不变）。"""
    c, _, _ = _heartbeat_env(tmp_path, monkeypatch)
    assert _post_heartbeat(c, generate_serial(), nodePath="/obj/geo1/tag1")["ok"] is True
    assert get_state().projects.list() == []


def test_heartbeat_ok_when_projects_registry_none(tmp_path: Path, monkeypatch) -> None:
    """state.projects 为 None：心跳照常成功。"""
    c, _, _ = _heartbeat_env(tmp_path, monkeypatch)
    get_state().projects = None
    body = _post_heartbeat(c, generate_serial(), nodePath="/obj/geo1/tag1", hip="D:/proj/scene.hip")
    assert body["ok"] is True


def test_heartbeat_ok_when_projects_attribute_absent(tmp_path: Path, monkeypatch) -> None:
    """state 干脆没有 projects 属性：getattr 兜底，心跳照常成功。"""
    c, _, _ = _heartbeat_env(tmp_path, monkeypatch)
    st = get_state()
    if hasattr(st, "projects"):
        delattr(st, "projects")
    body = _post_heartbeat(c, generate_serial(), nodePath="/obj/geo1/tag1", hip="D:/proj/scene.hip")
    assert body["ok"] is True


def test_heartbeat_project_binding_failure_is_swallowed(tmp_path: Path, monkeypatch) -> None:
    """项目归拢炸了也不许打断心跳：既有行为（lastSeen / 锚点 / trace）全须保留。"""
    import bridge.project_routes as pr

    c, _, fake_maps = _heartbeat_env(tmp_path, monkeypatch)
    calls: list[tuple[str, str]] = []

    async def boom(serial: str, hip: str):
        calls.append((serial, hip))
        raise RuntimeError("boom")

    monkeypatch.setattr(pr, "bind_serial_to_hip", boom)
    serial = generate_serial()
    st = get_state()
    st.channels.register({"kind": "tag", "serial": serial, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""})
    body = _post_heartbeat(c, serial, nodePath="/obj/geo1/tag1", hip="D:/proj/scene.hip")
    assert calls == [(serial, "D:/proj/scene.hip")]  # 确实调到了、也确实炸了
    assert body["ok"] is True and body["lastSeen"] > 0
    assert st.channels.get(serial)["lastSeen"] > 0
    assert fake_maps.calls == [(serial, "/obj/geo1/tag1", "D:/proj/scene.hip", "parm")]
    assert st.trace.list(actor="tag-hda", action="heartbeat")
