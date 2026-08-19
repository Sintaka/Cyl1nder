"""吊牌 HDA 项目图读写 + 端点测试（见 devlog/tag-hda-plan.md P2b）。

照 test_projects.py 模板：reset_state(tmp_path/"data") + 裸 FastAPI 挂 project_router
（main.py 由主进程挂载）。快照侧 hip 根与 DEFAULT_ROOT 都用 tmp_path 内路径，
不触碰 bridge/data 真数据。
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

import bridge.snapshot as snap
from bridge.project_routes import router as project_router
from bridge.protocol import generate_project_serial, generate_serial
from bridge.snapshot import project_graph_path, read_project_graph, write_project_graph
from bridge.state import reset_state


def _client(tmp_path: Path) -> TestClient:
    reset_state(tmp_path / "data")
    app = FastAPI()
    app.include_router(project_router)
    return TestClient(app)


def _create_project(c: TestClient) -> str:
    return c.post("/api/projects", json={}).json()["project"]["projectSerial"]


# --- snapshot.py 新增函数单元测试 ---------------------------------------------


def test_project_graph_path(tmp_path: Path) -> None:
    assert project_graph_path(tmp_path / "data", "P1-x") == tmp_path / "data" / "projects" / "P1-x" / "graph.json"


def test_read_missing_and_corrupt(tmp_path: Path) -> None:
    assert read_project_graph(tmp_path / "data", "P1-x") is None  # 缺失
    p = project_graph_path(tmp_path / "data", "P1-x")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("{bad", encoding="utf-8")
    assert read_project_graph(tmp_path / "data", "P1-x") is None  # 损坏


def test_write_read_roundtrip_skip_rewrite(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    graph = {"nodes": [{"id": "n1"}], "connections": [], "viewport": {"scale": 1.0}}
    write_project_graph(data_dir, "P1-x", graph)
    assert read_project_graph(data_dir, "P1-x") == graph
    path = project_graph_path(data_dir, "P1-x")
    mtime = path.stat().st_mtime_ns
    time.sleep(0.01)
    write_project_graph(data_dir, "P1-x", graph)  # 同内容 -> 内容对比跳过重写
    assert path.stat().st_mtime_ns == mtime


# --- 路由测试 -----------------------------------------------------------------


def test_put_get_roundtrip(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = _create_project(c)
    graph = {"nodes": [{"id": "n1", "x": 1, "y": 2}, {"id": "n2"}], "connections": [{"from": "n1", "to": "n2"}], "viewport": {"scale": 1.5}}
    r = c.put(f"/api/projects/{pid}/graph", json={"graph": graph})
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    r2 = c.get(f"/api/projects/{pid}/graph")
    assert r2.status_code == 200
    assert r2.json()["graph"] == graph


def test_get_empty_project_graph_null(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = _create_project(c)
    r = c.get(f"/api/projects/{pid}/graph")
    assert r.status_code == 200
    assert r.json()["graph"] is None


def test_put_same_content_skips_rewrite(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = _create_project(c)
    graph = {"nodes": [{"id": "n1"}], "connections": []}
    assert c.put(f"/api/projects/{pid}/graph", json={"graph": graph}).status_code == 200
    path = project_graph_path(tmp_path / "data", pid)
    mtime = path.stat().st_mtime_ns
    time.sleep(0.01)
    assert c.put(f"/api/projects/{pid}/graph", json={"graph": graph}).status_code == 200
    assert path.stat().st_mtime_ns == mtime  # 内容对比生效：未重写


def test_invalid_project_serial_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    assert c.get("/api/projects/zzz/graph").status_code == 400
    assert c.put("/api/projects/zzz/graph", json={"graph": {}}).status_code == 400


def test_missing_project_404(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = generate_project_serial()
    r = c.get(f"/api/projects/{pid}/graph")
    assert r.status_code == 404
    assert r.json()["detail"] == "project not found"
    r2 = c.put(f"/api/projects/{pid}/graph", json={"graph": {}})
    assert r2.status_code == 404
    assert r2.json()["detail"] == "project not found"


def test_corrupt_graph_file_returns_null(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = _create_project(c)
    path = project_graph_path(tmp_path / "data", pid)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{bad", encoding="utf-8")
    r = c.get(f"/api/projects/{pid}/graph")
    assert r.status_code == 200
    assert r.json()["graph"] is None  # 损坏文件不崩，返回 null


# --- 迁移读（单成员隐式项目，纯读不写回） ------------------------------------


def test_migrate_single_member_snapshot_graph(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(snap, "DEFAULT_ROOT", tmp_path / "default")
    c = _client(tmp_path)
    pid = _create_project(c)
    s = generate_serial()
    hip = str(tmp_path / "hipdir" / "scene.hip")
    # 旧成员图里**混着 sop 层节点与一个 geo**。迁移读必须只把 geo 类带上项目根
    # （v0.1.00123，用户 bug #1：根目录下只能有 geo 类的，删了 reload 又会回来）。
    graph = {
        "schemaVersion": 5,
        "viewport": {"scale": 1.0},
        "nodes": [
            {"id": "g1", "kind": "geo", "label": "geo1"},
            {"id": "n1", "kind": "null", "label": "null1"},
            {"id": "i1", "kind": "input", "label": "_input_"},
        ],
        "connections": [{"source": "g1", "target": "n1"}],
    }
    # v0.1.00122 起 `write_snapshot` 不再写 graph，故手工铺旧存档形状的 node-graph.json。
    snap.write_snapshot(s, hip)
    legacy_graph = snap.snapshot_root(hip, s) / "scene" / "node-graph.json"
    legacy_graph.parent.mkdir(parents=True, exist_ok=True)
    legacy_graph.write_text(json.dumps(graph), encoding="utf-8")
    c.post(
        f"/api/projects/{pid}/members",
        json={"kind": "tag", "serial": s, "nodePath": "/obj/geo1/tag1", "hip": hip, "label": ""},
    )
    r = c.get(f"/api/projects/{pid}/graph")
    assert r.status_code == 200
    got = r.json()["graph"]
    assert [n["kind"] for n in got["nodes"]] == ["geo"]  # sop 层节点没被带上来
    assert got["connections"] == []  # 指向被剔节点的连接一并删掉
    assert not project_graph_path(tmp_path / "data", pid).exists()  # 纯读迁移：不写回


def test_no_migrate_multiple_members(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = _create_project(c)
    for i in range(2):
        s = generate_serial()
        c.post(f"/api/projects/{pid}/members", json={"kind": "tag", "serial": s, "nodePath": f"/obj/x{i}", "hip": "", "label": ""})
    r = c.get(f"/api/projects/{pid}/graph")
    assert r.status_code == 200
    assert r.json()["graph"] is None


def test_no_migrate_empty_member_serial(tmp_path: Path) -> None:
    c = _client(tmp_path)
    pid = _create_project(c)
    c.post(f"/api/projects/{pid}/members", json={"kind": "tag", "serial": "", "nodePath": "", "hip": "", "label": ""})
    r = c.get(f"/api/projects/{pid}/graph")
    assert r.status_code == 200
    assert r.json()["graph"] is None
