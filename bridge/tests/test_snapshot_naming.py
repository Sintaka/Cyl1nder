"""快照目录命名 `<场景名>_<serial>` + 旧目录兜底/迁移（v0.1.00117）。"""
from __future__ import annotations

import json
from pathlib import Path

from bridge.snapshot import (
    _sanitize_dir_part,
    migrate_snapshot_dir,
    read_snapshot,
    scene_dir_name,
    snapshot_root,
)
from bridge.protocol import generate_serial

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


def test_migrate_is_noop_without_hip_or_legacy(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("CYL1NDER_SNAPSHOT_ROOT", raising=False)
    assert migrate_snapshot_dir("", generate_serial()) == ""
    # hip 有但没有旧目录 -> 无事可做
    assert migrate_snapshot_dir(str(tmp_path / "x.hip"), generate_serial()) == ""
