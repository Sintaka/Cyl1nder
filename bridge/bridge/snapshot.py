"""Unified path system + file snapshot (schema v2).

Rules (devlog/snapshot-design.md + scene-snapshot-research.md):
- Logical path: cyl://<serial>/<domain>, physical paths fully derivable from
  registry[serial].hip (the ONLY context variable) - never parse .hda/.hip.
- Snapshot root: <hip-dir>/Cyl1nder/<serial>/ ; fallback: bridge/data/snapshots/<serial>/
- Fixed file names (NO serial prefix) under per-domain folders:
    io/inputs.json          geometry input cache
    io/outputs.json         geometry output cache
    scene/meta.json         identity + rev metadata
    scene/node-graph.json   node network (logic: nodes/connections/viewport)
    scene/node-parm.json    per-node parameters (absolute path keyed)
    docking-layout.json     dockview desktop layout
- Single writer (bridge only); atomic tmp+replace; content-compare before write (R5).
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

DEFAULT_ROOT = Path(__file__).resolve().parent.parent / "data" / "snapshots"

# fixed file names per part (no serial prefix - the serial is the folder)
_PARTS: dict[str, tuple[str, str]] = {
    "meta": ("scene", "meta.json"),
    "graph": ("scene", "node-graph.json"),
    "parm": ("scene", "node-parm.json"),
    "inputs": ("io", "inputs.json"),
    "outputs": ("io", "outputs.json"),
    "docking": (".", "docking-layout.json"),
}


def snapshot_root(hip: str, serial: str) -> Path:
    """Derive the snapshot directory for a serial from its hip file."""
    env = os.environ.get("CYL1NDER_SNAPSHOT_ROOT")
    if env:
        return Path(env) / serial
    if hip:
        hip_dir = Path(hip).parent
        if hip_dir.is_absolute():
            return hip_dir / "Cyl1nder" / serial
    return DEFAULT_ROOT / serial


def _part_path(root: Path, part: str) -> Path:
    folder, name = _PARTS[part]
    return (root / folder / name) if folder != "." else (root / name)


def read_snapshot(hip: str, serial: str) -> dict[str, Any] | None:
    """Read all existing snapshot parts (schema v2 fixed names, fallback to v1 legacy)."""
    root = snapshot_root(hip, serial)
    if not root.exists():
        return None
    out: dict[str, Any] = {}
    for part in _PARTS:
        p = _part_path(root, part)
        if p.exists():
            try:
                out[part] = json.loads(p.read_text(encoding="utf-8"))
                continue
            except (OSError, ValueError):
                pass
        # v1 legacy: <serial>.<part>.json in the root folder
        legacy = root / f"{serial}.{part}.json"
        if legacy.exists():
            try:
                out[part] = json.loads(legacy.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
    return out if out else None


def write_snapshot(
    serial: str,
    hip: str,
    *,
    meta: dict[str, Any] | None = None,
    graph: dict[str, Any] | None = None,
    parm: dict[str, Any] | None = None,
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    docking: dict[str, Any] | None = None,
) -> bool:
    """Atomically write snapshot parts under io/ scene/ + docking-layout.json.
    Returns True if anything changed on disk."""
    root = snapshot_root(hip, serial)
    try:
        root.mkdir(parents=True, exist_ok=True)
        (root / "io").mkdir(exist_ok=True)
        (root / "scene").mkdir(exist_ok=True)
    except OSError:
        return False
    wrote = False
    parts: dict[str, Any] = {
        "meta": meta,
        "graph": graph,
        "parm": parm,
        "inputs": inputs,
        "outputs": outputs,
        "docking": docking,
    }
    for part, payload in parts.items():
        if payload is None:
            continue
        target = _part_path(root, part)
        # content compare (R5): skip write when unchanged
        try:
            if target.exists() and json.loads(target.read_text(encoding="utf-8")) == payload:
                continue
        except (OSError, ValueError):
            pass
        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(target)
        wrote = True
    return wrote


def build_meta(serial: str, hip: str, node_path: str, version: str, input_rev: int, output_rev: int) -> dict[str, Any]:
    return {
        "schemaVersion": 2,
        "serial": serial,
        "hip": hip,
        "nodePath": node_path,
        "version": version,
        "inputRev": input_rev,
        "outputRev": output_rev,
        "savedAt": time.time(),
        "snapshotId": f"{serial}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}",
    }