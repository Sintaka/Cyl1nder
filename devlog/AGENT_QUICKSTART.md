# AGENT_QUICKSTART — 新 agent 快速入口

Cyl1nder = Houdini ⇄ 本地桥 ⇄ WebGL 前端 的中间站。目标不是 DCC。

## 当前焦点（v0.1.00104，新会话先看这里）
- **主计划**：`devlog/tag-hda-plan.md`（吊牌 HDA + 项目绑定 + 轨迹页，P1~P4 分阶段 + 写集 + 验收）。
- **架构提案**：`devlog/tag-hda-project-design.md`（用户原始需求 + 6 个 ⚖️ 待拍板决策点——**P1 启动前必须先与用户确认**）。
- **就近上下文**：`devlog/timeline-sync-lag-analysis.md`（卡顿判责 + 通道上限 ~19Hz）、`devlog/houdini-mcp-integration.md` + `fxhoudinimcp-tools-index.md`（runtime 改参与时间轴通道现状）、`devlog/snapshot-fix-00102.md`（快照恢复机制）。
- 已有能力底线：geo 全流程 IO（HDA 4 入 4 出）、fxhoudinimcp 代理（cmd/python/timeline）、快照持久化与重启恢复、时间轴双向同步（Sync Max FPS 制约）。

## 先读（按顺序）
1. devlog/README.md — 索引（含归档标注）+ 关键理念 + 最近版本
2. devlog/tag-hda-plan.md — **下一阶段主计划（当前执行对象）**
3. devlog/protocol.md — 通信协议（先看再动 bridge/web/hda 任何一端）
4. devlog/development-standards.md — 分支/版本/并行子智能体/编码卫生/调试规范

## 代码地图（定点搜索，不要整文件读）
- 桥：bridge/bridge/{protocol,registry,workspace,logs,routes,ws,main,state,snapshot,houdini_mcp,houdini_routes,snapshot_routes,mcp_server}.py
- 前端：web/src/{app,bridge,stores,nodes2,styles,viewport,tools,protocol,core}
- Houdini：hda/src/{cyl1nder_serializer,cyl1nder_bridge,cyl1nder_hda,cyl1nder_houdini_mcp,cyl1nder_sync}.py
- 索引脚本：scripts/gen-{index,graph,api-index}.mjs；延迟基准 scripts/bench_mcp_latency.py

## 常用命令（Windows PowerShell）
- 桥：`cd bridge; .venv\Scripts\python -m bridge`（启动 8375）/ `.venv\Scripts\python -m pytest tests`（测试）
- 前端：`cd web; npm run dev / npm run typecheck / npm test / npx playwright test`（e2e 串行，见 playwright.config）
- HDA 冒烟：`hython hda/scripts/hython_smoke.py`
- HDA 热重载（改 hda/src 后）：Houdini Python Shell 跑 `hda/scripts/reload_hda.py` 的 `reload_cyl1nder()`
- 索引：`node scripts/gen-index.mjs; node scripts/gen-api-index.mjs; node scripts/gen-graph.mjs`

## 验证铁律
- 任何跨端协议改动：bridge pytest + web tsc + hython 冒烟三端同跑（e2e 按需）。
- 文档改动：中文经 edit/write 工具或 UTF-8 无 BOM 写入，写完抽查 `??`。
