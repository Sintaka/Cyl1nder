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
import threading
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


def _wait_ready_rev(serial: str, rev: int, timeout: float = 4.0) -> None:
    """Wait until the background sync thread pulled outputs rev into the ready buffer.

    The sync poller is adaptive (fast while active, idle 0.5s backoff), so fixed
    sleeps are racy - wait on the ready-buffer rev instead.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        st = cyl1nder_hda._READY.get(serial)
        if st is not None and st.get("rev", 0) >= rev:
            return
        time.sleep(0.05)
    raise AssertionError(f"ready buffer rev never reached {rev}: {cyl1nder_hda._READY.get(serial)}")


class _FakeClock:
    """Injectable clock for the _sync_loop adaptive-interval test."""

    def __init__(self) -> None:
        self.t = 1000.0

    def now(self) -> float:
        return self.t


def _test_adaptive_polling() -> None:
    """fast (1/sync_fps) while active -> idle 0.5s after ~2s quiet -> fast on pending.

    A blocking gate parks each loop sleep so the test can step the fake clock
    deterministically (the loop would otherwise spin far ahead of the clock).
    """
    serial = cyl1nder_hda.generate_serial()
    stop = threading.Event()
    cyl1nder_hda._SYNC[serial] = {"thread": None, "stop": stop, "node_path": "", "scheduled": False}
    clock = _FakeClock()

    class _FakeClient:
        def __init__(self) -> None:
            self.last_error = ""
            self.polls = 0
            self._pending = False
            self.pending_rev = 0

        def pull_outputs(self, since: int):
            return [], int(since or 0)

        def pending_outputs(self, since: int):
            self.polls += 1
            if self._pending:
                self._pending = False
                return True, self.pending_rev, False, False
            return False, int(since or 0), False, False

    class _Gate:
        """Blocks each loop sleep until the test steps the fake clock."""

        def __init__(self) -> None:
            self.values: list[float] = []
            self._go = threading.Event()

        def __call__(self, t: float) -> None:
            self.values.append(t)
            self._go.wait()
            self._go.clear()

        def step(self, advance: float) -> None:
            clock.t += advance
            self._go.set()

        def wait_len(self, n: int, timeout: float = 5.0) -> None:
            deadline = time.time() + timeout
            while len(self.values) < n and time.time() < deadline:
                time.sleep(0.005)
            assert len(self.values) >= n, f"only {len(self.values)}/{n} sleeps before timeout"

    client = _FakeClient()
    gate = _Gate()
    th = threading.Thread(
        target=cyl1nder_hda._sync_loop,
        args=(serial, "", 1.0 / 30.0, "http://127.0.0.1:9", client),
        kwargs={"sleep_fn": gate, "now_fn": clock.now},
        daemon=True,
    )
    th.start()
    try:
        fast = 1.0 / 30.0
        gate.wait_len(1)
        assert abs(gate.values[-1] - fast) < 1e-9, f"expected fast sleep, got {gate.values[-1]:.4f}"
        # >2s quiet -> idle backoff (3 consecutive idle cycles)
        for _ in range(3):
            gate.step(3.0)
            gate.wait_len(len(gate.values) + 1)
        assert all(abs(v - 0.5) < 1e-9 for v in gate.values[1:4]), f"no idle backoff: {gate.values}"
        # pending activity -> next sleep is fast again
        client._pending = True
        client.pending_rev = 1
        gate.step(0.0)
        gate.wait_len(len(gate.values) + 1)
        assert abs(gate.values[-1] - fast) < 1e-9, f"did not resume fast: {gate.values[-3:]}"
        print("adaptive polling (fast -> idle 0.5s -> fast on pending) OK")
    finally:
        stop.set()
        gate._go.set()  # unblock any parked sleep so the loop thread exits
        th.join(timeout=2)
        cyl1nder_hda._SYNC.pop(serial, None)
        cyl1nder_hda._READY.pop(serial, None)


def _test_kick_force_recook() -> None:
    """force (POST /kick) -> recook scheduled even with rev unchanged; the push
    cache is dropped so the recook re-pushes (heals a failed first push -> ok)."""
    serial = cyl1nder_hda.generate_serial()
    stop = threading.Event()
    cyl1nder_hda._SYNC[serial] = {"thread": None, "stop": stop, "node_path": "", "scheduled": False}
    cyl1nder_hda._PUSH_CACHE[serial] = ("stale-sig",)  # inputs were already pushed once
    recooked: list[str] = []
    orig_schedule = cyl1nder_hda._schedule_recook
    cyl1nder_hda._schedule_recook = lambda node_path: recooked.append(node_path)  # type: ignore[assignment]
    th = None

    class _FakeClient:
        def __init__(self) -> None:
            self.last_error = "Connection refused"  # simulate a failed first push
            self.polls = 0

        def pull_outputs(self, since: int):
            return [], int(since or 0)

        def pending_outputs(self, since: int):
            self.polls += 1
            if self.polls == 1:
                return False, 0, False, True  # kick force, rev unchanged
            return False, int(since or 0), False, False

    try:
        client = _FakeClient()
        sleeps: list[float] = []
        th = threading.Thread(
            target=cyl1nder_hda._sync_loop,
            args=(serial, "/obj/geo1/kicktest", 1.0 / 30.0, "http://127.0.0.1:9", client),
            kwargs={"sleep_fn": sleeps.append, "now_fn": _FakeClock().now},
            daemon=True,
        )
        th.start()
        deadline = time.time() + 5.0
        while client.polls < 2 and time.time() < deadline:
            time.sleep(0.005)
        assert client.polls >= 2, "sync loop did not poll"
        assert recooked == ["/obj/geo1/kicktest"], f"force did not schedule recook: {recooked}"
        assert serial not in cyl1nder_hda._PUSH_CACHE, "force should drop the push cache (re-push to heal)"
        print("kick force -> recook scheduled + push cache dropped (self-heal) OK")
    finally:
        cyl1nder_hda._schedule_recook = orig_schedule
        stop.set()
        if th is not None:
            th.join(timeout=2)
        cyl1nder_hda._SYNC.pop(serial, None)
        cyl1nder_hda._READY.pop(serial, None)
        cyl1nder_hda._PUSH_CACHE.pop(serial, None)


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
    r = _req("PUT", f"{BRIDGE}/api/hda/{serial}/outputs", edit)
    _wait_ready_rev(serial, r["rev"])  # sync thread refreshed _READY (adaptive poller)
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
    r = _req("PUT", f"{BRIDGE}/api/hda/{serial}/outputs", moved)
    _wait_ready_rev(serial, r["rev"])
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
    r = _req("PUT", f"{BRIDGE}/api/hda/{serial}/outputs", topo)
    _wait_ready_rev(serial, r["rev"])
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

    _test_adaptive_polling()
    _test_kick_force_recook()

    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())