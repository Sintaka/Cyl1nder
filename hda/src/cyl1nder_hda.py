"""Runtime cook logic for the Cyl1nder HDA's 4 internal Python SOPs.

The HDA is a thin shell: 4 python SOPs (role 0..3) import this module via
PYTHONPATH (hda/package/cyl1nder.json) and call cook(role). Editing this file
is hot-reload friendly - no HDA rebuild needed (Houdini reloads the module).
"""
from __future__ import annotations

import hou

from cyl1nder_bridge import BridgeClient, generate_serial
from cyl1nder_serializer import serialize_input

ROLE_PUSH = 0
INPUT_COUNT = 4


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
    geo.clear()

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
        since = int(node.userData("cyl1nder_last_rev") or 0)
        outputs, new_rev = client.pull_outputs(since)
        if outputs is not None:
            for buf in outputs:
                if int(buf.get("index", -1)) == role:
                    _build_detail(geo, buf)
            if new_rev:
                node.setUserData("cyl1nder_last_rev", str(new_rev))
            _set_status(root, "ok" if not client.last_error else "offline")
        else:
            _set_status(root, "offline")
    else:
        # passthrough fallback: output index = input index (HDA still useful w/o bridge)
        srcs = node.inputs()
        if role < len(srcs) and srcs[role] is not None:
            geo.merge(srcs[role].geometry())