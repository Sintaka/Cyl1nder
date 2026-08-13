"""Bidirectional /stream sync pump + recook scheduling for the Cyl1nder HDA (3.1 split)."""
from __future__ import annotations

import threading
import time

import hou

from cyl1nder_bridge import BridgeClient
from cyl1nder_cache import _OUT_CACHE, _PUSH_CACHE, _refresh_ready, _reset_caches, _reset_ready
from cyl1nder_lifecycle import _parm

_SYNC: dict[str, dict] = {}
_STREAM_HOLD = 60.0
_STREAM_RETRY = 0.5
_RECOOK_LOG_ONCE: set[str] = set()
_SYNC_FPS_DEFAULT = 30
_SYNC_FPS_MIN = 1
_SYNC_FPS_MAX = 60


def _stream_loop(
    serial: str,
    node_path: str,
    bridge_url: str,
    client: BridgeClient | None = None,
    sleep_fn=time.sleep,
    now_fn=time.time,
) -> None:
    """Bidirectional sync pump: event-driven NDJSON long-poll /stream.

    Each iteration issues one held GET /stream?since=&hold=_STREAM_HOLD; data
    events (outputs/kick/reset) wake immediately and double as the heartbeat
    (LiveLink principle) - no extra polling, and an idle hold is ~1 req/min.
    Connection errors back off _STREAM_RETRY before retrying; a
    {"type":"timeout"} event reconnects immediately (idle keep-alive). The loop
    exits cleanly when its stop event is set (stop_sync / stop_all_sync) or when
    its _SYNC entry is removed / replaced by a restart.

    NEVER touches hou.* in this thread: HOM is not thread-safe and a background
    hou.node() probe racing a reload / node rebuild is the HDA crash root
    cause. Node-liveness is handled on the cook main thread: ensure_sync()
    refreshes _SYNC[serial]["aliveAt"] every cook and calls stop_sync() when
    hou.node(root.path()) is gone.

    The HDA receive-side rate cap (sync_fps, default 30, clamp 1..60) throttles
    the outputs/kick "pull + schedule recook" action to at most `fps`
    times/second (latest-wins): an event inside the window only bumps last_seen
    and is dropped - the next event after the window pulls the newest state.
    reset (bridge restart) is a rare critical path that bypasses the cap: it
    always drops the per-serial caches and pulls + schedules a recook (the
    `scheduled` gate still prevents overlapping recooks). A numeric `fps` on any
    event overrides the runtime cap. sleep_fn/now_fn/client are injectable for
    the hython smoke.
    """
    # Capture this serial's state ONCE: after a stop_sync / ensure_sync restart,
    # _SYNC[serial] is replaced with a fresh dict (new stop event) - the old
    # thread must keep its own reference so it exits on stop instead of
    # re-reading the new entry and running with stale module code.
    state = _SYNC.get(serial)
    if state is None:
        return
    client = client if client is not None else BridgeClient(serial, bridge_url=bridge_url)
    last_seen = 0
    last_action = 0.0  # now_fn() of the last pull+schedule action (rate cap window)
    _refresh_ready(client, serial)  # warm the ready buffer at startup (background)
    while True:
        if state["stop"].is_set() or _SYNC.get(serial) is not state:
            return  # stopped / entry removed / restart replaced it -> old loop exits
        ev = client.stream_once(last_seen, hold=_STREAM_HOLD)
        if ev is None:
            # connection error (bridge down / malformed line) -> back off, retry
            sleep_fn(_STREAM_RETRY)
            continue
        etype = ev.get("type")
        rev = int(ev.get("rev", 0) or 0)
        fps = ev.get("fps")
        if isinstance(fps, (int, float)):
            # bridge forwards the per-serial sync fps -> override the runtime cap
            state["fps"] = max(_SYNC_FPS_MIN, min(_SYNC_FPS_MAX, int(fps)))
        if etype == "timeout":
            continue  # idle keep-alive: reconnect immediately, no sleep
        if etype == "reset":
            # bridge restarted: rev went backwards - re-pull everything from 0.
            last_seen = 0
            _reset_ready(serial)  # in-memory op - always applied, no HTTP
            _reset_caches(serial)  # -> next recook re-pushes inputs, rebuilds outputs
            # reset is a rare critical path: bypass the fps throttle (the
            # `scheduled` gate still prevents overlapping recooks) and act now.
            last_action = now_fn()
            _refresh_ready(client, serial)
            if not state["scheduled"]:
                state["scheduled"] = True
                _schedule_recook(node_path)
            continue
        if etype in ("outputs", "kick"):
            last_seen = max(last_seen, rev)
            now = now_fn()
            if now - last_action < 1.0 / state.get("fps", _SYNC_FPS_DEFAULT):
                continue  # rate-capped: only last_seen advanced; next event pulls latest
            last_action = now
            if client.last_error:
                # self-heal: a previous push failed (e.g. bridge still starting);
                # drop the push cache so this recook re-pushes and clears last_error.
                _PUSH_CACHE.pop(serial, None)
            _refresh_ready(client, serial)  # ready buffer fresh before the recook lands
            if not state["scheduled"]:
                state["scheduled"] = True
                _schedule_recook(node_path)


def _schedule_recook(node_path: str) -> None:
    try:
        import hdefereval  # graphical Houdini only
        hdefereval.executeDeferred(_force_cook_node, node_path)
    except Exception as exc:  # noqa: BLE001
        # Never fail silently: if hdefereval is unavailable (headless hython /
        # shell), there is no deferred recook. Log it once per node_path - the
        # recovery loop still closes because the reset branch already cleared
        # _PUSH_CACHE, so the next cook (Force Cook / input change) re-pushes
        # and re-pulls on its own.
        if node_path not in _RECOOK_LOG_ONCE:
            _RECOOK_LOG_ONCE.add(node_path)
            print(
                f"[cyl1nder_hda] _schedule_recook({node_path!r}) unavailable: {exc}; "
                f"no deferred recook. Headless? Press Force Cook - the next cook / "
                f"input change re-pulls anyway (reset already cleared _PUSH_CACHE)."
            )


def _force_cook_node(node_path: str) -> None:
    try:
        n = hou.node(node_path)
        if n is None:
            return
        _serial_parm = n.parm("cyl1nder_serial")
        serial = _serial_parm.eval() if _serial_parm else ""
        _state = _SYNC.get(serial)
        if serial:
            _OUT_CACHE.pop(serial, None)  # dirty -> recook must re-pull from bridge
        if _state is not None:
            _state["scheduled"] = False
        sp = n.parm("status")
        if sp is not None and sp.eval() != "dirty":
            try:
                sp.set("dirty")
            except Exception:  # noqa: BLE001
                pass
        for c in n.children():
            if c.type().name() in ("python", "blast", "output"):
                try:
                    c.cook(force=True)
                except Exception:  # noqa: BLE001
                    pass
    except Exception:  # noqa: BLE001
        pass


def stop_sync(serial: str) -> None:
    """Stop one serial's background /stream loop (main-thread safe).

    Sets the stop event and joins the thread with a short timeout so a cook /
    reload never blocks on a long-poll (the loop is daemon - a poll still
    blocked in HTTP exits on its own once the bridge answers). The _SYNC entry
    is kept and marked stopped=True, so the next ensure_sync() restarts the
    loop idempotently with a fresh thread + stop event; the old thread holds
    its own state reference and exits on stop (no reload race, and this is the
    only path that may call hou.* - never the background thread).
    """
    state = _SYNC.get(serial)
    if state is None:
        return
    stop = state.get("stop")
    if stop is not None:
        stop.set()
    thread = state.get("thread")
    if thread is not None and thread.is_alive():
        thread.join(timeout=1.0)  # short timeout: daemon semantics, never block a cook
    state["stopped"] = True


def stop_all_sync() -> None:
    """Stop every background /stream loop.

    reload_hda.py calls this BEFORE importlib.reload() / hou.hda.reloadFile():
    a live _SYNC thread under a module reload is the HDA crash root cause (the
    thread holds stale references into the module being replaced). After the
    reload, the force recook re-enters ensure_sync(), which sees stopped=True
    and restarts the loops with the fresh module.
    """
    for serial in list(_SYNC.keys()):
        stop_sync(serial)


def ensure_sync(root: hou.Node, serial: str) -> None:
    """Start the event-driven /stream sync loop (idempotent, main-thread only).

    Runs from cook() / cook_core() on the cook main thread. sync_fps is the HDA
    receive-side rate cap (default 30, clamp 1..60): each outputs/kick event
    refreshes the ready buffer and schedules a recook at most `fps` times/second
    (latest-wins; the `scheduled` gate still prevents overlapping recooks).
    reset (bridge restart) bypasses the cap: it always clears the per-serial
    caches and refreshes + schedules a recook (rare critical path). A numeric
    `fps` on /stream events overrides the runtime value, so the parameter is the
    local defensive fallback when no web is driving the sync.

    HOM is not thread-safe, so hou.* stays on this main thread: every cook
    refreshes _SYNC[serial]["aliveAt"] as a liveness heartbeat, and if the HDA
    node itself is gone (deleted / not found at root.path()) the loop is
    stopped here via stop_sync() instead of the old background hou.node() probe
    (which raced reloads and crashed Houdini).
    """
    if not serial:
        return
    now = time.time()
    state = _SYNC.get(serial)
    if state is not None and not state.get("stopped") \
            and state.get("thread") is not None and state["thread"].is_alive():
        state["aliveAt"] = now  # main-thread heartbeat: this node cooked
        if hou.node(root.path()) is None:
            # node deleted -> stop the background loop (hou-safe: main thread)
            stop_sync(serial)
        return
    try:
        fps = int(_parm(root, "sync_fps", _SYNC_FPS_DEFAULT))
    except Exception:  # noqa: BLE001 - missing/odd parm falls back to the default cap
        fps = _SYNC_FPS_DEFAULT
    fps = max(_SYNC_FPS_MIN, min(_SYNC_FPS_MAX, fps))
    stop = threading.Event()
    state = {
        "thread": None,
        "stop": stop,
        "node_path": root.path(),
        "scheduled": False,
        "fps": fps,
        "aliveAt": now,
        "stopped": False,
    }
    _SYNC[serial] = state  # publish before start: _stream_loop captures this dict
    thread = threading.Thread(
        target=_stream_loop,
        args=(
            serial,
            root.path(),
            _parm(root, "bridge_url", "http://127.0.0.1:8375"),
        ),
        daemon=True,
    )
    state["thread"] = thread
    thread.start()
