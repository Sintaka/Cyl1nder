"""Shared bridge state singleton used by REST / WS / MCP."""
from __future__ import annotations

import asyncio
import os
import threading
from pathlib import Path

from .logs import LogRing
from .registry import SerialRegistry
from .ui_layout import UiLayoutStore
from .workspace import WorkspaceStore


class BridgeState:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.registry = SerialRegistry(data_dir / "registry.json")
        self.workspaces = WorkspaceStore()
        self.logs = LogRing()
        self.ui_layout = UiLayoutStore(data_dir / "ui-layout.json")
        self._kick_lock = threading.Lock()
        self._kicks: dict[str, bool] = {}
        self._stream_lock = threading.Lock()
        self._stream_events: dict[str, set[asyncio.Event]] = {}

    def set_kick(self, serial: str) -> None:
        """Arm a one-shot force marker: the next /pending or /stream for this serial returns force=True."""
        with self._kick_lock:
            self._kicks[serial] = True

    def take_kick(self, serial: str) -> bool:
        """Consume the force marker (one-shot) - True while a kick is pending."""
        with self._kick_lock:
            return self._kicks.pop(serial, False)

    def subscribe(self, serial: str) -> asyncio.Event:
        """Register a /stream long-poll waiter for this serial; returns a fresh Event.

        The caller must await event.wait() and then unsubscribe (finally)."""
        event = asyncio.Event()
        with self._stream_lock:
            self._stream_events.setdefault(serial, set()).add(event)
        return event

    def unsubscribe(self, serial: str, event: asyncio.Event) -> None:
        """Remove a /stream waiter (idempotent; called when the poll returns)."""
        with self._stream_lock:
            events = self._stream_events.get(serial)
            if events:
                events.discard(event)
                if not events:
                    self._stream_events.pop(serial, None)

    def notify_stream(self, serial: str) -> None:
        """Wake every /stream long-poll waiter for this serial.

        Called only from the main event loop (routes.put_outputs accepted,
        ws.py edit branch accepted, routes.kick armed) - asyncio.Event is
        single-loop safe there; a waiter re-evaluates rev/kick on wake."""
        with self._stream_lock:
            events = list(self._stream_events.get(serial, ()))
        for event in events:
            event.set()


_state: BridgeState | None = None


def default_data_dir() -> Path:
    env = os.environ.get("CYL1NDER_DATA_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "data"


def get_state() -> BridgeState:
    global _state
    if _state is None:
        _state = BridgeState(default_data_dir())
    return _state


def reset_state(data_dir: Path) -> BridgeState:
    """Test helper: fresh state bound to a temp data dir."""
    global _state
    _state = BridgeState(data_dir)
    return _state
