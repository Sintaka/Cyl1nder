"""Unified path system + file snapshot (P0).

Rules (devlog/snapshot-design.md):
- Logical path: cyl://<serial>/<domain>, physical paths fully derivable from
  registry[serial].hip (the ONLY context variable) - never parse .hda/.hip.
- Snapshot root: <hip-dir>/Cyl1nder/<serial>/ ; fallback: bridge/data/snapshots/<serial>/
- Files: <serial>.meta.json / .graph.json / .inputs.json / .outputs.json
- Single writer (bridge only); atomic tmp+replace; content-compare before write (R5).
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

DEFAULT_ROOT = Path(__file__).resolve().parent.parent / "data" / "snapshots"


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


def _part_path(root: Path, serial: str, part: str) -> Path:
    return root / f"{serial}.{part}.json"


def read_snapshot(hip: str, serial: str) -> dict[str, Any] | None:
    """Read all existing snapshot parts; returns None when none exist."""
    root = snapshot_root(hip, serial)
    if not root.exists():
        return None
    out: dict[str, Any] = {}
    for part in ("meta", "graph", "inputs", "outputs"):
        p = _part_path(root, serial, part)
        if p.exists():
            try:
                out[part] = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
    return out if out else None


def write_snapshot(
    serial: str,
    hip: str,
    *,
    meta: dict[str, Any] | None = None,
    graph: dict[str, Any] | None = None,
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
) -> bool:
    """Atomically write snapshot parts. Returns True if anything changed on disk."""
    root = snapshot_root(hip, serial)
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        return False
    wrote = False
    parts: dict[str, Any] = {"meta": meta, "graph": graph, "inputs": inputs, "outputs": outputs}
    for part, payload in parts.items():
        if payload is None:
            continue
        target = _part_path(root, serial, part)
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
        "schemaVersion": 1,
        "serial": serial,
        "hip": hip,
        "nodePath": node_path,
        "version": version,
        "inputRev": input_rev,
        "outputRev": output_rev,
        "savedAt": time.time(),
        "snapshotId": f"{serial}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}",
    }