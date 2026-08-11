"""Cyl1nder HDA end-to-end hython smoke (needs bridge running on 127.0.0.1:8375).

Run: hython hda/scripts/hython_smoke.py
Asserts: serial created once & immutable, 4 inputs pushed, edit pulled back into out0,
ready-buffer cache-hit (no rebuild), position-only fast path, topology-change rebuild,
input push cache (no re-push on unchanged inputs, re-push on input change).
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "src"))

import hou  # noqa: E402

import cyl1nder_hda  # noqa: E402 - shared module with the HDA python SOPs

BRIDGE = "http://127.0.0.1:8375"
HDA = os.path.join(ROOT, "otls", "Cyl1nder_1.0.hda")


def _req(method: str, url: str, body: dict | None = None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method=method
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _make_curve_input(geo: hou.Node, name: str, offset: float) -> hou.Node:
    n = geo.createNode("curve", name)
    if n.parm("coords") is not None:
        n.parm("coords").set(f"0 0 {offset}  1 0.5 {offset}  2 0 {offset}")
        n.parm("type").set("polyline")
    else:
        p = geo.createNode("python", name)
        p.parm("python").set(
            "geo = hou.pwd().geometry()\n"
            f"pts = [geo.createPoint() for _ in range(3)]\n"
            f"for j, pt in enumerate(pts): pt.setPosition(hou.Vector3(j, j*0.5, {offset}))\n"
            "prim = geo.createPolygon(is_closed=False)\n"
            "for pt in pts: prim.addVertex(pt)\n"
        )
        n = p
    return n


def main() -> int:
    if HDA not in hou.hda.loadedFiles():
        hou.hda.installFile(HDA)

    geo = hou.node("/obj").createNode("geo", "cyl1nder_smoke")
    sources = [_make_curve_input(geo, f"src{i}", float(i)) for i in range(4)]
    node = geo.createNode("Cyl1nder", "cyl1nder")
    serial_parm = node.parm("cyl1nder_serial")
    assert serial_parm is not None, "cyl1nder_serial parm missing"
    serial_parm.set("")  # force fresh serial generation on first cook

    for i in range(4):
        node.setInput(i, sources[i], 0)
    node.cook()
    serial = serial_parm.eval()
    assert serial.startswith("C1-"), f"bad serial: {serial!r}"
    print("serial:", serial)

    node.cook()
    assert serial_parm.eval() == serial, "serial changed on second cook!"
    print("serial immutable across cooks OK")

    time.sleep(1.2)  # let debounce push land
    status = _req("GET", f"{BRIDGE}/api/hda/{serial}/status")
    print("registry:", status["registry"])
    assert status["registry"]["nodePath"] == node.path(), "nodePath mismatch"
    ws = status["workspace"]
    assert ws["inputRev"] >= 1, "inputs not pushed"
    print("workspace:", json.dumps(ws, indent=2))

    # Fallback mapping: with no outputs on the bridge yet, each out_i must
    # passthrough ITS OWN input (not input0) - regression test for the
    # "all 4 ports emit the first input" bug.
    for i in range(4):
        g = node.node(f"out{i}").geometry()
        pts = g.points()
        assert len(pts) == 3, f"out{i} expected 3 pts, got {len(pts)}"
        z = pts[0].position().z()
        assert abs(z - float(i)) < 1e-6, f"out{i} z={z} expected {i} (per-role fallback)"
    print("4-output fallback mapping OK (out_i = in_i)")

    # web-side edit for output 0 -> pull back into out0
    edit = {
        "outputs": [
            {
                "index": 0,
                "rev": 0,
                "pointCount": 3,
                "points": [[0, 0, 0], [1, 1, 0], [2, 2, 0]],
                "curves": [{"pointIndices": [0, 1, 2]}],
            }
        ]
    }
    _req("PUT", f"{BRIDGE}/api/hda/{serial}/outputs", edit)
    time.sleep(0.5)  # let the 30fps sync thread refresh the ready buffer (background)
    node.parm("force_cook").pressButton()  # fires callback -> cook reads the ready buffer
    time.sleep(0.6)

    out0 = node.node("out0")
    g = out0.geometry()  # cached result is fresh after the pull cook
    pts = g.points()
    prims = g.prims()
    print("out0 points:", len(pts), "prims:", len(prims))
    assert len(pts) == 3, f"expected 3 points, got {len(pts)}"
    p0 = pts[0].position()
    assert abs(p0.x()) < 1e-6 and abs(p0.y()) < 1e-6 and abs(p0.z()) < 1e-6, p0
    assert len(prims) == 1

    # ---- ready-buffer / fast-path assertions (cache-until-input-change) ----
    def _stats():
        return cyl1nder_hda._STATS.get(serial, {})

    st = _stats()
    print("stats after first edit:", st)
    base_rebuild = st.get("rebuilds", 0)
    base_fast = st.get("fast_paths", 0)
    base_skip = st.get("skips", 0)

    # 1) cache hit: force_cook with NO bridge change -> the ready buffer is the
    #    same object (same _gen) -> skip, no rebuild, no fast path.
    node.parm("force_cook").pressButton()
    time.sleep(0.5)
    st = _stats()
    assert st.get("rebuilds", 0) == base_rebuild, f"cache hit rebuilt: {st}"
    assert st.get("fast_paths", 0) == base_fast, f"cache hit should skip, not fast-path: {st}"
    assert st.get("skips", 0) > base_skip, f"cache-hit skip not counted: {st}"
    print("cache hit (same buffer re-cooked -> skip, no rebuild) OK")

    # 2) position-only edit (same topology) -> fast path: batch P update, no rebuild
    moved = {
        "outputs": [
            {
                "index": 0,
                "rev": 0,
                "pointCount": 3,
                "points": [[0, 0, 0], [1, 1, 5], [2, 2, 5]],
                "curves": [{"pointIndices": [0, 1, 2]}],
            }
        ]
    }
    _req("PUT", f"{BRIDGE}/api/hda/{serial}/outputs", moved)
    time.sleep(0.5)
    node.parm("force_cook").pressButton()
    time.sleep(0.5)
    st = _stats()
    assert st.get("rebuilds", 0) == base_rebuild, f"position-only edit rebuilt: {st}"
    assert st.get("fast_paths", 0) > base_fast, f"fast path not taken: {st}"
    g0 = node.node("out0").geometry().points()
    assert len(g0) == 3
    z = g0[2].position().z()
    assert abs(z - 5.0) < 1e-6, f"out0 pt2 z={z} expected 5.0 (fast path applied)"
    print("position-only edit -> fast path (setPosition via batch P, no rebuild) OK")

    # 3) topology change -> full rebuild (content update)
    topo = {
        "outputs": [
            {
                "index": 0,
                "rev": 0,
                "pointCount": 4,
                "points": [[0, 0, 0], [1, 1, 0], [2, 2, 0], [3, 3, 0]],
                "curves": [{"pointIndices": [0, 1, 2, 3]}],
            }
        ]
    }
    _req("PUT", f"{BRIDGE}/api/hda/{serial}/outputs", topo)
    time.sleep(0.5)
    node.parm("force_cook").pressButton()
    time.sleep(0.5)
    st = _stats()
    assert st.get("rebuilds", 0) > base_rebuild, f"topology change should rebuild: {st}"
    g0 = node.node("out0").geometry()
    assert len(g0.points()) == 4, f"out0 expected 4 pts after rebuild, got {len(g0.points())}"
    print("topology change -> rebuild OK")

    # ---- input push cache: unchanged inputs are NOT re-pushed on web-edit recooks ----
    ws = _req("GET", f"{BRIDGE}/api/hda/{serial}/status")["workspace"]
    assert ws["inputRev"] == 1, f"inputs re-pushed with unchanged content: {ws['inputRev']}"
    print("push cache (unchanged inputs -> no re-push on recook) OK")

    # input change IS detected and pushed (cache invalidated on input change)
    src0 = sources[0]
    if src0.parm("coords") is not None:
        src0.parm("coords").set("0 0 0  1 0.5 0  2 0 0  3 1.5 0")
    else:
        src0.parm("python").set(
            "geo = hou.pwd().geometry()\n"
            "pts = [geo.createPoint() for _ in range(4)]\n"
            "for j, pt in enumerate(pts): pt.setPosition(hou.Vector3(j, j*0.5, 0))\n"
            "prim = geo.createPolygon(is_closed=False)\n"
            "for pt in pts: prim.addVertex(pt)\n"
        )
    node.cook()
    time.sleep(0.8)  # debounced push (0.12s) + bridge round-trip
    ws = _req("GET", f"{BRIDGE}/api/hda/{serial}/status")["workspace"]
    assert ws["inputRev"] >= 2, f"input change not pushed: inputRev={ws['inputRev']}"
    print("input change -> re-push (cache invalidated) OK")

    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())