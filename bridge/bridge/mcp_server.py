"""Cyl1nder bridge MCP (stdio).

Run:  python -m bridge.mcp_server
Codex config example (config.toml):
  [mcp_servers.cyl1nder]
  command = "C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe"
  args = ["D:\\code\\dev\\Cyl1nder\\bridge\\bridge\\mcp_server.py"]
"""
from __future__ import annotations

import re
from pathlib import Path

from fastmcp import FastMCP

from .protocol import VERSION
from .state import get_state

mcp = FastMCP("cyl1nder")

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _index_files() -> list[Path]:
    return [
        _REPO_ROOT / "devlog" / "FUNCTION_INDEX.md",
        _REPO_ROOT / "devlog" / "API_INDEX.md",
    ]


@mcp.tool()
def cyl1nder_ping() -> dict:
    """Bridge liveness + version + serial count."""
    st = get_state()
    return {"ok": True, "version": VERSION, "serials": len(st.registry.serials())}


@mcp.tool()
def cyl1nder_list_serials() -> list[str]:
    """List all registered HDA serials."""
    return get_state().registry.serials()


@mcp.tool()
def cyl1nder_get_status(serial: str) -> dict:
    """Registry record + workspace summary for one serial."""
    st = get_state()
    rec = st.registry.get(serial)
    return {
        "serial": serial,
        "registry": rec.to_dict() if rec is not None else None,
        "workspace": st.workspaces.status(serial),
    }


@mcp.tool()
def cyl1nder_read_logs(serial: str | None = None, level: str | None = None, limit: int = 200) -> list[dict]:
    """Read bridge logs; optionally filter by serial and minimum level."""
    return get_state().logs.query(level=level, limit=limit, serial=serial)


@mcp.tool()
def cyl1nder_get_errors(serial: str | None = None, limit: int = 100) -> list[dict]:
    """Read error-level logs (what went wrong for the user)."""
    return get_state().logs.errors(serial=serial, limit=limit)


@mcp.tool()
def cyl1nder_get_geometry_summary(serial: str, io: str = "inputs") -> dict:
    """Per-index geometry summary of inputs or outputs for a serial."""
    st = get_state()
    ws = st.workspaces.get_or_create(serial)
    summary = ws.to_summary()
    key = io if io in ("inputs", "outputs") else "inputs"
    return {"serial": serial, key: summary[key]}


@mcp.tool()
def cyl1nder_index_query(query: str, limit: int = 40) -> dict:
    """Search the generated code index (devlog/FUNCTION_INDEX.md, API_INDEX.md)."""
    pattern = re.compile(re.escape(query), re.IGNORECASE)
    hits: list[dict] = []
    for path in _index_files():
        if not path.exists():
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if pattern.search(line):
                hits.append(
                    {
                        "file": str(path.relative_to(_REPO_ROOT)),
                        "line": lineno,
                        "text": line.strip()[:200],
                    }
                )
                if len(hits) >= limit:
                    break
        if len(hits) >= limit:
            break
    return {"query": query, "hits": hits}


def run_stdio() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    run_stdio()
