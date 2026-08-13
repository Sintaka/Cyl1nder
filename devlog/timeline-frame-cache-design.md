# 时间轴逐帧缓存设计（web frame cache + IndexedDB）

> 日期 2026-08-13 · 角色：主进程（Meitner 子智能体调研产出，主进程落盘）。基于 v0.1.00096（懒输出/变化分级/cook-on-dirty/push-rev 分级已落地；timeline-design.md 未实现）。
> 硬约束：**帧切换、无参数变化 → web 不重算，直接复用该帧缓存结果**。

## 1. 现状盘点：帧切换今天怎么走、浪费在哪

```
Houdini cook(frame N) → _push_inputs_if_changed → bridge input_rev+1
→ WS {type:"inputs"} → session.setInputs → autoRun → network.run()
→ chain-cache sig = inputsRev|graphVersion|specs → sig miss（inputsRev 变）
→ 4 链全量 re-trace → upsertOutputs(predictedRev) → outputRev++ → flushStoreView → renderer.refresh
```

浪费分两类：
1. **跨帧（本轮要治）**：chain-cache 只有「当前帧」一份状态（键 `out:<i>`/`node:<id>`，sig 含 inputsRev+graphVersion+结构），**没有任何帧历史**。从 frame 5 拖到 6 再拖回 5，frame 5 的结果已丢，再次整链全量 re-trace + 重建 buffer + push + outputRev++。来回 scrub = 反复重算同一批帧。
2. **帧内（F3/F4 已修大部分）**：同帧 Houdini 重复 recook 重推输入 → F3 的 `_input_signature`+`_PUSH_CACHE` 在 HDA 就拦截；web 侧 session 有 `inputsEqual` 门控，链缓存 sig 不变走 `change:"none"` → runner 提前 return。残留：Houdini 重推**内容略不同**的数据 → 真变化 → 真重算（不可避免）；以及 outputRev++ 仍触发一次 store emit + 视口刷新（renderer 按 per-buffer rev 跳过，成本小）。

关键区分——**"inputs actually changed"**（Houdini 逐帧几何本就不一样）：该帧结果的**计算**不可避免，但**同一帧只该算一次**，重复访问应命中缓存；**"parms/topology changed"**（transform/组/图拓扑）影响**所有帧**的结果，是帧缓存失效的唯二根源（另一个是输入内容本身）。

## 2. 缓存分层

| 层 | 缓存什么 | 现状 | 动作 |
|---|---|---|---|
| HDA | `_GEO_CACHE` 按 (serial, role) 缓存 hou.Geometry | 已有（单帧） | 不动；大场景可选 File Cache（`saveToFile(*.bgeo.sc)`，按 frame 落盘）→ 后续轮 |
| bridge | Workspace 内存 rev buffers | 已有 | 不动；per-frame 磁盘缓存只对冷启动有意义 → 后续轮 |
| web | **逐帧全量输出结果** | 无 | **本轮：内存 LRU Map + IndexedDB 持久化** |

**web 最小可行帧缓存**：
- **键**：`(serial, frame, inputContentSig, graphVersion, parmRev)`。**不要用裸 `inputRev`**——它是全局单调计数器，跨帧 scrub 时每帧输入都拿新 rev，缓存会永远 miss。用「输入内容签名」表达这帧输入到底是啥；`parmRev` 是**新增**的单调版本号：参数提交/undo/gizmo mouseup 时 bump。`graphVersion` 只在连线/节点增删时 bump，**不含参数值**，所以必须有 parmRev。
- **IndexedDB schema**：
  - store `frameMeta`：key `${serial}::${frame}` → `{serial, frame, sig:{inputSig, graphVersion, parmRev}, rev, lastAccess, cachedAt}`
  - store `frameBufs`：key `${serial}::${frame}::${index}` → `{serial, frame, index, rev, output: OutputBuffer}`（按 buffer 分键，单缓冲变化只重写一条）
  - `byAccess` 索引（lastAccess）做 LRU 清扫。
- **读写路径**：写 = 重算后 write-through（`run()` 之后 fire-and-forget 事务，**不进渲染路径、不 await**）；读 = 先查内存 LRU Map（同步 O(1)，直接把同一对象给 store），miss 才查 IDB（异步）。帧切换的常见命中落在内存层；IDB 只负责重启/重连后的热缓存与超内存容量帧。value 是 `number[][]`，IndexedDB structured clone 直接存，无需 stringify。
- **淘汰**：按 frame LRU，内存 64 帧、IDB 每 serial 256–512 条；`QuotaExceededError` → 删最旧重试一次，兜底退化为纯内存。
- **dirty/clean 规则**：clean = 当前 inputs 与缓存条目 inputs **内容等价**（复用 `inputsEqual`/`outputsEqual` 语义，忽略 rev）且 graphVersion、parmRev 全匹配 → 直接 `store.upsertOutputs(cached.outputs, cached.rev)`，**不调 run()**，靠 store emit 触发视口刷新；dirty → `run()` 重算 + write-through 覆盖该帧。

## 3. 失效规则（矩阵）

| 事件 | 动作 |
|---|---|
| 帧切换，parm/拓扑未变，输入内容 == 缓存 | **缓存命中：load 进 store，不 run()（零重算 ✅）** |
| 帧切换，parm/拓扑未变，输入内容 ≠ 缓存 | dirty：重算 + write-through 更新该帧 |
| 帧切换 + parm 变（parmRev++） | dirty：重算 + 更新该帧；其它帧不清（键含 parmRev 自然 miss，惰性失效） |
| 同帧，Houdini 重推相同输入 | no-op：F3 在 HDA 拦截 / session `inputsEqual` 跳过 run / 链缓存 sig 不变 → runner early return；帧缓存不动 |
| 同帧，Houdini 重推不同内容 | dirty：重算 + 覆盖该帧 |
| 拓扑变化（graphVersion++） | **该 serial 全部帧 drop**（条目反正永远 miss，清掉省配额） |
| 序列切换 / 重连 / 刷新 | 键含 serial 自然隔离；启动时 IDB 预载最近 LRU 帧入内存 |

## 4. 与现有缓存的关系 / 挂载点

帧缓存是 chain-cache **之上**的粗粒度「整帧结果」层：chain-cache 继续管当前帧内的链状态与 none/data/topology 分级，runner 的 no-op early return 继续当帧内守卫；帧缓存管跨帧重复访问去重。二者键不同，互不干扰。

挂载点（集中判定，别散进 runner）：
1. `web/src/core/session.ts` 的 `inputs` WS handler：`setInputs` 之后、`network.run()` 之前——命中→跳过 run；dirty→run。
2. 新 timeline 控制器（timeline Phase1/2 实现时）：C→H 拖帧路径；未 engaged 的本地时间轴同样查缓存。
3. flush pump 不动：run() 的调度仍由既有 `networkDirty/pendingFlush` 决定。

**必须 E2E 验证的边界**：命中时跳过 run() = 跳过 push。输入内容等价 ⇒ 缓存输出与 Houdini 该帧显示分支输出相同，bridge 内容去重也兜底；但确认 Houdini 显示分支 recook 依赖 web push 的路径不被破坏。兜底：命中时把缓存 outputs 也 push 一次，bridge 去重会把它变成 no-op。

## 5. 浏览器 / 工程约束

- IndexedDB = tier A，全浏览器通用；WebGPU/SharedArrayBuffer/WebTransport 明确不做。
- 配额按每 serial LRU 上限主动控制；写事务单写者串行化；IDB 读写全部 fire-and-forget，命中判定只用同步内存 Map，渲染路径零 async。
- 帧缓存是 web 私有层，**不碰 protocol.py/types.ts/protocol.md**（铁律 3 不受影响）；未来 msgpack/SoA 化后缓存改存 typed array，体积更小、structured clone 依然可用。

## 6. 建议落地顺序

- **第一刀（最小，纯 web）**：`web/src/core/frame-cache.ts`（新增）——内存 LRU Map（键 frame+inputSig+graphVersion+parmRev，值 {outputs, rev, inputs 引用}）；`web/src/stores/workspace.ts` 加 `parmRev`；`web/src/core/session.ts` 加命中判定；`web/src/main.ts` 接线。vitest（纯 Map 用例）+ tsc；E2E：scrub 来回帧，第二趟零 `run()`。
- **第二轮**：`web/src/core/frame-cache-db.ts`（新增）——IDB 双 store + `byAccess` LRU 清扫 + 配额处理 + 启动预载；vitest 用 fake-indexeddb；E2E：刷新页面回到上次帧直接命中。
- **再下一轮（可选）**：bridge per-frame 磁盘缓存（复用 snapshot.py 原子写模式，随 msgpack 化一起）+ HDA File Cache（bgeo.sc，大场景）。
