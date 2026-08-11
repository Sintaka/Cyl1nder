"""Scene management: list/create scenes, save a serial snapshot folder + usdz, open an existing folder.

Save = copy the whole snapshot folder (io/ + scene/ + docking-layout.json) to
<target_dir>/<serial>, plus <serial>.usdz (freshly generated from the io snapshot).
The snapshot directory layout is unchanged; usdz is an extra artifact of saving.
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any

from .protocol import VERSION, generate_serial, is_valid_serial
from .snapshot import DEFAULT_ROOT, build_meta, snapshot_root, write_snapshot
from .state import get_state
from .usdz import write_usdz

DEFAULT_LABEL = "Scene"


def _snapshot_base() -> Path:
    """Same resolution as snapshot_root(hip="") - env override, else the bridge default root."""
    env = os.environ.get("CYL1NDER_SNAPSHOT_ROOT")
    return Path(env) if env else DEFAULT_ROOT


def _read_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def list_scenes() -> dict[str, Any]:
    st = get_state()
    active: list[dict[str, Any]] = []
    for rec in st.registry.list():
        ws = st.workspaces.get(rec.serial)
        active.append(
            {
                "serial": rec.serial,
                "label": rec.label,
                "nodePath": rec.nodePath,
                "lastSeen": rec.lastSeen,
                "inputRev": ws.input_rev if ws else 0,
                "outputRev": ws.output_rev() if ws else 0,
            }
        )
    active.sort(key=lambda e: e["lastSeen"], reverse=True)

    history: list[dict[str, Any]] = []
    base = _snapshot_base()
    if base.is_dir():
        for d in sorted(base.iterdir(), key=lambda p: p.stat().st_mtime if p.is_dir() else 0.0, reverse=True):
            if not d.is_dir() or not is_valid_serial(d.name):
                continue
            meta = _read_json(d / "scene" / "meta.json") or {}
            saved_at = meta.get("savedAt") or d.stat().st_mtime
            entry: dict[str, Any] = {"serial": d.name, "savedAt": saved_at}
            if meta.get("label"):
                entry["label"] = meta["label"]
            history.append(entry)
    return {"active": active, "history": history}


def create_scene(label: str | None = None) -> str:
    st = get_state()
    serial = generate_serial()
    label = (label or "").strip() or DEFAULT_LABEL
    st.registry.register(serial, hip="", nodePath="", label=label)
    st.workspaces.get_or_create(serial)
    st.logs.info("scenes", f"scene created: {serial} ({label})", serial)
    return serial


def save_scene(serial: str, target_dir: str, overwrite: bool = False) -> dict[str, Any]:
    if not is_valid_serial(serial):
        raise ValueError(f"invalid serial: {serial!r}")
    st = get_state()
    rec = st.registry.get(serial)
    hip = rec.hip if rec is not None else ""

    # refresh the io cache + meta at save time (requirement: io snapshot cached on save)
    ws = st.workspaces.get_or_create(serial)
    write_snapshot(
        serial,
        hip,
        meta=build_meta(serial, hip, rec.nodePath if rec else "", VERSION, ws.input_rev, ws.output_rev()),
        inputs=[i.model_dump() for i in ws.inputs],
        outputs=[o.model_dump() for o in ws.all_outputs()],
    )

    source = snapshot_root(hip, serial)
    target = Path(target_dir) / serial
    if target.exists() and not overwrite:
        return {"ok": False, "exists": True}
    if overwrite and target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(source, target, dirs_exist_ok=True)
    write_usdz(serial, target / f"{serial}.usdz", hip=hip)
    st.logs.info("scenes", f"scene saved: {serial} -> {target}", serial)
    return {"ok": True, "path": str(target)}


def open_scene(folder_path: str) -> dict[str, Any]:
    folder = Path(folder_path)
    serial = folder.name
    if not is_valid_serial(serial):
        raise ValueError(f"folder name is not a valid serial: {serial!r}")
    st = get_state()
    meta = _read_json(folder / "scene" / "meta.json") or {}
    label = meta.get("label") or DEFAULT_LABEL
    node_path = meta.get("nodePath") or ""
    st.registry.register(serial, hip="", nodePath=node_path, label=label)

    inputs = None
    raw_inputs = _read_json(folder / "io" / "inputs.json")
    if isinstance(raw_inputs, list):
        from .protocol import InputPayload
        inputs = [InputPayload.model_validate(i) for i in raw_inputs]
        st.workspaces.get_or_create(serial).set_inputs(inputs)
    graph = _read_json(folder / "scene" / "node-graph.json")
    docking = _read_json(folder / "docking-layout.json")
    write_snapshot(
        serial,
        "",
        inputs=[i.model_dump() for i in inputs] if inputs is not None else None,
        graph=graph if isinstance(graph, dict) else None,
        docking=docking if isinstance(docking, dict) else None,
    )
    st.logs.info("scenes", f"scene opened: {serial} <- {folder}", serial)
    return {"serial": serial}
