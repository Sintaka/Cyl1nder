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
