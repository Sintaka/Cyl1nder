"""既无 entry 引用、又无通道行的锚点，装配时删掉（v0.1.00154）。

实测（Houdini 真实重启后）：`C1-mt07aw69-cvtl` 的通道行已被 v0.1.00145 的同坑位扫描
判定陈旧并删除，可它的**锚点记录还在** —— 通道表与映射表是两份账，那次只扫了前者。
于是磁盘上留着一条永不自愈的死 pid（其余锚点都随 cook 更新到了新 pid=38336）。

**判据必须两条同时成立。** v0.1.00153 我只用了"没有 entry 引用"，当场被
`test_pid_port_persistence_round_trip` 判红：吊牌先经心跳登记锚点，entry 要等带 `rel`
的通道注册才建出来；空吊牌（entries=''）更是永远只有锚点没有 entry。
"""
from __future__ import annotations

import json
from pathlib import Path

from bridge.protocol import generate_serial
from bridge.state import BridgeState

TAG_PATH = "/obj/geo1/tag1"


def _seed(tmp_path: Path, anchors: dict, rows: list[dict]) -> Path:
    d = tmp_path / "data"
    d.mkdir(parents=True, exist_ok=True)
    (d / "mappings.json").write_text(
        json.dumps({"anchors": anchors, "entries": {}}), encoding="utf-8"
    )
    (d / "channels.json").write_text(json.dumps(rows), encoding="utf-8")
    return d


def _anchor(serial: str, pid: int) -> dict:
    return {"serial": serial, "nodePath": TAG_PATH, "hip": "D:/x.hip", "mode": "parm",
            "pid": pid, "mcpPort": 8100}


def test_orphan_anchor_is_dropped(tmp_path: Path) -> None:
    """无 entry 且无通道行 → 删。"""
    dead = generate_serial()
    st = BridgeState(_seed(tmp_path, {dead: _anchor(dead, 28720)}, []))
    assert st.mappings.get_anchor(dead) is None


def test_anchor_with_channel_row_is_kept(tmp_path: Path) -> None:
    """有通道行 → **留**。这正是 v0.1.00153 判据漏掉的那一半：

    吊牌先经心跳登记锚点，entry 要等带 `rel` 的通道注册才建出来；空吊牌永远只有锚点
    没有 entry。只看 entry 会误删刚登记的锚点。
    """
    live = generate_serial()
    rows = [{"kind": "tag", "serial": live, "nodePath": TAG_PATH, "hip": "D:/x.hip"}]
    st = BridgeState(_seed(tmp_path, {live: _anchor(live, 38336)}, rows))
    assert st.mappings.get_anchor(live) is not None
