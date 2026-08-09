"""Launcher for the Houdini MCP server (oculairmedia/houdini-mcp fork, local copy).

Codex config.toml currently points at:
    C:\\Users\\Administrator\\Documents\\Codex\\run_houdini_mcp.py
This repo keeps the same file under mcp/ and the installer copies it there.

Houdini side: start the RPC listener once (shelf "Start Remote" or):
    import hrpyc; hrpyc.start_server(port=18811)
"""
import os
import sys

REPO = r"C:\Users\Administrator\Documents\Codex\tools\houdini-mcp-codex-windows-stdio-fixes"
if REPO not in sys.path:
    sys.path.insert(0, REPO)

os.environ["MCP_TRANSPORT"] = "stdio"
os.environ.setdefault("HOUDINI_HOST", "127.0.0.1")
os.environ.setdefault("HOUDINI_PORT", "18811")

from houdini_mcp.server import run_server  # noqa: E402

run_server(transport="stdio")