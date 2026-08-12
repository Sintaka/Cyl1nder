# 流式同步差距分析 / Streaming sync gap analysis

> 日期：2026-08-11
> 范围：用户反馈「HDA 设置 sync_fps=30 同步上限，简单 transform 仍做不到接近无缝」——盘点当前同步链路延迟构成、根因，并给出与 `streaming-plan-b.md`（B1/B2）、`livelink-roadmap.md`、`sync-architecture.md`、`streaming-hda-review.md` 对齐的可落地改进方向与优先级。
> 方法：只读按序读 devlog（streaming-hda-review / streaming-plan-b / sync-architecture / transport-tech-evaluation / livelink-roadmap / annotations-hda / decisions）+ 只读源码（hda/src/cyl1nder_hda.py、cyl1nder_bridge.py、cyl1nder_serializer.py；bridge/bridge/workspace.py、routes.py、ws.py、protocol.py）+ grep 确认（`sync_fps|stream|topoId|diff|ring|chunked|pending|dirty|clear\(\)|buildOutputs`）。
> **本轮仅调研设计，不实现。** 未改任何代码、未改其它 devlog；只新建本文。

## 1. 一句话结论

**简单 transform 也做不到接近无缝，瓶颈不在 30fps 轮询频率，而在「Houdini dirty → 整节点重执行 → Cyl1nder 每次访问都主线程内全量重算（阻塞式全量 HTTP 拉取 + 全量 JSON 反序列化 + clear+rebuild）」且全链路没有任何增量/缓存复用；把 sync_fps 调 30（默认就是 30）或提到 60 都不会好转，因为有效更新频率被 `scheduled` 门控压在 ≈1/cook时长（百毫秒级），而不是 33ms 轮询间隔。** 用户方向「在 HDA 访问数据时就把数据准备好」= livelink 的 C（移出 cook 主线程）+ B（位置流式更新），即 streaming-plan-b 3.1/3.2 的「后台消费线程 + 就绪缓冲 + cook 只应用」——这才是消除卡顿的关键，且可先于协议改动在 HDA 侧落地。

## 2. 现状盘点

### 2.1 30fps 同步上限在哪、为什么调 30 没好转

| 项 | 现状（代码证据） |
|---|---|
> **状态注记（v0.1.00063 归档前）**：M1 的 `/stream` 已落地（v0.1.00056 起成为 HDA 主同步通道，NDJSON 长轮询 hold=60s、事件带 fps；`/pending` 降为 fallback）。本文对「30fps 轮询 / 33ms 粒度」作为**现状**的描述均已过时，请以 `sync-heartbeat-redesign.md` / `sync-rate-limit-and-preference.md` 为准。diff_output / topoId / msgpack 等仍属未来计划（未实现）。

| sync_fps 定义处 | `hda/scripts/build_hda.py` L93：`IntParmTemplate("sync_fps", "Sync FPS", 1, default_value=(30,), min=1, max=60)` |
| sync_fps 消费处 | `hda/src/cyl1nder_hda.py` `ensure_sync()`（L194-214）：`interval = 1.0 / max(1.0, fps)`；`_sync_loop()`（L131-155）每 interval 调 `GET /pending?since=` |
| 语义 | 只是「轮询 /pending 的频率上限」，不是端到端同步速率上限；且 bridge 侧 `/pending` 同时当心跳（`registry.touch`） |
| 调 30 没好转 · 1 | 默认就是 30，用户设 30 ≈ 恢复默认，不是"提高" |
| 调 30 没好转 · 2 | `scheduled` 门控：`_sync_loop` 在 `state["scheduled"]` 为 True 时直接 `continue`（L150-151），直到 `_force_cook_node` 结束才复位（L176）→ 有效调度频率 ≈ 1/cook时长；一次 cook（全量拉取 + 全量重建）实测百毫秒级 → 实际只有 ~3-10fps |
| 调 30 没好转 · 3 | 事件→cook 走 `hdefereval.executeDeferred`（下一个主线程空闲执行），不是严格 1/fps |
| 调 30 没好转 · 4 | 即便立刻检测到 pending，cook 内 `_role_buffer` / `_snapshot_parts` 都是 `since=0` 全量拉取 + 内容对比 → 任何变化都 `geo.clear()`+全量重建；重建成本（毫秒→百毫秒）远大于 33ms 轮询间隔 → 提频无体感收益 |

### 2.2 当前一条链路与延迟构成

> 注：当前 `build_hda.py` 构建的是 **4 个 Python SOP（`cyl1nder_py0..3`, maintainstate=0）+ 4 Convert + 4 Output**（v0.1.00016 回退后的布局）；`cook_core()`（1-Python+blast）仍在源码中但当前未构建（cyl1nder_hda.py 顶部 docstring 标 "current" 属过时描述）。

```
Houdini dirty（改参数/上游 transform/输入）
  → maintainstate=0，4 个 python SOP 全部重执行（Houdini 整节点重跑）
  → cook(role) 主线程：serialize_input×4（round6, O(N)）→ push_inputs（后台防抖线程 0.12s，非阻塞 ✓）
  → _sync_loop 后台 30fps 轮询 /pending（33ms 粒度，兼心跳）
  → 检测 pending → executeDeferred → _force_cook_node：清 _OUT_CACHE、status=dirty、cook(force=True)
  → cook 主线程 _role_buffer：首个 role 阻塞 GET /outputs?since=0（全量 4 路）
  → _same_as_buffer 内容对比（O(N)）→ 不同 → geo.clear() + _build_detail 全量重建
  → Houdini 视口必然重绘（频闪）
web 侧：编辑 → WS edit → put_outputs（_same_content 去重 + rev++）→ WS 广播 outputs 全量
  → web upsertOutputs（按 index 覆盖）→ renderer.refresh：outputGroup.clear() + buildOutputs 全量重建
```

| 环节 | 线程 | 粒度 / 成本 | 备注 |
|---|---|---|---|
| web 编辑 → bridge（WS loopback） | web main / bridge asyncio | ~1ms | 快 |
| bridge put_outputs（校验 + `_same_content` 去重 + rev++） | asyncio | ~1ms + 全量 JSON 编码（10k 点 ~5-20ms） | 全量广播 |
| web 收 outputs → `upsertOutputs` → `renderer.refresh` | web main | 全量 clear+rebuild：`outputGroup.clear()` + `buildOutputs`（新 BufferGeometry/线段）10-50ms+ | 每次 outputRev 变化都重建 → 视口闪 |
| HDA `_sync_loop` 检测 pending | HDA 后台 | ≤33ms（sync_fps=30）+ `hdefereval` 主线程空闲延迟 | 上限被 `scheduled` 门控压到 ≈1/cook时长 |
| HDA cook 全量拉取 | **cook 主线程（阻塞）** | HTTP ~1-5ms + 全量 JSON 反序列化（10k 点 ~5-20ms） | `since=0` 每次全量；`_OUT_CACHE` 每次 dirty 被清（`_force_cook_node` L174） |
| HDA 全量重建 | **cook 主线程** | `geo.clear()` + `createPoint`×N + polygon/curve prim（10k 点 10-50ms+） | 拓扑 0 变化也重建 |
| Houdini 视口重绘 | Houdini UI/GPU | 重建后必然重绘 → 视觉频闪 | 与交互抢主线程 |

实测参考：`devlog/annotations-hda.md` v0.1.00002 记录「web 推编辑 → ~0.6s 内 Houdini 自动拉回 out0」。

## 3. 根因分析

### 3.1 为什么简单 transform 也做不到接近无缝

| 根因 | 说明 | 代码证据 |
|---|---|---|
| dirty → 整节点重执行 | Houdini SOP 一旦 dirty，访问/渲染时重跑整个 SOP；内部 python SOP `maintainstate=0` 强制每次 HDA recook 全重跑 → 推输入 + 拉输出 + 全量重建全走一遍 | `build_hda.py` L144 `maintainstate=0`；`cyl1nder_hda.py` `cook(role)` |
| 访问即阻塞（无"就绪"） | 拉取+反序列化在 **cook 主线程**内同步完成；Houdini 渲染/交互与 cook 抢主线程 → 拖拽/刷新时被卡 | `_role_buffer`（L466-480）`pull_outputs(0)` 在 cook 内；`_snapshot_parts`（cook_core 路径）同理 |
| 全量重建、无增量/缓存复用 | `_OUT_CACHE` 每次 dirty 被清（`_force_cook_node` L174 `_OUT_CACHE.pop(serial)`）→ 每次重拉；`_CORE_CACHE`/`_same_as_buffer` 只在内容**完全相等**时跳过重建，任何位置变化 → `geo.clear()`+全量重建 | `_build_detail` / `_same_as_buffer` |
| 无 topoId/transform/delta 概念 | 协议 v1 的 `OutputBuffer` 只有 index/rev/points/curves/faces/attributes（`protocol.py`），无法表达"整组只移动/只有某些点变化"→ 简单 transform 也得全量重传、全量重建 | `protocol.py` OutputBuffer；grep `topoId|transform|diff_output|/stream` 三端零命中 |
| 简单 transform 尤其亏 | 拓扑 0 变化，却付出 100% 传输 + 100% 重建，只为表达一个 4x4 变换 | — |

### 3.2 为什么 sync_fps 不是瓶颈（结论）

- 有效更新频率 = min(sync_fps, 1/cook时长)；cook 时长被「主线程全量拉取 + 全量重建」主导（10k 点百毫秒级）→ 30→60 只是把检测上界 33→16ms，后面 200ms 不变，体感无差。
- 提频还放大 `/pending` 心跳流量与 recook 排队（bridge 日志已见大量 `pending?since=0`，annotations v0.1.00011 确认属预期）——单纯调参是负优化。

## 4. 可落地改进方向（对照用户方向：访问即准备）

> 用户原话方向：「在 hda 去访问那个数据的时候就把那个数据准备好，而不是每次访问都重新阻塞算一遍」。对应 livelink-roadmap 的 C（移出 cook 主线程）+ B（位置流式更新），即 streaming-plan-b 3.1/3.2 的「后台消费线程 + 就绪缓冲 + cook 只应用」。

| # | 方向 | 状态 | 落地点 | 预估收益 |
|---|---|---|---|---|
| a | **cook 缓存/增量**：拓扑首建、后续只 `setPosition`；`_build_core_detail`/`_build_detail` 只在拓扑变化时重建，位置变化只 `diff_indices` `setPosition`（复用 streaming-plan-b B1 / 3.2） | 缺口 | `cyl1nder_hda.py` cook 快速路径（新增 `applied_points` 快照做差；H20+ 可批量 `setPointPositions`） | cook 主线程 10k 点 10-50ms → <2ms；消 Houdini 频闪 |
| b | **访问即准备**：dirty 后一次性后台准备、访问时读缓存（后台消费线程拉取+反序列化到就绪缓冲，双缓冲/latest-wins；cook 只取最新一份应用） | 缺口（输入侧已有后台 push 线程可参考） | 新 `hda/src/cyl1nder_stream.py`（纯 stdlib）或先行「后台 /outputs 拉取线程 + 就绪缓冲」 | cook 主线程**零网络零序列化**；事件→视口 0.6s 级 → <15ms 级（B1 目标） |
| c | **序列化/传输优化**：`round(x,6)` 已统一 ✓；稀疏 delta `[{i,p}]`、稠密≥50% 退化 snapshot；`transform` 字段；msgpack/二进制 + 压缩按需（B2） | 部分已做（round6 统一）其余缺口 | `bridge/bridge/workspace.py` `diff_output` + `protocol.py` Stream 模型（M1）；B2 msgpack | 传输体积 100% → 变化点占比；JSON 编码/解析开销下降 |
| d | **web 侧增量消费**：避免全量 `clear()+buildOutputs`，稀疏更新 position attribute / 应用 matrix | 缺口 | `web/src/viewport/geometry.ts` `applyOutputDelta` + `stores/workspace.ts` 消费 snapshot/delta（M2） | web 视口 10-50ms 全量重建 → <1ms 稀疏更新；不闪 |

**已在做的既有基础（方案 B 依赖、可复用）：**
- `round(x,6)` 统一：`cyl1nder_serializer.serialize_input` / `cyl1nder_hda._same_as_buffer`/`_flat_signature` 全部 round 6（消浮点乒乓）。
- bridge `_same_content` echo 去重（打断回显循环，`workspace.put_outputs`）。
- `_CORE_CACHE` / `_OUT_CACHE` 进程内缓存（相同内容跳过重建；缓解但非增量）。
- 输入侧后台 push 线程（`BridgeClient._pump` 防抖 0.12s）——「后台准备」的现成范式。
- web `store.upsertOutputs` 按 index 覆盖（latest-wins 雏形）。
- 内容对比自愈（sync-architecture 铁律：rev/topoId 只作提示，正确性靠内容对账）。

## 5. 对照 streaming-plan-b 的 B1/B2 里程碑

| 里程碑 | 内容 | 对应方向 | 状态 | 下一步优先级 | 预估收益 |
|---|---|---|---|---|---|
| M1 | bridge：协议 + `diff_output` + `/stream` 长轮询 + `topoId`/`transform` + ring 重放 | c（协议地基） | **缺口（零落地）** | **P1**（三端协议地基，解锁真正 delta 流） | diff 由全量变稀疏；HDA 可用长轮询替代 33ms 轮询（~5ms 级推送） |
| M2 | web 增量消费：`applyOutputDelta` 稀疏更新 position attribute | d | **缺口** | **P1**（M1 后即可） | 视口不闪；10k 点拖动 ≥30fps |
| M3 | HDA 流消费：后台线程 + 就绪缓冲 + topoId 校验 + 快速路径（拓扑首建/只 setPosition）+ 自愈 | a + b | **缺口** | **P0**（用户痛点直接命中） | 端到端 <15ms；cook 主线程 <2ms 应用 |
| M4-M6 | B2 native core（sidecar 8377 / msgpack / fuzz 对拍 / 打包） | c 后半 | 缺口（后置） | **P2**（B1 全绿后再动） | diff <0.5ms；端到端 <10ms |

**建议的下一步优先级（P0/P1/P2）与理由：**

| 优先级 | 动作 | 理由 / 依赖 |
|---|---|---|
| **P0** | HDA 侧「访问即准备」先行：后台线程做 `/outputs` 拉取+反序列化到就绪缓冲（双缓冲/latest-wins）；cook 主线程只从缓冲取最新、与 `applied_points` 做差后 `setPosition` 变化点（无 topoId 时保守整点比对，不 clear+rebuild） | 不依赖协议改动即可落地（纯 `hda/src/*.py`，hython 可冒烟，`reload_hda.py` 热更）；直接消除「cook 主线程网络+序列化+全量重建」这一最大卡点；为 M3 预置就绪缓冲结构 |
| **P1** | M1 bridge 协议 + diff + 长轮询 + `topoId`/`transform`；随后 M2 web 增量消费、M3 完整流消费（topoId 快速路径 + 5s 自愈对账 + REST fallback） | P0 已把最痛的重建/阻塞消掉；P1 把"全量传输/全量广播/33ms 轮询"换成稀疏 delta/事件推送，拿到完整 B1 收益；M3 依赖 M1 的 topoId 才能安全只 `setPosition` |
| **P2** | B2：msgpack + native core（streaming-plan-b M4-M6） | 前置 B1 三端验收全绿；收益是常数级（<0.5ms diff），不解决"全量重建"这一结构性卡点 |

## 6. 风险 / 注意

| # | 注意 | 落地时要求 |
|---|---|---|
| 6.1 | 增量不能违反 sync-architecture 铁律 | topoId 失配/应用异常 → 整体重建；保留周期内容对账（`_same_as_buffer` 现成）与 echo 去重 |
| 6.2 | 就绪缓冲与现有缓存的关系 | 就绪缓冲接管后，`_OUT_CACHE`/`_CORE_CACHE` 退化为 REST fallback 路径；`_force_cook_node` 清缓存逻辑要理顺 |
| 6.3 | 当前 built 布局是 4-Python SOP | `cook_core()`（1-Python+blast）在源码中但未 build（docstring 过时）；落地以 `build_hda.py` 为准，避免改错路径 |
| 6.4 | `_same_as_buffer`/`_flat_signature` 只对比 points+curves | faces/attributes-only 变化不会被内容对比捕获（既有 v1 简化）；流式落地时把 faces/attrs 纳入拓扑签名 |
| 6.5 | 并行 agent 正在改 web 文件 | `web/src/viewport/renderer.ts` 等有并行改动，M2 落地前先确认归属 |
| 6.6 | Houdini 内置 Python 无 WS 依赖 | HDA 侧用 stdlib `urllib`（长轮询/后台拉取），勿引 websocket-client（铁律 + streaming-plan-b 6.8） |

## 7. 本次只读调研，未改代码

- 新建：`devlog/streaming-sync-gap.md`（本文）。
- 未触碰：`bridge/`、`web/`、`hda/` 源码；未改其它 devlog 文件。

## 8. 落地：缓存-直到输入变化 + 同步 fps 提升（v0.1.00051）

> 日期：2026-08-11。范围：把本文 P0（访问即准备 + 就绪缓冲 + 位置流式更新）在 HDA 侧落地。只改 `hda/src/cyl1nder_hda.py` 与 `hda/scripts/hython_smoke.py`（并行 agent 正在改 bridge/web，本写集不碰；不 git commit）。
> 目标：Cyl1nder 中拖拽 transform 的同步从 ~20fps 往 60fps 方向；cook 主线程延迟 10-50ms → <2ms（拉取侧）。

### 8.1 实现要点

1. **就绪缓冲（后台拉取）**：`_sync_loop`（30fps `/pending` 心跳语义不变）在启动时预热，检测到 pending/reset 时在**后台线程**调 `_refresh_ready()` 拉 `/outputs?since=<ready rev>` 到 `_READY[serial]`（按 role 合并、latest-wins、每次更新 `_gen` 打标）。cook 主线程**零网络零 JSON 反序列化**，只读 `_READY`。`_role_buffer`（直接拉取）退化为冷启动 REST fallback（同步线程尚未预热时，首次 cook 用）。
2. **缓存-直到输入改变（输出侧）**：`_GEO_CACHE[(serial, role)]` 持有预构建 `hou.Geometry` + 精确拓扑签名（`_buffer_sig`：pointCount + curves/faces 的 pointIndices）。cook 应用 `_apply_output`：
   - 同一 buffer（`_gen` 相同，O(1)）→ 缓存命中，`geo.copy(cached)`（10k 点 ~0.04-0.13ms 原生），不重建；
   - 拓扑签名相同（位置-only 变化）→ `setPointFloatAttribValues("P", ...)` 批量写缓存几何 + copy，**不 clear()/不重建**；
   - 拓扑变化 → 重建缓存几何（罕见）。
   自愈：拓扑漂移 → 重建；位置漂移 → 从 buffer 重写 P。
3. **缓存-直到输入改变（输入侧）**：`_input_signature`（role 0 每 recook 一次）对 4 路输入做内容签名（P 原生批量 + point/prim 计数 + 每 prim 顶点数 + width/Cd/uv）；与 `_PUSH_CACHE[serial]` 相同则**跳过 serialize_input×4 + push**（输入未变不再重复推流，不再 bump inputRev / 喂 web feedback 循环）。签名失败 → 保守重推。
4. **关键实测发现**（hython）：
   - Python SOP 输出几何**每次真实 recook 都重置为 input0 拷贝**（maintainstate 0/1 + `cook(force=True)` 均如此）→ 跨 cook 无法持久化点/prim，所以快速路径用「预构建缓存几何 + `geo.copy()` + 批量 P 写」，而不是「复用 input0 只 setPosition」。
   - HOM 逐点访问：writable ~10µs/pt，read-only ~60µs/pt（6x）→ 输入签名在 **writable 拷贝**上算（`hou.Geometry().copy(src)`），5-6x 加速。
   - `_ensure_bridge`/`_ensure_frontend` 每次 cook 都做 HTTP 健康探测（1-25ms × 4 role SOP）是隐藏开销 → 2s 限频。
5. **心跳/门控语义保留**：`/pending` 仍按 sync_fps 轮询并 touch lastSeen；`scheduled` 门控保留（防风暴）；就绪缓冲在 scheduled 期间仍刷新（latest-wins），recook 落地时拿到最新。

### 8.2 预期收益（hython 实测：drag-frame 单 python SOP cook 主线程时长）

| 输入规模（4 路） | 旧链路（serialize×4 + clear/rebuild + 健康探测） | 新链路（签名跳过 push + 就绪缓冲 + 缓存几何 copy） |
|---|---|---|
| 200 pts / 40 curves | ~35-50ms（≈20fps） | ~5ms（200fps 级；受 sync_fps 上限约束） |
| 500 pts / 100 curves | ~50-80ms | ~3.5ms |
| 2000 pts / 400 curves | ~350-550ms（2-3fps） | ~13ms（77fps 级） |

- cook 主线程：拉取+反序列化 0（后台）；10k 点位置-only 应用 ≈ 0.8ms（批量 P 写）+ copy ~0.1ms；拓扑重建仅发生在拓扑变化。
- 端到端同步上限从「1/cook 时长（百毫秒级）」变为 min(sync_fps, 轮询/调度延迟) → **把 sync_fps 提到 60 现在有真实收益**（16ms 轮询）；默认 30fps 拖拽同步 ~30fps，设 60 可到 ~60fps。
- 输入侧：拖拽期间输入未变 → 不再重复推流（省 HTTP + inputRev 抖动 + web feedback）。

### 8.3 剩余瓶颈（P1 方向）

| # | 瓶颈 | 现状 | 后续（P1） |
|---|---|---|---|
| 1 | HDA 轮询粒度 | `/pending` 30-60fps 轮询（33/16ms 上界）+ hdefereval 主线程空闲延迟 | bridge `/stream` 长轮询/事件推送（~5ms 级） |
| 2 | 全量 JSON | 输出变化仍全量传输（后台线程拉取，不阻塞 cook，但背景 CPU/带宽 100% 传输） | 协议 delta（稀疏 `[{i,p}]`）+ topoId/transform（M1） |
| 3 | 协议无 delta | 简单 transform 也全量重传/全量广播 | `/stream` + diff（P1） |
| 4 | 输入侧全量 | 输入变化时 serialize×4 仍全量 JSON（每点 ~10µs writable / ~60µs read-only） | 输入侧 delta / 原生批量序列化（P2） |
| 5 | 拓扑重建 | 拓扑变化时仍 clear+重建（10k 点 ~43ms） | topoId 快速路径 + `createPoints` 批量（M3） |
| 6 | 健康探测 | autostart 探测 2s 限频（摊薄 <1ms/cook） | 可由 `/pending` 心跳状态替代 |

### 8.4 风险 / 注意

- 输入签名对「同计数同位置的 point 重排/重连」不敏感（自愈：下一次真实变化全量重推）——与 sync-architecture「内容对账自愈」铁律一致。
- `_READY`/`_GEO_CACHE`/`_PUSH_CACHE` 随 serial 累积（进程内、Houdini 生命周期内）；serial 再生（regenerate）不清理旧缓存（既有 `_SYNC`/`_OUT_CACHE` 同样行为）。
- 落地路径是 built 的 4-Python-SOP 布局（build_hda.py）；`cook_core`（1-Python+blast）未 build，仅同步改为读 `_READY`（冷启动直接拉），未做缓存几何快速路径。
- 心跳：`/pending` 语义未变（仍 touch lastSeen）；web `startHdaWatch`（registry.lastSeen）依赖保留。
- 并行 agent 正在改 bridge/web；`/stream`+diff（P1）需协议三端同步（protocol.py / types.ts / protocol.md），落地前确认文件归属。
