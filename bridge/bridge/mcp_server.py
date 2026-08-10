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
from .snapshot import read_snapshot, snapshot_root
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
def cyl1nder_read_snapshot(serial: str) -> dict:
    """Debug: unified path system - snapshot summary + parts (io/scene/docking-layout)."""
    st = get_state()
    rec = st.registry.get(serial)
    hip = rec.hip if rec else ""
    snap = read_snapshot(hip, serial)
    if not snap:
        return {"serial": serial, "snapshot": None, "root": str(snapshot_root(hip, serial))}
    summary = {
        "parts": list(snap.keys()),
        "inputs": len(snap.get("inputs", [])),
        "outputs": len(snap.get("outputs", [])),
        "graphNodes": len(snap.get("graph", {}).get("nodes", [])) if snap.get("graph") else 0,
        "graphConns": len(snap.get("graph", {}).get("connections", [])) if snap.get("graph") else 0,
        "hasDocking": "docking" in snap,
        "root": str(snapshot_root(hip, serial)),
    }
    return {"serial": serial, "summary": summary}


# ---- nodeview: 节点网络视图（读取快照 scene/node-graph.json，不依赖 web 在线）----


def _read_graph(serial: str) -> dict | None:
    """读取某 serial 的节点图快照（schemaVersion 2），无快照返回 None。"""
    st = get_state()
    rec = st.registry.get(serial)
    hip = rec.hip if rec else ""
    snap = read_snapshot(hip, serial)
    if not snap:
        return None
    graph = snap.get("graph")
    return graph if isinstance(graph, dict) else None


def _node_map(graph: dict) -> dict[str, dict]:
    return {n.get("id"): n for n in graph.get("nodes", []) if isinstance(n, dict) and n.get("id")}


@mcp.tool()
def cyl1nder_nodeview_nodes(serial: str) -> list[dict] | None:
    """节点网络：列出该 serial 节点图的所有节点（id/kind/label/baseLabel/flags/x/y）。无快照返回 null。"""
    graph = _read_graph(serial)
    if graph is None:
        return None
    return graph.get("nodes", [])


@mcp.tool()
def cyl1nder_nodeview_connections(serial: str) -> list[dict] | None:
    """节点网络：列出该 serial 节点图的所有连接（source/sourceOutput/target/targetInput），并附 sourceLabel/targetLabel。无快照返回 null。"""
    graph = _read_graph(serial)
    if graph is None:
        return None
    nodes = _node_map(graph)
    out: list[dict] = []
    for c in graph.get("connections", []):
        if not isinstance(c, dict):
            continue
        row = dict(c)
        src = nodes.get(c.get("source"))
        tgt = nodes.get(c.get("target"))
        row["sourceLabel"] = src.get("label") if src else None
        row["targetLabel"] = tgt.get("label") if tgt else None
        out.append(row)
    return out


@mcp.tool()
def cyl1nder_nodeview_status(serial: str) -> dict | None:
    """节点网络：摘要（节点数/连接数/viewport transform/每节点 flags，尤其 display 节点）。无快照返回 null。"""
    graph = _read_graph(serial)
    if graph is None:
        return None
    nodes = graph.get("nodes", [])
    flags_by_node: list[dict] = []
    display_ids: list[str] = []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        f = n.get("flags") or {}
        flags_by_node.append({"id": n.get("id"), "label": n.get("label"), "flags": f})
        if f.get("display"):
            display_ids.append(n.get("id"))
    return {
        "serial": serial,
        "schemaVersion": graph.get("schemaVersion"),
        "nodeCount": len(nodes),
        "connectionCount": len(graph.get("connections", [])),
        "viewport": graph.get("viewport") or {},
        "displayNodes": display_ids,
        "nodes": flags_by_node,
    }


@mcp.tool()
def cyl1nder_nodeview_connected(serial: str, nodeId: str) -> dict | None:
    """节点网络：某节点的前驱/后继连接（谁连到它、它连到哪里），带 label 解析。无快照返回 null。"""
    graph = _read_graph(serial)
    if graph is None:
        return None
    nodes = _node_map(graph)
    preds: list[dict] = []
    succs: list[dict] = []
    for c in graph.get("connections", []):
        if not isinstance(c, dict):
            continue
        if c.get("target") == nodeId:
            row = dict(c)
            src = nodes.get(c.get("source"))
            row["sourceLabel"] = src.get("label") if src else None
            preds.append(row)
        elif c.get("source") == nodeId:
            row = dict(c)
            tgt = nodes.get(c.get("target"))
            row["targetLabel"] = tgt.get("label") if tgt else None
            succs.append(row)
    return {
        "serial": serial,
        "nodeId": nodeId,
        "node": nodes.get(nodeId),
        "predecessors": preds,
        "successors": succs,
    }


@mcp.tool()
def cyl1nder_read_layout() -> dict:
    """Debug: current docking layout (docking-layout.json from the bridge file)."""
    from .ui_layout import UiLayoutStore
    store = UiLayoutStore(_REPO_ROOT / "bridge" / "data" / "ui-layout.json")
    data = store.read()
    if not data:
        return {"layout": None, "note": "no ui-layout.json - programmatic Desk1 in use"}
    grid = data.get("grid", {})
    leaves: list[str] = []

    def walk(n):
        if not isinstance(n, dict):
            return
        if n.get("type") == "leaf":
            leaves.append(",".join(n.get("data", {}).get("views", [])))
        for c in n.get("data", []) or []:
            walk(c)

    walk(grid.get("root"))
    return {"groups": leaves, "width": grid.get("width"), "height": grid.get("height")}


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
