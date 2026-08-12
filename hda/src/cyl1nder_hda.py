"""Runtime cook logic for the Cyl1nder HDA.

Two layouts are supported:
- runtime-optimized (current): ONE python SOP `cyl1nder_core` calls cook_core().
  It pushes all 4 inputs once, pulls all 4 outputs in ONE HTTP round-trip and
  writes a MERGED detail where every polyline prim carries a `cyl1nder_role`
  prim attribute (0..3). Four lightweight `blast` SOPs (grouptype=prims,
  group=@cyl1nder_role=N, negate=1) split the merged detail into out0..out3.
  => heavy work (serialize/HTTP/deserialize) happens ONCE per cook, not 4x.
- legacy (older HDA): 4 python SOPs each call cook(role); kept for backward
  compat with already-installed .hda files.

Editing this file is hot-reload friendly - no HDA rebuild needed.
"""
from __future__ import annotations

import os
import subprocess
import threading
import time
import urllib.request

import hou

from cyl1nder_bridge import BridgeClient, generate_serial
from cyl1nder_serializer import serialize_input

ROLE_PUSH = 0
INPUT_COUNT = 4

# bidirectional sync: web edits -> bridge stream events -> dirty -> recook
_SYNC: dict[str, dict] = {}

# event-driven /stream long-poll (hold=_STREAM_HOLD): a held request IS the idle
# heartbeat (~1 req/min when quiet) and outputs/kick/reset events wake it
# immediately - no extra polling (LiveLink: data frames are the heartbeat).
# _STREAM_RETRY is the reconnect backoff after a connection error.
_STREAM_HOLD = 60.0
_STREAM_RETRY = 0.5

# HDA receive-side rate cap (defensive): the outputs/kick/reset "pull + schedule
# recook" action runs at most `fps` times/second (latest-wins - events inside the
# window only bump last_seen, the next event after the window pulls the newest
# state). The runtime value starts from the HDA `sync_fps` parameter (default 30,
# clamp 1..60) and can be overridden by a numeric `fps` on any /stream event
# (bridge forwards the per-serial sync fps).
_SYNC_FPS_DEFAULT = 30
_SYNC_FPS_MIN = 1
_SYNC_FPS_MAX = 60

# content cache for the merged core detail (per serial) - prevents viewport flicker
# on unchanged Force Cooks; rebuild decision stays content-based (sync-architecture rule).
_CORE_CACHE: dict[str, dict] = {}

# scheme-B output cache: one network pull per cook round shared by all 4 roles.
# _force_cook_node clears it so dirty -> recook re-pulls (Houdini SOP cache semantics).
_OUT_CACHE: dict[str, dict] = {}
_OUT_LOCK = threading.Lock()

# ready buffer: outputs pulled by the BACKGROUND sync thread, never on the cook
# main thread. Cook only reads this cache; it stays valid until the bridge rev
# moves (web-side input change) or the process exits. latest-wins per role.
_READY: dict[str, dict] = {}
_READY_LOCK = threading.Lock()

# per-serial apply counters: hython smoke asserts cache-hit / fast-path / rebuild.
_STATS: dict[str, dict] = {}

# per (serial, role): cached output geometry + its exact topology signature.
# Built once per topology, then P is batch-updated natively and the geometry is
# copied into the cook output (~0.1ms). Valid until the next input change / close.
_GEO_CACHE: dict[tuple[str, int], dict] = {}

# per-serial exact input signature of the last push -> inputs are re-serialized
# and re-pushed only when they actually change (cache-until-input-change, push side).
_PUSH_CACHE: dict[str, tuple] = {}

# HDA owns bridge startup: if unreachable, spawn it (one attempt / 5s)
BRIDGE_PY = r"D:\code\dev\Cyl1nder\bridge\.venv\Scripts\python.exe"
BRIDGE_CWD = r"D:\code\dev\Cyl1nder\bridge"
NODE = r"C:\Program Files\nodejs\node.exe"
VITE_JS = r"D:\code\dev\Cyl1nder\web\node_modules\vite\bin\vite.js"
WEB_CWD = r"D:\code\dev\Cyl1nder\web"
_BRIDGE_LAST_SPAWN = 0.0
_UI_LAST_SPAWN = 0.0
# autostart health probes cost 1-25ms each (HTTP) and cook() runs per role SOP per
# recook - re-probing every cook would eat the whole 60fps budget. Rate-limit them.
_AUTOSTART_CHECK_INTERVAL = 2.0
_BRIDGE_LAST_CHECK = 0.0
_UI_LAST_CHECK = 0.0

def _ui_healthy() -> bool:
    """True when the web UI (vite on 8376) answers."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:8376/", timeout=0.4):
            return True
    except Exception:  # noqa: BLE001
        return False


def _ensure_frontend(root: hou.Node) -> None:
    """Bind the web UI lifecycle to the bridge: if 8376 is down, start vite (1 attempt / 10s)."""
    global _UI_LAST_SPAWN, _UI_LAST_CHECK
    if not bool(_parm(root, "bridge_autostart", 1)):
        return
    now = time.time()
    if now - _UI_LAST_CHECK < _AUTOSTART_CHECK_INTERVAL:
        return  # recently probed: skip the HTTP round-trip on this cook
    _UI_LAST_CHECK = now
    if _ui_healthy():
        return
    if now - _UI_LAST_SPAWN < 10.0:
        return
    _UI_LAST_SPAWN = now
    try:
        subprocess.Popen(
            [NODE, VITE_JS],
            cwd=WEB_CWD,
            env={k: v for k, v in os.environ.items() if not k.upper().startswith("PYTHON")},
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
        )
    except Exception:  # noqa: BLE001
        pass


def _bridge_healthy(bridge_url: str) -> bool:
    try:
        with urllib.request.urlopen(bridge_url.rstrip("/") + "/api/health", timeout=0.3):
            return True
    except Exception:  # noqa: BLE001
        return False


def _ensure_bridge(root: hou.Node) -> None:
    """If the bridge is unreachable, start it (one attempt per 5s)."""
    global _BRIDGE_LAST_SPAWN, _BRIDGE_LAST_CHECK
    if not bool(_parm(root, "bridge_autostart", 1)):
        return
    now = time.time()
    if now - _BRIDGE_LAST_CHECK < _AUTOSTART_CHECK_INTERVAL:
        return  # recently probed: skip the HTTP round-trip on this cook
    _BRIDGE_LAST_CHECK = now
    bridge_url = _parm(root, "bridge_url", "http://127.0.0.1:8375")
    if _bridge_healthy(bridge_url):
        return
    if now - _BRIDGE_LAST_SPAWN < 5.0:
        return
    _BRIDGE_LAST_SPAWN = now
    try:
        subprocess.Popen(
            [BRIDGE_PY, "-m", "bridge"],
            cwd=BRIDGE_CWD,
            env={k: v for k, v in os.environ.items() if not k.upper().startswith("PYTHON")},
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
        )
        _set_status(root, "starting bridge...")
    except Exception:  # noqa: BLE001
        pass


def _ready_state(serial: str) -> dict:
    """Get (or create) the serial's ready-buffer state."""
    with _READY_LOCK:
        st = _READY.get(serial)
        if st is None:
            st = {"rev": 0, "outputs": {}, "gen": 0, "error": ""}
            _READY[serial] = st
        return st


def _refresh_ready(client: BridgeClient, serial: str) -> None:
    """Background pull: refresh the ready buffer with outputs newer than its rev.

    Runs on the sync thread, never on the cook main thread. Only the changed
    roles' latest buffers are fetched (since=<ready rev>) and merged
    (latest-wins). The buffer stays valid until the next input change / close.
    """
    st = _ready_state(serial)
    with _READY_LOCK:
        since = st["rev"]
    outputs, new_rev = client.pull_outputs(since)
    with _READY_LOCK:
        if outputs is None:
            st["error"] = client.last_error or "pull failed"
            return
        st["error"] = ""
        if outputs:
            st["gen"] += 1
            for b in outputs:
                idx = int(b.get("index", -1))
                if idx >= 0:
                    b = dict(b)
                    b["_gen"] = st["gen"]  # cook skips identical buffers via this tag
                    st["outputs"][idx] = b
        st["rev"] = max(st["rev"], new_rev)


def _reset_ready(serial: str) -> None:
    """Bridge restart (rev went backwards): drop the ready buffer, re-pull from 0."""
    with _READY_LOCK:
        st = _READY.get(serial)
        if st is not None:
            st["rev"] = 0
            st["outputs"] = {}
            st["gen"] += 1


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
    exits cleanly on stop / _SYNC removal, or when node_path's Houdini node is
    gone (RequestSourceShutdown semantics).

    The HDA receive-side rate cap (sync_fps, default 30, clamp 1..60) throttles
    the outputs/kick/reset "pull + schedule recook" action to at most `fps`
    times/second (latest-wins): an event inside the window only bumps last_seen
    (plus reset's in-memory _reset_ready) and is dropped - the next event after
    the window pulls the newest state. A numeric `fps` on any event overrides
    the runtime cap. sleep_fn/now_fn/client are injectable for the hython smoke.
    """
    client = client if client is not None else BridgeClient(serial, bridge_url=bridge_url)
    last_seen = 0
    last_action = 0.0  # now_fn() of the last pull+schedule action (rate cap window)
    _refresh_ready(client, serial)  # warm the ready buffer at startup (background)
    while True:
        state = _SYNC.get(serial)
        if state is None or state["stop"].is_set():
            return
        if node_path and hou.node(node_path) is None:
            return  # node deleted -> clean shutdown (LiveLink RequestSourceShutdown)
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
            state = _SYNC.get(serial)
            if state is not None:
                state["fps"] = max(_SYNC_FPS_MIN, min(_SYNC_FPS_MAX, int(fps)))
        if etype == "timeout":
            continue  # idle keep-alive: reconnect immediately, no sleep
        if etype == "reset":
            # bridge restarted: rev went backwards - re-pull everything from 0
            last_seen = 0
            _reset_ready(serial)  # in-memory op - always applied, no HTTP
            state = _SYNC.get(serial)
            if state is None:
                continue
            now = now_fn()
            if now - last_action < 1.0 / state.get("fps", _SYNC_FPS_DEFAULT):
                continue  # rate-capped: next event after the window pulls latest
            last_action = now
            _refresh_ready(client, serial)
            if not state["scheduled"]:
                state["scheduled"] = True
                _schedule_recook(node_path)
            continue
        if etype in ("outputs", "kick"):
            last_seen = max(last_seen, rev)
            state = _SYNC.get(serial)
            if state is None:
                continue
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
    except Exception:  # noqa: BLE001 - headless hython: user presses Force Cook
        pass


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


def ensure_sync(root: hou.Node, serial: str) -> None:
    """Start the event-driven /stream sync loop (idempotent).

    sync_fps is the HDA receive-side rate cap (default 30, clamp 1..60): each
    outputs/kick/reset event refreshes the ready buffer and schedules a recook at
    most `fps` times/second (latest-wins; the `scheduled` gate still prevents
    overlapping recooks). A numeric `fps` on /stream events overrides the runtime
    value, so the parameter is the local defensive fallback when no web is
    driving the sync.
    """
    if not serial:
        return
    state = _SYNC.get(serial)
    if state is not None and state["thread"].is_alive():
        return
    try:
        fps = int(_parm(root, "sync_fps", _SYNC_FPS_DEFAULT))
    except Exception:  # noqa: BLE001 - missing/odd parm falls back to the default cap
        fps = _SYNC_FPS_DEFAULT
    fps = max(_SYNC_FPS_MIN, min(_SYNC_FPS_MAX, fps))
    stop = threading.Event()
    thread = threading.Thread(
        target=_stream_loop,
        args=(
            serial,
            root.path(),
            _parm(root, "bridge_url", "http://127.0.0.1:8375"),
        ),
        daemon=True,
    )
    thread.start()
    _SYNC[serial] = {
        "thread": thread,
        "stop": stop,
        "node_path": root.path(),
        "scheduled": False,
        "fps": fps,
    }


def _root(node: hou.Node) -> hou.Node:
    return node.parent()  # the HDA subnet root


def _ensure_serial(node: hou.Node) -> str:
    """Create-once immutable serial persisted in the hidden parm cyl1nder_serial."""
    root = _root(node)
    parm = root.parm("cyl1nder_serial")
    if parm is None:
        return ""
    val = parm.eval()
    if not val:
        val = generate_serial()
        parm.set(val)
    return val


def _parm(root: hou.Node, name: str, default):
    p = root.parm(name)
    if p is None:
        return default
    try:
        return p.eval()
    except Exception:  # noqa: BLE001
        return default


def _set_status(root: hou.Node, text: str) -> None:
    p = root.parm("status")
    if p is not None and p.eval() != text:
        try:
            p.set(text)
        except Exception:  # noqa: BLE001
            pass


def _serialize_geo(geo: hou.Geometry) -> dict:
    """Minimal (points, curves) snapshot of a geometry - no attributes."""
    pts = [
        [round(p.position().x(), 6), round(p.position().y(), 6), round(p.position().z(), 6)]
        for p in geo.points()
    ]
    curves = [{"pointIndices": [p.number() for p in prim.points()]} for prim in geo.prims()]
    return {"points": pts, "curves": curves}


def _build_detail(geo: hou.Geometry, buf: dict) -> None:
    """Build output detail from an OutputBuffer dict (points + polyline curves + width)."""
    pts_data = buf.get("points") or []
    curves = buf.get("curves") or []
    faces = buf.get("faces") or []
    created: list[hou.Point] = []
    for p in pts_data:
        pt = geo.createPoint()
        pt.setPosition(hou.Vector3(float(p[0]), float(p[1]), float(p[2])))
        created.append(pt)
    # mesh faces (closed polygons, e.g. a sphere) -> polygon prims
    for face in faces:
        prim = geo.createPolygon()  # closed by default
        for i in face:
            if 0 <= i < len(created):
                prim.addVertex(created[i])
    widths_attr = None
    for c in curves:
        prim = geo.createPolygon(is_closed=False)
        for i in c.get("pointIndices") or []:
            if 0 <= i < len(created):
                prim.addVertex(created[i])
        w = c.get("widths")
        if w:
            if widths_attr is None:
                widths_attr = geo.addAttrib(hou.attribType.Point, "width", 0.05)
            for k, idx in enumerate(c.get("pointIndices") or []):
                if k < len(w) and 0 <= idx < len(created):
                    created[idx].setAttribValue(widths_attr, float(w[k]))


def _buffer_sig(buf: dict) -> tuple:
    """Exact topology signature of an output buffer (points/curves/faces structure).

    Computed from plain buffer data (no hou objects), so it is cheap to compare
    per cook; the point/prim content itself is re-applied from the buffer, so the
    signature only has to be exact about STRUCTURE (counts + vertex indices).
    """
    curves = buf.get("curves") or []
    faces = buf.get("faces") or []
    return (
        len(buf.get("points") or []),
        tuple(tuple(int(i) for i in (c.get("pointIndices") or [])) for c in curves),
        tuple(tuple(int(i) for i in f) for f in faces),
    )


def _apply_output(geo: hou.Geometry, buf: dict, serial: str, role: int) -> None:
    """Apply one output buffer via a cached per-(serial, role) geometry.

    - same buffer as last apply (same _gen, O(1)) -> cache hit: copy the cached
      geometry (~0.1ms native), no rebuild.
    - topology unchanged (exact sig compare) -> batch P update on the cached
      geometry, then copy - no clear()/rebuild.
    - otherwise -> rebuild the cached geometry from the buffer (rare, topology
      change only). Content-based self-healing: topology drift rebuilds, position
      drift is fixed by re-writing P from the buffer.
    Counters feed the hython smoke assertions (cache hit / fast path / rebuild).
    """
    key = (serial, role)
    entry = _GEO_CACHE.get(key)
    stats = _STATS.setdefault(serial, {"rebuilds": 0, "fast_paths": 0, "skips": 0})
    if entry is not None and entry.get("buf_gen") == buf.get("_gen") \
            and len(entry["geo"].points()) == len(buf.get("points") or []):
        geo.copy(entry["geo"])
        stats["skips"] += 1
        return
    sig = _buffer_sig(buf)
    if entry is not None and entry["sig"] == sig:
        pts = buf.get("points") or []
        try:
            entry["geo"].setPointFloatAttribValues(
                "P", [float(v) for p in pts for v in p]
            )
            entry["buf_gen"] = buf.get("_gen")
            geo.copy(entry["geo"])
            stats["fast_paths"] += 1
            return
        except Exception:  # noqa: BLE001 - malformed P: full rebuild below
            pass
    cached = hou.Geometry()
    _build_detail(cached, buf)
    _GEO_CACHE[key] = {"geo": cached, "sig": sig, "buf_gen": buf.get("_gen")}
    geo.copy(cached)
    stats["rebuilds"] += 1


# ---------------------------------------------------------------------------
# runtime-optimized layout: ONE python SOP (cook_core) + 4 blast splitters
# ---------------------------------------------------------------------------

def _snapshot_parts(root: hou.Node, node: hou.Node) -> list[dict]:
    """Per-role data for the merged detail: bridge buffer if present else passthrough.

    Each part: {"role": i, "points": [...], "curves": [{"pointIndices": [...]}]}
    """
    serial = _parm(root, "cyl1nder_serial", "") or ""
    srcs = node.inputs()
    ready = _READY.get(serial)
    if ready is not None:
        outputs = ready["outputs"]  # background-prepared: no HTTP in the cook
    else:
        # cold start before the sync thread warmed the ready buffer: one direct pull
        client = BridgeClient(
            serial,
            bridge_url=_parm(root, "bridge_url", "http://127.0.0.1:8375"),
            node_path=root.path(),
            label="Cyl1nder",
        )
        pulled, _ = client.pull_outputs(0)
        outputs = None
        if pulled is not None:
            outputs = {int(b.get("index", -1)): b for b in pulled if b.get("index") is not None}
    parts: list[dict] = []
    for i in range(INPUT_COUNT):
        buf = None
        if outputs is not None:
            buf = outputs.get(i)
        if buf is not None and (buf.get("points") or []):
            parts.append(
                {
                    "role": i,
                    "points": buf.get("points") or [],
                    "curves": [
                        {"pointIndices": c.get("pointIndices") or []}
                        for c in (buf.get("curves") or [])
                    ],
                }
            )
        else:
            src = srcs[i] if i < len(srcs) else None
            if src is not None:
                snap = _serialize_geo(src.geometry())
                parts.append({"role": i, "points": snap["points"], "curves": snap["curves"]})
            else:
                parts.append({"role": i, "points": [], "curves": []})
    return parts


def _flat_signature(parts: list[dict]) -> dict:
    """Merged flat representation used as the content cache key."""
    points: list[list[float]] = []
    curves: list[dict] = []
    for part in parts:
        base = len(points)
        points.extend(part["points"])
        for c in part["curves"]:
            curves.append({"role": part["role"], "pointIndices": [i + base for i in c["pointIndices"]]})
    return {"points": points, "curves": curves}


def _build_core_detail(geo: hou.Geometry, parts: list[dict], cache_key: str) -> None:
    """Rebuild the merged detail only when content changed (prevents flicker)."""
    sig = _flat_signature(parts)
    prev = _CORE_CACHE.get(cache_key)
    if prev == sig:
        return
    geo.clear()
    created: list[hou.Point] = []
    for p in sig["points"]:
        pt = geo.createPoint()
        pt.setPosition(hou.Vector3(float(p[0]), float(p[1]), float(p[2])))
        created.append(pt)
    role_attr = None
    for c in sig["curves"]:
        prim = geo.createPolygon(is_closed=False)
        for idx in c["pointIndices"]:
            if 0 <= idx < len(created):
                prim.addVertex(created[idx])
        if role_attr is None:
            role_attr = geo.addAttrib(hou.attribType.Prim, "cyl1nder_role", 0)
        prim.setAttribValue("cyl1nder_role", int(c["role"]))
    _CORE_CACHE[cache_key] = sig


def cook_core() -> None:
    """Single-python-SOP runtime: push 4 inputs once, pull 4 outputs once, merge.

    The merged detail carries `cyl1nder_role` (prim) so downstream blasts split it.
    """
    node = hou.pwd()
    root = _root(node)
    serial = _ensure_serial(node)
    bridge_url = _parm(root, "bridge_url", "http://127.0.0.1:8375")
    auto_push = bool(_parm(root, "auto_push", 1))
    auto_pull = bool(_parm(root, "auto_pull", 1))
    geo = node.geometry()

    client = BridgeClient(serial, bridge_url=bridge_url, node_path=root.path(), label="Cyl1nder")
    _ensure_bridge(root)
    _ensure_frontend(root)

    if auto_push:
        srcs = node.inputs()
        inputs: list[dict] = []
        for i in range(INPUT_COUNT):
            src = srcs[i] if i < len(srcs) else None
            geo_i = src.geometry() if src is not None else None
            if geo_i is None:
                inputs.append(
                    {
                        "index": i,
                        "name": f"in{i}",
                        "pointCount": 0,
                        "primCount": 0,
                        "points": [],
                        "curves": [],
                        "attributes": {},
                    }
                )
            else:
                inputs.append(serialize_input(geo_i, i, f"in{i}"))
        hip = hou.hipFile.path()
        client.push_inputs(inputs, hip=hip)
        _set_status(root, "ok" if not client.last_error else "offline")

    if auto_pull:
        ensure_sync(root, serial)  # bidirectional: web edit -> stream event -> dirty -> recook
        parts = _snapshot_parts(root, node)
        _build_core_detail(geo, parts, serial)
        _set_status(root, "ok" if not client.last_error else "offline")
    else:
        # passthrough: merge the 4 inputs (with role attrs) so blasts still split.
        parts: list[dict] = []
        srcs = node.inputs()
        for i in range(INPUT_COUNT):
            src = srcs[i] if i < len(srcs) else None
            if src is not None:
                snap = _serialize_geo(src.geometry())
                parts.append({"role": i, "points": snap["points"], "curves": snap["curves"]})
            else:
                parts.append({"role": i, "points": [], "curves": []})
        _build_core_detail(geo, parts, serial)


# ---------------------------------------------------------------------------
# legacy layout: 4 python SOPs each call cook(role) (older .hda compatibility)
# ---------------------------------------------------------------------------

def _same_geo(a: hou.Geometry, b: hou.Geometry) -> bool:
    """Content compare of two geometries (points + polyline vertex order)."""
    pts_a = [[round(p.position().x(), 6), round(p.position().y(), 6), round(p.position().z(), 6)] for p in a.points()]
    pts_b = [[round(p.position().x(), 6), round(p.position().y(), 6), round(p.position().z(), 6)] for p in b.points()]
    if pts_a != pts_b:
        return False
    crv_a = [[p.number() for p in prim.points()] for prim in a.prims()]
    crv_b = [[p.number() for p in prim.points()] for prim in b.prims()]
    return crv_a == crv_b


def _role_buffer(serial: str, bridge_url: str, role: int) -> dict | None:
    """Return this role's output buffer with ONE network pull per cook round.

    The first role to cook pulls all 4 buffers once and caches them; the other
    three reuse the cache. Content compare downstream decides rebuild.
    """
    with _OUT_LOCK:
        cached = _OUT_CACHE.get(serial)
        if cached is not None and role in cached["outputs"]:
            return cached["outputs"][role]
        client = BridgeClient(serial, bridge_url=bridge_url)
        outputs, new_rev = client.pull_outputs(0)
        if outputs is None:
            return None
        merged = {int(b.get("index", -1)): b for b in outputs if b.get("index") is not None}
        _OUT_CACHE[serial] = {"rev": new_rev, "outputs": merged}
        return merged.get(role)


def _input_signature(srcs: list) -> tuple | None:
    """Input content signature: P (native bulk) + point/prim counts + per-prim vertex
    counts + carried point attrs, computed on a writable copy (per-prim HOM access
    is ~6x faster on writable geometry).

    Computed once per recook (role 0 only) as the gate for re-serializing/re-pushing:
    unchanged inputs cost only the signature, not the full JSON rebuild. Catches
    position, point/prim count and per-curve vertex-count changes; only a
    point-reorder / re-link that keeps counts AND positions identical is missed
    (self-heals on the next real change - content-based reconciliation).
    Returns None when it cannot be computed (caller then always re-pushes).
    """
    try:
        parts = []
        for i in range(INPUT_COUNT):
            src = srcs[i] if i < len(srcs) else None
            geo_i = src.geometry() if src is not None else None
            if geo_i is None:
                parts.append((0, (), (), ()))
                continue
            copy = hou.Geometry()
            copy.copy(geo_i)
            flat = tuple(copy.pointFloatAttribValues("P"))
            counts = tuple(len(prim.vertices()) for prim in copy.prims())
            attrs = ()
            for aname in ("width", "Cd", "uv"):
                a = copy.findPointAttrib(aname)
                if a is not None:
                    attrs += (aname, a.tupleSize(), tuple(copy.pointFloatAttribValues(aname)))
            parts.append((len(copy.points()), flat, counts, attrs))
        return tuple(parts)
    except Exception:  # noqa: BLE001 - never block the cook on a signature failure
        return None


def cook(role: int) -> None:
    node = hou.pwd()
    root = _root(node)
    serial = _ensure_serial(node)
    bridge_url = _parm(root, "bridge_url", "http://127.0.0.1:8375")
    auto_push = bool(_parm(root, "auto_push", 1))
    auto_pull = bool(_parm(root, "auto_pull", 1))
    geo = node.geometry()

    client = BridgeClient(serial, bridge_url=bridge_url, node_path=root.path(), label="Cyl1nder")
    _ensure_bridge(root)
    _ensure_frontend(root)

    if role == ROLE_PUSH and auto_push:
        srcs = node.inputs()
        sig = _input_signature(srcs)
        if sig is None or _PUSH_CACHE.get(serial) != sig:
            inputs: list[dict] = []
            for i in range(INPUT_COUNT):
                src = srcs[i] if i < len(srcs) else None
                geo_i = src.geometry() if src is not None else None
                if geo_i is None:
                    inputs.append(
                        {
                            "index": i,
                            "name": f"in{i}",
                            "pointCount": 0,
                            "primCount": 0,
                            "points": [],
                            "curves": [],
                            "attributes": {},
                        }
                    )
                else:
                    inputs.append(serialize_input(geo_i, i, f"in{i}"))
            hip = hou.hipFile.path()
            client.push_inputs(inputs, hip=hip)
            _PUSH_CACHE[serial] = sig
        _set_status(root, "ok" if not client.last_error else "offline")

    if auto_pull:
        ensure_sync(root, serial)  # bidirectional: web edit -> stream event -> dirty -> recook
        with _READY_LOCK:
            ready = _READY.get(serial)
        if ready is None:
            buf = _role_buffer(serial, bridge_url, role)  # cold start: REST fallback
        else:
            buf = ready["outputs"].get(role)  # background-prepared; no HTTP in cook
        if buf is not None:
            _apply_output(geo, buf, serial, role)
        else:
            # No data for THIS role on the bridge yet -> passthrough THIS role's own
            # input. node.geometry() is always the input0 copy on a multi-input python
            # SOP, so keeping it made all 4 output ports emit the first input.
            srcs = node.inputs()
            src = srcs[role] if role < len(srcs) else None
            if src is not None:
                other = src.geometry()
                if other is not None and not _same_geo(geo, other):
                    geo.clear()
                    geo.merge(other)
        with _READY_LOCK:
            _st = _READY.get(serial)
        _ready_err = _st.get("error", "") if _st is not None else ""
        _set_status(root, "ok" if not client.last_error and not _ready_err else "offline")
    else:
        # passthrough fallback: output index = input index (HDA still useful w/o bridge)
        geo.clear()
        srcs = node.inputs()
        if role < len(srcs) and srcs[role] is not None:
            geo.merge(srcs[role].geometry())