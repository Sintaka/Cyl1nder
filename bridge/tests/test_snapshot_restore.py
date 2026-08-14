"""Snapshot restore: restart round-trip, dual-root merge, WS edit flush, restore endpoint.

These tests pin the fix for "scene data empty after a computer restart": the WS
edit channel must persist to disk, and a bridge restart must repopulate empty
workspaces from the disk snapshot (including the hip-root / fallback-root split).
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi.testclient import TestClient

import bridge.snapshot as snap
from bridge.main import create_app
from bridge.protocol import InputPayload, OutputBuffer, generate_serial
from bridge.state import get_state, reset_state


def _input(name: str = "in0", point: list[float] | None = None) -> dict:
    return {
        "index": 0,
        "name": name,
        "pointCount": 1,
        "primCount": 1,
        "points": [point or [0, 0, 0]],
        "curves": [],
        "faces": [],
        "attributes": {},
    }


def _output(index: int = 0, point: list[float] | None = None) -> dict:
    return {
        "index": index,
        "rev": 0,
        "pointCount": 1,
        "primCount": 1,
        "points": [point or [1, 1, 1]],
        "curves": [],
        "faces": [],
        "attributes": {},
    }


def test_roundtrip_restore_after_restart(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(snap, "DEFAULT_ROOT", tmp_path / "default")
    data_dir = tmp_path / "data"
    reset_state(data_dir)
    st = get_state()
    serial = generate_serial()
    st.registry.register(serial, hip="")
    ws = st.workspaces.get_or_create(serial)
    ws.set_inputs([InputPayload(index=0, name="in0", pointCount=2, primCount=1, points=[[0, 0, 0], [1, 1, 1]])], frame=7.0)
    ws.put_outputs([OutputBuffer(index=0, rev=0, pointCount=2, points=[[1, 0, 0], [0, 1, 0]])])
    exp_inputs = [i.model_dump() for i in ws.inputs]
    exp_outputs = [o.model_dump() for o in ws.all_outputs()]
    assert snap.write_snapshot(serial, "", inputs=exp_inputs, outputs=exp_outputs) is True

    # simulate a bridge restart: fresh in-memory state, same persisted data dir
    reset_state(data_dir)
    assert snap.restore_all_workspaces() == 1
    ws2 = get_state().workspaces.get(serial)
    assert ws2 is not None
    assert [i.model_dump() for i in ws2.inputs] == exp_inputs
    assert [o.model_dump() for o in ws2.all_outputs()] == exp_outputs


def test_read_snapshot_dual_root_merge(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(snap, "DEFAULT_ROOT", tmp_path / "default")
    serial = generate_serial()
    hip = str(tmp_path / "hipdir" / "scene.hip")
    hip_inputs = [_input(name="hip-in", point=[0, 0, 0])]
    default_inputs = [_input(name="default-in", point=[9, 9, 9])]
    outputs = [_output(point=[1, 2, 3])]

    snap.write_snapshot(serial, hip, inputs=hip_inputs)
    snap.write_snapshot(serial, "", inputs=default_inputs, outputs=outputs)

    merged = snap.read_snapshot(hip, serial)
    assert merged is not None
    assert merged["inputs"] == hip_inputs  # hip root wins on conflict
    assert merged["outputs"] == outputs  # filled from the fallback root


def test_restore_skips_nonempty_workspace(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(snap, "DEFAULT_ROOT", tmp_path / "default")
    reset_state(tmp_path / "data")
    st = get_state()
    serial = generate_serial()
    st.registry.register(serial, hip="")
    ws = st.workspaces.get_or_create(serial)
    ws.set_inputs([InputPayload(index=0, name="live", pointCount=1, points=[[0, 0, 0]])])
    snap.write_snapshot(serial, "", inputs=[_input(name="disk", point=[9, 9, 9])])

    assert snap.restore_workspace(serial, "") is False
    assert ws.inputs[0].name == "live"  # never overwritten


def test_restore_skips_bad_entries(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(snap, "DEFAULT_ROOT", tmp_path / "default")
    reset_state(tmp_path / "data")
    st = get_state()
    serial = generate_serial()
    st.registry.register(serial, hip="")
    good_input = _input(name="good", point=[0, 0, 0])
    bad_input = {"index": "not-an-int"}
    good_output = _output(index=1, point=[1, 1, 1])
    bad_output = {"index": "nope"}
    snap.write_snapshot(serial, "", inputs=[good_input, bad_input], outputs=[good_output, bad_output])

    assert snap.restore_workspace(serial, "") is True
    ws = st.workspaces.get(serial)
    assert len(ws.inputs) == 1 and ws.inputs[0].name == "good"
    outs = ws.all_outputs()
    assert len(outs) == 1 and outs[0].index == 1
    assert any(e["level"] == "error" for e in st.logs.query(serial=serial))


def test_ws_edit_triggers_snapshot(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(snap, "DEFAULT_ROOT", tmp_path / "default")
    monkeypatch.setattr(snap, "_SNAP_THROTTLE", 0.0)
    snap._SNAP_LAST.clear()
    reset_state(tmp_path / "data")
    serial = generate_serial()
    get_state().registry.register(serial, hip="")
    out = [
        {
            "index": 0,
            "rev": 0,
            "pointCount": 3,
            "primCount": 1,
            "points": [[0, 0, 0], [1, 1, 0], [2, 2, 0]],
            "curves": [],
            "faces": [],
            "attributes": {},
        }
    ]
    client = TestClient(create_app())
    with client.websocket_connect(f"/ws?serial={serial}") as ws:
        ws.send_json({"type": "edit", "outputs": out})
        p = tmp_path / "default" / serial / "io" / "outputs.json"
        deadline = time.time() + 2
        data = None
        while time.time() < deadline:
            if p.exists():
                data = json.loads(p.read_text(encoding="utf-8"))
                break
            time.sleep(0.01)
        assert data is not None, "WS edit did not write io/outputs.json"
        assert len(data) == 1
        assert data[0]["points"] == out[0]["points"]
        assert data[0]["rev"] == 1  # put_outputs bumps rev on the accepted buffer


def test_restore_endpoint(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(snap, "DEFAULT_ROOT", tmp_path / "default")
    data_dir = tmp_path / "data"
    reset_state(data_dir)
    st = get_state()
    serial = generate_serial()
    st.registry.register(serial, hip="")
    ws = st.workspaces.get_or_create(serial)
    ws.set_inputs([InputPayload(index=0, name="in0", pointCount=2, points=[[0, 0, 0], [1, 1, 1]])])
    ws.put_outputs([OutputBuffer(index=0, rev=0, pointCount=2, points=[[1, 0, 0], [0, 1, 0]])])
    snap.write_snapshot(serial, "", inputs=[i.model_dump() for i in ws.inputs], outputs=[o.model_dump() for o in ws.all_outputs()])

    reset_state(data_dir)  # simulate restart
    client = TestClient(create_app())
    r = client.post(f"/api/hda/{serial}/snapshot/restore")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["serial"] == serial
    assert body["restored"] is True
    assert body["inputRev"] == 1
    assert body["outputRev"] == 1
    ws2 = get_state().workspaces.get(serial)
    assert ws2 is not None
    assert len(ws2.inputs) == 1 and ws2.inputs[0].name == "in0"
    assert len(ws2.all_outputs()) == 1
    # invalid serial -> 400
    assert client.post("/api/hda/zzz/snapshot/restore").status_code == 400


def test_startup_lifespan_restores_empty_workspaces(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(snap, "DEFAULT_ROOT", tmp_path / "default")
    data_dir = tmp_path / "data"
    reset_state(data_dir)
    st = get_state()
    serial = generate_serial()
    st.registry.register(serial, hip="")
    ws = st.workspaces.get_or_create(serial)
    ws.set_inputs([InputPayload(index=0, name="in0", pointCount=1, points=[[0, 0, 0]])])
    snap.write_snapshot(serial, "", inputs=[i.model_dump() for i in ws.inputs], outputs=[])

    reset_state(data_dir)  # simulate restart
    with TestClient(create_app()):
        pass  # startup lifespan runs restore_all_workspaces
    ws2 = get_state().workspaces.get(serial)
    assert ws2 is not None and len(ws2.inputs) == 1
    assert ws2.inputs[0].name == "in0"
