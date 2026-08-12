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
- [~] 2.1 `main.ts` 抽 core：已完成 `core/lifecycle.ts` + `core/shortcuts.ts` + `core/params.ts` + `core/param-undo.ts` + `core/gizmo.ts`；待续 `core/session.ts`（连接/WS/网络）。
- [ ] 2.2 `graph.ts` 拆 `nodes2/graph-view.ts` / `graph-interact.ts` / `undo.ts` 强化；先定函数签名契约再并行。
- [ ] 2.3 `viewport/renderer.ts` 拆 `scene` / `camera` / `gizmo` / `picking` / `modes`。
- 验收：tsc 0 + vitest + 全量 e2e；主进程 merge 前 review 写集不越界。

### 阶段 3（大拆，跨端）
- [ ] 3.1 `hda/src/cyl1nder_hda.py` 按 sync/geometry/cache/lifecycle 拆分；hython smoke + 热重载冒烟（reload 前 stop_all_sync）。
- [ ] 3.2 `color.ts` 余下 UI 部分拆 `color/` 目录（picker-shell / wheel-sv / harmony / palette）。
- [ ] 3.3 视口与节点图之间建立更清晰的「编辑 → 网络 → 视口」数据流，消灭 main.ts 的直连。
- 验收：三端（pytest / tsc+vitest / hython smoke）+ 跨端 E2E 全绿。

## 五、执行纪律（与现有规范一致）
- 每项独立分支 `codex/<版本>-refactor-<域>`；不同域可并行，同文件不并行。
- 先定契约（导出函数签名）再拆，主进程建骨架/锚点，子智能体按写集实现。
- 每步保持行为零变化：git diff 只允许「移动 + 导出/导入 + 必要适配」，禁止顺带改功能。
- 每完成一项，更新 `devlog/shit-mountains.md` 行数/状态与本文件 checkbox。

## 六、状态
- 2026-08-13：阶段 1 完成；阶段 2.1 已抽出 `core/lifecycle.ts` + `core/shortcuts.ts` + `core/params.ts` + `core/param-undo.ts`（round5/8/12/14/16 e2e 通过）；2.1 其余（session/gizmo）待续。
## 七、当前执行（in progress，检查点 2026-08-13）
- 分支：`codex/0.1.00075-refactor-gizmo-session`（已从 `codex/cyl1nder-v0` 切出）。
- 已完成：**2.1-gizmo** 抽 `web/src/core/gizmo.ts`（round12/16 6 passed）。\n- 下一步：**2.1-session** 抽 `web/src/core/session.ts`（connect/WS/networkEpoch/runNetwork/applyOutputs），继续本分支。
  - 状态收拢为闭包对象：`pendingTransform / dragNodeId / dragBefore / dragAfter / lastTransformId`。
  - 工厂签名（契约，主进程先定骨架）：
    ```ts
    export interface GizmoDeps {
      viewport: Pick<Viewport, "isEnterActive" | "setEnterActive" | "beginTransformGizmo" | "endTransformGizmo" | "setEnterPosition" | "setEnterPivot">;
      graph: Pick<ReteGraph, "getSelectedNode" | "getNetworkSnapshot" | "setNodeParams" | "pushUndo">;
      runNetwork(): void;
      log(msg: string): void;
      getUpdateMode(): "auto" | "mouseup";
    }
    export function createGizmoController(deps: GizmoDeps): {
      toggle(): void;
      bindToSelection(): void;
      onParamsApplied(nodeId: string, params: ParamLike[]): void;
    };
    ```
  - main.ts 保留调用点：`viewport.setEnterEditHandler(gizmo.toggle)`、`graph.onSelectionChanged(() => { paramUndo.flush(); refreshSelectionPanels(); if (viewport.isEnterActive()) gizmo.bindToSelection(); })`、`handlers.onParamsApplied` 里转调 `gizmo.onParamsApplied`。
  - 验证：tsc 0 + vitest 101 + e2e round12/16。
- 之后：**2.1-session** 抽 `web/src/core/session.ts`（connect/WS/networkEpoch/runNetwork/applyOutputs），同分支继续。