# Cyl1nder 桥 MCP —— nodeview（节点网络视图）API 实现报告

> 日期：2026-08-11 · 角色：实现子智能体 · 仓库：`D:\code\dev\Cyl1nder`
> 目标：给桥 MCP（`bridge/bridge/mcp_server.py`，FastMCP stdio）新增 nodeview 类工具，并完善 nodeview 调试能力。

## 0. 结论（3 行）

1. **工具**：新增 4 个 nodeview MCP 工具 —— `cyl1nder_nodeview_nodes` / `cyl1nder_nodeview_connections` / `cyl1nder_nodeview_status` / `cyl1nder_nodeview_connected`（全部读取磁盘快照 `scene/node-graph.json`，schemaVersion 2，不依赖 web 在线；无快照返回 null）。
2. **测试**：全部通过 —— `py_compile` OK，pytest 19 passed；用真实 serial（`C1-msm6dsp7-ob6t` 5 节点/11 连接、`C1-msnd1p81-68mp` 2 节点/4 连接）验证 4 个工具输出正确，无快照 serial（`C1-msnev4xg-h46l`）正确返回 null；桥已重启至 v0.1.00035。
3. **数据源**：`snapshot_root(registry[serial].hip)/scene/node-graph.json`，经 `bridge/bridge/snapshot.py::read_snapshot(hip, serial)` 读取（`snapshot_root` 由 registry 的 hip 推导；`_read_graph` 复用现有 `read_snapshot`，无任何新依赖）。

## 1. 调研结论（改动前）

- 现有 MCP 工具：`cyl1nder_ping` / `cyl1nder_list_serials` / `cyl1nder_get_status` / `cyl1nder_read_snapshot` / `cyl1nder_read_layout` / `cyl1nder_read_logs` / `cyl1nder_get_errors` / `cyl1nder_get_geometry_summary` / `cyl1nder_index_query`。
- **nodeview 类 API 不存在**（无 nodes/connections/status/connected 相关工具）；`cyl1nder_read_snapshot` 只给 graph 的节点/连接计数摘要。
- node-graph schema（`devlog/scene-snapshot-research.md`，schemaVersion 2）：
  - `nodes[]: {id, kind, label, baseLabel, flags{display,bypass,freeze,reference,wireframe}, x, y}`
  - `connections[]: {source, sourceOutput, target, targetInput}`
  - `viewport: {k, x, y}`
- 快照路径：`snapshot_root(registry[serial].hip)/scene/node-graph.json`，读取复用 `bridge/bridge/snapshot.py::read_snapshot`。

## 2. 改动文件清单

| 文件 | 改动 | 字节数（改动后） |
|---|---|---|
| `bridge/bridge/mcp_server.py` | +nodeview 帮助函数 `_read_graph`/`_node_map` + 4 个工具（中文 docstring） | 8932 |
| `bridge/tests/test_mcp.py` | 导入 4 工具；新增无快照→None、写快照后 nodes/connections/status/connected 断言 | 2858 |
| `scripts/cyl_debug.py` | +`nodeview <serial>` 子命令（`_registry_hip`/`_nodeview_root`/`nodeview`），用法 docstring 更新 | 7341 |
| `devlog/API_INDEX.md` | 重新生成（`node scripts/gen-api-index.mjs`），收录 4 个新工具 | 1707 |

（工作区另有 `web/src/nodes2/*` 等未提交改动，属改动前已存在，本次未触碰。）

### 新增工具说明（面向 agent，中文）

- `cyl1nder_nodeview_nodes(serial)` → `list[{id,kind,label,baseLabel,flags,x,y}]`，无快照 `null`
- `cyl1nder_nodeview_connections(serial)` → `list[{source,sourceOutput,target,targetInput,sourceLabel,targetLabel}]`（label 按 nodes 解析，缺失 id 为 `null`），无快照 `null`
- `cyl1nder_nodeview_status(serial)` → `{serial,schemaVersion,nodeCount,connectionCount,viewport,displayNodes,nodes:[{id,label,flags}]}`，无快照 `null`
- `cyl1nder_nodeview_connected(serial, nodeId)` → `{serial,nodeId,node,predecessors,successors}`（连入它的=predecessors，它连出的=successors，均带 label），无快照 `null`

## 3. 验证

- `python -m py_compile`（bridge venv Python 3.12）：mcp_server.py / cyl_debug.py / test_mcp.py 全部 OK。
- `pytest tests -q`：**19 passed**（含新增 nodeview 断言）。
- 桥重启：`python hda/scripts/bridge_control.py restart`（隐藏窗口）→ bridge OK **v0.1.00035**（此前运行的是 00034，已对齐磁盘代码），serials=58。

### 3.1 真实数据测试输出

测试 serial：`C1-msm6dsp7-ob6t`（数据源 `D:\Animation_Project\Houdini\Test\Cyl1nder\dev\beginTest-1\Cyl1nder\C1-msm6dsp7-ob6t\scene\node-graph.json`）

**cyl1nder_nodeview_nodes**（5 节点，摘录 2 个）：
```json
[{"id":"0c22ae09f50faaa4","kind":"input","label":"_input_","baseLabel":"_input_","flags":{"display":false,"bypass":false,"freeze":false,"reference":false,"wireframe":false},"x":571.404393707361,"y":46.34671760820129},
 {"id":"fbd7312646ec05f4","kind":"null","label":"null1","baseLabel":"null","flags":{"display":true,...},"x":1047.45,"y":58.73}, ...]
```

**cyl1nder_nodeview_connections**（11 条，摘录 2 条，含 label 解析）：
```json
[{"source":"0c22ae09f50faaa4","sourceOutput":"in1","target":"fbd7312646ec05f4","targetInput":"in0","sourceLabel":"_input_","targetLabel":"null1"},
 {"source":"fbd7312646ec05f4","sourceOutput":"out0","target":"92c49c6bf646b612","targetInput":"out1","sourceLabel":"null1","targetLabel":"_output_"}, ...]
```

**cyl1nder_nodeview_status**：
```json
{"serial":"C1-msm6dsp7-ob6t","schemaVersion":2,"nodeCount":5,"connectionCount":11,
 "viewport":{"k":0.8333545180461743,"x":-468.1709228515631,"y":99.69754333496086},
 "displayNodes":["fbd7312646ec05f4","883fb4b4ea8aba1d"], "nodes":[{"id":"...","label":"...","flags":{...}}, ...]}
```

**cyl1nder_nodeview_connected('0c22ae09f50faaa4')**（input 节点，无前驱、4 条后继）：
```json
{"serial":"C1-msm6dsp7-ob6t","nodeId":"0c22ae09f50faaa4","node":{...},
 "predecessors":[],
 "successors":[{"source":"0c22ae09f50faaa4","sourceOutput":"in0","target":"92c49c6bf646b612","targetInput":"out0","targetLabel":"_output_"},
               {"source":"0c22ae09f50faaa4","sourceOutput":"in1","target":"fbd7312646ec05f4","targetInput":"in0","targetLabel":"null1"}, ...]}
```

**无快照（null）验证** `C1-msnev4xg-h46l`：4 个工具均返回 `null`。

### 3.2 cyl_debug.py nodeview 子命令输出（同一真实数据）

```
C1-msm6dsp7-ob6t: nodeview v2 | 5 nodes / 11 conns
  viewport: k=0.8333545180461743 x=-468.1709228515631 y=99.69754333496086 | display=['fbd7312646ec05f4', '883fb4b4ea8aba1d']
  - 0c22ae09f50faaa4   input    _input_ @(571.4,46.3)
  - 92c49c6bf646b612   output   _output_ @(1876.5,155.9)
  - fbd7312646ec05f4   null     null1 @(1047.5,58.7) [D]
  - 4cfcb01908c639c5   null     null2 @(1067.5,277.2)
  - 883fb4b4ea8aba1d   null     null3 @(1064.4,438.4) [D]
```
（`[D]` = display flag；`C1-msnev4xg-h46l` → `no scene/node-graph.json (root=...)`）

## 4. 备注

- 数据完全来自磁盘快照，桥/web 在线与否不影响读取；无快照（或 graph part 缺失）返回 `null`（FastMCP 序列化为 JSON null）。
- connections 引用了不在 nodes 列表中的 id 时（如旧快照残留 `054e24967ba32c8d` 等），`sourceLabel`/`targetLabel` 置 `null`，不报错。
- 桥已用 `bridge_control.py restart` 重启至 v0.1.00035；MCP stdio 服务器下次由客户端拉起时即包含新工具。
