"""fxhoudinimcp external MCP bridge (stdio).

Proxies Codex MCP calls to the in-Houdini fxhoudinimcp HTTP server.
Default port 8100; if occupied by another Houdini instance, fxhoudinimcp
starts on 8101 - this bridge probes both and uses whichever answers mcp.health.

Dynamically registers one MCP tool per fxhoudinimcp command (188+ commands)
plus houdini_health / houdini_commands / houdini_execute meta tools.

config.toml:
  [mcp_servers.houdini]
  type = "stdio"
  command = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe'
  args = ['D:\\code\\dev\\Cyl1nder\\mcp\\fxhoudinimcp_bridge.py']
  startup_timeout_sec = 30
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

from fastmcp import FastMCP

PORTS = [int(os.environ.get("FXHOUDINIMCP_PORT", "8100")), 8101]
TIMEOUT = 60
_port: int | None = None


def _rpc(port: int, method: str, params: dict | None = None) -> dict:
    body = urllib.parse.urlencode(
        {"json": json.dumps([f"mcp.{method}", [], params or {}])}
    ).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/api",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _discover_port() -> int | None:
    global _port
    if _port is not None:
        return _port
    for port in PORTS:
        try:
            h = _rpc(port, "health")
            if h.get("status") == "ok":
                _port = port
                return port
        except Exception:  # noqa: BLE001
            continue
    return None


def _execute(command: str, params: dict | None = None) -> dict:
    port = _discover_port()
    if port is None:
        return {
            "status": "error",
            "error": {"code": "UNREACHABLE", "message": f"fxhoudinimcp not reachable on {PORTS}"},
        }
    return _rpc(port, "execute", {"command": command, "params": params or {}, "request_id": "codex"})


mcp = FastMCP("fxhoudinimcp")


@mcp.tool()
def houdini_health() -> dict:
    """fxhoudinimcp health (Houdini version / pid / hip file)."""
    port = _discover_port()
    if port is None:
        return {"status": "error", "message": f"fxhoudinimcp not reachable on {PORTS}"}
    return _rpc(port, "health")


@mcp.tool()
def houdini_commands() -> list[str]:
    """List all fxhoudinimcp commands."""
    port = _discover_port()
    if port is None:
        return []
    return _rpc(port, "list_commands").get("commands", [])


@mcp.tool()
def houdini_execute(command: str, params: dict | None = None) -> dict:
    """Execute any fxhoudinimcp command (dotted name, e.g. code.execute_python) with a params dict."""
    return _execute(command, params)


def _tool_name(command: str) -> str:
    return "houdini_" + command.replace(".", "_")


def _register_commands() -> None:
    port = _discover_port()
    if port is None:
        return
    try:
        commands = _rpc(port, "list_commands").get("commands", [])
    except Exception:  # noqa: BLE001
        return

    def make_handler(command: str):
        def handler(params: dict | None = None) -> dict:
            return _execute(command, params)

        handler.__name__ = _tool_name(command)
        return handler

    for command in commands:
        name = _tool_name(command)
        fn = make_handler(command)
        fn.__doc__ = f"fxhoudinimcp command: {command}"
        mcp.add_tool(fn)


_register_commands()

if __name__ == "__main__":
    mcp.run(transport="stdio")