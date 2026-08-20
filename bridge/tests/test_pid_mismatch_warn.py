"""陈旧锚点 pid 落到别的实例时必须**说出来**（v0.1.00136）。

这条路径存在一个真实张力：`_resolve_port_for_anchor` 的立身理由就是「不要用
`discover_first()` 拿第一个活口当答案」，可它第 3 步退回 `_resolve_port`，而那里恰恰
会调 `discover_first()`。于是陈旧 pid 的锚点会**静默**落到别的实例上。

实测这个状态真的存在：锚点 `C1-msz03wf5-u0ym` 记 pid=28720（Houdini 重启前），
而 8100 上现在是 pid=57720 —— 读成功了，只是打在了另一个 pid 上。

不拒绝（单实例重启是最常见用法，拒绝会弄坏能用的东西），不自动采纳（那是被明令禁止
的猜测，多开 Houdini 会写错实例），所以选：照旧解析 + pid 不符就 WARN 一次。

**本文件存在的另一个理由**：写这段时我调了 `logs.warn(...)`，而 `LogRing` 没有 warn()
（LEVELS 里也是 "warning" 不是 "warn"）—— 421 个测试**全绿**，因为没有一条走这条路径。
"""
from __future__ import annotations

from bridge import mapping_routes as mr
from bridge.state import get_state, reset_state


def _warnings(serial: str) -> list[str]:
    """取该 serial 的 warning 及以上。

    读 API 是 `query(level, limit, serial)` 且返回 **dict**（不是对象）——
    我第一版写成 `logs.list()` 里过滤 `e.level`，两处都错。
    `level="warning"` 在 LEVELS 里是 >=30，所以 warning 与 error 都会带回来。
    """
    return [e["message"] for e in get_state().logs.query(level="warning", serial=serial)]


def test_pid_mismatch_warns_once(tmp_path, monkeypatch) -> None:
    """pid 不符 → WARN 一次；重复读不再刷同一条。"""
    reset_state(tmp_path)
    mr._PID_MISMATCH_WARNED.clear()
    monkeypatch.setattr(mr, "_resolve_port", lambda s: 8100)
    monkeypatch.setattr(mr, "_probe_health", lambda p: {"pid": 57720})

    assert mr._fallback_port_warned("C1-aaaaaaaa-bbbb", 28720) == 8100
    assert mr._fallback_port_warned("C1-aaaaaaaa-bbbb", 28720) == 8100
    w = _warnings("C1-aaaaaaaa-bbbb")
    assert len(w) == 1
    assert "28720" in w[0] and "57720" in w[0]  # 两个 pid 都要点名，否则用户无从判断


def test_pid_match_does_not_warn(tmp_path, monkeypatch) -> None:
    """pid 相符是正常情形，绝不出警告（否则警告会变成噪音、被忽略）。"""
    reset_state(tmp_path)
    mr._PID_MISMATCH_WARNED.clear()
    monkeypatch.setattr(mr, "_resolve_port", lambda s: 8100)
    monkeypatch.setattr(mr, "_probe_health", lambda p: {"pid": 28720})
    assert mr._fallback_port_warned("C1-cccccccc-dddd", 28720) == 8100
    assert _warnings("C1-cccccccc-dddd") == []
