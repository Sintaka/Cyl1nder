"""HTTP RPC client for the official fxhoudinimcp (Houdini MCP) plugin.

fxhoudinimcp runs an HTTP RPC server inside the Houdini process (hwebserver).
The wire format is a form-urlencoded POST to /api whose `json` field holds a
JSON array ["mcp.execute", [], {"command", "params", "request_id"}]. Responses
are plain JSON dicts:
    {"status": "success", "data": {...}, "request_id": ...}
    {"status": "error", "error": {"code", "message", "traceback"}, ...}
The health probe is ["mcp.health", [], {}] and returns directly (no wrapper):
    {"status": "ok", "houdini_version": ..., "hip_file": ..., "pid": ...}

Pure stdlib (urllib) on purpose: this module is the bridge's only talker to
Houdini and must not drag in extra dependencies (see devlog/houdini-mcp-integration.md).
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.parse
import urllib.request

# Namespaces exposed by the fxhoudinimcp command registry. The exact handler
# list lives under fxhoudinimcp_server/handlers/*.py (register_handler("ns.fn")).
ALLOWED_COMMAND_PREFIXES = (
    "animation.",
    "code.",
    "context.",
    "geometry.",
    "graph.",
    "help.",
    "hda.",
    "lops.",
    "materials.",
    "nodes.",
    "parameters.",
    "rendering.",
    "scene.",
    "takes.",
    "tops.",
    "vex.",
    "viewport.",
    "workflow.",
    "cache.",
    "chops.",
    "dops.",
    "cops.",
    "mcp.",
)

_request_seq = 0
_request_seq_lock = threading.Lock()


class HoudiniMcpError(Exception):
    """Raised on transport / protocol failures talking to fxhoudinimcp."""


def _request_id() -> str:
    global _request_seq
    with _request_seq_lock:
        _request_seq += 1
        seq = _request_seq
    return f"{os.getpid()}-{time.time_ns()}-{seq}"


def _decode_bytes(raw: bytes) -> str:
    """Tolerantly decode a response body: strip a UTF-8 BOM, then fall back to
    latin-1 (never raises) so a stray non-UTF-8 byte doesn't kill the parse."""
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    for enc in ("utf-8", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _post(port: int, json_payload: list, timeout: float) -> dict:
    url = f"http://127.0.0.1:{port}/api"
    body = urllib.parse.urlencode({"json": json.dumps(json_payload)})
    req = urllib.request.Request(
        url,
        data=body.encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except Exception as exc:  # network error or non-200 HTTP status
        raise HoudiniMcpError(str(exc)) from exc
    text = _decode_bytes(raw)
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise HoudiniMcpError(f"invalid JSON from houdini mcp: {exc}") from exc
    if not isinstance(data, dict):
        raise HoudiniMcpError(f"unexpected houdini mcp response: {data!r}")
    return data


def rpc(port: int, command: str, params: dict | None = None, timeout: float = 8.0) -> dict:
    """POST one mcp.execute command; returns the parsed response dict
    (with "status" and "data"/"error"). Raises HoudiniMcpError on transport
    or non-200 errors."""
    payload = [
        "mcp.execute",
        [],
        {"command": command, "params": params or {}, "request_id": _request_id()},
    ]
    return _post(port, payload, timeout)


def health(port: int, timeout: float = 1.0) -> dict | None:
    """mcp.health probe; returns the raw health dict or None on any failure."""
    try:
        return _post(port, ["mcp.health", [], {}], timeout)
    except Exception:
        return None


def discover_first(start: int = 8100, end: int = 8115, timeout: float = 0.5) -> int | None:
    """Scan [start, end] and return the first port whose health probe passes."""
    for port in range(start, end + 1):
        if health(port, timeout) is not None:
            return port
    return None


def normalize_hip(hip_file: str | None) -> str:
    """Normalize a hip path for comparison: strip quotes, forward slashes, casefold."""
    if not hip_file:
        return ""
    s = str(hip_file).strip().strip("\"'")
    s = s.replace("\\", "/")
    return s.casefold()


def discover_by_hip(hip_file: str, start: int = 8100, end: int = 8115, timeout: float = 0.5) -> int | None:
    """Scan [start, end] for a health probe whose hip_file normalizes to hip_file.

    Empty hip_file degrades to discover_first."""
    norm = normalize_hip(hip_file)
    if not norm:
        return discover_first(start, end, timeout)
    for port in range(start, end + 1):
        h = health(port, timeout)
        if h is None:
            continue
        if normalize_hip(h.get("hip_file", "")) == norm:
            return port
    return None


def _unwrap(data: dict) -> dict:
    """Raise on a status=="error" MCP response, else return the "data" part."""
    if data.get("status") == "error":
        raise HoudiniMcpError(str(data.get("error")))
    d = data.get("data")
    return d if isinstance(d, dict) else data


def set_frame(port: int, frame: float) -> dict:
    return _unwrap(rpc(port, "animation.set_frame", {"frame": float(frame)}))


def get_frame(port: int) -> dict:
    return _unwrap(rpc(port, "animation.get_frame"))


def execute_python(port: int, code: str, return_expression: str | None = None) -> dict:
    params: dict = {"code": code}
    if return_expression is not None:
        params["return_expression"] = return_expression
    return _unwrap(rpc(port, "code.execute_python", params))


def is_command_allowed(command: str) -> bool:
    """True when command is a non-empty str under an allow-listed namespace."""
    if not isinstance(command, str) or not command:
        return False
    return command.startswith(ALLOWED_COMMAND_PREFIXES)
