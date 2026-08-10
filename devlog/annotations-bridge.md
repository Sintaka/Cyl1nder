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
## v0.1.0-cyl1nder.3（2026-08-10）
- **GET / 根路由**：带 `?serial=` 时 307 跳转到 Web UI（`WEB_UI_URL`，默认 127.0.0.1:8376），无 serial 时返回服务说明 JSON —— 旧链接/误开 8375 不再撞 404。
## v0.1.00002（2026-08-10）
- **GET /api/hda/{serial}/pending?since=N**：轻量脏检查（`{pending, rev}`），供 HDA 30fps 同步轮询，避免轮询时传几何。
## v0.1.00003（2026-08-10）
- **put_outputs 回显去重**：内容与已存一致的输出不 bump rev、不广播（打断 30fps 同步反馈回路）。
- **/pending 增加 reset 标志**；`get_outputs_since` 在 `since > rev`（桥重启/rev 回退）时返回全部——HDA 同步自愈。
## v0.1.00005（2026-08-10）
- **WEB_UI_URL → 8376**：`GET /?serial=` 307 重定向到新 UI 端口。

## v0.1.00017（2026-08-10）
- **/pending 兼作心跳**：`GET /api/hda/{serial}/pending` 现在调用 `registry.touch(serial)`（内存更新 lastSeen，不写盘）。HDA 的 30fps sync poller 每 ~33ms 请求 → Houdini 活着时 lastSeen 持续新鲜；Houdini 崩溃后 poller 停 → lastSeen 过期 → web 前端 watchdog 判定 HDA 离线并显示红叹号。
