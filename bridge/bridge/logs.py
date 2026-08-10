"""Ring-buffer logs shared by REST/WS/MCP."""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any

LEVELS = {"debug": 10, "info": 20, "warning": 30, "error": 40}


class LogEntry:
    __slots__ = ("ts", "level", "source", "serial", "message")

    def __init__(self, ts: float, level: str, source: str, message: str, serial: str | None = None) -> None:
        self.ts = ts
        self.level = level
        self.source = source
        self.message = message
        self.serial = serial

    def to_dict(self) -> dict[str, Any]:
        return {
            "ts": self.ts,
            "level": self.level,
            "source": self.source,
            "serial": self.serial,
            "message": self.message,
        }


class LogRing:
    def __init__(self, capacity: int = 1000) -> None:
        self._buf: deque[LogEntry] = deque(maxlen=capacity)
        self._lock = threading.Lock()

    def add(self, level: str, source: str, message: str, serial: str | None = None) -> None:
        level = level.lower() if level.lower() in LEVELS else "info"
        with self._lock:
            self._buf.append(LogEntry(time.time(), level, source, message, serial))

    def info(self, source: str, message: str, serial: str | None = None) -> None:
        self.add("info", source, message, serial)

    def error(self, source: str, message: str, serial: str | None = None) -> None:
        self.add("error", source, message, serial)

    def query(self, level: str | None = None, limit: int = 200, serial: str | None = None) -> list[dict[str, Any]]:
        min_level = LEVELS.get((level or "debug").lower(), 10)
        with self._lock:
            out = [
                e.to_dict()
                for e in self._buf
                if LEVELS.get(e.level, 10) >= min_level and (serial is None or e.serial == serial)
            ]
        return out[-limit:]

    def errors(self, serial: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        return self.query(level="error", limit=limit, serial=serial)
