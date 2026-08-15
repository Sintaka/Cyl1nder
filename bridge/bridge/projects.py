"""吊牌 HDA 项目注册表（多 HDA 绑定，见 devlog/tag-hda-plan.md P2a）。

落盘 bridge/data/projects.json（路径由 state 传入），结构照 ChannelRegistry：
threading.Lock + _dirty + 1.0s debounce + tmp+replace + 容错 load。
成员是 channelRef 引用快照（live 状态以 /api/channels 大全为准），
key 规则同 channels._key_of：kind=tag/hda -> serial；kind=param -> absolutePath。
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from .protocol import generate_project_serial

# 成员增删写盘防抖：最多每秒落一次盘。
_SAVE_DEBOUNCE = 1.0  # seconds


class ProjectRegistry:
    def __init__(self, path: Path | None = None, clock=None) -> None:
        self._path = path
        self._records: dict[str, dict] = {}  # projectSerial -> project dict
        self._lock = threading.Lock()
        self._dirty = False
        self._last_saved = 0.0
        self._clock = clock if clock is not None else time.time
        if path is not None and path.exists():
            self._load(path)

    @staticmethod
    def _channel_key(ref: dict) -> str:
        if ref.get("kind") in ("param", "data"):
            return ref.get("absolutePath") or ""
        return ref.get("serial") or ""

    def create(self, label: str = "") -> dict:
        """建项目：P1- serial + createdAt/updatedAt=now + members=[]，立即落盘（force）。"""
        now = time.time()
        rec = {
            "projectSerial": generate_project_serial(),
            "label": label,
            "createdAt": now,
            "updatedAt": now,
            "members": [],
        }
        with self._lock:
            self._records[rec["projectSerial"]] = rec
            self._save(force=True)
        return dict(rec)

    def get(self, pid: str) -> dict | None:
        with self._lock:
            rec = self._records.get(pid)
            return dict(rec) if rec is not None else None

    def list(self) -> list[dict]:
        with self._lock:
            items = [dict(r) for r in self._records.values()]
        items.sort(key=lambda r: r.get("createdAt", 0.0))
        return items

    def add_member(self, pid: str, ref: dict) -> dict | None:
        """按 _channel_key 去重：已存在 -> 整体替换该成员；updatedAt=now；项目不存在返回 None。"""
        with self._lock:
            rec = self._records.get(pid)
            if rec is None:
                return None
            key = self._channel_key(ref)
            members = rec["members"]
            for i, m in enumerate(members):
                if self._channel_key(m) == key:
                    members[i] = dict(ref)
                    break
            else:
                members.append(dict(ref))
            rec["updatedAt"] = time.time()
            self._save(force=True)
            return dict(rec)

    def remove_member(self, pid: str, channel_key: str) -> bool:
        """按通道 key 移除成员（成员不存在/项目不存在 -> False）；移除成功刷 updatedAt。"""
        with self._lock:
            rec = self._records.get(pid)
            if rec is None:
                return False
            members = rec["members"]
            for i, m in enumerate(members):
                if self._channel_key(m) == channel_key:
                    del members[i]
                    rec["updatedAt"] = time.time()
                    self._save(force=True)
                    return True
            return False

    def save_now(self) -> None:
        with self._lock:
            self._save(force=True)

    def _save(self, force: bool = False) -> None:
        """原子落盘（tmp + replace）；非 force 走 debounce。调用方持有 _lock。"""
        if self._path is None:
            return
        now = self._clock()
        if not force:
            if not self._dirty:
                return
            if now - self._last_saved < _SAVE_DEBOUNCE:
                return
        self._dirty = False
        self._last_saved = now
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = list(self._records.values())
        tmp = self._path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp.replace(self._path)

    def _load(self, path: Path) -> None:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        for item in data if isinstance(data, list) else []:
            if not isinstance(item, dict):
                continue
            pid = item.get("projectSerial")
            if pid:
                self._records[pid] = item
