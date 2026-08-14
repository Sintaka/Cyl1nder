"""fxhoudinimcp discovery + frame helpers for the Cyl1nder HDA.

Pure stdlib (urllib / json / time / threading) and NEVER imports hou, so every
function here is safe to call from a background thread. The HDA cook (main
thread) calls start_discovery() with this process's pid + hip path; the
discovery runs on a SHORT-LIVED daemon thread that only does urllib HTTP and
compares against the pid/hip values the main thread passed in - it never
touches hou (HDA crash red line).

fxhoudinimcp runs inside the Houdini process (hwebserver) and speaks a JSON
RPC over POST http://127.0.0.1:{port}/api with a urlencoded body:

    json={"json": json.dumps([<method>, <params>, <extra>])}

The ONLY reliable way to know a port belongs to THIS Houdini instance is that
mcp.health returns pid == the pid passed in (os.getpid() of the HDA process ==
the Houdini process), with hip_file compared to hou.hipFile.name() (full
absolute path in 22.0.368) as a secondary confirmation.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.parse
import urllib.request

# Official fxhoudinimcp default port is 8100 and auto-increments when taken;
# the official scanner covers 8100..8115.
DEFAULT_START = 8100
DEFAULT_END = 8115

# Module-level discovery cache. `thread` holds the single short-lived daemon
# discovery thread; every field is read/written under _DISC_LOCK.
_DISC = {"port": 0, "reported": False, "last_try": 0.0, "thread": None}
_DISC_LOCK = threading.Lock()

# Monotonic request_id counter (thread-safe; no hou, no os needed).
_RID_LOCK = threading.Lock()
_RID_SEQ = 0


def _rid() -> str:
    global _RID_SEQ
    with _RID_LOCK:
        _RID_SEQ += 1
        seq = _RID_SEQ
    return f"cyl1nder-{int(time.time() * 1000)}-{seq}"


def _norm_hip(value: str) -> str:
    """Normalize a hip path for comparison: strip, forward slashes, lowercase."""
    return value.strip().replace("\\", "/").lower()


def _post_rpc(port: int, rpc: list, timeout: float):
    """POST one JSON-RPC call; returns the parsed body, raises on any error."""
    body = urllib.parse.urlencode({"json": json.dumps(rpc)}).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{int(port)}/api",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=float(timeout)) as resp:
        return json.loads(resp.read().decode("utf-8"))


def probe(port: int, timeout: float = 0.5) -> dict | None:
    """POST mcp.health; returns {"pid": int, "hip_file": str} or None.

    Any exception (connection refused, timeout, non-JSON, missing pid) maps to
    None - the caller treats that as "not this instance's port".
    """
    try:
        data = _post_rpc(int(port), ["mcp.health", [], {}], timeout)
        if not isinstance(data, dict):
            return None
        pid = data.get("pid")
        if pid is None:
            return None
        return {"pid": int(pid), "hip_file": str(data.get("hip_file") or "")}
    except Exception:  # noqa: BLE001 - any probe error -> not this instance
        return None


def discover_port(
    expected_pid: int,
    expected_hip: str = "",
    start: int = DEFAULT_START,
    end: int = DEFAULT_END,
    timeout: float = 0.5,
) -> int:
    """Scan ports in order; return the first whose health pid matches, else 0.

    pid is the primary (unique) gate: the HDA process IS the Houdini process, so
    a matching health pid identifies this instance. When expected_hip is
    non-empty AND the health hip_file is non-empty AND the two differ after
    normalization (forward slash, case, strip), the port is skipped as a
    secondary confirmation (an unsaved hip leaves one/both empty -> pid only).
    """
    try:
        expected_pid = int(expected_pid)
        exp_hip = _norm_hip(expected_hip) if expected_hip else ""
        for port in range(int(start), int(end) + 1):
            health = probe(port, timeout=timeout)
            if health is None:
                continue
            if int(health["pid"]) != expected_pid:
                continue
            got_hip = _norm_hip(health["hip_file"]) if health["hip_file"] else ""
            if exp_hip and got_hip and exp_hip != got_hip:
                continue
            return port
        return 0
    except Exception:  # noqa: BLE001
        return 0


def get_frame(port: int, timeout: float = 1.0) -> tuple[float, float] | None:
    """mcp.execute animation.get_frame -> (frame, fps) or None.

    DEADLOCK CAVEAT: never call this from Houdini's MAIN thread (cook) - the
    MCP dispatcher executes handlers on the main thread via hdefereval, so a
    synchronous main-thread call waits for a response only the main thread can
    produce (hangs until timeout). Safe from the bridge process or the HDA's
    background threads (which must remain hou-free).
    """
    try:
        data = _post_rpc(
            int(port),
            [
                "mcp.execute",
                [],
                {
                    "command": "animation.get_frame",
                    "params": {},
                    "request_id": _rid(),
                },
            ],
            timeout,
        )
        if not isinstance(data, dict):
            return None
        d = data.get("data")
        if not isinstance(d, dict) or "frame" not in d or "fps" not in d:
            return None
        return float(d["frame"]), float(d["fps"])
    except Exception:  # noqa: BLE001
        return None


def set_frame(port: int, frame: float, timeout: float = 2.0) -> dict | None:
    """mcp.execute animation.set_frame -> data dict or None.

    Reserved for later use; the current HDA cook does not drive Houdini's frame
    (web is the sync gate source of truth). SAME DEADLOCK CAVEAT as get_frame:
    never call from the main thread.
    """
    try:
        data = _post_rpc(
            int(port),
            [
                "mcp.execute",
                [],
                {
                    "command": "animation.set_frame",
                    "params": {"frame": float(frame)},
                    "request_id": _rid(),
                },
            ],
            timeout,
        )
        if not isinstance(data, dict):
            return None
        d = data.get("data")
        return d if isinstance(d, dict) else None
    except Exception:  # noqa: BLE001
        return None


def _discover_worker(expected_pid: int, expected_hip: str, on_found=None) -> None:
    """Short-lived daemon body: run discover_port, write the result back.

    urllib-only (probe/discover_port never import or touch hou); the pid is the
    value the cook main thread passed in, so nothing HOM-related is evaluated
    here. on_found(port) (pure-stdlib callback, e.g. BridgeClient.report) runs
    on THIS thread right after a successful discovery so the bridge learns the
    port without waiting for the next cook.
    """
    try:
        port = discover_port(expected_pid, expected_hip)
        with _DISC_LOCK:
            _DISC["port"] = int(port)
            _DISC["thread"] = None
        if port and on_found is not None:
            try:
                on_found(int(port))
            except Exception:  # noqa: BLE001 - report failure must not matter here
                pass
    except Exception:  # noqa: BLE001
        with _DISC_LOCK:
            _DISC["thread"] = None


def start_discovery(
    expected_pid: int,
    expected_hip: str = "",
    min_interval: float = 30.0,
    on_found=None,
) -> None:
    """Start ONE short-lived daemon discovery thread. Never raises.

    No-op when a discovery thread is still alive or within min_interval of the
    last attempt. The caller (HDA cook, main thread) supplies pid + hip; the
    thread itself only does urllib HTTP. on_found (optional, called from the
    discovery thread) must itself be pure stdlib / thread-safe - the HDA passes
    a BridgeClient report closure.
    """
    try:
        now = time.time()
        with _DISC_LOCK:
            th = _DISC["thread"]
            if th is not None and th.is_alive():
                return
            if now - _DISC["last_try"] < min_interval:
                return
            _DISC["last_try"] = now
        th = threading.Thread(
            target=_discover_worker,
            args=(int(expected_pid), str(expected_hip or ""), on_found),
            daemon=True,
        )
        with _DISC_LOCK:
            _DISC["thread"] = th
        th.start()
    except Exception:  # noqa: BLE001 - discovery must never break the cook
        pass


def known_port() -> int:
    """Last discovered port (0 = not yet found)."""
    try:
        with _DISC_LOCK:
            return int(_DISC["port"])
    except Exception:  # noqa: BLE001
        return 0


def mark_reported() -> None:
    try:
        with _DISC_LOCK:
            _DISC["reported"] = True
    except Exception:  # noqa: BLE001
        pass


def is_reported() -> bool:
    try:
        with _DISC_LOCK:
            return bool(_DISC["reported"])
    except Exception:  # noqa: BLE001
        return False


def reset_report() -> None:
    try:
        with _DISC_LOCK:
            _DISC["reported"] = False
    except Exception:  # noqa: BLE001
        pass
