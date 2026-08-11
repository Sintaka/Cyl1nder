# MCP 通道调研与落地提案

> 日期：2026-08-11 · 角色：实现子智能体 · 仓库：`D:\code\dev\Cyl1nder`
> 目标：为后续 agent 开发省时间——把本轮 web 开发中「必须开浏览器才能验证/读取」的状态落地成 MCP 工具（读磁盘快照，不依赖 web 在线）。参考 `devlog/nodeview-mcp-report.md` 的既有模式。

## 0. 结论（3 行）

1. **本轮落地 2 个工具**：`cyl1nder_viewport_settings`（读 docking-layout.json 顶层 `displaySettings`，视口显示模式）与 `cyl1nder_node_params`（读 scene/node-parm.json，Param 面板数据）；均复用 `bridge/bridge/snapshot.py::read_snapshot`，无新依赖。
2. **后续候选清单**：视口显示模式写、spreadsheet 行数据派生、节点选中态（未持久化）、布局 UI 状态读写等，见 §2 表格。
3. **验证**：`pytest tests -q` 全绿（19 → 20 passed，新增三态测试）；`node scripts/gen-api-index.mjs` 成功，API_INDEX.md 收录 2 个新工具。

## 1. 本轮开发痛点（背景）

- **视口显示模式**：layout 保存 JSON 现在带 `displaySettings: { mode }` 顶层字段；agent 想验证/设置视口显示模式必须开浏览器 → 需要 MCP 读通道。
- **Param 面板**：web 新增 Param 面板展示节点可输入属性；快照已有 `scene/node-parm.json`（schema v2，per-node 参数，按节点路径/标签 key）→ 需要 MCP 读通道。
- 既有 MCP 工具只覆盖节点图（nodeview 4 个，读 `scene/node-graph.json`）、几何摘要、日志、索引，没有视口模式与参数读通道。

## 2. MCP 通道清单

| # | 通道 | 痛点 | 建议工具名 | 数据来源 | 成本 | 状态 |
|---|---|---|---|---|---|---|
| 1 | 视口显示模式（读） | 验证显示模式必须开浏览器 | `cyl1nder_viewport_settings` | 快照 `docking` 部分（docking-layout.json）顶层 `displaySettings` | 低：复用 read_snapshot | ✅ 已实现（本轮） |
| 2 | Param 面板数据（读） | 查看节点可输入属性必须开浏览器 | `cyl1nder_node_params` | 快照 `parm` 部分（scene/node-parm.json，按节点路径/标签 key） | 低：复用 read_snapshot | ✅ 已实现（本轮） |
| 3 | 视口显示模式（写） | agent 想改显示模式只能手动开 UI | `cyl1nder_set_viewport_mode(serial, mode)` | 写 docking-layout.json 顶层 displaySettings + web 监听变化 | 中：桥侧写快照 + web 需响应外部写入 | 后续候选 |
| 4 | spreadsheet 行数据派生 | 排查几何行/列内容要开浏览器或翻日志 | `cyl1nder_spreadsheet_rows(serial, io?, index?)` | io/inputs.json + io/outputs.json（行/列由几何摘要派生） | 中：需定义行/列派生 schema | 后续候选 |
| 5 | 节点选中态 | 调试选中态/联动必须开浏览器 | `cyl1nder_nodeview_selected(serial)` 或 WS 推送 | **未持久化**：快照 graph 无 selection 字段 | 高：需先扩展快照（graph 顶层加 selection）或 WS 推送（edit 时附带） | 后续候选 |
| 6 | 布局 UI 状态（读） | 面板位置/激活面板只能截图看 | `cyl1nder_layout_state(serial)` | 快照 `docking` 部分（grid/panels/activeGroup） | 低：读 docking 部分 | 后续候选 |
| 7 | 布局 UI 状态（写） | agent 想重排面板/切激活面板 | `cyl1nder_apply_layout(serial, json)` | bridge PUT /api/ui/layout + 快照 docking | 中：web 需监听外部写入 | 后续候选 |

## 3. 已实现工具说明（面向 agent，中文）

- `cyl1nder_viewport_settings(serial)` → 有 `displaySettings`：`{serial, displaySettings: {...}}`（如 `{"mode":"flat-wire"}`）；无快照 / 无 docking / 无 displaySettings：`{serial, displaySettings: None, note}`。
- `cyl1nder_node_params(serial)` → 有 `parm`：`{serial, params: {...}}`（按节点路径/标签 key）；无快照 / 无 parm：`{serial, params: None, note}`。
- 读取方式与 nodeview 工具一致：`registry[serial].hip` → `snapshot_root(hip, serial)` → `read_snapshot` 取 `docking` / `parm` part；无任何新依赖，桥/web 在线与否不影响。

## 4. 关键设计点 / 备注

- `displaySettings` 是 docking-layout.json 的**顶层字段**（与 grid/panels/activeGroup 平级），本轮 web 任务新增；旧快照无该字段时工具返回 None + note，不报错。
- **节点选中态未持久化到快照**：graph part 只有 nodes/connections/viewport。后续两条路：(a) 快照扩展——graph 顶层加 selection（节点 id 列表），成本低但刷新才可见；(b) WS 推送——client→server `edit` 时附带选中变化，实时但需新消息类型。见 `devlog/snapshot-design.md`、`devlog/protocol.md`。
- 布局 UI 状态（grid/panels/activeGroup）已在 docking part 里，读取成本极低；写方向需要 web 监听外部写入（如轮询 GET /api/ui/layout 或 WS 广播），成本主要在前端。

## 5. 验证

- `cd bridge; .venv\Scripts\python -m pytest tests -q`：20 passed（含新增三态测试：有 displaySettings / 有 parm / 无快照，另覆盖缺 displaySettings、缺 parm）。
- `node scripts/gen-api-index.mjs`：成功，API_INDEX.md 收录 2 个新工具。

## 6. 改动文件清单

| 文件 | 改动 |
|---|---|
| `bridge/bridge/mcp_server.py` | +`_read_snapshot_data` 帮助函数 + 2 个工具（中文 docstring） |
| `bridge/tests/test_mcp.py` | 导入 2 工具；新增三态测试 `test_mcp_viewport_settings_and_node_params` |
| `devlog/mcp-channel-proposals.md` | 本文件（新建） |
| `devlog/API_INDEX.md` | 重新生成（`node scripts/gen-api-index.mjs`） |

（未触碰 web/、hda/、其他 devlog 文件；README.md / annotations-* 由主进程合并时更新。）
