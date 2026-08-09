# AHS → Cyl1nder 约定提炼（拆分 / 并行 / 验证 / 技术选型 / agent 协作）

> 出处目录：`D:\code\dev\web\Animehairstudio\devlog\`（下文每条标注源文件）。每条末尾的「→ Cyl1nder」是可直接落地的用法，部分已实现、部分为建议。

---

## 1. 拆分规范（如何拆、拆成什么样）

| # | 约定 | 出处 | → Cyl1nder 落地 |
|---|---|---|---|
| S1 | **三层金字塔文档检索**：入口层（AGENT_QUICKSTART + README 字典）→ 检索层（机器生成 FUNCTION_INDEX，函数名→行号→calls）→ 详情层（按子系统拆的专题文件 + 时间线）。不追求"一次读完"，追求"按需跳读"。 | REFACTOR_PLAN.md「目标」 | 已部分实现（AGENT_QUICKSTART / FUNCTION_INDEX / API_INDEX / annotations-* 已存在）；缺"子系统关键词索引表"与"详情层到专题文件的统一指针"，见 AGENT_GUIDE 第 1/5 节 |
| S2 | **拆分目标不是"文件变小"，而是"子系统边界清晰"**：依赖图驱动、渐进拆分，绝不做大爆炸重写；每一步「独立 commit + 失败回滚」。 | REFACTOR_PLAN.md「目标 / 执行状态 / 验证策略」 | Cyl1nder 体量小（138 函数），现阶段**不要**为拆而拆；只需把 `compute/`（预留执行器注册表）和 web `protocol/`（types 镜像）的边界钉死 |
| S3 | **模块按功能域分目录**（core/data/geometry/io/edit/sculpt/material/branch/scalp）；**模块间保持扁平**（不互相 import，只被主文件 import）；每个域落地独立 commit + 回归。 | REFACTOR_PLAN.md「目标文件夹架构」「归组原则」 | Cyl1nder web/src 已按域分（app/bridge/nodes/protocol/stores/tools/viewport）；bridge 已按职责分文件。维护这条纪律即可，不需要再细分 |
| S4 | **全局状态收敛为 store**：241 个全局 let → 15 个域 store；"新状态一律进对应 store，主文件不新增全局 let"；store 化后「快照 = 序列化 store」，「新建/加载/重置 = reset store」。 | REFACTOR_PLAN.md 阶段 3 工程意义；development-standards.md「状态管理 store 体系」；AGENT_QUICKSTART.md §1 | web 已有唯一 `stores/workspace.ts`（pub-sub store）——体量小所以 1 个够；**新状态必须进 store**，不要在 `main.ts` 加裸全局。bridge 的 `state.py` 单例 + workspace rev 缓冲是 Python 侧等价物 |
| S5 | **主文件瘦身为"编排层"**：只保留「初始化 + store 装配 + 事件绑定」，业务逻辑按子系统迁入模块；迁移用依赖注入 `createXxxApi(deps)`，deps 逐步收敛为「store + 少量核心函数」。 | REFACTOR_PLAN.md「阶段 3d」 | web `main.ts`（157 行）已基本是编排层；继续遵守：新业务逻辑进对应域目录，main.ts 只接线 |
| S6 | **"持续修改功能"清单**：相对上游的本地增强要有一张表（功能 / 状态 启用\|deprecated / 说明），每次上游更新后优先同步、被上游原生支持则标 deprecated 并删本地实现。 | development-standards.md「持续修改功能」；README.md 字典 | Cyl1nder 无上游，此条不适用；但可类比为「关键机制清单」：协议单源、serial 规则、30fps 双向同步、回显去重、桥重启自愈——建议进 AGENT_QUICKSTART 的 Keep list（见 AGENT_GUIDE） |
| S7 | **索引生成器脚本化**：`scripts/gen-function-index.js` 扫描 app.js + modules，产出 FUNCTION_INDEX.md/.json（函数名/行号/类型/导出/calls）；`calls` 作为 hub 指标。 | REFACTOR_PLAN.md 阶段 0；scripts/gen-function-index.js | Cyl1nder `scripts/gen-index.mjs` 已实现且覆盖 .ts+.py（更好）；**但存在一个 bug**：TS 导出名被记成 `"export "`（`const name = m[1] || m[2]` 应为 `m[2]`），web 侧索引基本失效，需修（详见 AGENT_GUIDE §5） |

---

## 2. 并行开发范式

| # | 约定 | 出处 | → Cyl1nder 落地 |
|---|---|---|---|
| P1 | **子 agent 在隔离副本/独立分支工作，主 agent 统一整合**；"git 冲突取决于改动边界是否重叠"；合并与冲突处理统一由主进程负责，子 agent 不 merge main。 | REFACTOR_PLAN.md「目标」；development-standards.md「分支管理」；AGENT_QUICKSTART.md §4 | Cyl1nder 已写进 development-standards.md（`codex/<版本>-<操作>` 分支 + 禁止直接 merge main）。并行时按文件/子系统切分即可 |
| P2 | **子任务必须文件/子系统不相交**；子 agent 产出后主进程统一审查整合；**关键路径阻塞任务不委托**。 | development-standards.md「Codex 子智能体」 | 可直接照抄进 Cyl1nder AGENTS.md/QUICKSTART（Cyl1nder 现有 AGENTS.md 已提"并行调研 / 独立小改动"但没写"不相交"和"关键路径不委托"两条红线） |
| P3 | **并行的必要条件是状态收敛**：store 化之后"每个子系统 = 独立模块 + 独立 store"，两个 agent 改不同子系统 = 改不同文件 = 零冲突；未收敛前改共享全局状态的功能必然冲突（"伪模块化"）。 | REFACTOR_PLAN.md 阶段 3「并行开发的必要条件」 | 对 Cyl1nder 的推论：bridge 与 web 的共享边界只有 `protocol.py ↔ types.ts`（单源三处同步），这是**唯一的跨端冲突点**——并行任务若都动协议，必须先锁协议或串行；其余子系统天然不相交 |
| P4 | **适用场景枚举**：并行调研（多 bug 根因分析、跨分支 diff 对比）、隔离副本小改动（按文件边界切分）；不适合把"一个功能横跨桥+web+HDA"拆给两个 agent 并行。 | development-standards.md「Codex 子智能体」 | Cyl1nder 的横切功能（如双向同步）必须单 agent 串行做，因为要同时改 bridge/routes+ws、hda/src、web/src 三端并三端同验 |

---

## 3. 验证策略（AHS 的"每条铁律"）

| # | 约定 | 出处 | → Cyl1nder 落地 |
|---|---|---|---|
| V1 | **每个改动独立 commit + 独立跑回归**；"拆分只允许独立 commit + 失败回滚，不允许拆完未验证"。 | REFACTOR_PLAN.md「验证策略」 | Cyl1nder 已定三端同跑铁律（pytest + tsc + hython 冒烟）；建议再加一条「任何 bridge 改动独立 commit 后必跑 pytest」，与 web 改动解耦 |
| V2 | **验证用真实数据/真实链路**：AHS 用 Playwright headless + 静态服务器 + 固定样例 `.ahs`（Sussurro_0043）断言"无页面错误、无 NaN、关键计数与基线一致"。 | REFACTOR_PLAN.md「验证策略」；AGENT_QUICKSTART.md §4 | Cyl1nder 已有 Playwright e2e（连真实桥）+ vitest + pytest + hython_smoke；建议把「三端同跑」封装成一条命令 `scripts/verify-all.ps1`（见 AGENT_GUIDE §4/§5），降低漏验概率 |
| V3 | **文档类改动也要验证**：改完 `Select-String` 抽查渲染/链接。 | REFACTOR_PLAN.md「验证策略」 | 通用纪律，直接沿用（Cyl1nder QUICKSTART 已有） |
| V4 | **验证要有"证据"而非"没报错"**：AHS 每次标注都写「验证（样例, 参数）：计数 / 0 NaN / 0 页面错误」的量化结果。 | annotations-split.md / annotations-adapt.md（每条目含验证行） | Cyl1nder annotations-* 已有类似风格（如 hda 标注写"实测 ~0.6s 拉回 / bridgeVertexCount=24 / 0 NaN"）——保持，别退化成只写"测试通过" |

---

## 4. 技术选型（可借鉴的架构判断）

| # | 约定 | 出处 | → Cyl1nder 落地 |
|---|---|---|---|
| T1 | **场景 = 可序列化 JSON**：整个场景一个 JSON，"外部接口（MCP / LiveLink / DCC 桥）本质就是读写这份 JSON + 事件通知"；撤销/序列化/外部桥接全围绕数据做。 | AnimeHairStudio_Tech_Architecture_and_DCC_Reference.md §5.3 / §8.1 / §8.3 | Cyl1nder 的几何信封（InputPayload/OutputBuffer）已 JSON 化——这正是桥能成为"中间站"的根基；**任何新数据（如节点图状态）先想"能不能 JSON 序列化"** |
| T2 | **Python 大前端 = 控制总线**：本地 Python 进程持有 open/save/export/query/execute/node graph API，浏览器经 WebSocket/HTTP 调用；Python 改 → 事件推 → 浏览器刷新，浏览器改 → 事件推 → Python 更新；场景数据双端一致。 | 同文件 §12.2 | Cyl1nder 桥正是这条路线（FastAPI+WS 持有 inputs/outputs，HDA 和 web 双向推拉）；"桥重启自愈 + rev 语义"就是"双端一致"的实现细节，已在 devlog 记录，保持 |
| T3 | **MCP 集成**：本地 Python 进程本身做成 MCP server，把 open/save/export/query/execute 暴露给 AI。 | 同文件 §12.2 / §13.3 | 已实现：`bridge/mcp_server.py` 7 个 `cyl1nder_*` 工具（ping/list_serials/get_status/read_logs/get_errors/get_geometry_summary/index_query）；Houdini 侧直接用官方 fxhoudinimcp（Cyl1nder 自己的铁律，比 AHS 更先进，保留） |
| T4 | **动态后端加载（ComfyUI 模式）**：节点注册表（type → loader），首次用到才 import 实现，"核心永远轻、功能按需进内存"。 | 同文件 §14.6 | Cyl1nder `compute/__init__.py` 的 `register_executor / run_node` 注册表 + passthrough/ctypes_stub 正是此模式的预留实现——**这是未来扩展的核心入口，别改成硬编码分发** |
| T5 | **SOP 理念在 Web 的实现**：节点 = 纯函数（输入 data → 输出 data），执行器按 DAG 拓扑序跑，脏标记缓存，数据随时 JSON 序列化。 | 同文件 §14.3 | web 的 `runNetwork()`（v1 passthrough）已是雏形；`inputsEqual` 防回显 + workspace rev 就是"脏标记"；后续加真节点计算时沿用纯函数 + DAG 执行，不要变成命令式过程 |
| T6 | **本地桥形态优先级**：WebSocket（双向低延迟可推事件）> 本地 HTTP/SSE > 文件监听；从 https 页面访问 localhost 需 `Access-Control-Allow-Private-Network`。 | 同文件 §11.3 | Cyl1nder 已是 REST+WS 双通道（REST 拉取、WS 实时回放/推送），CORS 已加中间件——选型正确，保持 |
| T7 | **dev 零构建 / release 编译分层**：开发期纯文本改保存刷新即生效；发布期 Vite 打包 + tree-shaking，热点重写 WASM；桌面壳可选 Tauri/Electron。 | 同文件 §14.2 | Cyl1nder 开发期用 Vite dev server（HMR）+ Python 免重启热重载，正中此道；发布期打包路线未定，建议先在 devlog 记一条决策（Vite build + 可选 Tauri） |
| T8 | **迭代工具链**：加 TypeScript 提升可维护性（AHS 自己没 TS，明确建议新项目用）；依赖本地 vendor 而非 CDN（离线）。 | 同文件 §7「风险与注意点」/ §8.3 | Cyl1nder 已用 TS strict + Vite——比 AHS 更健康；three/x6 走 npm 本地依赖，已避开 CDN 问题 |

---

## 5. agent 协作约定（对 Cyl1nder 最直接可抄的部分）

| # | 约定 | 出处 | → Cyl1nder 落地 |
|---|---|---|---|
| A1 | **AGENT_QUICKSTART = 新 agent 唯一必读**：包含「仓库结构速览 + 必须保留代码 Keep list + 关键决策表 Decisions & Why + 工作方式 + 常见坑」；目标"几分钟上手，不从头通读大文件"。 | AGENT_QUICKSTART.md（全文结构） | Cyl1nder 的 QUICKSTART 已有"先读顺序 / 代码地图 / 常用命令 / 验证铁律"，**缺 Keep list 和常见坑两节**——建议补齐（见 AGENT_GUIDE §2/§5） |
| A2 | **改动标注制度**：所有 .js/.ts/.py 修改必须记 devlog「改动标注」，说明与既有代码的差别/新增；**按子系统拆专题文件**（annotations-bridge/region-panel/root-bone/split/display-fixes/adapt），索引文件只留"子系统 → 关键词 → 条目文件"表；时间线单独一份。 | development-standards.md「JS 改动标注」；js-change-annotations.md；README.md 字典 | Cyl1nder 已按子系统拆（annotations-bridge/hda/web）——**缺一个 js-change-annotations 式的"关键词→专题"索引表**，建议补进 devlog/README 或新页（AGENT_GUIDE §5） |
| A3 | **查代码纪律**：先用 `Select-String` / `git grep` 按函数名定点搜（QUICKSTART 里列出关键函数名），**不要整文件读**；FUNCTION_INDEX 提供"函数名→行号→calls"。 | AGENT_QUICKSTART.md §4「工作方式」；FUNCTION_INDEX.md 头注 | 已内置在 Cyl1nder QUICKSTART 与 FUNCTION_INDEX 头注；可再加一条"先 `cyl1nder_index_query` 查索引再 grep"（见 AGENT_GUIDE §1） |
| A4 | **记 devlog 纪律**：每 commit 一句话 + 指向详细文件；新条目**追加**到对应专题文件，不重复全文；README「最近版本」只更新一行摘要。 | AGENT_QUICKSTART.md §4；REFACTOR_PLAN.md 现状基线（js-change-annotations 107KB 线性是最大问题） | Cyl1nder devlog/README 已有「最近版本」单行 + 专题文件，结构正确；遵守"追加不重写、摘要一行"即可 |
| A5 | **版本号规范**：完整版本号写进 config（AHS 在 modules/app-config.js 的 APP_VERSION，显示在顶栏）；主版本与上游对齐，fork 标记 + 分段版本号 + dailybuild 可到 5 位；**每次 commit dailybuild++**。 | development-standards.md「版本号规范」；AGENT_QUICKSTART.md §4 | Cyl1nder 已采纳并改造：`x.xxx.xxxxx`（protocol.py VERSION + web app-config.ts APP_VERSION）+ `scripts/bump-version.mjs`；保持"改协议/改 UI 都要 bump 且三处同步"即可 |
| A6 | **分支纪律**：禁止直接 merge main；大更改（重构/新功能/修 bug）自动独立分支 `版本号-操作`；小改动（文档/缓存号/单点修复）可当前分支直提；**任务类型一变立即开新分支**，不混类型。 | development-standards.md「任务类型分支」 | Cyl1nder 已写 `codex/<版本>-<操作>`；补充一条 AHS 的"小改动可直提"豁免，避免为文档改动开分支 |
| A7 | **常见坑要沉淀**：AGENT_QUICKSTART 第 5 节专列"吸取过的教训"（mask 与绕序必须同步交换、不要直接拿多发丝预设当子发片、gizmo 热更新只作起始基准、删除子发片要重算挖洞等）。 | AGENT_QUICKSTART.md §5 | Cyl1nder 的坑散在 annotations-hda/web 里（cook 缓存→force=True、X6 需 registerNode、three r180 TransformControls 用 getHelper、CORS、回显反馈回路、桥重启 rev 回退）——**应集中进 QUICKSTART「常见坑」** |
| A8 | **决策必须留"为什么"**：Decisions & Why 表（内容/为什么/详见），记录"踩坑纠正"（如 AHS 桥接坐标方向反了两次、端口模型被 grill 纠正）。 | AGENT_QUICKSTART.md §3；decisions.md | Cyl1nder `devlog/decisions.md` 已有（端口模型纠正、序列号落盘、官方 MCP 等）——保持"为什么"栏，别缩成纯结论 |
| A9 | **临时现场日志单独放**：临时 dev 路径/场景信息记独立文件并标注"非永久事实，以实时值为准"。 | local-adaptation-log.md 思路；temp-scene-log.md | Cyl1nder 已有 `devlog/temp-scene-log.md`（当前 hip/serial/bridge/Web UI/fxhoudinimcp 地址）——这是很好的 AHS 变体，继续维护 |

---

## 6. AHS 对 Cyl1nder 的净结论

1. **架构路线已对齐**：Python 控制总线 + JSON 场景 + WebSocket 桥 + MCP + 热更新 + 无构建 dev —— Cyl1nder 与 AHS 的技术结论一致且实现更健康（有 TS、有 pytest、协议单源）。
2. **最该补的三样**（都不是新架构，是"文档/工具补齐"）：
   - QUICKSTART 补「Keep list（关键机制）+ 常见坑」两节（A1/A7）；
   - devlog 补「子系统关键词→专题文件」索引表（A2），让新 agent 按关键词跳读而非顺序读；
   - 三端验证封装成一条命令（V1/V2）+ 修 `gen-index.mjs` 的 TS 导出名 bug（S7）。
3. **并行红线**：唯一跨端共享边界是 `protocol.py ↔ types.ts`，跨端功能单 agent 串行，其余按子系统文件边界切分（P2/P3）。