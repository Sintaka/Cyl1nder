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


## msgpack 协商（v0.1.00098）
- **范围**：仅几何热路径——`PUT /api/hda/{serial}/outputs` 与 `GET /api/hda/{serial}/outputs?since=` 支持 `application/msgpack`（web 默认用 msgpack，HDA 继续 JSON）；WS 连接带 `?proto=msgpack` → 桥对该连接发送二进制 msgpack 帧（`msgpack.packb(msg, use_bin_type=False)`），不带则保持 JSON 文本帧。`/inputs`、`/stream`（NDJSON）、snapshot/layouts/scenes/logs 等其余端点全部保持 JSON。
- **帧内容**：msgpack 编码的是与 JSON 完全相同的 dict 负载（输出缓冲 / 事件消息），无字段变化；types.ts 类型不变。
- **兼容**：桥对 outputs 端点按 `Content-Type`/`Accept` 自动选格式，JSON 始终可用（HDA 与旧客户端零改动）；web `client.ts` 的 `getOutputs` 按响应 `Content-Type` 解码（msgpack 或 JSON）。
## REST
- `GET  /api/health` -> `{status:"ok", version, serials}`
- `GET  /api/serials` -> `[serial, ...]`
- `GET  /api/hda/{serial}/status` -> registry + workspace 摘要 + `sync` 块（v0.1.00101 起：`{fps, sync_enabled}`）
- `PUT  /api/hda/{serial}/inputs`（HDA 推输入，body = InputPayload[]；**v0.1.00100 起**可带可选 `frame`（float|null）——HDA 在 cook 主线程捎带 `hou.frame()`，bridge 透传并随 WS 广播）
- `GET  /api/hda/{serial}/outputs?since=<rev>`（HDA 拉编辑结果）
- `PUT  /api/hda/{serial}/outputs`（前端推编辑结果，body = OutputBuffer[]）
- `GET  /api/hda/{serial}/logs?level=&limit=`
- `GET  /api/logs?level=&limit=`（全局日志）

### 同步端点（HDA ⇄ bridge，事件驱动）
- `GET /api/hda/{serial}/pending?since=N`：轻量脏检查 `{pending, rev, reset, force, sync_enabled}`（sync_enabled v0.1.00101 起）。**fallback**：HDA 主同步通道已改 `/stream`，本端点保留兼容与回退（自适应轮询时兼心跳）。
- `POST /api/hda/{serial}/kick`：一次性 force 标记（web 首连/重连踢 HDA）；立即唤醒 `/stream`（返回 `{type:"kick", force:true}`）或 `/pending`（`force:true`）。
- `GET /api/hda/{serial}/stream?since=0&hold=60`：**NDJSON 长轮询（HDA 主同步通道）**：
  - 请求到达即 `registry.touch`（liveness = 心跳，auto-register 语义同 /pending）。
  - 立即返回（任一命中）：`since>rev → {type:"reset", rev}` / `rev>since → {type:"outputs", rev}` / kick armed（一次性消费）→ `{type:"kick", force:true, rev}`。
  - 否则 hold 至超时（默认 60s、上限 60s；HDA 用 60s）；`put_outputs` accepted 或 kick armed 立即唤醒；超时 → `{type:"timeout", rev}`。
  - 响应单行 NDJSON，`Content-Type: application/x-ndjson`。
- `PUT /api/hda/{serial}/sync`，body `{"fps": int}`（1..60，默认 30）：设置每-serial 的 **bridge 侧接收+转发速率上限**（内存态；持久源是 web 的 Preference.json）。bridge 用它节流 `notify_stream` 与 WS 广播（合帧 latest-wins，≤ fps）；`/stream` 事件全部附带 `"fps"`，HDA 据此更新运行时接收上限。
- `PUT /api/hda/{serial}/sync-enabled`，body `{"enabled": bool}`（**v0.1.00101 起**）：设置 per-serial **手动双向同步开关**（默认 False=本地模式；web 是单一事实源，持久化于 Preference.json `sync_enabled`）。False 时 bridge **不广播 WS outputs 回显、不 notify_stream**（outputs 仍存储/rev++，防御纵深）；`/pending` 与 `/stream` 事件携带 `sync_enabled`（HDA 据此在 OFF/ON 间切换），`/status` 返回 `sync` 块。
- **每端 Sync Max FPS（默认 30，1..60，防守型速率上限）**：
  - Web（发送端）：**Auto Update 推流不设上限（越快越好）**——Sync Max FPS 不是 Cyl1nder 本体运作上限，而是 **kick bridge 的上限**（v0.1.00059 修正）。
  - Bridge（接收+转发端）：`registry` 磁盘保存防抖（≤1 次/秒，杜绝同步写盘阻塞事件循环）；`notify_stream` / WS broadcast 合帧 ≤ fps。
  - HDA（接收端）：`sync_fps` 参数（默认 30）为本地防守；/stream 事件 `fps` 可覆盖运行时值；`_refresh_ready` + recook 调度 ≤ fps（latest-wins）。
- **Preference.json**（快照部件，随场景保存）：`{"schemaVersion":1, "sync_max_fps":30, "update_mode":"auto", "sync_enabled":false}`（sync_enabled v0.1.00101 起）；`update_mode` 为 enum（`"auto" | "mouseup"`）。
- **心跳语义（LiveLink 原则：数据帧即心跳）**：高传输时事件本身即 liveness，**零额外心跳**；静默期 stream hold=60s → 心跳约 **1 次/分**。web 端离线判定为**慢时钟**：lastSeen 超 **150s**（2.5×60）判 Houdini 离线。
## WebSocket `/ws?serial=<serial>`
- 服务端 → 客户端：`{type:"hello", serial, rev}` / `{type:"inputs", inputs, frame?}`（frame 可选，v0.1.00100 起）/ `{type:"outputs", outputs}` / `{type:"log", ...}` / `{type:"timeline", frame, fps, source:"hou"|"web", ts}`（**v0.1.00103 起为主通道**：bridge 常驻轮询器帧变化即推送，web session 直接 applyRemote；`PUT /hou-timeline` 上报仍是兼容来源）
- 客户端 → 服务端：`{type:"ping"}` / `{type:"edit", outputs:[...]}`（edit accept 后 v0.1.00102 起触发 maybe_snapshot 落盘）

## fxhoudinimcp 对接端点（v0.1.00102 起，bridge 代理 Houdini MCP）
- `GET  /api/hda/{serial}/houdini` -> `{serial, mcpPort, alive, health|null}`（health = mcp.health 直连结果）
- `PUT  /api/hda/{serial}/houdini`，body `{"mcp_port": int}`（HDA 上报本实例端口，1..65535；probe 后回 `{ok, mcpPort, alive, matched}`）
- `GET  /api/hda/{serial}/timeline` -> `{serial, frame, fps, source, ts, mcpPort}`（**v0.1.00103 起**：兼作轮询器喂食——bridge 常驻轮询器按 `max(66ms, 1000/sync_fps)` 主动拉 `animation.get_frame`，帧/fps 变化（>0.001）才 WS 广播；10s 无 GET 自动停（idle-stop）；首屏 GET 在缓存陈旧时内联刷新一次秒出）
- `PUT  /api/hda/{serial}/timeline`，body `{"frame": number}` -> `{ok, frame, mcp_port, throttled?}`（C→H：`animation.set_frame`；节流 `max(33ms, 1000/sync_fps)` + **latest-wins**（窗口内只发最新 pending 帧）+ single-flight；成功后广播 source="web"）
- `PUT  /api/hda/{serial}/hou-timeline`，body `{"frame": number, "fps"?: number}`（HDA 上报帧 → 更新缓存 + WS 广播 `{type:"timeline"}`）
- `POST /api/hda/{serial}/houdini/cmd`，body `{"command": str, "params"?: dict}` -> `{ok, command, result}`（命名空间前缀白名单，不过 403；白名单见 `houdini_mcp.ALLOWED_COMMAND_PREFIXES`）
- `POST /api/hda/{serial}/houdini/python`，body `{"code": str, "return_expression"?: str}` -> `{ok, result}`（`code.execute_python` 代理）
- **v0.1.00103 起：所有与 Houdini 的周期性交互速率均由 per-serial Sync Max FPS 派生**（get 轮询 `max(66ms,1000/fps)`、set 节流 `max(33ms,1000/fps)`）；**实测通道上限 ≈19Hz 合计**（get ~52ms / set ~78ms 单次，共用 hdefereval 主线程封送队列，超出会积压雪崩——见 timeline-sync-lag-analysis.md）——66ms/33ms 地板即为此设。一次性 cmd/python 调用不受 fps 节流（用户显式动作），但 `_resolve_port` 失败有 2s 短缓存防扫端口风暴。

## 通道注册端点（吊牌 HDA Cyl1nderTag，v0.1.00106 起）
- **channelRef**（协议三处同步）：`{kind: "tag"|"hda"|"param", serial?, nodePath?, absolutePath?, hip, label, registeredAt, lastSeen}`。注册表 key：kind=tag/hda → `serial`；kind=param → `absolutePath`。`registeredAt` 首次注册时服务端写、重复注册保留；`lastSeen` 注册/心跳/探测成功时刷新。
- **channelId（URL 段）**：param 通道 = `absolutePath` 去前导 `/`（如 `obj/geo1/transform1/tx`），tag/hda 通道 = serial。客户端编码：`quote(id.lstrip("/"), safe="/")`（Python）/ `encodeURI(id.replace(/^\//,""))`（JS）；FastAPI 用 `{channelId:path}` 捕获，服务端对 param 通道回补前导 `/`。
- `PUT  /api/channels/{channelId:path}`，body = channelRef：幂等 upsert；id 与 ref 键不一致 → 400；-> `{ok, channelId, ref}`
- `GET  /api/channels` -> `{channels: [channelRef...]}`（按 registeredAt 升序）
- `POST /api/hda/{serial}/channels/heartbeat`，body `{serial, nodePath, upstreamNodePath, fingerprint}`：对该 serial 的所有通道 touch lastSeen；-> `{ok, serial, lastSeen}`（未注册也容忍）
- `GET  /api/channels/{channelId:path}/probe`：无此通道 → 404；经 fxhoudinimcp 代理 `nodes.get_node_info`（timeout 4s）确认节点存活与类型仍是 `Cyl1nderTag`；-> `{ok, alive, matched, nodePath, serial, reason}`（探测失败 ok 仍 true、alive=false）
- **吊牌行为**：cook 时解析 `entries`（多行，相对路径以第 0 输入上游节点为基准）→ 首次/指纹变化注册（1 条 kind=tag + 每参数 1 条 kind=param）；否则心跳（节流 ≥5s）。改参一律走既有 `POST /api/hda/{serial}/houdini/cmd`（`parameters.set_parameter`），吊牌不参与。

## 快照恢复端点（v0.1.00102 起）
- `POST /api/hda/{serial}/snapshot/restore` -> `{ok, serial, restored, inputRev, outputRev}`：从磁盘快照回填**空** workspace（绝不覆盖运行态），恢复后 WS 广播 inputs/outputs；桥启动时 lifespan 自动对全部 registry serial 执行等价回填（`snapshot.restore_all_workspaces`），关闭时 `flush_all_workspaces` 强制落盘。
- 快照读取为**双根合并**：hip 目录旁 `Cyl1nder/<serial>/` 优先、`bridge/data/snapshots/<serial>/` 补缺（registry.hip 暂时为空时写入回退根，双根合并保证都能读到）。

## MCP（Cyl1nder 桥 MCP，stdio）
`cyl1nder_list_serials / cyl1nder_get_status / cyl1nder_read_logs / cyl1nder_get_errors / cyl1nder_get_geometry_summary / cyl1nder_index_query / cyl1nder_ping`

## faces 字段（v0.1.00023+）
- `InputPayload`/`OutputBuffer` 新增 `faces: list[list[int]]`：闭合 polygon 面的顶点索引（mesh，如 sphere）。
- serializer：闭合 `Polygon`(isClosed=True) → faces；开口 polyline → curves。
- viewport：faces 以 wireframe Mesh 渲染。
