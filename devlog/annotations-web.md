# Web 子系统改动标注 / Web annotations

## v0.1.0-cyl1nder.1
- 地基：Vite 7 + TypeScript（strict），无 UI 框架；@antv/x6 节点图；three r180（WebGLRenderer 默认，`RENDER_MODE` 预留 WebGPU）。
- 布局：左节点图 / 中视口 / 右 inspector / 底日志。
- 节点：Houdini 竖排紧凑样式，固定 4 进 4 出 socket（空输入显示 `—`）；`Graph.registerNode` 注册。
- 视口：Houdini 导航（Alt+拖拽）、射线拾取（Line threshold）、TransformControls 平移编辑 → 推 bridge outputs。
- 数据流：WS 实时收 inputs/outputs；store 订阅驱动节点统计与视口重建。
- 测试：vitest 9 通过（协议 / 编辑数学 / store）；Playwright e2e 1 通过（连真实桥）。
- 关键坑：three r180 `TransformControls extends Controls`（非 Object3D）→ 用 `getHelper()` 加入场景；X6 `Node.define` 不自动注册 → `Graph.registerNode`。
## v0.1.0-cyl1nder.2（2026-08-10）
- **节点图改为数据流**：`input_`（4 输出 in0..3）+ `output_`（4 输入 out0..3）+ 4 条边（in_i→out_i），取代单一 HDA 节点。
- **auto-run**：收到 Houdini 输入更新（WS inputs）后自动跑网络（v1 = passthrough，output_i=input_i）并推回桥；结果经 WS 回显到 output_ 节点。可开关。
- **视口漂移修复**：左面板 X6 图把 flex 列撑爆（canvas 每 1.5s 变窄右移）；`.cyl-left/.cyl-graph` 加 `min-width:0; overflow:hidden`。
- **CORS**：bridge 加 CORSMiddleware（浏览器 REST 从 8376→8375 不再被拦）。
- **空态引导**：未连接/桥离线时视口中央显示提示。
## v0.1.00004（2026-08-10）
- **WS 自动重连**：指数退避（0.5s→5s 封顶），桥重启后旧标签页自动恢复，不再"一直显示桥离线"。
- **回放跳过加固**：每次收到 `hello`（含重连）都重置 replayPending——重连回放的 inputs 永不触发 auto-run（防覆盖用户编辑）。
## v0.1.00005（2026-08-10）
- **UI 端口 8376**（vite strictPort；e2e/playwright 同步；桥 307 重定向指向 8376）。
## v0.1.00006（2026-08-10）
- **视口右键修复**：canvas `contextmenu/dragover/drop/dragstart` preventDefault（Chrome"图片另存为"消失）；`touch-action:none` + `user-select:none`。
- **Houdini 导航键位修正**：OrbitControls 默认 LMB=rotate/MMB=dolly/RMB=pan，与 Houdini 相反 → `mouseButtons` 强制 LMB=rotate / MMB=pan / RMB=dolly（配合 Alt 才启用）。
- **节点网格 Houdini 化**：见 `devlog/node-graph-houdini.md`——flags（display/bypass/freeze/wireframe，右键菜单）、Tab 搜索（Fuse.js）、Y 剪切模式、null 节点、节点↔视口联动（pickByNode）。文件拆分：`nodes/flags.ts`（纯模型，可单测）、`nodes/cyl1nderNode.ts`（定义/图）、`nodes/palette.ts`、`nodes/cutMode.ts`、`nodes/contextMenu.ts`。
- **布局可拖动分栏**：`.cyl-splitter` 拖左/右栏宽度与日志高度（`layout.ts attachSplitters`，零依赖）；浮动窗口/docking 库调研后延（候选 dockview-core / golden-layout）。
- **WebGPU 开关落地**：`viewport/backend.ts` `createRenderer()` 统一接口；`VITE_RENDER_MODE=webgpu` 时 vite 用 `^three$` 正则 alias 到 `three/build/three.webgpu.js`（**只能正则精确匹配，前缀 alias 会把 `three/addons/*` 一起改坏**），`await r.init()` 失败回退 WebGL。已用 `VITE_RENDER_MODE=webgpu vite build` 验证编译通过；默认仍是 WebGL（热循环稳）。
- **测试**：新增 `tests/palette.test.ts`（Fuse 搜索 5 例）、`tests/flags.test.ts`（flag 合并/持久化 4 例）；vitest 22 全过；e2e（真实桥 C1-msm006pg-8fz7）通过。
- **坑**：X6 `node:contextmenu`/`blank:contextmenu` 事件参数与 DOM Node 类型冲突（用 `globalThis.Node`、`e.e?.preventDefault?.()`）；`graph` 在 `connecting.createEdge` 内自引用需显式 `const graph: Graph` 标注；Escape 关 palette 后要 `blur()`，否则隐藏输入框让 Y 快捷键失效（`isTyping` 加 `getClientRects().length>0` 兜底）。

## v0.1.00016（2026-08-10）
- **@antv/x6 节点图替换为 rete.js 2**：新 `web/src/nodes2/graph.ts`（正式迁移版）——input_(4出)/output_(4入)/null(4+4) 竖排紧凑（rete 天然 inputs 左 outputs 右）；DataflowEngine 缓存接入；Tab 搜索（Fuse.js 复用）；Y 剪切（nodeViews 命中 + 只删 null/边）；右键 flags 菜单（display/bypass/freeze/wireframe，pointerdown 触发避免被容器 close 吞掉）；节点→视口联动（捕获阶段 pointerdown + `area.nodeViews` element.contains，rete 节点 DOM 无 data-node-id）。
- **rete 三方源码克隆**：`web/vendor/rete-src` / `rete-engine-src` / `rete-area-src` / `rete-connection-src` / `rete-react-src`（depth 1，源码参考）。
- **踩坑记录**：①rete2 插件层级 `editor.use(area)` + `area.use(render/connection)`，全挂 editor 会报 "actual parent is not instance of type"；②手动 `emit render` 缺 `element` 字段 → ElementsHolder WeakMap key 崩溃（stats/flags 显示更新留待自定义 React 节点组件）；③rete 节点 DOM 无 data-node-id，命中用 `area.nodeViews` element.contains；④area drag 冒泡拦截 pointerdown → 用捕获阶段；⑤socket 无 data-port-id，端口精确联动待自定义组件。
- **e2e 更新**：`.cyl-graph svg`（x6）→ `.cyl-graph .title`（rete）；通过。
- **依赖**：新增 rete / rete-engine / rete-area-plugin / rete-connection-plugin / rete-react-plugin / react 19 / react-dom / styled-components / @vitejs/plugin-react@5（兼容 vite7）；tsconfig 加 `jsx: react-jsx`；vite.config 加 react 插件。
