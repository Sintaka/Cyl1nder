"""TraceStore + /api/trace 路由 + 埋点烟囱测试（见 devlog/tag-hda-plan.md P3）。

TraceStore 单测照 test_channels.py 纯单元风格；路由测试照裸 FastAPI 挂
trace_router（main.py 由主进程挂载）；埋点烟囱测试用 TestClient(create_app())
以最小可行方式验证（cmd 埋点不依赖真实 MCP：_resolve_port 打桩为 0）。
"""
from __future__ import annotations

import threading
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from bridge.main import create_app
from bridge.protocol import generate_serial
from bridge.state import get_state, reset_state
from bridge.trace import TraceStore
from bridge.trace_routes import router as trace_router


# --- TraceStore 单元测试 ------------------------------------------------------


def test_add_fields() -> None:
    st = TraceStore()
    ev = st.add(
        actor="hda-cook",
        action="inputs-push",
        channel="C1-aaaaaaaa-0000",
        target="inputs",
        digest="1 inputs, 3 pts, 1 prims",
    )
    assert ev["ts"] > 0
    assert ev["project"] == ""  # v1 不逐事件解析项目
    assert ev["channel"] == "C1-aaaaaaaa-0000"
    assert ev["actor"] == "hda-cook"
    assert ev["action"] == "inputs-push"
    assert ev["target"] == "inputs"
    assert ev["digest"] == "1 inputs, 3 pts, 1 prims"
    assert st.count() == 1


def test_ring_capacity_drops_oldest() -> None:
    st = TraceStore(capacity=5)
    for i in range(7):
        st.add(actor="a", action=f"act{i}", channel=str(i))
        time.sleep(0.01)  # 区分 ts，保证新→旧排序可断言
    assert st.count() == 5
    events = st.list(limit=1000)
    # 环形覆盖最旧：0/1 被挤掉，剩余按新→旧
    assert [e["channel"] for e in events] == ["6", "5", "4", "3", "2"]


def test_list_newest_first() -> None:
    st = TraceStore()
    for i in range(3):
        st.add(actor="a", action="x", channel=str(i))
        time.sleep(0.01)
    assert [e["channel"] for e in st.list()] == ["2", "1", "0"]


def test_list_filters() -> None:
    st = TraceStore()
    st.add(actor="hda-cook", action="inputs-push", channel="C1-a", target="inputs", digest="d1")
    st.add(actor="web-gizmo", action="outputs-edit", channel="C1-a", target="out[0]", digest="d2")
    st.add(actor="tag-hda", action="register", channel="C1-b", target="tag", digest="d3")
    assert len(st.list(actor="web-gizmo")) == 1
    assert len(st.list(action="register")) == 1
    assert len(st.list(channel="C1-a")) == 2
    assert len(st.list(target="out[0]")) == 1
    assert len(st.list(actor="nope")) == 0


def test_list_limit_clamp() -> None:
    st = TraceStore(capacity=2000)
    for i in range(1200):
        st.add(actor="a", action="x", channel=str(i))
    assert len(st.list()) == 200          # 默认 200
    assert len(st.list(limit=5000)) == 1000  # 钳到 1000
    assert len(st.list(limit=0)) == 1     # 钳到 1
    assert len(st.list(limit=-5)) == 1


def test_add_never_raises() -> None:
    """add 内部吞异常：锁获取失败也绝不 raise（trace 失败不影响主流程）。"""

    class _BoomLock:
        def __enter__(self):
            raise RuntimeError("boom")

        def __exit__(self, *a):
            return False

    st = TraceStore()
    st._lock = _BoomLock()
    ev = st.add(actor="a", action="x", channel="c", target="t", digest="d")
    assert ev["actor"] == "a" and ev["action"] == "x"
    st._lock = threading.Lock()
    assert st.count() == 0  # 写入失败但不 raise


# --- 路由测试（裸 FastAPI 挂 trace_router） ------------------------------------


def _trace_client(tmp_path: Path) -> TestClient:
    reset_state(tmp_path / "data")
    app = FastAPI()
    app.include_router(trace_router)
    return TestClient(app)


def test_trace_empty_filter_returns_all(tmp_path: Path) -> None:
    c = _trace_client(tmp_path)
    st = get_state()
    st.trace.add(actor="a1", action="x", channel="c1")
    st.trace.add(actor="a2", action="y", channel="c2")
    r = c.get("/api/trace")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    assert len(body["events"]) == 2


def test_trace_filter_params(tmp_path: Path) -> None:
    c = _trace_client(tmp_path)
    st = get_state()
    st.trace.add(actor="hda-cook", action="inputs-push", channel="C1-a", target="inputs", digest="d")
    st.trace.add(actor="web-gizmo", action="outputs-edit", channel="C1-a", target="out[0]", digest="d")
    st.trace.add(actor="tag-hda", action="register", channel="C1-b", target="tag", digest="d")
    assert c.get("/api/trace", params={"actor": "web-gizmo"}).json()["count"] == 1
    assert c.get("/api/trace", params={"action": "register"}).json()["count"] == 1
    assert c.get("/api/trace", params={"channel": "C1-a"}).json()["count"] == 2
    assert c.get("/api/trace", params={"target": "out[0]"}).json()["count"] == 1
    assert c.get("/api/trace", params={"actor": "nope"}).json()["count"] == 0


def test_trace_limit_and_count_semantics(tmp_path: Path) -> None:
    c = _trace_client(tmp_path)
    st = get_state()
    for i in range(5):
        st.trace.add(actor="a", action="x", channel=f"c{i}")
    r = c.get("/api/trace", params={"limit": 2})
    body = r.json()
    assert len(body["events"]) == 2
    assert body["count"] == 5  # count 是过滤后总数，不受 limit 截断
    # limit 钳 1..1000
    assert len(c.get("/api/trace", params={"limit": 0}).json()["events"]) == 1
    assert len(c.get("/api/trace", params={"limit": 5000}).json()["events"]) == 5


def test_trace_project_filter_tag_serial(tmp_path: Path) -> None:
    """项目含 tag 成员：channel=serial 的事件命中，无关 serial 排除。"""
    c = _trace_client(tmp_path)
    st = get_state()
    s_in = generate_serial()
    s_out = generate_serial()
    st.trace.add(actor="hda-cook", action="inputs-push", channel=s_in, target="inputs", digest="d1")
    st.trace.add(actor="tag-hda", action="register", channel=s_in, target="tag", digest="d2")
    st.trace.add(actor="web-gizmo", action="outputs-edit", channel=s_out, target="out[0]", digest="d3")
    proj = st.projects.create(label="Demo")
    st.projects.add_member(
        proj["projectSerial"],
        {"kind": "tag", "serial": s_in, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""},
    )
    body = c.get("/api/trace", params={"project": proj["projectSerial"]}).json()
    assert body["count"] == 2
    assert {e["channel"] for e in body["events"]} == {s_in}


def test_trace_project_filter_param_absolute_path(tmp_path: Path) -> None:
    """项目含 param + tag 成员：channel=absolutePath 与 channel=serial 的事件都命中。"""
    c = _trace_client(tmp_path)
    st = get_state()
    s = generate_serial()
    abs_path = "/obj/geo1/transform1/tx"
    st.trace.add(actor="tag-hda", action="register", channel=abs_path, target="param", digest="tx")
    st.trace.add(actor="hda-cook", action="inputs-push", channel=s, target="inputs", digest="d")
    proj = st.projects.create(label="Demo")
    st.projects.add_member(
        proj["projectSerial"],
        {"kind": "param", "serial": s, "nodePath": "/obj/geo1/tag1", "absolutePath": abs_path, "hip": "", "label": ""},
    )
    st.projects.add_member(
        proj["projectSerial"],
        {"kind": "tag", "serial": s, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""},
    )
    body = c.get("/api/trace", params={"project": proj["projectSerial"]}).json()
    assert body["count"] == 2
    assert {e["channel"] for e in body["events"]} == {abs_path, s}


def test_trace_project_nonexistent_or_invalid_empty(tmp_path: Path) -> None:
    c = _trace_client(tmp_path)
    st = get_state()
    st.trace.add(actor="a", action="x", channel="c")
    # 格式合法但项目不存在 -> 空
    r1 = c.get("/api/trace", params={"project": "P1-aaaaaaaa-0000"})
    assert r1.json() == {"events": [], "count": 0}
    # 格式非法 -> 空
    r2 = c.get("/api/trace", params={"project": "zzz"})
    assert r2.json() == {"events": [], "count": 0}


# --- 埋点烟囱测试（TestClient(create_app())） ----------------------------------


def _app_client(tmp_path: Path) -> TestClient:
    reset_state(tmp_path / "data")
    return TestClient(create_app())


def test_smoke_put_inputs_traces_inputs_push(tmp_path: Path) -> None:
    c = _app_client(tmp_path)
    serial = generate_serial()
    r = c.put(
        f"/api/hda/{serial}/inputs",
        json={
            "inputs": [
                {
                    "index": 0,
                    "name": "in0",
                    "pointCount": 3,
                    "primCount": 1,
                    "points": [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
                    "curves": [{"pointIndices": [0, 1, 2]}],
                }
            ],
            "hip": "D:/x.hip",
            "nodePath": "/obj/geo1",
            "label": "",
        },
    )
    assert r.status_code == 200
    events = get_state().trace.list(actor="hda-cook", action="inputs-push")
    assert len(events) == 1
    ev = events[0]
    assert ev["channel"] == serial
    assert ev["target"] == "inputs"
    assert "inputs" in ev["digest"] and "pts" in ev["digest"] and "prims" in ev["digest"]


def test_smoke_put_channels_traces_register(tmp_path: Path) -> None:
    c = _app_client(tmp_path)
    serial = generate_serial()
    ref = {"kind": "tag", "serial": serial, "nodePath": "/obj/geo1/tag1", "hip": "D:/x.hip", "label": "Tag"}
    r = c.put(f"/api/channels/{serial}", json=ref)
    assert r.status_code == 200
    events = get_state().trace.list(actor="tag-hda", action="register")
    assert len(events) == 1
    ev = events[0]
    assert ev["channel"] == serial
    assert ev["target"] == "tag"
    assert ev["digest"] == "Tag"


def test_smoke_heartbeat_traces(tmp_path: Path) -> None:
    c = _app_client(tmp_path)
    serial = generate_serial()
    r = c.post(
        f"/api/hda/{serial}/channels/heartbeat",
        json={"serial": serial, "nodePath": "/obj/geo1/tag1", "upstreamNodePath": "", "fingerprint": "abc"},
    )
    assert r.status_code == 200
    events = get_state().trace.list(actor="tag-hda", action="heartbeat")
    assert len(events) == 1
    ev = events[0]
    assert ev["channel"] == serial
    assert ev["target"] == "/obj/geo1/tag1"
    assert ev["digest"] == "abc"


def test_smoke_cmd_traces_param_set(tmp_path: Path, monkeypatch) -> None:
    """cmd 埋点：白名单通过即记录（_resolve_port 打桩为 0，不发真实 MCP 请求）。"""
    import bridge.houdini_routes as hr

    monkeypatch.setattr(hr, "_resolve_port", lambda serial: 0)
    c = _app_client(tmp_path)
    serial = generate_serial()
    r = c.post(
        f"/api/hda/{serial}/houdini/cmd",
        json={
            "command": "parameters.set_parameter",
            "params": {"node_path": "/obj/geo1/transform1", "parm_name": "tx", "value": 1.5},
        },
    )
    assert r.status_code == 200
    assert r.json()["ok"] is False  # port 不可达；埋点在白名单通过后已记录
    events = get_state().trace.list(actor="runtime-python", action="param-set")
    assert len(events) == 1
    ev = events[0]
    assert ev["channel"] == serial
    assert ev["target"] == "/obj/geo1/transform1/tx"
    assert ev["digest"] == "value=1.5"


def test_smoke_cmd_other_namespace_traces_command(tmp_path: Path, monkeypatch) -> None:
    import bridge.houdini_routes as hr

    monkeypatch.setattr(hr, "_resolve_port", lambda serial: 0)
    c = _app_client(tmp_path)
    serial = generate_serial()
    r = c.post(
        f"/api/hda/{serial}/houdini/cmd",
        json={"command": "nodes.get_node_info", "params": {"node_path": "/obj/geo1"}},
    )
    assert r.status_code == 200
    events = get_state().trace.list(actor="runtime-python", action="nodes.get_node_info")
    assert len(events) == 1
    assert events[0]["target"] == "/obj/geo1"


def test_smoke_ws_edit_traces_outputs_edit(tmp_path: Path) -> None:
    c = _app_client(tmp_path)
    serial = generate_serial()
    with c.websocket_connect(f"/ws?serial={serial}") as ws:
        ws.receive_json()  # hello
        ws.send_json({"type": "edit", "outputs": [{"index": 0, "rev": 0, "points": [[0, 0, 0], [1, 1, 1]]}]})
    events = get_state().trace.list(actor="web-gizmo", action="outputs-edit")
    assert len(events) == 1
    ev = events[0]
    assert ev["channel"] == serial
    assert ev["target"] == "out[0]"
    assert "rev=" in ev["digest"]
