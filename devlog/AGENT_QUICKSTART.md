# AGENT_QUICKSTART — 新 agent 快速入口

Cyl1nder = Houdini ⇄ 本地桥 ⇄ WebGL 前端 的中间站。目标不是 DCC。

## 当前焦点（v0.1.00178，新会话先看这里）
- **进度与计划的唯一真相是 `devlog/in-progress.md`**（倒序编号，**最新是 `## -44`**）。本文件只做入口，不重复维护进度 —— 两处各记一份迟早对不上。
- **主脑先读 `devlog/agent-calibration.md`**：三层分流（脚本 / sonnet 子智能体 / 主脑判断）与每轮收尾的 Retro 纪律。**手跑第 1 层脚本的等价物 = 回归。**
- **刚完成（00159~00171）**：`transform1/t` 同步「大概 1 秒」的排查与修复，**8 个缺陷全清**，专题见 `devlog/tag-t-sync-latency.md`（含总账表）。要点：桥读 vec3 **211→52ms**（少发一次对元组参数注定失败的 `get_parameter`）、web 轮询漏拍消掉（周期 4.24→2.12s）、轮询链断了会自愈、`channel-values` 对 vec3 读写都不再静默失效、后台标签页从停摆 120s 改成「隐藏零请求 + 可见即追赶」、`PUT` 不再对失败的写谎报成功、面板状态点逐行判定（不再整批连坐、不再把 `throttled` 画成绿）。
  **答案本身**：那 ~1s 既不在桥也不在 Houdini，是**纯拉取轮询的平均等待**（周期 2.12s/4.24s，平均陈旧度 ≈ 周期/2 ≈ 1.06s）—— 没有推送路径（心跳 60s 节流且只在 cook 时发）。
- **那一轮攒下的三条方法论教训**（比结论本身更值钱）：
  ① **周期性结论必须在远大于周期的窗口上验** —— 我拿 18 个样本得出「1 秒栅格锁相」，窗口拉到 1059s 后当场崩掉；
  ② **并发不一定有收益** —— Houdini dispatcher 把 `mcp.execute` 排到主线程串行执行，3 次并发(155ms) 与 3 次串行(157ms) 一样；但 `mcp.health` **不经** dispatcher，所以 16 端口并发扫描确实有效。同一份代码里两种调用的并发收益完全不同，**不能照抄**；
  ③ **注释里的版本号必须主进程填** —— 子智能体拿不到「当前版本」这个上下文，三轮里错了三次（两次猜成历史号、一次留占位）。
- **APEX 相关一律先读 `devlog/apex-runtime-knowledge.md`**（权威，1170 行，已吸收 spaceMouse3 原文，不必再去翻那个目录）；本项目侧落地看 `apex-scene-animate-runtime.md`。
  其中两条**破坏性铁律**必须先看：① 绝不对 `sceneanimate` 的 `animation` Data parm 调 `revertToDefaults()`（会清空整个 APEX 场景）；② APEX 写入实验一律在一次性副本节点上做，不碰用户活动节点。
- **就近上下文**：`devlog/timeline-sync-lag-analysis.md`（通道上限 ~19Hz 与 Sync Max FPS 节流基准）、`devlog/houdini-mcp-integration.md`（runtime 代理）、annotations-{bridge,hda,web}.md 最新版本节（改动全记录）。
- 已有能力底线：geo 全流程 IO、fxhoudinimcp 代理（cmd/python/timeline）、快照持久化、时间轴双向同步、**吊牌 HDA 参数/数据通道注册 + 心跳捎带 + 探测**、**项目层（多 HDA 绑定 + nodeview 项目根 + 项目图）**、**轨迹页审计（/trace.html）**、**非 geo 数据源通道（apex-anim + apex-ctrl 读写器）**、**参数值双向同步（channel-values 端点 + 通道参数面板）**、**APEX 控制器世界位姿读写（apex-ctrl，含世界→局部换算与两趟父子链规则）**。
- 测试基线（v0.1.00178，**实测**）：pytest **460** / vitest **972**（51 文件）/ tsc **0** / e2e **111 passed + 1 skipped**（2.1 分钟，全量跑完 teardown 自动扫掉合成项目，实测项目/serial/通道行三项均回到基线，零泄漏）。
  基线数字每轮都会变，**发现对不上时以实际跑出来的为准**，别信这一行（它只是给你一个量级参照）。

## 先读（按顺序）
1. **devlog/in-progress.md — 进度与计划的唯一真相**（倒序，先看最上面那几节）
2. devlog/README.md — 专题文件索引（含归档标注）+ 关键理念
3. devlog/protocol.md — 通信协议（先看再动 bridge/web/hda 任何一端）
4. devlog/development-standards.md — 分支/版本/并行子智能体/编码卫生/调试规范
5. devlog/tag-hda-plan.md — 吊牌 HDA 主计划（P1~P5b **已完成**；**仍搁置**：时间轴互补通道、data 值面板正式 UI）

## 代码地图（定点搜索，不要整文件读）
- 桥：bridge/bridge/{protocol,registry,workspace,logs,routes,ws,main,state,snapshot,houdini_mcp,houdini_routes,snapshot_routes,channel_routes,project_routes,trace,trace_routes,channels,projects,data_adapters,mcp_server}.py
- 前端：web/src/{app,bridge,stores,nodes2,styles,viewport,tools,protocol,core}（页面：index/overview/trace.html；面板：channel-panel.ts）
- Houdini：hda/src/{cyl1nder_serializer,cyl1nder_bridge,cyl1nder_hda,cyl1nder_houdini_mcp,cyl1nder_sync,cyl1nder_tag}.py
- 索引脚本：scripts/gen-{index,graph,api-index}.mjs；延迟基准 scripts/bench_mcp_latency.py

## 常用命令（Windows PowerShell）
- 桥：`cd bridge; .venv\Scripts\python -m bridge`（启动 8375）/ `.venv\Scripts\python -m pytest tests`（测试）
- 前端：`cd web; npm run dev / npm run typecheck / npm test`（e2e 串行，见 playwright.config）
- **e2e 不要用 `npx`**：本环境下 `npx.ps1` 会撞 `StandardOutputEncoding is only supported when standard output is redirected` 直接起不来（v0.1.00164 实测，子智能体与主进程各撞一次）。改走
  `node node_modules/@playwright/test/cli.js test [文件] --reporter=list`。
  同理 `npm test` 偶发同一条错时也可退到 `node node_modules/vitest/vitest.mjs run`。
- **e2e 会连真桥（8375）与已在跑的 vite（8376）**：`reuseExistingServer: true`，所以**不要另起 vite**，也不要去杀它 —— 8376 上可能正是用户开着的页面。
- HDA 冒烟：`hython hda/scripts/hython_smoke.py`
- HDA 热重载（改 hda/src 后）：Houdini Python Shell 跑 `hda/scripts/reload_hda.py` 的 `reload_cyl1nder()`
- 索引：`node scripts/gen-index.mjs; node scripts/gen-api-index.mjs; node scripts/gen-graph.mjs`

## 固化脚本（第 1 层：别再手跑它们的等价物）
一律用 `node` 跑，**不要写成 `.ps1`**（`pwsh` 不在 harness 可信前缀名单，
子进程继承沙箱限制 → pytest 在 `mktemp` 处 PermissionError、vitest 在 esbuild 处 EPERM；
详见 development-standards「编排脚本必须是 `.mjs`」）。

| 用途 | 命令 |
|---|---|
| 三端门禁（pytest + tsc + vitest [+ hython]） | `node scripts/verify-all.mjs --skip-hython [--staged]` |
| 发布仪式（bump + 三索引 + quickstart 同步） | `node scripts/release-step.mjs --pytest=N --vitest=N` |
| 活体巡检（桥/vite/MCP + 基线断言） | `node scripts/probe-live.mjs [--projects=N --serials=N --channels=N]` |
| 提交前卫生（只看新增行） | `pwsh -File scripts\check-staged.ps1` |

统一退出码约定：`0` 通过 / `1` 真实失败 / `2` VACUOUS（**空扫描不算通过**）/ `3` 工具没跑起来。

**脚本自报 exit 0 不算验证**：`release-step.ps1` 曾打印 `6/6 完成` + exit 0 却什么都没做
（`$Args` 是自动变量被遮蔽 → 退化成裸 `node` → 裸 `node` exit 0）。
**跑完要验它真的改了东西**（版本号动了没、索引 mtime 动了没）。

## 验证铁律
- 任何跨端协议改动：bridge pytest + web tsc + hython 冒烟三端同跑（e2e 按需）。
- **提交前跑 `pwsh -File scripts\check-staged.ps1`**（v0.1.00170 新增）：只看**新增行**，
  查三类问题——写工具静默截断 `[N chars omitted]`、变异测试标记残留、中文乱码（3+ 连续 `?`）。
  `exit 0` 通过 / `exit 1` 有问题 / **`exit 2` = VACUOUS**（0 行可查，不构成通过）。
  **不要手搓 grep 代替它**：我手搓的那版在一个会话里误报三次，最后一次我在它打红之后
  照样提交了——**一个被训练成可以忽略的检查，比没有检查更坏**（全过程见 in-progress §-43）。
- 文档改动：中文经 edit/write 工具或 UTF-8 无 BOM 写入。**别用裸 `??` 抽查**——
  JS 的空值合并运算符和散文引用它都会命中；要判乱码就按「3 个以上连续 `?`」判。
