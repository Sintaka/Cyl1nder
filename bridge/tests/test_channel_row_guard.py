"""通道注册表拒绝坏行（v0.1.00143）。

实测桥里有两条永久垃圾（`bridge/data/channels.json`）：

1. `{"kind":"tag","serial":"c", nodePath:"/obj/geo1/Cyl1nderTag2", …}`
   —— `is_valid_serial("c")` 是 False，可 `register` 从不看 serial（只查 key 非空），
   于是它进来了。单字符像"取了首字符"之类的截断事故，一次性写坏而无人拦。
2. `{"kind":"param", absolutePath:"…/transform1/ty", …}` **没有 `rel` 字段**
   —— v0.1.00114（逻辑名/锚点）之前的遗留，在端口下拉里显示成 `rel: (none) type: -`，
   点了也解析不出东西。

为什么必须在写入口拦：param 行的 serial 决定它归哪个吊牌，而 `retire_except` 按 serial
退役条目 —— 无效 serial 的行**永远退不掉**。铁律说 serial 是识别节点的唯一依据，
那么写入口就该是它的守门人。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from bridge.channels import ChannelRegistry
from bridge.protocol import generate_serial


def test_register_rejects_invalid_serial(tmp_path: Path) -> None:
    """`serial:"c"` 这类被桥自己的校验判为无效的号 → 拒绝，不进注册表。"""
    reg = ChannelRegistry(tmp_path / "channels.json")
    with pytest.raises(ValueError, match="invalid serial"):
        reg.register({"kind": "tag", "serial": "c", "nodePath": "/obj/geo1/Cyl1nderTag2"})
    assert reg.list() == []


def test_register_rejects_missing_serial(tmp_path: Path) -> None:
    """无 serial 的 param 行也拒绝 —— 它永远退不掉（retire_except 按 serial 过滤）。"""
    reg = ChannelRegistry(tmp_path / "channels.json")
    with pytest.raises(ValueError, match="invalid serial"):
        reg.register({"kind": "param", "serial": None, "absolutePath": "/obj/geo1/transform1/tx"})
    assert reg.list() == []


def test_register_accepts_valid_row(tmp_path: Path) -> None:
    """正常行照常写入（守卫不能把好行也挡掉）。"""
    reg = ChannelRegistry(tmp_path / "channels.json")
    s = generate_serial()
    reg.register({"kind": "param", "serial": s, "absolutePath": "/obj/geo1/transform1/tx", "rel": "transform1/tx"})
    assert [r["rel"] for r in reg.list()] == ["transform1/tx"]


def test_load_drops_bad_serial_and_relless_rows(tmp_path: Path) -> None:
    """**载入时自愈**：磁盘上已有的坏行被丢掉，重启一次就干净。

    手工改 channels.json 是没用的（桥退出时用内存态覆写），所以自愈必须发生在 load。
    """
    import json

    good = generate_serial()
    p = tmp_path / "channels.json"
    p.write_text(
        json.dumps(
            [
                {"kind": "tag", "serial": "c", "nodePath": "/obj/geo1/Cyl1nderTag2"},
                {"kind": "param", "serial": good, "absolutePath": "/a/ty", "rel": ""},
                {"kind": "param", "serial": good, "absolutePath": "/a/tx", "rel": "transform1/tx"},
                {"kind": "tag", "serial": good, "nodePath": "/obj/geo1/tag1"},
            ]
        ),
        encoding="utf-8",
    )
    reg = ChannelRegistry(p)
    kept = reg.list()
    # 只留：合法 serial 且（tag 行 | param 行带 rel）
    assert sorted(r.get("absolutePath") or r["nodePath"] for r in kept) == ["/a/tx", "/obj/geo1/tag1"]


def test_load_drops_stale_tag_on_same_node(tmp_path: Path) -> None:
    """同 `(hip, nodePath)` 有两个 tag 行 → 只留**心跳最新**的（v0.1.00145）。

    判据自证、不必问 Houdini：serial 不可变，所以一个节点在一个 hip 里只能有一个 serial；
    同坑位出现两个就必有一个是旧的（复制/删除节点留下），而心跳只来自节点自己 cook 时。

    实测撞到的就是这个：`/obj/geo1/Cyl1nderTag2` 同时挂着 `C1-mt09nkms-bwxp`（08-20）
    与 `C1-mt07aw69-cvtl`（08-19），用 MCP 读活节点得到的是前者。
    """
    import json

    cur, stale = generate_serial(), generate_serial()
    p = tmp_path / "channels.json"
    p.write_text(
        json.dumps(
            [
                {"kind": "tag", "serial": stale, "nodePath": "/obj/geo1/Tag2", "hip": "a.hip", "lastSeen": 100.0},
                {"kind": "tag", "serial": cur, "nodePath": "/obj/geo1/Tag2", "hip": "a.hip", "lastSeen": 200.0},
            ]
        ),
        encoding="utf-8",
    )
    kept = ChannelRegistry(p).list()
    assert [r["serial"] for r in kept] == [cur]


def test_load_keeps_same_node_across_different_hips(tmp_path: Path) -> None:
    """跨 hip 的同名节点**不算冲突** —— 那是另一个文件里的登记，重开那个文件就该用它。"""
    import json

    a, b = generate_serial(), generate_serial()
    p = tmp_path / "channels.json"
    p.write_text(
        json.dumps(
            [
                {"kind": "tag", "serial": a, "nodePath": "/obj/geo1/tag", "hip": "one.hip", "lastSeen": 100.0},
                {"kind": "tag", "serial": b, "nodePath": "/obj/geo1/tag", "hip": "two.hip", "lastSeen": 200.0},
            ]
        ),
        encoding="utf-8",
    )
    assert len(ChannelRegistry(p).list()) == 2


def test_load_keeps_quiet_tag_when_no_collision(tmp_path: Path) -> None:
    """**只做相对比较，绝不按心跳年龄单独判死**。

    devlog 记过实测有活吊牌 2938s 未 cook —— "很久没心跳"只说明"最近没 cook"。
    单独一个很旧的 tag 行必须留着。
    """
    import json

    s = generate_serial()
    p = tmp_path / "channels.json"
    p.write_text(
        json.dumps([{"kind": "tag", "serial": s, "nodePath": "/obj/geo1/tag", "hip": "a.hip", "lastSeen": 1.0}]),
        encoding="utf-8",
    )
    assert len(ChannelRegistry(p).list()) == 1


def test_load_keeps_tag_rows_without_rel(tmp_path: Path) -> None:
    """tag 行的 `rel` 本来就是空（它是吊牌自身的标记行）—— 绝不能被 rel 筛选连带删掉。"""
    import json

    s = generate_serial()
    p = tmp_path / "channels.json"
    p.write_text(json.dumps([{"kind": "tag", "serial": s, "nodePath": "/obj/geo1/tag1"}]), encoding="utf-8")
    assert len(ChannelRegistry(p).list()) == 1
