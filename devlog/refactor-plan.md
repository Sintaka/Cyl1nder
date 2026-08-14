# 架构优化持续改进计划（refactor roadmap）

> 日期 2026-08-13 · 持续更进：每轮挑 1-2 项，按 devlog/development-standards.md 的并行写集规则独立分支推进。
> 关联：devlog/shit-mountains.md（屎山标注）、devlog/README.md（索引）、devlog/development-standards.md（并行/分支/验证铁律）。

## 一、目标
在不改变外部协议与行为的前提下，把「屎山」按域拆薄：单文件 ≤ ~300 行、单函数 ≤ ~80 行、职责单一，降低 token 消耗与回归风险。

## 二、当前架构痛点
### web（问题最重）
1. `main.ts`（1144 行）是 god object：启动、连接、网络、视口、gizmo、菜单、快捷键、自动保存全塞一起，任何 UI 迭代都要碰它。
2. `nodes2/graph.ts`（1564 行）：节点图渲染、连线交互、拖拽、撤销、参数、选择耦合在一起。
3. `app/color.ts`（1073 行）：纯色彩数学（可独立测）与 DOM 浮窗、色轮/SV/和谐、调色板、最近色、撤销混在同一文件。
4. `viewport/renderer.ts`（729 行）：Three 场景、相机、gizmo、拾取、显示模式、事件未分层。
5. 依赖图显示 `main.ts` 是唯一入口但承担过多接线；部分 app 模块（param/spreadsheet/dock）已较薄，可作拆后参照。

### bridge（已较薄，保持）
- `routes.py`(316) / `state.py`(198) / `registry.py`(176) 职责清晰；暂不需要大拆，仅随协议演进维护。
- 观察点：`mcp_server.py`(246) 可再按「查询 / 几何 / 索引」分组，但非紧急。

### hda
- `cyl1nder_hda.py`(782) 最重：cook 逻辑、推拉、/stream 循环、几何应用、缓存、桥/前端启动混在一起；且受 Houdini 线程安全约束，拆分要更谨慎。

## 三、目标架构（拆分方向）
### web/src
- `app/` 只留纯 UI 组件与浮窗：`layout`、`dock`、`param`、`preference`、`color`、`spreadsheet`、`widgets`。
- `nodes2/` 节点图域：拆 `graph-model`（节点/连线/选中态）、`graph-view`（rete 渲染）、`graph-interact`（拖拽/连线）、`undo`、`groups`。
- `viewport/` 渲染域：拆 `scene`（Three 对象）、`camera`、`gizmo`、`picking`、`modes`。
- `core/`（新增）：启动/会话/网络/快捷键/自动保存，从 `main.ts` 抽出，`main.ts` 只做装配。
- `color/`（可从 app 拆出独立目录）：`color-math`（纯函数，可单测）、`wheel-sv`、`harmony`、`palette`、`picker`。

### bridge/bridge
- 维持现状；如未来增加服务，按 `routes` 已有模式扩展，不新建大文件。

### hda/src
- 拆 `sync.py`（/stream 循环与拉取）、`geometry.py`（buffer→geo 应用）、`cache.py`（_READY/_GEO/_PUSH 等）、`lifecycle.py`（桥/前端启动、串口生成）、`hda.py`（cook 入口与参数）。
- 注意：后台线程不碰 hou，拆出模块仍遵循 hda-hot-reload 的 stop_all_sync 前置。

## 四、分期路线图
### 阶段 1（低风险，先拆纯函数与薄文件）
- [x] 1.1 `color.ts` 拆出纯色彩数学到 `color-math.ts`（rgb/hsl/hsv、hex、转换），先补 vitest 纯函数覆盖，再让 picker 引用。
- [x] 1.2 `nodes2/groups.ts` 拆 parser / matcher 两个职责（barrel 保持外部 import 不变）。
- [-] 1.3 `mcp_server.py` 按工具组拆（本轮跳过：246 行非紧急，FastMCP 注册方式需额外验证）。
- 验收：tsc 0 + vitest 增量 + e2e round15/round12 不回归；行为零变化。

### 阶段 2（中拆，分模块）
- [x] 2.1 `main.ts` 抽 core：已完成 `core/lifecycle.ts` + `core/shortcuts.ts` + `core/params.ts` + `core/param-undo.ts` + `core/gizmo.ts` + `core/network.ts` + `core/kick.ts` + `core/session.ts`。
- [x] 2.2 `graph.ts` 拆 `nodes2/graph-model.ts` / `graph-interact.ts` / `graph-undo.ts`（barrel 保持 `./nodes2/graph` 对外 API 不变）；主进程建契约骨架 + 4 子智能体并行（model/interact/undo/shell 写集不相交）；tsc 0 + vitest 101 + vite build 通过 + 节点图 e2e round2/16 8 passed。
- [x] 2.3 `viewport/renderer.ts` 拆 `scene` / `camera` / `gizmo` / `picking` / `modes`（+ `state` 共享态，barrel 对外 API 不变）；5 子智能体并行（modes/scene+camera/picking/gizmo/shell 写集不相交）；tsc 0 + vitest 101 + vite build 通过 + 视口 e2e 26 passed。
- 验收：tsc 0 + vitest + 全量 e2e；主进程 merge 前 review 写集不越界。

### 阶段 3（大拆，跨端）
- [x] 3.1 `hda/src/cyl1nder_hda.py` 按 lifecycle/cache/geometry/sync 拆分 + `cyl1nder_hda.py` 外壳 barrel（保留公开模块名 `cyl1nder_hda`，re-export 全部 smoke 依赖名）；hython smoke 全绿（reload_hda MODULES 顺序 + smoke `_schedule_recook` monkeypatch 目标同步到 `cyl1nder_sync`）。
- [x] 3.2 `color.ts` 余下 UI 拆 `color/` 目录：`color/color-math.ts` + `color/harmony.ts` + `color/palette.ts` + `color/wheel-sv.ts`（createWheelSv 依赖注入，setColorRef/pickHarmonyRef 破环）+ `color/picker.ts`（openColorPicker 外壳）+ `app/color.ts` 2 行 barrel；公开 API 不变。
- [x] 3.3 视口↔节点图数据流清晰化：抽 `core/dataflow.ts`（createDataflow：getDisplayNodeInfo/refreshNodeFlags/handlers/flush/wireSelection，graph·network·viewport·gizmo 全部 late-bound getter 破 chicken-and-egg）；main.ts 793 行退化为 UI 装配。
- 验收：三端（pytest / tsc+vitest / hython smoke）+ 跨端 E2E 全绿。

## 五、执行纪律（与现有规范一致）
- 每项独立分支 `codex/<版本>-refactor-<域>`；不同域可并行，同文件不并行。
- 先定契约（导出函数签名）再拆，主进程建骨架/锚点，子智能体按写集实现。
- 每步保持行为零变化：git diff 只允许「移动 + 导出/导入 + 必要适配」，禁止顺带改功能。
- 每完成一项，更新 `devlog/shit-mountains.md` 行数/状态与本文件 checkbox。

## 六、状态
- 2026-08-13：阶段 1 完成；阶段 2.1 完成（core 八子刀）；阶段 2.2 完成（graph.ts 拆 model/interact/undo + 外壳）；阶段 2.3 完成（viewport/renderer.ts 拆 scene/camera/gizmo/picking/modes/state + 外壳）；阶段 3.1 完成（hda 拆 lifecycle/cache/geometry/sync）；阶段 3.2 完成（color 拆 color/ 五件套）；阶段 3.3 完成（core/dataflow 数据流）。全部完成。
## 七、当前执行（检查点 2026-08-13）
- 分支：`codex/0.1.00087-refactor-dataflow`。
- 已完成 **3.3**：抽 `web/src/core/dataflow.ts`（143 行，createDataflow）——把 main.ts 里「编辑 → 网络 → 视口」的四处直连（`handlers` 的 onNodePick/onFlagsChanged/onNetworkChanged/onParamsApplied + `refreshNodeFlags` + `graph.onSelectionChanged` + `flushStoreView` 的数据流段）收拢成 `{ handlers, refreshNodeFlags, flush, wireSelection }`；graph/network/viewport/gizmo 用 late-bound getter 破「graph 需 handlers，handlers 需 graph」的鸡生蛋。main.ts 892→793 行，只留 UI 装配 + 布局/会话/菜单/快捷键。
- 验证：tsc 0 + vitest 101 + build 通过 + 视口/节点图 e2e（round2/4/5/6/7/8/12/16/17）26 passed。
- 阶段 3 全部完成（3.1 hda / 3.2 color / 3.3 dataflow）。
- **状态更新（v0.1.00104，2026-08-14）**：本计划全部阶段已完成，`§七` 收尾归档。后续架构工作以 `devlog/ear-hda-plan.md`（挂耳 HDA + 项目绑定 + 轨迹页）为主计划。
## 八、2.2 `graph.ts` 分支计划（已完成 2026-08-13）
- 单独分支：`codex/<版本>-refactor-graph`（从完成 2.1 后的分支切出）。
- 先做只读边界分析再切，因为 `graph.ts` 是 rete 渲染/连线/拖拽/撤销/参数/选择的耦合体，且对外暴露 `__cylGraph`、`createReteGraph`、`ReteGraphHandlers`。
- 建议拆成 3 个内部模块 + barrel（保持 `./nodes2/graph` 对外 API 不变）：
  1. `nodes2/graph-model.ts`：节点/连线/选中态/网络快照（纯数据结构 + 只读查询）。
  2. `nodes2/graph-interact.ts`：拖拽、连线、框选、快捷键交互（依赖 model + rete）。
  3. `nodes2/graph-undo.ts`：`pushUndo`/`pushUndoGroup`/undo-redo 状态机（现 `nodes2/undo.ts` 已有，迁移/强化）。
  - `graph.ts` 保留 `createReteGraph()` 装配 + `ReteGraphHandlers` 回调派发，退化为外壳。
- 契约锚点：先定 `GraphModel` 与 `GraphInteract` 的导出函数签名，主进程建骨架；子智能体按写集实现（model/interact/undo 三个写集不相交）。
- 验证：`tsc 0` + `vitest`（undo/network/groups 相关）+ 全量 e2e（round2~8 节点图 + round12/16）。
- 风险：`graph.ts` 1564 行是当前最大屎山，建议作为独立一轮、单独分支、分 2-3 刀切，不与 session 收尾并发。
## 八·补 2.2 关系图与基础架构图（分支 `codex/0.1.00080-refactor-graph`，2026-08-13 复核）

### graph.ts 关系图（当前）
```
graph.ts (1564 行)
  导入:
    rete (ClassicPreset, NodeEditor)
    rete-area-plugin (AreaPlugin, AreaExtensions)
    rete-connection-plugin (ConnectionPlugin, Presets)
    rete-engine (DataflowEngine)
    rete-react-plugin (Presets, ReactPlugin, useRete, ClassicScheme, ReactArea2D)
    react-dom/client (createRoot), react
    ./NodeView (NodeView, notifyNodeChanged, setDisplayHandler)
    fuse.js (Fuse)
    ../stores/workspace (store)
    ./network (type NetworkSnapshot)
    ./undo (createUndoManager, ConnectionRef, UndoAction, UndoManager)

  导出:
    createReteGraph()          ← 唯一入口（main.ts 调用）
    ReteGraphHandlers, ReteGraph
    NodeKind, NodeFlags, DEFAULT_FLAGS, ParamSpec, SelectedNodeInfo
    CylNode, makeNullNode, makeTransformNode
    setNodeStateHandler/fireNodeState, setRenameHandler/fireRename
    initTooltip/showTooltip/hideTooltip

  唯一外部消费者:
    main.ts → createReteGraph, ReteGraphHandlers
```

### 2.2 完成后基础架构图（已落地）
```
main.ts（装配层）
   └── import ./nodes2/graph（对外 API 不变）

nodes2/graph.ts（外壳，只装配 rete + 回调派发，~200 行）
   ├── nodes2/graph-model.ts   节点/连线/选中态/网络快照/参数/序列化/restoreGraph
   ├── nodes2/graph-interact.ts 拖拽/连线/框选/快捷键/tooltip/state handler/rename
   ├── nodes2/graph-undo.ts     pushUndo/pushUndoGroup/undo/redo（复用 nodes2/undo.ts）
   └── nodes2/undo.ts           （已有，纯撤销状态机，保持）
```
- 契约锚点：`GraphModel`、`GraphInteract` 的导出函数签名由主进程先建骨架；子智能体按 model/interact/undo 三个写集实现。
- 验证：`tsc 0` + `vitest`（undo/network/groups）+ 节点图 e2e（round2/4/5/6/7/8/12/16）。

## 九、3.3 数据流清晰化方案（已完成 2026-08-13）
### 现状
`main.ts` 仍是「编辑 → 网络 → 视口」的唯一接线员，四处直连：
- `graph.onNodePick` → `viewport.pickByNode`
- `graph.onFlagsChanged` / `onNetworkChanged` / `onSelectionChanged` → `refreshNodeFlags()` + `network.run()` + `refreshSelectionPanels()`
- `store` 变更 → `flushStoreView()` 一次性刷 `viewport.refresh()` + `refreshNodeFlags()` + 面板/inspector/log
- `refreshNodeFlags()` 内部再读 `graph.getDisplayNode/getDisplayPortIndex/getNetworkSnapshot` 直连 `viewport.showNodeResult(computeNodeResult(...))`

### 目标
抽 `core/dataflow.ts`（或 `viewport/bridge.ts`）：一个纯「装配器」，持有 store/graph/network/viewport 的引用，订阅 graph 回调与 store 事件，把「编辑 → 网络 → 视口」编成一条数据流；`main.ts` 只做 `createDataflow({...})` 装配 + 菜单/快捷键等 UI 接线。

### 拆分建议（契约先定，子智能体并行）
1. `core/dataflow.ts`：`createDataflow(deps)`，deps = `{ store, graph, network, viewport, computeNodeResult, refreshSelectionPanels, markGraphDirty }`；返回 `{ onSelectionChanged, onFlagsChanged, onNetworkChanged, onNodePick, flush }`。
2. `refreshNodeFlags` 逻辑迁入 dataflow（读 display node/port/snapshot → 驱动 viewport 可见性/焦点/node-result）。
3. `main.ts` 只保留 `handlers` 的薄转调 + `flushStoreView` 里调用 `dataflow.flush()`。
- 验证：tsc 0 + vitest 101 + 视口/节点图 e2e（round2/4/5/6/7/8/12/16/17）。
- 风险：`refreshNodeFlags` 是 viewport 与 graph 的耦合点，先做只读边界分析再切，单闭包 context 化（参考 3.2 wheel-sv 的 setColorRef 破环法）。