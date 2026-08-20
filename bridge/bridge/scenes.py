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
                "lastActivity": rec.lastActivity,
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


def _invalid_snapshot_dir(d: Path) -> str | None:
    """Return the invalidity reason for a snapshot dir, or None if it is valid."""
    if not any(d.iterdir()):
        return "empty"
    has_inputs = (d / "io" / "inputs.json").exists()
    has_meta = (d / "scene" / "meta.json").exists()
    if not has_inputs and not has_meta:
        return "incomplete"
    if has_meta and _read_json(d / "scene" / "meta.json") is None:
        return "corrupt-meta"
    return None


def cleanup_scenes() -> dict[str, Any]:
    """Remove invalid scene dirs (empty / incomplete / corrupt meta) + dead registry serials.
    Safety: only legal serial dirs directly under the snapshot root are considered, and
    each target must resolve back inside the root (symlink / junction traversal is skipped).
    """
    st = get_state()
    removed: list[dict[str, Any]] = []
    base = _snapshot_base()
    if base.is_dir():
        base = base.resolve()
        for d in sorted(base.iterdir()):
            if not d.is_dir() or not is_valid_serial(d.name):
                continue
            target = d.resolve()
            try:
                target.relative_to(base)
            except ValueError:
                continue
            reason = _invalid_snapshot_dir(target)
            if reason:
                shutil.rmtree(target)
                removed.append({"serial": d.name, "reason": reason})
    kept: set[str] = set()
    if base.is_dir():
        for d in base.iterdir():
            if d.is_dir() and is_valid_serial(d.name):
                kept.add(d.name)
    for rec in st.registry.list():
        ws = st.workspaces.get(rec.serial)
        has_data = ws is not None and (ws.input_rev > 0 or ws.output_rev() > 0)
        if not has_data and rec.serial not in kept:
            st.registry.remove(rec.serial)
            removed.append({"serial": rec.serial, "reason": "no-data-no-snapshot"})
    st.logs.info("scenes", f"cleanup removed {len(removed)} invalid scene(s)", "")
    return {"ok": True, "removed": removed}


def create_scene(label: str | None = None) -> str:
    st = get_state()
    serial = generate_serial()
    label = (label or "").strip() or DEFAULT_LABEL
    st.registry.register(serial, hip="", nodePath="", label=label)
    st.workspaces.get_or_create(serial)
    st.logs.info("scenes", f"scene created: {serial} ({label})", serial)
    return serial


def delete_scene(serial: str) -> dict[str, Any]:
    """删掉一条注册表登记（v0.1.00142）。

    为什么需要它：`cleanup_scenes` 只删「**没有数据**且没有快照」的条目
    （`input_rev == 0 and output_rev() == 0`）。而 e2e 把 CANONICAL_INPUTS 推进过的号
    带着 `inputRev=38`，于是**永远**清不掉 —— 实测桥里攒了 37 个这种孤儿登记
    （`nodePath=/obj/test/Cyl1nder1`）。它们每一条都让 `hello` 多做一份活，
    全量 e2e 的握手因此越来越慢（round10/round12 的负载敏感失败就是这么攒出来的）。

    只删登记，**不动 workspace 与快照** —— 与 `cleanup_scenes` 同一做法（那里也只调
    `registry.remove`）。删掉登记的节点下次 cook 会自己重新注册，所以这个操作是可恢复的。
    """
    if not is_valid_serial(serial):
        raise ValueError(f"invalid serial: {serial!r}")
    removed = get_state().registry.remove(serial)
    get_state().logs.info("scenes", f"scene registration removed: {serial}", serial)
    return {"ok": True, "removed": removed}


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
        docking=docking if isinstance(docking, dict) else None,
    )
    # 旧存档带图时**原样把文件搬过去**（v0.1.00122）。
    #
    # 不能再走 `write_snapshot(graph=…)`：它自 v0.1.00122 起 accept-but-ignore，
    # 传进去等于**静默丢掉这张图** —— 打开一个旧场景文件夹却把它的图弄没了，
    # 是比"不支持"更坏的结果。
    # 直接落到 `scene/node-graph.json`：`read_snapshot` 仍会读它（graph 只读不写），
    # 于是 `GET /api/projects/{id}/graph` 的单成员迁移读还能把它**提升成项目图**——
    # 那才是这张图该去的地方。
    if isinstance(graph, dict):
        try:
            dest = snapshot_root("", serial) / "scene"
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "node-graph.json").write_text(
                json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            st.logs.info("scenes", f"legacy member graph preserved for migration: {serial}", serial)
        except OSError as exc:
            # 图没搬成不该让"打开场景"整体失败：inputs/docking 已经就位，
            # 用户至少还能看到几何；这里只如实记一条。
            st.logs.error("scenes", f"legacy graph copy failed for {serial}: {exc}", serial)
    st.logs.info("scenes", f"scene opened: {serial} <- {folder}", serial)
    return {"serial": serial}
