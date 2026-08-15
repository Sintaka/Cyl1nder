"""吊牌 HDA 通道注册路由（见 devlog/tag-hda-plan.md P1、P4）。

- PUT  /api/channels/{channelId:path}             注册（幂等 upsert）
- GET  /api/channels                              关联注册大全
- POST /api/hda/{serial}/channels/heartbeat       心跳摘要（touch 该 serial 的所有通道）
- GET  /api/channels/{channelId:path}/probe       经 houdini 代理做存活探测
- GET/PUT /api/channels/{channelId:path}/value    data 通道值读写（经适配器 code.execute_python 代理）

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
from .protocol import ChannelRef, is_valid_serial
from .state import get_state

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
    # trace（P3）：注册埋点（零行为影响）
    get_state().trace.add(
        actor="tag-hda",
        action="register",
        channel=key,
        target=ref.kind,
        digest=ref.label,
    )
    return {"ok": True, "channelId": key, "ref": stored}


@router.get("/api/channels")
async def list_channels() -> dict:
    return {"channels": get_state().channels.list()}


class HeartbeatBody(BaseModel):
    serial: str
    nodePath: str
    upstreamNodePath: str
    fingerprint: str


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
    return {"ok": True, "serial": serial, "lastSeen": now}


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
