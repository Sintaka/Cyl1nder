"""pid 扫空的失败短缓存（v0.1.00134）。

病象（实测）：Houdini 重启后，未重新 cook 的吊牌其锚点记录还是**旧 pid**（心跳只在
cook 时发，旧 pid 会长期留着）。于是每次读都「探记录端口 → pid 不符 → 扫 8100..8115
找那个已不存在的 pid」，16 端口 × 1s = **每次读固定多花 ~15s**
（实测同一条 GET 三次：15217 / 15271 / 15286 ms）。
"""
from __future__ import annotations

from bridge import mapping_routes as mr


def _reset() -> None:
    mr._pid_miss_at.clear()


def test_miss_is_cached_so_the_16s_scan_runs_once(monkeypatch) -> None:
    _reset()
    calls: list[int] = []

    def fake_scan(pid: int):
        calls.append(pid)
        return None  # 扫空

    monkeypatch.setattr(mr, "_find_port_by_pid", fake_scan)
    assert mr._find_port_by_pid_cached(28720) is None
    assert mr._find_port_by_pid_cached(28720) is None
    assert mr._find_port_by_pid_cached(28720) is None
    assert calls == [28720]  # 只真扫了一次


def test_hit_is_never_cached(monkeypatch) -> None:
    """命中**从不**缓存：端口在实例重开后会变，命中必须现探才可靠。"""
    _reset()
    calls: list[int] = []

    def fake_scan(pid: int):
        calls.append(pid)
        return (8100, {"pid": pid})

    monkeypatch.setattr(mr, "_find_port_by_pid", fake_scan)
    assert mr._find_port_by_pid_cached(57720) == (8100, {"pid": 57720})
    assert mr._find_port_by_pid_cached(57720) == (8100, {"pid": 57720})
    assert calls == [57720, 57720]  # 两次都真探了


def test_ttl_expiry_allows_one_more_scan(monkeypatch) -> None:
    """30s 后允许再扫一次 —— 万一那个实例真的回来了，不至于永久失联。"""
    _reset()
    calls: list[int] = []
    monkeypatch.setattr(mr, "_find_port_by_pid", lambda pid: (calls.append(pid), None)[1])

    now = [1000.0]
    monkeypatch.setattr(mr.time, "time", lambda: now[0])
    assert mr._find_port_by_pid_cached(1) is None
    now[0] += mr._PID_MISS_TTL - 1  # 还在窗口内
    assert mr._find_port_by_pid_cached(1) is None
    assert calls == [1]
    now[0] += 2  # 越过 TTL
    assert mr._find_port_by_pid_cached(1) is None
    assert calls == [1, 1]


def test_recovered_pid_clears_the_miss(monkeypatch) -> None:
    """扫到了就清掉失败标记，别让一次失败把后续命中也压住。"""
    _reset()
    mr._pid_miss_at[42] = 0.0  # 很久以前失败过（TTL 已过）
    monkeypatch.setattr(mr, "_find_port_by_pid", lambda pid: (8103, {"pid": pid}))
    assert mr._find_port_by_pid_cached(42) == (8103, {"pid": 42})
    assert 42 not in mr._pid_miss_at


def test_zero_pid_never_scans(monkeypatch) -> None:
    """pid=0（旧吊牌构建没上报 pid）不该触发任何扫描。"""
    _reset()
    called = False

    def fake(pid: int):
        nonlocal called
        called = True
        return None

    monkeypatch.setattr(mr, "_find_port_by_pid", fake)
    assert mr._find_port_by_pid_cached(0) is None
    assert called is False
