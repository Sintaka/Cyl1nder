"""Buffer -> geometry application + input/output snapshots for the Cyl1nder HDA (3.1 split)."""
from __future__ import annotations

import hou

from cyl1nder_bridge import BridgeClient
from cyl1nder_cache import _CORE_CACHE, _GEO_CACHE, _READY, _STATS
from cyl1nder_lifecycle import _parm
from cyl1nder_serializer import serialize_input

INPUT_COUNT = 4


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


def _same_geo(a: hou.Geometry, b: hou.Geometry) -> bool:
    """Content compare of two geometries (points + polyline vertex order)."""
    pts_a = [[round(p.position().x(), 6), round(p.position().y(), 6), round(p.position().z(), 6)] for p in a.points()]
    pts_b = [[round(p.position().x(), 6), round(p.position().y(), 6), round(p.position().z(), 6)] for p in b.points()]
    if pts_a != pts_b:
        return False
    crv_a = [[p.number() for p in prim.points()] for prim in a.prims()]
    crv_b = [[p.number() for p in prim.points()] for prim in b.prims()]
    return crv_a == crv_b


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
