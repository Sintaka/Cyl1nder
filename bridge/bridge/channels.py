"""吊牌 HDA 通道注册表（关联注册大全，见 devlog/tag-hda-plan.md P1）。

key 规则：kind ∈ {"tag","hda"} -> serial；kind == "param" -> absolutePath。
落盘 bridge/data/channels.json（路径由 state 传入），结构照 SerialRegistry：
threading.Lock + _dirty + 1.0s debounce + tmp+replace + 容错 load。
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

# touch 写盘 debounce：最多每秒落一次盘（心跳/探测会高频刷新 lastSeen）。
_SAVE_DEBOUNCE = 1.0  # seconds


class ChannelRegistry:
    def __init__(self, path: Path | None = None, clock=None) -> None:
        self._path = path
        self._records: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._dirty = False
        self._last_saved = 0.0
        self._clock = clock if clock is not None else time.time
        if path is not None and path.exists():
            self._load(path)

    @staticmethod
    def _key_of(ref: dict) -> str:
        if ref.get("kind") == "param":
            return ref.get("absolutePath") or ""
        return ref.get("serial") or ""

    def register(self, ref: dict) -> dict:
        """upsert by key：已有 -> 保留 registeredAt；lastSeen=now；返回落库 ref。"""
        now = time.time()
        with self._lock:
            key = self._key_of(ref)
            if not key:
                raise ValueError("empty channel key")
            existing = self._records.get(key)
            registered_at = existing.get("registeredAt") if existing else 0.0
            rec = dict(ref)
            rec["registeredAt"] = registered_at or now
            rec["lastSeen"] = now
            self._records[key] = rec
            self._save(force=True)
            return dict(rec)

    def get(self, key: str) -> dict | None:
        with self._lock:
            rec = self._records.get(key)
            return dict(rec) if rec is not None else None

    def list(self) -> list[dict]:
        with self._lock:
            items = [dict(r) for r in self._records.values()]
        items.sort(key=lambda r: r.get("registeredAt", 0.0))
        return items

    def touch(self, key: str, ts: float) -> bool:
        """刷新 lastSeen；未知 key 返回 False（不自动注册）。"""
        with self._lock:
            rec = self._records.get(key)
            if rec is None:
                return False
            rec["lastSeen"] = ts
            self._dirty = True
            self._save()
            return True

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
            key = self._key_of(item)
            if key:
                self._records[key] = item
