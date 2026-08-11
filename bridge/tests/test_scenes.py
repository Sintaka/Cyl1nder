"""Scene endpoints + usdz export: list/create/save/open."""
from __future__ import annotations

import io
import json
import os
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from bridge.main import create_app
from bridge.protocol import generate_serial, is_valid_serial
from bridge.state import reset_state
from bridge.usdz import write_usdz


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    """Fresh bridge state + snapshot root redirected to tmp (never touches real data)."""
    os.environ["CYL1NDER_SNAPSHOT_ROOT"] = str(tmp_path / "snapshots")
    reset_state(tmp_path / "data")
    yield TestClient(create_app())
    os.environ.pop("CYL1NDER_SNAPSHOT_ROOT", None)


def test_list_scenes_empty(client: TestClient) -> None:
    body = client.get("/api/scenes").json()
    assert body == {"active": [], "history": []}


def test_create_scene_default_label(client: TestClient) -> None:
    r = client.post("/api/scenes", json={})
    assert r.status_code == 200
    serial = r.json()["serial"]
    assert is_valid_serial(serial)
    active = client.get("/api/scenes").json()["active"]
    assert [e["serial"] for e in active] == [serial]
    entry = active[0]
    assert entry["label"] == "Scene"
    assert entry["nodePath"] == ""
    assert entry["inputRev"] == 0 and entry["outputRev"] == 0


def test_create_scene_with_label(client: TestClient) -> None:
    serial = client.post("/api/scenes", json={"label": "  My Scene "}).json()["serial"]
    entry = next(e for e in client.get("/api/scenes").json()["active"] if e["serial"] == serial)
    assert entry["label"] == "My Scene"


def test_scene_save_copies_folder_and_usdz(client: TestClient, tmp_path: Path) -> None:
    serial = client.post("/api/scenes", json={}).json()["serial"]
    payload = {
        "inputs": [
            {
                "index": 0,
                "name": "in0",
                "pointCount": 3,
                "primCount": 1,
                "points": [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
                "curves": [{"pointIndices": [0, 1, 2], "widths": None}],
                "faces": [],
                "attributes": {},
            }
        ],
        "nodePath": "/obj/geo1/cyl1nder1",
        "label": "Cyl1nder",
    }
    assert client.put(f"/api/hda/{serial}/inputs", json=payload).status_code == 200

    out = tmp_path / "out"
    body = client.post(f"/api/hda/{serial}/scene/save", json={"target_dir": str(out)}).json()
    assert body["ok"] is True
    target = Path(body["path"])
    assert target == out / serial
    assert (target / "io" / "inputs.json").exists()
    assert (target / "io" / "outputs.json").exists()
    assert (target / "scene" / "meta.json").exists()

    usdz = target / f"{serial}.usdz"
    assert usdz.exists()
    with zipfile.ZipFile(usdz) as zf:
        assert "root.usda" in zf.namelist()
        usda = zf.read("root.usda").decode("utf-8")
    assert usda.startswith("#usda 1.0")
    assert 'def BasisCurves "Input0"' in usda

    # existing target -> conflict unless overwrite
    r2 = client.post(f"/api/hda/{serial}/scene/save", json={"target_dir": str(out)})
    assert r2.json() == {"ok": False, "exists": True}
    r3 = client.post(
        f"/api/hda/{serial}/scene/save", json={"target_dir": str(out), "overwrite": True}
    )
    assert r3.json()["ok"] is True
    assert Path(r3.json()["path"]).exists()


def test_scene_save_includes_graph_and_docking(client: TestClient, tmp_path: Path) -> None:
    serial = client.post("/api/scenes", json={}).json()["serial"]
    graph = {"nodes": [{"id": "n1"}], "connections": []}
    docking = {"panels": ["viewport"]}
    assert (
        client.put(f"/api/hda/{serial}/snapshot", json={"graph": graph, "docking": docking}).status_code
        == 200
    )
    out = tmp_path / "out"
    target = Path(
        client.post(f"/api/hda/{serial}/scene/save", json={"target_dir": str(out)}).json()["path"]
    )
    assert json.loads((target / "scene" / "node-graph.json").read_text(encoding="utf-8")) == graph
    assert json.loads((target / "docking-layout.json").read_text(encoding="utf-8")) == docking


def test_scene_save_requires_target_dir_and_valid_serial(client: TestClient) -> None:
    assert client.post("/api/hda/zzz/scene/save", json={"target_dir": "x"}).status_code == 400
    serial = client.post("/api/scenes", json={}).json()["serial"]
    assert client.post(f"/api/hda/{serial}/scene/save", json={}).status_code == 400


def test_scenes_open_registers_and_loads(client: TestClient, tmp_path: Path) -> None:
    serial = generate_serial()
    folder = tmp_path / serial
    inputs = [
        {
            "index": 0,
            "name": "in0",
            "pointCount": 2,
            "primCount": 1,
            "points": [[0, 0, 0], [1, 1, 1]],
            "curves": [],
            "faces": [],
            "attributes": {},
        }
    ]
    graph = {"nodes": [{"id": "a"}], "connections": []}
    docking = {"panels": ["viewport"]}
    (folder / "io").mkdir(parents=True)
    (folder / "scene").mkdir(parents=True)
    (folder / "io" / "inputs.json").write_text(json.dumps(inputs), encoding="utf-8")
    (folder / "scene" / "node-graph.json").write_text(json.dumps(graph), encoding="utf-8")
    (folder / "docking-layout.json").write_text(json.dumps(docking), encoding="utf-8")
    (folder / "scene" / "meta.json").write_text(
        json.dumps({"serial": serial, "label": "OpenMe", "nodePath": "/obj/x"}), encoding="utf-8"
    )

    r = client.post("/api/scenes/open", json={"folder_path": str(folder)})
    assert r.status_code == 200
    assert r.json() == {"serial": serial}
    assert serial in client.get("/api/serials").json()
    status = client.get(f"/api/hda/{serial}/status").json()
    assert status["workspace"]["inputRev"] == 1
    snap = client.get(f"/api/hda/{serial}/snapshot").json()["snapshot"]
    assert snap["inputs"] == inputs
    assert snap["graph"] == graph
    assert snap["docking"] == docking
    entry = next(e for e in client.get("/api/scenes").json()["active"] if e["serial"] == serial)
    assert entry["label"] == "OpenMe"

    # non-serial folder name -> 400
    bad = tmp_path / "not-a-serial"
    bad.mkdir()
    assert client.post("/api/scenes/open", json={"folder_path": str(bad)}).status_code == 400
    # missing folder_path -> 400
    assert client.post("/api/scenes/open", json={}).status_code == 400


def test_scene_open_then_save_roundtrip(client: TestClient, tmp_path: Path) -> None:
    """Open a folder, then save to a new target dir: files + usdz land in the target."""
    serial = generate_serial()
    src = tmp_path / serial
    (src / "io").mkdir(parents=True)
    (src / "scene").mkdir(parents=True)
    (src / "io" / "inputs.json").write_text(
        json.dumps([{"index": 0, "name": "in0", "points": [[1, 2, 3]], "curves": [], "faces": [], "attributes": {}}]),
        encoding="utf-8",
    )
    (src / "scene" / "node-graph.json").write_text(json.dumps({"nodes": []}), encoding="utf-8")
    assert client.post("/api/scenes/open", json={"folder_path": str(src)}).json() == {"serial": serial}

    out = tmp_path / "saved"
    body = client.post(f"/api/hda/{serial}/scene/save", json={"target_dir": str(out)}).json()
    assert body["ok"] is True
    target = Path(body["path"])
    assert (target / "io" / "inputs.json").exists()
    assert (target / f"{serial}.usdz").exists()


def test_write_usdz_prims(client: TestClient, tmp_path: Path) -> None:
    """Direct usdz unit test: BasisCurves / Points / Mesh mapping from io snapshot."""
    serial = generate_serial()
    root = tmp_path / "snapshots" / serial
    (root / "io").mkdir(parents=True)
    inputs = [
        {
            "index": 0,
            "name": "in0",
            "points": [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
            "curves": [{"pointIndices": [0, 1, 2], "widths": None}],
            "faces": [],
        },
        {"index": 1, "name": "in1", "points": [[0, 0, 0], [1, 1, 1]], "curves": [], "faces": []},
    ]
    outputs = [
        {
            "index": 0,
            "name": "out0",
            "points": [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
            "curves": [],
            "faces": [[0, 1, 2, 3]],
        }
    ]
    (root / "io" / "inputs.json").write_text(json.dumps(inputs), encoding="utf-8")
    (root / "io" / "outputs.json").write_text(json.dumps(outputs), encoding="utf-8")

    out = tmp_path / "out" / f"{serial}.usdz"
    assert write_usdz(serial, out, hip="") == out
    with zipfile.ZipFile(out) as zf:
        usda = zf.read("root.usda").decode("utf-8")
    assert 'def BasisCurves "Input0"' in usda
    assert "curveVertexCounts = [3]" in usda
    assert 'def Points "Input1"' in usda
    assert 'def Mesh "Output0"' in usda
    assert 'subdivisionScheme = "none"' in usda
    assert "faceVertexCounts = [4]" in usda
    assert "faceVertexIndices = [0, 1, 2, 3]" in usda


def test_write_usdz_empty_stage(client: TestClient, tmp_path: Path) -> None:
    """No snapshot / empty io -> usdz contains only an empty stage."""
    serial = generate_serial()
    out = tmp_path / "out" / f"{serial}.usdz"
    assert write_usdz(serial, out, hip="") == out
    with zipfile.ZipFile(out) as zf:
        usda = zf.read("root.usda").decode("utf-8")
    assert usda.startswith("#usda 1.0")
    assert 'def Xform "Root"' in usda
    assert "BasisCurves" not in usda and "Mesh" not in usda and "Points" not in usda

def test_get_usdz_bytes(client: TestClient) -> None:
    """GET /api/hda/{serial}/usdz returns a valid usdz archive for FS Access save."""
    serial = client.post("/api/scenes", json={}).json()["serial"]
    client.put(
        f"/api/hda/{serial}/inputs",
        json={
            "inputs": [
                {
                    "index": 0,
                    "name": "in0",
                    "pointCount": 2,
                    "primCount": 1,
                    "points": [[0, 0, 0], [1, 1, 1]],
                    "curves": [],
                    "faces": [],
                    "attributes": {},
                }
            ]
        },
    )
    r = client.get(f"/api/hda/{serial}/usdz")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("model/vnd.usdz")
    assert f'filename="{serial}.usdz"' in r.headers.get("content-disposition", "")
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        assert "root.usda" in zf.namelist()
        usda = zf.read("root.usda").decode("utf-8")
    assert usda.startswith("#usda 1.0")
    assert 'def Points "Input0"' in usda
    # invalid serial -> 400
    assert client.get("/api/hda/zzz/usdz").status_code == 400

