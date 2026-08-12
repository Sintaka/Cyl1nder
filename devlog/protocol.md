# Cyl1nder 通信协议 v1

> 本文件是**人读规范**；机器可读单源在 `bridge/bridge/protocol.py`，web 端类型镜像在 `web/src/protocol/types.ts`。
> 任何改动三处同步：protocol.py / types.ts / 本文件。

## 通用
- 桥地址：`http://127.0.0.1:8375`（REST）、`ws://127.0.0.1:8375/ws`（WS）
- 所有 REST 返回 JSON；错误返回 `{"error": "..."}` + 合适状态码。
- serial 格式：`C1-<base36毫秒时间戳>-<4位随机>`（如 `C1-m1abc2d3e-ab12`），小写字母数字。

## 几何信封（v1 JSON）
- inputs: `[{index, name, pointCount, primCount, curves: [{pointIndices, widths?}], points: [[x,y,z],...], attributes: {name: {type, count, values}}}]`
- outputs: `[{index, rev, curves, points, pointCount, primCount, ...}]`（编辑结果，按输出索引独立 rev）

## REST
- `GET  /api/health` -> `{status:"ok", version, serials}`
- `GET  /api/serials` -> `[serial, ...]`
- `GET  /api/hda/{serial}/status` -> registry + workspace 摘要
- `PUT  /api/hda/{serial}/inputs`（HDA 推输入，body = InputPayload[]）
- `GET  /api/hda/{serial}/outputs?since=<rev>`（HDA 拉编辑结果）
- `PUT  /api/hda/{serial}/outputs`（前端推编辑结果，body = OutputBuffer[]）
- `GET  /api/hda/{serial}/logs?level=&limit=`
- `GET  /api/logs?level=&limit=`（全局日志）

### 同步端点（HDA ⇄ bridge，事件驱动）
- `GET /api/hda/{serial}/pending?since=N`：轻量脏检查 `{pending, rev, reset, force}`。**fallback**：HDA 主同步通道已改 `/stream`，本端点保留兼容与回退（自适应轮询时兼心跳）。
- `POST /api/hda/{serial}/kick`：一次性 force 标记（web 首连/重连踢 HDA）；立即唤醒 `/stream`（返回 `{type:"kick", force:true}`）或 `/pending`（`force:true`）。
- `GET /api/hda/{serial}/stream?since=0&hold=20`：**NDJSON 长轮询（HDA 主同步通道）**：
  - 请求到达即 `registry.touch`（liveness = 心跳，auto-register 语义同 /pending）。
  - 立即返回（任一命中）：`since>rev → {type:"reset", rev}` / `rev>since → {type:"outputs", rev}` / kick armed（一次性消费）→ `{type:"kick", force:true, rev}`。
  - 否则 hold 至超时（默认 20s、上限 60s；HDA 用 60s）；`put_outputs` accepted 或 kick armed 立即唤醒；超时 → `{type:"timeout", rev}`。
  - 响应单行 NDJSON，`Content-Type: application/x-ndjson`。
- `PUT /api/hda/{serial}/sync`，body `{"fps": int}`（1..60，默认 30）：设置每-serial 的 **bridge 侧接收+转发速率上限**（内存态；持久源是 web 的 Preference.json）。bridge 用它节流 `notify_stream` 与 WS 广播（合帧 latest-wins，≤ fps）；`/stream` 事件全部附带 `"fps"`，HDA 据此更新运行时接收上限。
- **每端 Sync Max FPS（默认 30，1..60，防守型速率上限）**：
  - Web（发送端）：**Auto Update 推流不设上限（越快越好）**——Sync Max FPS 不是 Cyl1nder 本体运作上限，而是 **kick bridge 的上限**（v0.1.00059 修正）。
  - Bridge（接收+转发端）：`registry` 磁盘保存防抖（≤1 次/秒，杜绝同步写盘阻塞事件循环）；`notify_stream` / WS broadcast 合帧 ≤ fps。
  - HDA（接收端）：`sync_fps` 参数（默认 30）为本地防守；/stream 事件 `fps` 可覆盖运行时值；`_refresh_ready` + recook 调度 ≤ fps（latest-wins）。
- **Preference.json**（快照部件，随场景保存）：`{"schemaVersion":1, "sync_max_fps":30, "update_mode":"auto"}`；`update_mode` 为 enum（`"auto" | "mouseup"`）。
- **心跳语义（LiveLink 原则：数据帧即心跳）**：高传输时事件本身即 liveness，**零额外心跳**；静默期 stream hold=60s → 心跳约 **1 次/分**。web 端离线判定为**慢时钟**：lastSeen 超 **150s**（2.5×60）判 Houdini 离线。
## WebSocket `/ws?serial=<serial>`
- 服务端 → 客户端：`{type:"hello", serial, rev}` / `{type:"inputs", inputs}` / `{type:"outputs", outputs}` / `{type:"log", ...}`
- 客户端 → 服务端：`{type:"ping"}` / `{type:"edit", outputs:[...]}`

## MCP（Cyl1nder 桥 MCP，stdio）
`cyl1nder_list_serials / cyl1nder_get_status / cyl1nder_read_logs / cyl1nder_get_errors / cyl1nder_get_geometry_summary / cyl1nder_index_query / cyl1nder_ping`

## faces 字段（v0.1.00023+）
- `InputPayload`/`OutputBuffer` 新增 `faces: list[list[int]]`：闭合 polygon 面的顶点索引（mesh，如 sphere）。
- serializer：闭合 `Polygon`(isClosed=True) → faces；开口 polyline → curves。
- viewport：faces 以 wireframe Mesh 渲染。
