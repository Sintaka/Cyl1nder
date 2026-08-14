"""Hang-tag HDA cook logic: register watched parameter channels + heartbeat.

The Cyl1nderTag HDA is a pure side-attachment (1 input / 0 output): its single
python SOP runs cook() on the main thread and only does short HTTP calls through
BridgeClient (which never raises). It registers one `tag` channelRef plus one
`param` channelRef per resolved entry on first cook (or when the fingerprint
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


def _fingerprint(entries: list[str], upstream: str) -> str:
    """Stable sha1 fingerprint of the resolved entries + upstream node path."""
    payload = json.dumps(sorted(entries) + [upstream])
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


def register_channels(client, entries, upstream, hip, tag_path, serial) -> list[dict]:
    """PUT one `tag` channelRef + one `param` channelRef per entry.

    channelId (URL segment): the tag ref uses `serial`, each param ref uses its
    absolute path (leading `/` stripped + quoted by BridgeClient.put_channel).
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
    for abs_path in entries:
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
    resolved = [_resolve(e, upstream.path()) for e in entries]
    fingerprint = _fingerprint(resolved, upstream.path())

    if _FINGERPRINTS.get(serial) != fingerprint:
        register_channels(client, resolved, upstream.path(), hip, tag_path, serial)
        _FINGERPRINTS[serial] = fingerprint
    else:
        heartbeat(client, serial, upstream.path(), fingerprint)

    _set_status(subnet, "ok" if not client.last_error else "offline")
