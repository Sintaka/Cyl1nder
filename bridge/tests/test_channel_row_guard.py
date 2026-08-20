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


def test_load_keeps_tag_rows_without_rel(tmp_path: Path) -> None:
    """tag 行的 `rel` 本来就是空（它是吊牌自身的标记行）—— 绝不能被 rel 筛选连带删掉。"""
    import json

    s = generate_serial()
    p = tmp_path / "channels.json"
    p.write_text(json.dumps([{"kind": "tag", "serial": s, "nodePath": "/obj/geo1/tag1"}]), encoding="utf-8")
    assert len(ChannelRegistry(p).list()) == 1
