"""Per-HDA serial registry.

Rules (see devlog/decisions.md):
- serial is created ONCE on the HDA node (hidden parm cyl1nder_serial) and never changes.
- registry record is immutable after creation (createdAt stays); re-contact only updates
  lastSeen + mutable identity fields (nodePath/label/hip).
- duplicate creation with a *new* serial never happens from the HDA; copy/paste nodes get
  a freshly generated serial.

Save policy (v0.1.00057): touch()/mark_activity() are heartbeat/footprint updates that
happen every frame during 60Hz drags - they only mark the registry dirty and the actual
disk write is debounced to at most one save per second so synchronous disk I/O never
blocks the event loop. register()/remove() are persistence-critical and save immediately.
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

from .protocol import is_valid_serial

# touch/mark_activity writes are debounced: at most one disk save per second.
_SAVE_DEBOUNCE = 1.0  # seconds


class RegistryError(Exception):
    pass


class RegistryRecord:
    __slots__ = ("serial", "hip", "nodePath", "label", "createdAt", "lastSeen", "lastActivity")

    def __init__(
        self,
        serial: str,
        hip: str = "",
        nodePath: str = "",
        label: str = "",
        createdAt: float | None = None,
        lastSeen: float | None = None,
        lastActivity: float | None = None,
    ) -> None:
        now = time.time()
        self.serial = serial
        self.hip = hip
        self.nodePath = nodePath
        self.label = label
        self.createdAt = createdAt if createdAt is not None else now
        self.lastSeen = lastSeen if lastSeen is not None else now
        self.lastActivity = lastActivity if lastActivity is not None else 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "serial": self.serial,
            "hip": self.hip,
            "nodePath": self.nodePath,
            "label": self.label,
            "createdAt": self.createdAt,
            "lastSeen": self.lastSeen,
            "lastActivity": self.lastActivity,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "RegistryRecord":
        return cls(
            serial=str(d.get("serial", "")),
            hip=str(d.get("hip", "")),
            nodePath=str(d.get("nodePath", "")),
            label=str(d.get("label", "")),
            createdAt=float(d.get("createdAt", 0) or 0),
            lastSeen=float(d.get("lastSeen", 0) or 0),
            lastActivity=float(d.get("lastActivity", 0) or 0),
        )


class SerialRegistry:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path
        self._records: dict[str, RegistryRecord] = {}
        self._lock = threading.Lock()
        self._dirty = False
        self._last_saved = 0.0
        if path is not None and path.exists():
            self._load(path)

    def register(
        self,
        serial: str,
        hip: str = "",
        nodePath: str = "",
        label: str = "",
    ) -> RegistryRecord:
        """First-contact registration (idempotent for the same serial)."""
        with self._lock:
            if not is_valid_serial(serial):
                raise RegistryError(f"invalid serial: {serial!r}")
            now = time.time()
            if serial in self._records:
                rec = self._records[serial]
                rec.lastSeen = now
                if hip:
                    rec.hip = hip
                if nodePath:
                    rec.nodePath = nodePath
                if label:
                    rec.label = label
            else:
                rec = RegistryRecord(serial, hip=hip, nodePath=nodePath, label=label)
                self._records[serial] = rec
            self._save(force=True)
            return rec

    def get(self, serial: str) -> RegistryRecord | None:
        with self._lock:
            return self._records.get(serial)

    def touch(self, serial: str) -> None:
        """Heartbeat: update lastSeen. Auto-registers a valid serial on first
        contact so an HDA that only polls /pending reappears after a bridge
        restart (registration otherwise only happens via push_inputs on cook,
        so an idle HDA would never re-register)."""
        with self._lock:
            rec = self._records.get(serial)
            if rec is None:
                if not is_valid_serial(serial):
                    return
                rec = RegistryRecord(serial=serial)
                self._records[serial] = rec
            rec.lastSeen = time.time()
            self._dirty = True
            self._save()

    def mark_activity(self, serial: str) -> None:
        """Record the last time this serial pushed data (inputs/outputs write).
        Auto-registers a valid serial as well (robustness for put flows)."""
        with self._lock:
            rec = self._records.get(serial)
            if rec is None:
                if not is_valid_serial(serial):
                    return
                rec = RegistryRecord(serial=serial)
                self._records[serial] = rec
            rec.lastActivity = time.time()
            self._dirty = True
            self._save()

    def remove(self, serial: str) -> bool:
        """Drop a registry record (used by scene cleanup for dead serials)."""
        with self._lock:
            if serial not in self._records:
                return False
            del self._records[serial]
            self._save(force=True)
            return True

    def list(self) -> list[RegistryRecord]:
        with self._lock:
            return [self._records[k] for k in sorted(self._records)]

    def serials(self) -> list[str]:
        with self._lock:
            return sorted(self._records)

    def _save(self, force: bool = False) -> None:
        """Persist records atomically (tmp + replace).

        Debounce: touch()/mark_activity() only mark dirty and skip the write while
        the last actual save is < _SAVE_DEBOUNCE ago, so 60Hz drags don't block the
        event loop with synchronous disk I/O. register()/remove() pass force=True to
        keep persistence on the critical path (a freshly registered/removed serial
        must survive a crash immediately). Callers hold self._lock."""
        if self._path is None:
            return
        now = time.time()
        if not force:
            if not self._dirty:
                return
            if now - self._last_saved < _SAVE_DEBOUNCE:
                return
        self._dirty = False
        self._last_saved = now
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = [r.to_dict() for r in self._records.values()]
        tmp = self._path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp.replace(self._path)

    def _load(self, path: Path) -> None:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        for item in data if isinstance(data, list) else []:
            rec = RegistryRecord.from_dict(item)
            if rec.serial:
                self._records[rec.serial] = rec
