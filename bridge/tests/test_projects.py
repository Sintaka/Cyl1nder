"""吊牌 HDA 项目注册表 + 路由测试（见 devlog/tag-hda-plan.md P2a）。

ProjectRegistry 单测照 test_channels.py 纯单元风格；路由测试照
test_houdini_mcp.py 的裸 FastAPI 做法（create_app 尚未挂载 project_routes，
main.py 由主进程粘合）。reset_state 后 state.channels 与 state.projects
同数据目录共存。
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from bridge import snapshot
from bridge.project_routes import router as project_router
from bridge.projects import ProjectRegistry, hip_name_of
from bridge.protocol import generate_project_serial, generate_serial, is_valid_project_serial
from bridge.state import get_state, reset_state


# --- ProjectRegistry 单元测试 ------------------------------------------------


def test_generate_project_serial_valid() -> None:
    for _ in range(100):
        pid = generate_project_serial()
        assert is_valid_project_serial(pid)
        assert pid.startswith("P1-")


def test_create_fields(tmp_path: Path) -> None:
    reg = ProjectRegistry(tmp_path / "projects.json")
    p = reg.create(label="Demo")
    assert is_valid_project_serial(p["projectSerial"])
    assert p["label"] == "Demo"
    assert p["createdAt"] > 0
    assert p["updatedAt"] == p["createdAt"]
    assert p["members"] == []


def test_create_default_label(tmp_path: Path) -> None:
    reg = ProjectRegistry(tmp_path / "projects.json")
    assert reg.create()["label"] == ""


def test_get_and_list_sorted_by_created_at(tmp_path: Path) -> None:
    reg = ProjectRegistry(tmp_path / "projects.json")
    p1 = reg.create(label="a")
    time.sleep(0.01)
    p2 = reg.create(label="b")
    assert reg.get(p1["projectSerial"])["label"] == "a"
    assert reg.get("P1-missing-0000") is None
    assert [p["projectSerial"] for p in reg.list()] == [p1["projectSerial"], p2["projectSerial"]]


def test_add_member_replace_same_key(tmp_path: Path) -> None:
    reg = ProjectRegistry(tmp_path / "projects.json")
    p = reg.create(label="Demo")
    s = generate_serial()
    reg.add_member(p["projectSerial"], {"kind": "tag", "serial": s, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""})
    time.sleep(0.01)
    reg.add_member(p["projectSerial"], {"kind": "tag", "serial": s, "nodePath": "/obj/geo1/tag1b", "hip": "", "label": ""})
    p2 = reg.get(p["projectSerial"])
    assert p2 is not None
    assert len(p2["members"]) == 1
    assert p2["members"][0]["nodePath"] == "/obj/geo1/tag1b"
    assert p2["updatedAt"] > p["updatedAt"]


def test_add_member_appends_different_key(tmp_path: Path) -> None:
    reg = ProjectRegistry(tmp_path / "projects.json")
    p = reg.create(label="Demo")
    s = generate_serial()
    reg.add_member(p["projectSerial"], {"kind": "tag", "serial": s, "nodePath": "/obj/x", "hip": "", "label": ""})
    reg.add_member(
        p["projectSerial"],
        {"kind": "param", "serial": s, "nodePath": "/obj/x", "absolutePath": "/obj/geo1/transform1/tx", "hip": "", "label": ""},
    )
    p2 = reg.get(p["projectSerial"])
    assert p2 is not None
    assert len(p2["members"]) == 2


def test_add_member_missing_project(tmp_path: Path) -> None:
    reg = ProjectRegistry(tmp_path / "projects.json")
    assert reg.add_member("P1-missing-0000", {"kind": "tag", "serial": generate_serial(), "nodePath": "", "hip": "", "label": ""}) is None


def test_remove_member(tmp_path: Path) -> None:
    reg = ProjectRegistry(tmp_path / "projects.json")
    p = reg.create(label="Demo")
    s = generate_serial()
    reg.add_member(p["projectSerial"], {"kind": "tag", "serial": s, "nodePath": "/obj/x", "hip": "", "label": ""})
    before = reg.get(p["projectSerial"])["updatedAt"]
    time.sleep(0.01)
    assert reg.remove_member(p["projectSerial"], s) is True
    p2 = reg.get(p["projectSerial"])
    assert p2["members"] == []
    assert p2["updatedAt"] > before
    assert reg.remove_member(p["projectSerial"], s) is False  # 成员不存在
    assert reg.remove_member("P1-missing-0000", s) is False  # 项目不存在


def test_persistence(tmp_path: Path) -> None:
    path = tmp_path / "projects.json"
    reg = ProjectRegistry(path)
    p = reg.create(label="Demo")
    s = generate_serial()
    reg.add_member(p["projectSerial"], {"kind": "tag", "serial": s, "nodePath": "/obj/x", "hip": "", "label": ""})
    reg2 = ProjectRegistry(path)
    rec = reg2.get(p["projectSerial"])
    assert rec is not None
    assert rec["label"] == "Demo"
    assert rec["members"][0]["serial"] == s


def test_load_tolerates_corrupt_file(tmp_path: Path) -> None:
    path = tmp_path / "projects.json"
    path.write_text("{not json", encoding="utf-8")
    reg = ProjectRegistry(path)
    assert reg.list() == []


# --- 项目 = hip 文件（身份模型，v0.1.00116） ---------------------------------


def test_hip_name_of_both_separators() -> None:
    assert hip_name_of("D:/proj/scene.hip") == "scene.hip"
    assert hip_name_of("D:\\proj\\scene.hip") == "scene.hip"
    assert hip_name_of("scene.hip") == "scene.hip"
    assert hip_name_of("") == ""


def test_create_with_hip_derives_hip_name(tmp_path: Path) -> None:
    reg = ProjectRegistry(tmp_path / "projects.json")
    p = reg.create(hip="D:\\proj\\scene.hip")
    assert p["hip"] == "D:\\proj\\scene.hip"
    assert p["hipName"] == "scene.hip"
    assert p["migratedAt"] == 0.0
    assert p["previousHip"] == ""


def test_create_without_hip_still_works(tmp_path: Path) -> None:
    """向后兼容：旧调用方只传 label。"""
    reg = ProjectRegistry(tmp_path / "projects.json")
    p = reg.create("Demo")
    assert p["hip"] == "" and p["hipName"] == ""


def test_find_by_hip_normalises_case_and_slashes(tmp_path: Path) -> None:
    """同一个文件的不同写法必须归到**一个**项目。"""
    reg = ProjectRegistry(tmp_path / "projects.json")
    pid = reg.create(hip="D:/Proj/Scene.hip")["projectSerial"]
    for spelling in ("D:/Proj/Scene.hip", "D:\\Proj\\Scene.hip", "d:/proj/scene.hip", "D:\\proj\\SCENE.HIP"):
        found = reg.find_by_hip(spelling)
        assert found is not None, spelling
        assert found["projectSerial"] == pid, spelling


def test_find_by_hip_empty_never_matches(tmp_path: Path) -> None:
    """空 hip 不是身份：否则所有未绑定项目会被并成一个。"""
    reg = ProjectRegistry(tmp_path / "projects.json")
    reg.create(label="unbound")
    assert reg.find_by_hip("") is None
    assert reg.find_by_hip("D:/other.hip") is None


def test_ensure_for_hip_empty_hip_does_not_collapse(tmp_path: Path) -> None:
    """空 hip 不是身份：ensure_for_hip("") 不会命中已有未绑定项目（调用方本就该先判空，
    路由与心跳都在 hip 非空时才走这条路）。"""
    reg = ProjectRegistry(tmp_path / "projects.json")
    reg.create(label="unbound")
    p, created = reg.ensure_for_hip("")
    assert created is True
    assert p["hip"] == ""


def test_rebind_hip_is_idempotent_under_concurrency(tmp_path: Path) -> None:
    """并发 rebind 不得把新 hip 当成 previousHip（实测过的 check-then-act 竞态）。

    一个 hip 里有多个吊牌时，它们的心跳并发到达，两者都在任何一方提交前通过了
    调用方的「hip 不同」检查；第二次 rebind 于是读到已更新的 hip，
    把新 hip 记成 previousHip，审计线索丢失。实机现象：hip == previousHip。
    顺序调用抓不到，必须直接打第二次 rebind。
    """
    reg = ProjectRegistry(tmp_path / "projects.json")
    p = reg.create(label="", hip="D:/proj/beginTest-1.hip")
    pid = p["projectSerial"]

    first = reg.rebind_hip(pid, "D:/proj/beginTest-2.hip")
    assert first is not None
    assert first["previousHip"] == "D:/proj/beginTest-1.hip"
    migrated_at = first["migratedAt"]

    # 第二次同 hip：must be a no-op —— previousHip 与 migratedAt 都不许被改写
    again = reg.rebind_hip(pid, "D:/proj/beginTest-2.hip")
    assert again is not None
    assert again["previousHip"] == "D:/proj/beginTest-1.hip"
    assert again["migratedAt"] == migrated_at
    # 大小写/斜杠变体同样算「已是该 hip」
    variant = reg.rebind_hip(pid, r"d:\proj\BEGINTEST-2.HIP")
    assert variant is not None
    assert variant["previousHip"] == "D:/proj/beginTest-1.hip"


def test_is_transient_hip_recognises_crash_and_untitled() -> None:
    """崩溃恢复 / untitled 形态上像另存为，但不是用户意图 —— 必须挡住。

    实测事故：Houdini 崩溃重启后 `hou.hipFile.path()` 报
    `beginTest-1_recovered.hip`，项目被自动换绑到这个用户从未选择的文件上，
    此后映射解析全部指向恢复文件。
    """
    from bridge.project_routes import is_transient_hip

    assert is_transient_hip("D:/proj/beginTest-1_recovered.hip") is True
    assert is_transient_hip(r"D:\proj\beginTest-1_recovered.hip") is True   # 反斜杠
    assert is_transient_hip("D:/proj/UNTITLED.HIP") is True                 # 大小写无关
    assert is_transient_hip("D:/proj/scene_bak.hip") is True
    assert is_transient_hip("") is True                                     # 空 = 不可信
    # 正常文件不能被误判（否则真的另存为反而不迁移了）
    assert is_transient_hip("D:/proj/beginTest-1.hip") is False
    assert is_transient_hip("D:/proj/beginTest-1-saveas-test.hip") is False
    assert is_transient_hip("D:/proj/my_recovered_scene.hip") is False      # 只认结尾


def test_ensure_for_hip_creates_then_hits(tmp_path: Path) -> None:
    reg = ProjectRegistry(tmp_path / "projects.json")
    p1, created1 = reg.ensure_for_hip("D:/proj/scene.hip")
    assert created1 is True
    assert p1["hipName"] == "scene.hip"
    p2, created2 = reg.ensure_for_hip("D:\\proj\\scene.hip")
    assert created2 is False
    assert p2["projectSerial"] == p1["projectSerial"]
    assert len(reg.list()) == 1


def test_rebind_hip_records_previous(tmp_path: Path) -> None:
    reg = ProjectRegistry(tmp_path / "projects.json")
    p = reg.create(hip="D:/proj/a.hip")
    pid = p["projectSerial"]
    time.sleep(0.01)
    out = reg.rebind_hip(pid, "D:/proj/b.hip")
    assert out["hip"] == "D:/proj/b.hip"
    assert out["hipName"] == "b.hip"
    assert out["previousHip"] == "D:/proj/a.hip"
    assert out["migratedAt"] > 0
    assert out["updatedAt"] > p["updatedAt"]
    assert reg.find_by_hip("D:/proj/a.hip") is None
    assert reg.find_by_hip("D:/proj/b.hip")["projectSerial"] == pid
    assert reg.rebind_hip("P1-missing-0000", "D:/x.hip") is None


def test_load_defaults_missing_hip_fields(tmp_path: Path) -> None:
    """旧记录（无 hip/hipName/migratedAt/previousHip）读入后补默认值，不崩。"""
    path = tmp_path / "projects.json"
    path.write_text(
        json.dumps([{"projectSerial": "P1-abcdefgh-0001", "label": "old", "createdAt": 1.0, "updatedAt": 2.0}]),
        encoding="utf-8",
    )
    reg = ProjectRegistry(path)
    rec = reg.get("P1-abcdefgh-0001")
    assert rec["hip"] == "" and rec["hipName"] == ""
    assert rec["migratedAt"] == 0.0 and rec["previousHip"] == ""
    assert rec["members"] == []


def test_load_derives_hip_name_when_absent(tmp_path: Path) -> None:
    path = tmp_path / "projects.json"
    path.write_text(
        json.dumps([{"projectSerial": "P1-abcdefgh-0002", "hip": "D:\\proj\\legacy.hip"}]),
        encoding="utf-8",
    )
    assert ProjectRegistry(path).get("P1-abcdefgh-0002")["hipName"] == "legacy.hip"


# --- 路由测试（裸 FastAPI 挂 project_router） --------------------------------


def _client(tmp_path: Path) -> TestClient:
    reset_state(tmp_path / "data")
    app = FastAPI()
    app.include_router(project_router)
    return TestClient(app)


def test_create_ok(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r = c.post("/api/projects", json={"label": "Demo"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    p = body["project"]
    assert is_valid_project_serial(p["projectSerial"])
    assert p["label"] == "Demo"
    assert p["createdAt"] > 0 and p["updatedAt"] > 0
    assert p["members"] == []


def test_create_route_default_label(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r = c.post("/api/projects", json={})
    assert r.status_code == 200
    assert r.json()["project"]["label"] == ""


def test_list_sorted_by_created_at(tmp_path: Path) -> None:
    c = _client(tmp_path)
    p1 = c.post("/api/projects", json={"label": "a"}).json()["project"]
    time.sleep(0.01)
    p2 = c.post("/api/projects", json={"label": "b"}).json()["project"]
    r = c.get("/api/projects")
    assert r.status_code == 200
    projects = r.json()["projects"]
    assert [p["projectSerial"] for p in projects] == [p1["projectSerial"], p2["projectSerial"]]


def test_get_project_ok_and_404(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = c.post("/api/projects", json={"label": "Demo"}).json()["project"]["projectSerial"]
    r = c.get(f"/api/projects/{pid}")
    assert r.status_code == 200
    assert r.json()["project"]["label"] == "Demo"
    r404 = c.get(f"/api/projects/{generate_project_serial()}")
    assert r404.status_code == 404
    assert r404.json()["detail"] == "project not found"


def test_get_invalid_project_serial_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r = c.get("/api/projects/zzz")
    assert r.status_code == 400
    assert r.json()["detail"] == "invalid project serial"


def test_add_member_dedup_route(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = c.post("/api/projects", json={"label": "Demo"}).json()["project"]["projectSerial"]
    s = generate_serial()
    ref = {"kind": "tag", "serial": s, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""}
    r1 = c.post(f"/api/projects/{pid}/members", json=ref)
    assert r1.status_code == 200
    assert r1.json()["project"]["members"][0]["serial"] == s
    r2 = c.post(f"/api/projects/{pid}/members", json=dict(ref, nodePath="/obj/geo1/tag1b"))
    assert r2.status_code == 200
    members = r2.json()["project"]["members"]
    assert len(members) == 1
    assert members[0]["nodePath"] == "/obj/geo1/tag1b"


def test_add_member_missing_project_404(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r = c.post(
        f"/api/projects/{generate_project_serial()}/members",
        json={"kind": "tag", "serial": generate_serial(), "nodePath": "", "hip": "", "label": ""},
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "project not found"


def test_remove_member_route(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = c.post("/api/projects", json={"label": "Demo"}).json()["project"]["projectSerial"]
    s = generate_serial()
    c.post(f"/api/projects/{pid}/members", json={"kind": "tag", "serial": s, "nodePath": "/obj/x", "hip": "", "label": ""})
    r = c.delete(f"/api/projects/{pid}/members", params={"channelId": s})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["project"]["members"] == []
    # 成员不存在也 ok（project 原样）
    r2 = c.delete(f"/api/projects/{pid}/members", params={"channelId": s})
    assert r2.status_code == 200
    assert r2.json()["project"]["members"] == []


def test_remove_member_param_channel_key(tmp_path: Path) -> None:
    """param 通道 key = absolutePath（含 "/"），query 参数直接传原值。"""
    c = _client(tmp_path)
    pid = c.post("/api/projects", json={}).json()["project"]["projectSerial"]
    s = generate_serial()
    c.post(
        f"/api/projects/{pid}/members",
        json={"kind": "param", "serial": s, "nodePath": "/obj/x", "absolutePath": "/obj/geo1/transform1/tx", "hip": "", "label": ""},
    )
    r = c.delete(f"/api/projects/{pid}/members", params={"channelId": "/obj/geo1/transform1/tx"})
    assert r.status_code == 200
    assert r.json()["project"]["members"] == []


def test_remove_member_missing_project_404(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r = c.delete(f"/api/projects/{generate_project_serial()}/members", params={"channelId": "x"})
    assert r.status_code == 404
    assert r.json()["detail"] == "project not found"


def test_ensure_existing_created_false(tmp_path: Path) -> None:
    c = _client(tmp_path)
    s = generate_serial()
    pid = c.post("/api/projects", json={}).json()["project"]["projectSerial"]
    c.post(f"/api/projects/{pid}/members", json={"kind": "tag", "serial": s, "nodePath": "/obj/x", "hip": "", "label": ""})
    r = c.post("/api/projects/ensure", json={"serial": s})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["created"] is False
    assert body["project"]["projectSerial"] == pid
    assert len(c.get("/api/projects").json()["projects"]) == 1


def test_ensure_channel_hit_creates_tag_member(tmp_path: Path) -> None:
    c = _client(tmp_path)
    s = generate_serial()
    get_state().channels.register({"kind": "tag", "serial": s, "nodePath": "/obj/geo1/tag1", "hip": "D:/x.hip", "label": "Tag"})
    r = c.post("/api/projects/ensure", json={"serial": s})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["created"] is True
    p = body["project"]
    assert p["label"] == s
    assert len(p["members"]) == 1
    m = p["members"][0]
    assert m["kind"] == "tag"
    assert m["serial"] == s
    assert m["nodePath"] == "/obj/geo1/tag1"


def test_ensure_tag_preferred_over_hda(tmp_path: Path) -> None:
    c = _client(tmp_path)
    s = generate_serial()
    st = get_state()
    st.channels.register({"kind": "hda", "serial": s, "nodePath": "/obj/geo1/cyl1nder1", "hip": "", "label": ""})
    st.channels.register({"kind": "tag", "serial": s, "nodePath": "/obj/geo1/tag1", "hip": "", "label": ""})
    body = c.post("/api/projects/ensure", json={"serial": s}).json()
    assert body["created"] is True
    assert body["project"]["members"][0]["kind"] == "tag"


def test_ensure_no_channel_fallback_hda_member(tmp_path: Path) -> None:
    c = _client(tmp_path)
    s = generate_serial()
    r = c.post("/api/projects/ensure", json={"serial": s})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["created"] is True
    p = body["project"]
    assert p["label"] == s
    assert len(p["members"]) == 1
    m = p["members"][0]
    assert m["kind"] == "hda"
    assert m["serial"] == s
    assert m["nodePath"] == ""
    assert m["absolutePath"] is None
    assert m["hip"] == ""
    assert m["label"] == s


def test_ensure_idempotent_after_implicit_create(tmp_path: Path) -> None:
    c = _client(tmp_path)
    s = generate_serial()
    r1 = c.post("/api/projects/ensure", json={"serial": s}).json()
    assert r1["created"] is True
    r2 = c.post("/api/projects/ensure", json={"serial": s}).json()
    assert r2["created"] is False
    assert r2["project"]["projectSerial"] == r1["project"]["projectSerial"]
    assert len(c.get("/api/projects").json()["projects"]) == 1


def test_ensure_invalid_serial_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r = c.post("/api/projects/ensure", json={"serial": "zzz"})
    assert r.status_code == 400
    assert r.json()["detail"] == "invalid serial"


# --- ensure 按 hip 归拢（此前重复项目的根因） --------------------------------


def test_ensure_with_hip_creates_and_stores_hip(tmp_path: Path) -> None:
    c = _client(tmp_path)
    s = generate_serial()
    body = c.post("/api/projects/ensure", json={"serial": s, "hip": "D:/proj/scene.hip"}).json()
    assert body["ok"] is True and body["created"] is True
    p = body["project"]
    assert p["hip"] == "D:/proj/scene.hip"
    assert p["hipName"] == "scene.hip"
    assert p["label"] == ""  # hip 项目不占 label，UI 显示 hipName
    assert [m["serial"] for m in p["members"]] == [s]


def test_ensure_without_hip_falls_back_to_registry_hip(tmp_path: Path) -> None:
    """调用方不带 hip 时回退到 registry 里那条的 hip（v0.1.00119）。

    根因：web 侧 `ensureProject(serial)` 从来不带 hip（它手上只有 serial），于是
    `?serial=` 启动会建出一个 **hip 为空** 的项目，而项目 hip **没有任何回填路径**
    —— 成员之后 push 刷的是 registry，不补项目那一栏。实测重建后的项目 hip 一直是
    空串，nodeview 项目根因此无地址可显（task #6 直接没有数据来源）。
    """
    c = _client(tmp_path)
    s = generate_serial()
    # HDA cook 过一次 → registry 里有该 serial 的 hip（put_inputs 带 hip）
    get_state().registry.register(s, hip="D:/proj/fromRegistry.hip", nodePath="/obj/geo1/Cyl1nder1", label="Cyl1nder")
    body = c.post("/api/projects/ensure", json={"serial": s}).json()
    assert body["ok"] is True
    p = body["project"]
    assert p["hip"] == "D:/proj/fromRegistry.hip", "项目必须绑上 registry 里的 hip"
    assert p["hipName"] == "fromRegistry.hip"
    assert [m["serial"] for m in p["members"]] == [s]


def test_ensure_without_hip_and_no_registry_keeps_old_behaviour(tmp_path: Path) -> None:
    """registry 里也没有 hip 时保持旧语义（建 label=serial 的无 hip 项目），
    不因为回退逻辑而报错或凭空编造 hip。"""
    c = _client(tmp_path)
    s = generate_serial()
    body = c.post("/api/projects/ensure", json={"serial": s}).json()
    assert body["ok"] is True and body["created"] is True
    p = body["project"]
    assert p["hip"] == ""
    assert p["label"] == s


def test_ensure_two_serials_same_hip_land_in_one_project(tmp_path: Path) -> None:
    """核心回归：一个 hip 下的两个节点必须进**同一个**项目（此前各建一个，
    于是两个项目共享成员、状态永远一致）。"""
    c = _client(tmp_path)
    s1, s2 = generate_serial(), generate_serial()
    r1 = c.post("/api/projects/ensure", json={"serial": s1, "hip": "D:/proj/scene.hip"}).json()
    r2 = c.post("/api/projects/ensure", json={"serial": s2, "hip": "D:/proj/scene.hip"}).json()
    assert r1["created"] is True
    assert r2["created"] is False
    assert r2["project"]["projectSerial"] == r1["project"]["projectSerial"]
    projects = c.get("/api/projects").json()["projects"]
    assert len(projects) == 1
    assert sorted(m["serial"] for m in projects[0]["members"]) == sorted([s1, s2])


def test_ensure_hip_spelling_variants_one_project(tmp_path: Path) -> None:
    """大小写 / 斜杠写法不同的同一文件 -> 一个项目。"""
    c = _client(tmp_path)
    s1, s2, s3 = generate_serial(), generate_serial(), generate_serial()
    c.post("/api/projects/ensure", json={"serial": s1, "hip": "D:/Proj/Scene.hip"})
    c.post("/api/projects/ensure", json={"serial": s2, "hip": "D:\\Proj\\Scene.hip"})
    c.post("/api/projects/ensure", json={"serial": s3, "hip": "d:/proj/scene.hip"})
    projects = c.get("/api/projects").json()["projects"]
    assert len(projects) == 1
    assert len(projects[0]["members"]) == 3


def test_ensure_different_dirs_same_filename_are_two_projects(tmp_path: Path) -> None:
    """同名不同目录不能撞（正是不能用文件名当 key 的原因）。"""
    c = _client(tmp_path)
    c.post("/api/projects/ensure", json={"serial": generate_serial(), "hip": "D:/a/scene.hip"})
    c.post("/api/projects/ensure", json={"serial": generate_serial(), "hip": "D:/b/scene.hip"})
    assert len(c.get("/api/projects").json()["projects"]) == 2


def test_ensure_with_hip_idempotent_same_serial(tmp_path: Path) -> None:
    c = _client(tmp_path)
    s = generate_serial()
    r1 = c.post("/api/projects/ensure", json={"serial": s, "hip": "D:/proj/scene.hip"}).json()
    r2 = c.post("/api/projects/ensure", json={"serial": s, "hip": "D:/proj/scene.hip"}).json()
    assert r2["created"] is False
    assert r2["project"]["projectSerial"] == r1["project"]["projectSerial"]
    assert len(r2["project"]["members"]) == 1


def test_create_route_accepts_hip(tmp_path: Path) -> None:
    c = _client(tmp_path)
    p = c.post("/api/projects", json={"label": "Demo", "hip": "D:\\proj\\scene.hip"}).json()["project"]
    assert p["hip"] == "D:\\proj\\scene.hip"
    assert p["hipName"] == "scene.hip"


# --- 改名 / 删除 / 清理（registry 单测） --------------------------------------


def test_set_label_and_delete_unit(tmp_path: Path) -> None:
    reg = ProjectRegistry(tmp_path / "projects.json")
    p = reg.create(label="old")
    pid = p["projectSerial"]
    time.sleep(0.01)
    renamed = reg.set_label(pid, "new")
    assert renamed["label"] == "new"
    assert renamed["updatedAt"] > p["updatedAt"]
    assert reg.set_label("P1-missing-0000", "x") is None
    assert reg.delete(pid) is True
    assert reg.get(pid) is None
    assert reg.delete(pid) is False


def test_list_empty_unit(tmp_path: Path) -> None:
    reg = ProjectRegistry(tmp_path / "projects.json")
    empty = reg.create(label="empty")
    full = reg.create(label="full")
    reg.add_member(full["projectSerial"], {"kind": "tag", "serial": generate_serial(), "nodePath": "/obj/x", "hip": "", "label": ""})
    assert reg.list_empty() == [empty["projectSerial"]]


def test_delete_persists(tmp_path: Path) -> None:
    path = tmp_path / "projects.json"
    reg = ProjectRegistry(path)
    pid = reg.create(label="Demo")["projectSerial"]
    reg.delete(pid)
    assert ProjectRegistry(path).get(pid) is None


# --- 改名 / 删除 / 清理（路由） ----------------------------------------------


class _FakeMappings:
    """state.mappings 替身：只暴露级联要用的 drop_project（真表由另一路并行落地）。"""

    def __init__(self) -> None:
        self.dropped: list[str] = []

    def drop_project(self, project: str) -> bool:
        self.dropped.append(project)
        return True


def test_patch_project_renames(tmp_path: Path) -> None:
    c = _client(tmp_path)
    p = c.post("/api/projects", json={"label": "old"}).json()["project"]
    pid = p["projectSerial"]
    time.sleep(0.01)
    r = c.patch(f"/api/projects/{pid}", json={"label": "new"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["project"]["label"] == "new"
    assert body["project"]["updatedAt"] > p["updatedAt"]
    assert c.get(f"/api/projects/{pid}").json()["project"]["label"] == "new"


def test_patch_project_400_and_404(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r400 = c.patch("/api/projects/zzz", json={"label": "x"})
    assert r400.status_code == 400
    assert r400.json()["detail"] == "invalid project serial"
    r404 = c.patch(f"/api/projects/{generate_project_serial()}", json={"label": "x"})
    assert r404.status_code == 404
    assert r404.json()["detail"] == "project not found"


def test_delete_project_removes_record(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = c.post("/api/projects", json={"label": "Demo"}).json()["project"]["projectSerial"]
    r = c.delete(f"/api/projects/{pid}")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "removed": True}
    assert c.get(f"/api/projects/{pid}").status_code == 404
    assert c.get("/api/projects").json()["projects"] == []


def test_delete_project_unknown_removed_false(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r = c.delete(f"/api/projects/{generate_project_serial()}")
    assert r.status_code == 200
    assert r.json()["removed"] is False


def test_delete_project_invalid_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r = c.delete("/api/projects/zzz")
    assert r.status_code == 400
    assert r.json()["detail"] == "invalid project serial"


def test_put_graph_writes_beside_hip(tmp_path: Path) -> None:
    """PUT 带 hip -> 图落在 `<hip目录>/Cyl1nder/<hip名>_<P1-…>/graph.json`。

    这是用户点名要的形状：目录按**项目** serial 命名（P1-），不是成员的 C1-。
    同时确认旧位置**没有**被写出来，否则等于两处各留半份。
    """
    c = _client(tmp_path)
    st = get_state()
    hip = str(tmp_path / "beginTest-2.hip")
    pid = c.post("/api/projects", json={"label": "Demo", "hip": hip}).json()["project"]["projectSerial"]
    assert c.put(f"/api/projects/{pid}/graph", json={"graph": {"nodes": ["a"]}}).status_code == 200

    expected = tmp_path / "Cyl1nder" / f"beginTest-2_{pid}" / "graph.json"
    assert expected.is_file()
    assert json.loads(expected.read_text(encoding="utf-8")) == {"nodes": ["a"]}
    assert not (st.data_dir / "projects" / pid / "graph.json").exists()   # 旧位置未被写
    assert c.get(f"/api/projects/{pid}/graph").json()["graph"] == {"nodes": ["a"]}


def test_put_graph_without_hip_uses_legacy_path(tmp_path: Path) -> None:
    """项目还没绑 hip（建了但成员没 cook 过）-> 旧位置，行为逐字不变。"""
    c = _client(tmp_path)
    st = get_state()
    pid = c.post("/api/projects", json={"label": "Demo"}).json()["project"]["projectSerial"]
    assert c.put(f"/api/projects/{pid}/graph", json={"graph": {"nodes": []}}).status_code == 200
    assert (st.data_dir / "projects" / pid / "graph.json").is_file()
    assert not (tmp_path / "Cyl1nder").exists()


def test_get_graph_reads_legacy_only_graph_and_migrates(tmp_path: Path) -> None:
    """旧位置的图必须找得到（迁移安全性的**关键属性**），且顺带被迁到 hip 旁。"""
    c = _client(tmp_path)
    st = get_state()
    hip = str(tmp_path / "beginTest-2.hip")
    pid = c.post("/api/projects", json={"label": "Demo", "hip": hip}).json()["project"]["projectSerial"]
    legacy = st.data_dir / "projects" / pid
    legacy.mkdir(parents=True)
    (legacy / "graph.json").write_text(json.dumps({"nodes": ["old"]}), encoding="utf-8")

    assert c.get(f"/api/projects/{pid}/graph").json()["graph"] == {"nodes": ["old"]}
    moved = tmp_path / "Cyl1nder" / f"beginTest-2_{pid}" / "graph.json"
    assert moved.is_file() and not legacy.exists()      # 已迁走
    assert c.get(f"/api/projects/{pid}/graph").json()["graph"] == {"nodes": ["old"]}


def test_get_graph_target_exists_leaves_both_and_still_reads(tmp_path: Path) -> None:
    """两处都有图 -> 不合并、不覆盖，hip 侧优先返回，旧位置原地保留。

    合并语义是人的决定，不是迁移能替用户做的。
    """
    c = _client(tmp_path)
    st = get_state()
    hip = str(tmp_path / "beginTest-2.hip")
    pid = c.post("/api/projects", json={"label": "Demo", "hip": hip}).json()["project"]["projectSerial"]
    legacy = st.data_dir / "projects" / pid
    legacy.mkdir(parents=True)
    (legacy / "graph.json").write_text(json.dumps({"nodes": ["old"]}), encoding="utf-8")
    hip_side = tmp_path / "Cyl1nder" / f"beginTest-2_{pid}"
    hip_side.mkdir(parents=True)
    (hip_side / "graph.json").write_text(json.dumps({"nodes": ["new"]}), encoding="utf-8")

    assert c.get(f"/api/projects/{pid}/graph").json()["graph"] == {"nodes": ["new"]}
    assert json.loads((legacy / "graph.json").read_text(encoding="utf-8")) == {"nodes": ["old"]}


def test_delete_project_cascades_graph_and_mappings(tmp_path: Path) -> None:
    """级联：项目图文件 + 其目录被删，mappings.drop_project 被调用。"""
    c = _client(tmp_path)
    st = get_state()
    st.mappings = _FakeMappings()
    pid = c.post("/api/projects", json={"label": "Demo"}).json()["project"]["projectSerial"]
    assert c.put(f"/api/projects/{pid}/graph", json={"graph": {"nodes": []}}).status_code == 200
    graph_path = snapshot.project_graph_path(st.data_dir, pid)
    assert graph_path.exists()
    assert c.delete(f"/api/projects/{pid}").json()["removed"] is True
    assert not graph_path.exists()
    assert not graph_path.parent.exists()
    assert st.mappings.dropped == [pid]


def test_delete_project_removes_hip_side_dir_and_keeps_sibling(tmp_path: Path) -> None:
    """级联删 hip 侧项目图目录，且**兄弟 per-serial 快照目录必须活着**。

    两者同住 `<hip目录>/Cyl1nder/`：`beginTest-1_P1-…`（项目图）与 `beginTest-1_C1-…`
    （成员快照）。删项目只许动前者——照 rmtree 整个 Cyl1nder/ 会连带端掉用户的场景数据。
    hip 侧文件在此手工造：写入器目前还到不了新根（见报告里的 snapshot.py 阻塞项）。
    """
    c = _client(tmp_path)
    st = get_state()
    st.mappings = _FakeMappings()
    hip = str(tmp_path / "beginTest-1.hip")
    pid = c.post("/api/projects", json={"label": "Demo", "hip": hip}).json()["project"]["projectSerial"]

    graph_root = snapshot.project_graph_root(st.data_dir, pid, hip)
    assert graph_root.parent.name == "Cyl1nder"          # 确实落在 hip 旁
    assert graph_root.name == f"beginTest-1_{pid}"        # 按**项目** serial 命名
    graph_root.mkdir(parents=True)
    (graph_root / "graph.json").write_text(json.dumps({"nodes": []}), encoding="utf-8")

    member_serial = generate_serial()
    sibling = graph_root.parent / f"beginTest-1_{member_serial}" / "scene"
    sibling.mkdir(parents=True)
    (sibling / "meta.json").write_text(json.dumps({"serial": member_serial}), encoding="utf-8")

    assert c.delete(f"/api/projects/{pid}").json()["removed"] is True
    assert not graph_root.exists()
    assert (sibling / "meta.json").is_file()             # 兄弟快照未受牵连
    assert graph_root.parent.is_dir()                    # 不删整个 Cyl1nder/
    assert st.mappings.dropped == [pid]


def test_delete_project_also_removes_legacy_dir(tmp_path: Path) -> None:
    """迁移是尽力而为的，legacy 目录可能还在原地 -> 级联必须两处都清。"""
    c = _client(tmp_path)
    st = get_state()
    st.mappings = _FakeMappings()
    hip = str(tmp_path / "beginTest-1.hip")
    pid = c.post("/api/projects", json={"label": "Demo", "hip": hip}).json()["project"]["projectSerial"]
    legacy = snapshot.project_graph_root(st.data_dir, pid)
    assert legacy == st.data_dir / "projects" / pid
    legacy.mkdir(parents=True)
    (legacy / "graph.json").write_text(json.dumps({"nodes": []}), encoding="utf-8")
    assert c.delete(f"/api/projects/{pid}").json()["removed"] is True
    assert not legacy.exists()


def test_delete_project_without_mappings_attribute(tmp_path: Path) -> None:
    """state 无 mappings 属性（主进程合并时才挂）：删除照常成功。"""
    c = _client(tmp_path)
    st = get_state()
    if hasattr(st, "mappings"):
        delattr(st, "mappings")
    pid = c.post("/api/projects", json={}).json()["project"]["projectSerial"]
    assert c.delete(f"/api/projects/{pid}").json()["removed"] is True


def test_cleanup_removes_only_empty_projects(tmp_path: Path) -> None:
    c = _client(tmp_path)
    st = get_state()
    st.mappings = _FakeMappings()
    empty1 = c.post("/api/projects", json={"label": "e1"}).json()["project"]["projectSerial"]
    empty2 = c.post("/api/projects", json={"label": "e2"}).json()["project"]["projectSerial"]
    kept = c.post("/api/projects", json={"label": "kept"}).json()["project"]["projectSerial"]
    c.post(f"/api/projects/{kept}/members", json={"kind": "tag", "serial": generate_serial(), "nodePath": "/obj/x", "hip": "", "label": ""})
    c.put(f"/api/projects/{empty1}/graph", json={"graph": {"nodes": []}})
    graph_path = snapshot.project_graph_path(st.data_dir, empty1)
    assert graph_path.exists()
    r = c.post("/api/projects/cleanup")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert sorted(body["removed"]) == sorted([empty1, empty2])
    assert [p["projectSerial"] for p in c.get("/api/projects").json()["projects"]] == [kept]
    assert not graph_path.exists()
    assert sorted(st.mappings.dropped) == sorted([empty1, empty2])


def test_cleanup_noop_when_all_have_members(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = c.post("/api/projects", json={"label": "kept"}).json()["project"]["projectSerial"]
    c.post(f"/api/projects/{pid}/members", json={"kind": "tag", "serial": generate_serial(), "nodePath": "/obj/x", "hip": "", "label": ""})
    assert c.post("/api/projects/cleanup").json()["removed"] == []
    assert len(c.get("/api/projects").json()["projects"]) == 1


def test_state_projects_and_channels_coexist(tmp_path: Path) -> None:
    """reset_state 后 channels 与 projects 注册表同数据目录共存、各自落盘。"""
    reset_state(tmp_path / "data")
    st = get_state()
    st.projects.create(label="Demo")
    s = generate_serial()
    st.channels.register({"kind": "tag", "serial": s, "nodePath": "/obj/x", "hip": "", "label": ""})
    st.projects.save_now()
    st.channels.save_now()
    data_dir = tmp_path / "data"
    assert (data_dir / "projects.json").exists()
    assert (data_dir / "channels.json").exists()


# --- 另存为迁移（POST /api/projects/migrate） --------------------------------


class _FakeProbe:
    """Houdini 探测替身（绝不连真 Houdini）：按 nodePath 记「新文件里有哪些节点
    及其 cyl1nder_serial」，照 houdini_mcp.rpc 的信封形状作答。

    port=0 模拟「Houdini 不可达」；raise=True 模拟传输异常。
    """

    def __init__(self, nodes: dict[str, str] | None = None, port: int = 8100, raise_: bool = False) -> None:
        self.nodes = nodes or {}
        self.port = port
        self.raise_ = raise_
        self.calls: list[tuple[str, dict]] = []

    def resolve_port(self, serial: str) -> int:
        return self.port

    def rpc(self, port: int, command: str, params: dict | None = None, timeout: float = 8.0) -> dict:
        params = params or {}
        self.calls.append((command, params))
        if self.raise_:
            raise RuntimeError("boom")
        node = str(params.get("node_path") or "")
        if node not in self.nodes:
            return {"status": "error", "error": {"code": 1, "message": "no such node"}}
        if command == "nodes.get_node_info":
            return {"status": "success", "data": {"type": {"name": "Cyl1nderTag"}, "name": node.split("/")[-1]}}
        if command == "parameters.get_parameter":
            return {"status": "success", "data": {"value": self.nodes[node]}}
        return {"status": "error", "error": {"code": 404, "message": command}}


def _install_probe(monkeypatch, probe: _FakeProbe) -> _FakeProbe:
    import bridge.project_routes as pr

    monkeypatch.setattr(pr, "_resolve_port", probe.resolve_port)
    monkeypatch.setattr(pr.houdini_mcp, "rpc", probe.rpc)
    return probe


def _seed_member(c: TestClient, pid: str, serial: str, node_path: str, hip: str = "") -> None:
    c.post(
        f"/api/projects/{pid}/members",
        json={"kind": "tag", "serial": serial, "nodePath": node_path, "hip": hip, "label": ""},
    )


def test_migrate_invalid_pid_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r = c.post("/api/projects/migrate", json={"projectSerial": "zzz", "toHip": "D:/b.hip"})
    assert r.status_code == 400
    assert r.json()["detail"] == "invalid project serial"


def test_migrate_unknown_project_404(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r = c.post("/api/projects/migrate", json={"projectSerial": generate_project_serial(), "toHip": "D:/b.hip"})
    assert r.status_code == 404
    assert r.json()["detail"] == "project not found"


def test_migrate_same_hip_is_cheap_noop(tmp_path: Path, monkeypatch) -> None:
    """cook 每次心跳都报 hip -> hip 未变时必须是不探测、不改动的 no-op。"""
    c = _client(tmp_path)
    probe = _install_probe(monkeypatch, _FakeProbe())
    s1, s2 = generate_serial(), generate_serial()
    pid = c.post("/api/projects", json={"hip": "D:/proj/scene.hip"}).json()["project"]["projectSerial"]
    _seed_member(c, pid, s1, "/obj/geo1/tag1")
    _seed_member(c, pid, s2, "/obj/geo1/tag2")
    before = c.get(f"/api/projects/{pid}").json()["project"]
    r = c.post("/api/projects/migrate", json={"projectSerial": pid, "toHip": "D:\\Proj\\Scene.hip"})
    assert r.status_code == 200
    body = r.json()
    assert body["migrated"] is False
    assert "already bound" in body["reason"]
    assert sorted(body["kept"]) == sorted([s1, s2])
    assert body["dropped"] == []
    assert probe.calls == []  # 没有探测发生
    after = c.get(f"/api/projects/{pid}").json()["project"]
    assert after["hip"] == before["hip"]
    assert after["migratedAt"] == 0.0
    assert len(after["members"]) == 2


def test_migrate_keeps_verified_drops_missing(tmp_path: Path, monkeypatch) -> None:
    """按**新 hip** 核对：新文件里在且 serial 相符 -> kept；找不到 -> dropped 并移出。"""
    c = _client(tmp_path)
    kept_serial, gone_serial = generate_serial(), generate_serial()
    _install_probe(monkeypatch, _FakeProbe(nodes={"/obj/geo1/tag1": kept_serial}))
    pid = c.post("/api/projects", json={"hip": "D:/proj/a.hip"}).json()["project"]["projectSerial"]
    _seed_member(c, pid, kept_serial, "/obj/geo1/tag1")
    _seed_member(c, pid, gone_serial, "/obj/geo1/tag_gone")
    body = c.post("/api/projects/migrate", json={"projectSerial": pid, "toHip": "D:/proj/b.hip"}).json()
    assert body["migrated"] is True
    assert body["fromHip"] == "D:/proj/a.hip"
    assert body["toHip"] == "D:/proj/b.hip"
    assert body["kept"] == [kept_serial]
    assert body["dropped"] == [gone_serial]
    p = c.get(f"/api/projects/{pid}").json()["project"]
    assert [m["serial"] for m in p["members"]] == [kept_serial]
    assert p["hip"] == "D:/proj/b.hip"
    assert p["hipName"] == "b.hip"
    assert p["previousHip"] == "D:/proj/a.hip"
    assert p["migratedAt"] > 0


def test_migrate_drops_member_whose_serial_no_longer_matches(tmp_path: Path, monkeypatch) -> None:
    """节点还在但 serial 变了（复制节点会换号）-> 不是原来那块，移出。"""
    c = _client(tmp_path)
    s = generate_serial()
    _install_probe(monkeypatch, _FakeProbe(nodes={"/obj/geo1/tag1": generate_serial()}))
    pid = c.post("/api/projects", json={"hip": "D:/proj/a.hip"}).json()["project"]["projectSerial"]
    _seed_member(c, pid, s, "/obj/geo1/tag1")
    body = c.post("/api/projects/migrate", json={"projectSerial": pid, "toHip": "D:/proj/b.hip"}).json()
    assert body["dropped"] == [s]
    assert body["kept"] == []


def test_migrate_keeps_everything_when_houdini_unreachable(tmp_path: Path, monkeypatch) -> None:
    """**最重要的安全性质**：端口解析不出来（Houdini 没开）时绝不移出任何成员。"""
    c = _client(tmp_path)
    s1, s2 = generate_serial(), generate_serial()
    _install_probe(monkeypatch, _FakeProbe(port=0))
    pid = c.post("/api/projects", json={"hip": "D:/proj/a.hip"}).json()["project"]["projectSerial"]
    _seed_member(c, pid, s1, "/obj/geo1/tag1")
    _seed_member(c, pid, s2, "/obj/geo1/tag2")
    body = c.post("/api/projects/migrate", json={"projectSerial": pid, "toHip": "D:/proj/b.hip"}).json()
    assert body["migrated"] is True
    assert sorted(body["kept"]) == sorted([s1, s2])
    assert body["dropped"] == []
    assert "unreachable" in body["reason"]
    p = c.get(f"/api/projects/{pid}").json()["project"]
    assert len(p["members"]) == 2      # 一个都没丢
    assert p["hip"] == "D:/proj/b.hip"  # 换绑照做


def test_migrate_keeps_everything_when_probe_raises(tmp_path: Path, monkeypatch) -> None:
    """探测机制本身炸了（传输异常）同样不许移出成员。"""
    c = _client(tmp_path)
    s = generate_serial()
    _install_probe(monkeypatch, _FakeProbe(raise_=True))
    pid = c.post("/api/projects", json={"hip": "D:/proj/a.hip"}).json()["project"]["projectSerial"]
    _seed_member(c, pid, s, "/obj/geo1/tag1")
    body = c.post("/api/projects/migrate", json={"projectSerial": pid, "toHip": "D:/proj/b.hip"}).json()
    assert body["kept"] == [s]
    assert body["dropped"] == []
    assert "unreachable" in body["reason"]
    assert len(c.get(f"/api/projects/{pid}").json()["project"]["members"]) == 1


def test_migrate_keeps_everything_when_port_resolution_raises(tmp_path: Path, monkeypatch) -> None:
    """端口解析本身抛异常也不许移出成员、不许 500。"""
    import bridge.project_routes as pr

    c = _client(tmp_path)
    s = generate_serial()

    def boom(serial: str) -> int:
        raise RuntimeError("port lookup exploded")

    monkeypatch.setattr(pr, "_resolve_port", boom)
    pid = c.post("/api/projects", json={"hip": "D:/proj/a.hip"}).json()["project"]["projectSerial"]
    _seed_member(c, pid, s, "/obj/geo1/tag1")
    r = c.post("/api/projects/migrate", json={"projectSerial": pid, "toHip": "D:/proj/b.hip"})
    assert r.status_code == 200
    body = r.json()
    assert body["kept"] == [s]
    assert body["dropped"] == []
    assert len(c.get(f"/api/projects/{pid}").json()["project"]["members"]) == 1


def test_migrate_keeps_member_when_node_info_shape_is_odd(tmp_path: Path, monkeypatch) -> None:
    """node_info 返回形状意外（没有 type 字段）但 serial 相符 -> 保留。
    判据只认 cyl1nder_serial，不认节点类型，少一条误删路径。"""
    import bridge.project_routes as pr

    c = _client(tmp_path)
    s = generate_serial()

    def rpc(port, command, params=None, timeout=8.0):
        if command == "nodes.get_node_info":
            return {"status": "success", "data": {"name": "tag1"}}   # 无 type
        return {"status": "success", "data": {"value": s}}

    monkeypatch.setattr(pr, "_resolve_port", lambda serial: 8100)
    monkeypatch.setattr(pr.houdini_mcp, "rpc", rpc)
    pid = c.post("/api/projects", json={"hip": "D:/proj/a.hip"}).json()["project"]["projectSerial"]
    _seed_member(c, pid, s, "/obj/geo1/tag1")
    body = c.post("/api/projects/migrate", json={"projectSerial": pid, "toHip": "D:/proj/b.hip"}).json()
    assert body["kept"] == [s]
    assert body["dropped"] == []


def test_migrate_keeps_member_with_no_node_path(tmp_path: Path, monkeypatch) -> None:
    """成员没有 nodePath（占位成员）-> 无从核对，保留而非移出。"""
    c = _client(tmp_path)
    s = generate_serial()
    _install_probe(monkeypatch, _FakeProbe(nodes={}))
    pid = c.post("/api/projects", json={"hip": "D:/proj/a.hip"}).json()["project"]["projectSerial"]
    _seed_member(c, pid, s, "")
    body = c.post("/api/projects/migrate", json={"projectSerial": pid, "toHip": "D:/proj/b.hip"}).json()
    assert body["kept"] == [s]
    assert body["dropped"] == []


def test_migrate_traces_real_migration(tmp_path: Path, monkeypatch) -> None:
    """真迁移埋 trace（actor bridge，沿用既有 register action）；no-op 不埋。"""
    c = _client(tmp_path)
    _install_probe(monkeypatch, _FakeProbe(port=0))
    pid = c.post("/api/projects", json={"hip": "D:/proj/a.hip"}).json()["project"]["projectSerial"]
    c.post("/api/projects/migrate", json={"projectSerial": pid, "toHip": "D:/proj/a.hip"})
    assert get_state().trace.list(actor="bridge", action="register") == []
    c.post("/api/projects/migrate", json={"projectSerial": pid, "toHip": "D:/proj/b.hip"})
    events = get_state().trace.list(actor="bridge", action="register")
    assert len(events) == 1
    assert events[0]["channel"] == pid
    assert events[0]["target"] == "D:/proj/b.hip"
    assert "D:/proj/a.hip -> D:/proj/b.hip" in events[0]["digest"]


def test_migrate_empty_project_rebinds(tmp_path: Path, monkeypatch) -> None:
    c = _client(tmp_path)
    _install_probe(monkeypatch, _FakeProbe())
    pid = c.post("/api/projects", json={"hip": "D:/proj/a.hip"}).json()["project"]["projectSerial"]
    body = c.post("/api/projects/migrate", json={"projectSerial": pid, "toHip": "D:/proj/b.hip"}).json()
    assert body["migrated"] is True
    assert body["kept"] == [] and body["dropped"] == []
    assert c.get(f"/api/projects/{pid}").json()["project"]["hip"] == "D:/proj/b.hip"


def test_migrate_then_ensure_hits_migrated_project(tmp_path: Path, monkeypatch) -> None:
    """迁移后按新 hip ensure 必须命中同一个项目（不许再建一个）。"""
    c = _client(tmp_path)
    s = generate_serial()
    _install_probe(monkeypatch, _FakeProbe(nodes={"/obj/geo1/tag1": s}))
    pid = c.post("/api/projects", json={"hip": "D:/proj/a.hip"}).json()["project"]["projectSerial"]
    _seed_member(c, pid, s, "/obj/geo1/tag1")
    c.post("/api/projects/migrate", json={"projectSerial": pid, "toHip": "D:/proj/b.hip"})
    body = c.post("/api/projects/ensure", json={"serial": s, "hip": "D:/proj/b.hip"}).json()
    assert body["created"] is False
    assert body["project"]["projectSerial"] == pid
    assert len(c.get("/api/projects").json()["projects"]) == 1


def test_ensure_moves_stale_param_member_when_target_hip_has_owner(tmp_path: Path, monkeypatch) -> None:
    """目标 hip 已有主时，旧项目里该 serial 的 param 成员（key=absolutePath）也要摘干净，
    否则一个 serial 仍横跨两个项目——正是要根除的重复现象。"""
    c = _client(tmp_path)
    s = generate_serial()
    _install_probe(monkeypatch, _FakeProbe(port=0))
    stale = c.post("/api/projects", json={"hip": "D:/proj/a.hip"}).json()["project"]["projectSerial"]
    _seed_member(c, stale, s, "/obj/geo1/tag1")
    c.post(
        f"/api/projects/{stale}/members",
        json={"kind": "param", "serial": s, "nodePath": "/obj/geo1/tag1",
              "absolutePath": "/obj/geo1/transform1/tx", "hip": "", "label": ""},
    )
    owner = c.post("/api/projects", json={"hip": "D:/proj/b.hip"}).json()["project"]["projectSerial"]
    body = c.post("/api/projects/ensure", json={"serial": s, "hip": "D:/proj/b.hip"}).json()
    assert body["project"]["projectSerial"] == owner
    assert c.get(f"/api/projects/{stale}").json()["project"]["members"] == []
    assert [m["serial"] for m in c.get(f"/api/projects/{owner}").json()["project"]["members"]] == [s]


# --- 测试残留项目的自动清理（用户需求：「除了 begintest2 其它都是残留的测试场景」）---
#
# 实测背景（GET /api/projects 返回 13 个，只有 1 个是真的）：`ensure` 在 hip 查不到时
# 会兜底建一个 label=serial 的无 hip 项目，而 web/e2e 的 projectForSerial() 每个 spec
# 都对合成 serial 调一次 ensureProject —— 于是每跑一轮 e2e 沉淀一批残留。
# 残留恰好各有 1 个成员，所以 /cleanup（0 成员）一个都抓不到。


def _residue(label: str = "", *, serial: str = "", age_s: float = 10_000.0) -> dict:
    """造一个残留项目记录：无 hip + 单个占位成员（照 member_ref_for 的兜底字面量）。"""
    s = serial or generate_serial()
    now = time.time() - age_s
    return {
        "projectSerial": generate_project_serial(),
        "label": label or s,
        "hip": "",
        "hipName": "",
        "createdAt": now,
        "updatedAt": now,
        "migratedAt": 0.0,
        "previousHip": "",
        "members": [
            {"kind": "hda", "serial": s, "nodePath": "", "absolutePath": None,
             "hip": "", "label": s, "registeredAt": 0.0, "lastSeen": 0.0},
        ],
    }


def test_is_residue_project_matches_the_real_e2e_residue_shape() -> None:
    """逐字照实测残留（bridge/data/projects.json 里那 12 个）的形状判定。"""
    from bridge.project_routes import is_residue_project

    assert is_residue_project(_residue(label="C1-e2etest9999-zzzz", serial="C1-e2etest9999-zzzz")) is True
    assert is_residue_project(_residue(label="C1-e2eround9-0001", serial="C1-e2eround9-0001")) is True
    assert is_residue_project(_residue(label="")) is True            # label 空也算没人味


def test_is_residue_project_never_touches_a_hip_bound_project() -> None:
    """**最重要的安全性质**：绑了 hip 的项目永远不是残留 —— 这就是护住用户真项目的墙。

    实测真项目 `P1-mszw0wfu-d3u3` 的成员**也是**占位 ref（nodePath 空、registeredAt 0），
    所以只有 hip 这一条能把它与残留区分开。这里刻意用「除 hip 外样样像残留」的记录：
    label 是序列号、成员是占位、年龄够老 —— 只要 hip 非空就必须存活。
    """
    from bridge.project_routes import is_residue_project

    real = _residue(label="C1-msm6dsp7-ob6t", serial="C1-msm6dsp7-ob6t")
    real["hip"] = "D:/Animation_Project/Houdini/Test/Cyl1nder/dev/beginTest-1/beginTest-2.hip"
    real["hipName"] = "beginTest-2.hip"
    real["members"][0]["hip"] = real["hip"]
    assert is_residue_project(real) is False


def test_is_residue_project_requires_all_conditions() -> None:
    """四条判据各自都能单独保命（少任何一条都不算残留）。"""
    from bridge.project_routes import is_residue_project

    # 有人味的 label（用户改过名）-> 留
    assert is_residue_project(_residue(label="我的场景")) is False
    # 0 成员 -> 不是自动清理的活儿（交给 /cleanup 按钮）
    shell = _residue()
    shell["members"] = []
    assert is_residue_project(shell) is False
    # 有真通道成员（nodePath 非空）-> 有真东西，留
    with_node = _residue()
    with_node["members"][0]["nodePath"] = "/obj/geo1/tag1"
    assert is_residue_project(with_node) is False
    # 有真通道成员（registeredAt 非零：channels.register 恒 > 0）-> 留
    registered = _residue()
    registered["members"][0]["registeredAt"] = 1787132737.0
    assert is_residue_project(registered) is False
    # param 成员（absolutePath 非空）-> 留
    param = _residue()
    param["members"][0]["absolutePath"] = "/obj/geo1/transform1/tx"
    assert is_residue_project(param) is False


def test_is_residue_project_grace_period_protects_fresh_projects() -> None:
    """保护期不是保守起见，是正确性必需：新建项目在成员加入前形态与残留一致。

    没有年龄门，自动清理会把用户刚点「新建项目」的那个、以及 e2e 正在用的那个
    （round9 先 ensure 再导航，中间隔着一次页面加载）当场删掉。
    """
    from bridge.project_routes import RESIDUE_GRACE_S, is_residue_project

    assert is_residue_project(_residue(age_s=1.0)) is False
    assert is_residue_project(_residue(age_s=RESIDUE_GRACE_S - 1.0)) is False
    assert is_residue_project(_residue(age_s=RESIDUE_GRACE_S + 1.0)) is True
    # 只有 updatedAt 新（刚被动过）也算新鲜：取 createdAt/updatedAt 的较大者
    touched = _residue(age_s=10_000.0)
    touched["updatedAt"] = time.time()
    assert is_residue_project(touched) is False


def test_is_residue_project_registry_hip_is_an_independent_guard(tmp_path: Path) -> None:
    """第二道独立判据：成员在 registry 里有非空 hip -> 保留（哪怕项目那栏是空的）。

    真项目的成员在 registry 里带着 `beginTest-2.hip`（HDA cook 时自报），所以
    「误删真项目」需要同时突破 hip 与 registry 两道彼此独立的墙。
    """
    from bridge.project_routes import is_residue_project

    reset_state(tmp_path / "data")
    st = get_state()
    s = generate_serial()
    st.registry.register(s, hip="D:/proj/beginTest-2.hip", nodePath="/obj/test/Cyl1nder1", label="Cyl1nder1")
    rec = _residue(serial=s)
    assert is_residue_project(rec, None) is True          # 不看 registry 时算残留
    assert is_residue_project(rec, st.registry) is False  # 看了 registry -> 保命


def test_list_projects_sweeps_residue_and_keeps_the_real_one(tmp_path: Path) -> None:
    """端到端复现用户的实测局面：13 个项目里 12 个残留 -> 列表只剩真的那个。

    如果这个用例把 `beginTest-2.hip` 那个删了，就是灾难性失败（用户的真项目）。
    """
    c = _client(tmp_path)
    st = get_state()
    st.mappings = _FakeMappings()
    real_serial = generate_serial()
    hip = "D:/Animation_Project/Houdini/Test/Cyl1nder/dev/beginTest-1/beginTest-2.hip"
    st.registry.register(real_serial, hip=hip, nodePath="/obj/test/Cyl1nder1", label="Cyl1nder1")
    real = st.projects.ensure_for_hip(hip)[0]["projectSerial"]
    st.projects.add_member(real, {
        "kind": "hda", "serial": real_serial, "nodePath": "", "absolutePath": None,
        "hip": hip, "label": real_serial, "registeredAt": 0.0, "lastSeen": 0.0,
    })
    # 12 个残留：照实测形状（无 hip、label=serial、单个占位成员），年龄足够老
    old = time.time() - 10_000.0
    for _ in range(12):
        s = generate_serial()
        pid = st.projects.create(label=s)["projectSerial"]
        st.projects.add_member(pid, {
            "kind": "hda", "serial": s, "nodePath": "", "absolutePath": None,
            "hip": "", "label": s, "registeredAt": 0.0, "lastSeen": 0.0,
        })
        rec = st.projects.get(pid)
        st.projects._records[pid]["createdAt"] = old   # 直接改内存：造「上次跑 e2e 留下的」
        st.projects._records[pid]["updatedAt"] = old
        assert rec is not None
    assert len(st.projects.list()) == 13

    projects = c.get("/api/projects").json()["projects"]
    assert [p["projectSerial"] for p in projects] == [real], "只应剩真项目"
    assert projects[0]["hipName"] == "beginTest-2.hip"
    assert len(projects[0]["members"]) == 1
    # 级联同 DELETE：映射分区一并清掉
    assert len(st.mappings.dropped) == 12


def test_list_projects_keeps_fresh_and_named_and_empty_projects(tmp_path: Path) -> None:
    """自动清理的三类「不许碰」：刚新建的、改过名的、0 成员的壳。"""
    c = _client(tmp_path)
    st = get_state()
    fresh = c.post("/api/projects", json={}).json()["project"]["projectSerial"]   # 刚建，成员都还没加
    shell = st.projects.create(label="")["projectSerial"]                          # 0 成员壳
    st.projects._records[shell]["createdAt"] = time.time() - 10_000.0              # 老，但仍是壳
    st.projects._records[shell]["updatedAt"] = time.time() - 10_000.0
    named = st.projects.create(label="我的场景")["projectSerial"]                  # 改过名
    s = generate_serial()
    st.projects.add_member(named, {
        "kind": "hda", "serial": s, "nodePath": "", "absolutePath": None,
        "hip": "", "label": s, "registeredAt": 0.0, "lastSeen": 0.0,
    })
    st.projects._records[named]["createdAt"] = time.time() - 10_000.0
    st.projects._records[named]["updatedAt"] = time.time() - 10_000.0

    got = {p["projectSerial"] for p in c.get("/api/projects").json()["projects"]}
    assert got == {fresh, shell, named}


def test_list_projects_is_idempotent_and_noop_when_clean(tmp_path: Path) -> None:
    """稳态（没有残留）时 list 不写任何东西；连列两次结果一致。"""
    c = _client(tmp_path)
    st = get_state()
    hip = "D:/proj/beginTest-2.hip"
    st.registry.register(generate_serial(), hip=hip, nodePath="/obj/x", label="x")
    pid = st.projects.ensure_for_hip(hip)[0]["projectSerial"]
    first = c.get("/api/projects").json()["projects"]
    second = c.get("/api/projects").json()["projects"]
    assert [p["projectSerial"] for p in first] == [pid]
    assert [p["projectSerial"] for p in second] == [pid]
    assert first[0]["updatedAt"] == second[0]["updatedAt"]   # 没被动过


def test_sweep_residue_traces_every_removal(tmp_path: Path) -> None:
    """自动删用户可见记录必须留痕，否则「我的项目怎么没了」无从追查。"""
    from bridge.project_routes import sweep_residue_projects

    _client(tmp_path)
    st = get_state()
    s = generate_serial()
    pid = st.projects.create(label=s)["projectSerial"]
    st.projects.add_member(pid, {
        "kind": "hda", "serial": s, "nodePath": "", "absolutePath": None,
        "hip": "", "label": s, "registeredAt": 0.0, "lastSeen": 0.0,
    })
    st.projects._records[pid]["createdAt"] = time.time() - 10_000.0
    st.projects._records[pid]["updatedAt"] = time.time() - 10_000.0

    assert sweep_residue_projects() == [pid]
    events = [e for e in st.trace.list(actor="bridge") if e["target"] == "residue-sweep"]
    assert len(events) == 1
    assert events[0]["channel"] == pid
    assert pid in events[0]["digest"]


def test_sweep_survives_a_broken_cascade(tmp_path: Path) -> None:
    """级联炸了也不能让项目列表挂掉（照 _cascade_delete 的先例）。"""
    import bridge.project_routes as pr

    c = _client(tmp_path)
    st = get_state()
    s = generate_serial()
    pid = st.projects.create(label=s)["projectSerial"]
    st.projects.add_member(pid, {
        "kind": "hda", "serial": s, "nodePath": "", "absolutePath": None,
        "hip": "", "label": s, "registeredAt": 0.0, "lastSeen": 0.0,
    })
    st.projects._records[pid]["createdAt"] = time.time() - 10_000.0
    st.projects._records[pid]["updatedAt"] = time.time() - 10_000.0

    class _Boom:
        def drop_project(self, project: str) -> bool:
            raise RuntimeError("mappings exploded")

    st.mappings = _Boom()
    r = c.get("/api/projects")
    assert r.status_code == 200          # 列表照常可用
    assert r.json()["projects"] == []    # 记录还是删掉了（级联失败不阻断删除）


def test_ensure_with_changed_hip_migrates_instead_of_duplicating(tmp_path: Path, monkeypatch) -> None:
    """另存为后 ensure 报新 hip：换绑旧项目，而不是并出第二个项目。"""
    c = _client(tmp_path)
    s = generate_serial()
    _install_probe(monkeypatch, _FakeProbe(nodes={"/obj/geo1/tag1": s}))
    get_state().channels.register(
        {"kind": "tag", "serial": s, "nodePath": "/obj/geo1/tag1", "hip": "D:/proj/a.hip", "label": "Tag"}
    )
    r1 = c.post("/api/projects/ensure", json={"serial": s, "hip": "D:/proj/a.hip"}).json()
    pid = r1["project"]["projectSerial"]
    r2 = c.post("/api/projects/ensure", json={"serial": s, "hip": "D:/proj/b.hip"}).json()
    assert r2["project"]["projectSerial"] == pid
    projects = c.get("/api/projects").json()["projects"]
    assert len(projects) == 1
    assert projects[0]["hip"] == "D:/proj/b.hip"
    assert projects[0]["previousHip"] == "D:/proj/a.hip"
