# 桥子系统改动标注 / Bridge annotations

## v0.1.00103（2026-08-14）· 时间轴常驻轮询 + WS 推送 + Sync Max FPS 速率派生
- **houdini_routes.py**：`ensure_poller` 幂等常驻轮询器（interval=`max(66ms,1000/sync_fps)`、single-flight、3 连败暂歇 2s、10s 无 GET idle-stop、帧/fps 变化>0.001 才 WS 广播）；GET /timeline 兼作喂食（首屏缓存陈旧时内联刷新秒出）；PUT /timeline `max(33ms,1000/sync_fps)` 节流 + latest-wins pending + call_later 边界补发 + single-flight，成功后广播 source="web"；`_resolve_port` 失败 2s 短缓存（防 Houdini 未起时扫 16 端口风暴）。
- **tests/test_houdini_mcp.py**：+4 例（轮询器/idle-stop/节流/latest-wins），39 例。pytest 110 passed。
- 实测（scripts/bench_mcp_latency.py / verify_ws_timeline.py）：get_frame ~52ms、set_frame ~78ms、health ~8ms；H→C WS 推送只在变化时广播、跟随变化节奏；通道合计上限 ~19Hz（hdefereval 队列约束）。详见 devlog/timeline-sync-lag-analysis.md。

## v0.1.00102（2026-08-14）· 快照修复 + fxhoudinimcp 代理
- **snapshot.py**：`maybe_snapshot` 自 routes.py 迁入（REST put 与 WS edit 共用）；`read_snapshot` 双根合并（hip 根优先、DEFAULT_ROOT 补缺，两处兼容 v1 legacy）；`restore_workspace/restore_all_workspaces`（仅回填空 workspace、坏条目跳过+error 日志）；`flush_workspace/flush_all_workspaces`。
- **snapshot_routes.py（新）**：`POST /api/hda/{serial}/snapshot/restore`（to_thread 恢复 + 成功后 WS 广播 inputs/outputs）。
- **ws.py**：edit 分支 accept 后 `await maybe_snapshot(serial)`（修复 io/outputs.json 长期空 → 重启丢编辑）。
- **main.py**：lifespan（启动 restore_all_workspaces / 关闭 flush_all_workspaces）+ 挂载 snapshot/houdini 两个新路由。
- **houdini_mcp.py（新）**：纯 stdlib HTTP RPC 客户端（rpc/health/discover_first/discover_by_hip/normalize_hip/set_frame/get_frame/execute_python/is_command_allowed + ALLOWED_COMMAND_PREFIXES）。
- **houdini_routes.py（新）**：GET/PUT `/houdini`、POST `/houdini/cmd`（白名单 403）、POST `/houdini/python`、GET/PUT `/timeline`（0.25s 缓存 get_frame / 0.1s 节流 set_frame，端口解析 registry.mcpPort→hip→first 并 30s 节流写回）、PUT `/hou-timeline`（缓存 + WS 广播 timeline）；所有阻塞调用 to_thread。
- **registry.py**：`RegistryRecord.mcpPort`（可变、to_dict/from_dict 兼容旧记录）+ `SerialRegistry.set_houdini_mcp`（force 落盘）。
- **测试**：test_snapshot_restore.py 7 例 + test_houdini_mcp.py 35 例；test_registry 时间分辨率 flake 修复（循环内 sleep(0.02)）。pytest 106 passed。

## v0.1.00101（2026-08-14）· Phase B 手动双向同步开关（bridge gate）
- **protocol.py**：新增 `SyncEnabledPut`（`enabled` 默认 True）；docstring 补 `PUT /sync-enabled` + `sync_enabled` 语义。
- **state.py**：per-serial `sync_enabled`（默认 False）+ `set_sync_enabled`/`get_sync_enabled`。
- **routes.py**：新 `PUT /api/hda/{serial}/sync-enabled`；`put_outputs` 的 `stage_broadcast`/`notify_stream` 按 gate（存储/rev++/snapshot 无条件）；`/pending` 与 `/stream` 全部事件携带 `sync_enabled`；`/status` 返回 `sync` 块。
- **ws.py**：edit 分支 broadcast/notify 同 gate。
- **测试**：sync gate 默认 OFF/可设、OFF 存储不回显；stream 精确断言同步。pytest 61 passed / 1 skipped（test_mcp 为环境问题）。

## v0.1.00100（2026-08-14）· 本地时间轴 Phase A：inputs 帧透传
- **protocol.py**：`InputsPut.frame: float | None = None`（可选）；docstring 注明 WS inputs 带可选 frame。
- **workspace.py**：`Workspace.frame` 存储；`set_inputs(inputs, frame=None)`（frame 不参与 rev 递增）。
- **routes.py put_inputs**：透传 `payload.frame`，WS 广播 `{type:"inputs", ..., frame}`。
- **ws.py 重放**：late-joining tab 的 inputs 消息带 `frame: ws_cur.frame`。
- **测试**：test_routes / test_workspace 补 frame 用例。pytest 59 passed / 1 skipped（test_mcp 因 fastmcp server extra 缺失为环境问题，与本轮无关）。

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
## v0.1.00057（2026-08-12）
- **bridge 阻塞修复 + 每端 Sync Max FPS**（devlog/sync-rate-limit-and-preference.md）：
  - **registry._save 防抖**：`touch`/`mark_activity` 只置 dirty，磁盘写 ≤1 次/秒（`register`/`remove` 立即保存）——消灭「60Hz 拖动时事件循环被同步写盘阻塞」（压测：touch 0.78ms / mark_activity 0.82ms / put_outputs 0.004ms，60Hz ≈ 96ms/s 阻塞）。
  - 新端点 `PUT /api/hda/{serial}/sync {fps}`（1..60，默认 30，内存态）：bridge 每-serial 接收+转发速率上限；`/stream` 事件全部带 `"fps"`。
  - `notify_stream` 合帧（≤ fps，`loop.call_later`）；WS 广播合帧（`stage_broadcast` 按 index latest-wins，≤ fps flush）。
  - 快照新增 **Preference.json** 部件（`_PARTS` + write/read），`putSnapshot` 透传 `preference`。
  - 测试：pytest **50 全绿**（+7：save 防抖 / /sync / stream 带 fps / preference 部件 / stage_broadcast 合帧 / notify 合帧）。
## v0.1.00064（2026-08-12）——kick 限流 + 快照移线程 + no-op 不 log（详见 devlog/viewport-interrupt-redesign.md）
- **POST /kick 每 serial 2s 去重**：`BridgeState.try_arm_kick(serial)`（monotonic 时间窗，命中返回 False 不 arm 不 touch 不 notify）；限流时仍 200 `{"ok":true,"throttled":true}`——客户端风暴（WS 重连 churn 反复 kick）不再打爆 bridge cmd、不再强迫 HDA 无效 recook。
- **`_maybe_snapshot` 移出事件循环**：`write_snapshot` 经 `await asyncio.to_thread(...)`，5s 节流 + 内容对比不变——拖拽期同步磁盘 I/O 不再阻塞 WS 广播 / stream 唤醒（配合 v0.1.00057 registry 防抖，根除"猛写盘"拖后腿）。
- **日志降噪**：`put_outputs` / ws `edit` 仅 accepted 非空（真实内容变化）时记录，no-op 回显不再刷 LogRing。
- 测试：pytest **53 全绿**（+3：kick 限流 / 窗口过后可再 kick / 相同输出不产生新日志）。
- **注意**：需重启 bridge 生效（HDA /stream 自动重连恢复）。
## v0.1.00065（2026-08-13）——控制台降噪 + /stream 缺省 hold 60
- **uvicorn access_log 关闭**：`__main__.py` 改 `uvicorn.run(..., access_log=False)`——web Auto Update 推流无上限，gizmo 快速拖动时逐请求 access log 会刷爆 cmd 控制台；数据面的 notify/broadcast 已按 sync max fps 合帧，这里关掉的只是 HTTP 请求行日志（启动/错误日志仍保留）。
- **`STREAM_HOLD_DEFAULT 20→60`**：`/stream` 缺省 hold 也 60s（HDA 本就显式传 60），静默心跳统一 1 次/分；`protocol.py` docstring 同步。
## v0.1.00106（2026-08-15）——通道注册（吊牌 HDA P1）
- **新 `channels.py` ChannelRegistry**：照 SerialRegistry（Lock + 1s debounce + tmp+replace + 容错 load），落盘 `bridge/data/channels.json`；key = param→absolutePath、tag/hda→serial；register 幂等 upsert（保 registeredAt、刷 lastSeen）。
- **新 `channel_routes.py`** 4 端点：`PUT/GET /api/channels[/{channelId:path}]`（param 通道 URL 去前导"/"、段间保留，`:path` 捕获后服务端回加；id 与 ref 键不一致 400）、`POST /api/hda/{serial}/channels/heartbeat`（touch 该 serial 全通道）、`GET /api/channels/{channelId}/probe`（`_resolve_port` + `asyncio.to_thread(houdini_mcp.rpc, "nodes.get_node_info", timeout=4)` → alive/matched；**type 字段兼容实机字典形态 {name,label,category}**，合并期修正）。main.py 挂载（主进程粘合）。
- `state.py` +`self.channels`；`protocol.py` +`ChannelRef`（VERSION 未动）。`set_houdini_mcp` 对未注册 serial 不建条目 → 吊牌探测经 discover_first 兜底、不污染 HDA 场景列表（实机确认）。
- 测试 +20（registry 单测 + 裸 FastAPI 路由测试 + 本地 mcp stub + `_node_type_name` 变体）；pytest **130 全绿**。
- 实机：桥重启上线 0.1.00105，/api/channels 注册/探测/runtime 改参实测通过。
## v0.1.00107（2026-08-15）——项目注册（吊牌 HDA P2a）
- **protocol.py**：`PROJECT_SERIAL_RE`（`P1-<b36ms>-<4rand>`）、`generate_project_serial`/`is_valid_project_serial`、`ProjectRef`（projectSerial/label/createdAt/updatedAt/members: list[ChannelRef] 引用快照，live 状态以 /api/channels 为准）。
- **新 projects.py ProjectRegistry**：照 ChannelRegistry（Lock + 1s debounce + tmp+replace + 容错 load），落盘 `bridge/data/projects.json`；create（P1- serial、立即 force 落盘）/get/list（createdAt 升序）/add_member（按通道 key 去重替换、updatedAt 刷新）/remove_member/save_now。
- **新 project_routes.py** 6 端点：`POST/GET /api/projects`、`GET /api/projects/{id}`、`POST /api/projects/{id}/members`（body=ChannelRef 去重）、`DELETE /api/projects/{id}/members?channelId=`（**query 参数**，param 通道 key 含 "/"）、`POST /api/projects/ensure`（成员命中 created=False；否则 tag>hda 按 registeredAt 取首个建成员，大全无通道则 fallback kind:"hda" 占位，created=True）。main.py 挂载（主进程粘合）。
- 测试 +27（test_projects.py）；pytest **157 全绿**。
- 实机（8100 实例桥）：建项目/加 tag+param 成员/DELETE 成员/ensure 两分支（已存在复用 created=False、新 serial 隐式建项 created=True）全部实测通过。
## v0.1.00108（2026-08-15）——项目图端点（吊牌 HDA P2b）
- `snapshot.py` 新增项目图读写：`project_graph_path`（data_dir/projects/<pid>/graph.json，项目无单一 hip 不挂 hip 旁）/`read_project_graph`（缺失/损坏/非 dict→None）/`write_project_graph`（原子 tmp+replace + 内容对比跳过）；**既有函数零改动**。
- `project_routes.py` +`GET/PUT /api/projects/{projectId}/graph`（400/404；GET 缺省**迁移读**：恰 1 个 kind∈{tag,hda} 成员且 serial/hip 非空 → 其 serial 快照 graph 部分，纯读不写回）。
- 测试 +12（test_project_graph.py）；pytest **169 全绿**。实机：项目图 v3 PUT/GET 往返通过。
## v0.1.00109（2026-08-15）——轨迹 TraceStore + 全通道埋点（吊牌 HDA P3）
- **新 trace.py TraceStore**：内存环形 10000（deque maxlen 覆盖最旧）+ Lock 线程安全；`add`（ts/project="" v1/吞异常绝不 raise，零行为影响）/`list`（过滤 + ts 降序 + limit 钳 1..1000）/`count`/私有 `_filtered`（count 不受 limit 截断）。
- **新 trace_routes.py**：`GET /api/trace?project=&actor=&action=&channel=&target=&limit=` → `{events, count}`；project 过滤 = 成员关系解析（ProjectRegistry._channel_key 语义），非法/不存在项目 → 空。
- **埋点（6 处，全部 accepted/白名单通过分支，只加 trace 行）**：routes.put_inputs → hda-cook/inputs-push（digest=Σ点/prim）；routes.put_outputs 与 ws edit → web-gizmo/outputs-edit（out[idx] + rev）；houdini cmd → runtime-python/param-set|expr-set|command[:40]（target=node/parm）；houdini python → python-exec；channel register/heartbeat → tag-hda/register|heartbeat。state.py +`self.trace`；main.py 挂载（主进程粘合）。
- 测试 +18（test_trace.py：单测+路由+烟囱）；pytest **187 全绿**。
- 实机（8100）：runtime 改参 tx=2.0 → param-set 事件 + 吊牌自然 cook → heartbeat 事件（**审计链闭环**）；`?project=` 过滤命中成员 serial、伪造项目 → 空。
## v0.1.00110（2026-08-15）——非 geo 数据源通道 + apex 读写器（吊牌 HDA P4v1）
- **protocol.py**：ChannelRef +`adapter: str | None = None`（kind="data" 用）。
- **新 data_adapters 包**（`bridge/bridge/data_adapters/`，主进程合并期定名——原 `channels/` 包会遮蔽既有 channels.py 模块，CPython 包优先）：注册表 `ADAPTERS/get_adapter` + `apex_anim.py`（ApexAnimDataAdapter：经 `houdini_mcp.execute_python` 读写数据参数 `asData()/setFromData()`；**信封解包 = {success,executed,return_value} 取 return_value**，实机核实后修正；value 双重 json.dumps 嵌入防注入）。
- **channel_routes.py** +GET/PUT `/api/channels/{channelId:path}/value`（404/400 校验链、`_resolve_port`、无端口 HTTP 200+{ok:false,error}、只埋成功 data-get/data-set，actor=web-param）；`_key_of`/`_path_key`/`_find_channel` 支持 data（kind=param|data → absolutePath）；PUT value 路由前置声明（:path 吞后缀）。
- **channels.py / projects.py 键控规则修正（主进程契约锚点）**：`kind in ("param","data")` → absolutePath（协议锚点「kind=param/data → absolutePath」落地，消除迁移期兜底扫）。
- 测试 +7（test_data_channels.py，stub 实机双层信封）；pytest **194 全绿**。
- 实机（8100）：demo 场景建 `apex::sceneanimate` + 吊牌条目 `@apex-anim:…/animation` → data 通道注册（adapter=apex-anim）→ GET value 解包 `{"geometry":""}` → PUT 合法值 ok 且 Houdini asData 确认、非法值被 apex 拒绝（数据语义在目标端，适配器纯透传）→ 轨迹 data-get×2/data-set×1。
## v0.1.00111（2026-08-15）——参数通道值双向同步（P5a 参数同步极致化）
- **channel_routes.py**：`HeartbeatBody` +可选 `values: dict | None`（旧 HDA 缺省兼容）；heartbeat 非空 values → `await manager.broadcast(serial, {"type":"channel-values","values":...})`（**不回写内存、值不落地**），touch/trace 不变。
- **houdini_routes.py** +2 端点（timeline 旁）：`GET /api/hda/{serial}/channel-values`（通道源=大全 kind=param 且 serial 匹配；逐通道 `parameters.get_parameter`（timeout 4）、值宽容提取 `data.value`、失败/信封 error 跳过；**0.25s 整响应缓存**；无通道空 dict、无端口 ok:False）；`PUT /api/hda/{serial}/channel-values`（`values` 整 dict 替换 = **latest-wins**，`_get_set_interval` 节流 + `_CV_FLIGHT` single-flight + timer flush，逐项 `set_parameter`，失败 error trace 继续，成功后**不回显广播**，每项 trace web-param/param-set）。
- 测试 +12（test_channel_values.py）；pytest **206 全绿**。
- 实机（8100）：GET {tx:2.0,ty:0.0} → PUT {tx:5.25,ty:1.5} → Houdini 落地确认 → Houdini 侧改 tx=7.75 + 吊牌 cook 心跳捎带 → GET 读回 7.75；轨迹 param-set×2 + heartbeat。
