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

## v0.1.00017（2026-08-10）
- **自定义 React 节点组件**（`nodes2/NodeView.tsx`，`Presets.classic.setup({ customize: { node } })`）：
  - **Houdini display 按钮**：节点右上角蓝色圆角 chip（`D`），一个 net 仅一个点亮（点击清其他），点亮节点在视口显示其输出；要显示多个必须手动加 merge 节点（Houdini display 语义）。
  - socket 渲染为圆点（修复此前 36x36 深蓝矩形容器——旧 CSS 把 `.input-socket/.output-socket` 容器填了 `#0b2430`）；端口 div 带 `data-port-id`（端口精确联动基础）。
  - stats/flags 徽标（bypass 虚线/freeze 🔒/wireframe ⛶）。
  - **重渲染机制**：rete2 手动 `emit render` 需要 element（ElementsHolder WeakMap key），且 React 合成事件被 area drag 冒泡 stopPropagation 拦截 → 改为「原生捕获监听（ref+useEffect）+ 模块级 notifyNodeChanged（React useReducer force）驱动重渲染」，绕开 rete render signal 不可靠路径。
- **Houdini 导航**：MMB 按住拖动 = 画布平移（`area.area.translate`，原生捕获监听）；wheel 缩放已有。
- **点阵背景 + 缩放 LOD**（`attachDotGrid`）：屏幕空间 `radial-gradient` 点阵，随 zoom 分档透明度（k≥0.9→0.85 / ≥0.55→0.5 / ≥0.3→0.22 / 更远→隐藏），随 pan 滚动背景位置。
- **HDA 离线红叹号**（viewport 左上角）：`/api/hda/<serial>/pending` 兼作心跳（30fps poller touch registry.lastSeen）；web 每 5s watchdog 查 status，lastSeen 超 15s → 显示「⚠ HDA 离线」。
- **@antv/x6 彻底删除**：`web/src/nodes/` 移除、`@antv/x6` 卸载、旧 palette/flags 测试删除（Fuse 搜索与 flags 逻辑已迁 rete 版）。

## v0.1.00019（2026-08-10）
- **proto 清理**：删除 `proto-rete.html` 与 `web/src/proto/`（原型已完成使命，rete 已正式迁移）。
- **Tab 搜索修复**：改名后 palette label 同步 `_input_` / `_output_`（关键词含中文）。
- **线段高亮改辉光**：`stroke-width` 加粗会覆盖原蓝线显内凹 → 改为 `drop-shadow` 辉光（双层 shadow）+ 轻微加粗，背景边缘亮光效果。
- **Docking system（dockview 7）**：`web/src/app/dock.ts` 用 `dockview`（vanilla、零依赖）把 Node Graph / Viewport / Inspector / Log 拆成 4 个可拖拽重组/浮动/缩放的 tab 面板；`layout.ts` 重构为 header + dock 容器（JS 创建内容容器交给 dockview）；旧 flex+splitters 布局保留为 `buildLayoutLegacy` 回退。坑：`createComponent(opts)` 字段是 **`name`**（非 `component`）。
- **F 键 frame（按悬停区域）**：悬停节点图 → `frameSelection()`（选中节点 / 无选中全部，`AreaExtensions.zoomAt`）；悬停 3D 视口 → `viewport.frame()`（几何体 bounding box，无几何体复位默认视角）。快捷键已登记 `devlog/shortcuts.md`。
- **3D 视口 RMB 归一化拖拽缩放**：无 Alt 右键拖拽，向右上（+x,-y）放大拉近、左下（-x,+y）拉远，增量归一化，~2 倍灵敏度（手动 `camera.zoom`）。
- **视口 debug 流**：`[viewport] inputs/outputs rebuilt`、`visibility`、`framed geometry` 日志（`pushLogSilent` 防死循环）。

## v0.1.00020（2026-08-10）
- **dockview 布局持久化（默认布局）**：任何拖拽/浮动/缩放后防抖 400ms 把 `dockview.toJSON()` 存 localStorage，下次启动 `fromJSON` 恢复——用户调整后的布局即成为默认。
- **修复 dock 与 3D viewport 打架**：`.cyl-viewport { position:absolute; inset:0 }` 是旧 flex 布局遗留，dockview 里会溢出覆盖 tab 标题（松手后标题被 canvas 盖住）。改为 `position:relative; width/height:100%` + `.dv-view { overflow:hidden }`；实测 canvas 顶(71) 低于 tab 底(67)，不再覆盖。
- **视口显示走统一路径系统**：连接 serial 时 `GET /api/hda/<serial>/snapshot`，若 WS workspace 无几何体（Houdini 未 cook / 桥重启）且磁盘快照有数据 → `store.setInputs/upsertOutputs` 填充 → 视口显示历史几何（实测 `[path] restored inputs`）。

## v0.1.00021（2026-08-10）
- **布局持久化升级为文件级（跨浏览器 debug）**：dockview 布局变化时防抖 600ms → `localStorage` + `PUT /api/ui/layout`（bridge 写 `bridge/data/ui-layout.json`）；启动恢复顺序 = **bridge 文件 → localStorage → 默认**。这样 agent 的 headless 浏览器与用户浏览器读同一个布局文件。
- **布局 debug 输出**：每次布局变化在 Log 面板输出 `[layout] <panel>:x=,y=,w=,h=`（相对 dock 容器）+ `[layout-json] <toJSON>`，agent/用户都可读当前面板的相对位置与边界。
- **实测**：检测到用户手动布局 = `graph:x=0,y=35,w=650,h=649 | viewport:x=650,y=35,w=630,h=193 | inspector:x=650,y=263,w=630,h=193 | log:x=650,y=491,w=630,h=193`（左列 Node Graph 全高 + 右列 Viewport/Inspector/Log 垂直堆叠）。
- bridge 新增 `GET/PUT /api/ui/layout` + `ui_layout.py`（单文件原子写）。

## v0.1.00023（2026-08-10）
- **视口空显示根因修复（sphere 等网格输入）**：
  1. Houdini 的 sphere 是**程序化 Sphere prim**（非 polygon），serializer 之前全部跳过 → curves/faces 空 → 视口无显示。修复：HDA 内部输入后加 **Convert（fromtype=all, totype=poly）**——sphere→20 个闭合 polygon（12 点），开口 polyline 保持开口（验证过），hair 曲线不受影响。
  2. **协议加 `faces`**（protocol.py/types.ts/protocol.md 三处同步）：闭合 polygon 面顶点索引；HDA `_build_detail` 重建 polygon；compare.ts 内容对比含 faces。
  3. viewport 用 **wireframe Mesh** 渲染 faces（`EdgesGeometry` 对平滑球面会丢全部边，生成空 LineSegments——坑）。
  4. renderer `preserveDrawingBuffer: true`（构造时传，便于截图/检测；实际渲染一直正常）。
- 验证：sphere 输入 → bridge inputs pts=12 prims=20；视口 cyan 线框像素 274（sphere 显示）。

## v0.1.00024（2026-08-10）
- **滚轮缩放修复**：OrbitControls `enabled=false`（无 Alt）时连 wheel 都跳过 → 自定义 wheel（捕获阶段 preventDefault+stopPropagation），无 Alt 滚轮始终缩放。
- **Alt+RMB 归一化缩放**：RMB（Alt 或无 Alt）统一归一化拖拽缩放（右上放大、左下缩小），灵敏度 4 倍（此前 2 倍的 2 倍）。
- **简单材质系统 + 显示模式**（viewport 右上角 chip 循环切换）：
  - `Lit`：mesh 面灰色 MeshLambertMaterial + 头灯（DirectionalLight 每帧跟随 camera）+ AmbientLight；
  - `Unlit`：MeshBasicMaterial 纯色；
  - `Wire`：仅线框（wire mesh）；
  - `Wire+Face`：线框叠加面。
  - mesh 由 `buildMeshFaces` 构建为 { faceMesh, wireMesh } Group，`applyDisplayMode()` 切换；曲线保持线。
- **polygon 面显示**：Lit 模式实体灰面（此前只有线框）。协议 faces → 面渲染闭环完成。

## v0.1.00025（2026-08-10）
- **Alt+RMB 灵敏度减半**：归一化缩放 factor 4x → 2x（回到此前状态）。
- **相机 35mm**：PerspectiveCamera fov 45° → 38°（35mm 等效垂直 FOV = 2·atan(24/(2·35))）。
- **poly 实体面显示修复**（深挖显示系统）：
  1. fan 三角化 BufferGeometry **缺 normal** → MeshLambertMaterial 无法着色，面不渲染 → 补 `geo.computeVertexNormals()`（这是面不显示的直接根因）；
  2. 面材质 `side: THREE.DoubleSide`（fan 三角化法线可能朝内被剔除）；
  3. **孤立点渲染**：不在任何 curve/face 的点用 THREE.Points 小圆点显示（之前只画曲线+面，孤立点不显示）。
- **poly 回 Houdini 丢失修复**：`transform.ts inputToOutput` 补 `faces`（编辑路径输出丢 faces → HDA pull 只有点无 poly）；`_build_detail` faces 重建已验证（Polygon closed）。
- **Desk1 布局恢复**：布局 size 是绝对像素（Desk1 基于 2159 屏），小窗口下退化"相对布局" → `dock.ts scaleLayout()` 加载时按容器尺寸缩放 size；`ui-layout.json` 重置为 Desk1 排布（viewport 左大/log 左下/inspector 右上/graph 右下）。
