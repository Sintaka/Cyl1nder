"""轨迹查询路由（见 devlog/tag-hda-plan.md P3）。

- GET /api/trace?project=&actor=&action=&channel=&target=&limit=
  -> {"events": [...], "count": <过滤后总数>}

project 过滤 = 成员关系解析：is_valid_project_serial 校验 + st.projects.get；
不存在项目 -> 空 events。命中集合 = 该项目成员的通道 key
（tag/hda -> serial；param -> absolutePath，语义同 ProjectRegistry._channel_key）。
actor/action/channel/target 精确匹配（空 = 不过滤）；limit 默认 200、钳 1..1000；
count = 过滤后总数（不受 limit 截断）。

main.py 由主进程挂载本 router（本文件不改 main.py）。
"""
from __future__ import annotations

from fastapi import APIRouter

from .projects import ProjectRegistry
from .protocol import is_valid_project_serial
from .state import get_state

router = APIRouter()


def _project_channel_keys(project: dict) -> set[str]:
    """项目成员的通道 key 集合（tag/hda -> serial；param -> absolutePath）。"""
    keys = set()
    for member in project.get("members") or []:
        key = ProjectRegistry._channel_key(member)
        if key:
            keys.add(key)
    return keys


@router.get("/api/trace")
async def trace(
    project: str = "",
    actor: str = "",
    action: str = "",
    channel: str = "",
    target: str = "",
    limit: int = 200,
) -> dict:
    st = get_state()
    events = st.trace._filtered(actor=actor, action=action, channel=channel, target=target)
    if project:
        if not is_valid_project_serial(project) or st.projects.get(project) is None:
            return {"events": [], "count": 0}
        keys = _project_channel_keys(st.projects.get(project) or {})
        events = [e for e in events if e["channel"] in keys]
    limit = max(1, min(1000, limit))
    return {"events": events[:limit], "count": len(events)}
