"""REST routes for the fxhoudinimcp (Houdini MCP) integration.

Endpoints:
- GET/PUT /api/hda/{serial}/timeline        web <-> Houdini timeline sync
- PUT    /api/hda/{serial}/hou-timeline     HDA reports its timeline (push path)
- GET/PUT /api/hda/{serial}/channel-values  batch param channel value sync (P5a)
- GET/PUT /api/hda/{serial}/houdini         MCP port + liveness probe
- POST   /api/hda/{serial}/houdini/cmd      command proxy (allow-listed namespaces)
- POST   /api/hda/{serial}/houdini/python   code.execute_python proxy

Timeline sync is rate-limited to the per-serial sync max fps in both directions:
- Houdini -> web is a resident per-serial asyncio poller: GET /timeline marks a
  consumer and ensures the poller runs; the poller ticks at _get_interval and pushes
  frame/fps changes over WS. When no GET has happened for _TL_IDLE seconds (no
  consumer) the poller stops and clears its registration.
- web -> Houdini (PUT /timeline) is latest-wins throttled at _get_set_interval:
  frames inside the window only update the pending value and a single call_later
  flush sends the newest pending frame at the window edge.

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
# monotonic ts of the last set_frame initiation per serial (web->Houdini throttle)
_LAST_SET: dict[str, float] = {}
# monotonic ts of the last registry mcpPort writeback per serial (30s throttle)
_LAST_WRITEBACK: dict[str, float] = {}
# monotonic ts of the last GET /timeline per serial (poller consumer heartbeat)
_LAST_CONSUME: dict[str, float] = {}
# resident poller tasks per serial (created by ensure_poller, cleared on idle/exit)
_POLLERS: dict[str, asyncio.Task] = {}
# in-flight get_frame task per serial (poller single-flight)
_IN_FLIGHT: dict[str, asyncio.Task] = {}
# consecutive get_frame failure count per serial (poller backoff)
_FAIL_STREAK: dict[str, int] = {}
# monotonic ts until which the poller rests after a failure streak
_FAIL_REST: dict[str, float] = {}
# monotonic ts of the last failed port resolution (2s short cache)
_PORT_FAIL_CACHE: dict[str, float] = {}
# latest pending frame per serial (PUT /timeline latest-wins)
_PENDING_SET: dict[str, float] = {}
# set_frame in-flight flag per serial (PUT /timeline single-flight)
_SET_FLIGHT: dict[str, bool] = {}
# call_later flush handles per serial (PUT /timeline latest-wins flush)
_SET_TIMERS: dict[str, asyncio.TimerHandle] = {}

# P5a channel-values: GET 0.25s 整响应缓存 + PUT latest-wins 节流（per serial）
_CHANNEL_VALUES_CACHE: dict[str, tuple[float, dict]] = {}  # (time.time, values)
_CV_PENDING: dict[str, dict] = {}    # PUT 最新 pending values（整 dict 替换 = latest-wins）
_CV_LAST: dict[str, float] = {}      # PUT 上次 flush 的 monotonic ts
_CV_FLIGHT: dict[str, bool] = {}     # PUT single-flight
_CV_TIMERS: dict[str, asyncio.TimerHandle] = {}  # PUT flush handles

_WRITEBACK_INTERVAL = 30.0     # seconds between registry mcpPort disk writes
_TL_IDLE = 10.0                # seconds without a GET before the poller stops
_POLL_FAIL_MAX = 3             # consecutive get_frame failures before resting
_POLL_FAIL_REST = 2.0          # seconds to rest after a failure streak
_PORT_FAIL_CACHE_TTL = 2.0     # seconds to skip full discovery after a failed resolve
_GET_MIN_INTERVAL = 0.066      # 66ms floor -> ~15Hz max get poll regardless of fps
_SET_MIN_INTERVAL = 0.033      # 33ms floor for set_frame regardless of fps
_CV_CACHE_TTL = 0.25           # channel-values GET 整响应缓存 TTL（秒）


def _get_interval(serial: str) -> float:
    """Get-poll interval in seconds: max(66ms, 1000/fps). fps=30 -> 66ms, fps=1 -> 1s."""
    return max(_GET_MIN_INTERVAL, 1.0 / get_state().get_sync_fps(serial))


def _get_set_interval(serial: str) -> float:
    """Set throttle interval in seconds: max(33ms, 1000/fps)."""
    return max(_SET_MIN_INTERVAL, 1.0 / get_state().get_sync_fps(serial))


def _check_serial(serial: str) -> None:
    if not is_valid_serial(serial):
        raise HTTPException(status_code=400, detail="invalid serial")


def _tl_default() -> dict:
    return {"frame": 0.0, "fps": 24.0, "source": "hou", "ts": 0.0, "mcpAt": 0.0}


def _resolve_port(serial: str) -> int:
    """Resolve the Houdini MCP port for a serial: registry.mcpPort, else discover
    by hip file, else first reachable port. A discovered port is written back to
    the registry (throttled to 30s so discovery never hammers the disk). A failed
    discovery is short-cached for _PORT_FAIL_CACHE_TTL seconds so repeated requests
    while Houdini is down don't rescan all 16 ports."""
    st = get_state()
    now = time.monotonic()
    rec = st.registry.get(serial)
    with _LOCK:
        fail_at = _PORT_FAIL_CACHE.get(serial, 0.0)
        if fail_at and now - fail_at < _PORT_FAIL_CACHE_TTL:
            return rec.mcpPort if rec else 0
    port = rec.mcpPort if rec else 0
    if port:
        with _LOCK:
            _PORT_FAIL_CACHE.pop(serial, None)
        return port
    hip = rec.hip if rec else ""
    port = houdini_mcp.discover_by_hip(hip) or 0
    if not port:
        port = houdini_mcp.discover_first() or 0
    if not port:
        with _LOCK:
            _PORT_FAIL_CACHE[serial] = now
        return 0
    with _LOCK:
        _PORT_FAIL_CACHE.pop(serial, None)
        throttled = now - _LAST_WRITEBACK.get(serial, 0.0) < _WRITEBACK_INTERVAL
        if not throttled:
            _LAST_WRITEBACK[serial] = now
    if not throttled:
        st.registry.set_houdini_mcp(serial, port)
    return port


# --- resident poller (Houdini -> web timeline push) -------------------------


def _poller_done(serial: str, task: asyncio.Task) -> None:
    with _LOCK:
        if _POLLERS.get(serial) is task:
            _POLLERS.pop(serial, None)


def _inflight_done(serial: str, task: asyncio.Task) -> None:
    with _LOCK:
        if _IN_FLIGHT.get(serial) is task:
            _IN_FLIGHT.pop(serial, None)


def ensure_poller(serial: str) -> None:
    """Idempotently start the per-serial resident timeline poller (event-loop task)."""
    with _LOCK:
        task = _POLLERS.get(serial)
        if task is not None and not task.done():
            return
        _POLLERS.pop(serial, None)
    loop = asyncio.get_running_loop()
    task = loop.create_task(_poller_loop(serial))
    with _LOCK:
        _POLLERS[serial] = task
    task.add_done_callback(lambda t, s=serial: _poller_done(s, t))


async def _poller_loop(serial: str) -> None:
    """Tick every _get_interval: single-flight get_frame; idle-stop after _TL_IDLE."""
    while True:
        interval = _get_interval(serial)
        try:
            now = time.monotonic()
            with _LOCK:
                last_consume = _LAST_CONSUME.get(serial, 0.0)
            if now - last_consume > _TL_IDLE:
                return  # idle-stop; the done callback clears _POLLERS
            with _LOCK:
                rest_until = _FAIL_REST.get(serial, 0.0)
            if now < rest_until:
                await asyncio.sleep(interval)
                continue
            port = await asyncio.to_thread(_resolve_port, serial)
            if not port:
                await asyncio.sleep(interval)  # no Houdini yet: retry next tick
                continue
            with _LOCK:
                inflight = _IN_FLIGHT.get(serial)
            if inflight is not None and not inflight.done():
                await asyncio.sleep(interval)  # previous round still running: skip
                continue
            task = asyncio.create_task(_get_frame_once(serial, port))
            with _LOCK:
                _IN_FLIGHT[serial] = task
            task.add_done_callback(lambda t, s=serial: _inflight_done(s, t))
        except Exception as exc:  # noqa: BLE001 - a tick error must not kill the poller
            get_state().logs.error("houdini", f"poller tick failed: {exc}", serial)
        await asyncio.sleep(interval)


async def _get_frame_once(serial: str, port: int) -> None:
    try:
        data = await asyncio.to_thread(houdini_mcp.get_frame, port)
    except Exception as exc:
        with _LOCK:
            streak = _FAIL_STREAK.get(serial, 0) + 1
            _FAIL_STREAK[serial] = streak
            if streak >= _POLL_FAIL_MAX:
                _FAIL_STREAK[serial] = 0
                _FAIL_REST[serial] = time.monotonic() + _POLL_FAIL_REST
        get_state().logs.error("houdini", f"get_frame failed: {exc}", serial)
        return
    with _LOCK:
        _FAIL_STREAK[serial] = 0
        _FAIL_REST.pop(serial, None)
    try:
        await _apply_frame(serial, data)
    except Exception as exc:  # noqa: BLE001 - broadcast errors must not kill the poller
        get_state().logs.error("houdini", f"apply frame failed: {exc}", serial)


async def _apply_frame(serial: str, data: dict) -> None:
    """Merge a get_frame result into _TL and broadcast only when frame/fps changed."""
    frame = data.get("frame")
    fps = data.get("fps")
    now = time.time()
    changed = False
    with _LOCK:
        tl = _TL.get(serial)
        if tl is None:
            tl = _tl_default()
            _TL[serial] = tl
        if isinstance(frame, (int, float)) and math.isfinite(frame):
            if abs(float(frame) - tl["frame"]) > 0.001:
                tl["frame"] = float(frame)
                changed = True
        if isinstance(fps, (int, float)) and math.isfinite(fps):
            if abs(float(fps) - tl["fps"]) > 0.001:
                tl["fps"] = float(fps)
                changed = True
        tl["mcpAt"] = now
        if changed:
            tl["source"] = "hou"
            tl["ts"] = now
            out_frame = tl["frame"]
            out_fps = tl["fps"]
            out_ts = tl["ts"]
    if changed:
        await manager.broadcast(
            serial,
            {"type": "timeline", "frame": out_frame, "fps": out_fps, "source": "hou", "ts": out_ts},
        )


@router.get("/api/hda/{serial}/timeline")
async def get_timeline(serial: str) -> dict:
    _check_serial(serial)
    port = await asyncio.to_thread(_resolve_port, serial)
    now = time.time()
    with _LOCK:
        had_poller = serial in _POLLERS
        _LAST_CONSUME[serial] = time.monotonic()
    ensure_poller(serial)
    with _LOCK:
        tl = dict(_TL.get(serial, _tl_default()))
    interval = _get_interval(serial)
    # first-screen fast path: no resident poller yet and the cache is stale -> one
    # inline refresh so the very first response already carries real data (cache
    # refresh is otherwise owned by the poller, not by GET).
    if (not had_poller) and port and (now - tl["ts"] > 2 * interval):
        try:
            data = await asyncio.to_thread(houdini_mcp.get_frame, port)
        except Exception as exc:  # failure only logs; cache keeps its last value
            get_state().logs.error("houdini", f"get_frame failed: {exc}", serial)
        else:
            await _apply_frame(serial, data)
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
    interval = _get_set_interval(serial)
    now = time.monotonic()
    with _LOCK:
        _PENDING_SET[serial] = frame
        last = _LAST_SET.get(serial, 0.0)
        in_flight = _SET_FLIGHT.get(serial, False)
    if in_flight:
        # a set is running; the sender re-arms a flush for this pending on completion
        return {"ok": True, "frame": float(frame), "mcp_port": port, "throttled": True}
    if now - last < interval:
        _arm_set_flush(serial, port, interval - (now - last))
        return {"ok": True, "frame": float(frame), "mcp_port": port, "throttled": True}
    err = await _send_pending(serial, port)
    if err is not None:
        return {"ok": False, "error": err, "mcp_port": port}
    return {"ok": True, "frame": float(frame), "mcp_port": port}


def _arm_set_flush(serial: str, port: int, delay: float) -> None:
    """Arm a single call_later flush of the latest pending frame (latest-wins)."""
    loop = asyncio.get_running_loop()
    with _LOCK:
        existing = _SET_TIMERS.get(serial)
        if existing is not None and not existing.cancelled():
            return  # flush already armed; latest pending is picked up at fire time
        handle = loop.call_later(delay, lambda: loop.create_task(_flush_pending(serial, port)))
        _SET_TIMERS[serial] = handle


async def _flush_pending(serial: str, port: int) -> None:
    with _LOCK:
        _SET_TIMERS.pop(serial, None)
        in_flight = _SET_FLIGHT.get(serial, False)
        pending = _PENDING_SET.get(serial)
    if in_flight or pending is None:
        return
    await _send_pending(serial, port)


async def _send_pending(serial: str, port: int) -> str | None:
    """Send the latest pending frame to Houdini (single-flight). Returns an error
    message on failure, else None. Re-arms a flush if newer frames arrived mid-send."""
    with _LOCK:
        pending = _PENDING_SET.pop(serial, None)
        if pending is None:
            return None
        _SET_FLIGHT[serial] = True
        _LAST_SET[serial] = time.monotonic()
    err: str | None = None
    try:
        await asyncio.to_thread(houdini_mcp.set_frame, port, pending)
    except Exception as exc:
        err = str(exc)
        get_state().logs.error("houdini", f"set_frame failed: {exc}", serial)
    else:
        ts = time.time()
        with _LOCK:
            tl = _TL.get(serial)
            if tl is None:
                tl = _tl_default()
                _TL[serial] = tl
            tl["frame"] = float(pending)
            tl["source"] = "web"
            tl["ts"] = ts
            out_frame = tl["frame"]
            out_fps = tl["fps"]
        try:
            await manager.broadcast(
                serial,
                {"type": "timeline", "frame": out_frame, "fps": out_fps, "source": "web", "ts": ts},
            )
        except Exception as exc:  # noqa: BLE001 - broadcast is best-effort
            get_state().logs.error("houdini", f"broadcast failed: {exc}", serial)
    finally:
        with _LOCK:
            _SET_FLIGHT[serial] = False
            more_pending = serial in _PENDING_SET
    if more_pending:
        _arm_set_flush(serial, port, _get_set_interval(serial))
    return err


# --- channel-values（P5a：批量 param 通道值同步）-------------------------------


@router.get("/api/hda/{serial}/channel-values")
async def get_channel_values(serial: str) -> dict:
    """P5a：批量读该 serial 的 param 通道当前值（0.25s 整响应缓存）。

    通道来源 = 关联注册大全 kind=param 且 serial 匹配；absolutePath 按 rsplit("/", 1)
    拆 node_path/parm_name；单通道读失败或信封 error 跳过（不进 values）。
    """
    _check_serial(serial)
    with _LOCK:
        cached = _CHANNEL_VALUES_CACHE.get(serial)
    if cached is not None and time.time() - cached[0] < _CV_CACHE_TTL:
        return {"ok": True, "values": cached[1]}
    channels = [
        r for r in get_state().channels.list()
        if r.get("kind") == "param" and r.get("serial") == serial
    ]
    values: dict = {}
    if channels:
        port = await asyncio.to_thread(_resolve_port, serial)
        if not port:
            return {"ok": False, "error": "houdini mcp not reachable"}
        for ref in channels:
            absolute = ref.get("absolutePath") or ""
            parts = absolute.rsplit("/", 1)
            if len(parts) != 2 or not parts[0] or not parts[1]:
                continue  # 畸形 absolutePath 跳过
            node, parm = parts
            if (ref.get("type") or "") == "vec3":
                # vec3 是元组参数，`parm("t")` 恒为 None，parameters.get_parameter
                # 对它必错（Did you mean tz/ty/tx），发出去就是纯浪费的一次往返 ——
                # 直接用一次 code.execute_python 取整个元组，跳过那条注定失败的调用。
                vec = await asyncio.to_thread(houdini_mcp.read_vec3_tuple, port, node, parm)
                if vec is None:
                    continue  # 读不到/形状不对 -> 跳过（绝不插 null 或凑数的 vec3）
                values[absolute] = vec
                continue
            try:
                result = await asyncio.to_thread(
                    houdini_mcp.rpc, port, "parameters.get_parameter",
                    {"node_path": node, "parm_name": parm}, 4.0,
                )
            except Exception:
                continue  # 读失败通道跳过
            if not isinstance(result, dict) or result.get("status") == "error":
                continue  # 信封 error 通道跳过
            data = result.get("data")
            # 值提取宽容：data 为 dict 取 value，否则 data 本身
            values[absolute] = data.get("value") if isinstance(data, dict) else data
    with _LOCK:
        _CHANNEL_VALUES_CACHE[serial] = (time.time(), values)
    return {"ok": True, "values": values}


class ChannelValuesPut(BaseModel):
    values: dict


@router.put("/api/hda/{serial}/channel-values")
async def put_channel_values(serial: str, payload: ChannelValuesPut) -> dict:
    """P5a：批量写 param 通道值（latest-wins 节流 + single-flight，照 PUT /timeline）。

    成功后不回显广播（web 发起，防回环）；每项 trace param-set（失败项 digest=error:...）。
    同步路径老实回报结果：{"ok": <全部成功>, "failed": {path: error, ...}}，全成功
    时不带 failed 键；被节流的响应仍是 {"ok": True, "throttled": True}，那只是
    "已接受、尚未尝试写入"，不代表任何通道真的写成功了。
    """
    _check_serial(serial)
    values = payload.values or {}
    port = await asyncio.to_thread(_resolve_port, serial)
    if not port:
        return {"ok": False, "error": "houdini mcp not reachable"}
    if not values:
        return {"ok": True}
    interval = _get_set_interval(serial)
    now = time.monotonic()
    with _LOCK:
        _CV_PENDING[serial] = values  # 整 dict 替换 = latest-wins
        last = _CV_LAST.get(serial, 0.0)
        in_flight = _CV_FLIGHT.get(serial, False)
    if in_flight:
        # 发送中：完成后自动补发最新 pending。
        # ok:true 在这里只代表"已接受、尚未尝试写入"，不是"已写入"——写入
        # 还没发生，自然没有逐通道结果，调用方不能把这条响应画成成功的绿点。
        return {"ok": True, "throttled": True}
    if now - last < interval:
        _arm_cv_flush(serial, port, interval - (now - last))
        # 同上：节流命中同样是"已接受、尚未尝试写入"，语义与上面的 in_flight 分支一致。
        return {"ok": True, "throttled": True}
    failed = await _send_cv_pending(serial, port)
    if failed:
        return {"ok": False, "failed": failed}
    return {"ok": True}


def _arm_cv_flush(serial: str, port: int, delay: float) -> None:
    """Arm a single call_later flush of the latest pending values (latest-wins)."""
    loop = asyncio.get_running_loop()
    with _LOCK:
        existing = _CV_TIMERS.get(serial)
        if existing is not None and not existing.cancelled():
            return  # flush already armed; latest pending is picked up at fire time
        handle = loop.call_later(delay, lambda: loop.create_task(_flush_cv_pending(serial, port)))
        _CV_TIMERS[serial] = handle


async def _flush_cv_pending(serial: str, port: int) -> None:
    with _LOCK:
        _CV_TIMERS.pop(serial, None)
        in_flight = _CV_FLIGHT.get(serial, False)
        pending = _CV_PENDING.get(serial)
    if in_flight or pending is None:
        return
    # 延迟 flush 路径没有 HTTP 响应可挂——返回的 failures 只靠 log/trace 存档
    # （_send_cv_pending 内部已记），这里故意不接收也不再二次处理。
    await _send_cv_pending(serial, port)


async def _send_cv_pending(serial: str, port: int) -> dict[str, str]:
    """Send the latest pending values to Houdini (single-flight, no echo broadcast).

    Returns absolutePath -> truncated error string for every channel that failed
    to write (malformed absolutePath counts as a failure too); empty dict means
    every channel in this batch succeeded.
    """
    with _LOCK:
        pending = _CV_PENDING.pop(serial, None)
        if pending is None:
            return {}
        _CV_FLIGHT[serial] = True
        _CV_LAST[serial] = time.monotonic()
    failed: dict[str, str] = {}
    for absolute, value in pending.items():
        parts = absolute.rsplit("/", 1)
        if len(parts) != 2 or not parts[0] or not parts[1]:
            get_state().logs.error("houdini", f"bad channel target {absolute!r}", serial)
            get_state().trace.add(
                actor="web-param", action="param-set", channel=serial,
                target=absolute, digest="error:bad target",
            )
            failed[absolute] = "bad target"
            continue
        node, parm = parts
        err: str | None = None
        try:
            result = await asyncio.to_thread(
                houdini_mcp.rpc, port, "parameters.set_parameter",
                {"node_path": node, "parm_name": parm, "value": value}, 4.0,
            )
        except Exception as exc:
            err = str(exc)
        else:
            if not isinstance(result, dict) or result.get("status") == "error":
                err = str(result.get("error") if isinstance(result, dict) else result)
        if err is not None:
            get_state().logs.error("houdini", f"set_parameter {absolute} failed: {err}", serial)
            digest = f"error:{err}"[:80]
            failed[absolute] = err[:200]
        else:
            digest = str(value)[:80]
        get_state().trace.add(
            actor="web-param", action="param-set", channel=serial,
            target=absolute, digest=digest,
        )
    with _LOCK:
        _CV_FLIGHT[serial] = False
        more_pending = serial in _CV_PENDING
    if more_pending:
        _arm_cv_flush(serial, port, _get_set_interval(serial))
    return failed


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


def _trace_houdini_cmd(serial: str, command: str, params: dict | None) -> None:
    """P3 埋点：白名单通过后记录 runtime-python 命令（零行为影响）。

    parameters.set_parameter -> param-set（digest=value 截 80）；set_expression ->
    expr-set（digest=表达式截 80）；其余 action=command 名截 40、digest=params 截 80。
    target = node_path/parm_name（取不到 parm_name 则 node_path）。
    """
    params = params or {}
    node = params.get("node_path", "")
    parm = params.get("parm_name", "")
    if command == "parameters.set_parameter":
        action, digest = "param-set", f"value={str(params.get('value'))[:80]}"
    elif command == "parameters.set_expression":
        action, digest = "expr-set", str(params.get("expression", ""))[:80]
    else:
        action, digest = command[:40], str(params)[:80]
    get_state().trace.add(
        actor="runtime-python",
        action=action,
        channel=serial,
        target=f"{node}/{parm}" if node and parm else node,
        digest=digest,
    )


@router.post("/api/hda/{serial}/houdini/cmd")
async def houdini_cmd(serial: str, payload: CmdBody) -> dict:
    _check_serial(serial)
    if not houdini_mcp.is_command_allowed(payload.command):
        raise HTTPException(status_code=403, detail="command not allowed")
    # trace（P3）：白名单通过后埋点
    _trace_houdini_cmd(serial, payload.command, payload.params)
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
    # trace（P3）：python 执行埋点（零行为影响）
    get_state().trace.add(
        actor="runtime-python",
        action="python-exec",
        channel=serial,
        target="",
        digest=payload.code.replace("\n", " ")[:80],
    )
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
