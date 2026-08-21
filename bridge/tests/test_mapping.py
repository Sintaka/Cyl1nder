"""映射系统注册表 + 路由测试（见 devlog/project-mapping-design.md）。

MappingRegistry 单测照 test_channels.py 纯单元风格；路由测试同样用裸 FastAPI
（create_app 尚未挂载 mapping_routes，main.py 由主进程粘合），state.mappings
由测试自行挂载（state.py 不属本写集）。
"""
from __future__ import annotations

import asyncio
import http.server
import json
import threading
import urllib.parse
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bridge import houdini_mcp
from bridge.mapping import MappingRegistry, resolve_path
from bridge.mapping_routes import router as mapping_router
from bridge.protocol import generate_project_serial, generate_serial
from bridge.state import get_state, reset_state

TAG_PATH = "/obj/geo1/apex_ctrl_tag"
REL = "sandbox_sceneanimate/point_1"
ABS = "/obj/geo1/sandbox_sceneanimate/point_1"


def _entry(anchor: str, rel: str = REL, **kw) -> dict:
    return {"anchor": anchor, "rel": rel, "kind": "param", "adapter": None,
            "type": "float", "label": "", **kw}


def _seed(reg: MappingRegistry, *, rel: str = REL) -> tuple[str, str]:
    """建锚点 + 一条 entry，返回 (project, anchor serial)。"""
    pid, serial = generate_project_serial(), generate_serial()
    reg.upsert_anchor(serial, TAG_PATH)
    reg.put_entry(pid, "apex/point_1", _entry(serial, rel))
    return pid, serial


# --- 解析 --------------------------------------------------------------------


def test_resolve_sibling_semantics() -> None:
    """rel 以吊牌**所在网络**为基准（兄弟节点语义），不是吊牌自身路径。"""
    reg = MappingRegistry()
    pid, _ = _seed(reg)
    r = reg.resolve(pid, "apex/point_1")
    assert r["ok"] is True
    assert r["absolutePath"] == ABS
    assert r["error"] == ""


def test_resolve_path_normalizes_parent_refs() -> None:
    assert resolve_path(TAG_PATH, "../geo2/box1") == "/obj/geo2/box1"
    assert resolve_path(TAG_PATH, "tx") == "/obj/geo1/tx"
    assert resolve_path("/obj/tag1", "transform1/tx") == "/obj/transform1/tx"
    assert resolve_path("tag1", "tx") == ""  # 无所在网络


def test_move_tolerance_logical_name_unchanged() -> None:
    """全系统存在的理由：吊牌移动/改名，逻辑名不变，绝对路径自动跟随。"""
    reg = MappingRegistry()
    pid, serial = _seed(reg)
    assert reg.resolve(pid, "apex/point_1")["absolutePath"] == ABS

    out = reg.upsert_anchor(serial, "/obj/geo2/renamed_tag")
    assert out["moved"] is True
    assert out["old"] == TAG_PATH
    assert out["names"] == ["apex/point_1"]
    assert out["anchor"]["movedAt"] > 0

    r = reg.resolve(pid, "apex/point_1")            # 同一个逻辑名
    assert r["ok"] is True
    assert r["absolutePath"] == "/obj/geo2/sandbox_sceneanimate/point_1"
    assert reg.get_entry(pid, "apex/point_1")["rel"] == REL  # rel 也没动


def test_last_seen_refresh_is_not_moved() -> None:
    reg = MappingRegistry()
    _, serial = _seed(reg)
    first = reg.get_anchor(serial)["lastSeen"]
    out = reg.upsert_anchor(serial, TAG_PATH)
    assert out["moved"] is False
    assert out["names"] == []
    assert out["anchor"]["movedAt"] == 0.0
    assert out["anchor"]["lastSeen"] >= first


def test_first_upsert_is_not_moved() -> None:
    """首次上报（old 为空）不算移动。"""
    reg = MappingRegistry()
    out = reg.upsert_anchor(generate_serial(), TAG_PATH)
    assert out["moved"] is False
    assert out["old"] == ""


# --- pid / mcpPort（存活实证的判据）-----------------------------------------


def test_anchor_records_pid_and_port() -> None:
    reg = MappingRegistry()
    serial = generate_serial()
    out = reg.upsert_anchor(serial, TAG_PATH, "D:/x.hip", "parm", pid=4242, mcp_port=8101)
    assert out["pid_changed"] is False               # 首次记录不是「换进程」
    a = reg.get_anchor(serial)
    assert (a["pid"], a["mcpPort"]) == (4242, 8101)
    assert a["verifiedAlive"] is False and a["verifiedAt"] == 0.0


def test_zero_pid_or_port_never_clobbers_known_values() -> None:
    """旧 HDA 不报 pid/端口：缺省值绝不能把已知好值清成 0（否则探测彻底失去判据）。"""
    reg = MappingRegistry()
    serial = generate_serial()
    reg.upsert_anchor(serial, TAG_PATH, pid=4242, mcp_port=8101)
    reg.upsert_anchor(serial, TAG_PATH)              # 旧构建心跳：两项都缺
    a = reg.get_anchor(serial)
    assert (a["pid"], a["mcpPort"]) == (4242, 8101)

    reg.upsert_anchor(serial, TAG_PATH, pid=0, mcp_port=8102)   # 只报端口
    a = reg.get_anchor(serial)
    assert (a["pid"], a["mcpPort"]) == (4242, 8102)


def test_pid_change_resets_verification() -> None:
    """pid 变了 = Houdini 重开，上次核对不再证明任何事。"""
    reg = MappingRegistry()
    serial = generate_serial()
    reg.upsert_anchor(serial, TAG_PATH, pid=4242, mcp_port=8101)
    reg.mark_verified(serial, True, port=8101)
    assert reg.get_anchor(serial)["verifiedAlive"] is True

    out = reg.upsert_anchor(serial, TAG_PATH, pid=5555, mcp_port=8101)
    assert out["pid_changed"] is True
    assert out["old_pid"] == 4242
    a = reg.get_anchor(serial)
    assert a["pid"] == 5555
    assert a["verifiedAlive"] is False and a["verifiedAt"] == 0.0

    same = reg.upsert_anchor(serial, TAG_PATH, pid=5555)         # 同 pid 不算变化
    assert same["pid_changed"] is False


def test_mark_verified_updates_fields_and_can_move_port() -> None:
    reg = MappingRegistry()
    serial = generate_serial()
    reg.upsert_anchor(serial, TAG_PATH, pid=4242, mcp_port=8101)

    rec = reg.mark_verified(serial, True, port=8103)
    assert rec["verifiedAlive"] is True
    assert rec["verifiedAt"] > 0
    assert rec["mcpPort"] == 8103                    # 实例换端口了（按 hip 重定位过）

    rec2 = reg.mark_verified(serial, False)          # port=0 不动 mcpPort
    assert rec2["verifiedAlive"] is False
    assert rec2["mcpPort"] == 8103
    assert reg.get_anchor(serial)["verifiedAlive"] is False


def test_mark_verified_never_invents_a_pid() -> None:
    """探来的 pid 不写进记录：pid 的权威来源只有吊牌自报（端口可能已属别的实例）。"""
    reg = MappingRegistry()
    serial = generate_serial()
    reg.upsert_anchor(serial, TAG_PATH, mcp_port=8101)            # 没有 pid（旧构建）
    reg.mark_verified(serial, False, port=8101, actual_pid=4242)
    assert reg.get_anchor(serial)["pid"] == 0

    reg.upsert_anchor(serial, TAG_PATH, pid=7777)                 # 吊牌自报才算数
    reg.mark_verified(serial, True, port=8101, actual_pid=9999)
    assert reg.get_anchor(serial)["pid"] == 7777


def test_mark_verified_unknown_serial_is_none() -> None:
    assert MappingRegistry().mark_verified(generate_serial(), True, port=8101) is None


def test_pid_port_persistence_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "mappings.json"
    reg = MappingRegistry(path)
    serial = generate_serial()
    reg.upsert_anchor(serial, TAG_PATH, "D:/x.hip", "parm", pid=4242, mcp_port=8101)
    reg.mark_verified(serial, True, port=8102)
    reg.save_now()

    a = MappingRegistry(path).get_anchor(serial)
    assert (a["pid"], a["mcpPort"]) == (4242, 8102)
    assert a["verifiedAlive"] is True and a["verifiedAt"] > 0
    raw = json.loads(path.read_text(encoding="utf-8"))["anchors"][serial]
    assert raw["pid"] == 4242 and raw["mcpPort"] == 8102


def test_legacy_anchor_without_new_keys_gets_them(tmp_path: Path) -> None:
    """旧 mappings.json 的锚点没有 pid/mcpPort/verified*：上报一次即补齐，不炸。"""
    path = tmp_path / "mappings.json"
    serial = generate_serial()
    path.write_text(
        json.dumps({"anchors": {serial: {"serial": serial, "nodePath": TAG_PATH}}, "entries": {}}),
        encoding="utf-8",
    )
    reg = MappingRegistry(path)
    reg.upsert_anchor(serial, TAG_PATH, pid=4242)
    a = reg.get_anchor(serial)
    assert a["pid"] == 4242 and a["mcpPort"] == 0
    assert a["verifiedAlive"] is False and a["verifiedAt"] == 0.0
    assert reg.mark_verified(serial, True)["mcpPort"] == 0


def test_pid_change_forces_save(tmp_path: Path) -> None:
    """pid/端口变化即 force 落盘（无视 lastSeen debounce）。"""
    path = tmp_path / "mappings.json"
    clock = {"t": 1000.0}
    reg = MappingRegistry(path, clock=lambda: clock["t"])
    serial = generate_serial()
    reg.upsert_anchor(serial, TAG_PATH, pid=4242, mcp_port=8101)
    reg.upsert_anchor(serial, TAG_PATH, pid=5555, mcp_port=8101)   # 同 debounce 窗口内
    assert json.loads(path.read_text(encoding="utf-8"))["anchors"][serial]["pid"] == 5555

    reg.upsert_anchor(serial, TAG_PATH, pid=5555, mcp_port=8109)
    assert json.loads(path.read_text(encoding="utf-8"))["anchors"][serial]["mcpPort"] == 8109


def test_resolve_missing_anchor_not_ok() -> None:
    reg = MappingRegistry()
    pid = generate_project_serial()
    reg.put_entry(pid, "ghost", _entry(generate_serial()))
    r = reg.resolve(pid, "ghost")                    # 绝不抛
    assert r["ok"] is False
    assert r["absolutePath"] == ""
    assert "unknown anchor" in r["error"]


def test_resolve_unknown_name_and_empty_node_path() -> None:
    reg = MappingRegistry()
    pid, serial = generate_project_serial(), generate_serial()
    assert reg.resolve(pid, "nope")["ok"] is False
    reg.upsert_anchor(serial, "")                    # 上报了但 nodePath 为空
    reg.put_entry(pid, "n", _entry(serial))
    r = reg.resolve(pid, "n")
    assert r["ok"] is False and r["absolutePath"] == ""


def test_resolve_all() -> None:
    reg = MappingRegistry()
    pid, serial = _seed(reg)
    reg.put_entry(pid, "apex/point_2", _entry(serial, "sandbox_sceneanimate/point_2"))
    resolved = reg.resolve_all(pid)
    assert set(resolved) == {"apex/point_1", "apex/point_2"}
    assert resolved["apex/point_2"]["absolutePath"] == "/obj/geo1/sandbox_sceneanimate/point_2"


def test_project_isolation() -> None:
    """逻辑名作用域 = 项目内唯一：同名可在不同项目指向不同锚点。"""
    reg = MappingRegistry()
    p1, p2 = generate_project_serial(), generate_project_serial()
    a1, a2 = generate_serial(), generate_serial()
    reg.upsert_anchor(a1, "/obj/geo1/tag_a")
    reg.upsert_anchor(a2, "/obj/geo9/tag_b")
    reg.put_entry(p1, "ctrl", _entry(a1, "sceneanimate/point_1"))
    reg.put_entry(p2, "ctrl", _entry(a2, "sceneanimate/point_1"))
    assert reg.resolve(p1, "ctrl")["absolutePath"] == "/obj/geo1/sceneanimate/point_1"
    assert reg.resolve(p2, "ctrl")["absolutePath"] == "/obj/geo9/sceneanimate/point_1"
    assert list(reg.list_entries(p1)) == ["ctrl"]


# --- 条目校验 / 清理 ----------------------------------------------------------


def test_put_entry_validates() -> None:
    reg = MappingRegistry()
    pid, serial = generate_project_serial(), generate_serial()
    with pytest.raises(ValueError):
        reg.put_entry(pid, "bad", _entry(serial, type="quaternion"))
    with pytest.raises(ValueError):
        reg.put_entry(pid, "bad", _entry(serial, rel=""))
    with pytest.raises(ValueError):
        reg.put_entry(pid, "bad", _entry(""))
    assert reg.list_entries(pid) == {}
    for t in ("geo", "float", "vec3"):
        reg.put_entry(pid, f"ok_{t}", _entry(serial, type=t))
    assert len(reg.list_entries(pid)) == 3


def test_put_entry_upsert_and_del() -> None:
    reg = MappingRegistry()
    pid, serial = _seed(reg)
    reg.put_entry(pid, "apex/point_1", _entry(serial, "other/point_9"))
    assert reg.resolve(pid, "apex/point_1")["absolutePath"] == "/obj/geo1/other/point_9"
    assert reg.del_entry(pid, "apex/point_1") is True
    assert reg.del_entry(pid, "apex/point_1") is False
    assert reg.get_entry(pid, "apex/point_1") is None


def test_entries_for_anchor_and_prune() -> None:
    reg = MappingRegistry()
    p1, p2 = generate_project_serial(), generate_project_serial()
    a1, a2 = generate_serial(), generate_serial()
    reg.upsert_anchor(a1, "/obj/geo1/tag_a")
    reg.upsert_anchor(a2, "/obj/geo2/tag_b")
    reg.put_entry(p1, "x", _entry(a1))
    reg.put_entry(p2, "y", _entry(a1))
    reg.put_entry(p2, "z", _entry(a2))
    assert sorted(reg.entries_for_anchor(a1)) == sorted([(p1, "x"), (p2, "y")])

    assert reg.prune_anchor(a1) == 2
    assert reg.get_anchor(a1) is None
    assert reg.list_entries(p1) == {}
    assert list(reg.list_entries(p2)) == ["z"]        # 别的锚点条目留着
    assert reg.prune_anchor(generate_serial()) == 0


def test_drop_project() -> None:
    reg = MappingRegistry()
    p1, serial = _seed(reg)
    p2 = generate_project_serial()
    reg.put_entry(p2, "keep", _entry(serial))
    assert reg.drop_project(p1) is True
    assert reg.drop_project(p1) is False
    assert reg.list_entries(p1) == {}
    assert list(reg.list_entries(p2)) == ["keep"]
    assert reg.get_anchor(serial) is not None         # 锚点不受项目删除影响


# --- 落盘 --------------------------------------------------------------------


def test_persistence_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "mappings.json"
    reg = MappingRegistry(path)
    pid, serial = _seed(reg)
    reg.save_now()

    reg2 = MappingRegistry(path)
    assert reg2.get_anchor(serial)["nodePath"] == TAG_PATH
    assert reg2.get_entry(pid, "apex/point_1")["rel"] == REL
    assert reg2.resolve(pid, "apex/point_1")["absolutePath"] == ABS
    # 顶层是 dict（不同于 channels.json 的 list）
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert set(raw) == {"anchors", "entries"}
    assert list(raw["entries"][pid]) == ["apex/point_1"]


def test_load_tolerates_corrupt_and_legacy_files(tmp_path: Path) -> None:
    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{not json", encoding="utf-8")
    reg = MappingRegistry(corrupt)                    # 不抛
    assert reg.list_anchors() == {}

    legacy = tmp_path / "legacy.json"                 # 旧格式：顶层 list
    legacy.write_text("[]", encoding="utf-8")
    assert MappingRegistry(legacy).list_anchors() == {}

    empty = tmp_path / "empty.json"
    empty.write_text("", encoding="utf-8")
    assert MappingRegistry(empty).list_anchors() == {}

    partial = tmp_path / "partial.json"               # 畸形成员被跳过
    partial.write_text(json.dumps({"anchors": {"C1-x": "nope"}, "entries": 5}), encoding="utf-8")
    p = MappingRegistry(partial)
    assert p.list_anchors() == {} and p.list_entries("P1-a") == {}


def test_last_seen_refresh_is_debounced(tmp_path: Path) -> None:
    """心跳只刷 lastSeen -> debounce；移动/新建 -> force 落盘。"""
    path = tmp_path / "mappings.json"
    clock = {"t": 1000.0}
    reg = MappingRegistry(path, clock=lambda: clock["t"])
    serial = generate_serial()
    reg.upsert_anchor(serial, TAG_PATH)               # 新建 -> force
    assert path.exists()
    first = json.loads(path.read_text(encoding="utf-8"))["anchors"][serial]["lastSeen"]

    reg.upsert_anchor(serial, TAG_PATH)               # 同窗口内心跳 -> 不落盘
    assert json.loads(path.read_text(encoding="utf-8"))["anchors"][serial]["lastSeen"] == first

    clock["t"] += 2.0                                 # 越过 debounce 窗口
    reg.upsert_anchor(serial, TAG_PATH)
    assert json.loads(path.read_text(encoding="utf-8"))["anchors"][serial]["lastSeen"] > first

    reg.upsert_anchor(serial, "/obj/geo2/moved")      # 移动 -> force（无视 debounce）
    assert json.loads(path.read_text(encoding="utf-8"))["anchors"][serial]["nodePath"] == "/obj/geo2/moved"


# --- fxhoudinimcp stub（parameters.get_parameter / set_parameter）------------


class _StubHandler(http.server.BaseHTTPRequestHandler):
    server: "_McpStub"

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or "0")
        form = urllib.parse.parse_qs(self.rfile.read(length).decode("utf-8", "replace"), keep_blank_values=True)
        try:
            payload = json.loads(form.get("json", [""])[0])
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
        self.values: dict[str, object] = {}
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
        if cmd != "mcp.execute":
            return {"status": "error", "error": {"message": f"unknown {cmd!r}"}}
        kwargs = payload[2] if len(payload) > 2 and isinstance(payload[2], dict) else {}
        command = kwargs.get("command", "")
        params = kwargs.get("params") or {}
        rid = kwargs.get("request_id", "")
        key = f"{params.get('node_path', '')}/{params.get('parm_name', '')}"
        if command == "parameters.get_parameter":
            return {"status": "success", "data": {"value": self.values.get(key, 0.0)}, "request_id": rid}
        if command == "parameters.set_parameter":
            self.values[key] = params.get("value")
            return {"status": "success", "data": {"ok": True}, "request_id": rid}
        return {"status": "error", "error": {"message": f"no such command {command}"}, "request_id": rid}


@pytest.fixture
def stub() -> _McpStub:
    s = _McpStub()
    s.start()
    yield s
    s.stop()


# --- 路由测试（裸 FastAPI 挂 mapping_router） --------------------------------


def _client(tmp_path: Path) -> TestClient:
    """state.mappings 由测试挂载：state.py 不属本写集，主进程负责粘合。"""
    st = reset_state(tmp_path / "data")
    st.mappings = MappingRegistry(tmp_path / "data" / "mappings.json")
    app = FastAPI()
    app.include_router(mapping_router)
    return TestClient(app)


def _wire(pid: str, serial: str, *, node_path: str = TAG_PATH) -> None:
    st = get_state()
    st.mappings.upsert_anchor(serial, node_path)
    st.registry.register(serial, hip="D:/x.hip")


def test_route_put_get_delete(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid, serial = generate_project_serial(), generate_serial()
    _wire(pid, serial)
    r = c.put(f"/api/projects/{pid}/mappings/apex/point_1", json=_entry(serial))
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["entry"]["rel"] == REL
    assert body["resolved"]["absolutePath"] == ABS

    listed = c.get(f"/api/projects/{pid}/mappings").json()
    assert listed["projectSerial"] == pid
    assert list(listed["entries"]) == ["apex/point_1"]
    assert list(listed["anchors"]) == [serial]           # 只回被引用的锚点
    assert listed["resolved"]["apex/point_1"]["absolutePath"] == ABS

    assert c.delete(f"/api/projects/{pid}/mappings/apex/point_1").json() == {"ok": True, "removed": True}
    assert c.delete(f"/api/projects/{pid}/mappings/apex/point_1").status_code == 404
    assert c.get(f"/api/projects/{pid}/mappings").json()["entries"] == {}


def test_route_invalid_pid_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    assert c.get("/api/projects/zzz/mappings").status_code == 400
    assert c.put("/api/projects/zzz/mappings/n", json=_entry(generate_serial())).status_code == 400
    assert c.delete("/api/projects/zzz/mappings/n").status_code == 400
    assert c.get("/api/projects/zzz/mappings/n/value").status_code == 400


def test_route_put_bad_entry_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = generate_project_serial()
    r = c.put(f"/api/projects/{pid}/mappings/n", json=_entry(generate_serial(), type="matrix"))
    assert r.status_code == 400
    r = c.put(f"/api/projects/{pid}/mappings/n", json=_entry(generate_serial(), rel=""))
    assert r.status_code == 400


def test_route_value_404_for_unknown_name(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = generate_project_serial()
    assert c.get(f"/api/projects/{pid}/mappings/nope/value").status_code == 404
    assert c.put(f"/api/projects/{pid}/mappings/nope/value", json={"value": 1}).status_code == 404


def test_route_value_missing_anchor_not_ok(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = generate_project_serial()
    get_state().mappings.put_entry(pid, "ghost", _entry(generate_serial()))
    body = c.get(f"/api/projects/{pid}/mappings/ghost/value").json()
    assert body["ok"] is False and "unknown anchor" in body["error"]


def test_route_value_no_port(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(houdini_mcp, "discover_by_hip", lambda *a, **k: None)
    monkeypatch.setattr(houdini_mcp, "discover_first", lambda *a, **k: None)
    c = _client(tmp_path)
    pid, serial = generate_project_serial(), generate_serial()
    _wire(pid, serial)
    get_state().mappings.put_entry(pid, "n", _entry(serial))
    body = c.get(f"/api/projects/{pid}/mappings/n/value").json()
    assert body == {"ok": False, "error": "houdini mcp not reachable"}


def test_route_param_value_round_trip(tmp_path: Path, stub: _McpStub) -> None:
    c = _client(tmp_path)
    pid, serial = generate_project_serial(), generate_serial()
    _wire(pid, serial, node_path="/obj/geo1/tag1")
    get_state().mappings.put_entry(pid, "tx", _entry(serial, "transform1/tx"))
    get_state().registry.set_houdini_mcp(serial, stub.port)

    assert c.put(f"/api/projects/{pid}/mappings/tx/value", json={"value": 3.5}).json() == {"ok": True, "value": 3.5}
    assert stub.values["/obj/geo1/transform1/tx"] == 3.5
    assert c.get(f"/api/projects/{pid}/mappings/tx/value").json() == {"ok": True, "value": 3.5}
    actions = [e.get("action") for e in get_state().trace.list()]
    assert "data-set" in actions and "data-get" in actions


def test_route_value_not_shallowed_by_name_path(tmp_path: Path, stub: _McpStub) -> None:
    """逻辑名含 "/" 时 /value 后缀不能被 {name:path} 吞掉（channel_routes 的老坑）。"""
    c = _client(tmp_path)
    pid, serial = generate_project_serial(), generate_serial()
    _wire(pid, serial, node_path="/obj/geo1/tag1")
    get_state().registry.set_houdini_mcp(serial, stub.port)
    c.put(f"/api/projects/{pid}/mappings/point_1/tx", json=_entry(serial, "transform1/tx"))

    # 名字是 "point_1/tx"，不是 "point_1/tx/value"
    assert list(c.get(f"/api/projects/{pid}/mappings").json()["entries"]) == ["point_1/tx"]
    assert c.put(f"/api/projects/{pid}/mappings/point_1/tx/value", json={"value": 7.0}).json()["value"] == 7.0
    assert c.get(f"/api/projects/{pid}/mappings/point_1/tx/value").json() == {"ok": True, "value": 7.0}
    assert get_state().mappings.get_entry(pid, "point_1/tx/value") is None  # 没被误建成条目


def test_route_data_kind_unknown_adapter_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid, serial = generate_project_serial(), generate_serial()
    _wire(pid, serial)
    get_state().mappings.put_entry(pid, "d", _entry(serial, kind="data", adapter="nope", type="vec3"))
    assert c.get(f"/api/projects/{pid}/mappings/d/value").status_code == 400
    assert c.put(f"/api/projects/{pid}/mappings/d/value", json={"value": 1}).status_code == 400


# --- 锚点存活探测（monkeypatch health/discover_by_hip，绝不碰真端口）----------


def _probe_env(tmp_path: Path, monkeypatch, *, ports: dict[int, dict]):
    """ports: {端口: health dict}（缺席即该端口不通）；seen 记录探测顺序。

    刻意**不再** mock `discover_by_hip`：重定位改为按 pid 扫端口，因为 `mcp.health`
    实测不回 hip_file（dev 规范：安装版 health 不带 hip_file），hip 定位恒为 None。
    health dict 里也不再放 hip_file——那个字段在真实响应里根本不存在，mock 出来
    只会让测试相信一件假事。
    """
    seen: list[int] = []

    def fake_health(port, timeout=1.0):
        seen.append(int(port))
        return ports.get(int(port))

    monkeypatch.setattr(houdini_mcp, "health", fake_health)
    return _client(tmp_path), seen


def _seed_anchor(serial: str, *, pid: int, port: int, hip: str = "D:/x.hip") -> None:
    get_state().mappings.upsert_anchor(serial, TAG_PATH, hip, "parm", pid=pid, mcp_port=port)


def test_probe_recorded_port_pid_matches(tmp_path: Path, monkeypatch) -> None:
    c, seen = _probe_env(tmp_path, monkeypatch, ports={8101: {"pid": 4242}})
    pid, serial = generate_project_serial(), generate_serial()
    _seed_anchor(serial, pid=4242, port=8101)

    body = c.get(f"/api/projects/{pid}/anchors/{serial}/probe").json()
    assert body["alive"] is True and body["pidMatched"] is True
    assert (body["port"], body["expectedPid"], body["actualPid"]) == (8101, 4242, 4242)
    assert body["serial"] == serial and body["hip"] == "D:/x.hip"
    assert "alive" in body["reason"]
    assert seen == [8101]                            # pid 对上就不再扫 hip

    a = get_state().mappings.get_anchor(serial)
    assert a["verifiedAlive"] is True and a["verifiedAt"] > 0


def test_probe_different_pid_means_instance_changed(tmp_path: Path, monkeypatch) -> None:
    """端口通但 pid 是另一个进程：实例换了，不能当同一个用。"""
    c, _ = _probe_env(tmp_path, monkeypatch, ports={8101: {"pid": 9999}})
    pid, serial = generate_project_serial(), generate_serial()
    _seed_anchor(serial, pid=4242, port=8101)

    body = c.get(f"/api/projects/{pid}/anchors/{serial}/probe").json()
    assert body["alive"] is True and body["pidMatched"] is False
    assert (body["expectedPid"], body["actualPid"]) == (4242, 9999)
    assert "different process" in body["reason"]
    assert get_state().mappings.get_anchor(serial)["verifiedAlive"] is False


def test_probe_rediscovers_by_pid_scan_not_hip(tmp_path: Path, monkeypatch) -> None:
    """记录端口死了 -> **按 pid 扫端口**找回同一实例，mcpPort 更新到新端口。

    刻意不按 hip 定位：`mcp.health` 实测只回 {status, pid, houdini_version}，不带
    hip_file（dev 规范早有记载），所以 discover_by_hip 恒为 None。这里断言扫描确实
    走了 pid 这条路——`seen` 应含扫描窗口里 8107 之前的端口。
    """
    c, seen = _probe_env(
        tmp_path, monkeypatch,
        ports={8107: {"pid": 4242}},   # 8101（记录值）不通；真实实例在 8107
    )
    pid, serial = generate_project_serial(), generate_serial()
    _seed_anchor(serial, pid=4242, port=8101)

    body = c.get(f"/api/projects/{pid}/anchors/{serial}/probe").json()
    assert body["alive"] is True and body["pidMatched"] is True
    assert body["port"] == 8107
    assert body["actualPid"] == 4242
    # 先试记录端口，再从窗口起点扫到命中为止（证明是 pid 扫描而非 hip 定位）
    assert seen[0] == 8101
    assert 8100 in seen and 8107 in seen
    assert get_state().mappings.get_anchor(serial)["mcpPort"] == 8107


def test_probe_pid_scan_ignores_other_live_instances(tmp_path: Path, monkeypatch) -> None:
    """扫描窗口里有别的活 Houdini（pid 不同）时绝不误采——只认 pid 相符的那个。"""
    c, _ = _probe_env(
        tmp_path, monkeypatch,
        ports={8100: {"pid": 1111}, 8103: {"pid": 2222}, 8109: {"pid": 4242}},
    )
    pid, serial = generate_project_serial(), generate_serial()
    _seed_anchor(serial, pid=4242, port=8101)      # 记录端口不通

    body = c.get(f"/api/projects/{pid}/anchors/{serial}/probe").json()
    assert body["alive"] is True and body["pidMatched"] is True
    assert body["port"] == 8109                    # 不是 8100 也不是 8103
    assert body["actualPid"] == 4242


def test_probe_everything_dead_is_not_an_error(tmp_path: Path, monkeypatch) -> None:
    c, _ = _probe_env(tmp_path, monkeypatch, ports={})
    pid, serial = generate_project_serial(), generate_serial()
    _seed_anchor(serial, pid=4242, port=8101)

    r = c.get(f"/api/projects/{pid}/anchors/{serial}/probe")
    assert r.status_code == 200                      # 探测失败不是 HTTP 错误
    body = r.json()
    assert body["alive"] is False and body["pidMatched"] is False
    assert body["actualPid"] == 0
    assert "unreachable" in body["reason"] and "expected pid" in body["reason"]
    a = get_state().mappings.get_anchor(serial)
    assert a["verifiedAlive"] is False and a["verifiedAt"] > 0
    assert a["mcpPort"] == 8101                      # 探测失败不改端口


def test_probe_without_recorded_pid_never_fakes_a_match(tmp_path: Path, monkeypatch) -> None:
    """旧构建没报 pid：没有期望值就不是「匹配」，reason 必须说清楚。"""
    c, _ = _probe_env(tmp_path, monkeypatch, ports={8101: {"pid": 4242}})
    pid, serial = generate_project_serial(), generate_serial()
    _seed_anchor(serial, pid=0, port=8101)

    body = c.get(f"/api/projects/{pid}/anchors/{serial}/probe").json()
    assert body["alive"] is True
    assert body["pidMatched"] is False
    assert body["expectedPid"] == 0 and body["actualPid"] == 4242
    assert "no pid recorded" in body["reason"]
    assert get_state().mappings.get_anchor(serial)["verifiedAlive"] is False


def test_probe_unknown_anchor_404(tmp_path: Path, monkeypatch) -> None:
    c, _ = _probe_env(tmp_path, monkeypatch, ports={})
    pid = generate_project_serial()
    assert c.get(f"/api/projects/{pid}/anchors/{generate_serial()}/probe").status_code == 404
    assert c.get(f"/api/projects/zzz/anchors/{generate_serial()}/probe").status_code == 400


def test_probe_route_not_shadowed_by_name_path(tmp_path: Path, monkeypatch) -> None:
    """probe 与 mappings/{name:path} 同处 /api/projects/{pid}/ 之下，不能被 :path 吞掉。"""
    c, _ = _probe_env(tmp_path, monkeypatch, ports={8101: {"pid": 4242}})
    pid, serial = generate_project_serial(), generate_serial()
    _seed_anchor(serial, pid=4242, port=8101)
    # 故意造一条能吃掉 probe 路径的逻辑名：若 :path 抢在前面，probe 会被当成 mapping 名
    c.put(f"/api/projects/{pid}/mappings/anchors/{serial}/probe", json=_entry(serial, "transform1/tx"))
    assert get_state().mappings.get_entry(pid, f"anchors/{serial}/probe") is not None

    body = c.get(f"/api/projects/{pid}/anchors/{serial}/probe").json()
    # probe 的形状（有 pidMatched/expectedPid），不是 mapping 的 {"ok","value"}
    assert body["serial"] == serial and body["alive"] is True
    assert body["pidMatched"] is True and body["expectedPid"] == 4242
    assert "value" not in body


def test_route_data_kind_uses_adapter(tmp_path: Path, monkeypatch) -> None:
    """kind=data 走适配器（absolutePath 按最后一个 "/" 切分成 node/parm）。"""
    import bridge.mapping_routes as mr

    calls: list[tuple] = []

    class _FakeAdapter:
        name = "apex-ctrl"

        def read(self, port, node, parm):
            calls.append(("read", port, node, parm))
            return {"ok": True, "value": {"t": [1.0, 2.0, 3.0]}}

        def write(self, port, node, parm, value):
            calls.append(("write", port, node, parm, value))
            return {"ok": True}

    monkeypatch.setattr(mr, "get_adapter", lambda name: _FakeAdapter() if name == "apex-ctrl" else None)
    monkeypatch.setattr(mr, "_resolve_port", lambda serial: 8100)
    c = _client(tmp_path)
    pid, serial = generate_project_serial(), generate_serial()
    _wire(pid, serial)
    get_state().mappings.put_entry(
        pid, "ctrl", _entry(serial, kind="data", adapter="apex-ctrl", type="vec3")
    )
    body = c.get(f"/api/projects/{pid}/mappings/ctrl/value").json()
    assert body == {"ok": True, "value": {"t": [1.0, 2.0, 3.0]}}
    assert calls[0] == ("read", 8100, "/obj/geo1/sandbox_sceneanimate", "point_1")
    assert c.put(f"/api/projects/{pid}/mappings/ctrl/value", json={"value": {"t": [4.0, 0.0, 0.0]}}).json()["ok"] is True
    assert calls[1][:4] == ("write", 8100, "/obj/geo1/sandbox_sceneanimate", "point_1")


# --- vec3 单次元组读优化（_read_vec3_tuple，212ms -> ~55ms）-------------------


def _get_parameter_calls(stub: "_McpStub") -> list[dict]:
    """从 stub.log 里挑出 command == parameters.get_parameter 的调用（含 params）。"""
    out = []
    for p in stub.log:
        if isinstance(p, list) and len(p) > 2 and isinstance(p[2], dict):
            if p[2].get("command") == "parameters.get_parameter":
                out.append(p[2].get("params") or {})
    return out


def test_route_vec3_value_uses_single_tuple_read(tmp_path: Path, stub: _McpStub, monkeypatch) -> None:
    """vec3 优先走 _read_vec3_tuple 单次调用；parameters.get_parameter 一次都不该
    被叫到——那条调用对元组参数恒失败（`parm("t")` 是 None），是纯浪费的往返。"""
    import bridge.mapping_routes as mr

    calls: list[tuple] = []

    def fake_execute_python(port, code, return_expression=None):
        calls.append((port, code, return_expression))
        return {"success": True, "executed": True, "return_value": [0.0153, 0.7108, 0.0]}

    monkeypatch.setattr(mr.houdini_mcp, "execute_python", fake_execute_python)

    c = _client(tmp_path)
    pid, serial = generate_project_serial(), generate_serial()
    _wire(pid, serial, node_path="/obj/geo1/tag1")
    get_state().registry.set_houdini_mcp(serial, stub.port)
    get_state().mappings.put_entry(pid, "t", _entry(serial, "transform1/t", type="vec3"))

    body = c.get(f"/api/projects/{pid}/mappings/t/value").json()
    assert body == {"ok": True, "value": [0.0153, 0.7108, 0.0]}
    assert len(calls) == 1
    assert _get_parameter_calls(stub) == []  # 全程没打过那条注定失败的调用


def test_route_vec3_value_falls_back_when_tuple_read_fails(tmp_path: Path, stub: _McpStub, monkeypatch) -> None:
    """_read_vec3_tuple 失败（抛异常）时退到逐分量兜底，且兜底仍拿到正确值。"""
    import bridge.mapping_routes as mr

    def raising_execute_python(port, code, return_expression=None):
        raise houdini_mcp.HoudiniMcpError("boom")

    monkeypatch.setattr(mr.houdini_mcp, "execute_python", raising_execute_python)

    c = _client(tmp_path)
    pid, serial = generate_project_serial(), generate_serial()
    _wire(pid, serial, node_path="/obj/geo1/tag1")
    get_state().registry.set_houdini_mcp(serial, stub.port)
    get_state().mappings.put_entry(pid, "t", _entry(serial, "transform1/t", type="vec3"))
    stub.values["/obj/geo1/transform1/tx"] = 1.5
    stub.values["/obj/geo1/transform1/ty"] = 2.5
    stub.values["/obj/geo1/transform1/tz"] = 3.5

    body = c.get(f"/api/projects/{pid}/mappings/t/value").json()
    assert body == {"ok": True, "value": [1.5, 2.5, 3.5]}
    assert len(_get_parameter_calls(stub)) == 3  # tx/ty/tz 逐分量兜底


def test_read_vec3_tuple_rejects_malformed_shape(monkeypatch) -> None:
    """畸形元组结果（长度不对 / 含非数字）一律 None，绝不裁剪/凑数出一个假 vec3。"""
    import bridge.mapping_routes as mr

    bad_shapes = [
        [1.0, 2.0],                 # 只有 2 个分量
        [1.0, "x", 3.0],            # 含字符串
        [1.0, 2.0, 3.0, 4.0],       # 4 个分量
        [1.0, True, 3.0],           # bool 混进数字里也拒
        None,                       # parmTuple 本身查不到
    ]
    for rv in bad_shapes:
        monkeypatch.setattr(
            mr.houdini_mcp, "execute_python",
            lambda *a, rv=rv, **k: {"success": True, "executed": True, "return_value": rv},
        )
        result = asyncio.run(mr._read_vec3_tuple(8100, "/obj/geo1", "t"))
        assert result is None, f"malformed return_value {rv!r} must not produce a vec3, got {result!r}"


def test_route_float_value_unchanged_uses_get_parameter(tmp_path: Path, stub: _McpStub, monkeypatch) -> None:
    """非 vec3 行为完全不变：仍是一次 parameters.get_parameter，绝不碰 vec3 读取路径。"""
    import bridge.mapping_routes as mr

    def must_not_run(*a, **k):
        raise AssertionError("vec3 读取路径不该在 float 上被调用")

    monkeypatch.setattr(mr, "_read_vec3_tuple", must_not_run)
    monkeypatch.setattr(mr, "_read_vec3_components", must_not_run)

    c = _client(tmp_path)
    pid, serial = generate_project_serial(), generate_serial()
    _wire(pid, serial, node_path="/obj/geo1/tag1")
    get_state().registry.set_houdini_mcp(serial, stub.port)
    get_state().mappings.put_entry(pid, "tx", _entry(serial, "transform1/tx", type="float"))
    stub.values["/obj/geo1/transform1/tx"] = 9.25

    body = c.get(f"/api/projects/{pid}/mappings/tx/value").json()
    assert body == {"ok": True, "value": 9.25}
    assert len(_get_parameter_calls(stub)) == 1
