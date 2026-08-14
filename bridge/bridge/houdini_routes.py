"""REST routes for the fxhoudinimcp (Houdini MCP) integration.

Endpoints:
- GET/PUT /api/hda/{serial}/timeline        web <-> Houdini timeline sync
- PUT    /api/hda/{serial}/hou-timeline     HDA reports its timeline (push path)
- GET/PUT /api/hda/{serial}/houdini         MCP port + liveness probe
- POST   /api/hda/{serial}/houdini/cmd      command proxy (allow-listed namespaces)
- POST   /api/hda/{serial}/houdini/python   code.execute_python proxy

Mounted into the app by main.py at merge time (this file must not edit main.py).
Blocking Houdini calls go through asyncio.to_thread and only ever target module-
level houdini_mcp.* functions (no lambda closures capturing bridge state).
"""
from __future__ import annotations

import asyncio
import math
import threading
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import houdini_mcp
from .protocol import is_valid_serial
from .state import get_state
from .ws import manager

router = APIRouter()

# --- timeline cache (per serial) -------------------------------------------
# _TL[serial] = {"frame", "fps", "source" ("hou"|"web"), "ts", "mcpAt"}
_LOCK = threading.Lock()
_TL: dict[str, dict] = {}
# monotonic ts of the last set_frame per serial (>=0.1s throttle)
_LAST_SET: dict[str, float] = {}
# monotonic ts of the last registry mcpPort writeback per serial (30s throttle)
_LAST_WRITEBACK: dict[str, float] = {}

_WRITEBACK_INTERVAL = 30.0   # seconds between registry mcpPort disk writes
_SET_MIN_INTERVAL = 0.1      # seconds between set_frame calls per serial
_TIMELINE_REFRESH = 0.25     # seconds between get_frame refreshes in GET /timeline


def _check_serial(serial: str) -> None:
    if not is_valid_serial(serial):
        raise HTTPException(status_code=400, detail="invalid serial")


def _tl_default() -> dict:
    return {"frame": 0.0, "fps": 24.0, "source": "hou", "ts": 0.0, "mcpAt": 0.0}


def _resolve_port(serial: str) -> int:
    """Resolve the Houdini MCP port for a serial: registry.mcpPort, else discover
    by hip file, else first reachable port. A discovered port is written back to
    the registry (throttled to 30s so discovery never hammers the disk)."""
    st = get_state()
    rec = st.registry.get(serial)
    port = rec.mcpPort if rec else 0
    if port:
        return port
    hip = rec.hip if rec else ""
    port = houdini_mcp.discover_by_hip(hip) or 0
    if not port:
        port = houdini_mcp.discover_first() or 0
    if not port:
        return 0
    now = time.monotonic()
    with _LOCK:
        throttled = now - _LAST_WRITEBACK.get(serial, 0.0) < _WRITEBACK_INTERVAL
        if not throttled:
            _LAST_WRITEBACK[serial] = now
    if not throttled:
        st.registry.set_houdini_mcp(serial, port)
    return port


@router.get("/api/hda/{serial}/timeline")
async def get_timeline(serial: str) -> dict:
    _check_serial(serial)
    # port resolution scans up to 16 ports -> run off the event loop
    port = await asyncio.to_thread(_resolve_port, serial)
    now = time.time()
    with _LOCK:
        tl = _TL.get(serial)
        mcp_at = tl["mcpAt"] if tl else 0.0
    if port and (now - mcp_at > _TIMELINE_REFRESH):
        try:
            data = await asyncio.to_thread(houdini_mcp.get_frame, port)
        except Exception as exc:  # failure only logs; cache keeps its last value
            get_state().logs.error("houdini", f"get_frame failed: {exc}", serial)
        else:
            with _LOCK:
                tl = _TL.get(serial)
                if tl is None:
                    tl = _tl_default()
                    _TL[serial] = tl
                frame = data.get("frame")
                fps = data.get("fps")
                if isinstance(frame, (int, float)) and math.isfinite(frame):
                    tl["frame"] = float(frame)
                if isinstance(fps, (int, float)) and math.isfinite(fps):
                    tl["fps"] = float(fps)
                tl["source"] = "hou"
                tl["ts"] = now
                tl["mcpAt"] = now
    with _LOCK:
        tl = dict(_TL.get(serial, _tl_default()))
    return {
        "serial": serial,
        "frame": tl["frame"],
        "fps": tl["fps"],
        "source": tl["source"],
        "ts": tl["ts"],
        "mcpPort": port,
    }


class TimelinePut(BaseModel):
    frame: float


@router.put("/api/hda/{serial}/timeline")
async def put_timeline(serial: str, payload: TimelinePut) -> dict:
    _check_serial(serial)
    frame = payload.frame
    if not math.isfinite(frame):
        raise HTTPException(status_code=422, detail="frame must be a finite number")
    port = await asyncio.to_thread(_resolve_port, serial)
    if not port:
        return {"ok": False, "error": "houdini mcp not reachable", "mcp_port": 0}
    with _LOCK:
        throttled = time.monotonic() - _LAST_SET.get(serial, 0.0) < _SET_MIN_INTERVAL
        if not throttled:
            _LAST_SET[serial] = time.monotonic()
    if throttled:
        return {"ok": True, "frame": float(frame), "mcp_port": port, "throttled": True}
    try:
        await asyncio.to_thread(houdini_mcp.set_frame, port, frame)
    except Exception as exc:
        get_state().logs.error("houdini", f"set_frame failed: {exc}", serial)
        return {"ok": False, "error": str(exc), "mcp_port": port}
    ts = time.time()
    with _LOCK:
        tl = _TL.get(serial)
        if tl is None:
            tl = _tl_default()
            _TL[serial] = tl
        tl["frame"] = float(frame)
        tl["source"] = "web"
        tl["ts"] = ts
    return {"ok": True, "frame": float(frame), "mcp_port": port}


class HouTimelinePut(BaseModel):
    frame: float
    fps: float | None = None


@router.put("/api/hda/{serial}/hou-timeline")
async def put_hou_timeline(serial: str, payload: HouTimelinePut) -> dict:
    _check_serial(serial)
    if not math.isfinite(payload.frame):
        raise HTTPException(status_code=422, detail="frame must be a finite number")
    if payload.fps is not None and not math.isfinite(payload.fps):
        raise HTTPException(status_code=422, detail="fps must be a finite number")
    ts = time.time()
    with _LOCK:
        tl = _TL.get(serial)
        if tl is None:
            tl = _tl_default()
            _TL[serial] = tl
        tl["frame"] = float(payload.frame)
        if payload.fps is not None:
            tl["fps"] = float(payload.fps)
        tl["source"] = "hou"
        tl["ts"] = ts
        out_frame = tl["frame"]
        out_fps = tl["fps"]
    await manager.broadcast(
        serial,
        {"type": "timeline", "frame": out_frame, "fps": out_fps, "source": "hou", "ts": ts},
    )
    return {"ok": True}


@router.get("/api/hda/{serial}/houdini")
async def get_houdini(serial: str) -> dict:
    _check_serial(serial)
    rec = get_state().registry.get(serial)
    port = rec.mcpPort if rec else 0
    h = None
    if port:
        h = await asyncio.to_thread(houdini_mcp.health, port)
    return {"serial": serial, "mcpPort": port, "alive": h is not None, "health": h}


class HoudiniPut(BaseModel):
    mcp_port: int


@router.put("/api/hda/{serial}/houdini")
async def put_houdini(serial: str, payload: HoudiniPut) -> dict:
    _check_serial(serial)
    port = payload.mcp_port
    if not 1 <= port <= 65535:
        raise HTTPException(status_code=422, detail="mcp_port must be in 1..65535")
    st = get_state()
    st.registry.set_houdini_mcp(serial, port)
    rec = st.registry.get(serial)
    h = await asyncio.to_thread(houdini_mcp.health, port)
    alive = h is not None
    matched = False
    if h and rec and h.get("hip_file") and rec.hip:
        matched = houdini_mcp.normalize_hip(h.get("hip_file", "")) == houdini_mcp.normalize_hip(rec.hip)
    return {"ok": True, "serial": serial, "mcpPort": port, "alive": alive, "matched": matched}


class CmdBody(BaseModel):
    command: str
    params: dict | None = None


@router.post("/api/hda/{serial}/houdini/cmd")
async def houdini_cmd(serial: str, payload: CmdBody) -> dict:
    _check_serial(serial)
    if not houdini_mcp.is_command_allowed(payload.command):
        raise HTTPException(status_code=403, detail="command not allowed")
    port = await asyncio.to_thread(_resolve_port, serial)
    if not port:
        return {"ok": False, "error": "houdini mcp not reachable"}
    try:
        result = await asyncio.to_thread(houdini_mcp.rpc, port, payload.command, payload.params)
    except Exception as exc:
        get_state().logs.error("houdini", f"cmd {payload.command} failed: {exc}", serial)
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "command": payload.command, "result": result}


class PythonBody(BaseModel):
    code: str
    return_expression: str | None = None


@router.post("/api/hda/{serial}/houdini/python")
async def houdini_python(serial: str, payload: PythonBody) -> dict:
    _check_serial(serial)
    if not payload.code or not payload.code.strip():
        raise HTTPException(status_code=422, detail="code must be non-empty")
    port = await asyncio.to_thread(_resolve_port, serial)
    if not port:
        return {"ok": False, "error": "houdini mcp not reachable"}
    try:
        result = await asyncio.to_thread(
            houdini_mcp.execute_python, port, payload.code, payload.return_expression
        )
    except Exception as exc:
        get_state().logs.error("houdini", f"execute_python failed: {exc}", serial)
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "result": result}
