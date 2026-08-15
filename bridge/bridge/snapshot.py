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
    Preference.json         web preferences ({"schemaVersion":1,"sync_max_fps":30,"update_mode":"auto"})
- Single writer (bridge only); atomic tmp+replace; content-compare before write (R5).
"""
from __future__ import annotations

import asyncio
import orjson
import os
import time
from pathlib import Path
from typing import Any

from .protocol import VERSION, InputPayload, OutputBuffer

DEFAULT_ROOT = Path(__file__).resolve().parent.parent / "data" / "snapshots"

# throttled workspace -> disk mirror (moved from routes.py; >=5s cadence, R5 content-compare)
_SNAP_LAST: dict[str, float] = {}
_SNAP_THROTTLE = 5.0

# fixed file names per part (no serial prefix - the serial is the folder)
_PARTS: dict[str, tuple[str, str]] = {
    "meta": ("scene", "meta.json"),
    "graph": ("scene", "node-graph.json"),
    "parm": ("scene", "node-parm.json"),
    "inputs": ("io", "inputs.json"),
    "outputs": ("io", "outputs.json"),
    "docking": (".", "docking-layout.json"),
    "preference": (".", "Preference.json"),
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


def _read_root(root: Path, serial: str) -> dict[str, Any]:
    """Read every snapshot part present under one root (schema v2 fixed names, v1 legacy fallback)."""
    out: dict[str, Any] = {}
    if not root.exists():
        return out
    for part in _PARTS:
        p = _part_path(root, part)
        if p.exists():
            try:
                out[part] = orjson.loads(p.read_text(encoding="utf-8"))
                continue
            except (OSError, ValueError):
                pass
        # v1 legacy: <serial>.<part>.json in the root folder
        legacy = root / f"{serial}.{part}.json"
        if legacy.exists():
            try:
                out[part] = orjson.loads(legacy.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
    return out


def read_snapshot(hip: str, serial: str) -> dict[str, Any] | None:
    """Dual-root merge read: the hip-derived root wins, DEFAULT_ROOT/serial fills missing parts.

    This reconciles the split that happens when the registry's hip is temporarily
    empty at write time (snapshot lands in the fallback root) but is later set
    (snapshot lands next to the .hip): reading only one root used to miss the other.
    Both roots keep the schema-v2 fixed names + v1 legacy filename fallback.
    """
    primary = snapshot_root(hip, serial)
    merged = _read_root(primary, serial)
    fallback = DEFAULT_ROOT / serial
    if fallback != primary:
        for part, value in _read_root(fallback, serial).items():
            merged.setdefault(part, value)
    return merged if merged else None


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
    preference: dict[str, Any] | None = None,
) -> bool:
    """Atomically write snapshot parts under io/ scene/ + docking-layout.json + Preference.json.
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
        "preference": preference,
    }
    for part, payload in parts.items():
        if payload is None:
            continue
        target = _part_path(root, part)
        # content compare (R5): skip write when unchanged
        try:
            if target.exists() and orjson.loads(target.read_text(encoding="utf-8")) == payload:
                continue
        except (OSError, ValueError):
            pass
        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(orjson.dumps(payload, option=orjson.OPT_INDENT_2).decode("utf-8"), encoding="utf-8")
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


async def maybe_snapshot(serial: str) -> None:
    """Persist inputs/outputs snapshot on data change, throttled to avoid cook storms.

    Shared by the REST put paths (routes.py) and the WS edit path (ws.py): the WS
    branch is the web's primary edit channel, so it MUST snapshot too, otherwise
    io/outputs.json stays empty and a bridge restart loses every edit.
    """
    from .state import get_state  # local import: avoids a module-level cycle

    st = get_state()
    rec = st.registry.get(serial)
    if rec is None:
        return
    now = time.time()
    if now - _SNAP_LAST.get(serial, 0.0) < _SNAP_THROTTLE:
        return
    _SNAP_LAST[serial] = now
    ws = st.workspaces.get_or_create(serial)
    # disk I/O off the event loop: blocks would delay WS broadcast / stream wake
    await asyncio.to_thread(
        write_snapshot,
        serial,
        rec.hip,
        meta=build_meta(serial, rec.hip, rec.nodePath, VERSION, ws.input_rev, ws.output_rev()),
        inputs=[i.model_dump() for i in ws.inputs],
        outputs=[o.model_dump() for o in ws.all_outputs()],
    )


def restore_workspace(serial: str, hip: str) -> bool:
    """Restore inputs/outputs into a workspace that is completely empty.

    Only ever touches a workspace with no inputs AND no outputs, so a live
    workspace is never overwritten. Reads the merged disk snapshot and validates
    each entry (bad entries are skipped + logged, never raise). Returns True when
    any data was restored.
    """
    from .state import get_state  # local import: avoids a module-level cycle

    st = get_state()
    existing = st.workspaces.get(serial)
    if existing is not None and (existing.inputs or existing.all_outputs()):
        return False
    snap = read_snapshot(hip, serial)
    if snap is None:
        return False

    valid_inputs: list[InputPayload] = []
    raw_inputs = snap.get("inputs")
    if isinstance(raw_inputs, list):
        for item in raw_inputs:
            try:
                valid_inputs.append(InputPayload.model_validate(item))
            except Exception as exc:  # noqa: BLE001 - one bad entry must not kill the restore
                st.logs.error("snapshot", f"skip invalid input snapshot entry: {exc}", serial)

    valid_outputs: list[OutputBuffer] = []
    raw_outputs = snap.get("outputs")
    if isinstance(raw_outputs, list):
        for item in raw_outputs:
            try:
                valid_outputs.append(OutputBuffer.model_validate(item))
            except Exception as exc:  # noqa: BLE001 - one bad entry must not kill the restore
                st.logs.error("snapshot", f"skip invalid output snapshot entry: {exc}", serial)

    if not valid_inputs and not valid_outputs:
        return False
    ws = st.workspaces.get_or_create(serial)
    if valid_inputs:
        ws.set_inputs(valid_inputs)
    if valid_outputs:
        ws.put_outputs(valid_outputs)
    st.logs.info(
        "snapshot",
        f"workspace restored from disk snapshot (inputs={len(valid_inputs)} outputs={len(valid_outputs)})",
        serial,
    )
    return True


def restore_all_workspaces() -> int:
    """Restore every registry serial whose workspace is empty (startup scenario B).

    Returns the number of serials that were actually restored.
    """
    from .state import get_state  # local import: avoids a module-level cycle

    st = get_state()
    restored = 0
    for rec in st.registry.list():
        if restore_workspace(rec.serial, rec.hip):
            restored += 1
    return restored


def flush_workspace(serial: str) -> bool:
    """Synchronously force-write the current workspace inputs/outputs + meta to disk.

    Empty workspaces are skipped. Returns True when anything was written.
    """
    from .state import get_state  # local import: avoids a module-level cycle

    st = get_state()
    rec = st.registry.get(serial)
    if rec is None:
        return False
    ws = st.workspaces.get(serial)
    if ws is None:
        return False
    if not ws.inputs and not ws.all_outputs():
        return False
    return write_snapshot(
        serial,
        rec.hip,
        meta=build_meta(serial, rec.hip, rec.nodePath, VERSION, ws.input_rev, ws.output_rev()),
        inputs=[i.model_dump() for i in ws.inputs],
        outputs=[o.model_dump() for o in ws.all_outputs()],
    )


def flush_all_workspaces() -> None:
    """Flush every registry serial's workspace to disk (shutdown catch-up)."""
    from .state import get_state  # local import: avoids a module-level cycle

    st = get_state()
    for rec in st.registry.list():
        flush_workspace(rec.serial)


# --- 项目图（P2b，见 devlog/tag-hda-plan.md P2b）-------------------------------
# 项目无单一 hip 上下文，项目图不放在 hip 旁：data_dir/projects/<project_id>/graph.json。
# 原子写模式照 write_snapshot（tmp+replace + 内容对比）。


def project_graph_path(data_dir, project_id: str) -> Path:
    """data_dir/projects/<project_id>/graph.json"""
    return data_dir / "projects" / project_id / "graph.json"


def read_project_graph(data_dir, project_id: str) -> dict | None:
    """读项目图；文件缺失/损坏（OSError/ValueError）→ None。"""
    p = project_graph_path(data_dir, project_id)
    try:
        data = orjson.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def write_project_graph(data_dir, project_id: str, graph: dict) -> None:
    """原子写（tmp+replace）+ 内容对比（与现文件相同则跳过）；mkdir parents。"""
    target = project_graph_path(data_dir, project_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        if target.exists() and orjson.loads(target.read_text(encoding="utf-8")) == graph:
            return
    except (OSError, ValueError):
        pass
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(orjson.dumps(graph, option=orjson.OPT_INDENT_2).decode("utf-8"), encoding="utf-8")
    tmp.replace(target)
