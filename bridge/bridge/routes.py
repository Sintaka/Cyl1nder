"""REST routes: health / serials / per-serial inputs / outputs / logs / scenes / usdz."""
from __future__ import annotations

import asyncio
import json

import msgpack

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, Response

from pydantic import BaseModel, Field, ValidationError

from .protocol import (
    InputsPut,
    OutputsPut,
    SyncEnabledPut,
    STREAM_HOLD_DEFAULT,
    SYNC_FPS_DEFAULT,
    SYNC_FPS_MAX,
    SYNC_FPS_MIN,
    STREAM_HOLD_MAX,
    VERSION,
    WEB_UI_URL,
    is_valid_serial,
)
from .project_routes import bind_serial_to_hip, is_transient_hip
from .scenes import cleanup_scenes, create_scene, list_scenes, open_scene, save_scene
from .snapshot import maybe_snapshot, read_snapshot, write_snapshot
from .usdz import build_usdz_bytes
from .ui_layout import UiLayoutStore, list_layouts, load_layout, save_layout
from .state import get_state
from .ws import manager

router = APIRouter()


@router.get("/")
async def root(serial: str | None = None) -> object:
    """Landing helper: with ?serial= redirect to the web UI, else describe the service."""
    if serial:
        return RedirectResponse(f"{WEB_UI_URL}/?serial={serial}", status_code=307)
    return {"service": "cyl1nder-bridge", "ui": WEB_UI_URL, "hint": "open the web UI: " + WEB_UI_URL + "/?serial=<hda serial>"}


def _check_serial(serial: str) -> None:
    if not is_valid_serial(serial):
        raise HTTPException(status_code=400, detail="invalid serial")


@router.get("/api/health")
async def health() -> dict:
    st = get_state()
    return {"status": "ok", "version": VERSION, "serials": len(st.registry.serials())}


@router.get("/api/serials")
async def list_serials() -> list[str]:
    return get_state().registry.serials()


@router.get("/api/hda/{serial}/status")
async def status(serial: str) -> dict:
    _check_serial(serial)
    st = get_state()
    rec = st.registry.get(serial)
    return {
        "serial": serial,
        "registry": rec.to_dict() if rec is not None else None,
        "workspace": st.workspaces.status(serial),
        "sync": {"fps": st.get_sync_fps(serial), "sync_enabled": st.get_sync_enabled(serial)},
    }


async def _reestablish_project_if_missing(st, serial: str, hip: str) -> None:
    """HDA 推送 inputs 时，若这个 serial 曾属于的项目已被删除，立即按 hip 重建一个空项目
    并把它重新收进成员（用户需求 #3：cook 时发现项目没了，快速对齐 hip 名重建一个空场景）。

    热路径成本：稳态下（项目健在、serial 已是成员）只付一次 find_by_hip（线性扫描项目
    列表比对 hip，项目数量级通常个位数到几十）+ 命中项目自身 members 列表的一次线性
    扫描（O(k)，k = 该项目成员数）——不扫「全部项目的全部成员」，不落盘，不调用
    ensure_for_hip。只有 find_by_hip 未命中（项目确实被删了，或这个 hip 从未建过项目）
    或该项目里还没有这个成员时，才升级到 bind_serial_to_hip：那条路径本身会做一次
    全项目扫描（另存为检测）+ ensure_for_hip 的查/建 + add_member 落盘，但只在这个
    稀有分支（删除后第一次 cook / 新成员首次加入）上付出这个代价。

    is_transient_hip 复用 project_routes 现成判定（崩溃恢复 `*_recovered.hip` /
    `untitled.hip` 等）：绝不为这些临时文件建项目，否则每次崩溃重启都多出一个用户
    没选过的项目——这也顺带盖住了 hip 为空的情况（is_transient_hip("") 恒为 True）。

    best-effort：任何异常只记日志后吞掉，绝不让项目重建失败打断几何推送本身
    （对齐 channel_routes._sync_mapping_entry 「注册绝不能因映射失败而失败」的先例）。
    """
    if not hip or is_transient_hip(hip):
        return
    try:
        project = st.projects.find_by_hip(hip)
        if project is not None and any(
            (m or {}).get("serial") == serial for m in project.get("members") or []
        ):
            return  # 项目健在且已是成员：稳态热路径到此为止，不做任何写入
        await bind_serial_to_hip(serial, hip)
    except Exception as exc:  # noqa: BLE001 - 项目重建失败不能打断几何推送
        st.logs.error("routes", f"project reestablish failed for hip={hip!r}: {exc}", serial)


@router.put("/api/hda/{serial}/inputs")
async def put_inputs(serial: str, payload: InputsPut) -> dict:
    _check_serial(serial)
    st = get_state()
    rec = st.registry.register(
        serial, hip=payload.hip, nodePath=payload.nodePath, label=payload.label
    )
    rev = st.workspaces.get_or_create(serial).set_inputs(payload.inputs, payload.frame)
    st.registry.mark_activity(serial)
    await _reestablish_project_if_missing(st, serial, payload.hip)
    st.logs.info("routes", f"inputs pushed ({len(payload.inputs)}), rev={rev}", serial)
    await manager.broadcast(
        serial,
        {"type": "inputs", "inputs": [i.model_dump() for i in payload.inputs], "rev": rev, "frame": payload.frame},
    )
    await maybe_snapshot(serial)
    # trace（P3）：输入推送埋点（零行为影响）
    st.trace.add(
        actor="hda-cook",
        action="inputs-push",
        channel=serial,
        target="inputs",
        digest=f"{len(payload.inputs)} inputs, {sum(i.pointCount for i in payload.inputs)} pts, {sum(i.primCount for i in payload.inputs)} prims",
    )
    return {"ok": True, "serial": serial, "rev": rev}


@router.get("/api/hda/{serial}/outputs")
async def get_outputs(serial: str, request: Request, since: int = Query(0, ge=0)) -> Response:
    """Return edited outputs since a rev.

    Defaults to JSON (HDA path unchanged); when the client sends
    Accept: application/msgpack, the same payload is returned as msgpack bytes
    (bridge<->web msgpack negotiation, see protocol.py docstring).
    """
    _check_serial(serial)
    st = get_state()
    ws = st.workspaces.get_or_create(serial)
    outputs = ws.get_outputs_since(since)
    payload = {"outputs": [o.model_dump() for o in outputs], "rev": ws.output_rev()}
    if "msgpack" in request.headers.get("accept", "").lower():
        return Response(content=msgpack.packb(payload, use_bin_type=False), media_type="application/msgpack")
    return Response(content=json.dumps(payload, ensure_ascii=False), media_type="application/json")


@router.put("/api/hda/{serial}/outputs")
async def put_outputs(serial: str, request: Request) -> dict:
    """Accept edited output buffers.

    Defaults to JSON (unchanged); when the client sends
    Content-Type: application/msgpack, the body is msgpack-decoded first
    (bridge<->web msgpack negotiation; HDA keeps pushing JSON).
    """
    _check_serial(serial)
    payload = await _parse_outputs_body(request)
    st = get_state()
    ws = st.workspaces.get_or_create(serial)
    rev, accepted = ws.put_outputs(payload.outputs)
    if accepted:
        st.registry.mark_activity(serial)
        # log only real content changes - no-op echo pushes would flood the log ring
        st.logs.info("routes", f"outputs pushed ({len(payload.outputs)}, accepted {len(accepted)}), rev={rev}", serial)
        # trace（P3）：编辑结果埋点（零行为影响）
        st.trace.add(
            actor="web-gizmo",
            action="outputs-edit",
            channel=serial,
            target=f"out[{','.join(str(o.index) for o in accepted)}]",
            digest=f"rev={rev}, {len(accepted)} outputs",
        )
        if st.get_sync_enabled(serial):
            st.stage_broadcast(serial, accepted, rev)
            st.notify_stream(serial)
    await maybe_snapshot(serial)
    return {"ok": True, "serial": serial, "rev": rev}


async def _parse_outputs_body(request: Request) -> OutputsPut:
    """Parse the PUT /outputs body: msgpack for application/msgpack, else JSON.

    The JSON path keeps the previous semantics (400 on a malformed body, 422 on
    a schema mismatch); msgpack frames are decoded with default raw=False so
    strings stay str, then validated through the same OutputsPut model.
    """
    raw = await request.body()
    content_type = request.headers.get("content-type", "").lower()
    if "msgpack" in content_type:
        try:
            data = msgpack.unpackb(raw)
        except Exception as exc:  # noqa: BLE001 - any malformed msgpack frame -> 400
            raise HTTPException(status_code=400, detail="invalid msgpack body") from exc
    else:
        try:
            data = json.loads(raw)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid JSON body") from exc
    try:
        return OutputsPut.model_validate(data)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc


class SyncFpsPut(BaseModel):
    """PUT /api/hda/{serial}/sync body: per-serial Sync Max FPS (1..60, default 30)."""
    fps: int = Field(SYNC_FPS_DEFAULT, ge=SYNC_FPS_MIN, le=SYNC_FPS_MAX)


@router.put("/api/hda/{serial}/sync")
async def put_sync_fps(serial: str, payload: SyncFpsPut) -> dict:
    """Set the per-serial bridge-side receive+forward cap (in-memory; web persists
    it in Preference.json). Returns the stored (clamped) value."""
    _check_serial(serial)
    fps = get_state().set_sync_fps(serial, payload.fps)
    return {"ok": True, "serial": serial, "fps": fps}


@router.put("/api/hda/{serial}/sync-enabled")
async def put_sync_enabled(serial: str, payload: SyncEnabledPut) -> dict:
    """Set the per-serial manual two-way sync gate (default OFF). Web is the source of truth."""
    _check_serial(serial)
    enabled = get_state().set_sync_enabled(serial, payload.enabled)
    get_state().logs.info("routes", f"sync-enabled set to {enabled}", serial)
    return {"ok": True, "serial": serial, "sync_enabled": enabled}


@router.get("/api/hda/{serial}/pending")
async def pending(serial: str, since: int = Query(0, ge=0)) -> dict:
    """Lightweight dirty check used by the HDA adaptive sync poller.

    Doubles as a heartbeat: the poller calls this regularly while Houdini is
    alive (fast ~33ms active / 500ms idle), so registry.lastSeen stays fresh.
    When Houdini crashes, the poller stops and lastSeen goes stale -> the web
    UI flags the HDA as offline. force is a one-shot kick marker (POST /kick):
    it is returned once as True, then consumed.
    """
    _check_serial(serial)
    st = get_state()
    st.registry.touch(serial)
    rev = st.workspaces.get_or_create(serial).output_rev()
    return {
        "pending": rev > since,
        "rev": rev,
        "reset": since > rev,
        "force": st.take_kick(serial),
        "sync_enabled": st.get_sync_enabled(serial),
    }


def _ndjson(payload: dict) -> Response:
    """Single-line NDJSON response body for the /stream long-poll."""
    return Response(content=json.dumps(payload) + "\n", media_type="application/x-ndjson")


@router.get("/api/hda/{serial}/stream")
async def stream(
    serial: str,
    since: int = Query(0, ge=0),
    hold: float = Query(STREAM_HOLD_DEFAULT, ge=0, le=STREAM_HOLD_MAX),
) -> Response:
    """NDJSON long-poll - HDA primary sync channel (see sync-heartbeat-redesign.md §3.1).

    Heartbeat: request arrival touches the registry (liveness, same auto-register
    semantics as /pending). Returns immediately when the rev moved (outputs), when
    the bridge restarted and rev fell back (reset), or when a one-shot kick is
    armed; otherwise holds up to hold seconds and wakes on put_outputs accepted
    or kick armed, else reports timeout (HDA reconnects right away as keep-alive).
    """
    _check_serial(serial)
    st = get_state()
    st.registry.touch(serial)
    fps = st.get_sync_fps(serial)
    sync_enabled = st.get_sync_enabled(serial)
    event = st.subscribe(serial)
    try:
        rev = st.workspaces.get_or_create(serial).output_rev()
        # immediate hits (priority: reset > outputs > kick)
        if since > rev:
            return _ndjson({"type": "reset", "rev": rev, "fps": fps, "sync_enabled": sync_enabled})
        if rev > since:
            return _ndjson({"type": "outputs", "rev": rev, "fps": fps, "sync_enabled": sync_enabled})
        if st.take_kick(serial):
            return _ndjson({"type": "kick", "force": True, "rev": rev, "fps": fps, "sync_enabled": sync_enabled})
        # hold: wake on put_outputs accepted / kick armed, else timeout
        try:
            await asyncio.wait_for(event.wait(), timeout=hold)
        except asyncio.TimeoutError:
            return _ndjson({"type": "timeout", "rev": rev, "fps": fps, "sync_enabled": sync_enabled})
        rev = st.workspaces.get_or_create(serial).output_rev()
        if since > rev:
            return _ndjson({"type": "reset", "rev": rev, "fps": fps, "sync_enabled": sync_enabled})
        if rev > since:
            return _ndjson({"type": "outputs", "rev": rev, "fps": fps, "sync_enabled": sync_enabled})
        if st.take_kick(serial):
            return _ndjson({"type": "kick", "force": True, "rev": rev, "fps": fps, "sync_enabled": sync_enabled})
        # spurious wake (e.g. another poller consumed the kick): report timeout
        return _ndjson({"type": "timeout", "rev": rev, "fps": fps, "sync_enabled": sync_enabled})
    finally:
        st.unsubscribe(serial, event)


@router.post("/api/hda/{serial}/kick")
async def kick(serial: str) -> dict:
    """One-shot force marker: Cyl1nder 侧更新后踹 HDA 一脚.

    Sets a kick marker consumed by the HDA's next /pending poll (force=True):
    the HDA recooks even when rev did not advance, re-pushing inputs so a
    failed first push (bridge still starting) clears last_error -> status ok.
    touch() makes the web watchdog see the HDA online immediately.
    """
    _check_serial(serial)
    st = get_state()
    if st.registry.get(serial) is None:
        raise HTTPException(status_code=404, detail="serial not registered")
    if not st.try_arm_kick(serial):
        # rate-limited (kick storm guard): quiet no-op, still 200 so web treats it as success
        return {"ok": True, "serial": serial, "throttled": True}
    st.registry.touch(serial)
    st.notify_stream(serial)
    st.logs.info("routes", f"kick armed for {serial}", serial)
    return {"ok": True, "serial": serial}


@router.get("/api/hda/{serial}/logs")
async def serial_logs(
    serial: str,
    level: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
) -> dict:
    _check_serial(serial)
    return {"logs": get_state().logs.query(level=level, limit=limit, serial=serial)}


@router.get("/api/hda/{serial}/snapshot")
async def get_snapshot(serial: str) -> dict:
    """Unified path system: read the disk snapshot (cyl://<serial>/snapshot)."""
    _check_serial(serial)
    st = get_state()
    rec = st.registry.get(serial)
    hip = rec.hip if rec else ""
    snap = read_snapshot(hip, serial)
    return {"serial": serial, "snapshot": snap}


@router.get("/api/ui/layout")
async def get_ui_layout() -> dict:
    """Global dockview layout persisted by the web UI (cross-browser, debug-friendly)."""
    st = get_state()
    return {"layout": st.ui_layout.read()}


@router.put("/api/ui/layout")
async def put_ui_layout(payload: dict) -> dict:
    """Persist the web UI dockview layout (single writer = web; bridge stores the file)."""
    st = get_state()
    st.ui_layout.write(payload.get("layout"))
    return {"ok": True}


@router.put("/api/hda/{serial}/snapshot")
async def put_snapshot(serial: str, payload: dict) -> dict:
    """Web persists the node graph / node params / docking layout (scene part)."""
    _check_serial(serial)
    st = get_state()
    rec = st.registry.get(serial)
    hip = rec.hip if rec else ""
    write_snapshot(
        serial,
        hip,
        graph=payload.get("graph"),
        parm=payload.get("parm"),
        docking=payload.get("docking"),
        preference=payload.get("preference"),
    )
    return {"ok": True, "serial": serial}


@router.get("/api/ui/layouts")
async def ui_layouts() -> dict:
    """List named desktop layouts (Documents/Cyl1nder/Layouts)."""
    return {"layouts": list_layouts()}


@router.put("/api/ui/layouts/{name}")
async def ui_layout_save(name: str, payload: dict) -> dict:
    """Save (or overwrite) a named layout."""
    ok = save_layout(name, payload.get("layout"))
    return {"ok": ok, "name": name}


@router.get("/api/ui/layouts/{name}")
async def ui_layout_load(name: str) -> dict:
    """Load a named layout."""
    data = load_layout(name)
    return {"name": name, "layout": data}


@router.get("/api/logs")
async def global_logs(
    level: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
) -> dict:
    return {"logs": get_state().logs.query(level=level, limit=limit)}


# --- scenes (bridge-side scene management + usdz export) ---


@router.get("/api/scenes")
async def scenes_list() -> dict:
    """Active = registry serials (+ workspace revs); history = snapshot dirs on disk."""
    return list_scenes()


@router.post("/api/scenes")
async def scenes_create(payload: dict | None = None) -> dict:
    """Create a new scene: fresh serial + registry entry + empty workspace."""
    payload = payload or {}
    return {"serial": create_scene(payload.get("label"))}


@router.post("/api/scenes/cleanup")
async def scenes_cleanup() -> dict:
    """Remove invalid scene dirs + dead registry serials; returns removed {serial, reason}."""
    return cleanup_scenes()


@router.post("/api/hda/{serial}/scene/save")
async def scene_save(serial: str, payload: dict | None = None) -> dict:
    """Save the whole snapshot folder (io/scene/docking + <serial>.usdz) into target_dir."""
    _check_serial(serial)
    payload = payload or {}
    target_dir = payload.get("target_dir")
    if not target_dir:
        raise HTTPException(status_code=400, detail="target_dir required")
    return save_scene(serial, str(target_dir), overwrite=bool(payload.get("overwrite")))


@router.post("/api/scenes/open")
async def scenes_open(payload: dict | None = None) -> dict:
    """Open a saved scene folder: folder name must be a valid serial; loads io + graph + docking."""
    payload = payload or {}
    folder_path = payload.get("folder_path")
    if not folder_path:
        raise HTTPException(status_code=400, detail="folder_path required")
    try:
        return open_scene(str(folder_path))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/hda/{serial}/usdz")
async def get_usdz(serial: str) -> Response:
    """Stream the serial's io snapshot as a .usdz archive (zip + root.usda).

    Web uses FS Access to save the bytes into the scene folder; the artifact is
    the same as the one scene/save drops next to the copied snapshot folder.
    """
    _check_serial(serial)
    return Response(
        content=build_usdz_bytes(serial),
        media_type="model/vnd.usdz+zip",
        headers={"Content-Disposition": f'attachment; filename="{serial}.usdz"'},
    )
