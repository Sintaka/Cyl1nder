"""Houdini geometry -> Cyl1nder JSON payload (mirrors bridge/bridge/protocol.py InputPayload)."""
from __future__ import annotations

import hou

# prim types treated as curves for hair workflows
_CURVE_TYPES = ("polyline", "nurbscurve", "bezier", "poly", "polygon")
# point attributes to carry in v1 (P is implicit via points[]; width drives tube radius)
_CARRY_ATTRS = ("width", "Cd", "uv")


def _norm_value(v):
    if isinstance(v, (hou.Vector2, hou.Vector3, hou.Vector4)):
        return [float(x) for x in v]
    if isinstance(v, (tuple, list)):
        return [float(x) for x in v]
    return float(v)


def serialize_input(geo: hou.Geometry, index: int, name: str) -> dict:
    """Convert a SOP detail into an InputPayload-shaped dict."""
    pts = geo.points()
    points = [
        [round(p.position().x(), 6), round(p.position().y(), 6), round(p.position().z(), 6)]
        for p in pts
    ]
    curves: list[dict] = []
    for prim in geo.prims():
        tname = prim.type().name().lower()
        if tname not in _CURVE_TYPES or (tname in ("poly", "polygon") and prim.isClosed()):
            continue
        prim_pts = prim.points()
        idxs = [p.number() for p in prim_pts]
        widths = None
        wa = geo.findPointAttrib("width")
        if wa is not None:
            widths = [round(float(pt.attribValue("width")), 6) for pt in prim_pts]
        curves.append({"pointIndices": idxs, "widths": widths})
    attributes: dict = {}
    for aname in _CARRY_ATTRS:
        a = geo.findPointAttrib(aname)
        if a is None:
            continue
        attributes[aname] = {
            "type": a.dataType().name(),
            "count": a.tupleSize(),
            "values": [_norm_value(pt.attribValue(aname)) for pt in pts],
        }
    return {
        "index": index,
        "name": name,
        "pointCount": len(points),
        "primCount": len(geo.prims()),
        "points": points,
        "curves": curves,
        "attributes": attributes,
    }