"""快照目录命名 `<场景名>_<serial>` + 旧目录兜底/迁移（v0.1.00117）。"""
from __future__ import annotations

import json
from pathlib import Path

from bridge.scenes import cleanup_scenes
from bridge.snapshot import (
    _sanitize_dir_part,
    migrate_project_graph_dir,
    migrate_snapshot_dir,
    project_graph_root,
    project_scene_dir_name,
    read_project_graph,
    read_snapshot,
    scene_dir_name,
    snapshot_root,
)
from bridge.protocol import generate_project_serial, generate_serial
from bridge.state import reset_state

def test_scene_dir_name_prefixes_hip_stem() -> None:
    s = generate_serial()
    assert scene_dir_name("D:/proj/beginTest-1.hip", s) == f"beginTest-1_{s}"
    # 拿不到 hip 名 -> 退回纯 serial（不产出 "_serial" 这种怪名）
    assert scene_dir_name("", s) == s


def test_sanitize_rejects_unsafe_and_bounds_length() -> None:
    assert _sanitize_dir_part("a:b*c?") == "a_b_c_"   # Windows 非法字符
    assert _sanitize_dir_part("name.") == "name"       # 结尾点 Windows 会拒
    assert _sanitize_dir_part("  x  ") == "x"
    assert len(_sanitize_dir_part("x" * 200)) == 64    # 限长防路径超长
    assert _sanitize_dir_part("...") == ""             # 清空 -> 调用方退回 serial

def test_read_finds_legacy_serial_only_dir(tmp_path: Path, monkeypatch) -> None:
    """改名当天既有快照必须仍读得到，否则等于凭空造一次数据丢失。"""
    monkeypatch.delenv("CYL1NDER_SNAPSHOT_ROOT", raising=False)
    monkeypatch.setattr("bridge.snapshot.DEFAULT_ROOT", tmp_path / "fallback")
    s = generate_serial()
    hip = str(tmp_path / "beginTest-1.hip")
    legacy = tmp_path / "Cyl1nder" / s / "scene"        # 旧命名：纯 serial
    legacy.mkdir(parents=True)
    (legacy / "meta.json").write_text(json.dumps({"serial": s, "old": True}), encoding="utf-8")

    # 新目录名与旧目录名确实不同（否则这条测试没意义）
    assert snapshot_root(hip, s).name == f"beginTest-1_{s}"
    got = read_snapshot(hip, s)
    assert got is not None and got["meta"]["old"] is True

def _seed_legacy(tmp_path: Path, serial: str) -> tuple[str, Path, Path]:
    hip = str(tmp_path / "beginTest-1.hip")
    base = tmp_path / "Cyl1nder"
    old = base / serial
    (old / "scene").mkdir(parents=True)
    (old / "scene" / "meta.json").write_text(json.dumps({"serial": serial}), encoding="utf-8")
    return hip, old, base / f"beginTest-1_{serial}"


def test_migrate_renames_legacy_dir(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("CYL1NDER_SNAPSHOT_ROOT", raising=False)
    s = generate_serial()
    hip, old, target = _seed_legacy(tmp_path, s)
    assert migrate_snapshot_dir(hip, s) == "renamed"
    assert not old.exists()
    assert (target / "scene" / "meta.json").is_file()


def test_migrate_skips_when_target_exists(tmp_path: Path, monkeypatch) -> None:
    """目标已存在 -> 谁都不动。两边都可能有用户数据，合并语义得由人定。"""
    monkeypatch.delenv("CYL1NDER_SNAPSHOT_ROOT", raising=False)
    s = generate_serial()
    hip, old, target = _seed_legacy(tmp_path, s)
    target.mkdir()
    assert migrate_snapshot_dir(hip, s) == "skipped:target-exists"
    assert old.is_dir() and target.is_dir()


def test_project_graph_dir_is_named_after_project_serial(tmp_path: Path) -> None:
    """项目图目录名 = `<hip名>_<P1-…>`（**项目** serial，不是成员的 C1-）。"""
    pid = generate_project_serial()
    hip = str(tmp_path / "beginTest-2.hip")
    assert project_scene_dir_name(hip, pid) == f"beginTest-2_{pid}"
    assert project_scene_dir_name("", pid) == pid          # 无 hip 名 -> 裸 pid
    root = project_graph_root(tmp_path / "data", pid, hip)
    assert root == tmp_path / "Cyl1nder" / f"beginTest-2_{pid}"
    # 无 hip 绑定 -> legacy 路径逐字不变
    assert project_graph_root(tmp_path / "data", pid) == tmp_path / "data" / "projects" / pid


def _seed_legacy_graph(tmp_path: Path, pid: str) -> tuple[str, Path, Path]:
    hip = str(tmp_path / "beginTest-2.hip")
    legacy = tmp_path / "data" / "projects" / pid
    legacy.mkdir(parents=True)
    (legacy / "graph.json").write_text(json.dumps({"nodes": ["old"]}), encoding="utf-8")
    return hip, legacy, tmp_path / "Cyl1nder" / f"beginTest-2_{pid}"


def test_migrate_project_graph_renames_legacy_dir(tmp_path: Path) -> None:
    pid = generate_project_serial()
    hip, legacy, target = _seed_legacy_graph(tmp_path, pid)
    assert migrate_project_graph_dir(tmp_path / "data", pid, hip) == "renamed"
    assert not legacy.exists()
    assert json.loads((target / "graph.json").read_text(encoding="utf-8")) == {"nodes": ["old"]}


def test_migrate_project_graph_skips_when_target_exists(tmp_path: Path) -> None:
    """目标已存在 -> 谁都不动，且**两份图都还在**（不合并、不覆盖）。"""
    pid = generate_project_serial()
    hip, legacy, target = _seed_legacy_graph(tmp_path, pid)
    target.mkdir(parents=True)
    (target / "graph.json").write_text(json.dumps({"nodes": ["new"]}), encoding="utf-8")
    assert migrate_project_graph_dir(tmp_path / "data", pid, hip) == "skipped:target-exists"
    assert json.loads((legacy / "graph.json").read_text(encoding="utf-8")) == {"nodes": ["old"]}
    assert json.loads((target / "graph.json").read_text(encoding="utf-8")) == {"nodes": ["new"]}
    # hip 侧优先，但旧位置那份仍在原地
    assert read_project_graph(tmp_path / "data", pid, hip) == {"nodes": ["new"]}


def test_migrate_project_graph_noop_without_hip_or_legacy(tmp_path: Path) -> None:
    pid = generate_project_serial()
    assert migrate_project_graph_dir(tmp_path / "data", pid, "") == ""
    # hip 有但旧位置没图 -> 无事可做
    assert migrate_project_graph_dir(tmp_path / "data", pid, str(tmp_path / "x.hip")) == ""


def test_read_project_graph_falls_back_to_legacy_when_migration_skipped(tmp_path: Path) -> None:
    """迁移没成功也**绝不丢图**：退化成「仍从旧位置读到」，而不是数据丢失。

    用 target-exists（hip 侧目录存在但**没有** graph.json）造出「迁移被跳过」的状态：
    此时 hip 侧无图、旧位置有图，读必须仍然命中旧位置。这条正是让迁移可以安全上线的性质。
    """
    pid = generate_project_serial()
    hip, legacy, target = _seed_legacy_graph(tmp_path, pid)
    target.mkdir(parents=True)          # 占位：迁移会 skip:target-exists
    assert read_project_graph(tmp_path / "data", pid, hip) == {"nodes": ["old"]}
    assert legacy.is_dir()              # 旧位置未被动过


def test_scenes_cleanup_never_deletes_project_graph_dir(tmp_path: Path, monkeypatch) -> None:
    """`POST /api/scenes/cleanup` 绝不能删项目图目录——那会毁掉用户的项目图。

    这里刻意把快照扫描根**指到项目图目录的父目录**（最坏情况：两者同住一处），
    再确认扫描仍然放过它。两道独立闸门都挡：目录名过不了 `is_valid_serial`
    （`^C1-…$`，`beginTest-2_P1-…` 不匹配），且项目图目录形状本就没有 io/ 与 meta.json。
    顺带确认真会删的东西（空的合法 serial 目录）仍被删，证明用例没有空转。
    """
    base = tmp_path / "Cyl1nder"
    base.mkdir()
    monkeypatch.setenv("CYL1NDER_SNAPSHOT_ROOT", str(base))
    reset_state(tmp_path / "data")

    pid = generate_project_serial()
    graph_dir = base / f"beginTest-2_{pid}"
    graph_dir.mkdir()
    (graph_dir / "graph.json").write_text(json.dumps({"nodes": []}), encoding="utf-8")

    doomed = base / generate_serial()   # 合法 serial + 空 -> 该被删
    doomed.mkdir()

    removed = cleanup_scenes()["removed"]
    assert (graph_dir / "graph.json").is_file()                     # 项目图完好
    assert pid not in [e["serial"] for e in removed]
    assert not doomed.exists()                                      # 清理确实在工作
    assert {"serial": doomed.name, "reason": "empty"} in removed


def test_migrate_is_noop_without_hip_or_legacy(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("CYL1NDER_SNAPSHOT_ROOT", raising=False)
    assert migrate_snapshot_dir("", generate_serial()) == ""
    # hip 有但没有旧目录 -> 无事可做
    assert migrate_snapshot_dir(str(tmp_path / "x.hip"), generate_serial()) == ""
