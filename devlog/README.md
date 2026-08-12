# Cyl1nder Devlog 索引

> Cyl1nder 的开发日志目录/字典。新增改动时：详细条目追加到对应专题文件，并在「最近版本」更新一行。

## 关键理念（项目定位，写入即铁律）
- **中间站不是 DCC**：Cyl1nder 只做数据进 / 可视化 / 编辑 / 数据出，不重复造 DCC 轮子。
- **最大限度复用现成库**：Three.js / rete.js / FastAPI / FastMCP / Vite / pytest / vitest 直接上。
- **轻量化 + 良好文件结构 = 省 token**：小文件、按域分目录、机器生成索引、按主题读 devlog。
- **热更新优先**：web=Vite HMR；Houdini=Python HDA 免重启；C++ 只在热路径需要时上（沿用 HDK 经验）。
- **Python 是通用语言，JS 发挥前端优势**：Python 控制总线（Houdini/桥/MCP），JS 做渲染与交互。
- **单桥 + 序列号路由**：一个端口 8375，按 serial 路由，不是每 HDA 一端口。
- **创建即不可变序列号**：创建瞬间生成、持久化、绝不 cook 时现算。

## 字典
| 主题 | 文件 |
|---|---|
| 新 agent 快速入口（先读） | [AGENT_QUICKSTART.md](AGENT_QUICKSTART.md) |
| 开发规范 / 分支 / 版本号 | [development-standards.md](development-standards.md) |
| 关键决策（含端口 grill 纠正） | [decisions.md](decisions.md) |
| 通信协议（REST/WS/MCP） | [protocol.md](protocol.md) |
| 函数索引（机器生成） | [FUNCTION_INDEX.md](FUNCTION_INDEX.md)（`node scripts/gen-index.mjs`） |
| 模块依赖图（机器生成） | [MODULE_GRAPH.md](MODULE_GRAPH.md)（`node scripts/gen-graph.mjs`） |
| API 索引（机器生成） | [API_INDEX.md](API_INDEX.md)（`node scripts/gen-api-index.mjs`） |
| 桥子系统改动标注 | [annotations-bridge.md](annotations-bridge.md) |
| HDA 子系统改动标注 | [annotations-hda.md](annotations-hda.md) |
| Web 子系统改动标注 | [annotations-web.md](annotations-web.md) |
| HDA 热重载手册（免重启） | [hda-hot-reload.md](hda-hot-reload.md) |
| 临时开发场景日志 | [temp-scene-log.md](temp-scene-log.md) |
| 同步架构与脏几何教训 | [sync-architecture.md](sync-architecture.md) |
| livelink 级同步路线图 | [livelink-roadmap.md](livelink-roadmap.md) |
| AHS 约定提炼（拆分/并行/验证/选型） | [ahs-conventions.md](ahs-conventions.md) |
| Agent 代码库检索流程/函数引导/结构 | [agent-codebase-guide.md](agent-codebase-guide.md) |
| Zeno 技术遗产调研 | [zeno-legacy.md](zeno-legacy.md) |
| Zeno 代码检索指引字典 | [zeno-guide.md](zeno-guide.md) |
| HDA Core 方案讨论（CPP vs 本地原生） | [hda-core-cpp-discussion.md](hda-core-cpp-discussion.md) |
| 流式方案B落地设计（snapshot+delta / sidecar core） | [streaming-plan-b.md](streaming-plan-b.md) |
| Zeno 技术遗产·算法索引 | [zeno/README.md](zeno/README.md)（算法全表：[zeno/algorithms.md](zeno/algorithms.md)） |
| 节点网格 Houdini 化（调研+实现） | [node-graph-houdini.md](node-graph-houdini.md) |
| 节点库选型调研（20+ 候选，rete.js 2 推荐） | [node-library-research.md](node-library-research.md) |
| HDA runtime 优化调研（一次 cook 多输出可行性） | [hda-runtime-optimization.md](hda-runtime-optimization.md) |
| HDK 多输出论坛调研（官方/社区证据） | [hdk-multi-output-forum.md](hdk-multi-output-forum.md) |
| JS 技术栈选型（three.js + rete.js 性价比） | [js-stack-research.md](js-stack-research.md) |
| 统一路径 + 文件快照系统设计 | [snapshot-design.md](snapshot-design.md) |
| 场景快照调研（rete 序列化 / React Flow / ComfyUI 参考 / schema v2） | [scene-snapshot-research.md](scene-snapshot-research.md) |
| 快捷键（分类记录） | [shortcuts.md](shortcuts.md) |
| 视口显示踩坑记录（poly/线框/模式菜单/相机） | [viewport-bug-report.md](viewport-bug-report.md) |
| 节点视图 MCP 调试工具报告 | [nodeview-mcp-report.md](nodeview-mcp-report.md) |
| 视口显示模式 / Param 面板 MCP 通道调研 | [mcp-channel-proposals.md](mcp-channel-proposals.md) |
| bridge⇄HDA 流式落地现状调研 | [streaming-hda-review.md](streaming-hda-review.md) |
| 快速传输技术栈评估（WASM/串流/本地通信） | [transport-tech-evaluation.md](transport-tech-evaluation.md) |
| Parm 参数面板系统设计（对标 Houdini，仅设计） | [parm-system-design.md](parm-system-design.md) |
| bridge⇄HDA 同步差值根因与改进优先级 | [streaming-sync-gap.md](streaming-sync-gap.md) |
| Params 面板用户手册（中键 scrubbing / Ctrl+中键默认值 / 撤销） | [params-user-guide.md](params-user-guide.md) |
| 流式推送 dirty + 内存缓存方案讨论 | [streaming-push-dirty.md](streaming-push-dirty.md) |
| Houdini Python Runtime 接口设计 + transform 流式 panel 原型 | [python-runtime-design.md](python-runtime-design.md) |

## 关键词 → 专题文件（快速跳读）

| 关键词 | 去哪看 |
|---|---|
| serial / 序列号 | `bridge/bridge/registry.py` · devlog/decisions.md |
| 单桥 8375 / 端口模型 | devlog/decisions.md（grill 纠正） |
| 协议 / inputs/outputs / WS 消息 | devlog/protocol.md · bridge/bridge/protocol.py · web/src/protocol/types.ts |
| 反馈回路 / 回显去重 / 30fps 同步 | devlog/annotations-hda.md · devlog/sync-architecture.md |
| 脏几何 / 内容对比自愈 | devlog/sync-architecture.md |
| livelink / 延迟 / 位置流式 | devlog/livelink-roadmap.md |
| auto-run / 回放 / 输入门控 | web/src/main.ts · web/src/protocol/compare.ts · devlog/annotations-web.md |
| 热重载（三层） | devlog/hda-hot-reload.md · hda/scripts/reload_hda.py |
| 官方 fxhoudinimcp / Houdini MCP | mcp/README.md · devlog/development-standards.md（调试规范） |
| 临时现场（hip/serial/端口） | devlog/temp-scene-log.md |
| 索引生成器 / 版本号 | scripts/gen-index.mjs · scripts/bump-version.mjs |
| 前端选型 / three.js vs Zeno | devlog/zeno-legacy.md · devlog/ahs-conventions.md |
| Agent 检索流程 / 项目结构 | devlog/agent-codebase-guide.md |
| 流式 / snapshot+delta | devlog/streaming-plan-b.md |
| 布局 / Default.json / docking | web/src/app/layouts/Default.json · web/src/app/dock.ts · devlog/annotations-web.md |
| 无头线段 / 孤立连接 | web/src/nodes2/graph.ts（restoreGraph 先清连接）· devlog/annotations-web.md |
| 视口显示模式菜单 / 相机位移 | web/src/viewport/renderer.ts · web/src/viewport/controls.ts · devlog/viewport-bug-report.md |
| 节点状态 chip（D/R/B/F） | web/src/nodes2/NodeView.tsx · web/src/styles/nodeview.css |
| nodeview MCP 工具 | scripts/cyl_debug.py nodeview <serial> · bridge/bridge/mcp_server.py · devlog/nodeview-mcp-report.md |
| 并行修改规范（子智能体） | devlog/development-standards.md（「并行修改规范」章节） |
| 编码规范 / 中文乱码 / git 历史清理 | devlog/development-standards.md（「编码与 Git 卫生」章节） |
| Spreadsheet / 层级持久 / 列宽 | web/src/app/spreadsheet.ts · web/src/styles/spreadsheet.css · devlog/annotations-web.md |
| 选中节点 / Spreadsheet·Param 跟随 | web/src/main.ts（refreshSelectionPanels）· web/src/app/spreadsheet.ts · web/src/app/param.ts · web/src/nodes2/graph.ts（getSelectedNode） |
| 显示模式默认 / displaySettings | web/src/viewport/renderer.ts · web/src/app/layouts/Default.json · web/src/app/main.ts（getDockJson） |
| three.js gizmo / TransformControls | web/src/viewport/renderer.ts（toggleGizmoDemo，G/Shift+G） |

## 最近版本
- v0.1.00053：左上角品牌点击跳转 /overview.html；非当前 tab 配色饱和度 -0.1/亮度 +0.1（更亮更灰）。
- v0.1.00052：2 路并行（Descartes/Archimedes）——HDA 自适应轮询(活跃 33ms/空闲 500ms，流量大降)；kick 踹 HDA(首连 web 触发，force 强制 recook + last_error 自愈，解决首拉桥后 HDA 显示 offline)；/stream 长轮询取代轮询计划(NDJSON，仅计划)；smoke 测试加固(__cylStore 完整日志)。
- v0.1.00051：4 路并行（Hegel/Socrates/Banach/Huygens）——Overview 默认入口重定向 + 新建置顶 + 离线/未cook 三态 + 清理无效场景；bridge lastActivity + /api/scenes/cleanup；HDA 就绪缓冲+缓存-直到输入变化+位置快速路径（20fps→60fps 级，hython 实测）；Houdini python runtime 接口设计 + transform 流式 panel 原型（含 Apex Animation Layer 最终目标）；streaming-sync-gap §8。
- v0.1.00050：4 路并行（Turing/Halley/Pauli/Darwin）——Enter 模式跟随选中节点(无 transform 时 gizmo idle)；File/Layout 菜单点击关闭、Open Scene 改名 Reload、真正 Open Scene/Save Scene As(FS Access 保存整个 serial 文件夹+同名覆盖确认)、Overview 菜单入口；新增 /overview.html 总管页(活跃/历史/新建场景，无 Houdini 可开)；bridge 场景端点(api/scenes 列表/新建/open/save)+最小 usdz 导出(usda+zipfile 零依赖)；流式推送 dirty 讨论(streaming-push-dirty.md)。
- v0.1.00049：3 路并行（Godel/Tesla/Bacon）——tab 底部圆角抗锯齿软边(1.0px 带, 半径 3.5px)；中键 scrubbing 重做(鼠标为浮层中点/出框锁定/灵敏度减半/轨迹归一化)；Ctrl+中键恢复默认值+transform 参数默认值；parms 数值修改进撤销系统(params undo)；Log 新增 Parameter 类；viewport 真正读取节点 geo(computeNodeResult+showNodeResult, display null/transform 显示链路真实输出几何)；新建 Params 用户手册。
- v0.1.00048：3 路并行（Mill/Hooke/Aquinas）——tab 底部圆角边界曲线镜像到对角线另一侧(起点/终点不变、填充减小)；transform display 看不见 box 根因=端口解析不追链，新增 resolveInputSourcePort 链式解析统一 null/transform；重命名双击命中区收缩到名字+20ch 省略号；shake 参数定稿(24点/1000ms/4px/≥3反向)；Enter 状态保持(点节点不变)+Enter 键仅悬停 viewport 时进入/取消。
- v0.1.00047：4 路并行（Faraday/Copernicus/Feynman/Kierkegaard）——tab 底部圆角再翻转+小填充(4px 小脚)；预览虚线对齐端口圆圈中心；shake 判定放宽(1000ms/24点/4px)；graph 字体不可选中；禁止自连(connectioncreate 中央守卫)；端口拖线不触发插入预览；transform 加 Pivot Translate(px/py/pz)+gizmo 标记跟随 pivot；断开后视口刷新(display 无输入→隐藏全部端口)；bridge 流式同步根因调研(streaming-sync-gap.md)。
- v0.1.00046：4 路并行（Heisenberg/Ramanujan/Hypatia/Herschel）——dock 标签底角圆角方向翻转到斜线下半段 + tab 间隔 +2px；插入预览端点改跟被拖节点端口(IN/OUT)+拖动实时刷新+z-index 在节点后；甩出节点自动愈合连线(原端口直连)；param 中键拖拽倍率 scrubbing(7 行倍率浮层)；viewport 左图标工具栏 + Enter 激活模式(transform gizmo 联动 tx/ty/tz)。
- v0.1.00045：3 路并行（Pascal/Russell/Noether）——dock 活动标签改 Chrome 打开态（底边平直+底部外凸圆角伪元素）；插入预览改黄色虚线流动曲线（同曲率贝塞尔）；Y 划线轨迹修复（overlay SVG 300×150 视口裁剪根因）；一次划线多段切断=单次撤销(cut-many)；transform 支持拖拽快捷插入(isInsertable 1入1出)；parm 面板系统设计文档(仅设计)。
- v0.1.00044：7 路并行（Kepler/Popper/Pasteur/Dalton/Dewey/Poincare/Bernoulli）——视口 Alt+RMB 归一化 + F-frame 保持视角；Spreadsheet 列改名(ptnum/primnum/primpoints)+条纹降饱和；dock 标签底角外凸缺口匹配+`+`右移；组处理系统(groups.ts)、transform 节点+可编辑 Param、Y 划线多段、撤销系统(Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y)、插入重合整理、network.ts 网络计算。
- v0.1.00043：快速传输技术栈评估——WS 保持主通道，WebTransport 列为 v0.3+ 备选（保留 WS fallback）；B2 起启用 proto=msgpack（1.5-2x 于 JSON）；zstd/Draco 按需叠加；最大亮点 = B2 Rust core 一份代码双端复用（bridge sidecar + web wasm），消除 M5 fuzz 对拍漂移；动捕级再上 WebGPU compute + WASM threads（需 COOP/COEP）；明确不做：WebRTC DataChannel / 视频串流 / HDA 引 WS。
- v0.1.00042：6 路并行（写集拆分后 Lovelace/Meitner/Newton/Ptolemy + Planck/Gibbs/Kuhn）：spreadsheet 跟随选中节点（null→in0 源端口、多选取第一个）+ label 覆盖 + vertnum/primnum + 填充列/补空行 + 更暗斑马；docking 活动标签改 Chrome 式完整圆角 + 相邻凹切；viewport 默认 Flat Wire Shaded + displaySettings 存取 + three.js gizmo 演示（G/Shift+G）；新增 Param 面板（默认布局带 Params 页）；MCP 新工具 viewport_settings/node_params + 通道调研；bridge⇄HDA 流式现状调研（方案 B 未开始）；main.ts 主进程接线 + 选中刷新 timing 修复（setTimeout 0）。
- v0.1.00041：修复 viewport-bug-report / annotations-web 首行合并（PowerShell git show 数组未 -join 换行）；编码/数组坑 + git 历史卫生写入 development-standards；根 README（x6→rete、版本格式）与 AGENT_QUICKSTART（nodes→nodes2）过期引用同步。
- v0.1.00040：git 历史清理（filter-branch 替换 devlog/README.md 巨 blob，.git 69MB→2MB，--force-with-lease 推送成功）；恢复 5 个被管道编码写坏的 devlog 文件（README/annotations-web/viewport-bug-report/shortcuts/temp-scene-log）。
- v0.1.00039：spreadsheet.css 再拆分 + 4 路并行（Bacon/McClintock/Noether/James）：spreadsheet display-focus 过滤（null/_input_ 只显对应源）、层级持久（不因刷新回 point）、行交替深蓝、ptnum 窄列 int + P 每分量 10ch + 科学计数、标题栏漏缝修复；视口补 Unlit Shaded/Unlit Wire Shaded 对（Shift+W），Wireframe Ghost 面 0.2（80% 透明）；节点改名修复（rete remount 吞 dblclick → 手动 pointerdown 检测 + 模块级状态）+ 究极尾号去重（foo→foo1…）+ 毛玻璃 blur12px/明度+0.1；docking 标签上半圆角下半反圆角、活动深蓝、+ 跟随标签右移、标签栏滚轮横滚、✕ 固定右侧关闭整个 group、全局深色滚动条；并行修改规范写入 development-standards.md。
- v0.1.00038：CSS 按域拆分（base/nodeview/viewport/dock）支持并行；相机 dolly 重写（焦距固定、无 NaN、0.05~500 钳制，修复贴原点拉不回+滚轮横跳）；显示模式 7 档（Smooth/Flat Shaded + Wire 对、Unlit Wire Shaded、Wireframe #CCCBBA、Wireframe Ghost，W/Shift+W 切换）；nodeview LMB 不平移（只框选）、按住 Y 拖红线切连线、甩动节点断联+就近自动重连；节点毛玻璃 0.5 + chip 间隔线；docking 圆角标签 + `+` 添加独立实例面板（5 种）。
- v0.1.00037：Default.json（项目内布局，默认启动，修 dockview 加载时序/内容掉挂）；显示模式菜单 position:fixed + 单击持久/拖动应用；视口相机改真位移（dolly 非 fov fake）；_input_/_output_ display 只显示第一端口；右上 4 状态按钮方形贴角（14x14）；display 蓝优先级高于选中黄；修复 4 条无头线段（restoreGraph 先清孤立连接 + serialize 防御过滤）；MCP/调试钩子 __cylDv/__cylViewport。
- v0.1.00036：菜单栏防选中；wire 黑 + 显示模式按住下拉；nodeview LMB 框选多选；Display 走节点右上角（restoreGraph 强制单 display）；右上 4 按钮无缝纯色；MCP nodeview 工具 4 个。
- v0.1.00035：菜单栏（File Open/Save/As + Layout 预设/Save/Reload，Documents\Cyl1nder\Layouts）；Log 五档过滤；Tab 节点建在鼠标附近；悬停淡黄/选中黄；节点头部重构（双击改名 + 4 状态 chip 右往左 D/R/B/F）；统一 0.4 灰面 + 黑 wire。
- v0.1.00034：viewport 显示修复（null display 只显示穿过该 null 的输入段，output 无数据不 fallback，消除重叠伪影）；debug 访问流程（cyl_debug.py + MCP read_snapshot/read_layout）。
- v0.1.00033：快照 v2（io/scene/docking-layout.json 固定格式，无 serial 前缀）；节点图 serialize/restore round-trip；docking 保存；node-parm 预留。
- v0.1.00032：Desk1 程序化布局（显式位置不塌缩）；null 命名 null1 + 冲突递增；display 支持 null（passthrough 显示输入段）；geo 连线朱红（CSS）；场景快照调研（rete serialize/ReactFlow/ComfyUI 参考）。