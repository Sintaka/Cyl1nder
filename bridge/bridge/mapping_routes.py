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
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import cook_cycle, cook_txn, houdini_mcp, snapshot
from .data_adapters import get_adapter
from .houdini_routes import _resolve_port
from .protocol import (
    AnchorProbeResult,
    MappingEntry,
    MappingsResponse,
    is_valid_project_serial,
    is_valid_serial,
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
        found = _find_port_by_pid_cached(expected_pid)
        if found:
            return found[0]
    elif recorded_port:
        # 没有 pid（旧吊牌构建）时只能信记录的端口——通就用，不猜别的实例
        if _probe_health(recorded_port) is not None:
            return recorded_port
    return _fallback_port_warned(serial, expected_pid)


_PID_MISMATCH_WARNED: set[tuple[str, int, int]] = set()
"""已警告过的 (serial, 期望 pid, 落到的 pid)，避免每次读都刷同一条。"""


def _fallback_port_warned(serial: str, expected_pid: int) -> int:
    """退回 `_resolve_port`，但**把 pid 不符说出来**（v0.1.00136）。

    这条路径存在一个真实的张力：本函数的立身理由（见上方 docstring）正是
    「不要用 `discover_first()` 拿第一个活口当答案」，可它的第 3 步退回 `_resolve_port`，
    而那里恰恰会调 `discover_first()`。于是**陈旧 pid 的锚点**会静默落到别的实例上。

    实测这个状态就存在：锚点 `C1-msz03wf5-u0ym` 记的是 pid 28720（Houdini 重启前），
    而 8100 上现在是 pid 57720 —— 读**成功了**，只是打在了另一个 pid 上。

    为什么不改成拒绝：单实例场景（Houdini 重启、还是同一个逻辑实例）是最常见的用法，
    拒绝会把一个能用的东西弄坏。
    为什么不自动采纳活着的 pid：那正是被明令禁止的猜测 —— 多开 Houdini 时会写错实例。
    所以选第三条：**照旧解析，但只要落到的 pid 与锚点记录不符就 WARN 一次**。
    吊牌下次 cook 时会自报新 pid，锚点自愈，警告随之消失。
    """
    port = _resolve_port(serial)
    if not port or not expected_pid:
        return port
    h = _probe_health(port)
    actual_pid = int((h or {}).get("pid") or 0)
    if actual_pid and actual_pid != expected_pid:
        key = (serial, expected_pid, actual_pid)
        if key not in _PID_MISMATCH_WARNED:
            _PID_MISMATCH_WARNED.add(key)
            # `LogRing` **没有 warn()**，且 LEVELS 里是 `"warning"` 不是 `"warn"`
            # （传错的 level 会被静默降级成 info —— 那样这条警告就淹在信息流里）。
            get_state().logs.add(
                "warning",
                "mapping",
                f"锚点 {serial} 记录 pid={expected_pid}，但解析到的端口 {port} 上是 "
                f"pid={actual_pid}：该吊牌自 Houdini 重启后未再 cook，锚点是陈旧的。"
                f"读写会打在 pid={actual_pid} 这个实例上；cook 一次该吊牌即可自愈。",
                serial,
            )
    return port


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


_PID_MISS_TTL = 30.0
"""扫不到某 pid 后，多久之内不再重扫（秒）。"""

_pid_miss_at: dict[int, float] = {}
"""pid -> 上次扫空的时刻。**只缓存失败**，命中从不缓存（端口会变，命中必须现探）。"""


def _find_port_by_pid_cached(expected_pid: int) -> tuple[int, dict] | None:
    """带**失败短缓存**的 pid 定位（v0.1.00134）。

    实测的病象：Houdini 重启后，未重新 cook 的吊牌其锚点记录还是**旧 pid**
    （心跳只在 cook 时发，所以旧 pid 会长期留着）。于是每次读都要
    「探记录端口 → pid 不符 → 扫 8100..8115 找那个已经不存在的 pid」，
    16 个端口 × 1s 超时 = **每次读固定多花 ~15s**（实测 15217/15271/15286ms）。

    扫空说明「这个 pid 的实例真的不在了」——那是个**稳定**结论，30s 内不会自己变回来，
    没必要每次读都重新证明一遍。所以只缓存失败：
    - 命中**从不**缓存：端口在实例重开后会变，命中必须现探才可靠（与 dev 规范一致）；
    - 30s 后允许再扫一次：万一那个实例真的回来了，不至于永久失联。
    """
    if not expected_pid:
        return None
    now = time.time()
    last = _pid_miss_at.get(expected_pid)
    if last is not None and now - last < _PID_MISS_TTL:
        return None  # 刚扫空过，别再花 16s 证明同一件事
    found = _find_port_by_pid(expected_pid)
    if found is None:
        _pid_miss_at[expected_pid] = now
    else:
        _pid_miss_at.pop(expected_pid, None)
    return found


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
    # **并发探**（v0.1.00134）：串行 16 个端口 × 1s 超时 = 最坏 16s，而这些探测彼此
    # 完全独立。并发之后最坏 ≈ 单次超时（~1s），实测首读 15.3s → 1.2s。
    #
    # 判据一个字没改：仍然只认 `health.pid == expected_pid`（pid 是识别实例的唯一可靠
    # 依据，端口在重开后可能属于另一个实例）。并发只改「多快问完」，不改「信谁」。
    #
    # 端口号小的优先：同一个 pid 理论上只应出现在一个端口，但万一出现多个，
    # 取最小端口让结果**可复现**——否则线程调度顺序会让答案每次不同。
    ports = list(range(_PORT_SCAN_START, _PORT_SCAN_END + 1))
    with ThreadPoolExecutor(max_workers=len(ports)) as pool:
        healths = list(pool.map(_probe_health, ports))
    for port, h in zip(ports, healths):
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
        failed = not isinstance(envelope, dict) or envelope.get("status") == "error"
        data = None if failed else envelope.get("data")
        # 值提取宽容（照 houdini_routes.get_channel_values）：dict 取 value，否则 data 本身
        value = None if failed else (data.get("value") if isinstance(data, dict) else data)
        # **失败也要走 vec3 兜底**：读元组参数时 get_parameter 直接报
        # 「Parameter 't' not found」，所以判据必须是「拿不到值」而不是「返回了 None」——
        # 先前把 fallback 放在 error 分支之后，那条 return 让它永远跑不到。
        if value is None and (resolved.get("type") or "") == "vec3":
            # **vec3 读要逐分量取**（v0.1.00131）。
            #
            # `parameters.get_parameter` 走的是 `node.parm(name)`，而 Houdini 里
            # 元组参数的 `parm("t")` 是 **None**（实测：`parm("t")->None`，
            # `parmTuple("t")->size 3`），于是读 `t` 会报
            # 「Parameter 't' not found ... Did you mean: tz, ty, tx」。
            # 写不受影响（set_parameter 收列表），所以症状是"写得进、读不出"。
            #
            # 那个工具属于官方 fxhoudinimcp，不改它；在**我们这侧**按分量拼：
            # `t` → `tx`/`ty`/`tz`，与 HDA 侧 `_COMPONENT_SUFFIXES` 同一套约定。
            value = await _read_vec3_components(port, node, parm)
        if value is None and failed:
            # 兜底也没拿到 → 如实报原始错误（不要把「读不到」伪装成 value=null 成功）
            return {"ok": False, "error": str(envelope)[:200]}
    _trace("data-get", name, resolved, value)
    return {"ok": True, "value": value}


async def _read_vec3_components(port: int, node: str, parm: str) -> list[float] | None:
    """逐分量读一个元组参数：`t` → `tx`/`ty`/`tz`。任一分量读不到 → None。

    只在 `parm()` 读不出来时兜底（见调用点）。**不猜缺失分量**：拿两个分量拼一个
    vec3 会静默给出错的位姿，比读不到更坏。
    """
    out: list[float] = []
    for axis in ("x", "y", "z"):
        try:
            env = await asyncio.to_thread(
                houdini_mcp.rpc, port, "parameters.get_parameter",
                {"node_path": node, "parm_name": f"{parm}{axis}"}, 4.0,
            )
        except Exception:  # noqa: BLE001 - 任一分量失败即整体放弃
            return None
        if not isinstance(env, dict) or env.get("status") == "error":
            return None
        d = env.get("data")
        v = d.get("value") if isinstance(d, dict) else d
        if not isinstance(v, (int, float)):
            return None
        out.append(float(v))
    return out


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
    # **不再因「读写同名」拒绝写入**（v0.1.00129 撤掉 v0.1.00125 那道 409 守卫）。
    #
    # 撤销的依据是用户的 A/B 实测（`/obj/geo1/execting_test1` 与 `execting_test2`）：
    # wrangle 里 `vector t1=@P; setpointattrib(...); vector t2=@P;` 得到 t1==t2 ——
    # **读写同一个名字是合法形状**，因为写在整趟跑完之后才落地（见 cook_txn.py）。
    # v0.1.00126 已按这个语义把执行顺序的保证移到 CookTxn，本处的守卫就成了残留：
    # 它会把用户「_input_ 读 tx、_output_ 写 tx」这种**正常**用法一律 409，
    # 实测正是它挡住了写回（`transform1/tx` -> 409）。
    #
    # 环仍然可查、可提示，只是不再拦人：`GET /api/projects/{pid}/cook-cycles`
    # 仍返回同名读写清单，UI 可据此提示「本趟结束后才生效」。
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


# --- 写回指向（output 端口 -> 逻辑名）----------------------------------------
#
# web 在用户改 `_output_` 的目的地时 PUT 这里；桥在 cook 时读它（routes.put_inputs
# -> cook_txn.passthrough_outputs）。没指向/悬空 = 空指针 -> passthrough。
#
# 端点保持**宽容**：没注册过、甚至半打出来的 serial 也回正常 200 形状（空 targets），
# 不回 404 —— 前端在用户边打字边渲染的时候不该看到错误（既有端点的一贯做法）。


class WritebackPut(BaseModel):
    project: str
    name: str


def _writeback_view(serial: str) -> dict:
    """`{serial, isTag, targets, resolved}`：存了什么 + 现在解析成什么。"""
    is_tag = cook_txn.is_tag_serial(serial)
    stored = {} if is_tag else cook_txn.get_writeback_targets().get_all(serial)
    return {
        "ok": True,
        "serial": serial,
        "isTag": is_tag,
        "targets": {str(p): t for p, t in sorted(stored.items())},
        "resolved": [cook_txn.resolve_target(p, t) for p, t in sorted(stored.items())],
    }


@router.get("/api/hda/{serial}/writeback")
async def get_writeback(serial: str) -> dict:
    """这个 HDA 的每个 output 端口指向哪儿，以及现在还解析得出来吗。"""
    if not is_valid_serial(serial):
        # 宽容：非法/半打的 serial 回空视图，不回 400
        return {"ok": True, "serial": serial, "isTag": False, "targets": {}, "resolved": []}
    return _writeback_view(serial)


@router.put("/api/hda/{serial}/writeback/{port}")
async def put_writeback(serial: str, port: int, payload: WritebackPut) -> dict:
    """把某个 output 端口指向 `project` 里的逻辑名 `name`。

    吊牌**拒绝存指向**（409）：吊牌的写回是 Cyl1nder 经 python runtime 的单向标记，
    「完全不用同步」，给它存几何写回指向只会让人以为有链路。
    """
    if not is_valid_serial(serial):
        raise HTTPException(status_code=400, detail="invalid serial")
    if cook_txn.is_tag_serial(serial):
        raise HTTPException(status_code=409, detail="tag serial needs no writeback sync")
    if not is_valid_project_serial(payload.project):
        raise HTTPException(status_code=400, detail="invalid project serial")
    try:
        stored = cook_txn.get_writeback_targets().set(serial, port, payload.project, payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "serial": serial, "port": int(port), "target": stored,
            "resolved": cook_txn.resolve_target(port, stored)}


@router.delete("/api/hda/{serial}/writeback/{port}")
async def delete_writeback(serial: str, port: int) -> dict:
    """撤掉一个端口的指向 -> 该端口下次 cook 回到 passthrough。"""
    if not is_valid_serial(serial):
        raise HTTPException(status_code=400, detail="invalid serial")
    removed = cook_txn.get_writeback_targets().clear(serial, port)
    return {"ok": True, "serial": serial, "port": int(port), "removed": removed}
