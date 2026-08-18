"""Shared bridge state singleton used by REST / WS / MCP."""
from __future__ import annotations

import asyncio
import os
import threading
import time
from pathlib import Path

from .channels import ChannelRegistry
from .logs import LogRing
from .mapping import MappingRegistry
from .projects import ProjectRegistry
from .protocol import (
    SYNC_FPS_DEFAULT,
    SYNC_FPS_MAX,
    SYNC_FPS_MIN,
    OutputBuffer,
)
from .registry import SerialRegistry
from .trace import TraceStore
from .ui_layout import UiLayoutStore
from .workspace import WorkspaceStore


# per-serial kick rate limit: at most one armed kick per window per serial (defensive
# against client storms re-posting /kick on WS reconnect churn)
_KICK_MIN_INTERVAL = 2.0


class BridgeState:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.registry = SerialRegistry(data_dir / "registry.json")
        self.channels = ChannelRegistry(data_dir / "channels.json")
        self.projects = ProjectRegistry(data_dir / "projects.json")
        # 映射系统（v0.1.00114）：逻辑名 -> 相对地址，锚点 = 吊牌 serial（移动容错）
        self.mappings = MappingRegistry(data_dir / "mappings.json")
        self.trace = TraceStore()
        self.workspaces = WorkspaceStore()
        self.logs = LogRing()
        self.ui_layout = UiLayoutStore(data_dir / "ui-layout.json")
        self._kick_lock = threading.Lock()
        self._kicks: dict[str, bool] = {}
        self._kick_last: dict[str, float] = {}  # monotonic ts of last armed kick
        # per-serial sync max fps (bridge-side receive+forward cap), in-memory only
        # (the web Preference.json is the persistent source)
        self._sync_fps_lock = threading.Lock()
        self._sync_fps: dict[str, int] = {}
        self._sync_enabled_lock = threading.Lock()
        self._sync_enabled: dict[str, bool] = {}
        # /stream long-poll waiters + coalescing state (per-serial)
        self._stream_lock = threading.Lock()
        self._stream_events: dict[str, set[asyncio.Event]] = {}
        self._stream_last_wake: dict[str, float] = {}
        self._stream_handles: dict[str, asyncio.TimerHandle] = {}
        # WS output broadcast coalescing state (per-serial, latest-wins by index)
        self._bcast_lock = threading.Lock()
        self._bcast_pending: dict[str, dict[int, OutputBuffer]] = {}
        self._bcast_rev: dict[str, int] = {}
        self._bcast_last: dict[str, float] = {}
        self._bcast_handles: dict[str, asyncio.TimerHandle] = {}

    # --- sync max fps (1..60, default 30) -----------------------------------

    def set_sync_fps(self, serial: str, fps: int) -> int:
        """Store the per-serial sync cap, clamped to [SYNC_FPS_MIN, SYNC_FPS_MAX].

        Returns the stored (clamped) value. In-memory only - the web persists the
        value in Preference.json."""
        fps = int(fps)
        fps = max(SYNC_FPS_MIN, min(SYNC_FPS_MAX, fps))
        with self._sync_fps_lock:
            self._sync_fps[serial] = fps
        return fps

    def get_sync_fps(self, serial: str) -> int:
        with self._sync_fps_lock:
            return self._sync_fps.get(serial, SYNC_FPS_DEFAULT)

    def set_sync_enabled(self, serial: str, enabled: bool) -> bool:
        with self._sync_enabled_lock:
            self._sync_enabled[serial] = bool(enabled)
        return bool(enabled)

    def get_sync_enabled(self, serial: str) -> bool:
        with self._sync_enabled_lock:
            return self._sync_enabled.get(serial, False)  # 默认 False（本地模式）

    # --- one-shot kick ------------------------------------------------------

    def set_kick(self, serial: str) -> None:
        """Arm a one-shot force marker: the next /pending or /stream for this serial returns force=True."""
        with self._kick_lock:
            self._kicks[serial] = True

    def take_kick(self, serial: str) -> bool:
        """Consume the force marker (one-shot) - True while a kick is pending."""
        with self._kick_lock:
            return self._kicks.pop(serial, False)

    def try_arm_kick(self, serial: str) -> bool:
        """Rate-limited one-shot kick arming (POST /kick defensive throttle).

        Returns True when the kick was armed (and the per-serial timestamp recorded);
        returns False when a kick was armed within the last _KICK_MIN_INTERVAL seconds
        for this serial (client storm guard - no arm, no touch, no notify)."""
        now = time.monotonic()
        with self._kick_lock:
            last = self._kick_last.get(serial)
            if last is not None and now - last < _KICK_MIN_INTERVAL:
                return False
            self._kick_last[serial] = now
            self._kicks[serial] = True
            return True

    # --- /stream long-poll waiters ------------------------------------------

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
        """Wake every /stream long-poll waiter for this serial, coalesced to <= sync fps.

        Called only from the main event loop (routes.put_outputs accepted, ws.py edit
        branch accepted, routes.kick armed) - asyncio.Event is single-loop safe there
        and loop.call_later is available. Within a 1/fps window extra notifies only arm
        (once) a call_later that fires the single latest wake at the window edge;
        waiters are looked up at fire time so late subscribers still get woken. A waiter
        re-evaluates rev/kick on wake."""
        now = time.monotonic()
        interval = 1.0 / self.get_sync_fps(serial)
        with self._stream_lock:
            last = self._stream_last_wake.get(serial, 0.0)
            if now - last >= interval:
                handle = self._stream_handles.pop(serial, None)
                self._stream_last_wake[serial] = now
                events = list(self._stream_events.get(serial, ()))
            else:
                if serial in self._stream_handles:
                    return  # timer already armed; latest state is sent at the window edge
                loop = asyncio.get_running_loop()
                delay = interval - (now - last)
                self._stream_handles[serial] = loop.call_later(delay, self._wake_stream, serial)
                return
        if handle is not None:
            handle.cancel()
        for event in events:
            event.set()

    def _wake_stream(self, serial: str) -> None:
        """Timer callback: fire the coalesced /stream wake for a serial."""
        with self._stream_lock:
            self._stream_handles.pop(serial, None)
            self._stream_last_wake[serial] = time.monotonic()
            events = list(self._stream_events.get(serial, ()))
        for event in events:
            event.set()

    # --- WS broadcast coalescing (latest-wins by index) ---------------------

    def stage_broadcast(self, serial: str, accepted: list[OutputBuffer], rev: int) -> None:
        """Stage edited output buffers for the per-serial WS broadcast.

        Buffers are merged by index (latest-wins) into a per-serial pending set; the
        flush broadcasts the merged set at most once per 1/fps window. Only called from
        the main event loop (routes.put_outputs, ws.py edit branch) - asyncio safe."""
        with self._bcast_lock:
            pending = self._bcast_pending.setdefault(serial, {})
            for buf in accepted:
                pending[int(buf.index)] = buf
            self._bcast_rev[serial] = rev
            now = time.monotonic()
            interval = 1.0 / self.get_sync_fps(serial)
            last = self._bcast_last.get(serial, 0.0)
            if now - last >= interval:
                handle = self._bcast_handles.pop(serial, None)
                self._bcast_last[serial] = now
                due = True
            else:
                if serial in self._bcast_handles:
                    return  # flush already armed; merged state is picked up at fire time
                loop = asyncio.get_running_loop()
                delay = interval - (now - last)
                handle = loop.call_later(delay, self._arm_broadcast_flush, serial)
                self._bcast_handles[serial] = handle
                return
        if handle is not None:
            handle.cancel()
        if due:
            loop = asyncio.get_running_loop()
            loop.create_task(self._flush_broadcast(serial))

    def _arm_broadcast_flush(self, serial: str) -> None:
        """Timer callback: spawn the async broadcast flush for a serial."""
        with self._bcast_lock:
            self._bcast_handles.pop(serial, None)
        loop = asyncio.get_running_loop()
        loop.create_task(self._flush_broadcast(serial))

    async def _flush_broadcast(self, serial: str) -> None:
        """Broadcast the coalesced pending outputs to this serial's WS clients."""
        with self._bcast_lock:
            self._bcast_handles.pop(serial, None)
            pending = self._bcast_pending.pop(serial, None)
            rev = self._bcast_rev.pop(serial, 0)
        if not pending:
            return
        from .ws import manager  # local import: avoids ws <-> state circular import

        outs = [pending[k] for k in sorted(pending)]
        await manager.broadcast(
            serial,
            {"type": "outputs", "outputs": [o.model_dump() for o in outs], "rev": rev},
        )


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
