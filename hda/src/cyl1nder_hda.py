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

# bidirectional sync: web edits -> bridge pending -> 30fps poller -> dirty -> recook
_SYNC: dict[str, dict] = {}

# content cache for the merged core detail (per serial) - prevents viewport flicker
# on unchanged Force Cooks; rebuild decision stays content-based (sync-architecture rule).
_CORE_CACHE: dict[str, dict] = {}

# scheme-B output cache: one network pull per cook round shared by all 4 roles.
# _force_cook_node clears it so dirty -> recook re-pulls (Houdini SOP cache semantics).
_OUT_CACHE: dict[str, dict] = {}
_OUT_LOCK = threading.Lock()

# HDA owns bridge startup: if unreachable, spawn it (one attempt / 5s)
BRIDGE_PY = r"D:\code\dev\Cyl1nder\bridge\.venv\Scripts\python.exe"
BRIDGE_CWD = r"D:\code\dev\Cyl1nder\bridge"
NODE = r"C:\Program Files\nodejs\node.exe"
VITE_JS = r"D:\code\dev\Cyl1nder\web\node_modules\vite\bin\vite.js"
WEB_CWD = r"D:\code\dev\Cyl1nder\web"
_BRIDGE_LAST_SPAWN = 0.0
_UI_LAST_SPAWN = 0.0

def _ui_healthy() -> bool:
    """True when the web UI (vite on 8376) answers."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:8376/", timeout=0.4):
            return True
    except Exception:  # noqa: BLE001
        return False


def _ensure_frontend(root: hou.Node) -> None:
    """Bind the web UI lifecycle to the bridge: if 8376 is down, start vite (1 attempt / 10s)."""
    global _UI_LAST_SPAWN
    if not bool(_parm(root, "bridge_autostart", 1)):
        return
    if _ui_healthy():
        return
    if time.time() - _UI_LAST_SPAWN < 10.0:
        return
    _UI_LAST_SPAWN = time.time()
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
    global _BRIDGE_LAST_SPAWN
    if not bool(_parm(root, "bridge_autostart", 1)):
        return
    bridge_url = _parm(root, "bridge_url", "http://127.0.0.1:8375")
    if _bridge_healthy(bridge_url):
        return
    if time.time() - _BRIDGE_LAST_SPAWN < 5.0:
        return
    _BRIDGE_LAST_SPAWN = time.time()
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


def _same_as_buffer(geo: hou.Geometry, buf: dict) -> bool:
    """Compare CURRENT output geometry content vs the bridge buffer.

    Content-based, self-healing: even if some other path wrote stale geometry
    (e.g. passthrough fallback), the next cook detects the mismatch and rebuilds.
    No stored hash/bookkeeping to desync with.
    """
    pts = [
        [round(p.position().x(), 6), round(p.position().y(), 6), round(p.position().z(), 6)]
        for p in geo.points()
    ]
    if pts != (buf.get("points") or []):
        return False
    curves = [[p.number() for p in prim.points()] for prim in geo.prims()]
    buf_curves = [c.get("pointIndices") for c in (buf.get("curves") or [])]
    return curves == buf_curves


def _sync_loop(serial: str, node_path: str, interval: float, bridge_url: str) -> None:
    client = BridgeClient(serial, bridge_url=bridge_url)
    last_seen = 0
    while True:
        state = _SYNC.get(serial)
        if state is None or state["stop"].is_set():
            return
        time.sleep(interval)
        pending, rev, reset = client.pending_outputs(last_seen)
        if reset:
            # bridge restarted: rev went backwards - re-pull everything from 0
            last_seen = 0
            state = _SYNC.get(serial)
            if state is not None and not state["scheduled"]:
                state["scheduled"] = True
                _schedule_recook(node_path)
            continue
        if pending and rev > last_seen:
            state = _SYNC.get(serial)
            if state is None or state["scheduled"]:
                continue
            last_seen = rev
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
    """Start the 30fps-capped sync poller (sync_fps parm, default 30)."""
    if not serial:
        return
    state = _SYNC.get(serial)
    if state is not None and state["thread"].is_alive():
        return
    fps = float(_parm(root, "sync_fps", 30) or 30)
    interval = 1.0 / max(1.0, fps)
    stop = threading.Event()
    thread = threading.Thread(
        target=_sync_loop,
        args=(
            serial,
            root.path(),
            interval,
            _parm(root, "bridge_url", "http://127.0.0.1:8375"),
        ),
        daemon=True,
    )
    thread.start()
    _SYNC[serial] = {"thread": thread, "stop": stop, "node_path": root.path(), "scheduled": False}


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


# ---------------------------------------------------------------------------
# runtime-optimized layout: ONE python SOP (cook_core) + 4 blast splitters
# ---------------------------------------------------------------------------

def _snapshot_parts(root: hou.Node, node: hou.Node) -> list[dict]:
    """Per-role data for the merged detail: bridge buffer if present else passthrough.

    Each part: {"role": i, "points": [...], "curves": [{"pointIndices": [...]}]}
    """
    serial = _parm(root, "cyl1nder_serial", "") or ""
    client = BridgeClient(
        serial,
        bridge_url=_parm(root, "bridge_url", "http://127.0.0.1:8375"),
        node_path=root.path(),
        label="Cyl1nder",
    )
    outputs, _ = client.pull_outputs(0)
    srcs = node.inputs()
    parts: list[dict] = []
    for i in range(INPUT_COUNT):
        buf = None
        if outputs is not None:
            buf = next((b for b in outputs if int(b.get("index", -1)) == i), None)
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
        ensure_sync(root, serial)  # bidirectional: web edit -> dirty -> recook (<= sync_fps)
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
        ensure_sync(root, serial)  # bidirectional: web edit -> dirty -> recook (<= sync_fps)
        buf = _role_buffer(serial, bridge_url, role)
        if buf is not None and not _same_as_buffer(geo, buf):
            geo.clear()
            _build_detail(geo, buf)
        elif buf is None:
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
        _set_status(root, "ok" if not client.last_error else "offline")
    else:
        # passthrough fallback: output index = input index (HDA still useful w/o bridge)
        geo.clear()
        srcs = node.inputs()
        if role < len(srcs) and srcs[role] is not None:
            geo.merge(srcs[role].geometry())