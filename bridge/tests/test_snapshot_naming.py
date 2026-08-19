"""快照目录命名与位置：

- `<场景名>_<serial>` 兄弟目录 + 旧目录兜底/迁移（v0.1.00117）
- **成员嵌进项目目录** `<hipstem>_<pid>/members/<serial>/` + graph 不再写（v0.1.00122）
"""
from __future__ import annotations

import json
from pathlib import Path

from bridge.scenes import cleanup_scenes
from bridge.snapshot import (
    MEMBERS_DIR,
    _sanitize_dir_part,
    member_root,
    migrate_member_snapshot_dir,
    migrate_project_graph_dir,
    migrate_snapshot_dir,
    project_graph_root,
    project_scene_dir_name,
    read_project_graph,
    read_snapshot,
    resolve_project_id,
    scene_dir_name,
    snapshot_root,
    write_snapshot,
)
from bridge.protocol import generate_project_serial, generate_serial
from bridge.state import get_state, reset_state

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


# --- v0.1.00122 成员嵌进项目目录 -------------------------------------------------
#
# 用户要根除的形态：`<hipstem>_<C1-…>` 与 `<hipstem>_<P1-…>` 并列做兄弟。
# 目标：`<hipstem>_<P1-…>/members/<C1-…>/`。


def _bound_project(tmp_path: Path, monkeypatch) -> tuple[str, str, str]:
    """建一个真的「项目 + 成员」绑定 -> (hip, pid, serial)。

    走 state 而不是 mock：`resolve_project_id` 的全部意义就是从 state 里查出归属，
    塞假对象就等于不测它。
    """
    monkeypatch.delenv("CYL1NDER_SNAPSHOT_ROOT", raising=False)
    monkeypatch.setattr("bridge.snapshot.DEFAULT_ROOT", tmp_path / "fallback")
    reset_state(tmp_path / "data")
    hip = str(tmp_path / "beginTest-2.hip")
    serial = generate_serial()
    st = get_state()
    project, _ = st.projects.ensure_for_hip(hip)
    pid = project["projectSerial"]
    st.projects.add_member(pid, {"kind": "hda", "serial": serial, "nodePath": "/obj/x"})
    return hip, pid, serial


def test_member_snapshot_nests_under_project_dir(tmp_path: Path, monkeypatch) -> None:
    """核心断言：成员目录在项目目录**里面**，且不再有兄弟目录那种形态。"""
    hip, pid, serial = _bound_project(tmp_path, monkeypatch)
    base = tmp_path / "Cyl1nder"
    root = snapshot_root(hip, serial)
    assert root == base / f"beginTest-2_{pid}" / MEMBERS_DIR / serial
    assert root == member_root(hip, serial, pid)
    # 兄弟形态必须不再是写入目标（这正是用户要根除的东西）
    assert root != base / f"beginTest-2_{serial}"
    assert resolve_project_id(hip, serial) == pid


def test_write_lands_inside_project_and_no_sibling_dir(tmp_path: Path, monkeypatch) -> None:
    hip, pid, serial = _bound_project(tmp_path, monkeypatch)
    assert write_snapshot(serial, hip, inputs=[{"index": 0, "name": "in0"}]) is True
    base = tmp_path / "Cyl1nder"
    assert (base / f"beginTest-2_{pid}" / MEMBERS_DIR / serial / "io" / "inputs.json").is_file()
    # 盘上**只有**项目目录这一个顶层条目，没有 `beginTest-2_C1-…` 兄弟
    assert [d.name for d in base.iterdir()] == [f"beginTest-2_{pid}"]
    snap = read_snapshot(hip, serial)
    assert snap is not None and snap["inputs"] == [{"index": 0, "name": "in0"}]


def _seed_sibling(tmp_path: Path, hip: str, serial: str, name: str) -> Path:
    """在 hip 同侧造一个旧的兄弟快照目录（带 meta.json，形态与真快照一致）。"""
    old = tmp_path / "Cyl1nder" / name
    (old / "scene").mkdir(parents=True)
    (old / "scene" / "meta.json").write_text(
        json.dumps({"serial": serial, "old": True}), encoding="utf-8"
    )
    return old


def test_migrate_member_renames_sibling_into_project(tmp_path: Path, monkeypatch) -> None:
    hip, pid, serial = _bound_project(tmp_path, monkeypatch)
    old = _seed_sibling(tmp_path, hip, serial, f"beginTest-2_{serial}")
    assert migrate_member_snapshot_dir(hip, serial, pid) == "renamed"
    assert not old.exists()
    target = member_root(hip, serial, pid)
    assert json.loads((target / "scene" / "meta.json").read_text(encoding="utf-8"))["old"] is True


def test_migrate_member_also_takes_bare_serial_dir(tmp_path: Path, monkeypatch) -> None:
    """v0.1.00116 的裸 `<serial>` 目录也要能直接迁进项目（跳过中间那代命名）。"""
    hip, pid, serial = _bound_project(tmp_path, monkeypatch)
    old = _seed_sibling(tmp_path, hip, serial, serial)
    assert migrate_member_snapshot_dir(hip, serial, pid) == "renamed"
    assert not old.exists()
    assert (member_root(hip, serial, pid) / "scene" / "meta.json").is_file()


def test_migrate_member_skips_when_target_exists_and_never_loses_data(
    tmp_path: Path, monkeypatch
) -> None:
    """目标已存在 -> 谁都不动、两份都在；读退化成「仍从旧位置读到」，不是数据丢失。"""
    hip, pid, serial = _bound_project(tmp_path, monkeypatch)
    old = _seed_sibling(tmp_path, hip, serial, f"beginTest-2_{serial}")
    member_root(hip, serial, pid).mkdir(parents=True)     # 占位：迁移会 skip
    assert migrate_member_snapshot_dir(hip, serial, pid) == "skipped:target-exists"
    assert old.is_dir()
    # 新位置没有 meta.json，读必须回落到旧兄弟目录（`_legacy_roots` 兜底）
    snap = read_snapshot(hip, serial)
    assert snap is not None and snap["meta"]["old"] is True


def test_migrate_member_noop_without_hip_pid_or_source(tmp_path: Path, monkeypatch) -> None:
    hip, pid, serial = _bound_project(tmp_path, monkeypatch)
    assert migrate_member_snapshot_dir("", serial, pid) == ""
    assert migrate_member_snapshot_dir(hip, serial, "") == ""      # 无 pid：绝不编造
    assert migrate_member_snapshot_dir(hip, serial, pid) == ""     # 没有旧目录可迁


def test_member_workspace_round_trips_through_nested_dir(tmp_path: Path, monkeypatch) -> None:
    """成员工作区仍照常工作：flush 落进 members/<serial>/、restore 从那里读回来。

    这条是「换了目录会不会把成员工作区弄坏」的直接答案——走的是桥重启后恢复工作区的
    真实路径（`flush_workspace` -> `restore_workspace`），不是只比对路径字符串。
    """
    from bridge.protocol import InputPayload
    from bridge.snapshot import flush_workspace, restore_workspace

    hip, pid, serial = _bound_project(tmp_path, monkeypatch)
    st = get_state()
    st.registry.register(serial, hip=hip, nodePath="/obj/geo1/cyl1nder1", label="Cyl1nder")
    ws = st.workspaces.get_or_create(serial)
    ws.set_inputs([InputPayload(index=0, name="in0", pointCount=1, points=[[1, 2, 3]])])

    assert flush_workspace(serial) is True
    root = member_root(hip, serial, pid)
    assert (root / "io" / "inputs.json").is_file()
    assert (root / "scene" / "meta.json").is_file()

    # 桥重启：工作区清空，再从盘上恢复
    st.workspaces._workspaces.pop(serial, None)
    assert restore_workspace(serial, hip) is True
    restored = st.workspaces.get(serial)
    assert restored is not None
    assert [i.points for i in restored.inputs] == [[[1.0, 2.0, 3.0]]]


def test_graph_part_accepted_but_never_written(tmp_path: Path, monkeypatch) -> None:
    """accept-but-ignore：不抛、不写 node-graph.json，且只因 graph 而不算「写过」。"""
    hip, pid, serial = _bound_project(tmp_path, monkeypatch)
    assert write_snapshot(serial, hip, graph={"nodes": ["x"]}) is False
    assert not (member_root(hip, serial, pid) / "scene" / "node-graph.json").exists()
    # 提示可见（每 serial 一次），且不影响别的部分照常写
    assert any(
        "graph part ignored" in e["message"] for e in get_state().logs.query(serial=serial)
    )
    assert write_snapshot(serial, hip, graph={"nodes": ["x"]}, parm={"a": 1}) is True
    assert (member_root(hip, serial, pid) / "scene" / "node-parm.json").is_file()
    assert not (member_root(hip, serial, pid) / "scene" / "node-graph.json").exists()


def test_existing_member_graph_still_readable(tmp_path: Path, monkeypatch) -> None:
    """旧存档里的 node-graph.json 仍要读得到 —— 项目图的单成员缺省迁移读靠它。"""
    hip, pid, serial = _bound_project(tmp_path, monkeypatch)
    scene = member_root(hip, serial, pid) / "scene"
    scene.mkdir(parents=True)
    (scene / "node-graph.json").write_text(json.dumps({"nodes": ["legacy"]}), encoding="utf-8")
    snap = read_snapshot(hip, serial)
    assert snap is not None and snap["graph"] == {"nodes": ["legacy"]}


def test_falls_back_to_sibling_when_no_project_bound(tmp_path: Path, monkeypatch) -> None:
    """项目还没 ensure 出来时（put_inputs 首次写快照）退回旧兄弟目录，绝不编造 pid。"""
    monkeypatch.delenv("CYL1NDER_SNAPSHOT_ROOT", raising=False)
    monkeypatch.setattr("bridge.snapshot.DEFAULT_ROOT", tmp_path / "fallback")
    reset_state(tmp_path / "data")
    hip = str(tmp_path / "beginTest-2.hip")
    serial = generate_serial()
    assert resolve_project_id(hip, serial) == ""
    assert snapshot_root(hip, serial) == tmp_path / "Cyl1nder" / f"beginTest-2_{serial}"


def test_resolve_ignores_project_bound_to_another_hip(tmp_path: Path, monkeypatch) -> None:
    """成员挂在**别的 hip** 的项目下时不得命中：否则快照会写进另一个场景旁边。"""
    monkeypatch.delenv("CYL1NDER_SNAPSHOT_ROOT", raising=False)
    reset_state(tmp_path / "data")
    serial = generate_serial()
    st = get_state()
    other, _ = st.projects.ensure_for_hip(str(tmp_path / "other.hip"))
    st.projects.add_member(other["projectSerial"], {"kind": "hda", "serial": serial})
    assert resolve_project_id(str(tmp_path / "beginTest-2.hip"), serial) == ""


def test_env_override_stays_flat(tmp_path: Path, monkeypatch) -> None:
    """`CYL1NDER_SNAPSHOT_ROOT` 仍是扁平 `<root>/<serial>`（测试隔离目录不要项目层次）。"""
    monkeypatch.setenv("CYL1NDER_SNAPSHOT_ROOT", str(tmp_path / "snaps"))
    serial = generate_serial()
    assert snapshot_root(str(tmp_path / "beginTest-2.hip"), serial) == tmp_path / "snaps" / serial
