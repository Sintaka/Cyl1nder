"""吊牌 HDA 项目注册表 + 路由测试（见 devlog/tag-hda-plan.md P2a）。

ProjectRegistry 单测照 test_channels.py 纯单元风格；路由测试照
test_houdini_mcp.py 的裸 FastAPI 做法（create_app 尚未挂载 project_routes，
main.py 由主进程粘合）。reset_state 后 state.channels 与 state.projects
同数据目录共存。
"""
from __future__ import annotations

import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from bridge import snapshot
from bridge.project_routes import router as project_router
from bridge.projects import ProjectRegistry
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
