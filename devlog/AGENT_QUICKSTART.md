# AGENT_QUICKSTART — 新 agent 快速入口

Cyl1nder = Houdini ⇄ 本地桥 ⇄ WebGL 前端 的中间站。目标不是 DCC。

## 当前焦点（v0.1.00111，新会话先看这里）
- **主计划**：`devlog/tag-hda-plan.md`（吊牌 HDA + 项目绑定 + 轨迹页）——**P1~P4 全部完成（v0.1.00106~00110），P5 参数同步极致化 P5a 已完成**；P4v2（apex animstack 读写器/时间轴互补通道）**搁置**；P5b（gizmo 绑定/轨迹 ndjson 落盘）为下轮候选，恢复时读计划文件对应节。
- **就近上下文**：`devlog/timeline-sync-lag-analysis.md`（通道上限 ~19Hz 与 Sync Max FPS 节流基准）、`devlog/houdini-mcp-integration.md`（runtime 代理）、annotations-{bridge,hda,web}.md 最新版本节（改动全记录）。
- 已有能力底线：geo 全流程 IO、fxhoudinimcp 代理（cmd/python/timeline）、快照持久化、时间轴双向同步、**吊牌 HDA 参数/数据通道注册 + 心跳捎带 + 探测**、**项目层（多 HDA 绑定 + nodeview 项目根 + 项目图）**、**轨迹页审计（/trace.html）**、**非 geo 数据源通道（apex-anim 读写器）**、**参数值双向同步（channel-values 端点 + 通道参数面板）**。

## 先读（按顺序）
1. devlog/README.md — 索引（含归档标注）+ 关键理念 + 最近版本
2. devlog/tag-hda-plan.md — **下一阶段主计划（当前执行对象）**
3. devlog/protocol.md — 通信协议（先看再动 bridge/web/hda 任何一端）
4. devlog/development-standards.md — 分支/版本/并行子智能体/编码卫生/调试规范

## 代码地图（定点搜索，不要整文件读）
- 桥：bridge/bridge/{protocol,registry,workspace,logs,routes,ws,main,state,snapshot,houdini_mcp,houdini_routes,snapshot_routes,channel_routes,project_routes,trace,trace_routes,channels,projects,data_adapters,mcp_server}.py
- 前端：web/src/{app,bridge,stores,nodes2,styles,viewport,tools,protocol,core}（页面：index/overview/trace.html；面板：channel-panel.ts）
- Houdini：hda/src/{cyl1nder_serializer,cyl1nder_bridge,cyl1nder_hda,cyl1nder_houdini_mcp,cyl1nder_sync,cyl1nder_tag}.py
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
