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
import posixpath
import time

import hou

from cyl1nder_bridge import BridgeClient
from cyl1nder_lifecycle import _ensure_serial, _parm

TAG_HEARTBEAT_INTERVAL = 5.0

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


def _parse_entry(entry: str, upstream: str) -> tuple[str, dict] | None:
    """解析一条 entries 条目。

    param 条目 → ("param", {"absolutePath": 绝对路径})（沿用 _resolve 语义）
    data 条目（@<adapter>:<nodePath>:<parmName>，仅绝对路径，节点路径以 "/" 开头）
    → ("data", {"absolutePath": "<nodePath>/<parmName>", "adapter": "<adapter>"})
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
        return ("data", {"absolutePath": f"{node_path}/{parm}", "adapter": adapter})
    return ("param", {"absolutePath": _resolve(entry, upstream)})


def _fingerprint(entries: list[str], upstream: str) -> str:
    """Stable sha1 fingerprint of the RAW entry texts + upstream node path.

    Resolution results are not part of it: only the entry TEXT changing (or the
    upstream node path) re-registers, so unchanged entries never re-register."""
    payload = json.dumps(sorted(entries) + [upstream])
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


def register_channels(client, param_paths, data_refs, upstream, hip, tag_path, serial) -> list[dict]:
    """PUT one `tag` channelRef + one `param` channelRef per param path + one
    `data` channelRef per data ref (kind="data", carries the adapter name).

    channelId (URL segment): the tag ref uses `serial`, each param/data ref uses
    its absolute path (leading `/` stripped + quoted by BridgeClient.put_channel).
    registeredAt / lastSeen are 0 - the bridge writes them.
    """
    label = tag_path.rsplit("/", 1)[-1] if "/" in tag_path else tag_path
    refs: list[dict] = []
    tag_ref = {
        "kind": "tag",
        "serial": serial,
        "nodePath": tag_path,
        "hip": hip,
        "label": label,
        "registeredAt": 0,
        "lastSeen": 0,
    }
    client.put_channel(serial, tag_ref)
    refs.append(tag_ref)
    for abs_path in param_paths:
        ref = {
            "kind": "param",
            "serial": serial,
            "nodePath": tag_path,  # 归属吊牌节点路径（探测语义：确认吊牌存活+类型）
            "absolutePath": abs_path,
            "hip": hip,
            "label": abs_path,
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
            "registeredAt": 0,
            "lastSeen": 0,
        }
        client.put_channel(dr["absolutePath"], ref)
        refs.append(ref)
    return refs


def heartbeat(client, serial, upstream, fingerprint) -> None:
    """Throttled (>= TAG_HEARTBEAT_INTERVAL) heartbeat summary POST."""
    global _LAST_HEARTBEAT
    now = time.time()
    if now - _LAST_HEARTBEAT < TAG_HEARTBEAT_INTERVAL:
        return
    _LAST_HEARTBEAT = now
    client.heartbeat_channels(
        {
            "serial": serial,
            "nodePath": client.node_path,
            "upstreamNodePath": upstream,
            "fingerprint": fingerprint,
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

    parsed = [_parse_entry(e, upstream.path()) for e in entries]
    bad = [e for e, r in zip(entries, parsed) if r is None]
    valid = [r for r in parsed if r is not None]
    param_paths = [r[1]["absolutePath"] for r in valid if r[0] == "param"]
    data_refs = [r[1] for r in valid if r[0] == "data"]
    # 指纹只认原样条目文本：条目文本变才重注册（解析结果不算在内）
    fingerprint = _fingerprint(entries, upstream.path())

    if _FINGERPRINTS.get(serial) != fingerprint:
        register_channels(client, param_paths, data_refs, upstream.path(), hip, tag_path, serial)
        _FINGERPRINTS[serial] = fingerprint
    else:
        heartbeat(client, serial, upstream.path(), fingerprint)

    if bad:
        _set_status(subnet, f"bad-entry: {bad[0]}")
    else:
        _set_status(subnet, "ok" if not client.last_error else "offline")
