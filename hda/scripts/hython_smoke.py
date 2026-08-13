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
import cyl1nder_sync  # noqa: E402 - owns _schedule_recook (monkeypatched by this smoke)

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

    The stream loop refreshes _READY on every outputs/kick/reset event (events
    arrive ~immediately, no polling), so fixed sleeps are racy - wait on the
    ready-buffer rev instead.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        st = cyl1nder_hda._READY.get(serial)
        if st is not None and st.get("rev", 0) >= rev:
            return
        time.sleep(0.05)
    raise AssertionError(f"ready buffer rev never reached {rev}: {cyl1nder_hda._READY.get(serial)}")


class _FakeClock:
    """Injectable clock for the _stream_loop event-driven tests."""

    def __init__(self) -> None:
        self.t = 1000.0

    def now(self) -> float:
        return self.t

    def step(self, dt: float = 1.0) -> None:
        """Advance the injected clock (crosses the 1/fps throttle window)."""
        self.t += dt


def _test_stream_loop() -> None:
    """Event-driven /stream loop: timeout/outputs/kick/error/reset + fps throttle.

    stream_once returns a programmable event sequence; pull_outputs is a stub.
    A blocking gate parks each loop sleep (only error backoff sleeps) so the
    test can feed events deterministically; now_fn is injected and stepped to
    cross the 1/fps throttle window between single events.
    """
    serial = cyl1nder_hda.generate_serial()
    stop = threading.Event()
    cyl1nder_hda._SYNC[serial] = {
        "thread": None, "stop": stop, "node_path": "", "scheduled": False, "fps": 30,
    }
    recooked: list[str] = []
    orig_schedule = cyl1nder_sync._schedule_recook
    cyl1nder_sync._schedule_recook = lambda node_path: recooked.append(node_path)  # type: ignore[assignment]
    clock = _FakeClock()

    class _FakeClient:
        def __init__(self) -> None:
            self.last_error = ""
            self.events: list[dict | None] = []
            self.stream_calls = 0
            self.stream_sinces: list[int] = []
            self.pull_sinces: list[int] = []
            self.pull_rev = 7

        def stream_once(self, since: int, hold: float = 60.0):
            self.stream_calls += 1
            self.stream_sinces.append(int(since or 0))
            assert abs(hold - cyl1nder_hda._STREAM_HOLD) < 1e-9, f"hold={hold}"
            return self.events.pop(0) if self.events else None

        def pull_outputs(self, since: int):
            self.pull_sinces.append(int(since or 0))
            return [], self.pull_rev

    class _Gate:
        """Blocks each loop sleep (error backoff) until the test steps."""

        def __init__(self) -> None:
            self.values: list[float] = []
            self._go = threading.Event()

        def __call__(self, t: float) -> None:
            self.values.append(t)
            self._go.wait()
            self._go.clear()

        def step(self, advance: float = 0.0) -> None:
            self._go.set()

        def wait_len(self, n: int, timeout: float = 5.0) -> None:
            deadline = time.time() + timeout
            while len(self.values) < n and time.time() < deadline:
                time.sleep(0.005)
            assert len(self.values) >= n, f"only {len(self.values)}/{n} sleeps before timeout"

    client = _FakeClient()
    gate = _Gate()
    th = threading.Thread(
        target=cyl1nder_hda._stream_loop,
        args=(serial, "", "http://127.0.0.1:9", client),
        kwargs={"sleep_fn": gate, "now_fn": clock.now},
        daemon=True,
    )
    th.start()

    def _feed(events: list[dict | None], park_at: int) -> None:
        """Queue events, unblock the parked loop, wait until it re-parks (consumed all)."""
        client.events.extend(events)
        gate.step()
        gate.wait_len(park_at)

    def _seed_caches() -> None:
        """Simulate a working HDA that pushed inputs / built geometry pre-restart."""
        cyl1nder_hda._PUSH_CACHE[serial] = ("stale-sig",)
        cyl1nder_hda._CORE_CACHE[serial] = {"stale": True}
        cyl1nder_hda._OUT_CACHE[serial] = {"rev": 5, "outputs": {}}
        cyl1nder_hda._GEO_CACHE[(serial, 0)] = {"geo": None, "sig": (), "buf_gen": 0}
        cyl1nder_hda._GEO_CACHE[(serial, 1)] = {"geo": None, "sig": (), "buf_gen": 0}
        cyl1nder_hda._GEO_CACHE[("other-" + serial, 0)] = {"geo": None, "sig": (), "buf_gen": 0}

    def _assert_caches_cleared() -> None:
        """reset must drop every cache entry of this serial (and only this serial)."""
        assert serial not in cyl1nder_hda._PUSH_CACHE, "reset must drop the push cache (re-push inputs)"
        assert serial not in cyl1nder_hda._CORE_CACHE, "reset must drop the core cache (old topology)"
        assert serial not in cyl1nder_hda._OUT_CACHE, "reset must drop the out cache (old outputs)"
        assert all(k[0] != serial for k in cyl1nder_hda._GEO_CACHE), \
            "reset must drop this serial's geo cache entries"
        assert ("other-" + serial, 0) in cyl1nder_hda._GEO_CACHE, \
            "reset must not touch other serials' caches"

    try:
        # empty queue -> first stream_once returns None -> parked at backoff sleep
        gate.wait_len(1)
        assert recooked == [], f"no events yet, got recooks: {recooked}"
        assert abs(gate.values[-1] - cyl1nder_hda._STREAM_RETRY) < 1e-9, \
            f"expected {cyl1nder_hda._STREAM_RETRY}s backoff, got {gate.values[-1]}"

        # timeout: idle keep-alive -> no recook, loop continues (next sleep = 2nd backoff)
        _feed([{"type": "timeout", "rev": 0}], 2)
        assert recooked == [], f"timeout must not recook: {recooked}"
        print("stream timeout -> keep-alive, no recook OK")

        # outputs: data event -> recook scheduled (first action is never rate-capped)
        cyl1nder_hda._SYNC[serial]["scheduled"] = False
        _feed([{"type": "outputs", "rev": 5}], 3)
        assert recooked == [""], f"outputs did not schedule recook: {recooked}"
        print("stream outputs -> recook scheduled OK")

        # kick with rev unchanged -> recook scheduled anyway (clock stepped past 1/fps)
        cyl1nder_hda._SYNC[serial]["scheduled"] = False
        clock.step(1.0)
        _feed([{"type": "kick", "force": True, "rev": 5}], 4)
        assert recooked == ["", ""], f"kick (rev unchanged) did not recook: {recooked}"
        print("stream kick (rev unchanged) -> recook scheduled OK")

        # reset (bridge restart) -> last_seen back to 0, full re-pull from 0,
        # recook scheduled, and every per-serial cache dropped so the recook
        # re-pushes the inputs and rebuilds outputs instead of reusing old data.
        _seed_caches()
        cyl1nder_hda._SYNC[serial]["scheduled"] = False
        clock.step(1.0)
        _feed([{"type": "reset", "rev": 0}], 5)
        assert recooked == ["", "", ""], f"reset did not recook: {recooked}"
        assert client.pull_sinces[-1] == 0, f"reset must re-pull from 0, got since={client.pull_sinces[-1]}"
        _assert_caches_cleared()
        print("stream reset -> full re-pull from 0 + caches cleared + recook OK")
        clock.step(1.0)  # move the burst outside the reset action's throttle window

        # reset inside the throttle window (same injected now as the previous
        # action) is a rare critical path: it must STILL pull + schedule a recook
        # (bypass the fps cap; the `scheduled` gate still prevents overlap)
        baseline_pulls = len(client.pull_sinces)
        baseline_recs = len(recooked)
        _seed_caches()
        cyl1nder_hda._SYNC[serial]["scheduled"] = False
        _feed([{"type": "reset", "rev": 0}], 6)
        assert len(client.pull_sinces) - baseline_pulls == 1, \
            f"reset inside the throttle window must still pull, pulled {len(client.pull_sinces) - baseline_pulls}x"
        assert len(recooked) - baseline_recs == 1, \
            "reset inside the throttle window must still schedule a recook"
        assert client.pull_sinces[-1] == 0, \
            f"reset must re-pull from 0, got since={client.pull_sinces[-1]}"
        _assert_caches_cleared()
        print("stream reset inside throttle window -> bypass fps cap (pull + recook) OK")
        clock.step(1.0)  # move the burst outside the reset action's throttle window

        # ---- fps throttle: back-to-back outputs burst (same injected now) causes
        #      only ONE pull + one recook; last_seen reaches the newest rev (latest-wins)
        baseline_pulls = len(client.pull_sinces)
        baseline_recs = len(recooked)
        cyl1nder_hda._SYNC[serial]["scheduled"] = False
        client.pull_rev = 24  # simulate the bridge advancing to the burst's newest rev
        _feed([{"type": "outputs", "rev": r} for r in (20, 21, 22, 23, 24)], 7)
        assert len(client.pull_sinces) - baseline_pulls == 1, \
            f"burst must pull once, pulled {len(client.pull_sinces) - baseline_pulls}x"
        assert len(recooked) - baseline_recs == 1, \
            f"burst must schedule one recook, scheduled {len(recooked) - baseline_recs}"
        assert client.stream_sinces[-1] == 24, \
            f"latest-wins: stream since must reach 24, got {client.stream_sinces[-1]}"
        assert cyl1nder_hda._READY[serial]["rev"] == 24, \
            f"ready buffer rev must be 24 after the burst, got {cyl1nder_hda._READY[serial]['rev']}"
        print("fps throttle: back-to-back outputs burst -> 1 pull / 1 recook, latest-wins OK")

        # window passed (clock stepped > 1/30) -> next outputs event pulls + recooks again
        baseline_pulls = len(client.pull_sinces)
        baseline_recs = len(recooked)
        cyl1nder_hda._SYNC[serial]["scheduled"] = False
        client.pull_rev = 25
        clock.step(0.1)
        _feed([{"type": "outputs", "rev": 25}], 8)
        assert len(client.pull_sinces) - baseline_pulls == 1, "event after window must pull"
        assert len(recooked) - baseline_recs == 1, "event after window must schedule recook"
        assert client.pull_sinces[-1] == 24, \
            f"next pull must start from ready rev 24 (latest-wins), got {client.pull_sinces[-1]}"
        print("fps throttle: event after window -> pull latest (since=24) + recook OK")

        # ---- a numeric fps on an event overrides the runtime cap ----
        baseline_pulls = len(client.pull_sinces)
        baseline_recs = len(recooked)
        cyl1nder_hda._SYNC[serial]["scheduled"] = False
        client.pull_rev = 26
        clock.step(0.1)  # > 1/30: this event acts and applies fps=10 for the NEXT one
        _feed([{"type": "outputs", "rev": 26, "fps": 10}], 9)
        assert cyl1nder_hda._SYNC[serial]["fps"] == 10, \
            f"runtime fps not updated: {cyl1nder_hda._SYNC[serial]['fps']}"
        assert len(client.pull_sinces) - baseline_pulls == 1, "fps event must pull"
        # cap is now 10 -> 1/10 = 0.1s: a back-to-back event (same now) is throttled
        baseline_pulls = len(client.pull_sinces)
        baseline_recs = len(recooked)
        cyl1nder_hda._SYNC[serial]["scheduled"] = False
        client.pull_rev = 27
        _feed([{"type": "outputs", "rev": 27}], 10)
        assert len(client.pull_sinces) - baseline_pulls == 0, \
            f"event inside 1/10s window must be throttled, pulled {len(client.pull_sinces) - baseline_pulls}x"
        assert len(recooked) - baseline_recs == 0, "throttled event must not recook"
        assert client.stream_sinces[-1] == 27, "throttled event still advances last_seen"
        print("stream event fps=10 -> runtime cap updated; back-to-back event throttled OK")
    finally:
        stop.set()
        gate._go.set()  # unblock any parked sleep so the loop thread exits
        th.join(timeout=2)
        assert not th.is_alive(), "loop thread did not exit on stop"
        cyl1nder_sync._schedule_recook = orig_schedule
        cyl1nder_hda._SYNC.pop(serial, None)
        cyl1nder_hda._READY.pop(serial, None)
        cyl1nder_hda._PUSH_CACHE.pop(serial, None)
        cyl1nder_hda._CORE_CACHE.pop(serial, None)
        cyl1nder_hda._OUT_CACHE.pop(serial, None)
        for key in [k for k in cyl1nder_hda._GEO_CACHE if k[0] == serial]:
            cyl1nder_hda._GEO_CACHE.pop(key, None)
        cyl1nder_hda._GEO_CACHE.pop(("other-" + serial, 0), None)

    # NOTE: node-deleted shutdown moved to the MAIN thread (ensure_sync aliveAt
    # heartbeat + stop_sync): _stream_loop never probes hou.node() again (HOM is
    # not thread-safe - the old background probe racing a reload crashed
    # Houdini). Stop-based shutdown is covered by _test_stop_all_sync() below
    # and the stop-exit assertion in the finally block above.


def _test_kick_force_recook() -> None:
    """kick stream event -> recook scheduled even with rev unchanged; the push
    cache is dropped so the recook re-pushes (heals a failed first push -> ok)."""
    serial = cyl1nder_hda.generate_serial()
    stop = threading.Event()
    cyl1nder_hda._SYNC[serial] = {"thread": None, "stop": stop, "node_path": "", "scheduled": False, "fps": 30}
    cyl1nder_hda._PUSH_CACHE[serial] = ("stale-sig",)  # inputs were already pushed once
    recooked: list[str] = []
    orig_schedule = cyl1nder_sync._schedule_recook
    cyl1nder_sync._schedule_recook = lambda node_path: recooked.append(node_path)  # type: ignore[assignment]
    th = None

    class _FakeClient:
        def __init__(self) -> None:
            self.last_error = "Connection refused"  # simulate a failed first push
            self.polls = 0
            self.events = [{"type": "kick", "force": True, "rev": 0}]

        def stream_once(self, since: int, hold: float = 60.0):
            self.polls += 1
            return self.events.pop(0) if self.events else None

        def pull_outputs(self, since: int):
            return [], int(since or 0)

    try:
        client = _FakeClient()
        sleeps: list[float] = []
        th = threading.Thread(
            target=cyl1nder_hda._stream_loop,
            args=(serial, "", "http://127.0.0.1:9", client),
            kwargs={"sleep_fn": sleeps.append, "now_fn": _FakeClock().now},
            daemon=True,
        )
        th.start()
        deadline = time.time() + 5.0
        while client.polls < 2 and time.time() < deadline:  # kick consumed, then error backoff
            time.sleep(0.005)
        assert client.polls >= 2, "stream loop did not run"
        assert recooked == [""], f"kick did not schedule recook: {recooked}"
        assert serial not in cyl1nder_hda._PUSH_CACHE, "kick should drop the push cache (re-push to heal)"
        print("kick stream event -> recook scheduled + push cache dropped (self-heal) OK")
    finally:
        cyl1nder_sync._schedule_recook = orig_schedule
        stop.set()
        if th is not None:
            th.join(timeout=2)
        cyl1nder_hda._SYNC.pop(serial, None)
        cyl1nder_hda._READY.pop(serial, None)
        cyl1nder_hda._PUSH_CACHE.pop(serial, None)


def _test_stop_all_sync() -> None:
    """stop_all_sync() stops EVERY background /stream loop (reload safety).

    reload_hda.py calls cyl1nder_hda.stop_all_sync() before importlib.reload()
    / hou.hda.reloadFile(): a live loop under a module reload is the HDA crash
    root cause. Each fake loop parks at the error backoff (stream_once -> None),
    then stop_all_sync() must stop all of them, mark their _SYNC entries
    stopped (so ensure_sync restarts them idempotently), and the loops must
    exit once their stop event is set.
    """
    serials = [cyl1nder_hda.generate_serial() for _ in range(3)]
    threads: list[threading.Thread] = []

    class _FakeClient:
        """stream_once -> None (connection error) -> loop parks at backoff sleep."""

        def __init__(self) -> None:
            self.last_error = ""

        def stream_once(self, since: int, hold: float = 60.0) -> dict | None:
            return None

        def pull_outputs(self, since: int):
            return [], int(since or 0)

    for serial in serials:
        stop = threading.Event()
        cyl1nder_hda._SYNC[serial] = {
            "thread": None,
            "stop": stop,
            "node_path": f"/obj/{serial}",
            "scheduled": False,
            "fps": 30,
            "aliveAt": 0.0,
            "stopped": False,
        }
        th = threading.Thread(
            target=cyl1nder_hda._stream_loop,
            args=(serial, f"/obj/{serial}", "http://127.0.0.1:9", _FakeClient()),
            daemon=True,
        )
        cyl1nder_hda._SYNC[serial]["thread"] = th
        th.start()
        threads.append(th)
    try:
        # wait until every loop is parked at the backoff sleep (still alive)
        deadline = time.time() + 5.0
        while time.time() < deadline and not all(t.is_alive() for t in threads):
            time.sleep(0.005)
        assert all(t.is_alive() for t in threads), "loops should be parked, not exited"
        cyl1nder_hda.stop_all_sync()
        for serial, th in zip(serials, threads):
            th.join(timeout=2)
            assert not th.is_alive(), f"loop {serial} did not exit after stop_all_sync"
            st = cyl1nder_hda._SYNC.get(serial)
            assert st is not None and st.get("stopped"), \
                f"loop {serial} not marked stopped after stop_all_sync"
        print("stop_all_sync -> all stream loops stopped + marked stopped OK")
    finally:
        for serial, th in zip(serials, threads):
            st = cyl1nder_hda._SYNC.get(serial)
            if st is not None and st.get("stop") is not None:
                st["stop"].set()
            th.join(timeout=2)
            cyl1nder_hda._SYNC.pop(serial, None)
            cyl1nder_hda._READY.pop(serial, None)


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

    # every cook refreshes the liveness heartbeat (main-thread ensure_sync)
    st_sync = cyl1nder_hda._SYNC.get(serial)
    assert st_sync is not None and "aliveAt" in st_sync, "ensure_sync must track aliveAt"
    time.sleep(0.02)
    node.cook()
    assert cyl1nder_hda._SYNC[serial]["aliveAt"] >= st_sync["aliveAt"], \
        "ensure_sync must refresh aliveAt on every cook"
    print("ensure_sync aliveAt heartbeat updated on cook OK")

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
    _wait_ready_rev(serial, r["rev"])  # stream loop refreshed _READY (event-driven)
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

    _test_stream_loop()
    _test_kick_force_recook()
    _test_stop_all_sync()

    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())