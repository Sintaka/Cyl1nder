# three.js 视口 gizmo 拖拽延迟调研（vs Houdini）

- 日期：2026-08-12
- 分支：codex/cyl1nder-v0（工作树干净；本调研只读代码 + 只写本文件）
- 范围：**仅调研，不实现**。本文件是结论与改进计划，不涉及任何代码改动；网络/渲染延迟数字为量级估算（O()），须实测校准。
- 关联代码：web/src/viewport/renderer.ts、web/src/viewport/geometry.ts、web/src/nodes2/network.ts、web/src/main.ts、web/src/bridge/client.ts、bridge/bridge/{routes,ws,workspace}.py

## 一句话结论

TypeScript 与延迟无关（类型在编译期消失，浏览器跑的是被 JIT 编译的 JS）；three.js 也不是 WASM（纯 JS + WebGL，光栅化在 GPU）。拖动 gizmo 时"几何跟不上、甚至 gizmo 也卡"的真正来源是**每次拖动事件都触发一条全量链路：objectChange → runNetwork（全量计算+克隆点）→ HTTP PUT 全量 JSON → bridge WS 回推 → store.upsertOutputs → 视口全量重建（outputs 与 nodeResult 双重建）→ rAF 重绘**，且**无节流**、重建是**主线程同步工作**会阻塞渲染。Houdini 快是因为原生 C++ 用持久 GPU buffer + 增量 matrix/位置更新，根本没有"每帧全量序列化+重建"这条路径。

---

## 1. 技术事实澄清（用户问题的直接回答）

| 问题 | 事实 | 与延迟的关系 |
|---|---|---|
| TS 是解释性语言吗？ | 不是。TS 只是编译期类型层，编译（tsc/vite）后变成纯 JS；运行时 V8/SpiderMonkey 对 JS 做解析+JIT（Ignition/TurboFan 等），类型在运行时**根本不存在** | **无关**。TS 零运行时开销，解释 vs 编译不是瓶颈 |
| three.js 是 WASM 吗？ | 不是。three.js 是纯 JavaScript 库（v0.180，WebGL 为主、可选 WebGPU），它通过 WebGL API 把 draw call/状态/缓冲交给 GPU；**光栅化在 GPU 上执行**，JS 只做场景图遍历、矩阵运算、draw call 提交 | 渲染本身不是瓶颈；JS 侧代价主要在场景遍历与数据上传，不是"被解释" |
| 为什么 Houdini 快？ | 原生 C++ 视口（OpenGL/DirectX）：场景遍历、拾取、重绘全原生 + 多线程；显示几何**常驻 GPU buffer**，交互只做增量（改 matrix / dirty 位置），不重传全量点数据 | 架构差异，不是语言快慢的差异 |

关键认知：**差别不在"解释型 vs 编译型"，而在数据路径**。Cyl1nder 每帧把整份几何当 JSON 串出去再串回来、再全量重建上传；Houdini 只更新变化的那一点点。

---

## 2. Cyl1nder 实际延迟链分析（Enter 变换 gizmo 拖动）

### 2.1 每帧（每个 pointermove）实际发生的事

| 步骤 | 位置 | 内容 | 量级（估算） |
|---|---|---|---|
| 1 | renderer.ts TransformControls | 拖动时 gizmo 更新临时 Object3D 的本地 matrix 并触发 objectChange（**未按 rAF 合并**，一个指针事件一次） | ~0.1ms（本地，应即时） |
| 2 | renderer.ts beginTransformGizmo 的 onObjChange → enterOnChange | 读 obj.position，四舍五入 4 位，回调给 main.ts | ~0.01ms |
| 3 | main.ts bindEnterGizmoToSelection 的 onChange | graph.setNodeParams(tx/ty/tz) + **void runNetwork()（无节流，每个事件都跑）** | 同步极快 |
| 4 | network.ts computeOutputs / computeNodeResult | 回溯链路；applyTranslateGrouped 对每个 transform **克隆全部点**（points.map(p=>[...p])） | O(P) 分配，P=10 万点时可达数十 ms |
| 5 | client.ts pushOutputs | HTTP PUT 到 127.0.0.1:8375，body 为**全量 points/curves/faces 嵌套数组 JSON** | stringify+传输 O(P)，大场景数十 ms |
| 6 | bridge/routes.py + workspace.py + ws.py | 解析 JSON → put_outputs（含全量内容 deep compare 去重）→ 若内容变则 rev+1 → **WS broadcast 回推**给包括本页在内的所有客户端 | ~1-5ms（本地回路本身不快，重在全量内容） |
| 7 | main.ts WS onmessage | JSON.parse → store.upsertOutputs → emit() | O(P) 解析 |
| 8 | main.ts store.subscribe | viewport.refresh()：**outputGroup.clear() + buildOutputs 全量重建**；refreshNodeFlags()：computeNodeResult + **showNodeResult 又一次全量重建**；另带 renderInspector/renderLog/scheduleSaveGraph/refreshSelectionPanels | 每步 O(P+F+E)：逐曲线 new BufferGeometry+setFromPoints、mesh 扇面三角化、computeVertexNormals、wire 边去重 Set、孤立点 |
| 9 | renderer.ts animate (rAF) | renderer.render 重绘 | GPU 侧正常，非瓶颈 |

### 2.2 瓶颈定位

1. **主线程同步全量重建（最大头）**：步骤 8 每次 emit 都 `clear()+buildCurves/buildMeshFaces`，且 display 节点为 transform/null 时 **outputs 与 nodeResult 各重建一遍**。重建分配大量 BufferGeometry/材料 + computeVertexNormals + 边去重，是同步 CPU 工作——**它跑的时候 rAF 渲染（gizmo 本身）也停了**，所以 gizmo 也跟着卡，体感"比 Houdini 还慢"。
2. **每帧全量网络回路 + 无节流**：步骤 3-7 每个 pointermove 都走一次完整 JSON 回路；pointer 事件频率（≥60Hz，可高于刷新率）不被合并，中间还有并发 PUT 风暴与 rev 递增。
3. **全量 JSON 序列化**：协议用 number[][] 嵌套数组 + JSON，大场景下 stringify/parse 本身占主线程、带宽也大。
4. **gizmo 本身不是问题**：步骤 1-2 是纯本地矩阵 + 下一帧 rAF 重绘，正常应"即时跟手"；它之所以显得慢，是被步骤 8 的同步重建拖住了同一主线程。

结论：**three.js 渲染不是延迟来源**；延迟来源是"每次拖动事件的 onChange → runNetwork → 全量 JSON 回路 → 全量重建"这条**数据/重建链路**（且无节流、双重建）。

---

## 3. 改进方向（计划，本轮不实现）

| # | 方向 | 做法 | 预估收益 | 复杂度 | 备注 |
|---|---|---|---|---|---|
| 1 | **拖动时本地预览（首选）** | 拖动期间只在视口对**显示几何**应用变换（移动对象 matrix 或位置增量），几何立即跟手；**提交时**（松开，或节流 30-60Hz）才走 runNetwork 回路 | **高**：几何跟手延迟从"1 回路+1 重建"降到 0（同帧）；同时砍掉拖动期大部分网络/重建 | 中 | 需预览态与提交态分离，防与 store 回写互相打架；可与 #2 组合 |
| 2 | **节流/合并 runNetwork** | 每次 objectChange 只更新 params，runNetwork 按 rAF 或 30-60Hz 合并、只发最新值（拖动期可降频，提交时补发最终值） | 中-高：请求/重建/GC 直接降一个量级 | 低 | 现 onChange 路径完全无节流，是"每帧全链路"的直接原因 |
| 3 | **位置-only 更新 / 矩阵预览** | 拓扑不变时不再 clear+重建：原地写 BufferGeometry position（Float32Array + needsUpdate），纯平移甚至直接改对象 matrix（O(1)）；不再 computeVertexNormals/边去重 | 高：重建 O(P+F+E) 分配+法线 → O(P) 或 O(1)，顺带消除 GC 卡顿 | 中 | 与 #1 结合：提交前本地只动 matrix，提交后按最终值做一次位置更新 |
| 4 | **消除 outputs/nodeResult 双重建** | display 为 transform/null 时，emit 只重建被显示的那份（nodeResult），跳过 outputGroup 全量重建（或反之） | 中：编辑路径重建减半 | 低 | main.ts store.subscribe 与 refreshNodeFlags 的职责边界 |
| 5 | **内容去重跳过重建** | bridge 已做 echo guard，但 web 端每次 accept 都重建；按内容比较（或 emit 带 changed 标记）跳过无变化重建 | 中 | 低 | 也可直接给 refresh() 传本次 changed buffers |
| 6 | **协议序列化优化** | number[][] → flat Float64Array / TypedArray（或二进制/msgpack），减小 stringify/parse 与带宽 | 中-高（大场景明显） | 中-高 | 跨端：须同步 bridge/bridge/protocol.py + web/src/protocol/types.ts + devlog/protocol.md（铁律 3） |
| 7 | **计算/重建移出主线程** | computeOutputs + 几何重建放 Web Worker，主线程只渲染 | 中：彻底消除主线程卡顿，gizmo 稳 60fps | 高 | 需要 transferable/序列化改造，收益与 #1+#3 部分重叠，优先级靠后 |
| 8 | **raycast 优化** | 点选用 BVH/空间索引或粗化（现在逐曲线 intersectObjects） | 低：只影响点选/拾取手感，**不影响拖拽延迟** | 中 | 拖拽路径不经过 raycast，列为顺带项 |
| 9 | **渲染批处理** | 多条曲线合并为 LineSegments 单 draw call，减少 CPU draw-call 提交 | 低-中（曲线多时） | 中 | 渲染本身已非瓶颈，仅当顶点/draw call 数很大时考虑 |

推荐落地顺序（下一步）：**#1 本地预览 + #2 节流（合并提交）→ #3 位置-only 更新 → #4 去双重建**；#6/#7 视大场景实测再议。

---

## 4. 结论

- TS/three.js/WASM 都不是原因：TS 类型编译期即消失；three.js 是 JS + WebGL（GPU 光栅化）；真正差异是**数据路径**——Cyl1nder 每帧"全量 JSON 回路 + 主线程全量重建（双重建）且无节流"，Houdini 是"原生增量 + 常驻 GPU buffer"。
- 本轮**仅调研**：无代码改动、无提交、未触碰 bridge/HDA/其他 devlog；后续按 §3 顺序实现并各自配 devlog 专题与跨端验证。


---

## 5. 理念纠正（v0.1.00090 起，取代 §3 #1 的旧「本地预览」实现）

> 用户明确：Cyl1nder 的计算理念是「**操作时本地执行、不重建所有网格、不强依赖桥**；桥推送与网格重建只在数据真正更新时发生」。跟手的正确机制是「**更新 parms → 触发视口刷新 → 几何体移动**」，gizmo 与几何体**分离**（gizmo=TransformControls 临时对象，几何体=显示节点结果），而不是直接去摆弄几何体做预览。

- **v0.1.00089 的实现是错误的**：`updateDragPreview/endDragPreview` 直接改 nodeResultGroup/outputGroup 的 position 做矩阵预览，绕过了 parms；且让 mouseup 模式拖拽期间几何体也跟手（违背 mouseup 本意 = 松手才更新 parms → 视口才更新）。
- **v0.1.00090 起改为**：
  1. 删除矩阵预览 hack（core/gizmo 的 lastCommitted delta、renderer 的 dragPreview）。
  2. **mouseup**：拖拽只动 gizmo、不改 parms、不动几何；松手提交 parms → runNetwork → 视口刷新。
  3. **auto**：每次拖拽帧更新 parms（本地）→ runNetwork 本地乐观计算 → store emit → 视口刷新，**拓扑不变时只做位置-only 更新**（原地写 BufferGeometry position + needsUpdate，必要时重算法线，不 clear+rebuild、不分配新几何）——这才是「不重建所有网格 + 不强依赖桥」的实现；桥推送是 fire-and-forget，只是数据更新触发。
  4. §3 #1 的「本地预览」重释为「**位置-only 更新（由 parms 触发）**」，不再是脱离 parms 的手动矩阵平移；§3 #2 节流/合并 runNetwork 仍列为后续可选优化（当前 auto 保持同步乐观，保证 round17 回归）。
  5. Esc：只在视口悬停时退出 Enter 模式；nodeview 内 Esc 用于取消进行中的连线/重连/插入操作（见 nodeview 交互轮）。

---

## 6. 实时性链路分析 + P1 落地（v0.1.00091）

> 角色：主进程（分析 + 实测 + 合并）。实测用 Playwright 包装 `renderer.render`/`performance.now()` 在真实 dev server + bridge 上采集。

### 6.1 实测链路（小场景 4 点）
| 步骤 | 耗时 |
|---|---|
| pointermove → TransformControls 改 gizmo 矩阵（O(1)，scene graph 立即可见） | ~0ms |
| objectChange → onChange → setNodeParams + runNetwork（同步计算 + store 乐观 upsert） | ~1.4ms（store 同步就绪） |
| 下一帧 rAF：几何 BufferGeometry 属性更新到位 | ~8ms |
| **渲染像素上屏**：P1 前 render 先于 flush → 几何稳定比 gizmo 慢 1 帧（~16ms） | 帧序问题 |

结论：**数据路径几乎零延迟，延迟在渲染管线**——① render 在 flush 之前（恒定 1 帧几何-gizmo 间隙）；② 拖拽期每 pointermove 同步全量计算（无合并，含大量过期帧）；③ `refreshNodeFlags` 每帧再 `computeNodeResult` 克隆一遍（与 `computeOutputs` 双重计算）；④ `applyTranslateGrouped` 每帧 `points.map([...p])` 全量克隆（无 Web 侧计算缓存）。

### 6.2 理念定位（与 Houdini 对齐）
- Houdini 视口：原生 C++，显示几何常驻 GPU buffer，交互只做增量（matrix/dirty 位置），cook 在后台线程，无 JS GC、无 rAF 批处理；gizmo 与几何是同一对象 transform 的两个视图。
- Cyl1nder：gizmo 同步因为它只改一个 Object3D 矩阵（绕过数据管线）；几何要走「parms → runNetwork → store → flush → 几何更新」的 JS 数据管线。**three.js 不是瓶颈**（BufferGeometry 属性原地写 + needsUpdate 本就为每帧设计），是流程设计问题。

### 6.3 P1 已落地（v0.1.00091）
1. **帧序：flush 先于 render**——`Viewport.setPreRenderFlush(fn)`，`animate()` 在 `renderer.render()` 前调 hook；main.ts 的 `store.subscribe` 只置 `pendingFlush`，由 pre-render pump 每帧 drain（几何与 gizmo 同帧上屏，恒定 1 帧间隙消除）。e2e 新增「单次 objectChange 后首个 render 即画到新几何」断言（包装 renderer.render 验证）。
2. **拖拽期合并计算（latest-wins）**——`core/gizmo.ts` 的 `applyTransformDrag` 由每事件 `runNetwork` 改为 `scheduleNetwork()`（置 `networkDirty`）；pre-render pump 每帧至多一次 `network.run()`（取最新 parms，乐观 upsert + fire-and-forget push），丢掉过期中间帧。round17 同步断言改为帧内 poll。
3. **去双重计算**——`core/dataflow.ts`：`flush()` 每帧只解析一次显示节点 buffer（`displayNodeOutputIndex` 命中「display 直连 output.out_i」时复用 `store.outputs[i]`，否则 `computeNodeResult` 一次），`refreshNodeFlags(displayBuffer?)` 消费预计算；`flush()` 顺序改为先 `refreshNodeFlags` 后 `refresh`（renderer 先知道最终可见性，才能安全跳过隐藏 outputGroup）。
4. **输出新鲜度门控**——新增图拓扑版本号（graph.ts 管道对 connection/node 增删 bump `getGraphVersion`）；`createNetworkRunner` 记录 `lastCookGraphVersion` 并暴露 `isFresh()`；`flush()` **只在 outputs 与当前拓扑同版本时复用**，否则回退 `computeNodeResult`（restoreGraph/拖线建连等未 cook 的拓扑变化不会拿到过期数据——修复了 P1 复用导致 round7 回归的问题）。
5. **隐藏 outputGroup 跳过**——`renderer.refresh()` 在 outputGroup 隐藏时跳过几何工作且不消费 rev（display=transform 时省掉每帧浪费；切回 output 时同帧重建）。
6. 验证：tsc 0, vitest 109, pytest 53, e2e 80 passed/1 skipped。

### 6.4 P2 预告（下一轮）
- 免克隆平移 + 链状态缓存：按 output/显示节点缓存 `{ base, points, sig, lastParams }`，`sig` 不变且仅 tx/ty/tz 变化 → 对缓存 points 就地加 delta（全点 O(P) 零分配；组子集用缓存命中集只改命中点，命中集在节点输入上求、以输入 sig 作失效键）；`sig` 变 → 全量重 trace。`applyTranslateGrouped` 保留给全量重 trace，新增就地 delta 模式。
- 拓扑变化 → cook 语义补全（拖线建连/Tab 建节点也应刷新 outputs，对齐「cook 即显示数据」；P1 用新鲜度门控兜底，P2 链缓存后可直接补 cook）。