"""吊牌 HDA 通道注册路由（见 devlog/tag-hda-plan.md P1、P4）。

- PUT  /api/channels/{channelId:path}             注册（幂等 upsert）
- GET  /api/channels                              关联注册大全
- POST /api/hda/{serial}/channels/heartbeat       心跳摘要（touch 该 serial 的所有通道；
                                                  body 可选 values -> WS 广播 channel-values，P5a）
- GET  /api/channels/{channelId:path}/probe       经 houdini 代理做存活探测
- GET/PUT /api/channels/{channelId:path}/value    data 通道值读写（经适配器 code.execute_python 代理）
- GET  /api/serials/{serial}/capabilities         该 serial 提供什么端口（nodeview 下拉数据源）

URL channelId 规范：param/data 通道 = absolutePath 去前导 "/"（段间保留 "/"），
经 FastAPI :path 捕获后服务端回加 "/"；tag/hda 通道 = serial。
value 端点必须先于注册路由声明：PUT /api/channels/{channelId:path} 会吞掉 /value 后缀。

main.py 由主进程挂载本 router（本文件不改 main.py）。
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import houdini_mcp
from .data_adapters import get_adapter
from .houdini_routes import _resolve_port
from .protocol import (
    MAPPING_TYPES,
    ChannelRef,
    SerialCapabilities,
    SerialPortOption,
    is_valid_serial,
)
from .state import get_state
from .ws import manager

router = APIRouter()


def _check_serial(serial: str) -> None:
    if not is_valid_serial(serial):
        raise HTTPException(status_code=400, detail="invalid serial")


def _key_of(ref: ChannelRef) -> str:
    if ref.kind in ("param", "data"):
        return ref.absolutePath or ""
    return ref.serial or ""


def _path_key(channel_id: str, kind: str) -> str:
    """channelId 反推 key：param/data 通道路径 id 前补 "/"。"""
    if kind in ("param", "data"):
        return "/" + channel_id
    return channel_id


def _probe_key(channel_id: str) -> str:
    """probe 的 channelId 反推 key：param 通道路径 id 含 "/"（段间保留），回加 "/"。"""
    return "/" + channel_id if "/" in channel_id else channel_id


def _find_channel(key: str) -> dict | None:
    """按 key 直查通道（channels.py 键控规则：kind=param/data → absolutePath）。"""
    return get_state().channels.get(key)


def _resolve_data_target(ref: dict) -> tuple[str, str]:
    """data 通道目标解析：absolutePath = <node_path>/<parm_name>（斜杠天然分隔）。"""
    absolute = ref.get("absolutePath") or ""
    node, sep, parm = absolute.rpartition("/")
    if not sep or not node or not parm:
        raise HTTPException(status_code=400, detail="bad data target")
    return node, parm


class ValuePut(BaseModel):
    value: Any


@router.get("/api/channels/{channelId:path}/value")
async def get_channel_value(channelId: str) -> dict:
    """data 通道值读取：经适配器 code.execute_python 代理（见 devlog/tag-hda-plan.md P4）。"""
    key = _probe_key(channelId)
    ref = _find_channel(key)
    if ref is None:
        raise HTTPException(status_code=404, detail="channel not found")
    if ref.get("kind") != "data":
        raise HTTPException(status_code=400, detail="not a data channel")
    adapter = get_adapter(ref.get("adapter") or "")
    if adapter is None:
        raise HTTPException(status_code=400, detail="unknown adapter")
    serial = ref.get("serial") or ""
    if not serial:
        raise HTTPException(status_code=400, detail="no serial")
    target_node, target_parm = _resolve_data_target(ref)
    port = await asyncio.to_thread(_resolve_port, serial)
    if not port:
        return {"ok": False, "error": "houdini mcp not reachable"}
    result = await asyncio.to_thread(adapter.read, port, target_node, target_parm)
    if not result.get("ok"):
        return {"ok": False, "error": str(result.get("error") or "read failed")[:200]}
    # trace（P3）：data-get 埋点（只埋成功）
    get_state().trace.add(
        actor="web-param",
        action="data-get",
        channel=key,
        target=ref.get("absolutePath") or "",
        digest=str(result.get("value"))[:80],
    )
    return {"ok": True, "value": result.get("value")}


@router.put("/api/channels/{channelId:path}/value")
async def put_channel_value(channelId: str, payload: ValuePut) -> dict:
    """data 通道值写入：经适配器 code.execute_python 代理（见 devlog/tag-hda-plan.md P4）。"""
    key = _probe_key(channelId)
    ref = _find_channel(key)
    if ref is None:
        raise HTTPException(status_code=404, detail="channel not found")
    if ref.get("kind") != "data":
        raise HTTPException(status_code=400, detail="not a data channel")
    adapter = get_adapter(ref.get("adapter") or "")
    if adapter is None:
        raise HTTPException(status_code=400, detail="unknown adapter")
    serial = ref.get("serial") or ""
    if not serial:
        raise HTTPException(status_code=400, detail="no serial")
    target_node, target_parm = _resolve_data_target(ref)
    port = await asyncio.to_thread(_resolve_port, serial)
    if not port:
        return {"ok": False, "error": "houdini mcp not reachable"}
    result = await asyncio.to_thread(adapter.write, port, target_node, target_parm, payload.value)
    if not result.get("ok"):
        return {"ok": False, "error": str(result.get("error") or "write failed")[:200]}
    # trace（P3）：data-set 埋点（只埋成功）
    get_state().trace.add(
        actor="web-param",
        action="data-set",
        channel=key,
        target=ref.get("absolutePath") or "",
        digest=str(payload.value)[:80],
    )
    return {"ok": True, "value": payload.value}


@router.put("/api/channels/{channelId:path}")
async def put_channel(channelId: str, ref: ChannelRef) -> dict:
    key = _key_of(ref)
    if key != _path_key(channelId, ref.kind):
        raise HTTPException(status_code=400, detail="channelId mismatch")
    stored = get_state().channels.register(ref.model_dump())
    _sync_mapping_entry(ref)
    # trace（P3）：注册埋点（零行为影响）
    get_state().trace.add(
        actor="tag-hda",
        action="register",
        channel=key,
        target=ref.kind,
        digest=ref.label,
    )
    return {"ok": True, "channelId": key, "ref": stored}


def _other_declarer(serial: str, rel: str) -> str | None:
    """除 `serial` 之外，还有哪个吊牌的通道行声明着这个逻辑名？没有则 None（v0.1.00143）。

    判据只看**通道行**（那是"谁在声明"的事实来源），不看映射条目 ——
    映射条目按 `(项目, 逻辑名)` 唯一，本来就分不出是谁声明的。
    """
    rel = (rel or "").strip()
    if not rel:
        return None
    for row in get_state().channels.list():
        if row.get("kind") not in ("param", "data"):
            continue
        if (row.get("rel") or "").strip() != rel:
            continue
        other = (row.get("serial") or "").strip()
        if other and other != serial:
            return other
    return None


def _reanchor_entry(project: str, name: str, new_anchor: str) -> bool:
    """把一条映射条目改挂到 `new_anchor` 上（v0.1.00143）。

    比删掉再等对方重注册更好：重注册要等那个吊牌下次 cook，而吊牌可能几小时不 cook
    （心跳只在 cook 时发）—— 那段时间里这个逻辑名是悬空的，用户点了就报解析不出。
    """
    st = get_state()
    entry = st.mappings.get_entry(project, name)
    if entry is None:
        return False
    entry["anchor"] = new_anchor
    try:
        st.mappings.put_entry(project, name, entry)
        return True
    except Exception:  # noqa: BLE001 - 改挂失败就退回"什么都不做"，绝不误删
        return False


def _sync_mapping_entry(ref: ChannelRef) -> None:
    """注册带 rel 的通道 -> 在**含该吊牌的每个项目**里建/更新一条映射条目（v0.1.00114）。

    逻辑名默认取 `rel`（相对吊牌所在网络的地址），这正是用户在 node 里要写的相对地址。
    锚点 = 该吊牌 serial（不可变），因此吊牌移动后逻辑名不变、绝对路径自动跟随。

    吊牌不知道自己属于哪个项目（项目是 web 侧概念），所以由桥在这里按成员关系分发。
    best-effort：mappings 未挂载或任何异常一律吞掉——注册绝不能因映射失败而失败。
    """
    rel = (getattr(ref, "rel", None) or "").strip()
    serial = (ref.serial or "").strip()
    if not rel or not serial or ref.kind not in ("param", "data"):
        return
    st = get_state()
    mappings = getattr(st, "mappings", None)
    if mappings is None:
        return
    entry = {
        "anchor": serial,
        "rel": rel,
        "kind": ref.kind,
        "adapter": ref.adapter,
        "type": getattr(ref, "type", None) or "float",
        "label": ref.label or rel,
    }
    try:
        for project in st.projects.list():
            pid = project.get("projectSerial") or ""
            if not pid:
                continue
            if any((m or {}).get("serial") == serial for m in project.get("members") or []):
                mappings.put_entry(pid, rel, entry)
    except Exception:  # noqa: BLE001 - 映射同步失败绝不影响注册
        return


@router.get("/api/channels")
async def list_channels() -> dict:
    return {"channels": get_state().channels.list()}


@router.delete("/api/channels/by-serial/{serial}")
async def delete_channels_by_serial(serial: str) -> dict:
    """删掉某 serial 的**全部**通道行（v0.1.00158）。

    路径用 `by-serial/` 前缀而不是 `/api/channels/{serial}`：param 行的 channelId 是
    **绝对路径**（`{channelId:path}`，会吞掉多段），两者放同一坑位必然打架。

    给 e2e 收拾自己注册的行用 —— teardown 此前只扫场景登记，通道行没人清（实测一跑
    11→13）。非法 serial → 400。
    """
    if not is_valid_serial(serial):
        raise HTTPException(status_code=400, detail=f"invalid serial: {serial!r}")
    removed = get_state().channels.remove_serial(serial)
    return {"ok": True, "removed": len(removed), "keys": removed}


class HeartbeatBody(BaseModel):
    serial: str
    nodePath: str
    upstreamNodePath: str
    fingerprint: str
    values: dict | None = None  # P5a：可选参数值捎带（旧 HDA 缺省兼容）
    # 锚点上报（旧 HDA 缺省兼容）：吊牌自报当前位置，nodePath 变化即触发 anchor-moved。
    hip: str | None = None
    mode: str | None = None
    # 存活实证用（旧 HDA 缺省兼容）：吊牌自身 os.getpid() + 已发现的 MCP 端口。
    # 心跳超时只说明「最近没 cook」，降级前要拿这两项打 mcp.health 核对 pid。
    pid: int | None = None
    mcpPort: int | None = None
    # 本次**声明的全部 rel 名**（v0.1.00131，旧 HDA 缺省 None = 不做退役）。
    # 没有它桥就无从知道「哪些行该退役」：注册只有 upsert，心跳只 touch，
    # 于是把 entries 从 `tx` 改成 `t` 之后旧的 `tx` 行永远留着（用户看到的过时注册）。
    names: list[str] | None = None


@router.post("/api/hda/{serial}/channels/heartbeat")
async def heartbeat(serial: str, payload: HeartbeatBody) -> dict:
    _check_serial(serial)
    now = time.time()
    st = get_state()
    for ref in st.channels.list():
        if ref.get("serial") == serial:
            st.channels.touch(st.channels._key_of(ref), now)
    # trace（P3）：心跳埋点（零行为影响）
    st.trace.add(
        actor="tag-hda",
        action="heartbeat",
        channel=serial,
        target=payload.nodePath,
        digest=payload.fingerprint,
    )
    # P5a：心跳捎带参数值 -> WS 广播 channel-values（不回写内存、值不落地）
    if payload.values:
        await manager.broadcast(serial, {"type": "channel-values", "values": payload.values})
    # 退役本次未声明的条目行（v0.1.00131，用户 #2「清理过时的注册参数 tx」）。
    # 放在 touch 之后：先把活着的行刷新，再删没被声明的，顺序反了会先删后刷、白做一次。
    # `names` 缺省（旧 HDA）→ retire_except 收到空集直接返回，什么都不删。
    if payload.names is not None:
        keep = {n.strip() for n in payload.names if n.strip()}
        gone = st.channels.retire_except(serial, "param", keep)
        # **映射表要一起扫**：通道行与映射条目是两份账。只扫通道行的话，
        # `transform1/tx` 的行没了但映射条目还在（实测就是这个现象），
        # 用户在 param 面板的端口下拉里仍然看得到那个过时逻辑名。
        gone_map: list[str] = []
        moved_map: list[str] = []
        if keep:
            for pid_, nm in st.mappings.entries_for_anchor(serial):
                if nm in keep:
                    continue
                # **别删还有人声明的逻辑名**（v0.1.00143）。
                #
                # 映射条目按 `(项目, 逻辑名)` 唯一，而两个吊牌可以声明**同一个** rel ——
                # 那时它们共用一条条目，anchor 是最后注册的那个。于是本吊牌不再声明它时，
                # 上面这个 sweep 会把**另一个吊牌还在用的**条目一起删掉。
                # 实测后果：`transform1/tx` 的通道行还在（`C1-mst8wa94-8uz8` 声明着），
                # 映射条目却没了 —— 端口下拉里看得到这个名字，一用就解析不出来。
                heir = _other_declarer(serial, nm)
                if heir is not None:
                    if _reanchor_entry(pid_, nm, heir):
                        moved_map.append(f"{pid_}:{nm}->{heir}")
                    continue
                if st.mappings.del_entry(pid_, nm):
                    gone_map.append(f"{pid_}:{nm}")
        if gone or gone_map or moved_map:
            # 改挂也要报：静默改锚点会让「这个名字现在归谁」变成不可见的状态变化。
            st.logs.info(
                "channels",
                f"retired stale for {serial}: rows=[{', '.join(gone)}] "
                f"entries=[{', '.join(gone_map)}] reanchored=[{', '.join(moved_map)}]",
                serial,
            )
    reported = _report_anchor(serial, payload)
    moved = reported if reported is not None and reported.get("moved") else None
    if moved is not None:
        await manager.broadcast(
            serial,
            {
                "type": "anchor-moved",
                "serial": serial,
                "oldPath": moved.get("old") or "",
                "newPath": payload.nodePath,
                "names": moved.get("names") or [],
            },
        )
        st.trace.add(
            actor="tag-hda",
            action="anchor-move",
            channel=serial,
            target=payload.nodePath,
            digest=f"{moved.get('old') or ''} -> {payload.nodePath}",
        )
    # pid 变了 = Houdini 重开（同路径下换了另一个进程）。沿用既有 "register" action：
    # 语义上确实是「这个吊牌在新进程里重新登记了一次」，不新造 action 名。
    if reported is not None and reported.get("pid_changed"):
        st.trace.add(
            actor="tag-hda",
            action="register",
            channel=serial,
            target=payload.nodePath,
            digest=f"pid {reported.get('old_pid') or 0} -> {payload.pid or 0} (houdini restarted)",
        )
    await _sync_project_hip(serial, payload.hip or "")
    return {"ok": True, "serial": serial, "lastSeen": now}


async def _sync_project_hip(serial: str, hip: str) -> None:
    """心跳带 hip -> 按 hip 归拢项目（自动登记成员；hip 变了则另存为迁移）。

    这是「一个文件下的节点自动注册在一起」的落点：用户什么都不用做。
    best-effort，与 _report_anchor 同一口径：projects 未挂载或任何异常一律吞掉——
    心跳的既有行为（touch lastSeen / channel-values 广播 / 锚点上报）绝不受影响。
    迁移实现只有一份，在 project_routes 里（此处函数内 import 避免模块级循环依赖）。
    """
    if not hip:
        return
    if getattr(get_state(), "projects", None) is None:
        return
    try:
        from .project_routes import bind_serial_to_hip

        await bind_serial_to_hip(serial, hip)
        # 成员关系刚建立 -> 补建该 serial 的映射条目。
        #
        # 为什么必须在这里补：`_sync_mapping_entry` 只把条目发给「已含该 serial 的项目」，
        # 而注册（PUT /api/channels）发生在心跳**之前**——那一刻该吊牌还不是任何项目的
        # 成员，条目于是被丢掉，且除非条目文本变化触发重注册，永远不会再补上。
        # 实测：新建吊牌 4 条 apex 条目全部丢失，只剩旧吊牌的 2 条。
        _replay_mapping_entries(serial)
    except Exception:  # noqa: BLE001 - 项目归拢失败不影响心跳
        return


def _replay_mapping_entries(serial: str) -> None:
    """把该 serial 已注册的通道重新过一遍 `_sync_mapping_entry`（幂等 upsert）。

    只针对带 `rel` 的 param/data 通道；tag 通道本身不是映射条目。
    """
    st = get_state()
    for ch in st.channels.list():
        if ch.get("serial") != serial:
            continue
        if not (ch.get("rel") or "").strip():
            continue
        try:
            _sync_mapping_entry(ChannelRef(**ch))
        except Exception:  # noqa: BLE001 - 单条失败不影响其余
            continue


def _report_anchor(serial: str, payload: HeartbeatBody) -> dict | None:
    """吊牌自报位置 + pid/端口 -> mappings.upsert_anchor；moved 或 pid 变化时返回结果。

    心跳是 best-effort：mappings 未挂载（主进程合并时才挂）或内部异常一律吞掉，
    绝不让锚点上报打断心跳本身。pid/mcpPort 缺省（旧 HDA）传 0，注册表按「0 不覆盖
    已知好值」处理。
    """
    if not payload.nodePath:
        return None
    mappings = getattr(get_state(), "mappings", None)
    if mappings is None:
        return None
    try:
        result = mappings.upsert_anchor(
            serial,
            payload.nodePath,
            payload.hip or "",
            payload.mode or "parm",
            pid=int(payload.pid or 0),
            mcp_port=int(payload.mcpPort or 0),
        )
    except Exception:  # noqa: BLE001 - 锚点上报失败不影响心跳
        return None
    if isinstance(result, dict) and (result.get("moved") or result.get("pid_changed")):
        return result
    return None


@router.get("/api/channels/{channelId:path}/probe")
async def probe(channelId: str) -> dict:
    key = _probe_key(channelId)
    ref = get_state().channels.get(key)
    if ref is None:
        raise HTTPException(status_code=404, detail="channel not found")
    node_path = ref.get("nodePath") or ""
    serial = ref.get("serial") or ""
    if not serial:
        return {"ok": True, "alive": False, "matched": False, "nodePath": node_path, "serial": "", "reason": "no serial"}
    port = await asyncio.to_thread(_resolve_port, serial)
    if not port:
        return {
            "ok": True,
            "alive": False,
            "matched": False,
            "nodePath": node_path,
            "serial": serial,
            "reason": "houdini mcp not reachable",
        }
    alive = False
    matched = False
    reason: str | None = None
    try:
        result = await asyncio.to_thread(houdini_mcp.rpc, port, "nodes.get_node_info", {"node_path": node_path}, 4.0)
    except Exception as exc:  # noqa: BLE001 - 探测失败不是服务错误，吞掉转 reason
        reason = str(exc)
    else:
        if isinstance(result, dict) and not result.get("error"):
            alive = True
            data = result.get("data") if isinstance(result.get("data"), dict) else {}
            matched = "cyl1ndertag" in _node_type_name(data).lower()
    get_state().channels.touch(key, time.time())
    return {"ok": True, "alive": alive, "matched": matched, "nodePath": node_path, "serial": serial, "reason": reason}


# --- serial 能力查询（nodeview 单地址 + 下拉端口）----------------------------
#
# 路由不会被吞、也不吞别人：本仓已两次踩「{serial} 段吃掉更具体路由」的坑
# （见 devlog/project-mapping-design.md §5 与本文件顶部 /value 注释）。这里的
# `/api/serials/{serial}/capabilities` 是**定长 3 段 + 末段字面量**，而唯一的同前缀
# 路由 `GET /api/serials`（routes.py）是定长 2 段的精确路径——段数不同，互不匹配。
# 本仓所有 `:path`（会跨段贪吃的那种）都在 `/api/channels/…` 与 `/api/projects/…`
# 之下，前缀不同，够不到 `/api/serials/…`。故与挂载顺序无关。

# HDA = Cyl1nder geo 节点，固定 4 进 4 出（铁律，见 AGENTS.md 仓库结构）。
_HDA_PORTS = 4


def _norm_type(raw: object) -> str:
    """脏 type 归一化到 MAPPING_TYPES；不认识的一律返回 ""（不猜默认值）。

    值来自 HDA 上报的线上数据，可能是 None / 大小写不一 / 带空格 / 早期写法。
    这里**只做去空格 + 小写**再比对白名单：不做别名映射，因为猜错类型比不给类型更坏
    （UI 会照着连线和读写）。
    """
    s = str(raw or "").strip().lower()
    return s if s in MAPPING_TYPES else ""


def _tag_options(serial: str) -> list[SerialPortOption]:
    """吊牌的逻辑名清单：该 serial 名下 kind=param/data 的通道行。

    逻辑名取 `rel`（相对吊牌所在网络的地址，正是用户在 node 里写的东西）；兼容读
    `logicalName` 别名，但 `rel` 优先——本仓落库字段是 `rel`（见 protocol.ChannelRef）。
    按逻辑名排序：下拉顺序必须在多次请求间稳定，否则用户选项会自己跳位。
    """
    options: list[SerialPortOption] = []
    for ref in get_state().channels.list():
        if ref.get("serial") != serial or ref.get("kind") not in ("param", "data"):
            continue
        name = str(ref.get("rel") or ref.get("logicalName") or "").strip()
        if not name:
            continue  # 没逻辑名的行进不了下拉：用户无从选择，也无法解析
        # label **就用逻辑名**，不要用 ref["label"]：后者存的是**绝对路径**
        # （实测 `/obj/cyl1nder_tag_demo/transform1/tx`）。用户要求的下拉文本是
        # `tx: float` 这种——绝对路径既撑爆面板宽度，又把区分位（末段 tx/ty/tz）推到
        # 最右边，正是 development-standards「过长标识串」那条要避免的形状。
        # 完整绝对路径仍可由 web 侧从 nodePath + 逻辑名解析，或看 mappings 表。
        options.append(
            SerialPortOption(
                key=name,
                label=name,
                type=_norm_type(ref.get("type")),
            )
        )
    options.sort(key=lambda o: o.key)
    return options


@router.get("/api/serials/{serial}/capabilities")
async def serial_capabilities(serial: str) -> SerialCapabilities:
    """一个地址（serial）-> 它提供什么端口，供 nodeview 渲染下拉。

    检测顺序是**先吊牌、后 HDA**，这一点不能反：
    ① 通道表里有 `kind="tag"` 且 key=serial 的行 = 吊牌的**直接证据**（吊牌注册时自己
       写的）；
    ② registry.json 只由 `put_inputs` 写，**吊牌从不进去**（devlog/
       project-mapping-design.md §5.1 记的踩坑，曾是「打开吊牌项目显示 HDA 离线」的根因）。
       反过来 registry 里有记录**不能**证明是 geo HDA——`SerialRegistry.touch()` 对任何
       合法 serial 都会自动登记。所以只有在「通道表说不是吊牌」之后，registry 命中才
       能读作 HDA。
    ③ 两边都没有 -> known=False。

    非法格式（半截地址）与未注册同样处理：返回 200 + known=False，不抛 400。
    """
    out = SerialCapabilities(serial=serial)
    if not is_valid_serial(serial):
        return out
    st = get_state()
    tag = st.channels.get(serial)
    if tag is not None and tag.get("kind") == "tag":
        options = _tag_options(serial)
        # 吊牌暴露的是 Houdini **参数值**，读写双向都通：读 = GET /api/channels/{id}/value
        # 与 GET /api/hda/{serial}/channel-values；写 = 对应的 PUT（data 走适配器，
        # param 走 parameters.set_parameter 批量端点）。既然同一批逻辑名两个方向都能用，
        # inputs 与 outputs 就给同一份清单，由用户按节点类型选方向。
        return SerialCapabilities(
            serial=serial,
            kind="tag",
            known=True,
            nodePath=str(tag.get("nodePath") or ""),
            hip=str(tag.get("hip") or ""),
            inputs=options,
            outputs=list(options),
        )
    rec = st.registry.get(serial)
    if rec is None:
        return out
    return SerialCapabilities(
        serial=serial,
        kind="hda",
        known=True,
        nodePath=rec.nodePath or "",
        hip=rec.hip or "",
        # key 0 基（web 图内部端口键 in0..in3 / out0..out3），label 1 基（用户口语 in1-4）。
        inputs=[SerialPortOption(key=f"in{i}", label=f"In {i + 1}", type="geo") for i in range(_HDA_PORTS)],
        outputs=[SerialPortOption(key=f"out{i}", label=f"Out {i + 1}", type="geo") for i in range(_HDA_PORTS)],
    )


def _node_type_name(data: dict) -> str:
    """Extract the node type name from nodes.get_node_info data: the type field
    may be a plain string or a dict ({name,label,category} on live fxhoudinimcp)."""
    for k in ("type", "typeName", "type_name", "node_type", "nodeType"):
        v = data.get(k)
        if isinstance(v, str) and v:
            return v
        if isinstance(v, dict):
            for kk in ("name", "typeName", "type_name"):
                s = v.get(kk)
                if isinstance(s, str) and s:
                    return s
    return ""
