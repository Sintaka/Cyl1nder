"""映射系统路由（见 devlog/project-mapping-design.md、devlog/protocol.md 映射系统）。

- GET    /api/projects/{pid}/mappings                     entries + 被引用锚点 + resolved
- PUT    /api/projects/{pid}/mappings/{name:path}         body = MappingEntry
- DELETE /api/projects/{pid}/mappings/{name:path}
- GET/PUT /api/projects/{pid}/mappings/{name:path}/value  按 kind 走 adapter / parameters.*
- GET    /api/projects/{pid}/anchors/{serial}/probe        按 pid 实证锚点存活

value 端点必须先于裸 {name:path} 声明：:path 捕获会吞掉 /value 后缀
（与 channel_routes.py 同一个坑，别重复踩）。逻辑名本身可含 "/"。
probe 同处 /api/projects/{pid}/ 之下，一并声明在 :path 路由之前（"anchors" 是字面段，
当前不会被 mappings/{name:path} 吃掉，但顺序摆对省得日后加路由时踩坑）。

main.py 由主进程挂载本 router（本文件不改 main.py）。
"""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import cook_cycle, houdini_mcp, snapshot
from .data_adapters import get_adapter
from .houdini_routes import _resolve_port
from .protocol import (
    AnchorProbeResult,
    MappingEntry,
    MappingsResponse,
    is_valid_project_serial,
)
from .state import get_state

router = APIRouter()


def _check_pid(pid: str) -> None:
    if not is_valid_project_serial(pid):
        raise HTTPException(status_code=400, detail="invalid project serial")


def _resolved_or_404(pid: str, name: str) -> dict:
    """resolve 逻辑名；名字不存在 -> 404，锚点问题 -> 交由调用方按 ok=False 返回。"""
    if get_state().mappings.get_entry(pid, name) is None:
        raise HTTPException(status_code=404, detail="mapping not found")
    return get_state().mappings.resolve(pid, name)


def _split_target(absolute: str) -> tuple[str, str]:
    """absolutePath = <node_path>/<parm_name>（照 channel_routes._resolve_data_target）。"""
    node, sep, parm = absolute.rpartition("/")
    if not sep or not node or not parm:
        raise HTTPException(status_code=400, detail="bad mapping target")
    return node, parm


def _resolve_port_for_anchor(serial: str) -> int:
    """锚点（吊牌 serial）-> 该 Houdini 实例的 MCP 端口。

    不能直接用 `_resolve_port(serial)`：吊牌**不在 registry.json 里**（那是 put_inputs
    写的，吊牌从不调），于是 rec=None、hip="" → 一路掉到 `discover_first()`，即
    「拿第一个活口当答案」。单实例时碰巧对，多开 Houdini 时会写错实例——dev 规范
    明令禁止这么猜。

    定位顺序（全部基于 pid，因为 pid 是铁律认定的唯一可靠判据）：
      1. 锚点记录的 `mcpPort`，且 `health.pid` 与锚点 pid 相符 —— 命中即用（零扫描）
      2. 按 pid 扫 8100..8115 找回该实例（实例重开换了端口）
      3. 退回 `_resolve_port`（registry.mcpPort / 失败短缓存等既有逻辑）

    **注意不要用 hip 定位**：`mcp.health` 实测不回 hip_file，`discover_by_hip`
    在这条路上恒为 None（此处曾据此写过 fallback，是死代码）���
    """
    st = get_state()
    mappings = getattr(st, "mappings", None)
    anchor: dict = {}
    if mappings is not None and serial:
        try:
            anchor = mappings.get_anchor(serial) or {}
        except Exception:  # noqa: BLE001 - 定位失败退回既有路径
            anchor = {}
    expected_pid = int(anchor.get("pid") or 0)
    recorded_port = int(anchor.get("mcpPort") or 0)
    if expected_pid:
        if recorded_port:
            h = _probe_health(recorded_port)
            if h is not None and int(h.get("pid") or 0) == expected_pid:
                return recorded_port
        found = _find_port_by_pid(expected_pid)
        if found:
            return found[0]
    elif recorded_port:
        # 没有 pid（旧吊牌构建）时只能信记录的端口——通就用，不猜别的实例
        if _probe_health(recorded_port) is not None:
            return recorded_port
    return _resolve_port(serial)


async def _port_for(resolved: dict) -> int:
    return await asyncio.to_thread(_resolve_port_for_anchor, resolved.get("anchor") or "")


def _trace(action: str, name: str, resolved: dict, value: Any) -> None:
    get_state().trace.add(
        actor="web-param",
        action=action,
        channel=name,
        target=resolved.get("absolutePath") or "",
        digest=str(value)[:80],
    )


class ValuePut(BaseModel):
    value: Any


# --- 锚点存活探测（必须先于 mappings/{name:path} 声明）-----------------------
#
# 心跳只能证明「最近 cook 过」：吊牌不 cook 时不心跳，挂一小时完全正常，所以心跳
# 超时**不等于**失联，凭它降级 UI 纯属猜测（实测活着的吊牌心跳已 2938s）。这里改成
# 实证：拿上报的 mcpPort 打 mcp.health，把 pid 与记录的 pid 对上——铁律，pid 是识别
# Houdini 实例的唯一可靠依据，端口在重开后可能属于另一个实例。


_REASON_NO_PID = "no pid recorded (old tag build): cannot verify instance identity"
_REASON_UNREACHABLE = "houdini mcp unreachable on recorded port and no port reports the expected pid"
_REASON_PID_MISMATCH = "port answered but pid belongs to a different process (instance restarted/replaced)"
_REASON_ALIVE = "alive: pid matches the recorded houdini instance"

# fxhoudinimcp 端口窗口（与 houdini_mcp.discover_first 的默认一致）
_PORT_SCAN_START = 8100
_PORT_SCAN_END = 8115


def _find_port_by_pid(expected_pid: int) -> tuple[int, dict] | None:
    """扫 8100..8115 找 `health.pid == expected_pid` 的端口 -> (port, health)。

    为什么按 pid 而不按 hip：`mcp.health` 实测只回 `{status, pid, houdini_version}`，
    **不带 hip_file**（dev 规范：安装版 health 不带 hip_file），所以 discover_by_hip
    在这条路上永远是 None。pid 既是铁律认定的唯一可靠判据，又确实在 health 里，
    所以它才是重定位的正确依据。
    找不到返回 None（= 该实例真的不在了，这正是要区分出来的结论）。
    """
    if not expected_pid:
        return None
    for port in range(_PORT_SCAN_START, _PORT_SCAN_END + 1):
        h = _probe_health(port)
        if h is not None and int(h.get("pid") or 0) == expected_pid:
            return port, h
    return None


def _probe_health(port: int) -> dict | None:
    return houdini_mcp.health(port) if port else None


@router.get("/api/projects/{pid}/anchors/{serial}/probe")
async def probe_anchor(pid: str, serial: str) -> AnchorProbeResult:
    """按记录的 pid + 端口实证锚点存活。探测失败是正常结论（alive=False），绝不抛。"""
    _check_pid(pid)
    anchor = get_state().mappings.get_anchor(serial)
    if anchor is None:
        raise HTTPException(status_code=404, detail="anchor not found")

    expected_pid = int(anchor.get("pid") or 0)
    hip = (anchor.get("hip") or "").strip()
    recorded_port = int(anchor.get("mcpPort") or 0)

    # 1) 先试记录的端口
    port = recorded_port
    h = await asyncio.to_thread(_probe_health, recorded_port)
    actual_pid = int((h or {}).get("pid") or 0)

    # 2) 不通、或 pid 与记录不符 -> 重新定位（实例可能重开到了别的端口）
    #
    # **按 pid 扫，不按 hip。** `mcp.health` 实测只回 {status, pid, houdini_version}，
    # 根本不带 hip_file（dev 规范早有记载「安装版 health 不带 hip_file」），所以
    # discover_by_hip 永远返回 None——曾据此写过 fallback，是死代码。
    # pid 才是既可靠又真的拿得到的判据：扫端口找「health.pid == 记录的 pid」那一个。
    if h is None or (expected_pid and actual_pid != expected_pid):
        found = await asyncio.to_thread(_find_port_by_pid, expected_pid) if expected_pid else None
        if found:
            port2, h2 = found
            # 按 pid 找到的必然 pid 对上，直接采用（原端口不通或本就是别的实例）
            h, port, actual_pid = h2, port2, int(h2.get("pid") or 0)

    alive = h is not None
    pid_matched = bool(expected_pid) and actual_pid == expected_pid
    if not alive:
        reason = _REASON_UNREACHABLE
        port = recorded_port
    elif not expected_pid:
        reason = _REASON_NO_PID          # 没有期望值就不是「匹配」，不许假装成功
    elif pid_matched:
        reason = _REASON_ALIVE
    else:
        reason = _REASON_PID_MISMATCH

    # verifiedAlive 只在 pid 对上时为真：探到个活口不代表还是同一个实例。
    get_state().mappings.mark_verified(serial, alive and pid_matched, port if alive else 0, actual_pid)
    return AnchorProbeResult(
        serial=serial,
        alive=alive,
        pidMatched=pid_matched,
        port=port,
        expectedPid=expected_pid,
        actualPid=actual_pid,
        hip=hip,
        reason=reason,
    )


# --- value 端点（必须先于裸 {name:path} 声明）--------------------------------


@router.get("/api/projects/{pid}/mappings/{name:path}/value")
async def get_mapping_value(pid: str, name: str) -> dict:
    _check_pid(pid)
    resolved = _resolved_or_404(pid, name)
    if not resolved["ok"]:
        return {"ok": False, "error": resolved["error"]}
    node, parm = _split_target(resolved["absolutePath"])
    if resolved["kind"] == "data":
        adapter = get_adapter(resolved.get("adapter") or "")
        if adapter is None:
            raise HTTPException(status_code=400, detail="unknown adapter")
        port = await _port_for(resolved)
        if not port:
            return {"ok": False, "error": "houdini mcp not reachable"}
        result = await asyncio.to_thread(adapter.read, port, node, parm)
        if not result.get("ok"):
            return {"ok": False, "error": str(result.get("error") or "read failed")[:200]}
        value = result.get("value")
    else:
        port = await _port_for(resolved)
        if not port:
            return {"ok": False, "error": "houdini mcp not reachable"}
        try:
            envelope = await asyncio.to_thread(
                houdini_mcp.rpc, port, "parameters.get_parameter",
                {"node_path": node, "parm_name": parm}, 4.0,
            )
        except Exception as exc:  # noqa: BLE001 - 归一到 ok=False
            return {"ok": False, "error": str(exc)[:200]}
        if not isinstance(envelope, dict) or envelope.get("status") == "error":
            return {"ok": False, "error": str(envelope)[:200]}
        data = envelope.get("data")
        # 值提取宽容（照 houdini_routes.get_channel_values）：dict 取 value，否则 data 本身
        value = data.get("value") if isinstance(data, dict) else data
    _trace("data-get", name, resolved, value)
    return {"ok": True, "value": value}


@router.get("/api/projects/{pid}/cook-cycles")
async def get_cook_cycles(pid: str) -> dict:
    """这个项目的图会不会成环（v0.1.00125）。

    web 侧在 cook / 推写回**之前**问这里，从而在 UI 上标红而不是发一串必然被拒的写。
    `cycles` 是「既被 `_input_` 读、又被 `_output_` 写」的逻辑名列表；空 = 无环。
    """
    _check_pid(pid)
    st = get_state()
    project = st.projects.get(pid)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    graph = snapshot.read_project_graph(st.data_dir, pid, project.get("hip") or "")
    cycles = cook_cycle.find_cycles(graph)
    return {"ok": True, "cycles": cycles, "message": cook_cycle.cycle_message(cycles)}


@router.put("/api/projects/{pid}/mappings/{name:path}/value")
async def put_mapping_value(pid: str, name: str, payload: ValuePut) -> dict:
    _check_pid(pid)
    # **无环 cook 是硬约束**（v0.1.00125，用户要求「在桥接映射系统解决掉，做到无环 cook，
    # 而不是让现有的 node 连接兼容」）。放在解析之前：环是图的性质，与这次写能不能解析无关。
    #
    # 只在**该名字自己成环**时拒绝，不因项目里别处有环就拒绝这次写 —— 否则一个无关的环
    # 会把整个项目的写入全锁死。
    st0 = get_state()
    proj0 = st0.projects.get(pid)
    if proj0 is not None:
        graph0 = snapshot.read_project_graph(st0.data_dir, pid, proj0.get("hip") or "")
        cycles0 = cook_cycle.find_cycles(graph0)
        if any(c.endswith(f"::{name}") for c in cycles0):
            raise HTTPException(status_code=409, detail=cook_cycle.cycle_message(cycles0))
    resolved = _resolved_or_404(pid, name)
    if not resolved["ok"]:
        return {"ok": False, "error": resolved["error"]}
    node, parm = _split_target(resolved["absolutePath"])
    if resolved["kind"] == "data":
        adapter = get_adapter(resolved.get("adapter") or "")
        if adapter is None:
            raise HTTPException(status_code=400, detail="unknown adapter")
        port = await _port_for(resolved)
        if not port:
            return {"ok": False, "error": "houdini mcp not reachable"}
        result = await asyncio.to_thread(adapter.write, port, node, parm, payload.value)
        if not result.get("ok"):
            return {"ok": False, "error": str(result.get("error") or "write failed")[:200]}
    else:
        port = await _port_for(resolved)
        if not port:
            return {"ok": False, "error": "houdini mcp not reachable"}
        try:
            envelope = await asyncio.to_thread(
                houdini_mcp.rpc, port, "parameters.set_parameter",
                {"node_path": node, "parm_name": parm, "value": payload.value}, 4.0,
            )
        except Exception as exc:  # noqa: BLE001 - 归一到 ok=False
            return {"ok": False, "error": str(exc)[:200]}
        if not isinstance(envelope, dict) or envelope.get("status") == "error":
            return {"ok": False, "error": str(envelope)[:200]}
    _trace("data-set", name, resolved, payload.value)
    return {"ok": True, "value": payload.value}


# --- entries CRUD ------------------------------------------------------------


@router.get("/api/projects/{pid}/mappings")
async def list_mappings(pid: str) -> MappingsResponse:
    """entries + resolved + **本项目相关的全部锚点**。

    `anchors` 不能只回「被 entry 引用到的」：项目的吊牌成员可能还没建任何映射条目，
    那样前端就拿不到它的 `verifiedAt`/`verifiedAlive`，刷新页面后状态只能退回「无心跳」
    ——这正是「刷新网页掉状态」的最后一块缺口。所以并入该项目**成员 serial** 对应的锚点。
    """
    _check_pid(pid)
    st = get_state()
    reg = st.mappings
    entries = reg.list_entries(pid)
    all_anchors = reg.list_anchors()
    wanted = {e.get("anchor") or "" for e in entries.values()}
    project = st.projects.get(pid) if hasattr(st.projects, "get") else None
    for m in (project or {}).get("members") or []:
        serial = (m or {}).get("serial") or ""
        if serial:
            wanted.add(serial)
    return MappingsResponse(
        projectSerial=pid,
        entries=entries,
        anchors={s: a for s, a in all_anchors.items() if s in wanted},
        resolved=reg.resolve_all(pid),
    )


@router.put("/api/projects/{pid}/mappings/{name:path}")
async def put_mapping(pid: str, name: str, entry: MappingEntry) -> dict:
    _check_pid(pid)
    reg = get_state().mappings
    try:
        stored = reg.put_entry(pid, name, entry.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "entry": stored, "resolved": reg.resolve(pid, name)}


@router.delete("/api/projects/{pid}/mappings/{name:path}")
async def delete_mapping(pid: str, name: str) -> dict:
    _check_pid(pid)
    removed = get_state().mappings.del_entry(pid, name)
    if not removed:
        raise HTTPException(status_code=404, detail="mapping not found")
    return {"ok": True, "removed": True}
