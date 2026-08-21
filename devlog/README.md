# Cyl1nder Devlog 索引

> Cyl1nder 的开发日志目录/字典。新增改动时：详细条目追加到对应专题文件，并在「最近版本」更新一行。

## 关键理念（项目定位，写入即铁律）
- **中间站不是 DCC**：Cyl1nder 只做数据进 / 可视化 / 编辑 / 数据出，不重复造 DCC 轮子。
- **最大限度复用现成库**：Three.js / rete.js / FastAPI / FastMCP / Vite / pytest / vitest 直接上。
- **轻量化 + 良好文件结构 = 省 token**：小文件、按域分目录、机器生成索引、按主题读 devlog。
- **热更新优先**：web=Vite HMR；Houdini=Python HDA 免重启；C++ 只在热路径需要时上（沿用 HDK 经验）。
- **Python 是通用语言，JS 发挥前端优势**：Python 控制总线（Houdini/桥/MCP），JS 做渲染与交互。
- **单桥 + 序列号路由**：一个端口 8375，按 serial 路由，不是每 HDA 一端口。
- **统一属性系统（v0.1.00062 起）**：属性操作（编辑/重置/颜色等）属于统一属性类型系统——float/int/string/vector/enum/color3 一律通用；如 Ctrl+中键重置、色块点开调色板等在任何类型上都生效，而不是只针对 float。
- **创建即不可变序列号**：创建瞬间生成、持久化、绝不 cook 时现算。
- **设计理念学习 Zeno + Houdini（2026-08-13 起，缓存与后端计算管理）**：Cyl1nder 的缓存/计算管理以两个参考系为准——**Houdini**：cook-on-dirty DAG（未 dirty 直接复用缓存）、显示驱动 cook（只算显示分支）、detail 缓存 + 增量更新（拓扑不变只动 P）、交互不重 cook（矩阵/增量上屏）、bgeo.sc 落盘；**Zeno（MPL-2.0）**：显式节点缓存（CachedByKey/CacheToDisk）、stamp 变化分级（none/data/topology）、双缓冲增量 diff（MapStablizer，未变对象零上传）、SoA→TypedArray 直传、帧缓存 + stampInfo 切帧。借鉴方法论与架构、不复制代码（Zeno 可借鉴；Houdini 闭源只对齐行为）。落地索引：devlog/cache-display-research.md / cache-system-guide.md / cache-lazy-stamp-round.md。
- **能用开源就用开源（2026-08-13 起）**：优先复用成熟开源库（three.js / rete / FastAPI / FastMCP / msgpack / orjson / fast-deep-equal 等，floating-ui/culori 列入候选），自研仅限协议胶水与领域专用逻辑（group 表达式、undo 回放、链缓存等无成熟等价物）；具体取舍见 devlog/oss-reuse-audit.md；引入前核对许可证兼容（本项目 Source-Available，第三方须宽松兼容）。


## 字典
| 主题 | 文件 |
|---|---|
| 新 agent 快速入口（先读） | [AGENT_QUICKSTART.md](AGENT_QUICKSTART.md) |
| **进度与计划（唯一真相，先读）** | [in-progress.md](in-progress.md) |
| 开发规范 / 分支 / 版本号 | [development-standards.md](development-standards.md) |
| **主脑行为校准（三层分流 + 每轮 Retro）** | [agent-calibration.md](agent-calibration.md) |
| **派活共享前言（子智能体先读这个）** | [SUBAGENT_BRIEF.md](SUBAGENT_BRIEF.md) |
| 关键决策（含端口 grill 纠正） | [decisions.md](decisions.md) |
| 通信协议（REST/WS/MCP） | [protocol.md](protocol.md) |
| 函数索引（机器生成） | [FUNCTION_INDEX.md](FUNCTION_INDEX.md)（`node scripts/gen-index.mjs`） |
| 模块依赖图（机器生成） | [MODULE_GRAPH.md](MODULE_GRAPH.md)（`node scripts/gen-graph.mjs`） |
| API 索引（机器生成） | [API_INDEX.md](API_INDEX.md)（`node scripts/gen-api-index.mjs`） |
| 桥子系统改动标注 | [annotations-bridge.md](annotations-bridge.md) |
| HDA 子系统改动标注 | [annotations-hda.md](annotations-hda.md) |
| Web 子系统改动标注 | [annotations-web.md](annotations-web.md) |
| HDA 热重载手册（免重启） | [hda-hot-reload.md](hda-hot-reload.md) |
| **历史调研库（已归档，非每轮必读）** | [archive/](archive/) —— zeno 系列、早期选型调研、已完成计划、版本历史等 |
| 同步信号重设计（事件驱动 + 心跳解耦） | [sync-heartbeat-redesign.md](sync-heartbeat-redesign.md) |
| 同步速率上限 + bridge 阻塞修复 + 首选项系统 | [sync-rate-limit-and-preference.md](sync-rate-limit-and-preference.md) |
| 自动保存 + 颜色系统 + 首选项浮动窗 | [autosave-color-prefs-ui.md](autosave-color-prefs-ui.md) |
| 屎山代码（legacy spaghetti）标注 | [shit-mountains.md](shit-mountains.md) |
| 重构复盘与后续建议 | [refactor-retrospective.md](refactor-retrospective.md) |
| 优化轮 00059（dock 角标重做/File 菜单/Sync 语义/Layout 框） | [optimize-round-00059.md](optimize-round-00059.md) |
| 优化轮 00060（dock 外折/点阵层级/Overview 新标签/HDA 重启恢复/视口 Undo） | [optimize-round-00060.md](optimize-round-00060.md) |
| 优化轮 00061（dock 内侧残留/菜单居中/颜色拾取器体验） | [optimize-round-00061.md](optimize-round-00061.md) |
| 优化轮 00062（HDA 崩溃根治/字体/颜色拾取器大改造） | [optimize-round-00062.md](optimize-round-00062.md) |
| AHS 约定提炼（拆分/并行/验证/选型） | [ahs-conventions.md](ahs-conventions.md) |
| Agent 代码库检索流程/函数引导/结构 | [agent-codebase-guide.md](agent-codebase-guide.md) |
| 流式方案B落地设计（状态注记：sidecar 未启动，远期参考） | [streaming-plan-b.md](streaming-plan-b.md) |
| Zeno 技术遗产·算法索引 | [zeno/README.md](zeno/README.md)（算法全表：[zeno/algorithms.md](zeno/algorithms.md)） |
| 统一路径 + 文件快照系统设计（权威，P0 已落地） | [snapshot-design.md](snapshot-design.md) |
| 快捷键（分类记录） | [shortcuts.md](shortcuts.md) |
| 视口显示踩坑记录（poly/线框/模式菜单/相机） | [viewport-bug-report.md](viewport-bug-report.md) |
| 节点视图 MCP 调试工具报告 | [nodeview-mcp-report.md](nodeview-mcp-report.md) |
| Parm 参数面板系统设计（状态注记：面板已落地） | [parm-system-design.md](parm-system-design.md) |
| Params 面板用户手册（中键 scrubbing / Ctrl+中键默认值 / 撤销） | [params-user-guide.md](params-user-guide.md) |
| 流式推送 dirty + 内存缓存方案讨论（状态注记） | [streaming-push-dirty.md](streaming-push-dirty.md) |
| Houdini Python Runtime 接口设计（状态注记：runtime 现走 fxhoudinimcp） | [python-runtime-design.md](python-runtime-design.md) |
| three.js gizmo 拖拽延迟调研（TS/three.js/WASM 澄清 + 改进方向） | [viewport-gizmo-latency.md](viewport-gizmo-latency.md) |
| 缓存与显示管理调研（Zeno stamp/双缓冲 vs Houdini cook/detail 缓存 + 可借鉴清单） | [cache-display-research.md](cache-display-research.md) |
| 缓存系统交接指引（给新会话：现状/路线/契约/先读） | [cache-system-guide.md](cache-system-guide.md) |
| 视口中断系统重设计 + 本地新鲜度 + kick 限流 | [viewport-interrupt-redesign.md](viewport-interrupt-redesign.md) |
| 时间轴实施计划（本地 scrub → 手动同步开关 → IDB 帧缓存） | [timeline-plan.md](timeline-plan.md) |
| 时间轴帧缓存设计（内存 LRU + IndexedDB，键含 inputSig/graphVersion/parmRev） | [timeline-frame-cache-design.md](timeline-frame-cache-design.md) |
| fxhoudinimcp 对接大全（179 命令/HTTP RPC/端口发现/Python runtime/踩坑） | [fxhoudinimcp-compendium.md](fxhoudinimcp-compendium.md) |
| fxhoudinimcp 对接工具索引（速查卡/高频命令/桥暴露面/端口发现三法） | [fxhoudinimcp-tools-index.md](fxhoudinimcp-tools-index.md) |
| fxhoudinimcp 对接设计与落地（架构/时间轴双向/Python runtime/实机验证） | [houdini-mcp-integration.md](houdini-mcp-integration.md) |
| 快照系统修复（重启丢数据根因三重 + 启动恢复 + 双根合并） | [snapshot-fix-00102.md](snapshot-fix-00102.md) |
| 时间轴同步卡顿实测分析（fxhoudinimcp 判责 + 修复设计 + 通道上限） | [timeline-sync-lag-analysis.md](timeline-sync-lag-analysis.md) |
| **`transform1/t` 同步 ~1 秒定位（拉取式轮询双峰 + 后台停摆 120s + 两条否掉的修法）** | [tag-t-sync-latency.md](tag-t-sync-latency.md) |
| 吊牌 HDA + 项目绑定 + 轨迹页 架构设计提案（待拍板） | [tag-hda-project-design.md](tag-hda-project-design.md) |
| **吊牌 HDA + 项目绑定 + 轨迹页 实施计划（下一阶段主计划，先读）** | [tag-hda-plan.md](tag-hda-plan.md) |
| no geometry 诊断与 HDA 热重载恢复 | [no-geometry-diagnosis.md](no-geometry-diagnosis.md) |
| **项目化 + 映射系统设计（v0.1.00114，逻辑名/锚点/移动容错/类型化端口）** | [project-mapping-design.md](project-mapping-design.md) |
| **APEX runtime 知识库（权威，做 APEX 工作先读这个；已吸收 spaceMouse3 原文）** | [apex-runtime-knowledge.md](apex-runtime-knowledge.md) |
| APEX Scene Animate 世界坐标解析 + `apex-ctrl` 通道落地（本轮） | [apex-scene-animate-runtime.md](apex-scene-animate-runtime.md) |

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
| APEX / Scene Animate / 动画层 / 控制器世界坐标 | devlog/apex-scene-animate-runtime.md · research/apex_world_xform.py |
| 选中节点 / Spreadsheet·Param 跟随 | web/src/main.ts（refreshSelectionPanels）· web/src/app/spreadsheet.ts · web/src/app/param.ts · web/src/nodes2/graph.ts（getSelectedNode） |
| 显示模式默认 / displaySettings | web/src/viewport/renderer.ts · web/src/app/layouts/Default.json · web/src/app/main.ts（getDockJson） |
| three.js gizmo / TransformControls | web/src/viewport/renderer.ts（toggleGizmoDemo，G/Shift+G） |

## 最近版本

> **已移出本文件**（v0.1.00182）：见 [archive/version-history.md](archive/version-history.md)。
> 该节曾冻结在 v0.1.00118 而仓库已到 00181，落后 63 个版本 —— 与 `in-progress.md` 重复记录，
> 迟早对不上，事实证明确实对不上了。**版本历史看 `in-progress.md`（近期）或 `git log`（全量）。**
