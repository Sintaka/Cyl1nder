# 缓存对齐 Zeno/Houdini — 懒输出 + 变化分级 + 输入回声修复（round v0.1.00095）

> 角色：主进程（架构评估 + 契约 + 合并）。调研：James（只读子智能体）产出 W1–W12 清单；主进程复核。
> 分支：`codex/0.1.00095-cache-lazy-stamp`（本分支）；版本 0.1.00095（已 bump）。
> 一句话：**Cyl1nder 缓存系统剩余的「重复计算/徒劳」= 每帧全算 4 条输出链 + HDA 输入回声打爆链缓存 sig + 全量序列化/深比较 + 每帧全扫拓扑**。本轮对齐 Houdini「显示驱动 cook / cook-on-dirty」与 Zeno「stamp 变化分级」落地四个改动。

## 一、调研结论（W1–W12 摘要，详见 James 报告）

| # | 问题 | 位置 | 何时 | 代价 |
|---|---|---|---|---|
| W1 | 每链独立结构 trace，无共享子图 memo；node:<id> 与 out:<i> 同链双份点数组 | chain-cache.ts computeOutputsCached/computeNodeResultCached | 每次 run | O(E+L)×链 + O(P) 双份 |
| W2 | HDA 输入回声：cook_core 每 recook 无条件重推 4 输入 → bridge input_rev++ → web store.inputRev++ → 链缓存 sig 失配 → 每 ~2 帧全量重 trace + 克隆 | cyl1nder_hda.py cook_core / session.ts setInputs / chain-cache buildSig | 每 recook（拖拽时 30/s） | 免克隆 delta 最多活 1 帧 |
| W3 | 每帧 4 缓冲全量 stringify ×2 + 深比较 ×2（只有 out0 变） | client.pushOutputs / workspace._same_content / store.applyOutputs | 每帧 | O(4P) |
| W4 | 输入回声比较用 JSON.stringify 判等 | protocol/compare.ts payloadEqual | 每次回声 | O(P) |
| W5 | sameTopology + updateGroupPositions 每帧全扫 + computeVertexNormals | renderer.refresh / showNodeResult / geometry.ts | 每可见帧 | O(P+C+F+E) |
| W6 | 隐藏组跳过几何但不跳计算/序列化 | renderer.ts / network.ts | 每帧 | O(4P) |
| W8 | cook_core 无条件重推输入（根因，见 W2） | cyl1nder_hda.py cook_core | 每 recook | O(4P)+HTTP |
| W9 | _gen 每 pull 轮次全体重盖章 → 每 role 全量 P 重写 | cyl1nder_cache._refresh_ready / cyl1nder_geometry._apply_output | 每 cook | O(P)/role |
| W12 | 流式返回全量缓冲，无内容分级 | workspace.get_outputs_since | 每 cook | O(4P) |

不列入本轮（W11 快照已节流+内容比较，OK）：W4（session 已 gate auto-run，根因 W8 修掉后自然消失）、W9（跟随 F3 收益，单独一轮做 per-buffer 盖章）、W12（跟随 F4 推送分级后自然受益）、W1 的跨调用共享 memo（见「下一轮」）。

## 二、本轮范围（对齐 Houdini/Zeno 的四个改动）

### F1 懒输出（Houdini 显示驱动 cook）— web
`computeOutputsCached` 只对「激活链」做点级工作：
- 激活 = `ctx.activeOutputs[i] !== false`（默认全激活，保持旧行为）。
- 激活链 + sig 命中 + 有 delta → 就地 delta（change="data"）；零 delta → change="none"。
- 非激活链 + sig 命中 → 零工作复用缓存（change="none"，不 apply delta，不重建）。
- sig 失配/无条目 → 全量重 trace（change="topology"）——输入/拓扑变化是离散事件（F3 后不再是每帧），重 trace 保持缓存有效，正确性不变。
- 死链 fallback 按 inputsRev memo 化：输入未变 → 复用同一 buffer 对象（change="none"，引用稳定）；输入变 → 重建（change="data"）。

### F2 变化分级（Zeno stamp 简化版）— web
- chain-cache 每条目加 `change: "none"|"data"|"topology"`（stamp 四级简化为三级）。
- 视口：`sameTopology` 加 O(1) 引用快路径（pointCount + curves/faces 引用相等 → 同拓扑，不再每帧重走 C+F）；`updateGroupPositions` 仅位置变化时跳过 `computeVertexNormals`（平移不变性：纯 tx/ty/tz 平移不改法线，跳过安全）；`renderer.refresh` 位置-only 循环按 per-buffer rev 跳过未变缓冲。

### F3 输入回声修复（Houdini cook-on-dirty）— hda
`cook_core()` 采用 legacy `cook(role)` 已有的 `_input_signature` + `_PUSH_CACHE` 门控：输入内容未变不重序列化/重推（打破 W8→W2 回声环）。抽公共 helper `_push_inputs_if_changed`（cyl1nder_hda.py 内）供两条路径共用。

### F4 推送/rev 分级（只推变了的链）— web
`createNetworkRunner.run()`：
- 全部 change="none" → 提前 return（不 upsert、不 bump rev、不 push）——消灭 no-op 帧。
- 按 per-buffer rev 标记：变的链 rev=predictedRev，未变的沿用上一轮 rev（runner 内部 lastOutputs 记 rev）。
- 只 push `changes[i] !== "none"` 的缓冲（省 W3 的 3/4 stringify；Houdini 只 recook 显示分支）。

## 三、契约（先定死，子智能体按此实现；主进程合并时补调用点）

### web/src/nodes2/chain-cache.ts（Agent A 拥有）
```ts
export type ChainChange = "none" | "data" | "topology";
export interface ChainCtx {
  inputsRev: number;
  graphVersion: number;
  /** 长度 4（out0..3）；false = 非激活链（跳过点级工作）。缺省/越界视为 true。 */
  activeOutputs?: boolean[] | null;
}
export interface ComputeResult {
  outputs: OutputBuffer[];
  /** 与 outputs 对齐：none=零工作/data=位置-only 增量/topology=全量重建。 */
  changes: ChainChange[];
}
export function computeOutputsCached(inputs, snap, ctx): ComputeResult; // 返回类型由 OutputBuffer[] 改为 ComputeResult
export function computeNodeResultCached(snap, inputs, nodeId, ctx): OutputBuffer | null; // 签名不变
export function resetChainCache(): void; // 不变
// CacheEntry 加 change: ChainChange；测试可用 getCacheChange(key): ChainChange | undefined
```
死链 fallback memo：模块级 Map，key `fb:<i>`，存 { inputsRev, buffer }；inputsRev 未变返回同一 buffer（引用稳定 + change="none"）。

### web/src/nodes2/network.ts（Agent B 拥有）
```ts
export function computeOutputs(inputs, snap, ctx?): OutputBuffer[]; // 保持返回数组（现有测试不破坏）
export function computeOutputsDetailed(inputs, snap, ctx?): ComputeResult; // runner 用；无 ctx 时 changes 全 "topology"
export type { ComputeResult, ChainChange, ChainCtx } from "./chain-cache"; // re-export
export function computeNodeResult(snap, inputs, nodeId, ctx?): OutputBuffer | null; // 不变
```

### web/src/core/network.ts（Agent B 拥有）
```ts
export interface ActiveChains { outputs: boolean[]; node: string | null; }
interface NetworkDeps {
  // ...现有字段不变
  computeOutputs: (inputs, snap, ctx?) => ComputeResult; // 类型改为 ComputeResult
  getActiveChains(): ActiveChains;      // 新增
  getEditedNodeId(): string | null;     // 新增（Enter 编辑中的节点；无则 null）
}
// run(): 见 F4；ctx = { inputsRev, graphVersion, activeOutputs: getActiveChains().outputs }
// 编辑中（getEditedNodeId() !== null）→ activeOutputs 全 true（编辑链必须保持 live）
```

### web/src/core/dataflow.ts（Agent B 拥有）
```ts
interface DataflowDeps { /* ...现有不变 */ setActiveChains(next: ActiveChains): void; } // 新增
// refreshNodeFlags 解析 display kind/port + reference flags 后计算：
//   outputs: display=output → [true,false,false,false]（out0）或 outReference → 全 true；
//            其余 → 全 false（outReference 仍全 true）
//   node:    display=null/transform → disp.id；否则 null
// 调用 deps.setActiveChains(...)
```

### web/src/main.ts（Agent B 拥有）
- `let activeChains: ActiveChains = { outputs: [true,true,true,true], node: null }`（首帧前全激活=旧行为）。
- createDataflow deps 加 `setActiveChains: (a) => { activeChains = a; }`。
- createNetworkRunner deps 加 `getActiveChains: () => ({ ...activeChains, outputs: gizmo.getEditNodeId() ? [true,true,true,true] : activeChains.outputs })`、`getEditedNodeId: () => gizmo.getEditNodeId?.() ?? null`、`computeOutputs: (i,s,c) => computeOutputsDetailed(i,s,c)`。
- core/gizmo.ts（Agent B 拥有）：createGizmoController 返回对象加 `getEditNodeId(): string | null`（返回 lastTransformId；无绑定返回 null）。

### web/src/viewport/geometry.ts + renderer.ts（Agent C 拥有）
- `sameTopology(a,b)`：先 O(1) 快路径 `a.pointCount===b.pointCount && a.curves===b.curves && a.faces===b.faces → true`，否则走现有深比较兜底（保持正确）。
- `updateGroupPositions`：跳过 `computeVertexNormals()`（纯平移不改法线）；缓存 derived 结构（used/isolated/edges）到 group.userData（build 时建），位置-only 更新直接复用。
- `renderer.refresh()`：位置-only 循环内 `if (buf.rev === lastShownOutputs[i].rev) continue;` 跳过未变缓冲。

### hda/src/cyl1nder_hda.py（Agent D 拥有）
- 抽 `_push_inputs_if_changed(node, root, serial, bridge_url, client) -> bool`（返回是否真的推了）：`_input_signature` + `_PUSH_CACHE` 门控 + serialize_input×4 + push_inputs（把 cook_core 与 cook(role) 的重复块收敛）。
- `cook_core()` 的 `if auto_push:` 块改调 helper；`cook(role)` 的 ROLE_PUSH 块也改调 helper（行为等价）。

## 四、写集（互不相交）
- Agent A：`web/src/nodes2/chain-cache.ts` + `web/tests/chain-cache.test.ts`
- Agent B：`web/src/nodes2/network.ts` + `web/src/core/network.ts` + `web/src/core/dataflow.ts` + `web/src/core/gizmo.ts` + `web/src/main.ts` + `web/tests/network.test.ts` + `web/tests/dataflow.test.ts`
- Agent C：`web/src/viewport/geometry.ts` + `web/src/viewport/renderer.ts` + `web/tests/geometry.test.ts`（新增，测 sameTopology 快路径）
- Agent D：`hda/src/cyl1nder_hda.py`（+ 必要时 cyl1nder_geometry/cyl1nder_cache 只读）
- 主进程：devlog/ 文档 + 版本号 + 索引 + 合并调用点。

## 五、验证
- Agent A/B/C：各自 `node node_modules/typescript/bin/tsc --noEmit`（web 目录）通过；vitest 单测（chain-cache 懒输出用例 / network ComputeResult / dataflow activeChains / geometry sameTopology）。
- Agent D：`python -m py_compile hda/src/cyl1nder_hda.py`；如可跑则 hython 冒烟。
- 主进程合并后：全量 tsc 0 + vitest + pytest 53 + e2e（--workers=1，round17/round19 重点：拖拽帧序、同数组引用）+ hython 冒烟（桥 8375 可起时）。

## 六、架构评估：下一轮候选（本轮不做，先记录）
1. **节点级输出缓存 + 脏传播（Zeno CachedByKey / Houdini DAG）**：把「每输出链缓存」推广到「每节点输出 + 端口级脏标记」，多节点大图只重算脏分支、共享子链只算一次（修 W1 的跨链重复）。
2. **SoA→Float32Array 直传 + Worker 双缓冲（Zeno AttrVector/MapStablizer）**：flat typed array 直传 BufferAttribute；计算/几何写入进 Web Worker、帧首原子替换；需协议层配合（见 3）。
3. **协议/快照二进制化（proto:"msgpack" + bgeo.sc 式旁路）**：三端同步（protocol.py/types.ts/protocol.md），独立分支按铁律走。
4. **HDA per-buffer 内容盖章（修 W9）**：_refresh_ready 只在内容真变时 bump _gen，未变 role 跳过 P 重写。
5. **GPU 拾取（Zeno FrameBufferPicker）**替代逐曲线 raycast；IndexedDB 帧缓存 + stampInfo 切帧。

## 七、devlog 并行规范确认
development-standards.md「代码修改默认派子智能体（铁律）」已存在（2026-08-11 起），本轮的派发/合并/单 commit 流程即按此执行；无需新增条款。

## 八、落地结果（v0.1.00095，主进程合并后）

- **Agent A（Descartes）**：chain-cache.ts——`CachedChainResult/CacheEntry.change` + `computeChainCached(active)` 懒输出矩阵（非激活链 sig 命中零工作、specs 不移动、自愈；sig 失配仍全量重 trace 保缓存有效）+ 死链 fallback memo（fb:<i> 按 inputsRev 复用同 buffer）+ `getCacheChange` / `resetFallbackMemo` / `getCacheEntrySpecs`。
- **Agent B（Gibbs）**：core/network.ts（no-op 帧提前 return；per-buffer rev 沿用 lastOutputs；只 push 变了的链）+ dataflow.ts（display focus → activeOutputs/activeNodeId 解析）+ main.ts（gizmo 晚绑定：编辑中全链激活）+ gizmo.getEditNodeId()。
- **Agent C（Lovelace）**：geometry.ts（sameTopology O(1) 引用快路径 + 缓存 used/isolated/edges 到 userData + 位置-only 跳过 computeVertexNormals）+ renderer.ts（refresh 按 per-buffer rev 跳过未变缓冲；showNodeResult 同对象短路）+ 新增 geometry.test.ts。
- **Agent D（Hilbert）**：cyl1nder_hda.py——抽 `_push_inputs_if_changed`，cook_core 与 cook(role) 共用 `_input_signature` + `_PUSH_CACHE` 门控（修 W8→W2 回声）。
- **主进程整合修复（合并时发现的回归）**：`activeNodeId`——显示 transform/null 直连输出链在 activeOutputs 全 false 时仍保持 live（round7「display transform 参数编辑不推桥」回归，2 例 e2e 修复）；新增 chain-cache 回归单测。
- **验证**：tsc 0 / vitest 145（+24）/ pytest 53 / e2e 81 passed + 1 skipped（round7/17/19 重点）/ hython SMOKE OK。
- **遗留（下一轮候选，见 §六）**：节点级输出缓存+脏传播、SoA→Float32Array+Worker、msgpack/bgeo.sc 二进制协议、HDA per-buffer 内容盖章（W9）、GPU 拾取。

---

> 并行过程注记：契约锚点 commit（ChainCtx.activeOutputs + ComputeResult + ActiveChains）先行，4 子智能体按不相交写集并行；合并后全量验证 + activeNodeId 集成修复 + devlog/索引/版本号 + 单 commit。