"""Cyl1nder bridge MCP (stdio).

Run:  python -m bridge.mcp_server
Codex config example (config.toml):
  [mcp_servers.cyl1nder]
  command = "C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe"
  args = ["D:\\code\\dev\\Cyl1nder\\bridge\\bridge\\mcp_server.py"]
"""
from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path

from fastmcp import FastMCP

from .protocol import PORT, VERSION
from .snapshot import read_project_graph, read_snapshot, snapshot_root
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
    """Bridge liveness + version + serial count —— **真的去问桥**（v0.1.00147）。

    此前这里读的是 **MCP 服务进程自己**的东西：`VERSION` 在模块加载时就绑定了，
    `get_state()` 也是本进程的状态。于是它既不报桥的版本、也不证明桥活着 ——
    而 docstring 承诺的正是 "Bridge liveness"。

    实测撞到：桥重启在 `v0.1.00144`、`protocol.py` 已是 `00146`，而本工具报 `0.1.00124`
    —— **第三个数字**，是 MCP 进程启动那一刻的常量，落后 22 个版本。
    我自己就被它误导过一次：用它得出"桥还活着"，之后不得不再打一次真 HTTP 才敢确认。

    **一个会说谎的诊断工具比没有诊断工具更坏**：它把排查引向错误的方向。
    现在打 `/api/health`：`version`/`serials` 一律取桥的响应，
    另附 `mcpVersion` 说明本进程自己是哪个版本（两者不一致时一眼看出该重启谁）。
    """
    url = f"http://127.0.0.1:{PORT}/api/health"
    try:
        with urllib.request.urlopen(url, timeout=2.0) as resp:  # noqa: S310 - 固定本机地址
            body = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - 桥不在是正常结论，不是异常
        return {"ok": False, "error": str(exc)[:200], "mcpVersion": VERSION}
    return {
        "ok": True,
        "version": body.get("version") or "",
        "serials": body.get("serials"),
        "mcpVersion": VERSION,
    }


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
    """读取某 serial 的节点图，无图返回 None。

    **两个来源，按新旧顺序（v0.1.00122）**：
    1. 该 serial 所属**项目**的 `graph.json` —— 成员图归项目所有之后，这才是权威位置；
    2. 旧存档里成员自己的 `scene/node-graph.json`（只读不写，仍兜底）。

    只读第 2 条的话，这四个 nodeview 工具在新工程上会**全部返回 null**（成员侧已经
    不再写图）；只读第 1 条则读不到既有存档。两条都要，顺序决定谁赢。
    """
    st = get_state()
    rec = st.registry.get(serial)
    hip = rec.hip if rec else ""
    # 1) 项目图：找包含该 serial 的项目，读它的 graph.json
    try:
        for proj in st.projects.list():
            members = proj.get("members") or []
            if not any((m or {}).get("serial") == serial for m in members):
                continue
            pg = read_project_graph(st.data_dir, proj.get("projectSerial") or "", proj.get("hip") or "")
            if isinstance(pg, dict) and pg.get("nodes"):
                return pg
    except Exception:  # noqa: BLE001 - 读不到项目图就退到旧存档，不该让工具整体失败
        pass
    # 2) 旧存档兜底
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


# ---- viewport / params: 视口显示模式 + 节点参数（读快照 docking/parm 部分，不依赖 web 在线）----


def _read_snapshot_data(serial: str) -> dict | None:
    """读取某 serial 的完整快照（复用 bridge/bridge/snapshot.py::read_snapshot），无快照返回 None。"""
    st = get_state()
    rec = st.registry.get(serial)
    hip = rec.hip if rec else ""
    return read_snapshot(hip, serial)


@mcp.tool()
def cyl1nder_viewport_settings(serial: str) -> dict | None:
    """视口显示模式：读取该 serial 快照 docking-layout.json 顶层的 displaySettings（如 {"mode":"flat-wire"}）。

    无快照 / 无 docking / 无 displaySettings 时返回 displaySettings=None 并附 note。
    """
    snap = _read_snapshot_data(serial)
    if not snap:
        return {"serial": serial, "displaySettings": None, "note": "无快照（snapshot_root 不存在或为空）"}
    docking = snap.get("docking")
    if not isinstance(docking, dict):
        return {"serial": serial, "displaySettings": None, "note": "快照无 docking 部分（docking-layout.json 缺失）"}
    ds = docking.get("displaySettings")
    if ds is None:
        return {"serial": serial, "displaySettings": None, "note": "docking-layout.json 顶层无 displaySettings"}
    return {"serial": serial, "displaySettings": ds}


@mcp.tool()
def cyl1nder_node_params(serial: str) -> dict | None:
    """节点参数：读取该 serial 快照 scene/node-parm.json（按节点路径/标签 key 的 dict）。

    无快照 / 无 parm 时返回 params=None 并附 note。
    """
    snap = _read_snapshot_data(serial)
    if not snap:
        return {"serial": serial, "params": None, "note": "无快照（snapshot_root 不存在或为空）"}
    parm = snap.get("parm")
    if not isinstance(parm, dict):
        return {"serial": serial, "params": None, "note": "快照无 parm 部分（scene/node-parm.json 缺失）"}
    return {"serial": serial, "params": parm}


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


def _bridge_get(path: str) -> object | None:
    """向桥发一个 GET，失败返回 None（v0.1.00148）。

    为什么日志类工具必须走 HTTP：`LogRing` 是纯内存 `deque`（无路径、不落盘），
    所以 `get_state().logs` 在 **MCP 服务进程**里**永远是空的** ——
    工具会返回 `[]` 而看起来像"桥没有日志"，与 `cyl1nder_ping` 是同一类谎报。
    registry/snapshot 类工具读磁盘，不受此影响，所以只改日志这两个。
    """
    try:
        with urllib.request.urlopen(  # noqa: S310 - 固定本机地址
            f"http://127.0.0.1:{PORT}{path}", timeout=3.0
        ) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:  # noqa: BLE001 - 桥不在是正常结论
        return None


@mcp.tool()
def cyl1nder_read_logs(serial: str | None = None, level: str | None = None, limit: int = 200) -> list[dict]:
    """Read bridge logs —— **真的去问桥**（v0.1.00148）。

    `LogRing` 是纯内存 deque，所以 `get_state().logs` 在本进程里永远是空的：
    旧实现恒返回 `[]`，看起来像"桥没有日志"。
    """
    q = f"?level={level or ''}&limit={int(limit)}"
    path = f"/api/hda/{serial}/logs{q}" if serial else f"/api/logs{q}"
    body = _bridge_get(path)
    # 形状是 `{"logs": [...]}` —— 三个端点实测都是这一种
    # （`/api/logs`、`/api/logs?level=error`、`/api/hda/{serial}/logs`）。
    # 初版还兜了个 `body.get("entries")`，那是**没验就猜**留下的死代码：多余的兜底会让
    # 读代码的人以为响应形状不确定，本会话我已经因为"猜形状"错了六次，不再添新的。
    if isinstance(body, dict):
        rows = body.get("logs")
        return rows if isinstance(rows, list) else []
    return []


@mcp.tool()
def cyl1nder_get_errors(serial: str | None = None, limit: int = 100) -> list[dict]:
    """Read error-level logs —— 同上，走 HTTP（v0.1.00148）。"""
    return cyl1nder_read_logs(serial=serial, level="error", limit=limit)


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
