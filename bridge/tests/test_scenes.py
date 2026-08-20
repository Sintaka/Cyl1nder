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


def test_delete_scene_removes_registration(client: TestClient) -> None:
    """`DELETE /api/scenes/{serial}` 删掉一条登记（v0.1.00142）。"""
    serial = client.post("/api/scenes", json={}).json()["serial"]
    assert any(e["serial"] == serial for e in client.get("/api/scenes").json()["active"])
    body = client.delete(f"/api/scenes/{serial}").json()
    assert body == {"ok": True, "removed": True}
    assert not any(e["serial"] == serial for e in client.get("/api/scenes").json()["active"])


def test_delete_scene_works_even_with_data(client: TestClient) -> None:
    """**有数据也能删** —— 这正是它存在的理由。

    `cleanup` 只清「无数据且无快照」，所以被推过 inputs 的孤儿登记（e2e 留下的
    `inputRev=38`）永远清不掉；实测桥里攒了 37 条这种。每条都让 `hello` 多做一份活。
    """
    serial = client.post("/api/scenes", json={}).json()["serial"]
    client.put(f"/api/hda/{serial}/inputs", json={"inputs": []})
    # 先证明 cleanup 确实清不掉它（否则这个端点就是多余的）
    cleaned = {r["serial"] for r in client.post("/api/scenes/cleanup").json()["removed"]}
    assert serial not in cleaned
    assert client.delete(f"/api/scenes/{serial}").json()["removed"] is True
    assert not any(e["serial"] == serial for e in client.get("/api/scenes").json()["active"])


def test_delete_scene_rejects_invalid_serial(client: TestClient) -> None:
    """非法 serial → 400，绝不当成"删了个不存在的"而静默成功。"""
    assert client.delete("/api/scenes/not-a-serial").status_code == 400


def test_delete_scene_unknown_serial_reports_false(client: TestClient) -> None:
    """合法但不存在 → `removed: False`（如实说没删到东西，不报错）。"""
    body = client.delete(f"/api/scenes/{generate_serial()}").json()
    assert body == {"ok": True, "removed": False}


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


def test_scene_save_ignores_graph_but_keeps_docking(client: TestClient, tmp_path: Path) -> None:
    """`graph` 被**收下但不写**（v0.1.00122），`docking` 照常落盘。

    成员图归项目所有（项目目录的 `graph.json`）。两个图家会重演 v0.1.00117 那次
    「成员图覆盖项目根」的数据丢失，所以成员侧不再有 `scene/node-graph.json`。
    仍返回 200 而不是 4xx：老的 web 构建还会发这个键，硬报错会直接打断 cook 推送。
    """
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
    assert not (target / "scene" / "node-graph.json").exists()  # 成员侧不再有图
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


def test_last_activity_updates_on_data_write(client: TestClient) -> None:
    """lastActivity: 0 until data is pushed; put_inputs / put_outputs bump it."""
    serial = client.post("/api/scenes", json={}).json()["serial"]
    entry = next(e for e in client.get("/api/scenes").json()["active"] if e["serial"] == serial)
    assert entry["lastActivity"] == 0

    client.put(
        f"/api/hda/{serial}/inputs",
        json={
            "inputs": [
                {"index": 0, "name": "in0", "pointCount": 1, "points": [[0, 0, 0]], "curves": [], "faces": [], "attributes": {}}
            ]
        },
    )
    entry = next(e for e in client.get("/api/scenes").json()["active"] if e["serial"] == serial)
    assert entry["lastActivity"] > 0
    after_inputs = entry["lastActivity"]

    client.put(
        f"/api/hda/{serial}/outputs",
        json={
            "outputs": [
                {"index": 0, "pointCount": 1, "primCount": 1, "points": [[1, 1, 1]], "curves": [], "faces": [], "attributes": {}}
            ]
        },
    )
    entry = next(e for e in client.get("/api/scenes").json()["active"] if e["serial"] == serial)
    assert entry["lastActivity"] >= after_inputs


def test_cleanup_removes_invalid_scenes(client: TestClient, tmp_path: Path) -> None:
    """Cleanup deletes empty / incomplete / corrupt-meta dirs + dead registry serials, keeps valid ones."""
    snap = tmp_path / "snapshots"
    snap.mkdir()

    empty = generate_serial()
    (snap / empty).mkdir()

    incomplete = generate_serial()
    (snap / incomplete / "io").mkdir(parents=True)
    (snap / incomplete / "io" / "outputs.json").write_text("[]", encoding="utf-8")

    corrupt = generate_serial()
    (snap / corrupt / "scene").mkdir(parents=True)
    (snap / corrupt / "scene" / "meta.json").write_text("{not json", encoding="utf-8")

    valid = generate_serial()
    (snap / valid / "io").mkdir(parents=True)
    (snap / valid / "scene").mkdir(parents=True)
    (snap / valid / "io" / "inputs.json").write_text("[]", encoding="utf-8")
    (snap / valid / "scene" / "meta.json").write_text(json.dumps({"savedAt": 1}), encoding="utf-8")

    dead = client.post("/api/scenes", json={}).json()["serial"]  # registry-only, no data + no snapshot
    alive_ws = client.post("/api/scenes", json={}).json()["serial"]
    client.put(f"/api/hda/{alive_ws}/inputs", json={"inputs": []})
    alive_snap = client.post("/api/scenes", json={}).json()["serial"]
    (snap / alive_snap / "io").mkdir(parents=True)
    (snap / alive_snap / "io" / "inputs.json").write_text("[]", encoding="utf-8")
    (snap / alive_snap / "scene").mkdir(parents=True)
    (snap / alive_snap / "scene" / "meta.json").write_text(json.dumps({"savedAt": 2}), encoding="utf-8")

    body = client.post("/api/scenes/cleanup").json()
    assert body["ok"] is True
    reasons = {r["serial"]: r["reason"] for r in body["removed"]}
    assert reasons.get(empty) == "empty"
    assert reasons.get(incomplete) == "incomplete"
    assert reasons.get(corrupt) == "corrupt-meta"
    assert reasons.get(dead) == "no-data-no-snapshot"
    assert valid not in reasons and alive_ws not in reasons and alive_snap not in reasons

    assert not (snap / empty).exists()
    assert not (snap / incomplete).exists()
    assert not (snap / corrupt).exists()
    assert (snap / valid).exists()
    assert (snap / alive_snap).exists()

    serials = client.get("/api/serials").json()
    assert dead not in serials
    assert alive_ws in serials and alive_snap in serials


def test_cleanup_ignores_non_serial_dirs_and_traversal(client: TestClient, tmp_path: Path) -> None:
    """Cleanup only touches legal serial dirs; symlink/junction escaping the root is skipped."""
    snap = tmp_path / "snapshots"
    snap.mkdir()
    non_serial = snap / "not-a-serial"
    (non_serial / "io").mkdir(parents=True)
    (non_serial / "io" / "outputs.json").write_text("[]", encoding="utf-8")

    outside = tmp_path / "outside"
    (outside / "io").mkdir(parents=True)
    (outside / "io" / "outputs.json").write_text("[]", encoding="utf-8")
    serial = generate_serial()
    try:
        os.symlink(str(outside), str(snap / serial), target_is_directory=True)
    except OSError:
        pytest.skip("directory symlink not supported on this host")

    body = client.post("/api/scenes/cleanup").json()
    assert body["ok"] is True
    assert body["removed"] == []
    assert non_serial.exists()
    assert outside.exists()
    assert (snap / serial).is_symlink()
