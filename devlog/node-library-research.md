# Cyl1nder 前端「类 Houdini SOP 节点图」库选型调研报告

- 调研日期：2026-08-10（数据来自公开 GitHub/npm/官方文档，stars 与 commit 为当日检索快照）
- 背景：Cyl1nder 是 Houdini⇄WebGL 中间站，前端 Vite+TS，当前节点图基于 @antv/x6 自建（4 进 4 出静态图 + flags + Tab 搜索 + Y 剪切模式），效果不理想，拟换用现成库。
- 方法：对 20+ 候选逐一检索 GitHub stars / 维护状态 / 核心能力 / 许可；因时间限制，部分次要项（vue-flow stars、n8n/Node-RED/comfyui-frontend 精确 stars、@comfyorg/litegraph 精确许可）未精确核验，已在文中标注「未核」，结论不依赖这些精确值。

---

## 0. 结论总表（每候选一行，九列）

| 候选 | 优点 | 缺点 | flag 支持 | 缓存支持 | 框架依赖 | 许可 | 活跃度 | 推荐指数 |
|---|---|---|---|---|---|---|---|---|
| **rete.js 2 + rete-engine** | 唯一内置「节点输出缓存+脏传播」的成熟库；核心框架无关 TS；引擎与渲染分离 | 渲染需选 React/Vue/Svelte 插件（有框架成本）；无内置搜索/flag，需自建 | 无内置（自建成本低） | **内置（关键）**：DataflowEngine.fetch + resetCache | 核心无，渲染插件需 React/Vue/Svelte/Angular 其一 | MIT | 活跃（2025-06 v2.0.6，小型团队） | ★★★★★（推荐） |
| **@xyflow/react（React Flow）** | 最活跃、文档最佳、生态最大（35k stars）；自定义节点自由度极高 | 纯渲染，无引擎/缓存/flag；必须引入 React；Houdini 外观与搜索全部自建 | 无内置（自建） | 无内置（自建） | React（硬依赖） | MIT | 极活跃（xyflow 12） | ★★★★☆（备选） |
| **@comfyorg/litegraph** | 风格最接近 Houdini SOP（竖排紧凑/左右端口/拖线/搜索框/node.mode bypass）；Canvas2D 零框架，几百节点流畅 | 上游 litegraph 已停更；comfy fork 独立仓库 2025-08 归档并入 monorepo；缓存需自建；许可需核实 | 部分内置：node.mode（ALWAYS/ON_EVENT/NEVER/ON_TRIGGER=bypass）、node.flags（collapsed/pinned） | 无内置（ComfyUI 的缓存在后端 Python） | 无（原生 JS/TS） | 原版 MIT；fork 并入 ComfyUI_frontend 后许可口径混乱（GPL-3.0/Apache-2.0 说法不一，**需核实**） | fork 随 ComfyUI_frontend 日更，但独立包维护不确定 | ★★★★（风格最接近，风险标注） |
| **@antv/x6（现状基线）** | 框架无关、SVG+HTML、国内生态、已接入 | 无引擎/缓存；节点紧凑竖排与 Houdini 手感需大量自建；体验已证不理想 | 无内置（已自建） | 无内置 | 无 | MIT | 一般（2.x 节奏慢，2025 仍有发布） | ★★★（维持现状 = 继续自研） |
| **comfyui-frontend（整体）** | 极活跃、功能全（i18n/命令/扩展 API） | 是完整应用非库：Vue3+PrimeVue+后端协议深度耦合，不可独立嵌入；许可口径混乱（未核） | 有（bypass/mute 等，见 litegraph 行） | 后端实现，前端不含 | Vue3/PrimeVue 全家桶 | GPL-3.0 或 Apache-2.0（未核，需确认） | 极活跃（日更 nightly） | ★★（不可独立用） |
| **comfyui-flow（diStyApps）** | 交互好看的 ComfyUI 自定义 UI | 是 ComfyUI 自定义节点/界面层，非独立库，绑定 ComfyUI 后端 | 有（借 ComfyUI） | 后端 | Vue | 未核 | 一般 | ★（不适用） |
| **litegraph.js（jagenjo 原版）** | Canvas2D、搜索框内置、无依赖、节点多不卡 | 2022 后基本停更；无 TS 官方类型（社区有）；无引擎缓存 | node.mode/flags 有 | 无 | 无 | MIT | 停更 | ★★☆ |
| **vue-flow** | 活跃、MIT、Vue3 渲染与 React Flow 同源体验 | 纯渲染无引擎/缓存；需 Vue3；Houdini 外观/搜索自建 | 无 | 无 | Vue3 | MIT | 活跃（未核 stars，约 3–4k） | ★★★☆ |
| **cytoscape.js** | 通用图可视化的经典库（10k stars），mushyfruit 用它做过 Houdini hip 预览 | 不是节点编辑器：无端口/拖线/搜索/引擎；需大量自建 | 无 | 无 | 无 | MIT | 活跃 | ★★（做编辑器成本高） |
| **logicflow（didi）** | TS、11.5k stars、国产、插件化、业务流程图经验足 | 面向审批/ER/BPMN 非数据流；无引擎缓存；2023-11 后发布停滞（2025 零星 commit） | 无 | 无 | 无（框架无关） | Apache-2.0 | 半维护 | ★★☆ |
| **@flume（chrisjpatty）** | React 节点编辑器 API 优雅 | 已实质停更（>1 年无发布）；无引擎缓存 | 无 | 无 | React | MIT | 停更 | ★★ |
| **beautiful-react-diagrams** | 轻量 React 组件 | 已停更（last commit 约 4 年前）；功能弱 | 无 | 无 | React | MIT | 停更 | ★☆ |
| **drawflow** | 简单、零依赖、MIT | 单人维护节奏慢；无 TS、无引擎/缓存、无 flags；不适合复杂数据流 | 无 | 无 | 无 | MIT | 缓慢 | ★★ |
| **jsplumb（community）** | 连线能力强（拖线/路由） | 是连接库非节点编辑器；社区版 2024-06 后基本停更，商业 Toolkit 主导；无引擎/缓存 | 无 | 无 | 无 | MIT/GPL2 双许可 | 停滞 | ★★ |
| **Node-RED 前端（editor-client）** | 生产验证、MIT、活跃 | 嵌在 node-red monorepo 的完整应用里，非独立库，抽取成本高；横向布局非 Houdini 风格；无引擎缓存 | 部分（有 enable/disable 视觉） | 无（运行期在 Node 后端） | 无（d3 自绘 canvas） | MIT | 活跃（v4.x） | ★★☆（抽取成本高） |
| **n8n 前端（editor-ui）** | 极活跃、Vue3 | **Sustainable Use License（fair-code，非 OSI 开源）**，商用嵌入受限；完整应用非库 | 有（workflow active 概念） | 无 | Vue3 | 可持续使用许可（非 MIT） | 极活跃 | ★（许可不满足） |
| **Noodl / OpenNoodl** | 完整低代码平台、有节点执行引擎 | OpenNoodl 为 GPL-3.0 fork；整体是平台应用，不可独立嵌入 | 有（平台级） | 有（平台级） | React 大应用 | GPL-3.0（fork） | 一般 | ★（不适用） |
| **Lume** | — | 检索到的 Lume 是 3D Web 框架/交互小说工具，非节点编辑器库，不适用 | N/A | N/A | 多种 | MIT（npm 包口径） | 未核 | ★（不适用） |
| **dagre + 自绘** | 布局成熟（6k stars，MIT），配合任意渲染层 | 仅布局算法，编辑器/交互/引擎全自建——等于回到自研 | 无 | 无 | 无 | MIT | 活跃 | ★★（仅作布局辅助） |
| **elkjs** | ELK 官方 JS 版，Sugiyama 分层布局，专为数据流+端口设计，可做自动布局 | 仅布局；EPL-2.0 许可（弱 copyleft，商用需注意）；非编辑器 | 无 | 无 | 无 | EPL-2.0 | 维护中 | ★★（仅作布局辅助） |
| **mushyfruit/houdini-web-rendering-interface** | 唯一「Houdini hip 节点图 + WebGL 视口」参考实现（Cytoscape.js+BabylonJS） | 是展示型小项目（查看 hip），非编辑器库；无缓存/编辑能力 | 无 | 无 | 无 | 未核 | 小项目 | ★★（仅参考） |

> 注：flag 支持指 bypass/display/freeze/wireframe 等「现成或低成本实现路径」；表格中「无」= 需自建（通常只是在节点数据上挂标志 + 改样式，成本低）。

---

## 1. 明确推荐

### 1.1 第一推荐：rete.js 2 + rete-engine（渲染插件建议 React 或 Vue 任一）

**理由（对照硬性需求）：**
1. **需求 3（缓存，关键需求）唯一现成命中**：rete-engine 内置 DataflowEngine，对每个节点缓存输出，`fetch()` 递归取数，拓扑变化自动失效；这正是「节点输出可缓存、输入变化才重算」的现成实现（详见 §2、§4）。其它所有候选（xyflow/vue-flow/litegraph/cytoscape/logicflow/drawflow/jsplumb/x6）都不带计算引擎，缓存只能自建——这也是你们 x6 现状「效果不理想」的根源之一。
2. **需求 1（Houdini 外观/交互）**：rete 只提供节点/端口/连线骨架，外观完全由节点组件决定，做竖排紧凑 + 左右端口 + 拖线 + 自定义虚线/图标没有任何框架阻力；社区有大量 Blender/UE Blueprints 风格编辑器案例可抄。端口输入在左、输出在右是经典 preset 默认形态。
3. **需求 2（flags）**：bypass/display/freeze/wireframe 没有现成，但实现路径极低——节点 `data` 上挂布尔标志，节点组件按标志渲染（bypass 虚线/降饱和、freeze 锁定图标、display 开关、wireframe 标记），engine 包装层在 `data()` 里对 bypass 节点做「直通不重算」。你们 x6 上已实现过 flags，可整体移植。
4. **需求 4（Vite+TS/轻量/three.js 分屏）**：rete 核心是框架无关的 TS 小库；与 three.js 视口分屏只需在节点 click 事件上发消息（与 x6 做法相同）；DOM 节点可任意内嵌 3D 预览缩略图。
5. **需求 5（维护/许可）**：MIT，~12k stars，2025-06 发布 v2.0.6，社区虽小但持续；文档结构清晰。

**接入成本评估：**
- 数据模型：x6 的 node/edge JSON → rete 的 `ClassicPreset.Node`/`Connection`，端口 4 进 4 出直接映射（约 1–2 天）。
- 渲染层重写：需选一个渲染插件（React 或 Vue），Houdini 风格节点组件自建（约 3–5 天）。
- flags / Tab 搜索 / Y 剪切：从 x6 实现移植；搜索 rete 无内置需自建 palette（1–2 天）。
- 引擎接入：`editor.use(new DataflowEngine(...))`，节点实现 `data()` 即完成缓存链路（半天）。
- 合计估 **1–2 周** 单人工作量，换来内置缓存引擎与真正的「可视化编程框架」体系。

**风险：**
- 渲染依赖第三方框架插件（React/Vue/Svelte/Angular），框架版本升级可能牵动插件版本（社区常见 issue，但可规避）。
- 维护者少（核心 1–2 人），相比 xyflow 社区风险更高；建议锁定版本 + 内部保留少量自研兜底。
- 无官方内置搜索/flag，功能完整性靠自建（已计入成本）。

### 1.2 备选：@xyflow/react（React Flow）

**理由**：35k stars、MIT、xyflow 团队全职维护、文档与示例业界最佳；自定义节点自由度最高，Houdini 外观可实现；生态里已有大量「节点编辑器 + 3D 预览」案例。适合「宁可自己写引擎，也要最稳的渲染底座 + 最好的维护保障」的取舍。
**代价**：必须引入 React（当前项目无 React）；缓存/脏传播需自建（推荐按 §4 的 memoize+rev 方案，约 100–200 行）；flags/search 同 rete 一样自建。若团队抗拒 React，等价选择是 vue-flow（Vue3，MIT，活跃）。

### 1.3 专门说明：@comfyorg/litegraph（风格最接近 Houdini 的选项，暂列第三）

ComfyUI 的节点图就是 litegraph 系的 Canvas2D 编辑器，视觉与交互（竖排紧凑节点、左右端口、拖线、双击搜索建节点、bypass/mute）是所有候选里最接近 Houdini SOP 的，且零框架、几百节点流畅、可嵌入 three.js 分屏。
**但**：原版 litegraph 2022 后停更；Comfy-Org fork 独立仓库 2025-08 归档并入 ComfyUI_frontend monorepo（npm 包 @comfyorg/litegraph 仍发布，但独立支持变弱）；缓存不在前端（ComfyUI 在 Python 后端做执行缓存）；并入后许可口径混乱（GitHub org 页显示 GPL-3.0，第三方页面有 Apache-2.0 说法），**商用前必须向官方确认**。若你们愿意承担「fork 维护 + 自建缓存」并先解决许可问题，它是 Houdini 手感的第一选择；但在本次「MIT/宽松许可优先 + 活跃维护」的硬约束下，我把它放在推荐之后。

---

## 2. 推荐库的现成实现与 API/文档出处

### rete-engine（缓存 = 现成，关键）
- 文档：https://retejs.org/docs/concepts/engine/ （Dataflow 概念 + DataflowEngine 用法）
- 示例：https://retejs.org/examples/processing/dataflow/ （fetch 递归取数）
- API（retejs/engine 源码，npm `rete-engine@2.x`）：
  - `engine.fetch(nodeId)`：从目标节点递归遍历全部前驱取输出数据；
  - `engine.resetCache(nodeId?)`：源码注释明确「Resets the cache of the node and all its predecessors」——参数节点与其全部前驱的输出缓存被清除，下次 fetch 重算；不传参则全图重置；
  - 连接（connection）创建/移除时 engine 自动触发缓存失效。
- 用法：节点类实现 `data(inputs): outputs`，`editor.use(new DataflowEngine(...))` 即接入。

### flags（bypass/display/freeze/wireframe）——无现成，给出低成本路径
- rete 官方无 bypass/display 概念；路径：节点 `data` 增加 `{ bypass, display, freeze, wireframe }`，节点组件按标志渲染（bypass：直通 + 虚线/降饱和；freeze：禁拖动/禁编辑 + 锁图标；display：是否发消息给视口；wireframe：节点角标）。
- bypass 的执行侧：在 `dataflow.add(node, { data(fetchInputs){ if (node.flags.bypass) return 输入直通; return node.data(...) } })` 包装，实现「绕过不重算」。
- 框架插件下均为 DOM 节点，CSS 可完全控制虚线/颜色（比 canvas 易做）。

### 搜索/创建节点——无内置，需自建
- rete 官方无搜索插件；自建一个 palette（输入框过滤已注册节点类型 + 点击/Tab 创建），把你们现有 x6 的 Tab 搜索逻辑迁移即可（低成本）。

### litegraph 系（若走 1.3 路线）现成项
- `node.mode`：`LiteGraph.ALWAYS / ON_EVENT / NEVER / ON_TRIGGER`——ComfyUI 用 ON_TRIGGER + 输入直通实现 **bypass**（紫色），NEVER 实现 **mute**（灰色）；出处：litegraph 文档 / ComfyUI 源码 `src/lib/litegraph`（如 rgthree-comfy 文档对 mode 的说明）。
- `node.flags`：`{ collapsed, pinned }`（折叠/固定，非 bypass/display）。
- 搜索框：内置（双击/右键触发），ComfyUI fork 还发出搜索框自定义事件（Comfy-Org/litegraph.js README 第 #10 条）。
- 缓存：无内置；ComfyUI 的「输入变化才重算」在 Python 后端对 prompt 做 diff 缓存，前端库不含，需自建。

---

## 3. 与 @antv/x6 的迁移成本对比（现状：4 进 4 出静态图 + flags + Tab 搜索 + Y 剪切已自建）

| 能力 | x6 现状 | 迁移到 rete.js 2 | 迁移到 xyflow | 迁移到 litegraph |
|---|---|---|---|---|
| 节点/端口数据模型 | node/edge JSON，已自建 | 映射到 ClassicPreset.Node（1–2 天） | 映射到 node/edge 对象（1 天） | LGraphNode.addInput/addOutput（1 天） |
| 4 进 4 出布局 | 已有 | 天然支持 | 天然支持 | 天然支持 |
| Houdini 紧凑竖排外观 | 需自建（效果不理想） | 节点组件自绘（3–5 天） | 自定义节点（3–5 天） | **几乎现成**（ComfyUI 即此风格） |
| flags（bypass/display/freeze/wireframe） | 已自建 | 移植 + engine 包装直通 | 移植（data 标志+组件渲染） | 移植（mode/flags 部分现成） |
| Tab/关键字搜索建节点 | 已自建 | 移植（无内置） | 移植（无内置） | **内置搜索框**（微调触发键） |
| Y 剪切模式 | 已自建 | area-plugin 限制节点位置（中成本） | 自建（中成本） | 自建（canvas 事件里处理，中成本） |
| 缓存/脏传播（关键） | 无，全自建 | **引擎内置**（最大收益，省 3–5 天自研 + 后续维护） | 自建（memoize+rev 约 100–200 行） | 自建（同左） |
| three.js 视口联动 | 已自建（click→事件） | click→事件（同左） | onClick→事件（同左） | onNodeSelected 回调（同左） |
| 新增框架成本 | 无 | 选 React/Vue 渲染插件（一次性） | React（硬依赖） | 无 |
| 总体 | 继续在 x6 上加码 | **重写渲染层，换来引擎缓存**（约 1–2 周） | 重写 + 引入 React + 自建引擎（约 2–3 周） | 渲染迁移最少，但需 fork 维护 + 自建缓存 + 核实许可（约 1–2 周 + 长期维护风险） |

要点：三种替代都要求「重写节点渲染层」（x6 的模型/事件代码可部分复用），而只有 rete 能同时把**缓存引擎**也带进来；litegraph 迁移渲染最快但把「维护 + 缓存 + 许可」三项成本转嫁给你。

---

## 4. 关键技术点：JS 生态的节点缓存机制怎么实现，谁最成熟

JS 节点图生态里没有统一缓存标准，常见四种做法：

1. **拉取式 dataflow + 每节点输出缓存 + 拓扑失效（最贴近 Houdini 语义，且已有成熟实现）**
   - 代表：rete-engine `Dataflow`。每个节点输出存 `Map<nodeId, output>`；`fetch(target)` 从目标反向取数，缓存命中则不重算；连接（拓扑）变化时自动清「该节点及其全部前驱」的缓存；参数/属性变化时显式 `resetCache(nodeId)` 失效。
   - 效果：拓扑不变 + 参数未动 → 零重算；只有「输入或连接变化」才触发重算，正好对应需求「输入变化才重算」。
   - **这是 JS 生态里唯一内置、有文档的现成实现。**

2. **输入签名 memoize（自建标准方案，~100–200 行）**
   - 每个节点持有 `rev`（或输入哈希）；上游输出变化时递增并广播 rev；节点仅在「输入 rev 变化」时重算并更新自己的输出与 rev。适合纯函数节点；与 xyflow/vue-flow/litegraph 等纯渲染库组合使用。

3. **脏标记 + 拓扑序重算（自建）**
   - 任何变更先沿下游标记 dirty，再按拓扑序只重算 dirty 子图。ComfyUI 的「输入变化才重算」实际就是这种：后端对 workflow prompt 做 diff，只重跑变更分支——**但实现在 Python 后端，前端 litegraph 库本身没有**。

4. **引用计数 / 资源生命周期（缓存之外的另一层）**
   - 针对 three.js 几何体/材质等 GPU 资源：节点失效/删除时引用计数归零才 `dispose()`。rete/litegraph/xyflow 均无内置，需自建；与「计算缓存」是正交问题。

**结论：计算缓存最成熟的是 rete-engine（内置、文档化）；其次是 ComfyUI 生态（但缓存在后端，前端拿不到）；其余所有渲染类库（x6/xyflow/vue-flow/litegraph/cytoscape/logicflow/drawflow/jsplumb）都无内置，只能按方案 2/3 自建。** 这也是把 rete 列为首选的决定性理由。

---

## 附录：未精确核验项（建议选型阶段补齐）

- @comfyorg/litegraph 与 ComfyUI_frontend 的最终 LICENSE（GitHub org 页显示 GPL-3.0，部分页面称 Apache-2.0，需以仓库 LICENSE 文件为准）。
- vue-flow / n8n / Node-RED / comfyui-frontend 的精确 stars（不影响结论）。
- rete 社区第三方搜索/面板插件现状（无官方插件，建议自建）。
- LogicFlow 2025 年 commit 的具体频率（半维护判断基于 npm 发布停留在 2023-11 与零星 commit）。
