"""Minimal USDZ export for scene IO snapshots (stdlib only: usda text + zipfile).

USDZ is a zip archive; we write a single root.usda that expresses the geometry
snapshot (io/inputs.json + io/outputs.json) as USD prims:
  points -> UsdGeom.Points | curves -> UsdGeom.BasisCurves | faces -> UsdGeom.Mesh
usda text structure follows USD official syntax (usda style reference only,
no code copied from Anime Hair Studio). No external USD dependency.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Any

from .snapshot import read_snapshot

USDZ_ENTRY = "root.usda"


def _num(v: Any) -> str:
    return format(float(v), ".6g")


def _points_text(points: list[list[float]]) -> str:
    return "[" + ", ".join("(%s, %s, %s)" % (_num(x), _num(y), _num(z)) for x, y, z in points) + "]"


def _ints_text(vals: list[int]) -> str:
    return "[" + ", ".join(str(int(v)) for v in vals) + "]"


def _widths_text(vals: list[float]) -> str:
    return "[" + ", ".join(_num(v) for v in vals) + "]"


def _mesh_prim(name: str, points: list[list[float]], faces: list[list[int]]) -> str:
    return (
        f'    def Mesh "{name}"\n'
        "    {\n"
        '        uniform token subdivisionScheme = "none"\n'
        f"        int[] faceVertexCounts = {_ints_text([len(f) for f in faces])}\n"
        f"        int[] faceVertexIndices = {_ints_text([i for f in faces for i in f])}\n"
        f"        point3f[] points = {_points_text(points)}\n"
        "    }\n"
    )


def _curves_prim(name: str, points: list[list[float]], curves: list[dict[str, Any]]) -> str:
    counts: list[int] = []
    pts: list[list[float]] = []
    for c in curves:
        idx = [int(i) for i in (c.get("pointIndices") or []) if 0 <= int(i) < len(points)]
        counts.append(len(idx))
        pts.extend(points[i] for i in idx)
    if not pts:
        return ""
    return (
        f'    def BasisCurves "{name}"\n'
        "    {\n"
        '        uniform token type = "linear"\n'
        f"        int[] curveVertexCounts = {_ints_text(counts)}\n"
        f"        point3f[] points = {_points_text(pts)}\n"
        "    }\n"
    )


def _points_prim(name: str, points: list[list[float]], widths: list[float] | None = None) -> str:
    lines = [f'    def Points "{name}"\n', "    {\n", f"        point3f[] points = {_points_text(points)}\n"]
    if widths:
        lines.append(f"        float[] widths = {_widths_text(widths)}\n")
    lines.append("    }\n")
    return "".join(lines)


def _payload_block(prefix: str, payloads: list[dict[str, Any]]) -> str:
    """One prim per payload: faces win (Mesh), then curves (BasisCurves), then points (Points)."""
    out: list[str] = []
    for p in payloads or []:
        name = f"{prefix}{int(p.get('index', 0))}"
        points = p.get("points") or []
        curves = p.get("curves") or []
        faces = p.get("faces") or []
        if faces and points:
            out.append(_mesh_prim(name, points, faces))
        elif curves and points:
            prim = _curves_prim(name, points, curves)
            if prim:
                out.append(prim)
        elif points:
            out.append(_points_prim(name, points))
    return "\n".join(out)


def _build_usda(inputs: list[dict[str, Any]], outputs: list[dict[str, Any]]) -> str:
    blocks = [b for b in (_payload_block("Input", inputs), _payload_block("Output", outputs)) if b]
    return (
        "#usda 1.0\n"
        "(\n"
        '    defaultPrim = "Root"\n'
        '    upAxis = "Y"\n'
        ")\n\n"
        "def Xform \"Root\"\n"
        "{\n"
        f"{chr(10).join(blocks)}\n"
        "}\n"
    )


def _resolve_hip(serial: str, hip: str | None) -> str:
    if hip is not None:
        return hip
    from .state import get_state
    rec = get_state().registry.get(serial)
    return rec.hip if rec is not None else ""


def build_usdz_bytes(serial: str, hip: str | None = None) -> bytes:
    """Build the serial's io snapshot as in-memory USDZ bytes (zip with root.usda)."""
    snap = read_snapshot(_resolve_hip(serial, hip), serial) or {}
    usda = _build_usda(snap.get("inputs") or [], snap.get("outputs") or [])
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(USDZ_ENTRY, usda)
    return buf.getvalue()


def write_usdz(serial: str, target_path: str | Path, hip: str | None = None) -> Path | None:
    """Write the serial's io snapshot as <target_path>.usdz (zip containing root.usda).

    hip: snapshot root context (registry hip); None -> resolved from the registry.
    Returns the created path, or None on write failure.
    """
    path = Path(target_path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(build_usdz_bytes(serial, hip=hip))
    except OSError:
        return None
    return path
