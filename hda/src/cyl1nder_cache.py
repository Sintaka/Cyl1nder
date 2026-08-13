"""Per-serial caches + ready buffer for the Cyl1nder HDA (3.1 split)."""
from __future__ import annotations

import threading

from cyl1nder_bridge import BridgeClient

_CORE_CACHE: dict[str, dict] = {}
_OUT_CACHE: dict[str, dict] = {}
_OUT_LOCK = threading.Lock()
_READY: dict[str, dict] = {}
_READY_LOCK = threading.Lock()
_STATS: dict[str, dict] = {}
_GEO_CACHE: dict[tuple[str, int], dict] = {}
_PUSH_CACHE: dict[str, tuple] = {}


def _ready_state(serial: str) -> dict:
    """Get (or create) the serial's ready-buffer state."""
    with _READY_LOCK:
        st = _READY.get(serial)
        if st is None:
            st = {"rev": 0, "outputs": {}, "gen": 0, "error": ""}
            _READY[serial] = st
        return st


def _refresh_ready(client: BridgeClient, serial: str) -> None:
    """Background pull: refresh the ready buffer with outputs newer than its rev.

    Runs on the sync thread, never on the cook main thread. Only the changed
    roles' latest buffers are fetched (since=<ready rev>) and merged
    (latest-wins). The buffer stays valid until the next input change / close.
    """
    st = _ready_state(serial)
    with _READY_LOCK:
        since = st["rev"]
    outputs, new_rev = client.pull_outputs(since)
    with _READY_LOCK:
        if outputs is None:
            st["error"] = client.last_error or "pull failed"
            return
        st["error"] = ""
        if outputs:
            st["gen"] += 1
            for b in outputs:
                idx = int(b.get("index", -1))
                if idx >= 0:
                    b = dict(b)
                    b["_gen"] = st["gen"]  # cook skips identical buffers via this tag
                    st["outputs"][idx] = b
        st["rev"] = max(st["rev"], new_rev)


def _reset_ready(serial: str) -> None:
    """Bridge restart (rev went backwards): drop the ready buffer, re-pull from 0."""
    with _READY_LOCK:
        st = _READY.get(serial)
        if st is not None:
            st["rev"] = 0
            st["outputs"] = {}
            st["gen"] += 1


def _reset_caches(serial: str) -> None:
    """Bridge restart: drop this serial's push/content caches.

    The bridge workspace was rebuilt empty, so the next recook must re-push the
    inputs (push cache gone) and must not reuse stale output topology/geometry
    (geo/core/out caches gone). Runs on the sync thread before the recook is
    scheduled; like the rest of the module, the plain dicts mutate in place.
    """
    _PUSH_CACHE.pop(serial, None)  # -> recook re-pushes inputs into the fresh workspace
    _CORE_CACHE.pop(serial, None)  # stale merged-detail signature (old topology)
    _OUT_CACHE.pop(serial, None)   # legacy role output cache (old outputs)
    for key in [k for k in _GEO_CACHE if k[0] == serial]:
        _GEO_CACHE.pop(key, None)  # cached output geometry must not be reused


def _role_buffer(serial: str, bridge_url: str, role: int) -> dict | None:
    """Return this role's output buffer with ONE network pull per cook round.

    The first role to cook pulls all 4 buffers once and caches them; the other
    three reuse the cache. Content compare downstream decides rebuild.
    """
    with _OUT_LOCK:
        cached = _OUT_CACHE.get(serial)
        if cached is not None and role in cached["outputs"]:
            return cached["outputs"][role]
        client = BridgeClient(serial, bridge_url=bridge_url)
        outputs, new_rev = client.pull_outputs(0)
        if outputs is None:
            return None
        merged = {int(b.get("index", -1)): b for b in outputs if b.get("index") is not None}
        _OUT_CACHE[serial] = {"rev": new_rev, "outputs": merged}
        return merged.get(role)
