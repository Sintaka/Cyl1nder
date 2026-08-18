"""Hang-tag HDA cook logic: register watched parameter channels + heartbeat.

The Cyl1nderTag HDA is a pure side-attachment (1 input / 0 output): its single
python SOP runs cook() on the main thread and only does short HTTP calls through
BridgeClient (which never raises). It registers one `tag` channelRef plus one
`param` channelRef per resolved param entry and one `data` channelRef per
resolved data entry (@adapter:node:parm) on first cook (or when the fingerprint
changes), then only POSTs a throttled heartbeat summary on subsequent cooks.

No long-lived threads: everything runs on Houdini's main thread (cook).
"""
from __future__ import annotations

import hashlib
import json
import os
import posixpath
import time

import hou

from cyl1nder_bridge import BridgeClient
from cyl1nder_lifecycle import _ensure_serial, _parm

# 心跳节流：≥60s（v0.1.00114 从 5s 放宽）。
# 存活判定不再依赖心跳频率——心跳只能证明「最近 cook 过」，而吊牌长期不 cook 是正常的。
# 真存活由锚点探测（按上报的 pid + MCP 端口核对 mcp.health）负责，所以心跳可以很低频，
# 只做「我还在 + 位置/pid/端口摘要」上报。
TAG_HEARTBEAT_INTERVAL = 60.0

# Module-level throttle state (cook main thread only).
_LAST_HEARTBEAT = 0.0
_FINGERPRINTS: dict[str, str] = {}


def _set_status(root: hou.Node, text: str) -> None:
    """Write the last cook outcome to the subnet's userData (no status parm)."""
    try:
        if root.userData("cyl1nder_tag_status") != text:
            root.setUserData("cyl1nder_tag_status", text)
    except Exception:  # noqa: BLE001 - status must never affect the cook
        pass


def _parse_entries(raw: str) -> list[str]:
    """Split the entries parm: one entry per line, `;` separators also accepted,
    `#` comments and blank lines ignored."""
    out: list[str] = []
    for line in (raw or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        for tok in line.split(";"):
            tok = tok.strip()
            if tok and not tok.startswith("#"):
                out.append(tok)
    return out


def _resolve(entry: str, upstream: str) -> str:
    """Translate one entry into an absolute parameter path.

    Absolute entries (leading `/`) are returned verbatim; relative entries are
    joined onto the upstream node path and normalized (posix): `tx` ->
    `/obj/geo1/transform1/tx`, `../ty` -> the upstream node's parent `ty`.
    """
    entry = (entry or "").strip()
    if entry.startswith("/"):
        return entry
    return posixpath.normpath(posixpath.join(upstream, entry))


# 分量后缀 -> 值类型（apex 模式判 vec3/float 用）。
_COMPONENT_SUFFIXES = ("tx", "ty", "tz", "rx", "ry", "rz", "sx", "sy", "sz")


def _read_mode(root) -> str:
    """读标记模式 token（"parm" | "apex"）。

    `mode` 是 MenuParmTemplate：`eval()` 返回**索引整数**（0/1），不是 token，
    所以必须用 `evalAsString()`。缺参数（旧 HDA 定义）退回 "parm"，保持旧行为。"""
    p = root.parm("mode")
    if p is None:
        return "parm"
    try:
        token = p.evalAsString()
    except Exception:  # noqa: BLE001
        return "parm"
    return token if token in ("parm", "apex") else "parm"


def _network_of(node_path: str) -> str:
    """节点所在网络 = 去掉最后一段（`/obj/geo1/tag1` -> `/obj/geo1`）。

    必须与桥侧映射系统的 `dirname(anchor.nodePath)` 语义一致——两侧解析基准分叉
    会让同一条 rel 在 HDA 与桥算出不同绝对路径。"""
    node_path = (node_path or "").strip()
    if not node_path or "/" not in node_path:
        return ""
    return node_path.rsplit("/", 1)[0]


def _rel_to_network(abs_path: str, tag_path: str) -> str:
    """绝对路径 -> 相对「吊牌所在网络」的地址（映射系统的 entry.rel）。

    不在同一网络下（跨 geo 等）时退回绝对路径：映射系统按 rel 以 posix 规则
    join，绝对 rel 依然能解析，只是失去移动容错——这是有意的降级而非静默错误。"""
    net = _network_of(tag_path)
    if net and abs_path.startswith(net + "/"):
        return abs_path[len(net) + 1:]
    return abs_path


def _parse_entry(
    entry: str, upstream: str, mode: str = "parm", tag_path: str = ""
) -> tuple[str, dict] | None:
    """解析一条 entries 条目。

    显式 data 条目（`@<adapter>:<nodePath>/<parm>`，节点路径须以 "/" 开头）优先，
    与 mode 无关——旧写法照旧可用。

    否则按标记模式（mode，v0.1.00114）：
      "parm"：("param", {absolutePath, rel, type:"float"})
              相对地址以**上游节点**为基准（`tx` = 上游节点的 tx 参数，旧语义不变）
      "apex"：("data", {absolutePath, rel, adapter:"apex-ctrl", type})
              条目形如 `<sceneanimate 节点>/<控制器>[/<tx…sz>]`，相对地址以
              **吊牌所在网络**为基准（兄弟节点语义）——因为 sceneanimate 是吊牌的
              兄弟节点，不是上游节点的子节点。这个基准必须与桥侧映射系统的
              `dirname(anchor.nodePath)` 完全一致，否则 HDA 侧与桥侧解析会分叉。
              末段是分量后缀 → type="float"，否则整体位姿 → type="vec3"

    `rel` 一并带出，供桥侧映射系统建立「逻辑名 → 相对地址」条目（锚点 = 本吊牌 serial）。
    非法 → None（cook 时跳过并写状态 "bad-entry: <条目>"）。
    """
    entry = (entry or "").strip()
    if not entry:
        return None
    if entry.startswith("@"):
        adapter, _, rest = entry[1:].partition(":")
        node_path, _, parm = rest.rpartition("/")
        if not adapter or not parm or not node_path.startswith("/"):
            return None
        abs_path = f"{node_path}/{parm}"
        vtype = "float" if parm.lower() in _COMPONENT_SUFFIXES else "vec3"
        return (
            "data",
            {
                "absolutePath": abs_path,
                "rel": _rel_to_network(abs_path, tag_path),
                "adapter": adapter,
                "type": vtype,
            },
        )
    if (mode or "parm") == "apex":
        base = _network_of(tag_path) or upstream
        abs_path = _resolve(entry, base)
        tail = abs_path.rsplit("/", 1)[-1].lower()
        vtype = "float" if tail in _COMPONENT_SUFFIXES else "vec3"
        return (
            "data",
            {
                "absolutePath": abs_path,
                "rel": _rel_to_network(abs_path, tag_path),
                "adapter": "apex-ctrl",
                "type": vtype,
            },
        )
    abs_path = _resolve(entry, upstream)
    return (
        "param",
        {
            "absolutePath": abs_path,
            "rel": _rel_to_network(abs_path, tag_path),
            "type": "float",
        },
    )


def _fingerprint(entries: list[str], upstream: str, tag_path: str = "", mode: str = "parm") -> str:
    """Stable sha1 fingerprint of the RAW entry texts + upstream + TAG PATH + mode.

    `tag_path` and `mode` are part of it since v0.1.00114. Before that the
    fingerprint was (entries, upstream) only, so **moving or renaming the tag
    itself never re-registered** - the mapping kept the stale nodePath for the
    whole session. Resolution results are still excluded: only the entry TEXT,
    the upstream node, the tag's own path or the mark mode changing re-registers.
    """
    payload = json.dumps(sorted(entries) + [upstream, tag_path, mode])
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


def register_channels(
    client, param_refs, data_refs, upstream, hip, tag_path, serial, mode="parm"
) -> list[dict]:
    """PUT one `tag` channelRef + one `param` channelRef per param ref + one
    `data` channelRef per data ref (kind="data", carries the adapter name).

    channelId (URL segment): the tag ref uses `serial`, each param/data ref uses
    its absolute path (leading `/` stripped + quoted by BridgeClient.put_channel).
    registeredAt / lastSeen are 0 - the bridge writes them.

    Since v0.1.00114 each ref also carries `rel`/`type`/`mode`: the bridge turns
    those into mapping entries (logical name -> relative address) anchored on this
    tag's serial, which is what makes references survive the tag being moved.
    """
    label = tag_path.rsplit("/", 1)[-1] if "/" in tag_path else tag_path
    refs: list[dict] = []
    tag_ref = {
        "kind": "tag",
        "serial": serial,
        "nodePath": tag_path,
        "hip": hip,
        "label": label,
        "mode": mode,
        "registeredAt": 0,
        "lastSeen": 0,
    }
    client.put_channel(serial, tag_ref)
    refs.append(tag_ref)
    for pr in param_refs:
        abs_path = pr["absolutePath"]
        ref = {
            "kind": "param",
            "serial": serial,
            "nodePath": tag_path,  # 归属吊牌节点路径（探测语义：确认吊牌存活+类型）
            "absolutePath": abs_path,
            "hip": hip,
            "label": abs_path,
            "rel": pr.get("rel", ""),
            "type": pr.get("type", "float"),
            "mode": mode,
            "registeredAt": 0,
            "lastSeen": 0,
        }
        client.put_channel(abs_path, ref)
        refs.append(ref)
    for dr in data_refs:
        ref = {
            "kind": "data",
            "serial": serial,
            "nodePath": tag_path,  # 归属吊牌节点路径（探测语义同 param）
            "absolutePath": dr["absolutePath"],
            "adapter": dr["adapter"],
            "hip": hip,
            "label": dr["absolutePath"],
            "rel": dr.get("rel", ""),
            "type": dr.get("type", "vec3"),
            "mode": mode,
            "registeredAt": 0,
            "lastSeen": 0,
        }
        client.put_channel(dr["absolutePath"], ref)
        refs.append(ref)
    return refs


def _read_param_values(param_paths: list[str]) -> dict:
    """读注册参数当前值（hou.parm 绝对路径）；仅 JSON 可序列化标量（str/int/float/bool/None），
    其它（如向量）str() 化；读失败跳过该通道。"""
    values: dict = {}
    for path in param_paths:
        try:
            v = hou.parm(path).eval()
        except Exception:
            continue
        values[path] = v if isinstance(v, (str, int, float, bool)) or v is None else str(v)
    return values


def _instance_identity() -> tuple[int, int]:
    """(pid, mcpPort) —— 本 Houdini 实例的身份，供锚点「降级前实证」用。

    pid = `os.getpid()`：吊牌代码跑在 Houdini 进程里，所以这就是那个实例的 pid，
    也是铁律里认定实例的**唯一可靠判据**（端口会被重开的实例顶替）。
    mcpPort 取 `cyl1nder_houdini_mcp.known_port()`（后台发现线程的结果，0 = 还没发现）；
    这里**绝不主动扫端口**——cook 主线程做同步 HTTP 是死锁红线。
    """
    pid = 0
    port = 0
    try:
        pid = int(os.getpid())
    except Exception:  # noqa: BLE001
        pid = 0
    try:
        import cyl1nder_houdini_mcp as hmcp

        port = int(hmcp.known_port() or 0)
    except Exception:  # noqa: BLE001 - 发现模块缺失/未就绪一律当 0（桥侧不覆盖已知值）
        port = 0
    return pid, port


def heartbeat(client, serial, upstream, fingerprint, param_paths, hip="", mode="parm") -> None:
    """Throttled (>= TAG_HEARTBEAT_INTERVAL, 60s) heartbeat summary POST.

    Registered params' current values are read only when the throttle passes
    (zero polling cost on throttled cooks).

    `nodePath`/`hip`/`mode` feed the bridge mapping system's ANCHOR record
    (v0.1.00114): the anchor is this tag's serial, so reporting our own current
    path is what makes logical names survive the tag being moved or renamed.

    `pid`/`mcpPort` are the evidence that lets the bridge VERIFY liveness instead
    of guessing from heartbeat age: a tag only heartbeats when it cooks, so a
    stale heartbeat says nothing about whether Houdini is still there. With the
    pid recorded, a probe can compare `mcp.health` pid and tell "just idle" from
    "instance is gone"."""
    global _LAST_HEARTBEAT
    now = time.time()
    if now - _LAST_HEARTBEAT < TAG_HEARTBEAT_INTERVAL:
        return
    _LAST_HEARTBEAT = now
    pid, port = _instance_identity()
    client.heartbeat_channels(
        {
            "serial": serial,
            "nodePath": client.node_path,
            "upstreamNodePath": upstream,
            "fingerprint": fingerprint,
            "hip": hip,
            "mode": mode,
            "pid": pid,
            "mcpPort": port,
            "values": _read_param_values(param_paths),
        }
    )


def cook() -> None:
    node = hou.pwd()          # python SOP
    subnet = node.parent()    # HDA instance (subnet root)
    serial = _ensure_serial(node)  # node.parent() == subnet -> hidden parm
    bridge_url = _parm(subnet, "bridge_url", "http://127.0.0.1:8375")
    entries = _parse_entries(_parm(subnet, "entries", ""))

    upstream = node.input(0)
    if upstream is None:
        _set_status(subnet, "no-upstream")
        return

    if not entries:
        _set_status(subnet, "no-entries")
        return

    client = BridgeClient(
        serial, bridge_url=bridge_url, node_path=subnet.path(), label=subnet.name()
    )
    hip = hou.hipFile.path()
    tag_path = subnet.path()

    mode = _read_mode(subnet)

    parsed = [_parse_entry(e, upstream.path(), mode, tag_path) for e in entries]
    bad = [e for e, r in zip(entries, parsed) if r is None]
    valid = [r for r in parsed if r is not None]
    param_refs = [r[1] for r in valid if r[0] == "param"]
    data_refs = [r[1] for r in valid if r[0] == "data"]
    param_paths = [r["absolutePath"] for r in param_refs]  # 心跳读值只需绝对路径
    # 指纹认：条目原文 + 上游 + **吊牌自身路径** + 标记模式（解析结果不算在内）。
    # tag_path 是 v0.1.00114 补的——此前漏掉它，移动/改名吊牌整个会话都不重注册。
    fingerprint = _fingerprint(entries, upstream.path(), tag_path, mode)

    global _LAST_HEARTBEAT
    if _FINGERPRINTS.get(serial) != fingerprint:
        register_channels(
            client, param_refs, data_refs, upstream.path(), hip, tag_path, serial, mode
        )
        _FINGERPRINTS[serial] = fingerprint
        # 重注册即上报锚点（不等心跳节流）：移动/改名后映射必须立刻跟上。
        _LAST_HEARTBEAT = 0.0
    heartbeat(client, serial, upstream.path(), fingerprint, param_paths, hip, mode)

    if bad:
        _set_status(subnet, f"bad-entry: {bad[0]}")
    else:
        _set_status(subnet, "ok" if not client.last_error else "offline")
