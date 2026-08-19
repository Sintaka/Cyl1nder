import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from bridge.main import create_app
from bridge.protocol import generate_serial, is_valid_serial
from bridge.registry import RegistryError, SerialRegistry
from bridge.state import get_state, reset_state


def test_generate_serial_valid() -> None:
    for _ in range(100):
        s = generate_serial()
        assert is_valid_serial(s)
        assert s.startswith("C1-")


def test_register_created_at_immutable(tmp_path: Path) -> None:
    reg = SerialRegistry(tmp_path / "registry.json")
    s = generate_serial()
    r1 = reg.register(s, hip="a.hip", nodePath="/obj/geo1/cyl1nder1", label="Cyl1nder")
    time.sleep(0.01)
    r2 = reg.register(s, hip="a.hip", nodePath="/obj/geo1/cyl1nder1", label="Cyl1nder")
    assert r2.createdAt == r1.createdAt
    assert r2.lastSeen >= r1.lastSeen
    assert r2.nodePath == r1.nodePath


def test_register_updates_identity_on_recontact(tmp_path: Path) -> None:
    reg = SerialRegistry(tmp_path / "registry.json")
    s = generate_serial()
    reg.register(s, nodePath="/obj/old")
    r2 = reg.register(s, nodePath="/obj/new")
    assert r2.nodePath == "/obj/new"
    assert len(reg.serials()) == 1


def test_invalid_serial_raises(tmp_path: Path) -> None:
    reg = SerialRegistry(tmp_path / "registry.json")
    with pytest.raises(RegistryError):
        reg.register("not-a-serial")
    with pytest.raises(RegistryError):
        reg.register("C1-xx-yy")


def test_persistence(tmp_path: Path) -> None:
    path = tmp_path / "registry.json"
    reg = SerialRegistry(path)
    s = generate_serial()
    reg.register(s, nodePath="/obj/x", label="Cyl1nder")
    reg2 = SerialRegistry(path)
    rec = reg2.get(s)
    assert rec is not None
    assert rec.nodePath == "/obj/x"
    assert rec.label == "Cyl1nder"


def test_touch_auto_registers_valid_serial(tmp_path: Path) -> None:
    """Heartbeat touch re-registers a valid serial after a bridge restart
    (registration otherwise only happens via push_inputs on cook)."""
    reg = SerialRegistry(tmp_path / "registry.json")
    s = generate_serial()
    assert reg.get(s) is None
    reg.touch(s)
    rec = reg.get(s)
    assert rec is not None and rec.lastSeen > 0
    assert s in reg.serials()
    # persisted: a fresh registry instance over the same file sees it
    reg2 = SerialRegistry(tmp_path / "registry.json")
    assert reg2.get(s) is not None


def test_touch_ignores_invalid_serial(tmp_path: Path) -> None:
    reg = SerialRegistry(tmp_path / "registry.json")
    reg.touch("not-a-serial")
    assert len(reg.serials()) == 0


def test_mark_activity_auto_registers(tmp_path: Path) -> None:
    reg = SerialRegistry(tmp_path / "registry.json")
    s = generate_serial()
    reg.mark_activity(s)
    rec = reg.get(s)
    assert rec is not None and rec.lastActivity > 0


def _read_records(path: Path) -> list[dict]:
    import json
    return json.loads(path.read_text(encoding="utf-8"))



class _FakeClock:
    """Deterministic clock for the save-debounce test (avoids real-time flakiness)."""
    def __init__(self) -> None:
        self.t = 1000.0

    def now(self) -> float:
        return self.t


def test_save_debounced_touch_and_mark_activity(tmp_path: Path) -> None:
    """Rapid touch/mark_activity must not write registry.json every call (sync disk
    I/O at 60Hz blocked the event loop); the file only changes once per second."""
    path = tmp_path / "registry.json"
    clock = _FakeClock()
    reg = SerialRegistry(path, clock=clock.now)
    s = generate_serial()
    reg.register(s, nodePath="/obj/x")  # register saves immediately
    assert path.exists()
    on_disk = _read_records(path)  # lastSeen snapshot as of register()
    before = reg.get(s).lastSeen
    for _ in range(30):
        reg.touch(s)
        reg.mark_activity(s)
        time.sleep(0.02)  # lastSeen 用真实时钟：确保跨越一个时钟 tick（时间分辨率 flake 修复）
    # in-memory state still updates ...
    assert reg.get(s).lastSeen > before
    # ... but the file is untouched inside the debounce window (no disk write)
    assert _read_records(path) == on_disk
    # after the window a touch persists (single write -> lastSeen moves on disk)
    clock.t += 1.1
    reg.touch(s)
    assert _read_records(path) != on_disk
    reg2 = SerialRegistry(path)
    assert reg2.get(s) is not None and reg2.get(s).lastSeen >= reg.get(s).lastSeen


def test_register_saves_immediately_after_debounced_touch(tmp_path: Path) -> None:
    """register() is persistence-critical: it writes even right after a debounced touch."""
    path = tmp_path / "registry.json"
    reg = SerialRegistry(path)
    s1 = generate_serial()
    reg.touch(s1)  # first heartbeat auto-registers + saves
    assert path.exists()
    on_disk = _read_records(path)
    reg.touch(s1)  # within the debounce window -> no write
    assert _read_records(path) == on_disk
    s2 = generate_serial()
    reg.register(s2, nodePath="/obj/new")  # must persist immediately
    assert len(_read_records(path)) == len(on_disk) + 1
    reg2 = SerialRegistry(path)
    assert reg2.get(s2) is not None


# --- put /inputs 项目重建（用户需求 #3：hda cook 时发现项目被删了，按 hip 快速重建空场景） ---
#
# 挂载点在 routes.put_inputs：这是唯一能同时确认「这个 serial 还活着」和「它属于
# 哪个 hip」的地方（HDA 自报的 hip 就在这次推送的 payload 里）。用裸 create_app()
# 走完整应用（而非只挂 rest_router），因为 put_inputs 内部按名 import 了
# project_routes.bind_serial_to_hip，走的是真实 st.projects 单例。


def _client(tmp_path: Path) -> TestClient:
    reset_state(tmp_path / "data")
    return TestClient(create_app())


def test_inputs_push_creates_project_for_hip(tmp_path: Path) -> None:
    c = _client(tmp_path)
    s = generate_serial()
    hip = "D:/proj/scene.hip"
    r = c.put(f"/api/hda/{s}/inputs", json={"inputs": [], "hip": hip})
    assert r.status_code == 200
    project = get_state().projects.find_by_hip(hip)
    assert project is not None
    assert project["label"] == ""  # 空 label，UI 按 hipName 显示——不往 label 塞 hip 名
    assert project["hipName"] == "scene.hip"
    assert [m.get("serial") for m in project["members"]] == [s]


def test_inputs_push_after_project_deleted_recreates_it(tmp_path: Path) -> None:
    """用户需求的原话场景：项目被删了 -> 下一次 cook 推 inputs 立即重建。"""
    c = _client(tmp_path)
    s = generate_serial()
    hip = "D:/proj/scene.hip"
    c.put(f"/api/hda/{s}/inputs", json={"inputs": [], "hip": hip})
    st = get_state()
    old = st.projects.find_by_hip(hip)
    assert old is not None
    assert st.projects.delete(old["projectSerial"]) is True
    assert st.projects.find_by_hip(hip) is None  # 确认真的没了

    r = c.put(f"/api/hda/{s}/inputs", json={"inputs": [], "hip": hip})
    assert r.status_code == 200
    recreated = st.projects.find_by_hip(hip)
    assert recreated is not None
    assert recreated["projectSerial"] != old["projectSerial"]  # 新项目，不是同一条记录
    assert recreated["label"] == ""
    assert recreated["hipName"] == "scene.hip"
    assert [m.get("serial") for m in recreated["members"]] == [s]


def test_inputs_push_transient_hip_creates_no_project(tmp_path: Path) -> None:
    """崩溃恢复 / untitled 不建项目：is_transient_hip 的判定必须复用，不重新实现。"""
    c = _client(tmp_path)
    for hip in ("untitled.hip", "D:/proj/foo_recovered.hip", ""):
        s = generate_serial()
        r = c.put(f"/api/hda/{s}/inputs", json={"inputs": [], "hip": hip})
        assert r.status_code == 200
    assert get_state().projects.list() == []


def test_inputs_push_two_serials_same_hip_share_one_project(tmp_path: Path) -> None:
    """同一 hip 下两个 HDA 落进同一个项目，不各建一个（v0.1.00116 修的老毛病）。"""
    c = _client(tmp_path)
    hip = "D:/proj/shared.hip"
    s1 = generate_serial()
    s2 = generate_serial()
    c.put(f"/api/hda/{s1}/inputs", json={"inputs": [], "hip": hip})
    c.put(f"/api/hda/{s2}/inputs", json={"inputs": [], "hip": hip})
    projects = [p for p in get_state().projects.list() if p.get("hip") == hip]
    assert len(projects) == 1
    assert {m.get("serial") for m in projects[0]["members"]} == {s1, s2}


def test_inputs_push_repeated_is_idempotent(tmp_path: Path) -> None:
    """重复 cook 推送不重复建项目、不重复加成员（稳态热路径：find_by_hip 命中即返回）。"""
    c = _client(tmp_path)
    s = generate_serial()
    hip = "D:/proj/repeat.hip"
    for _ in range(5):
        r = c.put(f"/api/hda/{s}/inputs", json={"inputs": [], "hip": hip})
        assert r.status_code == 200
    projects = [p for p in get_state().projects.list() if p.get("hip") == hip]
    assert len(projects) == 1
    assert len(projects[0]["members"]) == 1


