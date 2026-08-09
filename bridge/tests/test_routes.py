from pathlib import Path

from fastapi.testclient import TestClient

from bridge.main import create_app
from bridge.protocol import generate_serial
from bridge.state import reset_state


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
    assert r.headers["location"] == "http://127.0.0.1:5173/?serial=C1-msm006pg-8fz7"


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
