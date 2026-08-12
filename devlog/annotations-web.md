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
- **HDA 离线红叹号**（viewport 左上角）：`/api/hda/<serial>/pending` 兼作心跳（30fps poller touch registry.lastSeen）；web 每 5s watchdog 查 status，lastSeen 超 15s → 显示「⚠ HDA 离线」。[已过时：v0.1.00056 起 HDA 主通道为 /stream 长轮询，心跳约 1/min，离线阈值 150s]
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

## v0.1.00044（2026-08-11）
**7 路并行**（写集拆分：Kepler=viewport / Popper=spreadsheet / Pasteur=dock / Dalton=groups / Dewey=undo / Poincare=nodeview-core / Bernoulli=param+network；主进程先建契约骨架 groups.ts / undo.ts / network.ts + graph.ts getNetworkSnapshot/setNodeParams + transform.ts applyTranslateGrouped，后合并单 commit）。

### 3D 视口
- **Alt+RMB 缩放归一化**（viewport/controls.ts）：`(dx-dy)/60` → `sign(dx-dy)*max(|dx|,|dy|)/60`，水平/垂直/对角线四方向都是 1 倍灵敏度（此前对角线是 √2 倍）。E2E 六方向验证 ±1/60。
- **F frame 保持相机角度**（viewport/renderer.ts frame()）：先取 `dir = 相机位置-target` 归一化（退化回 (0,0,1)），再 `target=center`、`position = center + dir*max(size*1.5,1)`，不再重置成水平 +Z 视角。E2E 验证方向点积 = 1.0、target 移到几何中心。
- pickByNode 参数联合加 "transform"（passthrough log，v1 无可编辑目标）。

### UI
- **Spreadsheet**（app/spreadsheet.ts + styles/spreadsheet.css）：vertices 表头 `point→ptnum`、`prim→primnum`（单元格 P{pi}/prim{id} 改纯数字）；prims 表头 `points→primpoints`；斑马纹饱和度 -0.1（odd #111720 / even #1f2834 / hover #20252c，HSL 明度不变）。
- **Dock 标签**（styles/dock.css）：诊断发现活动标签底角本来就是凸的，"像凹"来自相邻标签 8px 凹缺口比 6px 凸角大 2px 的"高肩膀"压角 → 缺口统一 6px 与凸角对称嵌套，底边与内容区无缝贴合（Chrome 打开态）；`+` 按钮 margin `0 6px 0 2px → 0 10px 0 6px` 右移 4px。像素级前后对比验证。

### 节点视图（nodes2/）
- **组处理系统**（新 groups.ts，纯函数 + 27 单测）：Houdini group 表达式解析+匹配。类选择 autoguess/points/vertices/prim/detail；`@组名`（group_xxx 值 1=命中）、`@attr op value`（= == != > >= < <=）、类型前缀 `i@/s@/v@/p@(四元数)/3@/4@(矩阵)`、分量 `@P.x` / `@Cd[2]`、P 伪属性=当前位置；`*`=全部、`^`/`!`=排除；id 规则 `n / n-m / n-m:step / n-m:keep,step`；同名多属性取第一个（4@transform 与 3@transform 共存）。无现成 npm 库（零新依赖）→ 紧凑手写 parser，注释标注语法来源与 v1 刻意差异。
- **transform 节点**（graph.ts）：PALETTE 新入口、makeTransformNode（transform1… 唯一命名，in0/out0 GEO，params=tx/ty/tz float 0 + group "" + class "autoguess"）、serialize/restore 带 params、getSelectedNode/getDisplayPortIndex 对 transform 同 null 解析 in0 源端口。tools/transform.ts `applyTranslateGrouped(base, points, groupExpr, cls, dx,dy,dz)`：P 规则用当前点阵匹配（链式正确）。
- **网络计算**（新 network.ts + 9 单测）：`computeOutputs(inputs, snap)` 从 _output_ 各端口反向追链（input→null passthrough→transform 按序平移），未接链端口 fallback passthrough inputs[i]（保持 4 输出历史行为）；环防御。
- **Param 面板可编辑**（app/param.ts + base.css）：float/int→number input、class→select(autoguess/points/vertices/prim/detail)、其他 string→text；onChange→`setNodeParams` + `runNetwork`（仅当仍是选中节点）。
- **main.ts**：runNetwork 改用 getNetworkSnapshot()+computeOutputs；`onNetworkChanged`（cut/insert/shake 后触发 rerun）；refreshSelectionPanels/refreshNodeFlags 对 transform 视同 null（spreadsheet 显示 in0、视口聚焦其输入段）。
- **Y 划线多段轨迹**（attachCutMode）：`<line>` → `<polyline>`，>4px 追加（上限 500），逐段 distToSegment≤8 判定；<4px 仍单击切断单条。E2E L 形折线切断验证。
- **撤销系统**（新 undo.ts + 9 单测）：cut/insert/shake 三类拓扑操作；Ctrl/Cmd+Z undo、Ctrl+Shift+Z / Ctrl+Y redo（输入框聚焦跳过）；apply 走 promise 链防快速交错；ReteGraph 暴露 undo()/redo()。E2E 切断→undo→redo 验证。
- **插入重合整理**（attachInsertion）：插入后先按左侧源节点实际宽度算 minX=src.x+宽+30，插入节点重叠则先右移清开，再执行 +180 右推。

### 验证
- tsc 0 错误；vitest 6 文件 58 通过（新增 groups 27 / undo 9 / network 9）；bridge pytest 20 通过；Playwright e2e round2 5/5 + smoke 1/1（连真实桥 8375 + vite 8376）。
- E2E 自包含：beforeAll 推规范 inputs、每测 restoreGraph 自建起始图、afterAll 恢复磁盘快照 fixtures（防 web 自动保存 graph 快照污染测试场景）。

## v0.1.00045（2026-08-11）
**3 路并行**（Pascal=dock / Russell=nodeview-core / Noether=parm 设计；主进程先定位根因：两个 overlay SVG 只设 `position:absolute;inset:0` 未设 width/height，SVG 默认视口 300×150 把左上区域以外的内容全部裁剪）。

### UI（styles/dock.css）
- **活动标签改为 Chrome 打开态轮廓**：底边平直且与内容区同底（`.dv-tab` margin-bottom 0、活动标签 `border-radius:7px 7px 0 0`）；底部两角用 `::before/::after` 画活动色 #2e4f7d 的 7px 外凸四分之一圆（径向渐变，盒子在标签外侧 -14px 处，避免圆心落在体内被自身底色盖住）；首/尾标签加 margin 防凸角被裁/压到 `+` 按钮。像素级验证：底角蓝色区间 65px→87px、无暗带、四角均为外凸圆角、底边与面板无缝。

### 节点视图（nodes2/）
- **插入预览改为高亮黄色虚线流动曲线**（attachInsertion）：两个 `<line>` → 两个 `<path class="cyl-insert-preview-path">`，用与真实连线同曲率（curvature 0.3）的 `connectionPathD()` 画源 socket→鼠标、鼠标→目标 两条贝塞尔；nodeview.css 加 `stroke:#ffd166; stroke-dasharray:7 5; animation: cyl-dash-flow`（dashoffset 循环流动）。修复 overlay 300×150 视口裁剪（补 width/height 100%）。
- **Y 划线轨迹显示修复**（attachCutMode）：cut svg 同补 width/height 100%，画布任意位置的红色轨迹实时可见（根因：SVG 默认 300×150 视口，只有左上区域内的线可见）。
- **一次划线多段切断 = 单个撤销操作**：`undo.ts` UndoAction 增加 `{type:"cut-many", connections:[]}`；`cutByPolyline` 收集全部命中 refs（去重）→ 一次性 remove → push 一个 cut-many → 一次 onNetworkChanged；applyUndoAction 支持 cut-many（undo=全恢复 / redo=全删）。单击切断仍走 `{type:"cut"}`。
- **transform 拖拽快捷插入**（attachInsertion 泛化）：`isInsertable(n)` = 恰好 1 入 1 出（null 与 transform 均满足，input/output 4 出/4 入不适用）；draggingNullId→draggingNodeId 泛化，插入/预览/重叠整理/undo/onNetworkChanged 对二者通用。

### Parm 参数面板系统（仅设计，不实现）
- 新建 devlog/parm-system-design.md：对标 Houdini Parameter 面板——`ParmDef`（定义，代码侧 registry）+ `node.params`（值）分离；15 种类型（int/float/vec2-4/color/bool/menu/string/button/separator/label/folder/ramp/data）；元数据（name/label/default/min/max/step/options/script/visibleWhen/enabledWhen/group/help）；folder/separator 简单分组；Group(String)+Group Type(enum) 复合模板直接对接 groups.ts 实时校验；按钮 Phase1 前端 action 注册表（零协议改动）；可见性/可更改性条件式小子集（禁止 eval）；持久化沿用 schemaVersion 2 兼容。选型：不引入 RJSF/uniforms/Formily/@mui（React 生态、零新依赖铁律、语义不符），借鉴 Houdini 定义/值分离 + ComfyUI widget registry + JSON Forms schema 分离 + Blender 折叠单列，自研小模块。

### 验证
- tsc 0 错误；vitest 6 文件 59 通过（undo 新增 cut-many 用例）；bridge pytest 20 通过；Playwright round2 5/5 + round3 4/4（真实桥 8375 + vite 8376）。
- round3 用例：Y 划线画布中部/下部两次轨迹均可见（截图像素含 #ff3b30 + getBBox 在 svg 视口内）；L 形划线一次切断两条连接且一次 Ctrl+Z 全恢复；transform 拖拽插入拆线；插入预览两条曲线 path 出现。

## v0.1.00046（2026-08-11）
**4 路并行**（Heisenberg=dock / Ramanujan=nodeview / Hypatia=param scrub / Herschel=viewport enter）。

### UI（styles/dock.css）
- **活动标签底部圆角方向翻转**：`::before/::after` 盒子 `-14px/14px` → `-7px/7px`，radial-gradient 圆心从角落移到角落正上方 7px（`circle at 100% 0%` / `circle at 0 0%`），可见弧变成圆心的**左下/右下段**——弧从底边起向上收、顶点在下方外侧紧贴底边（斜线下半段圆角），不再向上鼓进标签体内。像素逐行验证：蓝块上宽下窄（改前上窄下宽）。
- **tab 间隔 +2px/边**：`.dv-tab` margin `3px 2px 0` → `3px 4px 0`（非活动对 4px→8px 净间隔）；活动标签负边距 `-4px` → `-2px`（活动↔相邻 -2px 重叠 → +2px 可见间隙）。

### 节点视图（nodes2/）
- **快捷插入预览修复**（attachInsertion）：两条虚线曲线端点从鼠标点改为**被拖节点端口**——previewA=连接源 socket→节点 IN 端口中心、previewB=节点 OUT 端口中心→连接目标 socket（`[data-port-id]` getBoundingClientRect 中心换算容器局部坐标）；拖动中每个 pointermove 都刷新（rAF 延迟一帧，因为容器 capture 先于 rete 拖拽应用位移），曲线实时跟住节点端口；overlay z-index 6→**0**（节点 z-index=1，预览显示在节点背后）。
- **甩出节点 + 连线自动愈合**（attachShakeDisconnect 重做）：来回甩动 1 入 1 出节点（null/transform）→ 切断全部连接 → 每个 A→node→B 通路按原 sourceOutput/targetInput 直接重建 A→B（如 input.in1→null1→output.out1 愈合为 input.in1→output.out1），被甩节点保持断开；多端口节点无通路则只切断。undo 仍单个 `{type:"shake", cut, added}`；Ctrl+Z 恢复原链。

### Param 面板：中键拖拽倍率 scrubbing（新 web/src/app/scrub.ts + 9 单测）
- 去掉 number 输入框原生上下箭头（CSS 隐藏 spin button）。
- 按住中键在数值框上拖动：弹出 1 列 7 行倍率浮层（100/10/1/0.1/0.01/0.001/0.0001，自上而下），鼠标所在行高亮；未水平拖动前倍率随鼠标上下切换（数值不动）；`|dx|>3px` 后倍率锁定，`value += dx*倍率` 实时写回并触发 onChange（动态应用）；数值格式最多 4 位小数去尾零；浮层下方显示当前值；释放中键关闭。

### Viewport：左图标工具栏 + Enter 激活模式（renderer.ts + main.ts + viewport.css）
- 视口左侧新增纵向图标工具栏（`.cyl-viewport-toolbar`），第一个图标为 **Enter 箭头**（SVG：左门框+向右箭头）。
- 点击 Enter（或非输入/按钮聚焦时按 Enter 键）进入**节点 viewport 激活模式**：对选中的 transform 节点，把 TransformControls translate gizmo（X/Y/Z 轴箭头 + XY/YZ/XZ 平面方块 = 轴/平面/万向）attach 到 (tx,ty,tz) 处的临时 Object3D；拖动 gizmo → 读 position 四舍五入 4 位小数 → 回调更新节点 params(tx/ty/tz) + runNetwork（推桥 outputs）；gizmo 处有线框小方块 + RGB 轴参考标记。Esc / 再点 Enter / 切换选中节点退出。与 G 键 gizmo demo、曲线编辑互斥（进入时 detach，退出后恢复）。

### 验证
- tsc 0 错误；vitest 7 文件 68 通过（新增 scrub 9）；bridge pytest 20 通过；Playwright 全量 **16/16**（round2 5 + round3 4 + round4-nodeview 4 + round4-viewport 2 + smoke 1）。
- round4-nodeview 用例：预览端点=节点端口+拖动实时刷新、z-index 预览在节点后、null/transform 甩出愈合 + Ctrl+Z 恢复。round4-viewport 用例：工具栏 Enter 图标切换、gizmo 拖动更新 tx/ty/tz 且桥 outputs 平移。

## v0.1.00047（2026-08-11）
**4 路并行**（Faraday=dock / Copernicus=nodeview / Feynman=viewport+main / Kierkegaard=bridge 流式调研）。

### UI（styles/dock.css）
- **tab 底部圆角第二次翻转 + 小填充**：圆心翻回角点本身（`circle at 100% 100%` / `0 100%`），盒子高 7px→4px、半径 7→4，只露出**斜线下方的 4px 小脚弧**（小三角：底宽顶窄、紧贴底边向外鼓），不再是大圆盘填充。像素验证：蓝色面积 48px²→15px²（小 3 倍以上）、弧朝下半部分向外。

### 节点视图（nodes2/）
- **预览虚线对齐端口圆圈中心**：`portCenterLocal` 从整行 `[data-port-id]`（圆点+标签 39px，中心偏 12px）改为取 RefSocket 圆点 `span.input/span.output` 的中心；预览曲线端点在圆圈中心，且保持 z-index 在节点后。
- **shake 判定放宽**：buf 8→24、窗口 600→1000ms、最少点 5→4、单段 6→4px（反向次数保持 >=3）；真实鼠标慢甩能触发，普通单方向慢拖不误伤。
- **节点面板字体不可选中**：`.cyl-graph` 加 `user-select:none`（重命名输入框/palette 输入恢复 text），不再拖到文字。
- **禁止自连**：buildGraph 加 `connectioncreate` 中央守卫（source===target 阻断，`addConnection()` 返回 false），并覆盖 restoreGraph / applyUndoAction / attachInsertion（被插节点是悬停连接端点则跳过）/ shake 愈合。
- **端口拖线不触发插入预览**：attachInsertion 的 pointerdown 排除 `.cyl-rp-port`/`.cyl-ns`/`button`/rename/input，只有拖节点本体才启动插入跟踪。
- **transform 加 Pivot Translate**：params 增加 px/py/pz(float, 0)，供 viewport Enter 模式 pivot 使用。

### Viewport / main
- **Pivot Translate**：`beginTransformGizmo` 增 pivot 参数——gizmo 仍在 (tx,ty,tz)（拖动只改 tx/ty/tz），参考标记（`cyl-enter-pivot`）放在 pivot (px,py,pz)，不再显示「拖动前原中心」；新增 `setEnterPivot`，参数面板改 px/py/pz 时实时移动标记。
- **断开后视口刷新**：`onNetworkChanged` 现在 `void runNetwork(); refreshNodeFlags();`；display 的 null/transform 无 in0 输入（getDisplayPortIndex()===null）→ `setDisplayFocus('inputs', -1)`（隐藏全部输入端口），不再回退显示全部 inputs，消除 box+tube 原点重叠。

### bridge 流式同步调研（Kierkegaard，仅设计不实现）
- 新建 devlog/streaming-sync-gap.md：结论——瓶颈不在 30fps 轮询（那是 /pending 上限，实际调度被 scheduled 门控压到 ≈1/cook 时长），而在「Houdini dirty→整节点重执行→Cyl1nder 每次访问都在 cook 主线程内全量重算（since=0 全量拉取 + 全量 JSON 反序列化 + geo.clear()+重建）+ 全链路无增量/缓存」。建议：P0=HDA 侧访问即准备（后台线程就绪缓冲 + 差量 setPosition，纯 hda/src 可先落地）；P1=B1 协议 diff_output + /stream + topoId/transform + web applyOutputDelta；P2=B2 msgpack + native core。

### 验证
- tsc 0 错误；vitest 7 文件 68 通过；bridge pytest 20 通过；Playwright 全量 **23/23**（round2 5 + round3 4 + round4-nodeview 4 + round4-viewport 2 + round5-nodeview 5 + round5-viewport 2 + smoke 1）。
- round5-nodeview：预览端点=端口圆圈中心、慢甩弹出+单向慢拖不误伤、自连被阻断、端口拖线不触发预览、graph 不可选中。round5-viewport：pivot 标记在 (px,py,pz)、gizmo 拖动只改 tx/ty/tz 且桥 outputs 平移；断开 display 节点后所有输入端口隐藏、重连恢复。

## v0.1.00048（2026-08-11）
**3 路并行**（Mill=dock / Hooke=nodeview / Aquinas=viewport+main）。

### UI（styles/dock.css）
- **tab 底部圆角边界曲线镜像到对角线另一侧**：起点/终点不变（底边 4px、侧边 4px），把外凸圆弧（圆心在角点）镜像成**内凹弧**（透明盘圆心移到远角 0%/100%，挖掉远角 1/4，剩凹弧 A→B），填充面积 -49%/-59%（对应减小）。像素验证：起点/终点坐标不变（±1px）、旧弧中点不再蓝、新凹弧中点蓝。

### 节点视图（nodes2/）
- **transform display 看不见 box 彻底排查**：根因 = `getDisplayPortIndex()` 只解析**直接**由 `_input_` 喂入的连接（`sourceOutput` 匹配 `in\d`）；transform 的 in0 由另一个 null/transform 的 out0（链条）喂入时返回 null → `setDisplayFocus('inputs', -1)` 隐藏全部输入 → 看不见 box。修复：新增 `resolveInputSourcePort(editor, nodeId)` **链式解析**（in0 往回追：input → in\d；null/transform passthrough → 递归追其 in0；visited 防环），`getDisplayPortIndex()` 与 `getSelectedNode()` 统一改用它（null 与 transform 共用一套）。E2E 覆盖直接喂/链条喂/断开/input 回归四场景。
- **重命名双击命中区收缩 + 超长省略**：`.cyl-rp-title` `flex:1 → flex:0 1 auto; min-width:0`（不再占满顶部，头部空白双击不触发 rename）+ `max-width:20ch; overflow:hidden; text-overflow:ellipsis`（超 20 字符省略号）；改名输入框保持可输入完整名。
- **shake 参数定稿（用户确认刚好，计入 devlog）**：`attachShakeDisconnect` 阈值 = 缓冲 24 点 / 窗口 1000ms / 最少 4 点 / 单段 >4px / 方向反向 ≥3 次；普通单方向慢拖不误伤。

### Viewport / main
- **Enter 状态保持**：`graph.onSelectionChanged` 不再退出 enter 状态（点节点不变化）；gizmo 保持绑定进入时的节点，onChange 改用 `getNetworkSnapshot()` 按进入时 nodeId 更新 tx/ty/tz（不再依赖当前选中）。
- **Enter 键绑定 viewport 悬停**：renderer 增加 `hovered` 标志（canvas pointerenter/leave）与 `isHovered()`；main.ts 的 Enter 键 handler 仅悬停 viewport 时 toggle（回车进入/再按取消）；Esc 退出与工具栏按钮 toggle 保持不变。

### 验证
- tsc 0 错误；vitest 7 文件 68 通过；bridge pytest 20 通过；Playwright 全量 **30/30**（round2 5 + round3 4 + round4-nodeview 4 + round4-viewport 2 + round5-nodeview 5 + round5-viewport 2 + round6-nodeview 5 + round6-viewport 2 + smoke 1）。
- round6-nodeview：transform 直连/链条 display 都显示对应输入、断开隐藏、input 回归、重命名收缩+省略。round6-viewport：点节点后 enter 状态保持且 gizmo 仍更新进入时节点；Enter 键只在悬停 viewport 时进入/取消。注：round4/round5-viewport 两个旧用例因「Enter 需悬停 viewport」行为变更补了 `hover()` 后恢复通过。

## v0.1.00049（2026-08-11）
**3 路并行**（Godel=dock / Tesla=param+撤销基础设施 / Bacon=viewport+main）。主进程先预置契约锚点：undo.ts 的 `{type:"params"}` 动作、graph.ts 的 `pushUndo` + applyUndoAction params 分支 + undo 后自动刷新钩子，使 param 侧与 main 侧并行不冲突。

### UI（styles/dock.css）
- **tab 底部圆角抗锯齿**：凹弧渐变硬边（transparent 3.4px→蓝 3.5px）→ **1.0px 软边带**（transparent 0 2.5px, rgba(46,79,125,0.4) 3px, #2e4f7d 3.5px），圆角半径保持 **3.5px**、起点/终点不变。像素验证：弧边缘 0.57→~4.8 device px 平滑过渡、整条 tab bar 仅 8 个边缘像素变化。**devlog 标注：抗锯齿软边 + 圆角半径 3.5px（起点/终点 4px 不变）**。

### Params 面板（scrub.ts / param.ts / graph.ts / params-user-guide.md）
- **中键 scrubbing 重做**：浮层以鼠标为垂直中点（0.1 行在鼠标处，初始倍率 0.1）；框内上下只切倍率高亮、不改数据；**出框（跨左/右边缘）锁定倍率后只有左右拖动改数值**；**左右灵敏度减半**（×0.5）；**轨迹归一化**（以出框点为基准累计水平位移，value=起始值+累计位移×倍率×0.5，无抖动）。scrub.test.ts 重写 19 项。
- **Ctrl+中键单击恢复默认值**：ParamInfo 增加可选 `default`；`paramDefault(p)` 显式 default 优先、类型兜底；数值/文本/class 控件 Ctrl+MMB 单击写回默认并走提交路径（可撤销）。scrub 忽略 Ctrl+中键避免冲突。
- **transform 所有参数带默认值**：graph.ts 新增 `ParamSpec {name,type,value,default?}` 统一 4 处 params 类型；tx/ty/tz/px/py/pz→0、group→""、class→"autoguess"。
- **新建 devlog/params-user-guide.md**（用户手册）：中键 scrubbing 全流程、Ctrl+中键恢复默认、键盘输入、撤销/重做快捷键。

### 撤销与日志（undo.ts / graph.ts / main.ts）
- **parms 数值修改进撤销系统**：UndoAction 新增 `{type:"params", nodeId, before, after}`；applyUndoAction params 分支（undo→before、redo→after，notifyNodeChanged）；undo/redo 后自动调 onNetworkChanged（重跑网络+刷新视口）与 onSelectionChanged（刷新面板）。main.ts 会话式记录：同一 nodeId 连续编辑合并，600ms 防抖 push，选中切换 flush。
- **Log 面板新增 Parameter 类**：logCategories 加 `param/Parameter`；categorize 首行匹配 `[param]`；参数修改日志 `[param] label name = value`，参数撤销日志也归入该类。

### Viewport 真正读取节点 geo（network.ts / geometry.ts / renderer.ts / main.ts）
- 新增 `computeNodeResult(snap, inputs, nodeId)`：沿节点 in0 链回追（复用 traceChain），返回该节点链路的真实输出（transform 平移后 points）；断链→null。
- `buildNodeResult(buffer)`（geometry.ts）与 `showNodeResult(buffer|null)`（renderer，`cyl-node-result` 组）。
- **main.ts** `refreshNodeFlags`：display 为 null/transform 且有源 → 隐藏源 input 端口 + 显示节点计算结果几何（transform 移动后几何体跟着移动）；断开 → 隐藏；input/output/无 display → 显示源/输出（原逻辑）。

### 验证
- tsc 0 错误；vitest 7 文件 **82 通过**（scrub 19 重写 + network 13 含 computeNodeResult 4 条）；bridge pytest 20 通过；Playwright 全量 **33/33**（round2 5 + round3 4 + round4-nodeview 4 + round4-viewport 2 + round5-nodeview 5 + round5-viewport 2 + round6-nodeview 5 + round6-viewport 2 + round7-viewport 3 + smoke 1）。
- 行为变更（display null/transform 改为显示节点计算结果而非源端口）导致 round5-viewport / round6-nodeview 3 条旧断言更新为检查 `cyl-node-result` 几何。

## v0.1.00050（2026-08-11）
**4 路并行**（Turing=viewport+main / Halley=Overview 页面 / Pauli=bridge 场景+usdz / Darwin=流式推送 dirty 讨论）。参考 AHS fork（D:codedevwebAnimehairstudio）的 QuickSave/QuickExport：File System Access API（showDirectoryPicker/showSaveFilePicker + createWritable，浏览器原生覆盖确认），仅借鉴架构不复制代码。

### Viewport / main（renderer.ts / main.ts / client.ts）
- **Enter 模式跟随第一个选中节点**（不再是 display flag / 进入时节点）：enterActive 语义与 gizmo 解耦；endTransformGizmo({keepActive}) 只 detach 不清模式；setEnterActive(bool) 支持无 transform 进入（gizmo idle 但模式亮）。onSelectionChanged 里 enter 激活时：选中 transform → 重绑 gizmo（读其 tx/ty/tz/px/py/pz）；null/input/output/无选中 → gizmo 空但模式保持；再选 transform → gizmo 重现。
- **File/Layout 菜单点击后关闭**；旧 Open Scene 改名 **Reload Scene**；新增真正 **Open Scene…**（选带序列号文件夹 → 读 io/scene → pushInputs+putSnapshot → 跳 ?serial=，无 Houdini 也能开）；**Save Scene As** 保存整个 <serial>/ 文件夹（io/inputs.json+outputs.json、scene/node-graph.json+node-parm.json、docking-layout.json），同名文件夹确认覆盖；**Overview** 菜单项开 /overview.html。FSA 优先（Chromium showDirectoryPicker），失败/非 Chromium fallback 到 bridge 的 scene/save 与 scenes/open（prompt 路径）。

### Overview 总管页面（web/overview.html + src/overview.ts + styles/overview.css + vite 多页）
- /overview.html 同主题深色页：活跃场景（serial/label/lastSeen/revs/离线标红/打开）、历史场景（serial/savedAt/打开）、新建场景（POST /api/scenes → 跳 ?serial=，无 Houdini 也能开）；桥离线/接口不可用横幅区分提示；vite build 多页输入 index+overview。

### bridge 场景管理 + usdz（routes.py + scenes.py + usdz.py + test_scenes.py）
- GET /api/scenes（active=registry+workspace 汇总，history=快照目录+meta.savedAt）；POST /api/scenes {label?} → 新 serial+注册+空 workspace；POST /api/hda/{serial}/scene/save {target_dir, overwrite?}（保存时先刷新 io 缓存 → 拷贝整个快照目录到 target_dir/<serial> → 生成 <serial>.usdz，同名 exists 冲突）；POST /api/scenes/open {folder_path}（文件夹名=合法 serial → 注册+载入 inputs/graph/docking）；GET /api/hda/{serial}/usdz 返回 usdz 字节。
- **usdz.py 零新依赖**：最小 usda 文本（#usda 1.0 + upAxis=Y，faces→UsdGeom.Mesh、curves→UsdGeom.BasisCurves、纯点→UsdGeom.Points）+ 标准库 zipfile 打包 .usdz（USDZ=zip）；参考 AHS buildHairUsda 风格但自写，不复制代码。

### 流式推送 dirty 讨论（Darwin，仅设计）
- 新建 devlog/streaming-push-dirty.md：推荐主通道 = ① bridge→HDA 事件推送（/stream 长轮询 NDJSON，替代 33ms /pending 轮询，~1-5ms）+ ③ HDA 后台就绪缓冲 + topoId 不变只 setPosition；② fxhoudinimcp execute_python 可触发指定 SOP dirty 但仅作 dev/E2E 钩子（白名单模板），不作应用主链路；按 role 分桶 dirty + bypass 隔离 + position-only 最小化计算量；bridge 侧增量缓存（topoId/transform/deltaRing）+ web 侧节点结果缓存（nodeId/inputRev/paramSignature/topoEpoch，LRU 256）配合内容对比自愈。

### 验证
- tsc 0 错误；vitest 7 文件 82 通过；bridge pytest 31 通过（新增 scenes/usdz 11 条）；Playwright 39 passed / 2 skipped（2 skipped = round8-overview 的 /api/scenes 用例，因运行中的 bridge 是旧进程未含新端点，重启 bridge 后自动转绿）。
- 行为变更（Enter 跟随选中）导致 round4/round6-viewport 2 条旧断言更新为「无 transform 时模式激活但 gizmo 空」。

## v0.1.00051（2026-08-11）
**4 路并行**（Hegel=Overview web / Socrates=bridge scenes+cleanup / Banach=HDA 缓存+同步 fps / Huygens=Houdini python runtime 设计+panel 原型）。

### Overview 总管页（web/overview.html + src/overview.ts + styles/overview.css + index.html）
- **默认入口**：index.html 内联脚本——无 `?serial=` 时 `location.replace("/overview.html")`（访问端口默认打开总管页）；有 serial 才加载主应用（现有链接/测试不破坏）。
- **新建场景区块置顶**（新建 → 活跃 → 历史）。
- **离线 vs 未cook 三态区分**：lastSeen 超 15s → 离线（红）；lastSeen 新鲜但 lastActivity 陈旧/为 0 或 inputRev&&outputRev 均 0 → 未cook（橙）；否则在线（绿）。[已过时：离线阈值 v0.1.00056 起 150s]
- **清理无效场景按钮**：POST /api/scenes/cleanup → 重新拉取渲染 + 结果列表（>5 截断，完整进 title）。
- 打开主应用链接改为 `/?serial=`（避免被默认重定向绕回）。

### bridge scenes + cleanup（registry.py / scenes.py / routes.py / test_scenes.py）
- RegistryRecord 加 `lastActivity`（epoch，0=从未），put_inputs/put_outputs 实际写入时 mark_activity；list_scenes active 项带 lastActivity。
- `POST /api/scenes/cleanup`：history 删空/缺 io+meta/meta 损坏的 serial 目录；active 移除无数据且无快照的注册；返回 removed+reason（empty/incomplete/corrupt-meta/no-data-no-snapshot）；resolve+relative_to 防路径穿越。pytest 34 通过。

### HDA 缓存-直到输入变化 + 同步 fps（hda/src/cyl1nder_hda.py + hython_smoke.py + streaming-sync-gap §8）
- **就绪缓冲（访问即准备）**：_sync_loop 后台线程预热拉 /outputs?since=<ready rev> 到 _READY（latest-wins），cook 主线程零网络零反序列化；_role_buffer 退化为冷启动 fallback。
- **输出缓存三态**：同一 buffer（_gen 相同）→ geo.copy(cached)（O(1)）；拓扑签名相同（位置-only）→ setPointFloatAttribValues(P) 批量写不重建；拓扑变化才重建；内容对账自愈保留。
- **输入推送缓存**：_input_signature 相同则跳过 serialize×4+push（拖拽期间输入未变不再重复推流/bump inputRev）。
- **实测 fps**：200pt/40crv 35-50ms（≈20fps）→ ~5ms（200fps 级，受 sync_fps 约束）；2000pt/400crv 350-550ms → ~13ms（77fps 级）。现在把 sync_fps 提到 60 有真实收益（16ms 轮询 → ~60fps 拖拽同步）。关键发现：Python SOP 每次真实 recook 输出都重置为 input0 拷贝 → 快速路径用缓存几何+copy+批量 P 写而非跨 cook setPosition；健康探测 2s 限频。
- hython smoke 全绿（缓存命中/位置快速路径/拓扑重建/输入推送缓存/输入变化失效）。

### Houdini python runtime 接口设计与 transform 流式 panel（Huygens，设计+原型）
- 调研 spaceMouse2（D:\code\dev\Houdini\spaceMouse2）：python panel 模式（后台线程取数→queue→UI 线程 QTimer 写 hou，hou 只在主线程）；apex 特殊处理——pack 类数据（scene 的 apex.Dict/Matrix4/Geometry pack）、Channel List 不可拆分（animbinding channel primitive 几何体，ChannelPrim.eval/insertKey/setKeyValue）、关节世界坐标需 control_manager.getControlXform/getControlData、当前只能改 viewport 绝对坐标（graph_parms 热改不落 key 不可撤销）。
- **devlog/python-runtime-design.md**：Cyl1nder ⇄ Houdini Python Runtime 接收端（python panel 常驻，非 SOP HDA）⇄ 目标节点；流式 channel 协议草案（set_channels 增量/稀疏/latest-wins，bridge 8375 新端点长轮询，Houdini 端纯 urllib）；分期 Phase1 transform 3 float → Phase2 channel list 增量 → Phase3 Apex Animation Layer（最终目标已记录）。
- **hda/panels/cyl1nder_runtime.pypanel**：Houdini Python Panel 原型（Mock/Bridge 双数据源、写 tx/ty/tz、状态指示、目标节点 Pick/Use Sel、Pause/Resume、30ms QTimer 写 hou；CHANNEL_PARM_MAP 预留 apex 映射；hython py_compile 通过）。

### 验证
- tsc 0 错误；vitest 7 文件 82 通过；bridge pytest 34 通过；hython smoke SMOKE OK；Playwright 44 passed / 2 skipped（smoke 在 10 worker 全量跑时偶发 flake，单独跑通过）。
- round9-overview：裸 / 重定向 overview、?serial= 不重定向、新建置顶、清理按钮、三态渲染。

## v0.1.00052（2026-08-12）
**2 路并行**（Descartes=bridge/HDA 流式 + kick / Archimedes=web kick 首连触发）。

### bridge/HDA 流式优化（cyl1nder_hda.py / cyl1nder_bridge.py / routes.py / state.py / hython_smoke.py）
- **自适应轮询（减少通讯流量，小改已落地）**：`_sync_loop` 活跃（pending/reset/force，或距上次活动 <2s）用 fast interval（1/sync_fps）；空闲退避到 500ms；有活动立即回 fast。空闲 /pending 流量从 ~20-30 次/秒 降到 ~2 次/秒，心跳（lastSeen）语义保留。client/sleep_fn/now_fn 可注入，hython 冒烟确定性断言。[已过时：v0.1.00056 起被 /stream 事件驱动取代，/pending 仅作 fallback]
- **kick 踹 HDA（任务 2，已落地）**：bridge 新增 `POST /api/hda/{serial}/kick`（一次性 force 标记 + registry.touch）；`/pending` 返回一次 `force:True` 后消费。HDA `pending_outputs` 改 4 元组，`_sync_loop` 收到 force 无论 rev 是否前进都 schedule recook；且 last_error 非空时弹掉 `_PUSH_CACHE` → recook 重新 push → push 成功清 last_error → HDA 状态从 offline 转 ok（force/pending 两条路径都自愈）。
- **web 首连 kick**（main.ts/client.ts）：WS hello 首次到达该 serial 时 `client.kick(serial)` 一次（重连不重复）；成功且 inputs 非空则 runNetwork（cook 一下）；失败静默（避免 log 噪声）。
- **pytest 34 通过**（新增 kick force one-shot 400/404 + touch registry）；hython SMOKE OK（新增 adaptive polling + kick force recook 断言）。

### /stream 长轮询计划（大改，仅计划）
- devlog/streaming-push-dirty.md 追加第 8 节：技术栈对比（WebSocket 排除 / SSE 可行但连接常驻 / **NDJSON 长轮询推荐**）；bridge `GET /api/hda/{serial}/stream?since=&hold=15`（asyncio 等待者，事件立即返回、超时返回空）；HDA urllib 长轮询、断线立即重连、自适应 /pending 作 fallback；收益：空闲流量 20-30 次/秒 → ~0，33ms 轮询 → 事件级 ~ms（动捕事件率 = 实际变化率）。

### 测试加固（主进程合并时）
- 发现 smoke 依赖 Log 面板"最近 40 行"，被 viewport 的 visibility/focus 静默日志淹没导致偶发失败；加 `window.__cylStore` debug hook（完整日志），smoke 改为从完整 store 日志断言 hello（面板 40 行不再脆弱）；kick 失败日志改静默。e2e 46 passed / 2 skipped（overview 与 kick 端点依赖用例，运行中旧 bridge 未含新端点则跳过）。

## v0.1.00053（2026-08-12）
**1 路并行**（Mencius=品牌跳转 + 非当前 tab 配色）。
- **左上角品牌跳转 overview**：layout.ts 两处（主布局/备用模板）`.cyl-brand` 由 `<span>` 改为 `<a href="/overview.html">`；base.css 加 cursor:pointer、text-decoration:none、color:inherit + hover 变亮（#9fd8ff），保留品牌结构与布局。
- **非当前 tab 配色 S-0.1/L+0.1**（dock.css，目标色已由主进程用 HSL 预计算）：inactivegroup-visiblepanel bg `#20537e→#356d9c`、inactivegroup-hiddenpanel bg `#17191d→#333334`、activegroup-hiddenpanel bg `#1b1e24→#37383b`、inactivegroup-hiddenpanel text `#8f959e→#b0b0b0`；当前标签蓝 #2e4f7d、hover、缺口、间距不动。像素验证：非当前 tab 更亮更灰、当前蓝不变。
- 验证：tsc 0；vitest 82；pytest 34；Playwright 47 passed / 2 skipped（round11-brand：点击品牌 → /overview.html）。

## v0.1.00054（2026-08-12）
**事故修复 + 调研**（主进程处理 bridge 中断；Singer 调研 gizmo 延迟）。
- **bridge 中断修复（根因）**：轮询流量把 bridge 打崩/重启后，用户 serial 从 registry 消失——`registry.touch` 原来**不自动注册**（注册只发生在 cook 时 push_inputs），空闲 HDA 只轮询 /pending 永远不会重新注册 → serial 失联、无数据。修复：`registry.touch`/`mark_activity` 对合法 serial **首次接触自动注册**（最小记录，后续 push_inputs 再补 hip/path/label），HDA 下次轮询即重新出现。已重启 bridge（v0.1.00053+），`/pending` 探测自动注册验证通过（serials 从 1 → 2）。
- **web 重连自动再 kick**：WS 掉线重连（如 bridge 重启）后，`connect()` 同步清掉该 serial 的 kickedSerials → 新 hello 自动再 kick HDA → recook → 数据流恢复（无需手动刷新页面）。round10-kick 用例更新为"首次 1 次 + 掉线重连再 1 次"，改用 POST 计数（日志面板 40 行窗口不可靠）。
- **pytest 37 通过**（新增 touch 自动注册/非法 serial 忽略/mark_activity 自动注册）。
- **three.js gizmo 延迟调研**（devlog/viewport-gizmo-latency.md，仅调研）：**TS 与延迟无关**（TS 编译成 JS，运行时是 V8 JIT）；**three.js 不是 WASM**（纯 JS + WebGL，光栅化在 GPU）；Houdini 快是原生 C++ + 常驻 GPU buffer + 增量更新。真实延迟来源 = 每次拖动都走全量链路（objectChange → runNetwork → 全量 JSON PUT → WS 回推 → 视口 outputs/nodeResult 双重建 → rAF 重绘），重建在主线程同步卡顿。改进方向（计划）：本地预览（拖动期本地应用变换、提交才走网络）、节流合并 runNetwork（30-60Hz）、位置-only 更新、消除双重建等。

## v0.1.00055（2026-08-12）
**3 路并行**（Leibniz=no-geometry 诊断+恢复 / Ohm=底部更新模式栏 / Hegel=时间轴设计）。
- **no geometry 诊断与恢复（Leibniz）**：根因 = 运行中的 HDA 是旧代码（`pending_outputs` 3 元组无 force，不处理 web 的 kick），kick 一次性标记被旧轮询消费后忽略 → 永不强制 recook → 不 push inputs → web inputs 空。已用 fxhoudinimcp(8100) 执行文档化热重载 `reload_cyl1nder()` → inputs 恢复（4 路，rev=1，lastActivity 更新）。devlog/no-geometry-diagnosis.md 记录了诊断/恢复/后续建议（改 hda 后必须热重载或在 Houdini 里 dirty 一次）。
- **底部非 docking 栏 + 更新模式（Ohm）**：dock 之下新增 `.cyl-bottom-bar`（28px，右对齐），右侧 15ch 宽下拉 `Auto Update / On Mouse Up`（localStorage 记忆）。**Auto Update**：gizmo 拖动每帧 setNodeParams+runNetwork（现状）；**On Mouse Up**：拖动期 gizmo 实时跟手但只缓冲最后 tx/ty/tz（零网络零几何重建），松手（dragging-changed false）一次性提交（一次 setNodeParams+runNetwork）；重绑 gizmo 清脏缓冲防串。renderer `beginTransformGizmo` 增 `onDragEnd` 回调。
- **时间轴系统设计（Hegel，仅设计）**：devlog/timeline-design.md——默认 30fps、启动与 Houdini 场景 fps 同步、双向同步以 **HDA 锚定（engaged = 选中 OR 最近 1s 内 cook，由 HDA 回传）** 为门控（lastSeen/lastActivity 都不能作门控）；复用 /pending + WS 传输（H→C 捎带 frame/fps/engaged，C→H 发帧号 → hdefereval.setFrame）；拖动节流/latest-wins/回显抑制；Phase1 单向读+启动 fps 同步 → Phase2 双向拖帧 → Phase3 播放/循环。
- 验证：tsc 0；vitest 82；pytest 37；Playwright 全量 52 项 **51 passed / 1 skipped**（--workers=3；6 workers 时共享 serial 并行争用导致 round2/6/12 偶发 flake，顺序跑全过）。
## v0.1.00056（2026-08-12）
- **HDA 心跳离线判定改慢时钟**（配合 HDA 侧 /stream 长轮询 hold=60s、心跳 1/min）：`main.ts` `startHdaWatch` stale 15s → **150s**、检查间隔 5s → 15s；`overview.ts` `OFFLINE_MS` 15_000 → **150_000**（`STALE_ACTIVITY_MS` 不变，未 cook 判定不受影响）；`protocol/types.ts` 新增 `StreamEvent` 镜像（三处同步）；e2e round9 offline fixture `lastSeen: now-30` → `now-300`。
- 验证：tsc 0；vitest 82；e2e round9/10/12/smoke **11 全过**。
## v0.1.00057（2026-08-12）
- **底部栏 Sync Max FPS + 首选项系统 + 快捷键**（devlog/sync-rate-limit-and-preference.md）：
  - 底部栏：删除 `Update` 灰字 label（仅保留下拉框）；右侧新增 `Sync Max FPS`（number，1..60，默认 30）→ 变更即存 Preference + `PUT /sync`（kick bridge / HDA 接收上限）。
  - `update_mode` enum（`"auto"|"mouseup"`）：localStorage 新 key `cyl1nder.prefs`（旧 `cyl1nder.updateMode` 一次性迁移）；`protocol/types.ts` 新增 `UpdateMode`/`SyncConfig`/`PreferenceJson`，`StreamEvent` 加 `fps?`。
  - **Edit 菜单 → Preference…** 对话框（app/preference.ts 新建：非模态浮动面板，Sync Max FPS + Update Mode，Cancel/Apply/Accept；v0.1.00059 起可拖动、Save→Accept）。
  - **快捷键**：`Ctrl+S`=快速保存（graph+docking+preference）、`Ctrl+Alt+S`=另存为，均 `preventDefault()` 阻止 Chrome 保存网页（输入框聚焦也拦截）。
  - **Preference.json**：Edit→Preference 保存、Save Scene / Save Scene As（FS Access 写 `<serial>/Preference.json`）/ Ctrl+S / Ctrl+Alt+S 一并保存；打开场景（FS Access 或快照）读取并 apply + `putSyncFps`。
  - **推流（v0.1.00059 起无上限）**：Auto Update 越快越好，移除 `throttledPush`；Sync Max FPS 仅限 kick bridge（bridge 接收/转发 + HDA recook）。
  - 验证：tsc 0；vitest 82；e2e round12（去灰字/update_mode/Sync Max FPS）+ round13（Preference 对话框 / Ctrl+S / Ctrl+Alt+S）7 项全过。
## v0.1.00058（2026-08-12）
- **自动保存系统 + 平常不写盘**（devlog/autosave-color-prefs-ui.md）：移除 `scheduleSaveGraph` 1.5s 自动写盘（改 `markGraphDirty` 只标记）；只有 Ctrl+S / Save Scene / Save As / **定时自动保存**写盘（默认 5min，General 首选项「Auto Save」块：启用 toggle + 间隔分钟，可小数≥0.1）；`startAutoSave` 在 prefs 变化时重启。
- **首选项浮动窗口（非模态）+ 分类标签**：Preference 面板不再全屏遮罩（背后可继续操作），标签 **General | Viewport**；General = Sync Max FPS + Update Mode + 分隔线 + Auto Save 块；Viewport = 默认背景颜色（色块 + hex + Change… 调共享拾取器）；按钮 Cancel / **Apply**（应用不关闭）/ Save。
- **统一颜色属性系统**：param 新增 **color3**（vector float normalize，存储 rgb [0..1]）；Params 面板 color3 渲染色块，左键弹出**现代颜色拾取器**（`web/src/app/color.ts` + `colorpicker.css`：色相轮盘 + SV 方板、预置调色板 + 最近色块（localStorage）、RGB/HSL/HSV 三模式数值、#hex 直接输入实时同步、非模态）。
- **菜单/标签**：菜单顺序 **File/Edit/Layout**；Layout 菜单直接显示当前布局名（15ch 固定，不再显示 "Layout"）；**dock 活跃标签底部凹角 bug 修复**（Round 8：凹角伪元素此前画到 tab 外侧覆盖相邻标签，改为 tab 自身内凹并画栏色 #1c1e22，像素验证蓝色覆盖 0/0）。
- **Enter 模式**：取消选择不再丢 gizmo——挂在**上一个 transform** 并保持 enter；只有主动换选/删除该节点/显式退出才改变（round8 e2e 更新为新行为）。
- **偏好优先级**：localStorage 为工作态（reload 保留）；场景 Preference.json 仅在打开/连接**不同**场景时应用（`cyl1nder.lastSceneSerial` 门控）。
- 验证：tsc 0；vitest 82；e2e round8/12/13/14/15/10/9/smoke **25 全过**；pytest 50（无 bridge/hda 改动）。
## v0.1.00059（2026-08-12）
- **优化轮**（devlog/optimize-round-00059.md）：
  - **Sync Max FPS 语义修正**：它不是 Cyl1nder 本体运作上限——**Auto Update 推流不设上限（越快越好）**，移除 `throttledPush`（runNetwork 与 viewport 编辑直接 pushOutputs）；Sync Max FPS = **kick bridge 上限**（`PUT /sync` 下发 bridge 接收/转发 + HDA /stream fps recook）。底部栏/首选项 tooltip 同步。
  - **File 菜单**：Save Scene / Save Scene As 右侧加灰小字 `Ctrl+S` / `Ctrl+Alt+S`（`.cyl-menu-kbd`）；**移除 Overview 项**（仅左上角 brand 触发）。
  - **Layout 菜单标签**：改圆角矩形框（`.cyl-menu-layout-box`）——左侧 ▲▼ 竖排装饰图标 + 右侧深色块固定 15ch 显示当前布局名（`padEnd(15)` 补空格）。
  - **Preference 浮动面板**：支持按标题栏拖动；按钮 **Save→Accept**（应用并关闭；Apply 仍为应用不关闭）。
  - **dock 活跃 tab 底部圆角（Round 9 重做）**：凹角颜色从栏色 #1c1e22 改为内容区色 #141518（tab 融入内容区），6×4 盒仍在 tab 自身矩形内；恢复蓝色 crescent 贴角强调，矩形外无蓝/深色覆盖（像素验证 0/0 + 角部蓝 23/23）。
  - e2e：round8（File 菜单快捷键/无 Overview/Layout 框）+ round6（Enter 取消选择 gizmo 保留，更新过时断言）。
  - 验证：tsc 0；vitest 82；全量 e2e **61 passed / 1 skipped**；pytest 50（无 bridge/hda 改动）。
## v0.1.00060（2026-08-12）
- **优化轮 2**（devlog/optimize-round-00060.md）：
  - **dock 活跃标签底部圆角 Round 10**：蓝色 crescent **向外翻折**（恢复 v0.1.00057 Chrome 式外翻观感，越出 tab 矩形盖过邻标签角），同时**消除背后的实心阴影**（删除邻标签 #1c1e22 6×6 凹口盘；凹口改用 tab 自身 background-image 以 #141518 内容区色衔接）；像素验证：矩形外蓝色新月 0→8、邻角实心补丁 42→7、内凹衔接 23/23。
  - **nodeview 点阵层级修复**：根因 = `.rete-area`/`.x6-graph` 选择器永不命中（rete 容器无 class），node wrapper 的 transform 自带 stacking context 困住 `.cyl-rp-node` 的 z-index，点阵（树序靠后、z-index:0）盖在节点/标题文本上。修复：`.cyl-graph { isolation:isolate }` + `.cyl-dotgrid { z-index:-1 }` + 删死选择器 + **保留 `.cyl-rp-node { z-index:1 }`**（insertion preview z-index:0 仍低于节点，round4/5 断言保持）。
  - **Overview 新标签**：左上角 brand 改 `target="_blank" rel="noopener"`（不再本页面跳转）；round11-brand e2e 改为 popup 断言。
  - **bridge 重启后几何自动恢复**：HDA `_stream_loop` reset 分支新增 `_reset_caches(serial)`（清 `_PUSH_CACHE`/`_CORE_CACHE`/`_OUT_CACHE`/`_GEO_CACHE`，**重推 inputs 到新 workspace**）并**绕过 fps 节流直接调度 recook**；hython 新增 reset 断言（含节流窗口内 reset）。
  - **视口参数 Undo**：undo.ts 新增 `{type:"group"}`（undo 逆序/redo 顺序）；graph.ts `pushUndoGroup` + group 应用（params 子 action 只触发一次网络刷新）；main.ts gizmo 拖动捕获 before/after，**一次拖动 = 一步 Ctrl+Z 撤回**（auto/mouseup 均一次）；新 e2e round16-undo（3 用例）。
  - 验证：tsc 0；vitest 82；全量 e2e **64 passed / 1 skipped**；hython SMOKE OK（含 reset）；pytest 50。
## v0.1.00061（2026-08-12）
- **UI/颜色微调轮**（devlog/optimize-round-00061.md）：
  - **dock 活跃标签底角内侧残留修复**：根因 = 内凹 notch 渐变圆心写在瓦片顶部角（底边上方 4px）→ 真正底角没挖掉 + 软边产生近黑 AA 像素（「残留镜像/小黑点」）。修复：圆心移到真正底角（左瓦片 0% 100%、右瓦片 100% 100%）+ 2 停靠硬边 `#141518 0 3.85px → rgba(46,79,125,0) 4.05px`；像素验证 dark 3→0、darkblue 2→0、外部外翻蓝 8/8 不变。
  - **菜单 File/Edit 垂直居中**：`.cyl-menubar { align-items:center }` + `.cyl-menu-label:not(.cyl-menu-layout-box){ inline-flex; line-height:1; vertical-align:middle }`；File/Edit 中心 13.5→18.6，与 Layout 框偏差 ≤0.4px。
  - **颜色拾取器体验**：Viewport 首选项**点色块即开调色板**（移除 Change… 按钮，色块 cursor:pointer + 键盘可触发）；**hex 大写**（rgbToHex → #RRGGBB，输入小写自动转大写）；**色轮升级 Adobe 风**（色相环 + 内部 SV 三角形，`△/□` 切换、默认三角形，重心坐标选色，零依赖）。
  - e2e：round13（Change 按钮→点色块开拾取器）、round15（大写 hex：#3366CC/#FF8800/ZZZ）；preference 面板 Escape 在拾取器开着时让给拾取器关闭。
  - 验证：tsc 0；vitest 82；全量 e2e **64 passed / 1 skipped**；pytest 50（无 bridge/hda 改动）。
## v0.1.00062（2026-08-12）
- **大改造轮**（devlog/optimize-round-00062.md）：
  - **HDA 崩溃根治 + 恢复闭环**（关键）：`_stream_loop` 后台线程**不再调 `hou.node`**（HOM 非线程安全，与 reload 并发即崩溃）；新增 `stop_sync`/`stop_all_sync`；`reload_hda.py` reload 前停线程、reload 后 force recook 重启；`_schedule_recook` 失败不再静默（去重告警）；`ensure_sync` 主线程探测节点消失并 stop；reset（桥重启）清 `_PUSH_CACHE` 等缓存 + 绕过 fps 节流调度 recook → 重推 inputs。
  - **dock 底角黑点根除（第 5 轮根治）**：删除 active tab `background-image` 内凹 notch（#141518 挖空层）→ 底角直接显示活动标签蓝；像素验证底角内侧无黑点、外部外翻 crescent 正常。
  - **菜单高度**：`.cyl-menu-label` 内边距 `2px 8px → 5px 10px`，File/Edit 与 Layout 框视觉等高。
  - **Sync Max FPS 步进**：隐藏原生 spinner，右侧 ▲▼ 深色步进列（同 Layout caret 风格），点按钳制 1..60 并触发既有 change 逻辑。
  - **字体**：新增 `web/public/fonts/`（Fira Code regular 22.8KB + Noto Sans SC chinese-simplified 1.1MB，jsDelivr fontsource 下载内嵌）+ `styles/fonts.css`（@font-face + `--cyl-font-code`/`--cyl-font-ui`/`--cyl-font-system` + body 类切换）；hex 类字体同步用代码字体；首选项新增 **UI 分类** + 字体下拉（code/system）。
  - **首选项**：单实例（重复打开只一个面板）；Viewport 背景色支持 **Ctrl+中键重置**；背景色应用修复（main.ts 三处调用 `viewport.setBackgroundColor`，此前从未接线）。
  - **viewport**：transform pivot 去掉绿色线框盒，保留 RGB 三轴。
  - **颜色拾取器大改造**：Recent 右键删/一键清空；色相环→**全圆盘**（圆心去饱和、半径=饱和度）；三角/矩形共用 132×132 同尺寸（切换零跳动）；RGB/HSL/HSV 加可拖动滑块；PALETTE=简单模式 + **Simple/Advanced** pill 切换（高级=11 个通用色名分类）；**原生 EyeDropper** 拾色器按钮（不支持隐藏）；**Adobe 和谐色轮**（Monochrome/Complementary/Analogous/Triadic/Compound/Shades 预设、5 联动点拖一带动、基础明度关联 HSL L、联动色块）；`.cyl-cp` 标题栏可拖动。
  - **param.ts 统一属性重置（P8）**：Ctrl+中键重置扩展到 **vector / color3 / string / class 等所有类型**（优先 `param.default`；color3 重置显示 hex）。**理念写入 devlog：属性操作属于统一属性系统，float/vector/color3 等一律通用**。
  - 验证：tsc 0；vitest 82；全量 e2e **71 passed / 1 skipped**；hython SMOKE OK（含 stop_all_sync）；pytest 50（registry 防抖测试用可注入时钟加固，消除时间敏感 flaky）。