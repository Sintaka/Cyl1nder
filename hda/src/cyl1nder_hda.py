"""Runtime cook logic for the Cyl1nder HDA's 4 internal Python SOPs.

The HDA is a thin shell: 4 python SOPs (role 0..3) import this module via
PYTHONPATH (hda/package/cyl1nder.json) and call cook(role). Editing this file
is hot-reload friendly - no HDA rebuild needed (Houdini reloads the module).
"""
from __future__ import annotations

import threading
import time

import hou

from cyl1nder_bridge import BridgeClient, generate_serial
from cyl1nder_serializer import serialize_input

ROLE_PUSH = 0
INPUT_COUNT = 4

# bidirectional sync: web edits -> bridge pending -> 30fps poller -> dirty -> recook
_SYNC: dict[str, dict] = {}


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
        _state = _SYNC.get(_serial_parm.eval() if _serial_parm else "")
        if _state is not None:
            _state["scheduled"] = False
        sp = n.parm("status")
        if sp is not None and sp.eval() != "dirty":
            try:
                sp.set("dirty")
            except Exception:  # noqa: BLE001
                pass
        for c in n.children():
            if c.type().name() == "python":
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


def _build_detail(geo: hou.Geometry, buf: dict) -> None:
    """Build output detail from an OutputBuffer dict (points + polyline curves + width)."""
    pts_data = buf.get("points") or []
    curves = buf.get("curves") or []
    created: list[hou.Point] = []
    for p in pts_data:
        pt = geo.createPoint()
        pt.setPosition(hou.Vector3(float(p[0]), float(p[1]), float(p[2])))
        created.append(pt)
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


def cook(role: int) -> None:
    node = hou.pwd()
    root = _root(node)
    serial = _ensure_serial(node)
    bridge_url = _parm(root, "bridge_url", "http://127.0.0.1:8375")
    auto_push = bool(_parm(root, "auto_push", 1))
    auto_pull = bool(_parm(root, "auto_pull", 1))
    geo = node.geometry()
    # NOTE: do NOT clear upfront - only rebuild when a new buffer arrives for this role,
    # otherwise Force Cook / stale recooks would wipe existing outputs.

    client = BridgeClient(serial, bridge_url=bridge_url, node_path=root.path(), label="Cyl1nder")

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
        since = int(node.userData("cyl1nder_last_rev") or 0)
        outputs, new_rev = client.pull_outputs(since)
        if outputs is not None:
            matched = [b for b in outputs if int(b.get("index", -1)) == role]
            if matched:
                geo.clear()
                _build_detail(geo, matched[0])  # latest buffer for this role
            if new_rev:
                node.setUserData("cyl1nder_last_rev", str(new_rev))
            _set_status(root, "ok" if not client.last_error else "offline")
        else:
            _set_status(root, "offline")
    else:
        # passthrough fallback: output index = input index (HDA still useful w/o bridge)
        geo.clear()
        srcs = node.inputs()
        if role < len(srcs) and srcs[role] is not None:
            geo.merge(srcs[role].geometry())