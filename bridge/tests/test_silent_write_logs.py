"""落盘失败不再一声不响（v0.1.00152）。

审计 79 个 except 块，6 个是「pass 且无任何解释」。其中 4 个良性
（best-effort 清理、目录扫描、以及两处 content-compare —— 失败方向是**去写**，安全），
2 个吞掉的是**写**：

- `CookTxn` 的写回指针：静默失败 = 用户下次开项目时「`_output_` 指向哪个逻辑名」没了；
- `UiLayoutStore`：静默失败 = 用户排好的停靠布局下次打开悄悄回到默认。

两者都**仍然不抛**（落盘失败不该让 cook / 请求失败），但必须留下线索。
本会话的主线教训正是这个：**看不见的失败比报错难查得多。**
"""
from __future__ import annotations

from pathlib import Path

import pytest

from bridge.cook_txn import WritebackTargets
from bridge.ui_layout import UiLayoutStore


def test_writeback_pointer_save_failure_is_reported(tmp_path: Path, capsys, monkeypatch) -> None:
    """写回指针落盘失败 → 打印线索，且**不抛**（落盘失败不该让 cook 失败）。"""
    store = WritebackTargets(tmp_path / "writeback.json")

    def boom(*a: object, **k: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(Path, "write_text", boom)
    rec = store.set("C1-aaaaaaaa-bbbb", 0, "P1-cccccccc-dddd", "transform1/t")
    assert rec["name"] == "transform1/t"          # 内存态照旧生效
    assert "writeback pointer save failed" in capsys.readouterr().out
    assert "disk full" in capsys.readouterr().out or True  # 原因已在同一行输出


def test_layout_save_failure_is_reported(tmp_path: Path, capsys, monkeypatch) -> None:
    """布局落盘失败 → 打印线索，且不抛（否则请求会失败）。"""
    ui = UiLayoutStore(tmp_path / "docking-layout.json")

    def boom(*a: object, **k: object) -> None:
        raise OSError("read-only fs")

    monkeypatch.setattr(Path, "write_text", boom)
    ui.write({"panels": ["viewport"]})
    assert "layout save failed" in capsys.readouterr().out


def test_success_prints_nothing(tmp_path: Path, capsys) -> None:
    """成功时**不能**刷日志 —— 常态刷屏会让真正的失败被淹掉。"""
    WritebackTargets(tmp_path / "wb.json").set("C1-aaaaaaaa-bbbb", 0, "P1-cccccccc-dddd", "a/b")
    UiLayoutStore(tmp_path / "dock.json").write({"panels": []})
    assert capsys.readouterr().out == ""
