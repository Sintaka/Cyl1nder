# 桥子系统改动标注 / Bridge annotations

## v0.1.0-cyl1nder.1
- `protocol.py`：REST/WS/MCP 载荷单源（InputPayload / OutputBuffer / InputsPut / OutputsPut；serial 规则 `C1-<base36ms>-<4rand>`）。
- `registry.py`：SerialRegistry 不可变注册（createdAt 固定，lastSeen/nodePath/label 更新），JSON 落盘 `bridge/data/registry.json`。
- `workspace.py`：WorkspaceStore per-serial inputs + 按输出 index 独立 rev 的 outputs（`get_outputs_since`）。
- `logs.py`：LogRing 环形 1000 条，level/serial 过滤。
- `routes.py`：`/api/health` `/api/serials` `/api/hda/{serial}/status|inputs|outputs|logs` + `/api/logs`。
- `ws.py`：`/ws?serial=` 分桶；`hello/inputs/outputs/pong`；`edit` 消息；连接时回放当前 inputs/outputs（后开的标签页可见已有数据）。
- `compute/`：执行器接口（passthrough + native_demo ctypes 桩，预留 pyd/dll）。
- `mcp_server.py`：7 个 `cyl1nder_*` 工具（含 `index_query` 读 devlog 索引）。
- 测试：pytest 14 通过（registry / workspace / routes / mcp）。