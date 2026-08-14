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
| 临时开发场景日志（归档） | [temp-scene-log.md](temp-scene-log.md) |
| 同步架构与脏几何教训（归档：早期文档） | [sync-architecture.md](sync-architecture.md) |
| livelink 级同步路线图（归档：已被心跳重设计取代） | [livelink-roadmap.md](livelink-roadmap.md) |
| 同步信号重设计（事件驱动 + 心跳解耦） | [sync-heartbeat-redesign.md](sync-heartbeat-redesign.md) |
| 同步速率上限 + bridge 阻塞修复 + 首选项系统 | [sync-rate-limit-and-preference.md](sync-rate-limit-and-preference.md) |
| 自动保存 + 颜色系统 + 首选项浮动窗 | [autosave-color-prefs-ui.md](autosave-color-prefs-ui.md) |
| 浮动面板 pop-out 调研（已取消，归档） | [popout-windows.md](popout-windows.md) |
| 屎山代码（legacy spaghetti）标注 | [shit-mountains.md](shit-mountains.md) |
| 架构优化持续改进计划（已完成，收尾归档） | [refactor-plan.md](refactor-plan.md) |
| 重构复盘与后续建议 | [refactor-retrospective.md](refactor-retrospective.md) |
| 优化轮 00059（dock 角标重做/File 菜单/Sync 语义/Layout 框） | [optimize-round-00059.md](optimize-round-00059.md) |
| 优化轮 00060（dock 外折/点阵层级/Overview 新标签/HDA 重启恢复/视口 Undo） | [optimize-round-00060.md](optimize-round-00060.md) |
| 优化轮 00061（dock 内侧残留/菜单居中/颜色拾取器体验） | [optimize-round-00061.md](optimize-round-00061.md) |
| 优化轮 00062（HDA 崩溃根治/字体/颜色拾取器大改造） | [optimize-round-00062.md](optimize-round-00062.md) |
| AHS 约定提炼（拆分/并行/验证/选型） | [ahs-conventions.md](ahs-conventions.md) |
| Agent 代码库检索流程/函数引导/结构 | [agent-codebase-guide.md](agent-codebase-guide.md) |
| Zeno 技术遗产调研（归档：仅方法论参考） | [zeno-legacy.md](zeno-legacy.md) |
| Zeno 代码检索指引字典 | [zeno-guide.md](zeno-guide.md) |
| HDA Core 方案讨论（归档：已定案纯 Python） | [hda-core-cpp-discussion.md](hda-core-cpp-discussion.md) |
| 流式方案B落地设计（状态注记：sidecar 未启动，远期参考） | [streaming-plan-b.md](streaming-plan-b.md) |
| Zeno 技术遗产·算法索引 | [zeno/README.md](zeno/README.md)（算法全表：[zeno/algorithms.md](zeno/algorithms.md)） |
| 节点网格 Houdini 化（归档：已落地 nodes2） | [node-graph-houdini.md](node-graph-houdini.md) |
| 节点库选型调研（归档：已选 rete.js 2） | [node-library-research.md](node-library-research.md) |
| HDA runtime 优化调研（归档：已落地 runtime-optimized 布局） | [hda-runtime-optimization.md](hda-runtime-optimization.md) |
| HDK 多输出论坛调研（归档：结论已采纳） | [hdk-multi-output-forum.md](hdk-multi-output-forum.md) |
| JS 技术栈选型（归档：已选 three.js + rete.js） | [js-stack-research.md](js-stack-research.md) |
| 统一路径 + 文件快照系统设计（权威，P0 已落地） | [snapshot-design.md](snapshot-design.md) |
| 场景快照调研（归档：早期调研） | [scene-snapshot-research.md](scene-snapshot-research.md) |
| 快捷键（分类记录） | [shortcuts.md](shortcuts.md) |
| 视口显示踩坑记录（poly/线框/模式菜单/相机） | [viewport-bug-report.md](viewport-bug-report.md) |
| 节点视图 MCP 调试工具报告 | [nodeview-mcp-report.md](nodeview-mcp-report.md) |
| 视口显示模式 / Param 面板 MCP 通道调研（归档：对接已由 fxhoudinimcp 取代） | [mcp-channel-proposals.md](mcp-channel-proposals.md) |
| bridge⇄HDA 流式落地现状调研（归档） | [streaming-hda-review.md](streaming-hda-review.md) |
| 快速传输技术栈评估（状态注记：结论已采纳） | [transport-tech-evaluation.md](transport-tech-evaluation.md) |
| Parm 参数面板系统设计（状态注记：面板已落地） | [parm-system-design.md](parm-system-design.md) |
| bridge⇄HDA 同步差值根因与改进优先级 | [streaming-sync-gap.md](streaming-sync-gap.md) |
| Params 面板用户手册（中键 scrubbing / Ctrl+中键默认值 / 撤销） | [params-user-guide.md](params-user-guide.md) |
| 流式推送 dirty + 内存缓存方案讨论（状态注记） | [streaming-push-dirty.md](streaming-push-dirty.md) |
| Houdini Python Runtime 接口设计（状态注记：runtime 现走 fxhoudinimcp） | [python-runtime-design.md](python-runtime-design.md) |
| three.js gizmo 拖拽延迟调研（TS/three.js/WASM 澄清 + 改进方向） | [viewport-gizmo-latency.md](viewport-gizmo-latency.md) |
| bgeo.sc 二进制几何缓存调研（状态注记：未落地） | [bgeo-cache-research.md](bgeo-cache-research.md) |
| 缓存与显示管理调研（Zeno stamp/双缓冲 vs Houdini cook/detail 缓存 + 可借鉴清单） | [cache-display-research.md](cache-display-research.md) |
| 缓存系统交接指引（给新会话：现状/路线/契约/先读） | [cache-system-guide.md](cache-system-guide.md) |
| 视口中断系统重设计 + 本地新鲜度 + kick 限流 | [viewport-interrupt-redesign.md](viewport-interrupt-redesign.md) |
| 时间轴系统设计（30fps / HDA 锚定门控 / 双向同步） | [timeline-design.md](timeline-design.md) |
| 时间轴实施计划（本地 scrub → 手动同步开关 → IDB 帧缓存） | [timeline-plan.md](timeline-plan.md) |
| 时间轴帧缓存设计（内存 LRU + IndexedDB，键含 inputSig/graphVersion/parmRev） | [timeline-frame-cache-design.md](timeline-frame-cache-design.md) |
| fxhoudinimcp 对接大全（179 命令/HTTP RPC/端口发现/Python runtime/踩坑） | [fxhoudinimcp-compendium.md](fxhoudinimcp-compendium.md) |
| fxhoudinimcp 对接工具索引（速查卡/高频命令/桥暴露面/端口发现三法） | [fxhoudinimcp-tools-index.md](fxhoudinimcp-tools-index.md) |
| fxhoudinimcp 对接设计与落地（架构/时间轴双向/Python runtime/实机验证） | [houdini-mcp-integration.md](houdini-mcp-integration.md) |
| 快照系统修复（重启丢数据根因三重 + 启动恢复 + 双根合并） | [snapshot-fix-00102.md](snapshot-fix-00102.md) |
| 时间轴同步卡顿实测分析（fxhoudinimcp 判责 + 修复设计 + 通道上限） | [timeline-sync-lag-analysis.md](timeline-sync-lag-analysis.md) |
| 吊牌 HDA + 项目绑定 + 轨迹页 架构设计提案（待拍板） | [tag-hda-project-design.md](tag-hda-project-design.md) |
| **吊牌 HDA + 项目绑定 + 轨迹页 实施计划（下一阶段主计划，先读）** | [tag-hda-plan.md](tag-hda-plan.md) |
| no geometry 诊断与 HDA 热重载恢复 | [no-geometry-diagnosis.md](no-geometry-diagnosis.md) |

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
- v0.1.00105：**文档轮（改名 + 门禁拍板）**——「挂耳 HDA」改名**吊牌 HDA（Hang Tag）**（用户嫌挂耳难听，像商品吊牌）：`ear-hda-plan.md`/`ear-hda-project-design.md` git mv 为 `tag-hda-*.md`，全量标识 ear→tag（Cyl1nderTag / cyl1nder_tag.py / tagNodePath / kind:"tag" / actor:"tag-hda"），5 个引用文件同步（AGENT_QUICKSTART/README 字典/refactor-plan/timeline-sync-lag-analysis/timeline-design）；主计划 §0 门禁**用户拍板：6 个 ⚖️ 决策点全部按默认建议执行，P1 解除门禁**；清理根目录两个 MCP 调试探针临时文件。纯文档，无代码改动；验证零回归。下一轮 = P1 吊牌 HDA 最小闭环（派并行 codex 子智能体）。
- v0.1.00106：**P1 吊牌 HDA 最小闭环**——hda：新资产 Cyl1nderTag（纯侧挂 1 输入/0 输出、外形 slash=形状菜单第 22 号、隐藏 serial/bridge_url、多行 entries）+ cyl1nder_tag.py（cook 注册 1 tag+N param 通道、≥5s 节流心跳）+ build_hda/reload_hda/smoke 扩展（顺手修既有 serial 隐藏 setTag→setTags）；bridge：channels.py ChannelRegistry（channels.json 落盘）+ channel_routes.py 4 端点（注册/大全/心跳/探测，probe 经 houdini 代理 nodes.get_node_info）+ state/protocol 挂接；web：types/client 通道镜像 + stores/channels.ts + overview 关联注册大全面板（状态灯+探测）；协议三处同步（protocol.py/types.ts/protocol.md）；3 子智能体并行+主进程合并（main.py 挂载、param nodePath 契约修正、probe type 字典形态修正）；验证：pytest 130、tsc 0、vitest 194、hython SMOKE 全绿、实机 8100（注册 3 通道/心跳刷新/探测 alive+matched/runtime 改参 tx=3.5 落地）。
- v0.1.00104：**文档轮（为下一阶段交接）**——新 `devlog/ear-hda-plan.md`（挂耳 HDA+项目绑定+轨迹页实施计划，含 P1~P4 写集/契约/验收与 6 个待拍板门禁）；refactor-plan.md §七 收尾归档（重构阶段全部完成，后续以 ear-hda-plan 为主计划）；timeline-plan/design 状态注记补 00102/00103（双向同步已按 fxhoudinimcp 通道落地，engaged 门控待做）；**20 个过时文档批量加归档注记**（zeno-legacy / 早期选型调研 / streaming 系列 / 早期 sync 文档等，文件保留、README 字典标注归档）；README 字典标注归档/状态 + AGENT_QUICKSTART 更新当前焦点（新 agent 先读 ear-hda-plan + 提案 + 卡顿分析）。纯文档，无代码改动；验证零回归。
- v0.1.00103：**优化轮（6 项 + 卡顿分析 + 架构提案）**——① 底部栏两行（时间轴独立行；Sync Max FPS/Sync/Update Mode 第二行，Update Mode 右下角）② 时间轴与所有 Houdini 周期性交互遵循 Sync Max FPS（bridge 轮询/设帧速率派生 `max(66/33ms,1000/fps)`，cmd/python 一次性调用除外）③ 卡顿实测分析：**fxhoudinimcp 无责**（get_frame ~52ms 是 dispatcher 固有封送；通道合计上限 ~19Hz），根因 = 我们自己的 4Hz 轮询+全店刷新+拖拽全抑制 → 改为 bridge 常驻轮询+WS 帧变化推送（~85-130ms 延迟）+ store.setFrame 不 emit + 拖拽节流提交 ④ 地址栏 explorer 化（分段按钮跳转/空白处变输入/直接编辑+Tab 补全，输入态 Tab 独占）⑤ 线段 bypass（选中按 B→虚线+亮度饱和度暗淡，随图快照持久化）⑥ 线段运行时流动虚线（≥120ms 才启，≤2s，防闪烁）；文档：timeline-sync-lag-analysis.md + ear-hda-project-design.md（挂耳 HDA+项目序列号+轨迹页提案，6 个待拍板点）；5 子智能体并行+主进程粘合；pytest 110, tsc 0, vitest 186, WS 推送/双向实测通过。
- v0.1.00102：**快照系统修复（重启丢数据）+ fxhoudinimcp 对接（时间轴双向同步）**——快照根因三重修复（WS edit 通道从不落盘 → edit accept 后 maybe_snapshot；桥启动 lifespan 从磁盘回填空 workspace + `POST /snapshot/restore` + shutdown flush；read_snapshot 双根合并读 hip 根/回退根）；fxhoudinimcp 对接（bridge `houdini_mcp.py` HTTP RPC 客户端 + `houdini_routes.py` 代理端点 GET/PUT `/houdini`、`POST /houdini/cmd|python`、GET/PUT `/timeline` 0.25s 缓存 get_frame + 0.1s 节流 set_frame；registry `mcpPort`；HDA `cyl1nder_houdini_mcp.py` 纯 stdlib 端口发现（8100..8115 `mcp.health.pid==os.getpid()` 唯一判据）+ cook 钩子发现即上报；web timeline 双向（onFrameCommit/applyRemote/dragging 抑制/锚定灯 ●）；死锁红线：HDA 主线程禁同步 mcp.execute）；docs 大全/索引/对接设计三件套；4 子智能体并行 + 主进程粘合；实机验证：C→H 21→30→21、H→C 跟随、python 代理 `hou.frame()*2=42`、热重载×2 无崩溃、桥重启自动恢复 inputs=4/outputs=4。pytest 106, tsc 0, vitest 167, hython SMOKE OK。
- v0.1.00101：**Phase B 手动双向同步开关（右下角，默认 OFF）**——web `syncEnabled` 单一事实源（prefs 持久化）+ 底部栏 Sync 开关 + network.shouldPush / session 忽略回显 / kick / viewport-edit 全 gate；bridge per-serial `sync_enabled`（默认 False，`PUT /sync-enabled`；OFF 不广播回显/不 notify_stream；`/pending`、`/stream` 事件携带，`/status` 返回 sync 块）；HDA 自适应循环（OFF ~1.5s `/pending` 探测零 /stream，ON 跑 /stream，事件 false 切回）；4 路并行（Singer=bridge / Confucius=hda / Franklin=web-core / Wegener=web-ui）+ 主进程合并（applyLoadedPreference 补推 gate）；e2e fixtures.toggleSyncEnabled + round22 骨架。pytest 61, tsc 0, vitest 160, hython SMOKE OK。timeline-plan.md Phase B 标记完成。
- v0.1.00100：**本地时间轴 Phase A（本地优先，纯本地 scrub）**——H→C inputs 捎带可选 frame（HDA `hou.frame()` 采样、(sig,frame) 推送门；bridge 透传；WS 广播）；web `core/timeline.ts` 逐帧快照 + 底部栏时间轴 UI（锚定灯○/scrub/帧号/◀▶ Shift±10/播放/30fps）+ store.frame 切片 + session captureFrame 分流 + round21 E2E 骨架；4 路并行（Sagan=bridge / Darwin=hda / Helmholtz=web-core / Zeno=web-ui）+ 主进程合并（session 类型收紧、legacy 模板补容器）；AGENTS.md 增「代码修改默认派并行子智能体」铁律 8；timeline-plan.md Phase A 标记完成。pytest 59, tsc 0, vitest 158, hython SMOKE OK。
- v0.1.00099：设计理念写入 dev 偏好（README 关键理念铁律 + development-standards）——缓存与后端计算管理学习 Zeno+Houdini（cook-on-dirty/显示驱动 cook/detail 缓存+增量/stamp 分级/双缓冲/SoA→TypedArray/帧缓存，借鉴不复制）；能用开源就用开源（复用清单见 oss-reuse-audit.md，自研仅限协议胶水与无等价物领域逻辑）。纯文档轮。
- v0.1.00098：开源库优化 + msgpack 协议化——web `compare.ts` 换 fast-deep-equal（session 热路径去字符串化深比较）；bridge⇄web 几何热路径（PUT/GET outputs + WS）启用 msgpack（`@msgpack/msgpack` + Python `msgpack`，REST 按 Content-Type/Accept、WS 按 `?proto=msgpack` 协商，HDA 保持 JSON）；bridge snapshot 换 orjson；协议三处同步（protocol.py/protocol.md，types.ts 无字段变化）。验证：pytest 59 / tsc 0 / vitest 151 / e2e 84 passed+1 skip / hython SMOKE OK。缓存优化至此告一段落；下一功能周期=时间轴+手动同步开关+IndexedDB 帧缓存（见 timeline-plan.md）。
- v0.1.00097：分支统一清理（唯一主线 codex/develop，删除 11 个纯祖先检查点分支 + 远端 00087；cyl1nder-v0 待切 GitHub 默认分支后删）+ 分支规范写入 development-standards.md + 时间轴逐帧缓存设计（timeline-frame-cache-design.md：帧切换+无 parm 变化→不重算，内存 LRU+IndexedDB）+ 开源库借鉴审计（oss-reuse-audit.md：Top1 fast-deep-equal 可即做；msgpack/orjson/floating-ui/culori 列入后续；其余保持手搓）。
- v0.1.00096：修复视口 display focus 被组重建清掉（拖 transform gizmo 时输入/输出四个口一起显示的偶发 bug——refresh 重建 input/output 组后同帧重放 focus，Viewport 自持 focus 状态；新增 round20-display-focus 逐帧回归 3 例）+ 浏览器支持评估（cache-browser-support-eval.md：纯 JS/TypedArray/Worker(Transferable)/WebGL2/IndexedDB/msgpack 全通用可直接做；WebGPU/SharedArrayBuffer(COOP/COEP)/WebTransport 推迟）。验证：tsc 0 / vitest 145 / e2e 84 passed+1 skip。
- v0.1.00095：缓存对齐 Zeno/Houdini——懒输出（显示驱动 cook：只算激活链，未显示链零工作）+ 变化分级（stamp：none/data/topology）+ HDA cook-on-dirty 输入门控（_push_inputs_if_changed）+ 推送/rev 分级（只推变了的链，no-op 帧零工作）。4 子智能体并行（Descartes=chain-cache / Gibbs=runner+dataflow / Lovelace=viewport / Hilbert=hda）+ 主进程契约锚点与合并；整合修复 activeNodeId（显示 transform 直连输出链保持 live，修 round7 回归）。验证：tsc 0 / vitest 145 / pytest 53 / e2e 81 passed+1 skip / hython SMOKE OK。详见 devlog/cache-lazy-stamp-round.md。
- v0.1.00094：新增缓存系统交接指引（devlog/cache-system-guide.md）——现状盘点（chain-cache/位置-only/pump/HDA _GEO_CACHE/bridge rev buffers）、下一步路线（懒输出→协议二进制化→SoA+Worker→变化分级）、关键契约与坑（协议单源/@P 不 delta/新鲜度门控/不重引入预览 hack）、新会话先读清单。
- v0.1.00093：缓存与显示管理调研——Zeno（显式节点缓存 CachedByKey/CacheToDisk + 帧缓存 + stamp 变化分级 + MapStablizer 双缓冲增量 diff + GPU id-FBO 拾取）vs Houdini（cook-on-dirty DAG + GU_Detail 缓存 + 显示驱动 cook + 视口常驻 GPU 增量）；产出 devlog/cache-display-research.md（主文档）+ devlog/zeno/cache-display-notes.md（Zeno 源码细读，子智能体）；可借鉴优先级：懒输出跳过未显示分支 / SoA→Float32Array / Worker 双缓冲 / 变化分级 / GPU 拾取 / 节点级缓存。
- v0.1.00092：视口实时性 P2——链状态缓存 + 免克隆平移（chain-cache.ts：	raceChainSpecs 结构 trace + sig 命中仅 tx/ty/tz 变化走就地 delta 快路径：全点 O(P) 零分配、组子集只改命中点、零 delta 零工作、含 @P 规则全量重 trace；pplyTranslateDeltaInPlace；computeOutputs/computeNodeResult 可选 ctx 走缓存）+ 拓扑变化→cook 补全（graph 管道 after 事件合并 setTimeout(0) cook，拖线建连/Tab 建节点/restoreGraph 后 outputs 立即刷新）；2 路并行（Sartre=链缓存 / Tesla=拓扑 cook）+主进程合并；vitest +12（chain-cache 单测），e2e +round19（组过滤拖拽只动命中点、store points 数组跨帧引用不变=免克隆实锤）；tsc 0, vitest 121, pytest 53, e2e 81 passed/1 skipped；详见 viewport-gizmo-latency.md §6.5
- v0.1.00091：视口实时性 P1——帧序（flush 先于 render，setPreRenderFlush pump，几何与 gizmo 同帧上屏）+ 拖拽期合并计算（scheduleNetwork latest-wins，每帧至多一次 runNetwork）+ 去双重计算（displayNodeOutputIndex 复用 outputs[i] + 
efreshNodeFlags(displayBuffer) + flush 顺序调换）+ 输出新鲜度门控（图拓扑版本号 getGraphVersion/isFresh，restore/拖线建连未 cook 时回退 computeNodeResult）+ 隐藏 outputGroup 跳过；2 路并行（Confucius=帧序+合并 pump / Bernoulli=去双重计算）+主进程合并（拓扑版本门控修复 round7 回归）；round17 同步断言改帧内 poll + 新增帧序断言；tsc 0, vitest 109, pytest 53, e2e 80 passed/1 skipped；详见 viewport-gizmo-latency.md §6 链路分析
- v0.1.00090：视口理念纠正（撤销矩阵预览 hack——操作时本地执行、更新 parms→视口位置-only 更新→几何跟手、不重建全部网格、不强依赖桥；mouseup 恢复「松手才提交 parms」）+ nodeview 大功能（连线重连 attachReconnect 带抓取/松手/点击/Esc 状态机与流动虚线预览、Ctrl+点击连线插 _dot_ 直通节点、Esc 取消进行中连线/重连/插入（视口 Esc 改为仅悬停时退 Enter）、Delete 删选中节点（v1 无 undo）、nodeview 顶部地址栏 + 面板标题显示当前地址 /<serial>/）；3 路并行（Euclid=viewport / Hilbert=nodeview / Pascal=地址栏）+主进程合并（round3/6/8 Esc 与 fit 测试适配、dot 恢复 seq 防重名）；tsc 0, vitest 101, pytest 53, e2e 79 passed/1 skipped；详见 devlog/annotations-web.md 与 viewport-gizmo-latency.md §5 理念纠正
- v0.1.00089：视口 Enter gizmo 拖拽本地预览（几何同帧跟手，不重建/不依赖桥）+ 取消选择保持 Spreadsheet/Parms 最后节点 + File/Edit 菜单去箭头 + Auto Update 下拉白底修复；bgeo.sc 缓存调研落库 + dev 设计偏好（对齐 Houdini + 复用第三方库）；3 路并行（Heisenberg=viewport / Godel=selection / Goodall=menus+css）+主进程合并；tsc 0, vitest 101, pytest 53, e2e 74 passed/1 skipped；详见 devlog/bgeo-cache-research.md 与 annotations-web.md
- v0.1.00088：重整复盘落库（refactor-retrospective.md）；刷新机器生成索引（FUNCTION_INDEX/MODULE_GRAPH/API_INDEX）；更新根 README 版本与架构；清理根目录临时 snapshot 数据与 bridge 日志。
- v0.1.00087：阶段3.3 完成——抽 core/dataflow.ts（createDataflow 收拢「编辑→网络→视口」数据流，late-bound getter 破鸡生蛋）；main.ts 892→793；tsc 0 + vitest 101 + build 通过 + 视口/节点图 e2e 26 passed。
- v0.1.00086：阶段3.2 完成——color.ts 全拆 color/（picker/wheel-sv/harmony/palette/color-math + barrel，wheel-sv 用 createWheelSv 依赖注入破 setColor↔wheel 循环）；tsc 0 + vitest 101 + build 通过 + round15-color 8 passed。
- v0.1.00085：阶段3.2 部分完成——color.ts 纯函数拆 color/（color-math 迁入 + harmony + palette + recents，3 子智能体并行）；tsc 0 + vitest 101 + vite build 通过 + round15-color 8 passed。
- v0.1.00084：阶段3.1 完成——hda/src/cyl1nder_hda.py 拆 lifecycle/cache/geometry/sync + 外壳 barrel（5 子智能体并行、写集不相交）；hython smoke 全绿；reload_hda MODULES 与 smoke monkeypatch 同步适配。
- v0.1.00083：阶段2.3 完成——viewport/renderer.ts 拆 scene/camera/gizmo/picking/modes/state + 外壳（5 子智能体并行、写集不相交）；tsc 0 + vitest 101 + vite build 通过 + 视口 e2e round2/4/5/6/7/8/12/16/17 共 26 passed。
- v0.1.00082：阶段2.2 完成——graph.ts 拆 graph-model/graph-interact/graph-undo + 外壳（4 子智能体并行、写集不相交）；tsc 0 + vitest 101 + vite build 通过 + 节点图 e2e round2/16 8 passed。
- v0.1.00065：bridge 控制台降噪 + 心跳统一 1min——uvicorn access_log 关闭（web 推流无上限，gizmo 拖动不再刷屏 cmd）；STREAM_HOLD_DEFAULT 20→60（/stream 缺省 hold=60s）；web HDA watchdog 15s→60s（离线阈值仍 150s）；主进程 2 路并行（Huygens=bridge / Hypatia=web）+ 主进程合并；pytest 53, tsc 0, vitest 82（e2e 本次未重跑：改动不涉及 e2e 断言覆盖路径）。
- v0.1.00081：切 2.2 分支 `codex/0.1.00080-refactor-graph`；refactor-plan.md 补 graph.ts 关系图与目标基础架构图。
- v0.1.00080：**阶段2.1 完成**——main.ts 抽 `core/session.ts`（connect/WS 消息/autoRun/replay），2.1 八子刀全部合入；连接类 e2e round2/8/10/12/13/14 共 22 passed。
- v0.1.00079：架构重构阶段2.1-session 第一子刀——main.ts 抽 `core/kick.ts`（kick 状态机：首连踢/5s 限流/WS drop 重臂）；round10-kick 1 passed。
- v0.1.00078：架构重构阶段2.1-network——main.ts 抽 `core/network.ts`（runNetwork+networkEpoch）；2.1 仅剩 connect/WS 收尾；refactor-plan.md 补 2.2 graph 分支计划。
- v0.1.00077：架构重构阶段2.1-gizmo——main.ts 抽 `core/gizmo.ts`（Enter gizmo 控制器，状态闭包化）；round12/16 6 passed。
- v0.1.00076：重构检查点——切出分支 `codex/0.1.00075-refactor-gizmo-session`；refactor-plan.md 新增「当前执行（in progress）」小节，明确 core/gizmo 契约与下一步 core/session。
- v0.1.00075：架构重构阶段2.1 第四刀——main.ts 抽 `core/param-undo.ts`（参数编辑会话级撤销工厂化）；round16-undo 3 passed。
- v0.1.00074：架构重构阶段2.1 第三刀——main.ts 抽 `core/params.ts`（readParamFloats/cloneParams/paramsEqual + ParamLike 类型统一）；修复 round16 旧原生 select 断言；round16 3 passed。
- v0.1.00073：架构重构阶段2.1 第二刀——main.ts 抽 `core/shortcuts.ts`（F/B/Enter/Ctrl+S·Ctrl+Alt+S 依赖注入）；round5/8/12/14 e2e 13 passed；refactor-plan.md 更新进度。
- v0.1.00072：架构重构阶段2.1 第一刀——main.ts 抽 `core/lifecycle.ts`（autosave + hda watchdog 工厂化，闭包状态）；round8/9/13/14 e2e 19 passed；refactor-plan.md 更新进度。
- v0.1.00071：架构重构阶段1——color.ts 拆出纯色彩数学 color-math.ts（+19 vitest）；nodes2/groups.ts 拆 parser.ts/matcher.ts（barrel 保持外部 import 不变）；mcp_server 顺延；refactor-plan.md 更新进度。
- v0.1.00070：屎山代码改名并纳入持续改进计划——stone-mountains→shit-mountains（术语 石山→屎山）；新增 devlog/refactor-plan.md（架构优化分析 + 分期路线图：阶段1 纯函数/薄文件 → 阶段2 main/graph/viewport 中拆 → 阶段3 hda/color/跨端大拆）；README 字典同步。
- v0.1.00069：UI 下拉/数值输入统一——所有下拉改 Layout 盒风格自定义下拉（createDropdown：圆角盒 + ▲▼ caret + 名称块 + dark popup，替代原生 select：底部栏 Update Mode、首选项 Update Mode/UI Font、调色板 harmony、File/Edit 菜单触发钮）；所有带箭头数值输入改 Sync Max FPS 步进风格（createStepper：首选项 fps/autosave interval）；新增 widgets.ts/widgets.css；UI 规范写入 development-standards；屎山代码标注（现 shit-mountains.md）；e2e round12/13/15 同步 16 passed；tsc 0, vitest 82。
- v0.1.00068：调色板 Ctrl+Z 撤回（含 Recent 精确清理，不误删已手删项）+ HSL L=100 归零修复（state.hsl/preserveHsl）+ 色轮/Adobe 关联点 H 错位修复（0° 顶部顺时针）+ 取消 Document PiP popup（pop 回即关）+ 浮窗视口钳制（拖拽不越界、越界下次召唤回默认）；e2e round15 8 passed；tsc 0, vitest 82。
- v0.1.00067：调色板 UI 再优化 + pop-out——点击新颜色直接 retarget 已开面板（保持位置，不再回右上角）；Advanced Palette 复用 Simple（去重复/去 5 列单独版）；新增 Document PiP pop-out（⧉ 按钮，isPopoutSupported 主动判断、不支持自动隐藏，调色板与 Preference 都能弹出成独立置顶窗口；拖拽监听改 ownerDocument 跨文档可用）；e2e round15 8 passed；tsc 0, vitest 82。
- v0.1.00066：调色板 UI 优化——Advanced Palette 改成「Simple 预设(20)+Neutrals(5)」扁平 5 列网格（去英文分类/标签）；harmony 下拉右侧新增自绘关联点 SVG 提示（随 base 颜色实时着色）；调色板不再点外关闭，点击另一 color3 swatch 即 retarget；浮动面板跳出浏览器=Document PiP 方案已调研并记录 popout-windows.md（本轮未实现，待单独开轮）；e2e round15 断言同步；tsc 0, vitest 82。
- v0.1.00064：视口中断系统重设计 + 本地新鲜度 + kick 限流——web 本地乐观应用（runNetwork 先本地重建再推桥，与 Sync Max FPS 解耦）+ networkEpoch 过时请求整体丢弃 + rAF 合帧刷新 + WS outputs 内容去重/rev 单调；Sync Max FPS 首次 connect 即推（bridge 不再停默认 30）；kick 双端限流（web ≥5s/仅桥重启 re-kick，bridge 2s 去重 throttled）；撤销/重做 Enter gizmo 归位（onParamsApplied + setEnterPosition）；首选项删两行提示 + Default→Viewport Background Color；全部字体跟首选项（CSS 统一 --cyl-font-ui）；bridge _maybe_snapshot 移线程 + no-op 不 log；浮动面板跳出页面=大改不做（记录）；4 路并行（Russell=bridge / Franklin=web核心 / Peirce=undo-gizmo / Meitner=UI）+主进程合并；pytest 53, tsc 0, vitest 82, e2e 73 passed/1 skipped。
- v0.1.00063：归档前文档同步——根 README 版本（0.1.00041→0.1.00063 + 当前架构一行）；sync-rate-limit-and-preference.md §2.3 过时表述修正（modal/Save-Cancel/推流节流→浮动面板 Apply-Accept/无上限）；sync-heartbeat-redesign.md sync_fps 注记（v0.1.00057 起为 HDA 接收端上限）；streaming-sync-gap.md / timeline-design.md 加「状态注记」（/stream 已落地、/pending 降 fallback、timeline 设计未实现）；annotations-hda/web 4 处历史条目加「已过时」标记。
- v0.1.00062：大改造轮——HDA 崩溃根治（后台线程不再调 hou + reload 前停线程 + stop_all_sync + 恢复闭环）+ dock 底角黑点根治（删内凹 notch，底角纯活动蓝）+ 菜单加高 + Sync Max FPS ▲▼ 步进 + 字体内嵌（Fira Code + Noto Sans SC，UI 分类字体选项 + hex 同步）+ 首选项单实例/背景色 Ctrl+中键重置/背景色应用修复 + pivot 去绿盒 + 颜色拾取器大改造（全圆盘/滑块/Simple-Advanced/原生拾色器/Adobe 和谐色轮联动点/可拖动）+ 统一属性系统（Ctrl+中键重置扩展到 vector/color3 等）；4 路并行（Parfit=HDA / Boyle=CSS+字体 / Goodall=首选项+viewport / Archimedes=颜色）+主进程合并（registry 防抖测试加固）；tsc 0, vitest 82, e2e 71 passed/1 skipped, hython SMOKE OK, pytest 50。
- v0.1.00061：UI/颜色微调——dock 底角内侧残留修复（notch 渐变圆心移到真正底角 + 硬边去近黑像素）+ 菜单 File/Edit 垂直居中 + 颜色拾取器体验（点色块即开调色板、移除 Change 按钮、hex 大写 + 小写自动转大写、Adobe 风色轮 △/□ 切换）；2 路并行（Heisenberg=dock+菜单 / Schrodinger=颜色）+主进程合并（round13/15 e2e 同步、Escape 优先关拾取器）；tsc 0, vitest 82, e2e 64 passed/1 skipped, pytest 50。
- v0.1.00060：优化轮 2——dock 活跃标签底部圆角 Round10（蓝色外翻 crescent 恢复 + 消除背后实心阴影）+ nodeview 点阵层级修复（isolation + z-index:-1 + 保留节点 z-index:1）+ Overview 左上角 brand 改新标签页 + bridge 重启后几何自动恢复（HDA reset 清 PUSH/GEO 等缓存并绕过 fps 节流重推 inputs）+ 视口参数 Undo（一次拖动一步撤回，undo group 支持批量一步回退）；5 路并行（Ohm=dock / Beauvoir=点阵 / Ramanujan=Overview / Laplace=HDA / Peirce=Undo）+主进程合并（round11 新标签断言、round4/5 z-index 修复）；tsc 0, vitest 82, e2e 64 passed/1 skipped, hython SMOKE OK, pytest 50。
- v0.1.00059：优化轮——Sync Max FPS 语义修正（非本体运作上限，Auto Update 推流无上限；Sync Max FPS = kick bridge 上限）+ File 菜单快捷键灰字（Ctrl+S/Ctrl+Alt+S）+ 移除 Overview（仅左上角 brand）+ Layout 菜单圆角框（▲▼ 装饰 + 15ch 深色名称补空格）+ Preference 面板可拖动 + Save→Accept + dock 活跃 tab 底部圆角 Round9 重做（恢复蓝色强调、消除栏色凹口/阴影）；2 路并行（Newton=dock 角标 / Russell=web 语义+UI）+主进程合并；tsc 0, vitest 82, e2e 61 passed/1 skipped, pytest 50。
- v0.1.00058：自动保存系统（平常不写盘，默认 5min 定时 + General「Auto Save」toggle/间隔）+ 首选项浮动非模态窗口（分类标签 General/Viewport、Apply 不关闭）+ 统一颜色系统（color3 属性 + 现代拾取器：色相轮盘/SV 方板/色块/RGB-HSL-HSV/#hex 实时同步）+ Viewport 默认背景色 + 菜单 File/Edit/Layout + Layout 菜单显布局名 15ch + dock 活跃标签凹角 bug 修复 + Enter 取消选择挂上个 transform；4 路并行（Banach=保存/菜单/Enter / Hilbert=首选项浮动窗 / James=颜色系统 / Gibbs=dock 角标）+主进程合并；tsc 0, vitest 82, e2e 25 全过, pytest 50。
- v0.1.00057：每端 Sync Max FPS（默认 30，1..60）防守——web 推流节流（throttledPush latest-wins）+ bridge 接收/转发合帧 + registry 写盘防抖（修复 60Hz 拖动阻塞事件循环根因：touch/mark_activity 同步写盘）+ HDA 接收端 recook/拉取节流（sync_fps 重新启用，/stream 事件 fps 覆盖）；首选项系统（Edit→Preference 对话框，Preference.json 随场景保存，update_mode enum）；底部栏 Sync Max FPS + 去 Update 灰字；Ctrl+S/Ctrl+Alt+S 快速保存/另存为（阻止 Chrome 保存网页）；3 路并行（Zeno=bridge / Arendt=hda / Ampere=web）+主进程合并；pytest 50、tsc 0、vitest 82、hython SMOKE OK、e2e 15 全过。
- v0.1.00056：同步信号重设计——HDA 主通道改 NDJSON 长轮询 /stream（事件即数据、空闲 hold=60s=心跳 1/min、高传输零额外心跳，LiveLink 原则）；心跳与数据轮询解耦（web 离线阈值 15s→150s 慢时钟）；stream 干净生命周期（node 删除/stop 退出线程）；3 路并行（Mill=bridge / Hegel=hda / Godel=web）+主进程合并；pytest 43、tsc 0、vitest 82、hython SMOKE OK、e2e 11 全过。
- v0.1.00055：no geometry 诊断恢复(HDA 旧代码不处理 kick → 热重载 reload_cyl1nder 恢复 inputs)；底部非 docking 栏+更新模式(Auto Update/On Mouse Up，松手一次性提交零网络)；时间轴系统设计(HDA 锚定门控 engaged)。
- v0.1.00054：bridge 中断修复(registry touch 自动注册，HDA 轮询即重连)；web 掉线重连自动再 kick；three.js gizmo 延迟调研(TS 非解释执行/three.js 非 WASM，延迟来自每帧全量网络+重建)。
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
