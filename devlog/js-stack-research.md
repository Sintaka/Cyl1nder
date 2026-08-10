# three.js + rete.js 前端技术栈选型调研报告（Cyl1nder 项目参考）

> 调研日期：2026-08-10（外网为主：GitHub / three.js 论坛 / HN / dev.to / 个人博客，已避开 CSDN 等国内站点）
> 结论一句话：对「单人 + agent 开发、Vite+TS、轻量省 token、MIT 优先」的 Cyl1nder Houdini⇄WebGL 中间站，**three.js + rete.js 2 是划算的组合，推荐保留**；核心前提是「节点图 JSON 作为契约 + 与执行引擎解耦 + three.js 视口用分屏/事件联动」，并且不引入 React。

---

## 一、结论摘要

1. **性价比判定：划算，但要把 rete 当「轻量框架 + 少量自研胶水」而非「开箱即用的画布」。**
   - rete.js v2 是框架无关的纯 TS（核心包 221 kB 未压缩、零框架依赖），Vite+TS 下直接可用，不需要 React/Vue，天然契合「省 token、轻量、MIT」约束。
   - three.js 与 rete 都是 DOM/TS 友好：分屏布局（左节点图 + 右 three.js 视口）就是 flex + 事件联动，胶水代码量很小；rete 官方还提供 MIT 的 `rete-area-3d-plugin`（基于 three.js CSS3DRenderer + WebGLRenderer）作为把节点嵌入 3D 场景的可选方案。
   - 已跑通 rete.js 2 原型 = 已支付大部分学习/集成成本，继续投入的边际成本低；换回 X6 或改 React Flow 反而要重付框架成本（React 体系）与迁移成本。

2. **与 React Flow / litegraph 的对比要点：**
   - **React Flow（@xyflow/react）**：生态与维护遥遥领先（约 3 万+ star、月下载数百万、活跃维护、ARIA/键盘无障碍、Pro 商业层但核心 MIT），是最成熟的选择；**代价是强制 React**，且生产级编辑器需要 Provider 堆叠、细分状态 store、快照 undo 等大量配套工程（见 Auxx 与 ByteChef 两篇实战文章）——对「省 token、轻量、单人」是显著负担。
   - **litegraph.js**：ComfyUI 前端（Vue 3 + LiteGraph fork + Canvas/DOM 双渲染）证明其能支撑数千节点规模；但原库（jagenjo）维护弱，Comfy-Org 的 fork 已于 2025-08 并入 ComfyUI_frontend 仓库不再单独维护，Canvas2D 渲染与 DOM UI 割裂，几乎必须自维护 fork——不适合想省维护的小项目。
   - **rete.js 2**：定位是「视觉编程框架」而非通用画布，自带 Dataflow/ControlFlow 引擎（`rete-engine`）与插件体系（area/connection/comment/auto-arrange/3d 等）；缺点是社区小、无障碍差、2025-2026 迭代放缓（v2.0.6 于 2025-06 发布后趋缓），自定义节点数量多时性能下降（GitHub issue #628：150+ 自定义节点卡顿、#406：数千节点吃力）。
   - **三者都是 MIT**，许可证不构成差异；GoJS（商业授权）才需要避开。

3. **three.js 作为节点图视口的案例生态：**
   - 官方路线：rete 的 3D 指南/插件（节点以原生 HTML 形态活在 3D 场景中）。
   - 现实主流：社区几乎都是「自研/拼装」——three.js 官方 NodeEditor（PR #25692，three.js 仓库自带）、takahirox/tsl-node-editor（自研 + WebGPU 预览）、NodeToy（R3F 着色器图）、Nodysseus（自研 VPL + three.js 绑定）、behave-graph（three.js 作者维护的行为图引擎，UI 常用 React Flow 的 behave-flow）、featherEngine（R3F 视口 + 节点脚本编辑器）。
   - **没有发现「rete + three.js 分屏联动」的知名生产案例**，但存在高度同构的真实产品：Bitbybit（OCCT 过程几何 + three.js 视口 + Rete v2 可视化脚本，节点 JSON 可导出到独立网页执行并联动 3D 预览）。结论：这层组合没有先例背书，但技术上明确可行，胶水由自己写。

4. **主要风险与对冲：**
   - 维护放缓（12k star / 月下载约 7 万 / 最近一次核心发版 2025-06）→ 锁定 v2.x 语义化版本、把节点定义做进 registry、以「图 JSON 契约」隔离渲染层，保留将来迁移 React Flow / X6 的抽象边界。
   - 节点数控制在百级（Cyl1nder 作为 Houdini 镜像/预览工具通常远低于此），避开自定义节点渲染的性能坑。
   - 不追 rete-area-3d-plugin 的「节点进 3D」路线：它演示的是节点漂浮在 3D 场景里，与「分屏 + 视口联动」诉求不同，后者更简单、可控、省 token。

---

## 二、关键文章发现（标题 + 链接 + 要点）

### 1. Rete.js 官方 3D 指南 —— 官方 three.js 集成方案
- 链接：https://retejs.org/docs/guides/3d/ （示例：https://retejs.org/examples/3d/ ，插件：https://github.com/retejs/area-3d-plugin）
- 要点：`rete-area-3d-plugin`（MIT）用 three.js 的 CSS3DRenderer + WebGLRenderer 把原生 HTML 节点渲染进 3D 场景，保留节点交互；可拿到 `scene / camera / OrbitControls` 做场景管理，支持多个编辑器共享一个场景。说明 rete 官方把 three.js 当一等公民，且插件机制允许「自定义节点几何」——但它是「节点进 3D 场景」路线，不是分屏路线。

### 2. Shuttersense：Pipeline Visual Graph Editor 选型记录（GitHub Issue #171，2026-02）
- 链接：https://github.com/fabrice-guiot/shuttersense/issues/171
- 要点：真实小团队评估 6 个库（React Flow / Rete.js / Flume / React Diagrams / Butterfly / Drawflow）后选 React Flow。对比表摘录：React Flow 35K+ star、约 2.7M 周下载、积极维护、有 ARIA/键盘导航、4 种内置边型；Rete.js 12K star、约 15K 周下载、无障碍 minimal、2 种边型；两者皆 MIT。这是「为什么别人选了 React Flow 而非 Rete」最直接的反方证据，也恰好量化了二者的社区差距。

### 3. Auxx.ai：Building a Visual Workflow Engine (Part 1): The Editor（2025-09）
- 链接：https://auxx.ai/blog/workflows-part-1-visual-editor
- 要点：生产团队用 React Flow 建 30+ 节点类型的编辑器，最终结构是 7 层 Provider、12 个 Zustand store、事件总线、快照式 undo、debounced 保存。核心架构观点：「编辑器与执行引擎解耦，JSON 图是唯一契约」，这正应作为 Cyl1nder 的架构模板；同时反面印证 React Flow 的 re-render 成本迫使做大量细粒度 store 优化——对省 token 的小团队不友好。

### 4. Bitbybit：Building a 3D Table Configurator with Rete & Bitbybit Runner（rete + three.js 最同构的真实案例）
- 链接：https://learn.bitbybit.dev/learn/runners/table-configurator-rete
- 要点：Bitbybit 是 OCCT(OpenCascade) 过程几何 + three.js 视口的 Web CAD 平台，教程用 Rete v2 写可视化脚本（JSON 里可见 `bitbybit.occt.shapes.solid.createBox`、`translate`、math/logic 节点），并「Export to Runner」导出为独立网页执行、联动 3D 交互预览。证明「rete 节点图 + three.js 视口 + Houdini 式过程几何」在真实产品可行，且纯 JS、无 UI 框架。

### 5. ComfyUI Frontend 技术栈概览（DeepWiki）
- 链接：https://deepwiki.com/Comfy-Org/ComfyUI_frontend/1-overview （双渲染架构：https://deepwiki.com/Comfy-Org/ComfyUI_frontend/2.5-dual-rendering-architecture）
- 要点：规模最大的开源节点编辑器之一 = Vue 3 + LiteGraph 自研 fork + Canvas/DOM 双渲染。反证两点：① litegraph 原库维护弱、Comfy 的 fork 已于 2025-08 合并进 ComfyUI_frontend 不再单独维护（https://github.com/Comfy-Org/litegraph.js/issues/1196）；② 大型项目最终都走向「自维护 fork + 混合渲染」，说明把引擎与 UI 解耦、自研 UI 层是常态而非特例。

### 6. three.js 官方论坛：Node editor for TSL（社区实践）
- 链接：https://discourse.threejs.org/t/node-editor-for-tsl/76355
- 要点：做 three.js 节点编辑器的人多数自研或改 nodl；作者 bhushan6 明说 nodl「基本不维护，内部 clone 后自用」。结合 takahirox/tsl-node-editor（自研 + WebGPU 预览 + 导出）与 Nodysseus（自研 VPL + three.js 绑定），结论是 three.js 生态没有公认维护良好的通用节点库，拼装/自研是常态——与「rete 需要少量自研胶水」的判断一致。

### 7. Hacker News：Rete.js 2 stable（社区反应）
- 链接：https://news.ycombinator.com/item?id=36702644
- 要点：发布帖热度很低（2 points、3 条评论）；唯一实质反馈是 UX 吐槽：「示例交互方向让人困惑、为什么有些节点连不上、右键菜单关闭有明显卡顿」。说明 rete 的交互打磨与文档示例弱于 React Flow，正式发布后社区声量有限。

### 8. ByteChef：Rendering the Infinite: Workflow Canvas Optimization（2026-04）
- 链接：https://blog.bytechef.io/blogs/rendering-the-infinite-workflow-canvas-optimization
- 要点：React Flow 性能实战：视口剔除免费获得；50+ 节点后必须做 memo/useShallow、结构指纹跳过无谓 Dagre 布局、异步布局竞态取消、maxZoom 上限等。量化了「React Flow 也不是免优化」——任何 DOM 节点画布到一定规模都要付出工程成本。

### 9. xyflow/awesome-node-based-uis（节点 UI 库全景索引）
- 链接：https://github.com/xyflow/awesome-node-based-uis
- 要点：社区维护的节点 UI 资源清单（litegraph.js / React Flow / Svelte Flow / vue-flow / rete / reaflow / behave-graph / flume / X6 等），可作为选型总览与后续 devlog 引用。

---

## 三、three.js + rete.js 性价比评估表（相对约束：单人+agent、轻量省 token、MIT 优先、中小型中间站）

| 维度 | three.js + rete.js 2 | React Flow (@xyflow/react) | litegraph.js | 说明 / 来源 |
|---|---|---|---|---|
| 框架成本（引入 React 与否） | 低：纯 TS，无框架依赖，Vite 直接接 | 高：强制 React（React + 周边生态、JSX/Provider 心智、打包体积） | 低：无框架依赖，Canvas2D | rete 核心 221 kB 未压缩、无框架；React Flow 需要整条 React 链 |
| 视觉编程能力（数据流/控制流） | 强：内置 `rete-engine`（Dataflow/ControlFlow），插件体系完善 | 中：只做渲染，执行引擎自建 | 中：自带简单引擎，但紧密耦合 | 对 Houdini 式图语义，rete 开箱能力最强 |
| three.js 集成 | 官方 3D 插件（MIT，CSS3D+WebGL 双渲染）；分屏联动自行拼装（成本低） | 无官方 3D；通常 R3F 组合，仍需自拼 | 无官方 3D；WebGLStudio 是 litegraph+LiteScene 先例，但属自研 | 分屏 = flex + 事件联动，与库无关 |
| 社区规模 / 维护 | 12k star，月下载约 7 万；核心 v2.0.6（2025-06）后趋缓（bestofjs：last commit ~10 个月前；deps.dev 维护分 0/10） | 约 3 万+ star，月下载数百万，活跃；Pro 商业层，核心 MIT | 原库约 7k star，维护弱；Comfy 自 fork 才活跃 | 见文章 2、5 |
| 性能上限 | 默认渲染 OK；自定义 DOM 节点 150+ 开始卡（issue #628），数千节点吃力（#406）；官方有性能/LOD 示例 | 视口剔除免费；50+ 节点后需 memo/store 细分/布局优化（ByteChef/Auxx） | 支撑 ComfyUI 数千节点，但靠大 fork + 双渲染 | 对 Cyl1nder 镜像/预览规模（<200 节点）均够用 |
| 无障碍 / 交互打磨 | 弱（minimal ARIA；HN 反馈连线方向困惑、右键卡顿） | 强（ARIA、键盘导航） | 弱（Canvas2D） | 见文章 2、7 |
| 许可证 | MIT | MIT（Pro 付费层为可选增强） | MIT | 三选一不冲突 |
| 迁移成本（从 X6 换入） | 已跑通原型，边际成本低；保留图 JSON 契约可继续隔离 | 需引入 React 体系，重写节点组件 | Canvas 渲染风格迥异，UI 侧几乎全重写 | X6 为 SVG/HTML 通用画布，rete 为框架化视觉编程，迁移最顺 |
| 适合场景 | 节点图即产品核心、过程式/数据流语义、3D 视口联动 | 通用工作流/图表产品、React 团队、需要大生态兜底 | 大图规模、愿意自维护 fork | — |

**综合评分（1-5）：** three.js + rete.js：框架成本 5、视觉编程 5、three 集成 4、维护 3、性能 3.5、无障碍 2、总体适合度 **4.5/5（对 Cyl1nder 约束）**；React Flow：适合度 3/5（React 硬伤 + 配套工程重）；litegraph：适合度 2.5/5（维护与 DOM UI 割裂）。

---

## 四、建议

1. **维持「Vite + TS + rete.js 2」路线，不要为节点图引入 React。** 图编辑由 rete 负责（framework-agnostic），3D 视口用独立 three.js canvas + OrbitControls，二者用 flex 分屏 + 事件总线联动（节点选中/参数变更 → 刷新视口；相机变化不回灌），胶水预计几百行内可完成。
2. **不采用 `rete-area-3d-plugin` 的「节点进 3D 场景」作为主方案**（它是节点漂浮在 3D 场景内的演示路线，与分屏诉求不同，且该插件小众、验证少）；如需炫技可作为备选，但分屏更简单可控、更省 token。
3. **架构上以「图 JSON」为唯一契约**：rete 只负责编辑与导出 JSON（类似 Bitbybit 的 `rete-v2-json` / "Export to Runner" 思路），执行留在 Houdini 侧；若日后需要前端执行，再按需引入 `rete-engine` 的 DataflowEngine/ControlFlowEngine。节点类型做成 registry，隔离渲染细节。
4. **锁定 rete v2.x 语义化版本并设好迁移边界**：rete 维护已放缓，靠「registry + JSON 契约」把 rete 隔离在渲染层，未来若社区彻底停滞，可低成本迁移到 React Flow / X6（保留同构的图模型即可）。
5. **节点规模控制在百级内**，自定义节点组件保持轻量，避开 issue #628/#406 的性能坑；正式发布前补一轮交互细节（连线方向提示、右键菜单延迟），对应 HN 反馈的短板。
6. **devlog 精选参考资料（5 篇）：**
   - Rete.js 官方 3D 指南（rete + three.js 官方集成）→ https://retejs.org/docs/guides/3d/
   - Shuttersense 选型记录（React Flow vs Rete 量化对比表）→ https://github.com/fabrice-guiot/shuttersense/issues/171
   - Bitbybit 3D 配置器教程（rete + OCCT + three.js 真实产品）→ https://learn.bitbybit.dev/learn/runners/table-configurator-rete
   - Auxx.ai 可视化工作流引擎 Part 1（React Flow 生产架构，含「图 JSON 契约」范式）→ https://auxx.ai/blog/workflows-part-1-visual-editor
   - ComfyUI Frontend 概览（Vue3 + LiteGraph fork 的双渲染架构与维护现状）→ https://deepwiki.com/Comfy-Org/ComfyUI_frontend/1-overview