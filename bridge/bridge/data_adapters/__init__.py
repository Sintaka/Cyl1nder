"""非 geo 数据源通道的 bridge 侧读写器注册表（P4v1，见 devlog/tag-hda-plan.md P4）。"""
from __future__ import annotations

from .apex_anim import ApexAnimDataAdapter

ADAPTERS: dict[str, object] = {a.name: a for a in (ApexAnimDataAdapter(),)}


def get_adapter(name: str):   # -> adapter | None
    return ADAPTERS.get(name)
