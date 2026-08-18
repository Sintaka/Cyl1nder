# AGENT_QUICKSTART — 新 agent 快速入口

Cyl1nder = Houdini ⇄ 本地桥 ⇄ WebGL 前端 的中间站。目标不是 DCC。

## 当前焦点（v0.1.00113，新会话先看这里）
- **下一轮（用户已拍板）**：**项目管理 + channel 前端重写**。现状问题（用户实机反馈）：overview 残留测试项目且**没有删除入口**、项目名全是序列号尾巴、`?serial=` 进主应用时**显示 HDA 离线**、data 通道值 UI 还是 `prompt` 版。设计时连带解决这四项。
- **主计划**：`devlog/tag-hda-plan.md`（吊牌 HDA + 项目绑定 + 轨迹页）——P1~P4 完成（v0.1.00106~00110）、P5a/P5b 完成（00111/00112）；P4v2 的 **APEX 读写器已落地**（v0.1.00113，见该节状态更新），**仍搁置**：时间轴互补通道、data 值面板正式 UI（并入下一轮重写）。
- **APEX 相关一律先读 `devlog/apex-runtime-knowledge.md`**（权威，1170 行，已吸收 spaceMouse3 原文，不必再去翻那个目录）；本项目侧落地看 `apex-scene-animate-runtime.md`。
  其中两条**破坏性铁律**必须先看：① 绝不对 `sceneanimate` 的 `animation` Data parm 调 `revertToDefaults()`（会清空整个 APEX 场景）；② APEX 写入实验一律在一次性副本节点上做，不碰用户活动节点。
- **就近上下文**：`devlog/timeline-sync-lag-analysis.md`（通道上限 ~19Hz 与 Sync Max FPS 节流基准）、`devlog/houdini-mcp-integration.md`（runtime 代理）、annotations-{bridge,hda,web}.md 最新版本节（改动全记录）。
- 已有能力底线：geo 全流程 IO、fxhoudinimcp 代理（cmd/python/timeline）、快照持久化、时间轴双向同步、**吊牌 HDA 参数/数据通道注册 + 心跳捎带 + 探测**、**项目层（多 HDA 绑定 + nodeview 项目根 + 项目图）**、**轨迹页审计（/trace.html）**、**非 geo 数据源通道（apex-anim + apex-ctrl 读写器）**、**参数值双向同步（channel-values 端点 + 通道参数面板）**、**APEX 控制器世界位姿读写（apex-ctrl，含世界→局部换算与两趟父子链规则）**。
- 测试基线（v0.1.00113）：pytest 206 / vitest 307 / tsc 0。

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
