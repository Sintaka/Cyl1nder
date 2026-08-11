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

## v0.1.00026（2026-08-10）
- **Desk1 布局修复（四方均分）**：根因 = Desk1 手写 JSON **缺 branch `orientation`**，dockview fromJSON 无法正确解析 size 方向 → 四模块均分。补 `VERTICAL` orientation（branch1: viewport/log 上下、branch2: inspector/graph 上下）+ `scaleLayout` 按窗口缩放 size；`ui-layout.json` 重置。实测：viewport 885×470 大、log 144 小、右列两模块 ✓。
- **Display flag 默认仅显示第一项**：`viewport.setDisplayFocus(kind, index)`——display 节点时只显示其第一个端口（input_ → in0，output_ → out0），不再 4 路全显；`refreshNodeFlags` 接入。
- **节点插入连线**：独立 null 节点（无连接）可拖动到任意连线上——拖动时 `getScreenCTM` 几何命中边 + **金色高亮预览**（path.drop-target），**松开左键执行插入**（A→B 拆成 A→null.in0 + null.out0→B）。坑：SVG path 本地坐标需 `getScreenCTM` 转屏幕（area translate/scale transform）。

## v0.1.00027（2026-08-10）
- **插入预览 + 布局展开**：拖动 null 到连线时，除金色高亮外还画**两条虚线预览**（A端→鼠标→B端，getScreenCTM）；松开插入后**自动展开布局**（null 右侧节点右移 180px）。
- **输出端口连线起点右移**：`row-reverse` 把 label 放到了 socket 右边导致连线起点被 label 挡 → 改为 label 左 socket 右（socket 贴节点右边缘）。
- **poly 显示深度修复**（参考 Anime Hair Studio）：
  1. wire 改**手动 LineSegments**（从 faces 提取去重边，无三角对角线，AHS scalpBuilderCurveLatticeEdges 同款）；
  2. `computeVertexNormals` + `DoubleSide`（面可着色、法线朝内不剔除）；
  3. **快照恢复 rev bug**：`loadSnapshotIntoStore` 用旧 rev 调 setInputs → viewport 不重建（空 Group 残留）→ 恢复时 rev+1；
  4. **setDisplayFocus 只遍历顶层**（buildInputs 包的 Group）→ 全隐藏 → 改 `traverse` 匹配 inputN/outputN 层。
  - 实测：sphere 灰面 grey=5196 像素 + display 仅 input0 可见。
- **ui-layout.json 损坏防御**：发现 branch data 被写成字符串 `" "`（损坏布局 → 四方均分）；已重置为 Desk1，并在 dock 保存时校验（branch 非数组不落盘）。

## v0.1.00028（2026-08-10）
- **three.js 三方源码入库**：`web/vendor/three-src`（npm three r180 src，712 文件）+ README 指引字典（官方文档/示例链接）。排查渲染问题时直接查源码。
- **Geometry Spreadsheet 系统**：新 dockview 面板（Desk1 布局加入，graph 下方）——按 **Point / Vertex / Prim / Detail 四层级** 展示当前几何（每输入端口一个 section）：points 表（坐标 + 属性）、vertices 表（从 curves/faces 推导 vertex）、prims 表（polyline/polygon + 顶点引用）、detail 表（统计 + 属性名）。数据来自桥 payload（points/curves/faces/attributes），vertex/detail 推导。
- **调试 hook**：`buildMeshFaces` 输出 `[mesh] points/faces/triangles/sample-face`（浏览器 console），直接看到 three 接受到的面数据。
- **poly 面确认**：带 normal 的 sphere（normal SOP）→ HDA convert → 视口灰面正常（grey≈2188）；用户"只有点"应为旧快照/缓存（无 faces），重新 cook 推新 inputs 或从新快照恢复即可。

## v0.1.00029（2026-08-10）
- **调试参考 box**：viewport 内置两个线框 box（+X 红、+Y 青，`toggleDebugBoxes`，按 **B** 键切换）——独立于传入数据验证视口渲染能力（实测 red=185 像素 ✓，渲染链路健康）。
- **显示逻辑调整**：
  - display 节点**显示其全部端口**（不再 focus 隐藏第一项）——所有输入的 points/faces 都可见；
  - **无 out 端口数据时 fallback 显示 in 端口**（如 output_ 无 buffer → 显示 inputs）。
- **系统验证**：normal sphere 测试数据完整走通——input0: 12pt/20prim/**60 vertices**/20 prims（spreadsheet 全部正确）+ 灰面 grey≈2900 + box 渲染。用户场景"只有点/无 vertices"= 该 serial 的 inputs **未带 faces**（旧 HDA 无 convert / 旧 serializer / 旧快照），需重新加载新 HDA 并 cook。

## v0.1.00030（2026-08-10）
- **Log 面板内容丢失修复**：dockview 7 的 `fromJSON` 在 5 面板布局下会丢弃 content renderer（Log tab 存活但 `.cyl-log` 离开 DOM——createComponent 直返元素/wrapper/init 挂载/reuseExistingPanels 均无效）。**决定：禁用 fromJSON 布局恢复**，始终用程序化默认布局（5 panel addPanel），拖拽保存（toJSON 到 bridge）保留。恢复功能待理解 dockview bug 后再开。
- **调试参考 box**（B 键）：viewport 两个线框 box（+X 红 / +Y 青）验证渲染能力（red=185px ✓）。
- **显示逻辑**：display 节点显示全部端口（不再 focus 隐藏第一项）+ 无 out 数据 fallback 显示输入。

## v0.1.00031（2026-08-10）踩坑记录
- **dockview 7 `fromJSON` 5 面板布局丢 content（Log 面板）**：tab 存活但 `.cyl-log` 离开 DOM；createComponent 直返元素 / wrapper / init 挂载 / `reuseExistingPanels` 四种方案均无效 → **禁用 fromJSON 布局恢复**，改程序化 addPanel 默认布局（正常），拖拽保存（toJSON→bridge）保留。布局精确恢复待深挖 dockview bug 或升级后再开。
- **null 节点同名 → 插入连到第一个 null**：`attachInsertion` 用 `editor.getNodes().find(kind==="null")` 永远取第一个 → 第二个 null 插入时线连错。修复：pointerdown 记录**拖动中的 null 引用**；null 节点 Houdini 式唯一命名（null / null1 / null2，全局递增不复用）。
- **in 端口多连接**：插入前未检查 null.in0 已有连接 → 重复连。修复：插入时先移除该 in0 的旧连接（`one-input` 约束）。
- **Tab palette 输入残留**：重新打开 palette 时 `input.value` 保留上次 → open 时清空。
- **display flag 驱动**：视口跟随节点 display（_input_ 默认点亮 → 显示 inputs；_output_ 无 buffer → fallback 显示 inputs）。

## v0.1.00032（2026-08-10）
- **布局恢复（Desk1 程序化）**：dockview `fromJSON` 有 content 丢失 bug（v0.1.00030 记录）→ 用**程序化 addPanel + 明确 position** 重建 Desk1（viewport 左上大 / log 左下 / inspector 右上 / graph 右中 / spreadsheet 右下），不再挤在一起。
- **null 唯一命名从 null1 开始**：第一个 null 即 `null1`（Houdini 式），创建时检测 label 冲突并递增到无冲突（不简单 +1 复用）。
- **display 支持中间 null 节点**：`getDisplayNode()` 返回当前 display 节点（任意 kind），viewport 按其 kind 显示——null 直通输出 → 显示 inputs（修复 display null 时 inputs/outputs 全 false）。
- **geo 连线朱红**：所有 connection path + geo socket 改朱红 `#ff6b6b`（CSS 统一），浅蓝预留 float。

## v0.1.00033（2026-08-10）
- **节点图序列化 round-trip（scene-snapshot-research P0）**：`graph.serializeGraph()`（nodes 含 id/kind/label/flags/位置 + connections + viewport transform）→ `restoreGraph()`（清空重建节点+连接+视口，null 命名恢复）；连接时从快照恢复 node-graph；store 变化防抖 1.5s 保存 graph。
- **dock 布局保存**：dockview 布局变化 → `PUT snapshot {docking}`（docking-layout.json）+ localStorage；恢复暂用程序化 Desk1（fromJSON bug 未解，记录）。
- **node-parm.json 预留**：绝对地址键（如 `/obj/geo1/Cyl1nder1/cyl1nder_py0`）存节点参数，参数系统设计后填充。

## v0.1.00034（2026-08-10）
- **viewport 显示 bug 修复（子智能体 Goodall，报告 devlog/viewport-bug-report.md）**：
  - 根因：`refreshNodeFlags` 只按节点类型整组显隐——null display 永远把 4 路输入全显示（**重叠伪影主因**）；output 无数据时错误回退显示 inputs；按端口能力是死代码。
  - 修复：`graph.getDisplayPortIndex()`（null.in0 上游连接的 `in0..in3`）→ null display 只显示穿过该 null 的**那一段**（日志 `display focus inputs index=0..3`）；output display 无数据**不再回退** inputs；debug box 默认隐藏不干扰。
  - 实测 4 线段矩阵：in0/in1/in2/in3 各自 display 均只显示对应段。reference wireframe 条件性双画伪影见报告建议。
- **debug 访问流程（python）**：`scripts/cyl_debug.py`——`status` / `layout`（读 docking-layout.json）/ `snapshot <serial>` / `browser`（CDP 9222，需 Chrome `--remote-debugging-port`）/ `probe`。铁律：UI 状态一律从 bridge 文件读，不用 headless 浏览器当真相。
- **MCP debug 工具**：`cyl1nder_read_snapshot`（快照摘要+目录）、`cyl1nder_read_layout`（docking 分组）。

## v0.1.00035（2026-08-10）
- **菜单栏**：顶部 File / Layout 下拉。File：Open Scene（读快照恢复）、Save Scene（graph+docking 到快照）、Save As。Layout：预设列表（Documents/Cyl1nder/Layouts）、Save current layout、Save as（同名覆盖）、Reload current layout。布局文件保存到 `%USERPROFILE%\Documents\Cyl1nder\Layouts\<name>.json`（bridge REST /api/ui/layouts）。
- **Log 面板过滤**：All / Geo（inputs/outputs/[mesh]/[path]）/ Viewport（[viewport]）/ UI（[layout]/[node]/display…）/ Bridge（python runtime）五档；过滤条内置 logEl（dockview 只移动 logEl 本体，兄弟元素会被丢——坑）。
- **Tab 创建节点在鼠标附近**：palette create 用容器内最近鼠标位置（area transform 反推）；鼠标不在图内则默认位置。
- **悬停/选中色**：hover 淡黄 `#fde68a`、selected 黄 `#fde047`（Houdini 风格）；displayed（display flag）浅蓝边框。
- **节点状态重构**：去掉右键菜单（留给别的用）；头部左上名称**双击改名**（inline input，Enter 提交）；右上 4 个等距矩形 chip（从右往左）：Display（浅蓝，net 唯一）/ Reference（粉，原 wireframe 改名，暂无语义）/ Bypass（黄）/ Freeze（冰蓝白），后三者每节点独立 toggle；移除突出 D 按钮。
- **viewport 显示**：所有输入统一 0.4 灰（不再四端口各色）；poly 面默认 0.4 灰 Lambert；wire 黑色 LineSegments。
- **node view 无头线段**：恢复快照 graph 后连接端点正常（经 TDZ 修复 + restoreGraph 校验）；client TDZ 修复（菜单逻辑提前声明）。

## v0.1.00036（2026-08-11）
- **菜单栏防文字选中**：menubar `user-select: none`。
- **viewport**：geometry wireframe 统一**黑色**（applyDisplayMode 强制 0x000000，不再被端口灰覆盖）；显示模式右上角改**按住下拉菜单**（Lit/Unlit/Wire/Wire+Face，悬停高亮、松开应用鼠标停留项）。
- **node view**：
  - **LMB 空白拖拽 = rect 框选多选**（overlay 蓝色矩形，nodeViews 位置判断 select/unselect）；节点/端口/chip 上拖拽不受影响。
  - **Display Flag 直接走节点右上角**（不再需要右键菜单；右键菜单已删）：chip 点击 → displayHandler（net 唯一）；**restoreGraph 强制单 display**（快照可能含多个 display，恢复时仅保留第一个）。
  - **右上 4 按钮无缝纯色**：flex 均分、贴合节点边缘（最右保持圆角）、无字母纯色块；on 显示对应颜色（Display 浅蓝/Reference 粉/Bypass 黄/Freeze 冰蓝白）；悬停 = 颜色+背景一半混合；提示用自定义 tooltip。
- **MCP nodeview API**（子智能体 Arendt）：`cyl1nder_nodeview_nodes` / `_connections` / `_status` / `_connected`（读 scene/node-graph.json，无快照返回 null）+ `scripts/cyl_debug.py nodeview <serial>`。报告 devlog/nodeview-mcp-report.md。
 
## v0.1.00037（2026-08-11）
- **布局默认化（Default.json）**：当前 Desk1 布局搬入项目 `web/src/app/layouts/Default.json`（版本化，不再依赖 Documents\Cyl1nder\Layouts）；启动时在 graph+viewport 创建完成后 `applyLayout(DEFAULT_LAYOUT)`——fromJSON 在**内容元素已挂 DOM 后**跑，面板不会塌缩/错位。`layouts.ts` 改为 import Default.json 导出；`Reload current layout` 找不到命名布局时回退 bundled Default。
- **dockview 加载时序坑（续 v0.1.00030/00031）**：`fromJSON` 仍会在 5 面板布局丢**未激活 tab** 的 content（Log 与 Spreadsheet 同组、Log 非激活 → `.cyl-log` 不在 DOM，但 `dv.panels` 里 `log.view.content.element` 存在且含 `.cyl-log`，只是 wrapper 未挂载）。修复：`applyLayout` 250/1200/3000ms 三档 `reattachOrphans` + Log tab 激活时 `onDidActiveChange` 触发 `renderLog()`（补渲染挂载前累积日志）。e2e 相应改为先点 Log tab 再断言。
- **显示模式菜单**：`.cyl-mode-menu` 改 `position: fixed`（不再被 dock 面板 overflow 截断/错位到右下方）；交互改为**单击 = 持久显示**（再点按钮/点项/点外部关闭），**拖动 = 松手应用悬停项**（指针位移 >4px 判定），修掉"单击立即关闭"。
- **视口相机真位移**：wheel 与 Alt+右键不再改 `cam.zoom`（fov fake），改为 `dollyCamera()` 沿视线移动相机（0.2~200 距离钳制）；`cam.zoom` 恒 1。
- **display 只显示第一端口**：`_input_` display → `setDisplayFocus("inputs", 0)`；`_output_` display → `setDisplayFocus("outputs", 0)`（不再全端口同显）。
- **右上 4 状态按钮方形贴角**：14x14 正方形（原 12px 高 flex 均分），`.cyl-rp-chips` 负 margin `-4px -6px 0 6px` 顶到节点右上角；最右 chip 保留 6px 圆角（匹配节点）；head `align-items: flex-start`（修复 flex-start 被后一条 center 覆盖的坑）。
- **display 蓝优先于选中黄**：`.selected` 变淡（1px 半透明黄 ring）；`.displayed.selected` 用更高特异性选择器 → 蓝 ring + 外圈淡黄，二者共存可见。
- **4 条无头线段根因修复**：`restoreGraph` 先 `removeConnection` 清掉所有存活连接再 `removeNode`（rete2 `removeNode` 不会可靠移除其连接 → 恢复后残留孤立边，序列化又写回 1 节点/4 悬空 conns）；`serializeGraph` 只序列化两端节点仍在的连接（防御）。实测用户 serial（旧快照 1 节点/4 悬空 conns）恢复后 0 连接、无头线段消失。
- **调试钩子**：`window.__cylDv` / `window.__cylViewport`（MCP/debug 可直接查面板与场景结构）。

## v0.1.00038（2026-08-11）结构拆分 + 5 路并行 agent 合并
- **结构调整**：`styles.css` 按域拆为 `web/src/styles/{base,nodeview,viewport,dock}.css`（`styles.css` 变纯 @import 聚合，145 条规则零丢失，vite 顺序 base→nodeview→viewport→dock）。目标：并行 agent 写集不相交。5 个子智能体并行（Epicurus/Beauvoir/Dewey/Raman/Archimedes），主进程合并+全量验证。
- **视口相机（controls.ts）**：`dollyCamera` 重写——相机≈目标（dist<1e-4）时退回相机世界视线方向（不再 NaN、不再卡死无法拉远）；`next=clamp(dist-amount, 0.05, 500)`，距离单调；焦距固定（fov/zoom 永不变，cam.zoom 恒 1）。修复"原点太近缩放不回来"与"一直滚轮放大在某点反复横跳"。
- **显示模式 7 档（renderer.ts + viewport.css）**：`smooth-shaded / smooth-wire / flat-shaded / flat-wire / unlit-wire / wireframe / wireframe-ghost`。菜单文案：Smooth Shaded / Smooth Wire Shaded / Flat Shaded / Flat Wire Shaded / Unlit Wire Shaded / Wireframe / Wireframe Ghost。flat 用 Lambert `flatShading:true`（不平滑法线）；wireframe 线框色 `#CCCBBA`；ghost=线框 + 黑色 0.8 透明面。快捷键：`W` 在现模式 ↔ Wireframe Ghost 间记忆切换；`Shift+W` 在平滑/平面着色对间切换（附在 Viewport 内部，不碰 main.ts）。旧 unlit 独立档删除。
- **节点图交互（graph.ts）**：① `area.area.setDragHandler(null)`——LMB 空白拖拽只做 rect 多选，不再整网平移（MMB 平移保留）；② Y 按住拖红线切断划过的所有连线（点击切单条），旧"点 null 删节点"移除；③ 拖节点快速来回甩（≥3 次方向反转/600ms）断联全部连接，然后自动重连最近左邻输出→自身输入、自身输出→最近右邻输入（socket 类型匹配且槽空；v1 全 GEO 解释，devlog 注明待细化）。
- **节点毛玻璃 + chip 分隔线（nodeview.css）**：`.cyl-rp-node` 背景 `rgba(27,30,36,.5)` + `backdrop-filter: blur(6px)`；文本亮度微调保持可读；4 个状态 chip 间隔加 1px 分隔线（颜色=节点边框 `#3a3f4a`，最右 display chip 无）。
- **docking 美化 + “+” 面板（dock.ts + dock.css）**：标签页圆角矩形（6px + 间距 + dockview 主题变量改色）；每个标签栏右侧注入同风格 `+` 按钮 → 深色菜单列出 5 种面板 → 添加**独立实例**（组件名 `type:N`，Log/Inspector/Spreadsheet 真实例并订阅 store；Viewport/Node Graph v1 占位实例，注明"单例"）。布局 toJSON/fromJSON 可保存/重建实例。

## v0.1.00039（2026-08-11）4 路并行（spreadsheet.css 拆分后）+ 并行规范入库
- **结构调整**：spreadsheet CSS 从 dock.css 拆到 `web/src/styles/spreadsheet.css`（聚合器追加 @import），使 spreadsheet agent 写集独立。
- **并行修改规范**：`devlog/development-standards.md` 新增「并行修改规范」——先评估→主进程拆结构→写集不相交→契约先行→各自 tsc+Playwright 自测→主进程合并单 commit。子智能体（Bacon/McClintock/Noether/James）遵守，全部完成。
- **Spreadsheet（Bacon，spreadsheet.ts + spreadsheet.css）**：
  - `renderSpreadsheet(el, payloads, source, focus?: SpreadsheetFocus)`：`focus.kind` 为 `input`/`null` 且 index 有效时只渲染对应那一个 payload section（main.ts 由主进程接线：null→getDisplayPortIndex，input→0）。
  - **层级持久**：模块级 `activeTabs: Map<index, tab>`，每次 store 刷新重建 innerHTML 后恢复当前 tab（不再被传回 Point）。
  - **行交替**：odd `#16202e` / even `#1b2738`（td），hover 仍覆盖。
  - **列宽**：ptnum 纯 int 首列 + P.x/y/z 各 `10ch`（colgroup `cyl-sp-col-num`），`table-layout:auto` 不再均分，无多余空列。
  - **数字格式**：`fmtNum`——0→"0"，|x|≥1e6 或 <1e-4 → `toExponential(3)`，否则 toFixed(6) 去尾零。
  - **标题栏漏缝**：sticky `th` 缺 z-index 导致 tbody 行盖过表头（border-collapse paint-order bug）→ `th{z-index:1}` + section/head 不透明白底。
- **视口模式（McClintock，renderer.ts）**：新增 `unlit-shaded`（Unlit Shaded，MeshBasic 纯色无线）与 `unlit-wire` 配对，Shift+W 可在 `unlit-shaded ↔ unlit-wire` 切换；菜单 8 项顺序更新；**Wireframe Ghost 面 opacity 0.8→0.2**（用户语义=80% 透明，只留一点灰）。
- **节点改名（Noether，NodeView.tsx + graph.ts + nodeview.css）**：根因——rete 的 pointerdown→nodepicked→simpleNodesOrder 会重排节点 DOM，且 selection 重渲染 remount NodeView，浏览器因此**不发 click/dblclick**，只有原生文本选中。修复：标题 `onPointerDownCapture` 手动检测双击（400ms/8px）+ 模块级 rename 状态（editingNodeId/editValue，防 remount 重置）+ rAF/120ms 双保险 focus+select。**究极尾号去重**：graph.ts 注册 `setRenameHandler`，提交时对全图 label 去重（foo→foo1→foo2…），baseLabel 保持基名。毛玻璃 `blur(6px)→12px`、背景 `rgba(27,30,36,.5)→rgba(46,51,60,.5)`（明度+0.1）。
- **docking（James，dock.ts + dock.css + base.css）**：
  - 标签活动态：上圆角（`6px 6px 0 0`）+ **下反圆角**（`::before/::after` 用 radial-gradient 画内容底色凹角），z-index 10 盖住相邻标签底角；活动色 `#2b6cb0→#2e4f7d`（深蓝、比面板亮、非亮蓝），非活动保持。
  - `+` 移入 `.dv-tabs-container` 最后一个标签之后（随标签增删右移）；标签栏溢出时**滚轮横向滚动**（capture 非 passive，仅溢出时 preventDefault）。
  - 标签栏最右固定 **✕**（不随溢出滑动），点击 `group.api.close()` **关闭整个 group**，store.pushLog 记录。
  - `base.css` 追加全局深色滚动条（WebKit + Firefox scrollbar-color）。
- **主进程**：main.ts 接线 spreadsheet focus（display 驱动）；折叠 James 的子 commit 为单 commit；全量验证 tsc/vitest/pytest/e2e/verify-all + 综合 Playwright 复测全绿。

## v0.1.00042（2026-08-11）6 路并行（spreadsheet/dock/param/viewport 写集拆分 + MCP 通道 + 流式调研）
- **结构调整（主进程预调）**：graph.ts 先加 `getSelectedNode()` + `onSelectionChanged()`（ReteGraph 契约），使 spreadsheet/param 写集与 main.ts 解耦；main.ts 由主进程统一接线。
- **Spreadsheet（Lovelace，spreadsheet.ts + spreadsheet.css）**：
  - `SpreadsheetFocus` 增加可选 `label`：null 节点选中时 section 头部显示 `in0`（null 的输入端口名）而不是 `inputsN`（修复「选 null3 显示 inputs3」）。
  - Vertices / Prims 第一列 `#` → `vertnum` / `primnum`。
  - 每张表最右加空填充列（`.cyl-sp-col-fill` width:100%/min 200px）→ 表格铺满面板宽、留空处也显示表格底色；数据行不足 8 行补空行，各 sheet 组件高度统一不截断。
  - 交替深色更暗：odd `#16202e → #0f1722`（even/hover 不变）。
- **docking 标签（Meitner，dock.css）**：活动标签改为**完整圆角矩形**（四角 6px、底角向外凸的 Chrome 式圆角），删除自挖凹角 `::before/::after`；相邻非活动标签加 8px 凹切（radial-gradient 用标签栏背景 `#1c1e22`），活动标签 z-index 10 遮挡相邻标签底角；first/last/+`/`✕` 边界与 hover/颜色全部保留。
- **viewport（Newton，renderer.ts）**：默认显示模式 `smooth-shaded → flat-wire`（Flat Wire Shaded）；新增 `getDisplaySettings()` / `setDisplaySettings()` 供布局 JSON 存取显示设置；**three.js gizmo 演示**（确认 TransformControls 即 gizmo，项目已用于 translate 编辑）：G 开关绿色测试盒、Shift+G 切 translate/rotate/scale。
- **Param 面板（Ptolemy，param.ts 新建 + dock.ts + Default.json + base.css）**：`renderParams(el, info)` 显示选中节点的可输入属性（null/in/out 无属性 → 空态「该节点暂无可用参数（v1 预留）」）；默认布局右栏加 Params 标签页；`+` 菜单可加独立实例；`DockContent` 增加 `param`。
- **MCP 通道（Planck，mcp_server.py + test_mcp.py + mcp-channel-proposals.md + API_INDEX）**：新增 `cyl1nder_viewport_settings` / `cyl1nder_node_params`（读快照 docking.displaySettings / scene/node-parm.json）；pytest 20 全绿；调研文档列 7 项通道，指出节点选中态未持久化（后续快照扩展或 WS 推送）。
- **流式调研（Kuhn，streaming-hda-review.md + streaming-plan-b 头部）**：方案 B 仍「设计定稿」、M1–M6 未开始实现；差距=全量重建/33ms 轮询/无增量/无 topoId；给出 B1-M1→M3 落地清单与风险。
- **主进程接线（main.ts）**：spreadsheet/param 跟随**选中节点**（多选取第一个）：null→其 in0 源端口（头部 `in0`）、input→全部 4 路、output→outputs、无选中→回退 display flag；选中变更经 `graph.onSelectionChanged`（**setTimeout 0 等 rete 异步选中落地后再刷新**——同步通知会读到旧选中）驱动；布局 JSON 存取 `displaySettings`（getDockJson 注入 + applyLayout 后恢复）；Default.json 顶层 `displaySettings.mode=flat-wire`；debug hook 新增 `__cylGraph`。
- **验证**：tsc 0 错；vitest 13 过；pytest 20 过；官方 smoke e2e 过；自建 Playwright 复测（Flat Wire Shaded 默认 / Params 空态 / 点 null3 → `in0 · 2pt / 1prim` / 点 _input_ → 4 section / 无 console error）。
