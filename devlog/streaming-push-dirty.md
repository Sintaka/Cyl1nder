> ⚠️ 状态注记（v0.1.00104）：讨论文档；push 门控 / 脏检查已按 (sig,frame) 落地（见 annotations-hda），其余留参考。

# 流式推送 dirty + 内存缓存讨论 / Streaming push-dirty & in-memory cache design

> 日期：2026-08-11
> 角色：并行子智能体（只读调研 + 新建本文；写集仅 `devlog/streaming-push-dirty.md`，禁止碰任何代码）
> 范围：用户原话「继续讨论流式传输如何应用，以及现在和 HDA 通信的方式，比如我们这边的 out 检测到前面被修改了，就直接 call HDA 中对应的 SOP python 并 dirty，尽量减少计算量，Cyl1nder 这边要做好内存缓存方案」。
> 方法：只读按序读 devlog（streaming-sync-gap / streaming-plan-b / sync-architecture / annotations-hda / protocol / decisions / streaming-hda-review / mcp-channel-proposals / nodeview-mcp-report / mcp/README）+ 只读源码（hda/src/cyl1nder_hda.py、cyl1nder_bridge.py、cyl1nder_serializer.py、scripts/build_hda.py；bridge/bridge/workspace.py、routes.py、ws.py、protocol.py、registry.py；web/src/main.ts、nodes2/network.ts、nodes2/graph.ts、stores/workspace.ts、viewport/geometry.ts、viewport/renderer.ts、bridge/client.ts、protocol/types.ts、protocol/compare.ts）+ grep 确认（`pending|dirty|recook|trigger|stream|topoId|bypass|fxhoudinimcp|8100|execute_python`）。
> **本轮仅讨论/设计，不实现。** 未改任何代码、未改其它 devlog；只新建本文（UTF-8 无 BOM，Node writeFileSync 写入）。

## 0. 一句话结论

**Cyl1nder 侧「out 检测到上游被改 → 直接 call HDA 对应 SOP python 并 dirty」可行，推荐主通道 = ① 把 HDA 的 30fps `/pending` 轮询升级为事件推送（bridge 新增长轮询 `/stream`，HDA 后台线程收事件 → 复用 `_schedule_recook` 调度，scheduled 门控保留防风暴）并叠加 ③ HDA 就绪缓冲 + topoId 不变只 `setPosition`；fxhoudinimcp（8100）能直执行 HDA 内 python（`execute_python` 对指定 SOP `cook(force=True)`/`bypass`/`hou.hda.reloadFile`）但按铁律只作 agent/开发调试通道，不进应用数据主链路；计算量靠「按 role 分桶 dirty + bypass 隔离 + position-only/setPosition 增量」最小化；内存缓存 = bridge 侧 per-index topoId/transform/delta ring（plan-b M1）+ web 侧 store 按 rev 去重 + 节点结果缓存（参数/拓扑/inputRev 变化才失效）。**

## 1. 现状（代码证据）

### 1.1 当前唯一链路：web 编辑/网络跑 → pushOutputs → bridge 存 → HDA 30fps 轮询 /pending → recook

```
web 编辑(viewport) ──pushOutputs([out])──> bridge PUT /outputs ──_same_content 去重 + rev++──> WS 广播 outputs
web 网络跑(runNetwork) ──computeOutputs x4──> pushOutputs(4 路) ──> 同上
bridge 存 workspace._outputs[index]（每 index 独立 rev + _output_rev 单调）
HDA _sync_loop（30fps，sync_fps 默认 30）GET /pending?since= ──pending && rev>last_seen && !scheduled──> _schedule_recook
  → hdefereval.executeDeferred → _force_cook_node：清 _OUT_CACHE、status=dirty、全部 python/blast/output 子节点 cook(force=True)
recook: cook(role) 主线程 _role_buffer（一次拉全量 4 路）→ _same_as_buffer 内容对比 → geo.clear() + _build_detail 全量重建
```

| 环节 | 位置（代码证据） | 粒度 / 成本 |
|---|---|---|
| web 编辑推输出 | `web/src/main.ts` L210-216（viewport edit 回调 `client.pushOutputs(store.serial, [out])`） | 单输出全量 JSON |
| web 网络跑 | `web/src/main.ts` L511-521 `runNetwork()` → `computeOutputs` → `pushOutputs` | 每次拓扑/参数/输入变化全量 4 路重算 + 推送 |
| bridge 存 | `bridge/bridge/routes.py` PUT `/outputs`；`workspace.py` `put_outputs`（`_same_content` echo 去重 + 每 index rev++） | ~1ms + 全量 JSON 编码；WS 全量广播 |
| HDA 轮询 | `hda/src/cyl1nder_hda.py` `_sync_loop` L131-155（interval=1/sync_fps；`scheduled` 门控 L150-151）；`cyl1nder_bridge.py` `pending_outputs` | 33ms 粒度；`scheduled` 门控把有效频率压到 ≈1/cook 时长 |
| dirty 调度 | `_schedule_recook` L157-165（hdefereval.executeDeferred）；`_force_cook_node` L167-187（清 `_OUT_CACHE`、status=dirty、子节点全 cook(force=True)） | 下一主线程空闲执行 |
| recook 拉取+重建 | `_role_buffer` L455-473（一次拉 4 路缓存）+ `cook(role)` L476+（`_same_as_buffer` → `geo.clear()` + `_build_detail`） | cook 主线程内全量 HTTP + 反序列化 + 全量重建 |

> 注：built 布局是 4 Python SOP（`cyl1nder_py0..3`，maintainstate=0）+ 4 Convert + 4 Output（`hda/scripts/build_hda.py` L126-152）；`cook_core()`（1-Python+blast）在源码中但未 build（docstring 属过时描述，以 build_hda.py 为准）。

### 1.2 「out 检测上游被改」目前没有任何直推 HDA 的通道

| 检测点 | web 现在的动作 | 有无直推 HDA |
|---|---|---|
| 输入内容变（HDA cook 推 inputs → WS inputs） | `inputsEqual`（`web/src/protocol/compare.ts`）→ auto-run 门控 → `runNetwork()` → pushOutputs 到 bridge | 无（只写 bridge，等 HDA 轮询） |
| 节点参数变（Param 面板提交 / Enter 变换） | `main.ts` L336 / L366 `runNetwork()` | 无 |
| 拓扑变（增/删/连线） | `onNetworkChanged` → `runNetwork()`（main.ts L193-195） | 无 |
| out 节点结果显示 | `computeNodeResult`（`nodes2/network.ts` L159-167）每次全链 trace + 重算 | 无（纯渲染） |
| HDA 侧 out（SOP） | — | Houdini 原生 dirty：`maintainstate=0`（build_hda.py L145）保证输入/参数变时 python SOP 自动重跑；但 **web 推来的 outputs 只有靠 `/pending` 轮询** |

结论：web→HDA 只有「web 改 outputs → bridge 存 → HDA 30fps 轮询 /pending → recook」这一条路；`/pending` 同时兼心跳（`registry.touch`，routes.py L129），事件化改造必须保留心跳语义（web `startHdaWatch` 依赖 `registry.lastSeen`）。

## 2. 目标方案：out 检测到上游被改 → 直接 call HDA 对应 SOP python 并 dirty

### 2.1 通道总览

| 通道 | 触发方 | HDA 内执行点 | 延迟 | 安全性 | 结论 |
|---|---|---|---|---|---|
| ① bridge→HDA 事件推送（长轮询 `/stream`） | bridge（web 编辑/网络跑后桥已存 outputs） | HDA 后台线程收事件 → 既有 `_schedule_recook`（hdefereval） | 事件即时（~1-5ms）替代 33ms 轮询 | 低：只传「有更新/哪些 role」，数据仍走既有 REST | **P0 主通道（推荐）** |
| ①′ bridge 加 `POST /api/hda/{serial}/trigger`（或 `/pending` 加 `roles` 新语义） | bridge/web | HDA `_sync_loop` 读到 roles → 按 role 过滤调度 | 仍受 33ms 轮询 + scheduled 门控 | 低 | 过渡项：`/stream` 前的轻量先手 |
| ② fxhoudinimcp 8100 直执行 HDA python | bridge 或 web（经 bridge 代理） | `execute_python` 注入：`node.bypass(False)` / `node.cook(force=True)` / `hou.hda.reloadFile` | 多一跳 RTT（bridge→8100→Houdini 内）；Houdini 主线程忙时排队 | **任意代码执行面**；依赖插件健康（曾 502）；8100 按 decisions.md 是 agent↔Houdini 控制通道非数据路径 | **不作应用主通道**；作 dev/调试/热重载/E2E 钩子 |
| ③ HDA 后台线程 + 就绪缓冲 | HDA 内（`_sync_loop` 改造或新 `cyl1nder_stream.py` 长轮询线程） | 数据写 `RoleReady` 就绪缓冲；cook 主线程只 `setPosition` | cook 主线程零网络零序列化 | 低（纯 stdlib urllib，铁律 6.8） | **P0（streaming-sync-gap P0 / plan-b M3）** |

### 2.2 通道①：bridge→HDA 事件推送（推荐主通道）

- 现状铺垫：bridge 在 `put_outputs` 接受后已知道「哪个 index 变了」（accepted buffers，`workspace.put_outputs` 返回），WS 已广播给 web；补一条给 HDA 的事件通道即可，数据仍走既有 `GET /outputs?since=` 拉取。
- 落地形态（B1，均不破坏心跳）：
  - **A. 长轮询 `GET /api/hda/{serial}/stream?from=&hold=`**（NDJSON，streaming-plan-b 0.5 / M1）：HDA 后台线程常驻 1 连接；bridge 有 accepted outputs 或 rev 变化 → 立即推 `{type:"outputs-changed", roles:[...], rev}`；hold=15 内 keepalive。`/pending` 心跳转移到 stream 连接或保留低频 `/pending`（如 1s）兜底 watchdog。
  - **B. HDA 直连 WS `/ws?serial=`**：Houdini 内置 Python 无 WS 依赖（铁律 6.8），需 stdlib 手写 WS 客户端或引依赖——**不采用**；B1 用 A。
- HDA 收到事件 → 复用 `_schedule_recook`（hdefereval.executeDeferred → `_force_cook_node`）；`scheduled` 门控保留：事件合并 latest-wins，`scheduled=True` 期间丢弃重复事件，防 recook 风暴。
- BridgeClient 扩展：`wait_outputs()` 长轮询返回 `(roles, rev, reset)`；「trigger recook」语义 = 「数据已在 bridge，事件已到，recook 时按 roles 拉取」。
- 协议注意：新端点/字段按铁律 #3 三处同步（`bridge/bridge/protocol.py` / `web/src/protocol/types.ts` / `devlog/protocol.md`）。

### 2.3 通道②：fxhoudinimcp（8100）直执行 HDA python——评估

| 项 | 结论 |
|---|---|
| 能力 | 官方 fxhoudinimcp v2.10.0（`mcp/README.md`）：Houdini 内插件 hwebserver HTTP MCP 默认端口 8100（被占自动 8101+），外部 `python -m fxhoudinimcp` stdio ~188 工具，含 `execute_python` / `get_node_info` / `get_parameter_schema` / `get_node_errors_detailed`；HTTP 直连 `POST http://127.0.0.1:8100/api`（`json=["mcp.health",[],{}]`，Content-Type application/x-www-form-urlencoded）或 `from fxhoudinimcp.bridge import HoudiniBridge` |
| 能否触发指定 SOP python 并 dirty | **能**：`execute_python` 执行如 `hou.node("/obj/geo1/Cyl1nder1/cyl1nder_py2").cook(force=True)`、`node.bypass(False)`、`hou.hda.reloadFile(path)`；Houdini 主线程内执行即标记 dirty 并重跑（等价于 Force Cook 回调，build_hda.py L22-25） |
| 延迟 | 同步 JSON-RPC：bridge/web → 8100 HTTP → Houdini 主线程执行 → 返回；RTT ms 级，但 Houdini 主线程忙（大 cook）时排队等待，与「减少计算量」目标相悖 |
| 安全性 | `execute_python` = 任意代码执行：桥/网页被攻破即可控制 Houdini 进程；bridge 事件循环不能直接 await 阻塞调用（需线程池/任务隔离） |
| 可用性 | 依赖 Houdini 内插件在线（`hda/scripts/bridge_control.py` 曾记录 8100 502，需重启 Houdini 恢复）；多 Houdini 实例时 8100/8101+ 归属不确定 |
| 与铁律关系 | decisions.md：「8100 是 agent↔Houdini 控制通道，不是应用数据路径」；AGENTS.md 铁律绑定的用法是 agent↔Houdini 控制 |
| **结论** | 可行但不作应用数据主链路：数据路径仍走 ①；8100 保留给开发/调试/运维（`reload_hda.py` 热重载、手动 dirty、E2E 注入验证）；若 web 需要经桥代理（`POST /api/hda/{serial}/houdini/exec`），只允许白名单模板（role 参数化），不暴露任意 code |

### 2.4 通道③：HDA 后台线程 + 就绪缓冲（P0）

- 现状：已有后台线程（`BridgeClient._pump` 防抖 0.12s 推输入、`_sync_loop` 30fps 轮询）但**拉取/反序列化/重建全在 cook 主线程**（streaming-hda-review #7）。
- 目标（streaming-plan-b 0.10 / M3，`hda/src/cyl1nder_stream.py` 纯 stdlib）：
  - 后台消费线程长轮询 `/stream`（或通道①事件）→ 拉 outputs → 反序列化 → 写就绪缓冲 `RoleReady`（双缓冲/latest-wins，每 role 一份 `{topoId, points, curves, faces, streamRev}`）；
  - cook 主线程只取缓冲最新：topoId 与已应用一致 → 对变化点 `setPosition`（不 clear+rebuild）；topoId 变 → 整体重建；周期内容对账自愈（`_same_as_buffer` 既有逻辑保留）；
  - `_OUT_CACHE` / `_CORE_CACHE` 退化为 REST fallback 路径。

## 3. 减少计算量：dirty 最小化

| # | 手段 | 现状 | 目标 | 落点 |
|---|---|---|---|---|
| 3.1 | 按 role 分桶 dirty | `_force_cook_node` 遍历全部 python/blast/output 子节点 `cook(force=True)`（cyl1nder_hda.py L182-185） | 事件/trigger 带 `roles`，只 recook 受影响 role 的 SOP；bridge `put_outputs` 已知道 accepted index | 通道①负载 + `_force_cook_node(roles)` 过滤 |
| 3.2 | bypass 隔离 | web 有 `bypass` flag（`nodes2/graph.ts` NodeFlags）但只 UI 态，不参与网络/HDA | bypass 节点不参与 `computeOutputs`/结果重算、不 dirty 下游；HDA 侧对应 SOP 走 Houdini 原生 bypass（零 python） | network.ts 跳过 bypass 链；trigger 对 bypass role 不发 |
| 3.3 | position-only 更新 | 任何变化 `geo.clear()` + `_build_detail` 全量重建 | topoId（点/prim/曲线/属性结构）不变 → 只 `setPosition` 变化点（HDA）；web 侧 `applyOutputDelta` 稀疏更新 position attribute / 应用 matrix | HDA cook 快速路径（M3）；web geometry.ts（M2） |
| 3.4 | topoId 不变只 setPosition | 无 topoId | OutputBuffer 加 `topoId`/`transform`；bridge `diff_output` 产 delta `[{i,p}]`（稠密≥50% 退化 snapshot） | M1（plan-b 0.1-0.4） |
| 3.5 | 内容去重 + 自愈兜底 | `_same_content`（bridge）/ `_same_as_buffer`（HDA） | 保留；增量路径失败/失配 → 整体重建（sync-architecture 铁律：决策一律基于内容） | 既有 + M1/M3 |
| 3.6 | 事件合并 | `scheduled` 门控（recook 期间丢事件） | 保留 latest-wins；防 60/120fps delta 风暴 | `_sync_loop`/stream 线程 |

## 4. Cyl1nder 内存缓存方案

### 4.1 bridge 侧 outputs 缓存（现状 + 增量设计）

现状（`bridge/bridge/workspace.py`）：`Workspace._outputs: dict[int, OutputBuffer]` 按 index 缓存最新 + 每 index 独立 rev + `_output_rev` 单调；`_same_content` echo 去重；`get_outputs_since`（`since>rev → 全量`）作 HDA 增量拉取与桥重启自愈。

增量缓存设计（对齐 plan-b M1，扩展 `workspace.py`）：

| 字段 | 设计 | 说明 |
|---|---|---|
| 缓存键 | `(serial, index)` | 每输出一路独立 |
| `topoId` | 拓扑签名（点数/prim/曲线结构/属性结构/宽度，round6） | topoId 不变 ⇔ 可只传位置 |
| `transform` | 可选 4x4 / 平移向量 | 整体变换变化走 transform 而非逐点 |
| `base` | 最新 snapshot（points 引用） | diff 对比基准 |
| `deltaRing` | `deque[(streamRev, [{i,p}])]`，容量 512 | `/stream?from=` 重放 |
| `streamRev` | per-serial 单调 | 与 `_output_rev` 解耦的流序号 |

diff 决策（与 plan-b 1.2 一致）：拓扑变 / 非 P 属性变 / 变化点 ≥50% → snapshot；仅 P 变且 <50% → delta；内容相同 → 不产消息（echo 去重既有）。
失效：`put_outputs` 接受 → 按规则产 snapshot/delta 入 ring；bridge 重启 → workspace 归零（内存），HDA 端 `since/from` 重置语义（`get_outputs_since since>rev→0`、`/stream from=0` 全量重放）保留。
与 HDA 进程内缓存关系：`_OUT_CACHE`（HDA 侧 per-serial 4 路缓存）在 M3 就绪缓冲接管后退化为 REST fallback（streaming-hda-review 补充注意）。

### 4.2 web 侧 store 缓存 + 节点结果缓存

store 现状（`web/src/stores/workspace.ts`）：`inputs`/`outputs` 按 index 覆盖 + `inputRev`/`outputRev`；`upsertOutputs` latest-wins；`inputsEqual` 去重（compare.ts）；renderer 已按 rev 去重重建（renderer.ts L249-265：`lastInputRev`/`lastOutputRev` 不变则不清不建）。

节点结果缓存（新，`nodes2/network.ts` `computeNodeResult` L159-167 每次全链 trace + `applyTranslateGrouped` 重算；`showNodeResult` 每次调用重建 group，renderer.ts L304-316）：

| 项 | 设计 |
|---|---|
| 缓存键 | `(nodeId, inputRev, paramSignature, topoEpoch)` |
| `paramSignature` | 该节点及其上游链节点 params 稳定序列化（按名排序的 tx/ty/tz/group/class） |
| `topoEpoch` | graph 拓扑版本号：`onNetworkChanged`（增删节点/连线）时 `++` |
| 失效 | 参数提交 → 只 invalidate 该节点及下游链节点；拓扑变 → 全清；`inputRev` 变 → 按依赖输入端口清 |
| 复用 | `runNetwork` 的 out 链末端节点结果 = 对应 out buffer，可复用 per-node 缓存避免重复 trace |
| 预算 | Map 上限（如 256 项）+ LRU；节点删除时清理 |

### 4.3 缓存键 / 失效策略汇总

| 层 | 缓存 | 键 | 失效 |
|---|---|---|---|
| bridge workspace（现状） | outputs 按 index | `(serial, index)` | `put_outputs` 接受时覆盖；`_same_content` 相等不写 |
| bridge 增量（M1） | deltaRing / topoId / transform | `(serial, index)` + `streamRev` | ring 满 512 滚动；bridge 重启归零（from=0 重放） |
| HDA 进程内（现状） | `_OUT_CACHE` / `_CORE_CACHE` | `serial` | `_force_cook_node` 清；M3 就绪缓冲接管后转 fallback |
| HDA 就绪缓冲（M3） | `RoleReady` per role | `serial` + `role` + `topoId` | latest-wins 覆盖；topoId 失配重建；周期内容对账 |
| web store（现状） | inputs / outputs | 按 index + rev | WS 消息覆盖；`inputsEqual` 去重；renderer 按 rev 去重 |
| web 节点结果（新） | node result | `(nodeId, inputRev, paramSignature, topoEpoch)` | 参数/拓扑/inputRev 变化（见 4.2） |

## 5. 讨论结论（推荐架构）

| 优先级 | 动作 | 依赖 | 收益 |
|---|---|---|---|
| **P0** | ① 事件推送：bridge `GET /stream` 长轮询（或先 `/pending` 加 `roles`）+ HDA 后台线程收事件 → `_schedule_recook`（scheduled 门控保留）；心跳语义转移/保留 | 无（纯 bridge + hda/src，hython 冒烟可测，`reload_hda.py` 热更） | 直推 dirty：33ms 轮询 → 事件级（~1-5ms）；按 role 分桶减少 recook 面 |
| **P0** | ③ HDA 就绪缓冲 + cook 快速路径（topoId 不变只 setPosition）+ 内容对账 | 不依赖 M1（无 topoId 时保守整点比对） | cook 主线程零网络零全量重建；视口不闪 |
| **P1** | M1 diff/stream 协议（topoId/transform/delta/ring）+ M2 web 增量消费（`applyOutputDelta` + 节点结果缓存） | P0 后 | 稀疏传输/稀疏渲染；10k 点拖动 ≥30fps |
| P2 | B2 native core（msgpack / sidecar 8377） | B1 三端全绿 | 常数级加速 |
| 辅助 | ② fxhoudinimcp 8100 仅 dev/调试（reload_hda、手动 dirty、E2E 注入），数据主链路不走 8100 | Houdini 插件在线 | 开发/排障效率 |

缓存配合：bridge ring（流重放）→ HDA 就绪缓冲（latest-wins）→ web store + 节点结果缓存（按 rev/参数/拓扑失效）；三层都以「内容对比自愈」兜底（`_same_as_buffer` / `get_outputs_since since>rev` / `/stream from=0`），不依赖 rev/topoId 簿记作「是否重建」的唯一依据（sync-architecture 铁律）。

铁律核对：协议改动三处同步（protocol.py / types.ts / protocol.md）；单桥 8375 + serial 路由；HDA 侧纯 stdlib urllib（6.8）；serial 创建即不可变；`maintainstate=0` + `_force_cook_node` 的 dirty 语义不变，只加「事件触发」；**本轮仅讨论/设计，不实现**。

## 6. 风险 / 注意

| # | 注意 |
|---|---|
| 6.1 | 心跳：`/pending` 兼 `registry.touch`；事件化后 web `startHdaWatch`（registry.lastSeen）依赖必须保留（stream 连接心跳或低频 `/pending` 兜底） |
| 6.2 | 并行 agent 正在改 web/bridge 源码；本文只读 + 新建，落地前确认文件归属（尤其 renderer.ts / graph.ts / protocol.py / routes.py） |
| 6.3 | `_force_cook_node` 全子节点 cook 改按 role 过滤时不能漏 blast/output（Houdini SOP 缓存语义：4 口询问 4 次但网络 1 次由 `_role_buffer` 保证） |
| 6.4 | fxhoudinimcp 8100 执行任意代码有安全面；即使走 dev 通道也只给白名单模板 |
| 6.5 | topoId 落地前（P0 ③ 保守路径）无 topoId 时只 setPosition 不安全 → 保留整点内容比对（`_same_as_buffer`） |
| 6.6 | 内容对比只覆盖 points+curves（既有 v1 简化，faces/attrs-only 变化不捕获）——增量落地时把 faces/attrs 纳入拓扑签名 |
| 6.7 | built 布局是 4-Python SOP（非 `cook_core`）；所有 HDA 侧改动以 `build_hda.py` 实际构建路径为准，避免改错函数 |

## 7. 本轮只读调研，未改代码

- 新建：`devlog/streaming-push-dirty.md`（本文，UTF-8 无 BOM，Node writeFileSync 写入）。
- 未触碰：`bridge/`、`web/`、`hda/` 源码；未改其它 devlog；工作树其余未跟踪文件 `web/overview.html` 属其他并行 agent，非本写集。

## 8. /stream 长轮询取代 /pending 轮询（计划，v0.1.00052 候选）

> 追加日期：2026-08-12
> 角色：并行子智能体（bridge/HDA 流式优化写集；本小节**仅计划不实现**）
> 用户原话：「过于密集的动捕同步不了，而无数据的稀疏又有开销……搜索合适的技术栈」；「轮询端口的速度明显变快了……减少通讯流量和计算开销，做到即用即更新，我始终认为轮询是没有必要的」
> 前置（同写集已落地 v0.1.00051）：HDA `_sync_loop` 自适应轮询（活跃 ~33ms / 空闲退避 500ms，`/pending` 心跳保留）+ bridge `POST /api/hda/{serial}/kick`（一次性 force → `/pending` 返回 `force:true` → HDA 无 rev 变化也 recook，自愈「首次拉起桥时失败 push → offline」）。

### 8.1 技术栈对比

| 方案 | 连接形态 | Houdini 侧依赖 | 结论 |
|---|---|---|---|
| WebSocket | 全双工长连接 | Houdini 内置 python 无 WS 依赖，需第三方库 | 排除：违背「HDA 纯 stdlib urllib」铁律，为单向推送引入双向协议复杂度 |
| SSE（Server-Sent Events） | HTTP 流，连接常驻 | urllib 可 stream-read，可行 | 可行但连接常驻 + 需解析 `data:` 帧；Houdini 侧超时/重连逻辑更重 |
| **NDJSON 长轮询**（推荐） | 短请求：有事件立即返回一条 JSON；无事件 hold 到超时返回空 | urllib 最简（read timeout 略大于 hold，`json.loads` 即用） | **推荐**：沿用 plan-b / stream 的 since+rev 语义，HDA 侧零新依赖 |

### 8.2 设计（bridge 端）

- `GET /api/hda/{serial}/stream?since=&hold=15`：注册等待者（asyncio.Event / condition）。
  - outputs rev 变化或 kick/force 触发 → 立即返回一条 NDJSON：`{type: "outputs"|"kick", rev, force, outputs?}`（事件级 ~ms）。
  - 否则 hold 至 `hold`（15-30s）超时 → 返回空；`since` 语义与 `/pending` 一致（`since > rev` → reset，返回全量）。
- 心跳：由长轮询连接本身维持——连接在即 HDA 活；每次 stream 请求到达时 `registry.touch(serial)`。
- 兼容：保留 `/pending`（自适应轮询）作 fallback；`/stream` 与 `/pending` 共享 `force` 一次性标记。

### 8.3 设计（HDA 端）

- urllib 长轮询：`urlopen(..., timeout=hold+1)`；有事件 → `json.loads` → `_refresh_ready` + `_schedule_recook`（`scheduled` 门控保留防风暴）。
- 无事件超时 / 连接断开 → **立即重连**（不 sleep 33ms）。
- 新 serial 或 stream 连续失败 → 回退到现有自适应 `/pending`。

### 8.4 收益预估

| 指标 | /pending 轮询（现状） | /stream 长轮询（目标） |
|---|---|---|
| 空闲流量 | 20-30 次/秒（fast 33ms；空闲退避后 ~2 次/秒） | ~0（无事件零请求） |
| 同步延迟 | 33ms 轮询粒度（+ scheduled 门控） | 事件到达即推（~ms 级） |
| 动捕场景 | 事件率被轮询上限压住，密集更新丢失 | 事件率 = 实际变化率（稀疏零开销、密集即用即更新） |

### 8.5 范围标注

**本轮仅计划不实现**（大改：独立分支 + 专题 devlog + 三处协议同步 protocol.py / types.ts / protocol.md）。落地拆两步：先 `/stream`（bridge + HDA 后台线程 + hython 冒烟），再评估是否移除自适应 `/pending`（建议保留作 fallback）。

### 8.6 落地（v0.1.00056）

> `/stream` 已实现并成为 HDA 主同步通道，心跳与数据轮询解耦，详见 [sync-heartbeat-redesign.md](sync-heartbeat-redesign.md)。自适应 `/pending` 保留作 fallback；web 离线判定改 150s 慢时钟；hython 冒烟 + pytest + e2e 全绿。
