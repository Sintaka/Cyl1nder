import json
from pathlib import Path

from fastapi.testclient import TestClient

from bridge.main import create_app
from bridge.protocol import generate_serial
from bridge.state import get_state, reset_state


def _client(tmp_path: Path) -> TestClient:
    reset_state(tmp_path / "data")
    return TestClient(create_app())


def test_health(tmp_path: Path) -> None:
    c = _client(tmp_path)
    r = c.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body


def test_roundtrip_inputs_outputs(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    payload = {
        "inputs": [
            {
                "index": 0,
                "name": "in0",
                "pointCount": 3,
                "primCount": 1,
                "points": [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
                "curves": [{"pointIndices": [0, 1, 2]}],
            }
        ],
        "nodePath": "/obj/geo1/cyl1nder1",
        "label": "Cyl1nder",
    }
    r = c.put(f"/api/hda/{serial}/inputs", json=payload)
    assert r.status_code == 200
    assert serial in c.get("/api/serials").json()
    status = c.get(f"/api/hda/{serial}/status").json()
    assert status["registry"]["nodePath"] == "/obj/geo1/cyl1nder1"
    assert status["workspace"]["inputRev"] == 1

    # web pushes an edit
    out = {"outputs": [{"index": 0, "rev": 0, "pointCount": 3, "points": [[0, 0, 0], [1, 1, 0], [2, 2, 0]]}]}
    r = c.put(f"/api/hda/{serial}/outputs", json=out)
    assert r.status_code == 200
    rev = r.json()["rev"]

    # hda pulls changed outputs
    r = c.get(f"/api/hda/{serial}/outputs", params={"since": 0})
    data = r.json()
    assert data["outputs"]
    assert data["outputs"][0]["points"] == [[0, 0, 0], [1, 1, 0], [2, 2, 0]]
    # nothing new after rev
    r = c.get(f"/api/hda/{serial}/outputs", params={"since": rev})
    assert r.json()["outputs"] == []


def test_invalid_serial_400(tmp_path: Path) -> None:
    c = _client(tmp_path)
    assert c.put("/api/hda/zzz/inputs", json={"inputs": []}).status_code == 400
    assert c.get("/api/hda/zzz/status").status_code == 400
    assert c.get("/api/hda/zzz/outputs").status_code == 400


def test_unknown_route_404(tmp_path: Path) -> None:
    c = _client(tmp_path)
    assert c.get("/api/nope").status_code == 404


def test_logs_endpoints(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    c.put(f"/api/hda/{serial}/inputs", json={"inputs": []})
    assert c.get("/api/logs").status_code == 200
    logs = c.get(f"/api/hda/{serial}/logs").json()["logs"]
    assert any(log["serial"] == serial for log in logs)


def test_root_redirects_to_ui_with_serial(tmp_path) -> None:
    c = _client(tmp_path)
    r = c.get("/", params={"serial": "C1-msm006pg-8fz7"}, follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"] == "http://127.0.0.1:8376/?serial=C1-msm006pg-8fz7"


def test_root_info_without_serial(tmp_path) -> None:
    c = _client(tmp_path)
    r = c.get("/")
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "cyl1nder-bridge"
    assert "ui" in body


def test_pending_dirty_check(tmp_path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    assert c.get(f"/api/hda/{serial}/pending", params={"since": 0}).json()["pending"] is False
    c.put(f"/api/hda/{serial}/outputs", json={"outputs": [{"index": 0, "rev": 0, "points": [[0, 0, 0]]}]})
    r = c.get(f"/api/hda/{serial}/pending", params={"since": 0}).json()
    assert r["pending"] is True and r["rev"] >= 1
    assert c.get(f"/api/hda/{serial}/pending", params={"since": r["rev"]}).json()["pending"] is False


def test_outputs_echo_dedupe(tmp_path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    out = {"outputs": [{"index": 0, "rev": 0, "pointCount": 2, "points": [[0, 0, 0], [1, 0, 0]], "curves": [{"pointIndices": [0, 1]}]}]}
    r1 = c.put(f"/api/hda/{serial}/outputs", json=out).json()
    r2 = c.put(f"/api/hda/{serial}/outputs", json=out).json()
    assert r2["rev"] == r1["rev"]  # identical echo -> no rev bump
    assert c.get(f"/api/hda/{serial}/outputs", params={"since": r1["rev"]}).json()["outputs"] == []


def test_stream_immediate_outputs(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    c.put(f"/api/hda/{serial}/outputs", json={"outputs": [{"index": 0, "rev": 0, "points": [[0, 0, 0]]}]})
    r = c.get(f"/api/hda/{serial}/stream", params={"since": 0, "hold": 5})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/x-ndjson")
    body = r.json()  # single-line NDJSON parses as JSON
    assert body["type"] == "outputs"
    assert body["rev"] >= 1
    # nothing new after the current rev -> holds (tiny hold) then timeout
    r2 = c.get(f"/api/hda/{serial}/stream", params={"since": body["rev"], "hold": 0.05})
    assert r2.json()["type"] == "timeout"


def test_stream_reset_when_rev_fell_back(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    # client already saw rev=5 but the bridge restarted -> rev fell back to 0
    r = c.get(f"/api/hda/{serial}/stream", params={"since": 5, "hold": 5})
    assert r.status_code == 200
    body = r.json()
    assert body == {"type": "reset", "rev": 0, "fps": 30}


def test_stream_timeout_with_small_hold(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    r = c.get(f"/api/hda/{serial}/stream", params={"since": 0, "hold": 0.05})
    assert r.status_code == 200
    body = r.json()
    assert body == {"type": "timeout", "rev": 0, "fps": 30}


def test_stream_touch_updates_last_seen(tmp_path: Path) -> None:
    c = _client(tmp_path)
    st = get_state()
    serial = generate_serial()
    assert st.registry.get(serial) is None
    c.get(f"/api/hda/{serial}/stream", params={"since": 0, "hold": 0.05})
    rec = st.registry.get(serial)
    assert rec is not None and rec.lastSeen > 0


def test_stream_hold_upper_bound(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    assert c.get(f"/api/hda/{serial}/stream", params={"since": 0, "hold": 61}).status_code == 422
    assert c.get(f"/api/hda/{serial}/stream", params={"since": 0, "hold": -1}).status_code == 422


def test_stream_kick_wakes_held_poll(tmp_path: Path) -> None:
    """A held /stream returns {"type":"kick","force":true} when POST /kick fires."""
    import asyncio

    from httpx import ASGITransport, AsyncClient

    app = create_app()
    reset_state(tmp_path / "data")

    async def scenario() -> None:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            serial = generate_serial()
            # register first: kick requires an existing registry record
            assert (await c.get(f"/api/hda/{serial}/pending")).json()["pending"] is False
            held = asyncio.create_task(
                c.get(f"/api/hda/{serial}/stream", params={"since": 0, "hold": 3})
            )
            st = get_state()
            for _ in range(100):
                if st._stream_events.get(serial):
                    break
                await asyncio.sleep(0.01)
            assert st._stream_events.get(serial), "stream never subscribed before kick"
            r = await c.post(f"/api/hda/{serial}/kick")
            assert r.status_code == 200
            resp = await asyncio.wait_for(held, timeout=2)
            body = resp.json()
            assert body == {"type": "kick", "force": True, "rev": 0, "fps": 30}
            assert not st._stream_events.get(serial), "stream waiter not cleaned up"

    asyncio.run(scenario())


def test_put_sync_fps_sets_and_streams(tmp_path: Path) -> None:
    """PUT /api/hda/{serial}/sync stores the per-serial cap; /stream events carry fps."""
    c = _client(tmp_path)
    serial = generate_serial()
    r = c.put(f"/api/hda/{serial}/sync", json={"fps": 45})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "serial": serial, "fps": 45}
    assert get_state().get_sync_fps(serial) == 45
    # /stream events carry the current fps
    c.put(f"/api/hda/{serial}/outputs", json={"outputs": [{"index": 0, "rev": 0, "points": [[0, 0, 0]]}]})
    body = c.get(f"/api/hda/{serial}/stream", params={"since": 0, "hold": 5}).json()
    assert body["type"] == "outputs"
    assert body["fps"] == 45
    # out-of-range is rejected (422) and never stored
    assert c.put(f"/api/hda/{serial}/sync", json={"fps": 0}).status_code == 422
    assert c.put(f"/api/hda/{serial}/sync", json={"fps": 61}).status_code == 422
    assert get_state().get_sync_fps(serial) == 45


def test_stream_events_include_default_fps(tmp_path: Path) -> None:
    c = _client(tmp_path)
    serial = generate_serial()
    body = c.get(f"/api/hda/{serial}/stream", params={"since": 0, "hold": 0.05}).json()
    assert body["type"] == "timeout"
    assert body["fps"] == 30


def test_put_snapshot_preference(tmp_path: Path, monkeypatch) -> None:
    """putSnapshot with a preference part writes Preference.json and read_snapshot returns it."""
    monkeypatch.setenv("CYL1NDER_SNAPSHOT_ROOT", str(tmp_path / "snaps"))
    c = _client(tmp_path)
    serial = generate_serial()
    pref = {"schemaVersion": 1, "sync_max_fps": 45, "update_mode": "auto"}
    r = c.put(f"/api/hda/{serial}/snapshot", json={"preference": pref})
    assert r.status_code == 200
    snap = c.get(f"/api/hda/{serial}/snapshot").json()["snapshot"]
    assert snap["preference"] == pref
    p = tmp_path / "snaps" / serial / "Preference.json"
    assert p.exists()
    assert json.loads(p.read_text(encoding="utf-8")) == pref


def test_stage_broadcast_latest_wins_coalesced(tmp_path: Path, monkeypatch) -> None:
    """stage_broadcast merges by index (latest-wins) and flushes once per fps window."""
    import asyncio
    import time

    import bridge.ws as ws_mod
    from bridge.protocol import OutputBuffer

    reset_state(tmp_path / "data")
    st = get_state()
    serial = generate_serial()
    st.set_sync_fps(serial, 1)  # 1s window

    class FakeManager:
        def __init__(self) -> None:
            self.messages: list[tuple[str, dict]] = []

        async def broadcast(self, serial: str, message: dict) -> None:
            self.messages.append((serial, message))

    fake = FakeManager()
    monkeypatch.setattr(ws_mod, "manager", fake)

    a = OutputBuffer(index=0, rev=0, points=[[0, 0, 0]])
    b = OutputBuffer(index=1, rev=0, points=[[1, 1, 1]])
    c2 = OutputBuffer(index=0, rev=0, points=[[2, 2, 2]])

    async def scenario() -> None:
        # pretend a flush just happened so both stages fall inside one window
        with st._bcast_lock:
            st._bcast_last[serial] = time.monotonic()
        st.stage_broadcast(serial, [a, b], 1)
        st.stage_broadcast(serial, [c2], 2)  # same index 0 -> replaces a
        await asyncio.sleep(0.05)
        assert fake.messages == []  # still inside the window: nothing flushed
        await asyncio.sleep(1.1)  # past the window edge -> single coalesced flush
        assert len(fake.messages) == 1
        got_serial, msg = fake.messages[0]
        assert got_serial == serial
        assert msg["type"] == "outputs"
        assert msg["rev"] == 2
        by_index = {o["index"]: o for o in msg["outputs"]}
        assert by_index[0]["points"] == [[2, 2, 2]]  # latest-wins
        assert by_index[1]["points"] == [[1, 1, 1]]

    asyncio.run(scenario())


def test_notify_stream_coalesced_to_sync_fps(tmp_path: Path) -> None:
    """notify_stream wakes at most once per 1/fps window (latest state at the edge)."""
    import asyncio

    reset_state(tmp_path / "data")
    st = get_state()
    serial = generate_serial()
    st.set_sync_fps(serial, 1)  # 1s window

    async def scenario() -> None:
        ev = st.subscribe(serial)
        st.notify_stream(serial)  # first wake: immediate
        assert ev.is_set()
        ev.clear()
        st.notify_stream(serial)  # within window -> one coalesced wake scheduled
        st.notify_stream(serial)  # still within window -> no extra schedule
        assert not ev.is_set()
        await asyncio.sleep(0.05)
        assert not ev.is_set()
        await asyncio.sleep(1.1)
        assert ev.is_set()
        st.unsubscribe(serial, ev)

    asyncio.run(scenario())
