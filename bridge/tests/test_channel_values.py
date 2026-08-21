"""channel-values 端点 + 心跳 values 捎带测试（见 devlog/tag-hda-plan.md P5a）。

照 test_houdini_mcp.py 的 stub 模式：本地 http.server 仿 parameters.get_parameter /
set_parameter（get 回 {"status":"success","data":{"value":<记入的 parm 值>}}、set 记录
body 并回 success）；路由测试挂裸 FastAPI（houdini_router + channel_router）。
WS 广播在无 WS 连接场景下难以断言，heartbeat 测试用 monkeypatch 假 manager 记录广播
（不建真实 WS），同时验证 trace digest 仍为 fingerprint。
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
from bridge.houdini_routes import router as houdini_router
from bridge.protocol import generate_serial
from bridge.state import get_state, reset_state


# --- fxhoudinimcp stub（parameters.get_parameter / set_parameter）-------------


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
        self.parm_values: dict[str, object] = {}    # absolutePath -> 当前值
        self.get_calls: list[tuple[str, str]] = []  # (node_path, parm_name)
        self.set_calls: list[dict] = []             # {"node_path","parm_name","value"}
        self.fail_get: set[str] = set()             # get 回 error 信封的 absolutePath
        self.raw_data_get: dict[str, object] = {}   # absolutePath -> data 非 dict 直给
        self.fail_set: set[str] = set()             # set 回 error 信封的 absolutePath
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
            if command == "parameters.get_parameter":
                return self._get_parameter(params, rid)
            if command == "parameters.set_parameter":
                return self._set_parameter(params, rid)
            return {"status": "error", "error": {"code": 404, "message": f"no such command {command}"}, "request_id": rid}
        return {"status": "error", "error": {"code": "unknown", "message": f"unknown command {cmd!r}"}}

    def _get_parameter(self, params: dict, rid: str) -> dict:
        node = str(params.get("node_path", ""))
        parm = str(params.get("parm_name", ""))
        self.get_calls.append((node, parm))
        key = f"{node}/{parm}"
        if key in self.fail_get:
            return {"status": "error", "error": {"code": 1, "message": "boom"}, "request_id": rid}
        if key in self.raw_data_get:
            return {"status": "success", "data": self.raw_data_get[key], "request_id": rid}
        return {"status": "success", "data": {"value": self.parm_values.get(key)}, "request_id": rid}

    def _set_parameter(self, params: dict, rid: str) -> dict:
        self.set_calls.append(dict(params))
        key = f"{params.get('node_path', '')}/{params.get('parm_name', '')}"
        if key in self.fail_set:
            return {"status": "error", "error": {"code": 1, "message": "boom"}, "request_id": rid}
        self.parm_values[key] = params.get("value")
        return {"status": "success", "data": {"ok": True}, "request_id": rid}


@pytest.fixture
def stub() -> _McpStub:
    s = _McpStub()
    s.start()
    yield s
    s.stop()


# --- 工具 ---------------------------------------------------------------------


def _clear_cv_state() -> None:
    """清空 houdini_routes 的 channel-values 模块级状态（含残留 timer/flight）。"""
    import bridge.houdini_routes as hr

    with hr._LOCK:
        hr._CHANNEL_VALUES_CACHE.clear()
        hr._CV_PENDING.clear()
        hr._CV_LAST.clear()
        hr._CV_FLIGHT.clear()
        hr._CV_TIMERS.clear()


def _client(tmp_path: Path) -> TestClient:
    reset_state(tmp_path / "data")
    _clear_cv_state()
    app = FastAPI()
    app.include_router(houdini_router)
    app.include_router(channel_router)
    return TestClient(app)


def _register_param(serial: str, *paths: str) -> None:
    st = get_state()
    for p in paths:
        st.channels.register(
            {"kind": "param", "serial": serial, "nodePath": "/obj/geo1/tag1", "absolutePath": p, "hip": "", "label": ""}
        )


def _stub_port(serial: str, stub: _McpStub) -> None:
    st = get_state()
    st.registry.register(serial, hip="D:/x.hip")
    st.registry.set_houdini_mcp(serial, stub.port)


def _register_vec3_param(serial: str, absolute_path: str) -> None:
    """注册一个 type="vec3" 的 param 通道行（照 _register_param，多带 type 字段）。"""
    get_state().channels.register(
        {
            "kind": "param",
            "serial": serial,
            "nodePath": "/obj/geo1/tag1",
            "absolutePath": absolute_path,
            "hip": "",
            "label": "",
            "type": "vec3",
        }
    )


# --- heartbeat values 捎带 ----------------------------------------------------


def test_heartbeat_values_broadcasts_no_crash(tmp_path: Path, monkeypatch) -> None:
    """心跳带 values：不崩、WS 广播 channel-values（不回写内存）、trace digest 仍 fingerprint。"""
    import bridge.channel_routes as cr

    class FakeManager:
        def __init__(self) -> None:
            self.msgs: list[tuple[str, dict]] = []

        async def broadcast(self, serial: str, message: dict) -> None:
            self.msgs.append((serial, message))

    fake = FakeManager()
    monkeypatch.setattr(cr, "manager", fake)
    c = _client(tmp_path)
    serial = generate_serial()
    st = get_state()
    st.channels.register({"kind": "tag", "serial": serial, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""})
    r = c.post(
        f"/api/hda/{serial}/channels/heartbeat",
        json={
            "serial": serial,
            "nodePath": "/obj/geo1/tag1",
            "upstreamNodePath": "",
            "fingerprint": "fp-123",
            "values": {"/obj/geo1/transform1/tx": 1.5},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["serial"] == serial and body["lastSeen"] > 0
    assert len(fake.msgs) == 1
    s, msg = fake.msgs[0]
    assert s == serial
    assert msg["type"] == "channel-values"
    assert msg["values"] == {"/obj/geo1/transform1/tx": 1.5}
    events = st.trace.list(actor="tag-hda", action="heartbeat")
    assert events and events[0]["digest"] == "fp-123"  # trace 仍 fingerprint


def test_heartbeat_without_values_no_broadcast(tmp_path: Path, monkeypatch) -> None:
    """心跳不带 values（旧 HDA 兼容）：行为不变，无广播。"""
    import bridge.channel_routes as cr

    class FakeManager:
        def __init__(self) -> None:
            self.msgs: list[tuple[str, dict]] = []

        async def broadcast(self, serial: str, message: dict) -> None:
            self.msgs.append((serial, message))

    fake = FakeManager()
    monkeypatch.setattr(cr, "manager", fake)
    c = _client(tmp_path)
    serial = generate_serial()
    r = c.post(
        f"/api/hda/{serial}/channels/heartbeat",
        json={"serial": serial, "nodePath": "/obj/geo1/tag1", "upstreamNodePath": "", "fingerprint": "fp"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert fake.msgs == []


# --- GET /channel-values ------------------------------------------------------


def test_get_channel_values_ok(tmp_path: Path, stub: _McpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    _stub_port(serial, stub)
    _register_param(serial, "/obj/geo1/transform1/tx", "/obj/geo1/transform1/ty")
    stub.parm_values["/obj/geo1/transform1/tx"] = 1.5
    stub.parm_values["/obj/geo1/transform1/ty"] = -2.0
    r = c.get(f"/api/hda/{serial}/channel-values")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["values"] == {"/obj/geo1/transform1/tx": 1.5, "/obj/geo1/transform1/ty": -2.0}


def test_get_channel_values_cache_hit(tmp_path: Path, stub: _McpStub) -> None:
    """0.25s 缓存窗口内第二次 GET 直接命中：stub 计数不变、返回缓存旧值。"""
    c = _client(tmp_path)
    serial = generate_serial()
    _stub_port(serial, stub)
    _register_param(serial, "/obj/geo1/transform1/tx")
    stub.parm_values["/obj/geo1/transform1/tx"] = 1.0
    r1 = c.get(f"/api/hda/{serial}/channel-values").json()
    assert r1["values"]["/obj/geo1/transform1/tx"] == 1.0
    calls = len(stub.get_calls)
    stub.parm_values["/obj/geo1/transform1/tx"] = 99.0
    r2 = c.get(f"/api/hda/{serial}/channel-values").json()
    assert r2["values"]["/obj/geo1/transform1/tx"] == 1.0  # 缓存旧值
    assert len(stub.get_calls) == calls  # 未触 stub


def test_get_channel_values_no_param_channels(tmp_path: Path) -> None:
    """无该 serial 的 param 通道（含其他 serial 的）→ {"ok": True, "values": {}}。"""
    c = _client(tmp_path)
    serial = generate_serial()
    _register_param(generate_serial(), "/obj/geo1/transform1/tx")
    body = c.get(f"/api/hda/{serial}/channel-values").json()
    assert body == {"ok": True, "values": {}}


def test_get_channel_values_no_port(tmp_path: Path, monkeypatch) -> None:
    """无端口：{"ok": False, "error": "houdini mcp not reachable"}（照 test_probe_no_port）。"""
    monkeypatch.setattr(houdini_mcp, "discover_by_hip", lambda *a, **k: None)
    monkeypatch.setattr(houdini_mcp, "discover_first", lambda *a, **k: None)
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial, hip="")
    _register_param(serial, "/obj/geo1/transform1/tx")
    body = c.get(f"/api/hda/{serial}/channel-values").json()
    assert body["ok"] is False
    assert body["error"] == "houdini mcp not reachable"


def test_get_channel_values_tolerant_extraction(tmp_path: Path, stub: _McpStub) -> None:
    """值提取宽容：data 非 dict -> 取 data 本身；信封 error -> 跳过该通道，均不崩。"""
    c = _client(tmp_path)
    serial = generate_serial()
    _stub_port(serial, stub)
    _register_param(serial, "/obj/geo1/transform1/tx", "/obj/geo1/transform1/ty", "/obj/geo1/transform1/tz")
    stub.parm_values["/obj/geo1/transform1/tx"] = 1.0
    stub.raw_data_get["/obj/geo1/transform1/ty"] = "not-a-dict"
    stub.fail_get.add("/obj/geo1/transform1/tz")
    body = c.get(f"/api/hda/{serial}/channel-values").json()
    assert body["ok"] is True
    assert body["values"]["/obj/geo1/transform1/tx"] == 1.0
    assert body["values"]["/obj/geo1/transform1/ty"] == "not-a-dict"  # data 本身
    assert "/obj/geo1/transform1/tz" not in body["values"]  # error 通道跳过


# --- GET /channel-values：vec3 通道（本次修复）--------------------------------


def test_get_channel_values_vec3_skips_get_parameter(tmp_path: Path, stub: _McpStub, monkeypatch) -> None:
    """vec3 通道走 read_vec3_tuple 拿到值；parameters.get_parameter 一次都不该被调 ——
    那条调用对元组参数恒失败（`parm("t")` 是 None），发出去就是纯浪费的一次往返，
    这正是本次修复要去掉的浪费。"""
    calls: list[tuple] = []

    def fake_execute_python(port, code, return_expression=None):
        calls.append((port, code, return_expression))
        return {"success": True, "executed": True, "return_value": [1.0, 2.0, 3.0]}

    monkeypatch.setattr(houdini_mcp, "execute_python", fake_execute_python)

    c = _client(tmp_path)
    serial = generate_serial()
    _stub_port(serial, stub)
    _register_vec3_param(serial, "/obj/geo1/transform1/t")

    body = c.get(f"/api/hda/{serial}/channel-values").json()
    assert body["ok"] is True
    assert body["values"] == {"/obj/geo1/transform1/t": [1.0, 2.0, 3.0]}
    assert len(calls) == 1
    assert stub.get_calls == []  # parameters.get_parameter 从未被打到 stub


def test_get_channel_values_vec3_malformed_shape_omitted(tmp_path: Path, stub: _McpStub, monkeypatch) -> None:
    """元组读回的形状不对（只有 2 个分量）-> 该通道整个从 values 消失，绝不插 null
    或拿 2 个分量凑一个假 vec3（凑出的位姿比读不到更坏）。"""
    def bad_execute_python(port, code, return_expression=None):
        return {"success": True, "executed": True, "return_value": [1.0, 2.0]}

    monkeypatch.setattr(houdini_mcp, "execute_python", bad_execute_python)

    c = _client(tmp_path)
    serial = generate_serial()
    _stub_port(serial, stub)
    _register_vec3_param(serial, "/obj/geo1/transform1/t")

    body = c.get(f"/api/hda/{serial}/channel-values").json()
    assert body["ok"] is True
    assert "/obj/geo1/transform1/t" not in body["values"]
    assert body["values"] == {}  # 没有任何 null/占位/凑数值
    assert stub.get_calls == []


def test_get_channel_values_vec3_execute_python_raises_omitted(tmp_path: Path, stub: _McpStub, monkeypatch) -> None:
    """execute_python 直接抛异常（连不上/解析失败）：该 vec3 通道同样缺席，不崩、不进 values。"""
    def raising_execute_python(port, code, return_expression=None):
        raise houdini_mcp.HoudiniMcpError("boom")

    monkeypatch.setattr(houdini_mcp, "execute_python", raising_execute_python)

    c = _client(tmp_path)
    serial = generate_serial()
    _stub_port(serial, stub)
    _register_vec3_param(serial, "/obj/geo1/transform1/t")

    body = c.get(f"/api/hda/{serial}/channel-values").json()
    assert body["ok"] is True
    assert body["values"] == {}


def test_get_channel_values_float_unchanged_uses_get_parameter(tmp_path: Path, stub: _McpStub) -> None:
    """非 vec3 行为完全不变：仍走一次 parameters.get_parameter（本次修复只改 vec3 分支）。"""
    c = _client(tmp_path)
    serial = generate_serial()
    _stub_port(serial, stub)
    _register_param(serial, "/obj/geo1/transform1/tx")
    stub.parm_values["/obj/geo1/transform1/tx"] = 2.5

    body = c.get(f"/api/hda/{serial}/channel-values").json()
    assert body["ok"] is True
    assert body["values"] == {"/obj/geo1/transform1/tx": 2.5}
    assert stub.get_calls == [("/obj/geo1/transform1", "tx")]


def test_get_channel_values_mixed_float_and_vec3(tmp_path: Path, stub: _McpStub, monkeypatch) -> None:
    """混合批次：一个 float + 一个 vec3，一次响应里两者都要出现，各走各的路径。"""
    def fake_execute_python(port, code, return_expression=None):
        return {"success": True, "executed": True, "return_value": [4.0, 5.0, 6.0]}

    monkeypatch.setattr(houdini_mcp, "execute_python", fake_execute_python)

    c = _client(tmp_path)
    serial = generate_serial()
    _stub_port(serial, stub)
    _register_param(serial, "/obj/geo1/transform1/tx")
    _register_vec3_param(serial, "/obj/geo1/transform1/t")
    stub.parm_values["/obj/geo1/transform1/tx"] = 1.5

    body = c.get(f"/api/hda/{serial}/channel-values").json()
    assert body["ok"] is True
    assert body["values"] == {
        "/obj/geo1/transform1/tx": 1.5,
        "/obj/geo1/transform1/t": [4.0, 5.0, 6.0],
    }
    # float 通道仍打了 parameters.get_parameter；vec3 完全没碰这条调用
    assert stub.get_calls == [("/obj/geo1/transform1", "tx")]


# --- PUT /channel-values ------------------------------------------------------


def test_put_channel_values_sets_all(tmp_path: Path, stub: _McpStub) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    _stub_port(serial, stub)
    values = {"/obj/geo1/transform1/tx": 1.5, "/obj/geo1/transform1/ty": -2.0}
    r = c.put(f"/api/hda/{serial}/channel-values", json={"values": values})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and "throttled" not in body
    assert sorted(stub.set_calls, key=lambda d: d["parm_name"]) == [
        {"node_path": "/obj/geo1/transform1", "parm_name": "tx", "value": 1.5},
        {"node_path": "/obj/geo1/transform1", "parm_name": "ty", "value": -2.0},
    ]
    events = get_state().trace.list(actor="web-param", action="param-set")
    assert len(events) == 2
    by_target = {e["target"]: e for e in events}
    assert by_target["/obj/geo1/transform1/tx"]["digest"] == "1.5"
    assert by_target["/obj/geo1/transform1/ty"]["digest"] == "-2.0"


def test_put_channel_values_failure_traces_error(tmp_path: Path, stub: _McpStub) -> None:
    """单项 set 失败：记录 error、继续下一项，响应仍 ok:True；失败项 trace digest=error:..."""
    c = _client(tmp_path)
    serial = generate_serial()
    _stub_port(serial, stub)
    stub.fail_set.add("/obj/geo1/transform1/tz")
    r = c.put(
        f"/api/hda/{serial}/channel-values",
        json={"values": {"/obj/geo1/transform1/tx": 1.0, "/obj/geo1/transform1/tz": 9.0}},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert len(stub.set_calls) == 2  # 失败项也调了，只是信封 error
    events = get_state().trace.list(actor="web-param", action="param-set")
    assert len(events) == 2
    by_target = {e["target"]: e for e in events}
    assert by_target["/obj/geo1/transform1/tx"]["digest"] == "1.0"
    assert by_target["/obj/geo1/transform1/tz"]["digest"].startswith("error:")


def test_put_channel_values_no_port(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(houdini_mcp, "discover_by_hip", lambda *a, **k: None)
    monkeypatch.setattr(houdini_mcp, "discover_first", lambda *a, **k: None)
    c = _client(tmp_path)
    serial = generate_serial()
    get_state().registry.register(serial, hip="")
    body = c.put(
        f"/api/hda/{serial}/channel-values", json={"values": {"/obj/geo1/transform1/tx": 1.0}}
    ).json()
    assert body["ok"] is False
    assert body["error"] == "houdini mcp not reachable"


def test_channel_values_invalid_serial_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    assert c.get("/api/hda/zzz/channel-values").status_code == 400
    assert c.put("/api/hda/zzz/channel-values", json={"values": {}}).status_code == 400


def test_put_channel_values_latest_wins_throttle(
    tmp_path: Path, stub: _McpStub, monkeypatch
) -> None:
    """窗口内背靠背 PUT：后续 throttled=True，窗口末 flush 只发 latest 整 dict（latest-wins）。"""
    import asyncio

    import bridge.houdini_routes as hr
    from httpx import ASGITransport, AsyncClient

    monkeypatch.setattr(hr, "_get_set_interval", lambda serial: 0.1)

    reset_state(tmp_path / "data")
    _clear_cv_state()
    app = FastAPI()
    app.include_router(houdini_router)
    transport = ASGITransport(app=app)

    serial = generate_serial()
    get_state().registry.register(serial, hip="")
    get_state().registry.set_houdini_mcp(serial, stub.port)

    async def scenario() -> None:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r1 = (await c.put(
                f"/api/hda/{serial}/channel-values", json={"values": {"/obj/geo1/transform1/tx": 1.0}}
            )).json()
            assert r1["ok"] is True and "throttled" not in r1
            assert stub.set_calls[-1]["value"] == 1.0

            r2 = (await c.put(
                f"/api/hda/{serial}/channel-values", json={"values": {"/obj/geo1/transform1/tx": 2.0}}
            )).json()
            assert r2["throttled"] is True  # 窗口内
            r3 = (await c.put(
                f"/api/hda/{serial}/channel-values", json={"values": {"/obj/geo1/transform1/tx": 3.0}}
            )).json()
            assert r3["throttled"] is True  # latest-wins：3 整 dict 替换 2
            assert stub.set_calls[-1]["value"] == 1.0  # 2/3 尚未发出

            # 窗口末 flush 只收 latest（3）；2 从未单独落 stub
            deadline = time.monotonic() + 2.0
            while stub.set_calls[-1]["value"] != 3.0 and time.monotonic() < deadline:
                await asyncio.sleep(0.02)
            assert stub.set_calls[-1]["value"] == 3.0
            assert all(sc["value"] != 2.0 for sc in stub.set_calls)

    asyncio.run(scenario())
