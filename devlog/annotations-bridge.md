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

## v0.1.00020（2026-08-10）
- **统一路径系统 P0 落地（snapshot-design.md）**：
  - `bridge/snapshot.py`：快照目录 `dirname(registry[serial].hip)/Cyl1nder/<serial>/`（hip 缺失回退 `CYL1NDER_SNAPSHOT_ROOT` → `bridge/data/snapshots/<serial>/`）；文件 `<serial>.{meta,graph,inputs,outputs}.json`；原子写（tmp+replace）+ 内容对比（R5，变化才写）。
  - `routes.py`：`PUT /inputs`、`PUT /outputs` 后 `_maybe_snapshot()` 节流写快照（≥5s，防 cook 风暴）；`GET /api/hda/<serial>/snapshot` 读快照。
  - `workspace.all_outputs()` 新增。
  - 验证：smoke 后快照文件生成（inputs/meta/outputs），GET snapshot 返回。

## v0.1.00033（2026-08-10）
- **快照系统 v2（固定格式 + 分目录）**：
  ```
  <hip目录>/Cyl1nder/<serial>/
    io/inputs.json           几何输入缓存
    io/outputs.json          几何输出缓存
    scene/meta.json          metadata（schemaVersion 2）
    scene/node-graph.json    节点网络（nodes/connections/viewport，web 保存）
    scene/node-parm.json     节点参数（绝对地址键，预留）
    docking-layout.json      dockview 布局（web 保存）
  ```
  文件**固定名（无 serial 前缀）**——serial 即文件夹名；兼容 v1 旧格式（`<serial>.<part>.json` 读取回退）。
- REST：`PUT /api/hda/{serial}/snapshot` 接收 `{graph, parm, docking}`（web 显式保存 scene 部分）；`GET /api/hda/{serial}/snapshot` 返回全部 parts。
## v0.1.00056（2026-08-12）
- **/stream NDJSON 长轮询（HDA 主同步通道）+ 心跳解耦**（devlog/sync-heartbeat-redesign.md）：
  - `GET /api/hda/{serial}/stream?since=&hold=`（hold 默认 20、上限 60；HDA 用 60s=空闲心跳 1 次/分）：请求到达即 `registry.touch`（liveness）；立即命中 `reset`（since>rev）/ `outputs`（rev>since）/ `kick`（`take_kick` 一次性消费）；否则 hold 至超时，`put_outputs` accepted 或 kick armed 时 `notify_stream` 立即唤醒；响应单行 NDJSON（`application/x-ndjson`）。
  - `BridgeState` 新增 asyncio.Event waiter 集（`subscribe/unsubscribe/notify_stream`；put_outputs / ws edit / kick 均在主事件循环内 notify，单循环内安全）。
  - `/pending` 保留为 fallback（语义不变）；`POST /kick` 现在同时唤醒 /stream。
  - 测试：test_routes.py 追加 6 个 stream 用例（立即 outputs / reset / 小 hold 超时 / touch 更新 lastSeen / hold 边界 422 / kick 唤醒 hold），**pytest 43 全绿**。