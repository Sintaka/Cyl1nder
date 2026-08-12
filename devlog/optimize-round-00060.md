# 优化轮 v0.1.00060：dock 圆角外折 + nodeview 层级 + Overview 新标签 + HDA 重启恢复 + 视口 Undo / Polish round 2

> 版本 0.1.00060 候选 · 日期 2026-08-12 · 角色：主进程（设计 + 契约 + 合并 + 文档）

## 一、任务（用户反馈）
1. **dock 活跃标签底部圆角（Round 10）**：Round 9 把「实心阴影」改对了（凹口与内容区 #141518 衔接），但**蓝色圆角没恢复**——现在蓝色折进了 tab 矩形内侧；用户需要**往外折**（v0.1.00057 那种蓝色 crescent 向外翻过邻标签的 Chrome 式轮廓是正常的），同时**背后的实心阴影必须消除**（不覆盖不活跃标签角落）。
2. **nodeview 背景小圆点层级**：`.cyl-dotgrid`（z-index 0）渲染到了 node 及其上字符串**之上**——修复层级（节点/文本永远在点阵之上）。
3. **Overview 默认行为**：从主应用进 Overview（左上角 brand）改成**新开标签页**（`target="_blank" rel="noopener"`），不再本页面跳转。
4. **bridge 重启后几何不恢复**：每次重启 bridge 后必须 Reload HDA 才有几何数据（Force Cook 不行）。根因（已定位）：HDA `_stream_loop` 收到 `reset` 事件（since>rev，桥重启）后只 `_reset_ready` + 重拉 + recook，但 **`_PUSH_CACHE` 未清理** → recook 时输入签名未变 → 不重推 inputs → bridge workspace 空 → web 无几何。修复：reset 时清理 push/geo 缓存并确保调度 recook。
5. **视口参数 Undo**：Ctrl+Z 要支持 viewport gizmo 修改的属性；**一次拖动 = 一步撤回**（不是 3 个 float 3 步）；批量脚本执行按钮等**一步回到执行前**。现状：`applyTransformDrag`（gizmo 拖动）直接 `setNodeParams`，未进 undo 栈；params 面板编辑已有 600ms 合并（单节点一次）。

## 二、契约
### 2.1 dock（Agent A）
- 目标：活跃 tab 底部两角**蓝色向外翻折**（Chrome 式，蓝色 crescent 越出 tab 矩形盖在邻标签角上，如 v0.1.00057），但**背后不得有实心深色/蓝色阴影块**盖住不活跃标签角落。参考 %TEMP%\cyl1nder-dock-agent\ 的 harness/脚本做视觉迭代；验收：活跃 tab 底角有外翻蓝色 crescent + 邻标签角落无深色块遮挡（像素验证）。

### 2.2 nodeview 层级（Agent B）
- `.cyl-dotgrid` 与节点/文本的层级：节点（含 title 字符串）必须永远在点阵之上。先检查实际 DOM（rete area 容器类名是否被 `.cyl-graph .rete-area` 命中），再用 CSS 修复（如点阵 `z-index:-1` 且 `.cyl-graph` 背景透明、或正确选择器让内容容器 `z-index:1`）。**只改 CSS**（nodeview.css）；若确需 JS，回报主进程（graph.ts 归 Agent E）。

### 2.3 Overview 新标签（Agent C）
- `web/src/app/layout.ts` 两处 `.cyl-brand` 加 `target="_blank" rel="noopener"`；检查 round9/round8-overview e2e 是否断言 brand 导航，如有则适配（新标签断言用 `page.waitForEvent("popup")`）。

### 2.4 HDA 重启恢复（Agent D）
- `_stream_loop` 的 `reset` 分支：`_reset_ready` 之外**清理 `_PUSH_CACHE[serial]`（必做）**，并清理 `_GEO_CACHE`/`_CORE_CACHE`/`_OUT_CACHE` 中该 serial 的条目（防旧拓扑/旧几何被复用）；**确保调度 recook**（reset 是罕见关键路径，可绕过 fps 节流直接调度，`scheduled` 门控仍防重叠）。下次 recook 重推 inputs → bridge 有数据 → web 恢复几何。
- hython_smoke：新增断言——reset 事件后 `_PUSH_CACHE` 被清 + recook 被调度（fake client 场景）。

### 2.5 视口 Undo（Agent E）
- undo.ts：UndoAction 增加 `{ type:"group"; actions: UndoAction[] }`（undo=逆序应用、redo=顺序应用）。
- graph.ts：`applyUndoAction` 支持 group；新增 `pushUndoGroup(actions)` 或 begin/end 事务 API（供批量脚本按钮等用）。
- main.ts：gizmo 拖动进 undo——拖动开始捕获该节点 params 为 `before`，每帧更新 `after`，**拖动结束一次性 `graph.pushUndo({type:"params", nodeId, before, after})`**（auto 与 mouseup 两种模式都是**一次拖动一步**）；与 params 面板的 600ms 合并机制不冲突。
- 新 e2e round16-undo.spec.ts：gizmo 拖动 transform → Ctrl+Z 回到拖动前位置（一步）；多帧拖动仍只产生一个 undo 条目。

## 三、落地分工（并行 agent，写集不相交）
- **A（dock 外折圆角）**：web/src/styles/dock.css、web/src/app/dock.ts（如需要）。
- **B（nodeview 层级）**：web/src/styles/nodeview.css。
- **C（Overview 新标签）**：web/src/app/layout.ts、web/e2e/round9-overview.spec.ts、web/e2e/round8-overview.spec.ts。
- **D（HDA 重启恢复）**：hda/src/cyl1nder_hda.py、hda/scripts/hython_smoke.py。
- **E（视口 Undo）**：web/src/nodes2/undo.ts、web/src/nodes2/graph.ts、web/src/main.ts、web/e2e/round16-undo.spec.ts（新建）。
- **主进程**：devlog（annotations-web / README / 本设计文档）+ 版本 bump 0.1.00060 + 合并验证 + 单 commit。

## 四、验证
- web：tsc 0 + vitest 82 + e2e（round6/8/9/12/13/14/15/16 + smoke，--workers=1）。
- hda：hython 冒烟（reset→重推 inputs）+ 真桥验证。
- bridge：pytest 50（无 bridge 改动）。
- dock：视觉迭代（外翻蓝 crescent + 邻标签无深色遮挡，像素验证）。