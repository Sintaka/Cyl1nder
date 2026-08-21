> ⚠️ 状态注记（v0.1.00104 归档）：bridge⇄HDA 流式现状调研；落地状态以 annotations-bridge / annotations-hda 为准。

# bridge⇄HDA 流式传输计划落地现状（只读调研）

> 调研日期：2026-08-11
> 范围：对照 `devlog/streaming-plan-b.md`（方案 B：snapshot+delta 流式、ring 重放、topoId、HTTP chunked 长轮询、B1 纯 Python → B2 native core、里程碑 M1–M6），盘点 bridge⇄HDA 流式落地现状。
> 方法：按序读 devlog（streaming-plan-b / livelink-roadmap / sync-architecture / annotations-hda / decisions / protocol）+ 只读源码（bridge: protocol/workspace/routes/ws/state/compute；hda: cyl1nder_hda/cyl1nder_bridge/cyl1nder_serializer/hython_smoke）+ grep 确认（`stream|topoId|diff|ring|chunked`）。**本次只读调研，未改任何代码。**

## 1. 一句话结论

**方案 B 仍停留在「设计定稿」阶段，里程碑 M1–M6 全部未开始实现。** 桥↔HDA 流式（snapshot+delta / diff_output / ring 重放 / topoId / GET /stream 长轮询 / HDA 后台消费线程 + 就绪缓冲 / latest-wins / 5s 内容对账）在当前三端代码里**零落地**：grep `topoId`、`streamRev`、`diff_output`、`chunked`、`/stream`、`STREAM_*`、`cyl1nder_stream` 均无命中；协议仍停在 v1 的 REST 拉取 + WS `inputs/outputs` 全量广播 + HDA 30fps 轮询 + 全量 clear+rebuild。**要打通桥↔HDA 流式，缺口就是方案 B 的 B1 三步本身（M1 bridge 协议+diff+流端点 → M2 web 增量消费 → M3 HDA 流消费），B2 native core 更是后置未动。**

## 2. 现状盘点表（对照 streaming-plan-b 里程碑/协议要素）

| # | 方案 B 要素 | 状态 | 现状（代码证据） |
|---|---|---|---|
| 1 | snapshot+delta 流消息（统一信封 v/proto/type/serial/streamRev/ts/payload） | 未实现 | `protocol.py`（v0.1.00041）无 Stream 模型与常量；WS 仅 `hello/inputs/outputs/pong`（ws.py）；REST 仅 `outputs?since=`；`types.ts` 的 `WsServerMessage` 也只有 hello/inputs/outputs/pong |
| 2 | `diff_output`（生产者侧 diff，1.2 规则） | 未实现 | `workspace.put_outputs` 只有 `_same_content` echo 去重 + rev++；无 `topology_changed` / `changed_indices` / `DELTA_DENSE_RATIO` / Snapshot / Delta 产出 |
| 3 | ring 重放缓冲（`STREAM_RING=512` + `from=` 续传/超界重放） | 未实现 | 无 `stream_ring` / `stream_rev`；唯一 ring 是 `LogRing`（日志，无关）；当前重放等价物是 `get_outputs_since`（`since>rev` 时返回全部） |
| 4 | `topoId` / `transform` 字段（OutputBuffer 扩展） | 未实现 | `protocol.py` 与 `types.ts` 的 `OutputBuffer` 均无 `topoId`/`transform`；无 topoId 校验逻辑 |
| 5 | `GET /api/hda/{serial}/stream`（NDJSON chunked 长轮询） | 未实现 | `routes.py` 无 `/stream`；HDA 只用 `/pending` + `/outputs` REST 拉取 |
| 6 | HDA 后台消费线程 + 就绪缓冲（`cyl1nder_stream.py` / `RoleReady`） | 部分实现（形态不同） | 已有后台线程：`BridgeClient._pump`（防抖 0.12s 推输入）、`_sync_loop`（30fps 轮询 `/pending` 调度 recook）；但无流式消费线程、无 `RoleReady` 就绪缓冲、无 latest-wins 合并、无 topoId 校验 |
| 7 | cook 快速路径「拓扑首建、后续只 `setPosition`」 | 未实现 | 每次拉回都在 cook 主线程全量 `_build_core_detail` / `_build_detail`（`geo.clear()` + 重建）；仅靠 `_CORE_CACHE` / `_same_as_buffer` 内容对比避免「无变化时重建」 |
| 8 | latest-wins（丢中间帧、追最新） | 部分实现 | web `store.upsertOutputs` 按 index 覆盖最新 buffer；HDA `_OUT_CACHE`/`_CORE_CACHE` 保留最新一份；但「流场景合并 delta 只留最新」的机制不存在（因为根本没有流） |
| 9 | 周期 5s 内容对账（流空闲自愈） | 部分实现 | `_same_as_buffer` 每次 cook 全量内容对比（比 5s 更频繁、兜底更强，但绑定 cook 而非流空闲周期）；`_maybe_snapshot` 的 5s 节流是磁盘快照写入，不是对账 |
| 10 | B1 里程碑 M1（bridge 协议+diff+流端点） | 未实现 | 无 diff/重放/长轮询实现与 pytest 覆盖（tests/ 现有 test_workspace/test_routes 均无 stream/diff 用例） |
| 11 | B1 里程碑 M2（web 增量消费） | 未实现 | `viewport/renderer.ts` `outputGroup.clear()` + `buildOutputs` 全量重建；无 `applyOutputDelta` / position attribute 稀疏更新 |
| 12 | B1 里程碑 M3（HDA 流消费 + 自愈） | 未实现 | 无 `hda/src/cyl1nder_stream.py`；`hython_smoke.py` 无流用例 |
| 13 | B2 compute/backend 元数据 + native core（M4–M6） | 未实现 | `compute/__init__.py` 仅 `name` 注册、`list_executors()` 返回名字、`run_node` 无 `prefer`/`backend`；无 `native/` crate、无 `SidecarClient`、无 8377 |
| 14 | 既有基础（方案 B 依赖、已就绪） | 已实现 | bridge `_same_content` echo 去重；web `inputsEqual` + 重连回放门控；`/pending` reset + `get_outputs_since(since>rev→0)`；`round(x,6)` 统一（serializer / `_same_as_buffer`）；HDA 端 urllib 纯 stdlib 桥客户端；内容对比自愈铁律（sync-architecture） |

## 3. 当前实际链路（v1，非流式）

```
HDA cook ──serialize_input×4──> PUT /inputs（防抖线程）──> bridge 存 inputs + inputRev++
web WS 收 inputs ──auto-run（inputsEqual 门控）──> PUT /outputs（全量 OutputBuffer）
bridge put_outputs ──_same_content 去重──> rev++ ──WS 广播 outputs 全量──> web store.upsertOutputs ──renderer 全量 clear()+buildOutputs
HDA _sync_loop（30fps）GET /pending?since= ──dirty──> hdefereval 强制 recook
HDA cook 主线程 GET /outputs?since=0（全量）──_CORE_CACHE/_same_as_buffer 内容对比──> geo.clear() + 全量重建（blast 拆分 out0..3）
```

1. **HDA cook**（`cyl1nder_hda.cook_core()`；legacy `cook(role)` 同理）：`auto_push` 序列化 4 输入 → `BridgeClient.push_inputs`（防抖后台线程）；`ensure_sync` 启动 `_sync_loop`（`sync_fps` 默认 30 ≈ 33ms 粒度）轮询 `/pending`，`pending && rev>last_seen` → `_schedule_recook`（`hdefereval.executeDeferred` → `_force_cook_node`）；`auto_pull` 在 **cook 主线程内同步网络**：`_snapshot_parts` → `pull_outputs(0)` 全量拉 4 路 → `_build_core_detail`（签名对比后 `geo.clear()` + 全量重建 merged detail + `cyl1nder_role` prim 属性 → 4 个 blast 拆 out0..3）。legacy 路径：`_role_buffer` 一次拉 4 路缓存 → `_same_as_buffer` → `geo.clear()` + `_build_detail`。
2. **bridge**：`put_outputs`（REST PUT 或 WS `edit`）→ `_same_content` echo 去重 → rev++ → WS 广播 `outputs` 全量 buffer → `_maybe_snapshot`（5s 节流写磁盘快照）。
3. **web**：WS 收 `inputs` → `store.setInputs` → auto-run（`inputsEqual` 门控，重连首次视为回放）→ `client.pushOutputs` 全量 → 收 `outputs` → `upsertOutputs`（按 index 覆盖）→ `renderer` `outputGroup.clear()` + `buildOutputs`（全量重建 line/mesh/points）。

**与方案 B 的差距：**
- **全量重建**：HDA 与 web 两侧每次内容变化都 clear+rebuild（视口频闪、更新量大）；方案 B 目标是「拓扑只建一次、后续只 `setPosition` / 稀疏更新 position attribute」。
- **轮询粒度**：HDA 端 33ms 轮询 `/pending`，事件到达延迟 = 轮询间隔 + recook 调度；方案 B 是 `/stream` 长轮询（hold=15 内即时推送，~1–5ms 级）。
- **无增量**：每轮全量传 points/curves/faces；方案 B 是稀疏 delta `[{i,p}]` 或 `transform`。
- **cook 主线程负担**：pull 的 HTTP + 反序列化 + 全量重建仍在 cook 主线程（push 已线程化）；方案 B 是后台消费线程 + 就绪缓冲，cook 只 `setPosition` 变化点。
- **无 topoId/streamRev**：现在靠 rev + 内容对比自愈（正确性没问题，但拿不到「增量应用」能力，也就消不掉全量重建）。

## 4. Gap 与下一步（按优先级）

### 4.1 B1 最小可落地清单（建议顺序 M1 → M2 → M3，端到端 <15ms / 无 clear+rebuild）

**M1（bridge：协议 + diff + 流端点）——最高优先级，三端协议的地基**
- 涉及文件：
  - `bridge/bridge/protocol.py`：`OutputBuffer` 加 `topoId:int=0`、`transform:list[float]|None=None`；新增 Stream 消息模型与常量（`STREAM_RING=512`、`STREAM_HOLD=15`、`DELTA_DENSE_RATIO=0.5`）。
  - `bridge/bridge/workspace.py`：`put_outputs` 内接 `diff_output`（纯 Python，规则照 1.2）；维护 `stream_ring` / `topo_ids` / `stream_rev`。
  - `bridge/bridge/routes.py`：新增 `GET /api/hda/{serial}/stream?from=&hold=`（NDJSON 行流：重放 → 实时推送 → keepalive；每 serial 挂起者限 1）。
  - `bridge/bridge/ws.py`：广播改发 `snapshot`/`delta`（B1 期保留 `outputs` 别名）。
  - 同步 `web/src/protocol/types.ts` + `devlog/protocol.md`（铁律 #3）；`bridge/tests/test_workspace.py` / `test_routes.py` 补用例。
- 验收：pytest 全绿；diff 单测（拓扑变→snapshot、点位变→delta、内容同→不产出、稠密≥50%→snapshot、transform）；`/stream` `from=0` / `from=旧` / `from=超界` 重放；hold 内即时推送 + keepalive。

**M2（web：增量消费）**
- 涉及文件：`web/src/protocol/types.ts`（Stream 类型）；`web/src/viewport/geometry.ts`（`applyOutputDelta`：稀疏更新 position attribute + `needsUpdate`，或应用 matrix）；`web/src/stores/workspace.ts`（消费 snapshot/delta）；`web/src/viewport/renderer.ts`（不再全量 clear()+buildOutputs）。
- 验收：`tsc --noEmit` + vitest；单点编辑只产 delta（bridge 日志），视口不重建不闪；10k 点拖动 ≥30fps。

**M3（hda：流消费 + 增量应用）**
- 涉及文件：`hda/src/cyl1nder_stream.py`（新，纯 stdlib：`StreamState`/`RoleReady`/`ensure_stream` 后台线程 + topoId 校验 + latest-wins 合并 + 指数退避 1s→5s）；`hda/src/cyl1nder_hda.py`（cook 改 3.2 快速路径：topoId 变 → 重建，不变 → 只 `diff_indices` `setPosition`；周期自愈 `SELF_HEAL_SEC=5`；REST pull 保留为 fallback）。
- 验收：`reload_hda.py` 免重启热更；`hython_smoke.py` 补流用例（建拓扑、delta 应用、topoId 失配重建）；E2E web 编辑 → Houdini 视口 <15ms、bridge 日志无 clear+rebuild、10k 点增量 cook <2ms；断线/桥重启自愈。

### 4.2 B2 native core 后置条件（M4–M6，B1 三端全绿后再动）
- **M4**：`native/` Rust crate（私有 sidecar 127.0.0.1:8377，长度前缀 msgpack 帧）+ `bridge/bridge/compute/native_client.py`（SidecarClient / NativeSidecarExecutor / 健康+退避重启）+ `compute/__init__.py` 加 `backend` 元数据与 `resolve`/`prefer`。
- **M5**：`stream_diff` 与几何编解码迁入 core；Python 参考实现 vs core fuzz 对拍 1000 组；diff <0.5ms。
- **M6**：WS/REST stream 编码由 core 产出（`proto:"msgpack"` 可选开关）；发行打包 `dist/` = bridge + core exe + Vite dist + 薄壳 HDA；端到端 <10ms。
- 前置条件：B1 验收全绿；协议版本 M1 升 0.2.x，B2 不升协议版本（只换实现、协议不变）。

## 5. 风险 / 注意（从 streaming-plan-b §6 提炼 + 现状补充）

| # | 风险 | 落地时注意 |
|---|---|---|
| 6.8 | Houdini 内置 Python 无 WS 依赖 | B1 必须用 stdlib `urllib` 长轮询（现有 `BridgeClient` 已是 urllib，直接扩）；勿引入 websocket-client 等新依赖 |
| 6.2 | cook 主线程再次被网络/序列化拖慢 | 消费线程永不碰 `hou`；cook 只从就绪缓冲取 latest 并 `setPosition` 变化点；现状 pull 还在 cook 主线程，M3 必须移走 |
| 6.5 | 浮点乒乓（桥判变/HDA 判不变） | diff 与 apply 统一 `round(x,6)`（`serializer` / `_same_as_buffer` 已 round 6，`diff_output` 必须一致）；内容相同不产消息（echo 去重保留） |
| 6.11 | web 回显再次污染 | 保留 bridge `_same_content` 与 web `inputsEqual`/重连回放门控；auto-run 门控不能因流改动被拆掉 |
| 6.1 | 拓扑失步（delta 应用到不同拓扑） | topoId 校验失配即整体重建；周期 5s 内容对账（`_same_as_buffer` 现成）；delta 应用异常 → REST 全量 pull |
| 6.3 | 桥重启 rev/streamRev 重置 | hello 检测 `streamRev` 倒退 → `from=0` 全量重放；现有 `/pending` reset 语义保留 |
| 6.4 | 高帧率 delta 风暴 | 稀疏 delta + 稠密退化为 snapshot；latest-wins 丢中间帧；`sync_fps` 上限保留（mocap 可 60/120） |
| 6.12 | 长轮询连接风暴 | hold=15 + keepalive 复用连接；bridge 对每 serial stream 挂起者限 1；断线指数退避 1s→5s |
| 6.10 | 三端协议漂移 | protocol.py / types.ts / protocol.md 三处同步（铁律 #3），M1 一步到位，typecheck 纳入 verify |
| 6.9 | Rust 工具链缺失 | B1 不依赖 native，先行收益不受影响；B2 卡住可走 C++20 切换条件（2.3） |

**补充注意（现状相关）：**
- 当前工作区有未提交的 web 改动（`web/src/app/dock.ts`、`web/src/nodes2/graph.ts`、`web/src/viewport/renderer.ts`、`web/src/app/param.ts` 未跟踪），与本调研无关；落地 B1（尤其 M2 改 renderer）前先确认归属，避免踩到并行修改。
- `_CORE_CACHE` / `_OUT_CACHE` 是进程内 REST 缓存；M3 落地后与「流就绪缓冲」的关系要理顺——就绪缓冲接管后，REST 缓存退化为 fallback 路径（3.2 的「原逻辑原样保留」）。
- 协议 v1 的 `OutputBuffer` 缺 `topoId`/`transform` 是**新增可选字段**（旧端忽略即可），M1 不需要破坏性变更；但 WS `outputs` 广播的退役（M3 末）要等 web 端迁移完 snapshot/delta 再执行。

## 6. 本次只读调研，未改代码

- 新建：`devlog/streaming-hda-review.md`（本文）。
- 更新：`devlog/streaming-plan-b.md` 仅头部加「落地现状」说明（正文未动）。
- 未触碰：`bridge/`、`web/`、`hda/` 源码；其他 devlog 文件（`README` / `annotations-*` 由主进程合并时更新）。