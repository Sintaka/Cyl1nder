"""Runtime cook logic for the Cyl1nder HDA (3.1 split: barrel + cook entry).

Two layouts are supported:
- runtime-optimized (current): ONE python SOP `cyl1nder_core` calls cook_core().
  It pushes all 4 inputs once, pulls all 4 outputs in ONE HTTP round-trip and
  writes a MERGED detail where every polyline prim carries a `cyl1nder_role`
  prim attribute (0..3). Four lightweight `blast` SOPs split it into out0..out3.
- legacy (older HDA): 4 python SOPs each call cook(role); kept for backward compat.

Submodules: cyl1nder_lifecycle / cyl1nder_cache / cyl1nder_geometry / cyl1nder_sync.
This module keeps the public name `cyl1nder_hda` (imported by the HDA python SOPs,
reload_hda.py and hython_smoke.py) and re-exports the submodule names they use.
"""
from __future__ import annotations

import hou

from cyl1nder_bridge import BridgeClient, generate_serial
from cyl1nder_serializer import serialize_input

from cyl1nder_cache import (
    _CORE_CACHE, _OUT_CACHE, _OUT_LOCK, _READY, _READY_LOCK, _STATS, _GEO_CACHE, _PUSH_CACHE,
    _ready_state, _refresh_ready, _reset_ready, _reset_caches, _role_buffer,
)
from cyl1nder_geometry import (
    INPUT_COUNT, _serialize_geo, _build_detail, _buffer_sig, _apply_output, _snapshot_parts,
    _flat_signature, _build_core_detail, _same_geo, _input_signature,
)
from cyl1nder_lifecycle import (
    _ui_healthy, _ensure_frontend, _bridge_healthy, _ensure_bridge, _root, _ensure_serial, _parm, _set_status,
    BRIDGE_PY, BRIDGE_CWD, NODE, VITE_JS, WEB_CWD,
    _BRIDGE_LAST_SPAWN, _UI_LAST_SPAWN, _AUTOSTART_CHECK_INTERVAL, _BRIDGE_LAST_CHECK, _UI_LAST_CHECK,
)
from cyl1nder_sync import (
    _SYNC, _STREAM_HOLD, _STREAM_RETRY, _RECOOK_LOG_ONCE, _SYNC_FPS_DEFAULT, _SYNC_FPS_MIN, _SYNC_FPS_MAX,
    _stream_loop, _schedule_recook, _force_cook_node, stop_sync, stop_all_sync, ensure_sync,
)

ROLE_PUSH = 0


def _push_inputs_if_changed(node, root, serial, bridge_url, client) -> bool:
    """Push inputs only when their content signature changed (cook-on-dirty).

    Shared gate for the runtime cook_core() and legacy cook(role) paths: when the
    input signature is unchanged the payload is neither re-serialized nor re-pushed,
    so a recook with identical inputs costs only the signature (breaks the W8 -> W2
    echo that thrashed the web chain-cache). Returns True when inputs were pushed,
    False when they were unchanged.
    """
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
        return True
    return False


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
        _push_inputs_if_changed(node, root, serial, bridge_url, client)
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
        _push_inputs_if_changed(node, root, serial, bridge_url, client)
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