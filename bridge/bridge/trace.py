"""内存环形轨迹存储（谁动了数据，见 devlog/tag-hda-plan.md P3）。

事件模型（协议三处同步）：{ts, project, channel, actor, action, target, digest}。
v1 不逐事件解析项目（project 恒 ""），查询时按项目成员关系过滤。
环形覆盖最旧；线程安全（Lock）；trace 写失败绝不影响主流程（add 内部吞异常）。
ndjson 按天落盘留 P3.5。
"""
from __future__ import annotations

import threading
import time
from collections import deque

TRACE_CAPACITY = 10000


class TraceStore:
    def __init__(self, capacity: int = TRACE_CAPACITY) -> None:
        self._buf: deque[dict] = deque(maxlen=capacity)
        self._lock = threading.Lock()

    def add(
        self,
        *,
        actor: str,
        action: str,
        channel: str = "",
        target: str = "",
        digest: str = "",
    ) -> dict:
        """记录一个事件；环形覆盖最旧；返回落库 event dict（拷贝）。

        ts=time.time()、project=""（v1 不逐事件解析项目，查询时按成员关系过滤）。
        内部 try/except 兜底：trace 写失败绝不影响主流程。
        """
        event = {
            "ts": time.time(),
            "project": "",
            "channel": channel,
            "actor": actor,
            "action": action,
            "target": target,
            "digest": digest,
        }
        try:
            with self._lock:
                self._buf.append(event)
        except Exception:
            pass  # 吞异常：trace 失败绝不影响主流程
        return dict(event)

    def list(
        self,
        *,
        actor: str = "",
        action: str = "",
        channel: str = "",
        target: str = "",
        limit: int = 200,
    ) -> list[dict]:
        """过滤（空 = 不过滤）+ 新→旧（ts 降序）返回；limit 钳制 1..1000。"""
        items = self._filtered(actor=actor, action=action, channel=channel, target=target)
        limit = max(1, min(1000, int(limit)))
        return items[:limit]

    def count(self) -> int:
        with self._lock:
            return len(self._buf)

    def _filtered(
        self,
        *,
        actor: str = "",
        action: str = "",
        channel: str = "",
        target: str = "",
    ) -> list[dict]:
        """全部命中事件的拷贝，ts 降序（无 limit，供查询端点算过滤后总数）。"""
        with self._lock:
            items = [
                dict(e)
                for e in self._buf
                if (not actor or e["actor"] == actor)
                and (not action or e["action"] == action)
                and (not channel or e["channel"] == channel)
                and (not target or e["target"] == target)
            ]
        items.sort(key=lambda e: e["ts"], reverse=True)
        return items
