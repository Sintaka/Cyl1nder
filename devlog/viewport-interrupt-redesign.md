# 视口中断系统重设计 + 本地新鲜度 + kick 限流 / Interrupt redesign, local freshness & kick throttle

> 版本 0.1.00064 候选 · 日期 2026-08-12 · 角色：主进程（调研 + 契约 + 合并）
> 关联：`viewport-gizmo-latency.md`（v0.1.00054 调研）、`sync-rate-limit-and-preference.md`（v0.1.00057 每端 fps）、`optimize-round-00062.md`（v0.1.00062 字体/首选项）、`development-standards.md`（代码修改默认派子智能体铁律）

## 一、任务（用户反馈）
1. **bridge**：① Sync Max FPS 首次启动不生效（默认 30fps，要手动改一次才刷新）；② Sync 调低后 bridge cmd 仍"猛 kick"。
2. **viewport**：① 撤销后 Enter gizmo 不刷新到上一个位置；② 本地几何体刷新受 Sync Max FPS 制约（本地运行不应受同步桥影响，是两个模块）；③ 快速拖 transform gizmo 反应不过来、几何/同步消息滞后——旧诊断为保存系统猛写盘，深挖后要求**过时请求标记并抛弃**，中断系统设计不合格，堆积的过时消息阻塞运行，绝对不允许 Houdini 视口比 three.js 快。
3. **ui**：① 首选项删两行提示（Ctrl+中键重置 / UI chrome font 提示），"Default Background Color"→"Viewport Background Color"；② 所有字体跟首选项同步（spreadsheet/nodeview/node 等）；③ 浮动面板能否跳出页面（大改就算了）。

## 二、调研结论（根因）
- **Sync 首次不生效**：bridge 的 per-serial fps 是内存态（默认 30），持久源在 web Preference.json；web 只在用户改值 / 换场景 applyLoadedPreference 时才 `PUT /sync`，**首次 connect 从不推** → bridge 永远默认 30。修复：`connect()` 每次（含重连）都推 `putSyncFps(prefs.sync_max_fps)`。
- **bridge cmd 猛 kick**：web 的 `kickHdaOnce` 在**每个 WS hello** 都 kick，且重连会清 `kickedSerials` → 重连风暴 = kick 风暴（实测 live bridge 每 ~1s 一次 `kick armed` + `client connected/disconnected` + HDA recook `inputs pushed` rev 递增）。单页 headless 实测稳定（1 kick / 0 重连），故风暴来自多标签/重载等环境 churn——必须两端防守：**web 侧每 serial ≥5s 一次 kick、仅在 wsWasUp 真掉线（桥重启）后允许 re-kick**；**bridge 侧 POST /kick 每 serial 2s 去重**（throttled 静默 no-op，仍 200）。
- **本地刷新受 fps 制约**：web 拖拽走 `runNetwork → pushOutputs → bridge（fps 合帧）→ WS 回显 → store → viewport 重建`，本地几何要等 bridge 回显 → 被 Sync Max FPS 卡住。修复：**本地乐观应用**（runNetwork 先 `store.upsertOutputs(预测 rev)` 立即重建，再 fire-and-forget 推桥），本地刷新与同步桥解耦。
- **拖拽卡顿 / 过时堆积**：① 每个 pointermove 一次全链路 + 每个 push 响应 `.then` 都 `pushLog` → emit → **全量同步重建**，过时响应堆积成灾；② `_maybe_snapshot` 每 5s 在事件循环同步写盘（"猛写盘"残留，v0.1.00057 只防了 registry）；③ store.subscribe 每次 emit 同步跑全部重活。修复：**networkEpoch 代际计数**（过时代响应整体丢弃，不 log 不 emit）、**rAF 合帧**（每帧最多一次刷新）、**bridge `_maybe_snapshot` 移入线程**、**put_outputs/ws edit 无变化不 log**、**WS outputs 内容去重 + rev 单调**（applyOutputs）。
- **撤销 gizmo 不刷新**：undo 只跑 `onNetworkChanged`（runNetwork+refreshNodeFlags）与（未接线的）`onSelectionChanged`，从不把 gizmo 临时对象移回。修复：graph.ts 新增 `onParamsApplied(nodeId, params)` 回调（params undo/redo 后调用），main.ts 里对 Enter 活动且是 bound 节点时 `viewport.setEnterPosition(tx,ty,tz)` + `refreshSelectionPanels()`。
- **ui 字体**：`--cyl-font-ui` 已存在（fonts.css），但多处 CSS 硬编码 `ui-monospace`/`system-ui` 不跟首选项 → 统一换 `var(--cyl-font-ui)`（保留字号行高）。**浮动面板跳出页面**：dockview v7 无 pop-out API，需 window.open + 跨窗口 DOM + postMessage 同步 = 大改 → **本轮不做**，记录待议。

## 三、契约（跨 agent 锚点）
- `ReteGraphHandlers.onParamsApplied?: (nodeId, params) => void`（graph.ts 在 undo/redo params（含 group 递归）后调用，main.ts 实现 gizmo 归位 + 面板刷新）。
- `Viewport.setEnterPosition(x, y, z): void`（renderer.ts；无 gizmo 时 no-op）。
- `WorkspaceStore.setOutputRev(rev)` / `applyOutputs(outputs, rev)`（内容去重 + rev 单调）/ 导出 `outputsEqual(a, b)`（镜像 bridge `_same_content`）。
- `runNetwork`：`networkEpoch++` → 本地乐观应用（预测 rev）→ push；响应 epoch 过时则整体丢弃；连接/换 serial 时 epoch 失效。
- bridge `BridgeState.try_arm_kick(serial)`（2s 窗口，命中返回 False 不 arm 不 touch 不 notify）；`_maybe_snapshot` 用 `asyncio.to_thread`；`put_outputs`/ws edit 仅 accepted 非空时 log。

## 四、落地分工（4 路并行，写集不相交）
- **Russell（bridge）**：`bridge/bridge/state.py`、`bridge/bridge/routes.py`、`bridge/bridge/ws.py`、`bridge/tests/test_routes.py`。
- **Franklin（web 核心/中断）**：`web/src/main.ts`、`web/src/stores/workspace.ts`、`web/e2e/round17-lag.spec.ts`（新）、`web/e2e/round10-kick.spec.ts`。
- **Peirce（undo-gizmo）**：`web/src/nodes2/graph.ts`、`web/src/viewport/renderer.ts`、`web/e2e/round16-undo.spec.ts`。
- **Meitner（web UI）**：`web/src/app/preference.ts`、全部 CSS（base/nodeview/viewport/dock/spreadsheet/colorpicker/overview）、`web/e2e/round13-preference.spec.ts`。
- **主进程**：diff review + 全量验证 + devlog + 版本 bump 0.1.00064 + 单 commit。

## 五、验证
- bridge：pytest **53 passed**（新增 kick 限流 2 例 + no-op 不 log 1 例）。
- web：tsc **0**；vitest **82 passed**；e2e **73 passed / 1 skipped**（round17 新增 2 例：fps=1 时本地即时刷新 + 30 帧突发过时丢弃；round16 撤销/重做 gizmo 归位断言；round10 kick 5s 限流断言）。
- 说明：bridge 侧改动（kick 2s 去重 / snapshot 移线程 / no-op 不 log）需**重启 bridge** 生效；web 侧改动随 Vite HMR 即时生效。