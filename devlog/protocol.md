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
- **channelRef**（协议三处同步）：`{kind: "tag"|"hda"|"param"|"data", serial?, nodePath?, absolutePath?, hip, label, registeredAt, lastSeen, adapter?, rel?, type, mode?}`。注册表 key：kind=tag/hda → `serial`；kind=param/data → `absolutePath`。`registeredAt` 首次注册时服务端写、重复注册保留；`lastSeen` 注册/心跳/探测成功时刷新。`adapter`（v0.1.00110 起）仅 kind=data 使用。`rel`/`type`/`mode`（v0.1.00114 起）供映射系统建条目：`rel` = 相对**吊牌所在网络**的地址（兄弟节点语义，逻辑名默认取它），`type` ∈ `geo|float|vec3`（旧记录缺省 `float`），`mode` = 归属吊牌标记模式。
- **channelId（URL 段）**：param 通道 = `absolutePath` 去前导 `/`（如 `obj/geo1/transform1/tx`），tag/hda 通道 = serial。客户端编码：`quote(id.lstrip("/"), safe="/")`（Python）/ `encodeURI(id.replace(/^\//,""))`（JS）；FastAPI 用 `{channelId:path}` 捕获，服务端对 param 通道回补前导 `/`。
- `PUT  /api/channels/{channelId:path}`，body = channelRef：幂等 upsert；id 与 ref 键不一致 → 400；-> `{ok, channelId, ref}`
- `GET  /api/channels` -> `{channels: [channelRef...]}`（按 registeredAt 升序）
- `POST /api/hda/{serial}/channels/heartbeat`，body `{serial, nodePath, upstreamNodePath, fingerprint}`：对该 serial 的所有通道 touch lastSeen；-> `{ok, serial, lastSeen}`（未注册也容忍）
- `GET  /api/channels/{channelId:path}/probe`：无此通道 → 404；经 fxhoudinimcp 代理 `nodes.get_node_info`（timeout 4s）确认节点存活与类型仍是 `Cyl1nderTag`；-> `{ok, alive, matched, nodePath, serial, reason}`（探测失败 ok 仍 true、alive=false）
- **吊牌行为**：cook 时解析 `entries`（多行，相对路径以第 0 输入上游节点为基准）→ 首次/指纹变化注册（1 条 kind=tag + 每参数 1 条 kind=param）；否则心跳（节流 ≥5s）。改参一律走既有 `POST /api/hda/{serial}/houdini/cmd`（`parameters.set_parameter`），吊牌不参与。

## 数据源通道（P4v1，v0.1.00110 起）
- **kind="data"**：非 geo 数据源通道。`absolutePath` = `<node_path>/<parm_name>`（如 `/obj/geo1/sceneanimate1/animation`）；`adapter` = bridge 侧读写器名（注册表 `bridge/bridge/channels/`，首个适配器 `apex-anim`：经 `code.execute_python` 读写数据参数 `asData()/setFromData()`）。
- **吊牌 entries 语法**：`@<adapter>:<nodePath>:<parmName>` 注册 data 通道（仅绝对路径）；普通条目仍是 param 通道。注册 payload 带 `adapter` 字段。
- `GET /api/channels/{channelId:path}/value` -> `{ok: true, value}`（404 无通道 / 400 非 data 通道或未知 adapter / HTTP 200 + `{ok:false,error}` MCP 不可达）
- `PUT /api/channels/{channelId:path}/value`，body `{"value": <任意 JSON>}` -> `{ok: true, value}`（同 GET 错误语义）
- 埋点：actor=`web-param`，action=`data-get`/`data-set`，digest=值截断 80。

## 参数通道值同步（P5a，v0.1.00111 起）
- `GET /api/hda/{serial}/channel-values` -> `{ok, values: {absolutePath: value, ...}}`：对 serial 的 param 通道批量 `parameters.get_parameter`（值宽容提取 `data.value`），**0.25s 整响应缓存**（照 GET /timeline 模式）；无通道 → 空 dict。
- `PUT /api/hda/{serial}/channel-values`，body `{"values": {absolutePath: value}}` -> `{ok, throttled?}`：每通道 `parameters.set_parameter`，**Sync Max FPS 节流（max(33ms,1000/fps)）+ latest-wins 整 dict 替换 + single-flight**（照 PUT /timeline 模式）；成功后**不回显广播**（web 发起防回环）；每通道 trace `param-set`（web-param）。
- **H→C 事件推送**：吊牌 cook 心跳捎带 `values`（可选字段，缺省兼容）→ bridge 直接 **WS 广播 `{type:"channel-values", values}`**（值不落地）。
- web：主应用「通道参数」dock 面板——数值 scrubbing/输入节流提交（≤ Sync Max FPS，latest-wins）；WS 推送即时刷新（编辑行不覆盖）+ 250ms 轮询兜底（可见性门控）。
- **通道引用绑定（P5b，客户端语义，协议零改动）**：web 节点参数可绑定到 param 通道 absolutePath（设计参考 Houdini `ch()` channel reference——值跟随源、引用有视觉标识）；节点 `bindings: {paramName: absolutePath}` 随图快照序列化；参数面板/gizmo 编辑经 `PUT channel-values` 直写 Houdini（节流 latest-wins），H→C 值回显应用到绑定节点（值对比防回环）。

## 项目端点（P2a，v0.1.00107 起）
- **ProjectRef**：`{projectSerial: "P1-<b36ms>-<4rand>", label, createdAt, updatedAt, members: [channelRef…]}`。`P1-` 前缀 = 项目序列号（与 `C1-` 的 HDA/吊牌 serial 区分）；成员是通道引用**快照**（live 状态以 `/api/channels` 大全为准）。
- `POST /api/projects`，body `{label?}` -> `{ok, project}`
- `GET  /api/projects` -> `{projects: [...]}`（createdAt 升序）
- `GET  /api/projects/{projectId}` -> `{ok, project}`（非法 400 / 不存在 404）
- `POST /api/projects/{projectId}/members`，body = channelRef -> `{ok, project}`（按通道 key 去重）
- `DELETE /api/projects/{projectId}/members?channelId=<key>` -> `{ok, project}`（channelId 用 **query 参数**：param 通道 key 含 "/"）
- `POST /api/projects/ensure`，body `{serial}` -> `{ok, project, created}`：无含该 serial 成员的项目则自动建 `P1-…` 单成员隐式项目（成员优先取 /api/channels 大全中该 serial 的 tag/hda 通道，缺失则 fallback `kind:"hda"`）

## 项目图端点（P2b，v0.1.00108 起）
- 项目图 = nodeview 项目根布局（project 根 + channel 成员节点 + 连接 + viewport 变换），**透传 dict 无 pydantic 模型**；存 `bridge/data/projects/<projectSerial>/graph.json`（项目无单一 hip 上下文，不随 hip 旁快照）。
- `GET /api/projects/{projectId}/graph` -> `{ok, graph|null}`（非法 400 / 项目不存在 404）。**迁移读**：graph 为空且项目**恰 1 个 kind∈{tag,hda} 成员**（serial/hip 非空）→ 返回该成员 serial 快照的 graph 部分（纯读不写回）。
- `PUT /api/projects/{projectId}/graph`，body `{graph}` -> `{ok}`（原子 tmp+replace + 内容对比，同内容不重写）。

## 项目管理端点（v0.1.00114 起，项目优先重构）
- `PATCH  /api/projects/{projectId}`，body `{label}` -> `{ok, project}`（改名；刷 updatedAt）
- `DELETE /api/projects/{projectId}` -> `{ok, removed}`（连带删除该项目的 mappings 分区与 `projects/<pid>/graph.json`）
- `POST   /api/projects/cleanup` -> `{ok, removed: [projectSerial…]}`（删除 0 成员项目）

## 映射系统（v0.1.00114 起，见 devlog/project-mapping-design.md）
**为什么**：此前 node 里写的是绝对 Houdini 路径，吊牌一移动就全断。改为 node 只引用**逻辑名（相对地址）**，绝对路径只存在于映射系统。

- **锚点（anchor）= 吊牌 serial**：创建即不可变、移动/改名不变（铁律 1）。吊牌**每次 cook 上报自身 nodePath**；锚点移动只改 `anchors` 一处，其下全部 entry 自动跟随。
- **解析**：`absolutePath = <锚点 nodePath 所在网络> + "/" + entry.rel`。`rel` 以吊牌**所在网络**为基准（**兄弟节点语义**，不是吊牌自身路径）。
- **逻辑名作用域 = 项目内唯一**（不同项目可同名指向不同锚点）。
- **AnchorRef**：`{serial, nodePath, hip, mode: "parm"|"apex", lastSeen, movedAt, pid, mcpPort, verifiedAt, verifiedAlive}`（`movedAt` 0 = 从未移动）。
  - `pid` / `mcpPort`（v0.1.00114）：吊牌 cook 时连自身 `os.getpid()` 与已发现的 MCP 端口一起上报。**用途 = 降级前实证**：心跳只能证明「最近 cook 过」，而吊牌长期不 cook 是正常的，所以心跳超时**不等于**失联。记下 pid+端口后可直接 `mcp.health` 核对 `pid == 记录值`（铁律：pid 是唯一可靠判据），区分「只是没 cook」与「实例真没了」。
  - `verifiedAt` / `verifiedAlive`：最近一次**探测**（不是心跳）的时刻与结论。
- **心跳间隔**：吊牌 cook 心跳节流从 5s 放宽到 **≥60s**（`TAG_HEARTBEAT_INTERVAL`）。存活判定改由探测负责，心跳只做低频「我还在 + 位置摘要」上报，不必频繁。
- `GET /api/projects/{pid}/anchors/{serial}/probe` -> **AnchorProbeResult** `{serial, alive, pidMatched, port, expectedPid, actualPid, hip, reason}`：按记录的 `mcpPort` 发 `mcp.health`；端口对不上时按 `hip` 重新定位。`alive && pidMatched` 才是确认活着；`alive` 但 pid 不匹配 = 该端口现在被**另一个** Houdini 占着（实例换了），不可当同一实例用。成功时刷新锚点的 `verifiedAt`/`verifiedAlive`/`mcpPort`。
- **MappingEntry**：`{anchor, rel, kind: "param"|"data", adapter?, type: "geo"|"float"|"vec3", label}`。
- **MappingResolved**：`{name, absolutePath, kind, adapter?, type, anchor, ok, error}`（锚点缺失 → `ok=false`、`absolutePath=""`）。
- 落盘 `bridge/data/mappings.json`：`{anchors: {serial: AnchorRef}, entries: {projectSerial: {name: MappingEntry}}}`。

端点：
- `GET    /api/projects/{pid}/mappings` -> `MappingsResponse{projectSerial, entries, anchors, resolved}`
- `PUT    /api/projects/{pid}/mappings/{name:path}`，body = MappingEntry -> `{ok, entry, resolved}`
- `DELETE /api/projects/{pid}/mappings/{name:path}` -> `{ok, removed}`
- `GET    /api/projects/{pid}/mappings/{name:path}/value` -> `{ok, value}`（resolve 后按 kind 走 data adapter / `parameters.get_parameter`）
- `PUT    /api/projects/{pid}/mappings/{name:path}/value`，body `{value}` -> `{ok, value}`（同上，写方向）

WS 广播：
- `{type:"anchor-moved", serial, oldPath, newPath, names:[…]}` —— 锚点位置变化。**逻辑名不变**，web 侧不需要改地址，仅提示与刷新。

轨迹：新增 action `anchor-move`（actor `tag-hda`）。

## 吊牌标记模式（v0.1.00114 起）
`Cyl1nderTag` 新增 `mode` 参数（menu）：
- `parm`（默认）：条目 = 相对参数地址，`transform1/tx` 或 `tx`（以上游节点为基准，兼容旧写法）
- `apex`：条目 = `<sceneanimate 节点>/<控制器>[/<tx…rz>]`，自动补 `adapter="apex-ctrl"`，按有无分量后缀定 `type=vec3|float`

模式只决定**解析与 adapter 归属**，不改注册端点形态。
**移动检测**：吊牌 cook 指纹从 `(entries, upstream)` 改为 `(entries, upstream, tagPath, mode)` —— 此前漏掉 `tagPath`，移动/改名吊牌整个会话都不会重新注册（映射一直是旧路径）。

## 快照恢复端点（v0.1.00102 起）
- `POST /api/hda/{serial}/snapshot/restore` -> `{ok, serial, restored, inputRev, outputRev}`：从磁盘快照回填**空** workspace（绝不覆盖运行态），恢复后 WS 广播 inputs/outputs；桥启动时 lifespan 自动对全部 registry serial 执行等价回填（`snapshot.restore_all_workspaces`），关闭时 `flush_all_workspaces` 强制落盘。
- 快照读取为**双根合并**：hip 目录旁 `Cyl1nder/<serial>/` 优先、`bridge/data/snapshots/<serial>/` 补缺（registry.hip 暂时为空时写入回退根，双根合并保证都能读到）。

## 轨迹端点（P3，v0.1.00109 起）
- **TraceEvent**：`{ts, project, channel, actor, action, target, digest}`。actor = `web-gizmo|web-param|runtime-python|tag-hda|hda-cook|bridge`；action = `param-set|expr-set|inputs-push|outputs-edit|register|heartbeat|python-exec`。`project` v1 恒 `""`（项目过滤在查询时按成员关系解析）；`channel` = 通道 key（serial 或 absolutePath）。
- **埋点**：put_inputs → `hda-cook/inputs-push`；put_outputs 与 WS edit → `web-gizmo/outputs-edit`；`POST /houdini/cmd` → `runtime-python/param-set|expr-set`（target=node_path/parm，digest=值截断）；`POST /houdini/python` → `runtime-python/python-exec`；吊牌注册 → `tag-hda/register`、心跳 → `tag-hda/heartbeat`（digest=fingerprint）。
- `GET /api/trace?project=&actor=&action=&channel=&target=&limit=` -> `{events: [...], count}`（新→旧；`project` 过滤按该项目成员的通道 key 集合匹配；limit 默认 200 钳 1..1000；count = 过滤后总数）。
- **TraceStore**：内存环形 10000，线程安全，add 吞异常（埋点零行为影响）；ndjson 落盘留 P3.5。
- 页面：`/trace.html?project=`（时间/通道/actor/action 过滤、行展开 digest）。验收：同一参数被多个项目引用时，改动来源/通道/新旧值可审计。

## MCP（Cyl1nder 桥 MCP，stdio）
`cyl1nder_list_serials / cyl1nder_get_status / cyl1nder_read_logs / cyl1nder_get_errors / cyl1nder_get_geometry_summary / cyl1nder_index_query / cyl1nder_ping`

## faces 字段（v0.1.00023+）
- `InputPayload`/`OutputBuffer` 新增 `faces: list[list[int]]`：闭合 polygon 面的顶点索引（mesh，如 sphere）。
- serializer：闭合 `Polygon`(isClosed=True) → faces；开口 polyline → curves。
- viewport：faces 以 wireframe Mesh 渲染。
