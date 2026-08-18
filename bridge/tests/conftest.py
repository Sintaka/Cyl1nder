"""pytest 全局夹具：把默认快照根隔离到临时目录。

**为什么必须有这个文件**：`snapshot.DEFAULT_ROOT` 是模块级常量（import 时算好，指向真实的
`bridge/data/snapshots`）。任何不带 hip 的快照写入都会落到那里——即使用例用的是 tmp_path。
结果是**每跑一次 pytest 就在真实数据目录里制造几十个 C1-… 目录**：实测积累到 958 个
（其中 241 个由同一次运行造出），没有一个对应活节点。用户把这当成「历史残留」，
其实是测试污染。这里从根上断掉，而不是事后清扫。

实现选择：用 `monkeypatch.setattr` 覆盖 `DEFAULT_ROOT`，**不**用
`CYL1NDER_SNAPSHOT_ROOT` 环境变量。因为 `snapshot_root()` 里 env 的优先级高于一切，
一旦设了 env，`test_snapshot_restore.py` 里那些自己 patch `DEFAULT_ROOT` 来验证
「双根回退」的用例就再也走不到回退分支（实测会挂 2 个）。改成同一种机制后，
用例自己的 patch 天然覆盖本夹具的默认值，互不打架。
"""
from __future__ import annotations

import pytest

from bridge import snapshot as _snapshot


@pytest.fixture(autouse=True)
def _isolate_snapshot_root(tmp_path_factory, monkeypatch):
    """默认快照根指向独立临时目录，绝不写进 bridge/data/snapshots。

    用例若自行 patch `DEFAULT_ROOT`，以用例为准（后 patch 覆盖先 patch）。
    """
    root = tmp_path_factory.mktemp("snapshots")
    monkeypatch.setattr(_snapshot, "DEFAULT_ROOT", root)
    yield root
