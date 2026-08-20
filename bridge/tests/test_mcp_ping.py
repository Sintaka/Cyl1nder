"""`cyl1nder_ping` 必须**真的去问桥**（v0.1.00147）。

此前它读的是 **MCP 服务进程自己**的东西：`VERSION` 在模块加载时就绑定，`get_state()`
也是本进程的状态。于是它既不报桥的版本、也不证明桥活着 —— 而 docstring 承诺的正是
"Bridge liveness"。

实测撞到：桥重启在 `v0.1.00144`、`protocol.py` 已是 `00146`，而它报 `0.1.00124`
—— **第三个数字**，是 MCP 进程启动那一刻的常量，落后 22 个版本。
我自己被它误导过一次（据它得出"桥还活着"，之后不得不再打一次真 HTTP 才敢确认）。

**一个会说谎的诊断工具比没有诊断工具更坏**：它把排查引向错误的方向。
"""
from __future__ import annotations

import json
from pathlib import Path

from bridge import mcp_server
from bridge.state import reset_state


class _Resp:
    """够用的 urlopen 上下文管理器替身。"""

    def __init__(self, payload: dict) -> None:
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._raw

    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *a: object) -> bool:
        return False


def _ping():
    """取被 FastMCP 装饰过的底层函数（装饰器把它包成了 tool 对象）。"""
    fn = mcp_server.cyl1nder_ping
    return getattr(fn, "fn", None) or getattr(fn, "__wrapped__", None) or fn


def test_ping_reports_the_bridge_version_not_its_own(tmp_path: Path, monkeypatch) -> None:
    """版本取**桥的响应**，不是本进程加载时的常量。"""
    reset_state(tmp_path)
    monkeypatch.setattr(
        mcp_server.urllib.request,
        "urlopen",
        lambda *a, **k: _Resp({"status": "ok", "version": "9.9.99999", "serials": 7}),
    )
    body = _ping()()
    assert body["ok"] is True
    assert body["version"] == "9.9.99999", "必须来自桥，不是 mcp_server.VERSION"
    assert body["serials"] == 7
    # 本进程自己的版本单独报，两者不一致时一眼看出该重启谁
    assert body["mcpVersion"] == mcp_server.VERSION


def test_ping_reports_not_ok_when_bridge_is_down(tmp_path: Path, monkeypatch) -> None:
    """桥不在 → `ok: False`。此前它**恒为 True**，所以"桥活着"这个结论毫无依据。"""
    reset_state(tmp_path)

    def boom(*a: object, **k: object):
        raise OSError("connection refused")

    monkeypatch.setattr(mcp_server.urllib.request, "urlopen", boom)
    body = _ping()()
    assert body["ok"] is False
    assert "refused" in body["error"]
    assert body["mcpVersion"] == mcp_server.VERSION  # 仍报自己的版本，便于判断该重启谁
