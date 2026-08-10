# AGENT_QUICKSTART — 新 agent 快速入口

Cyl1nder = Houdini ⇄ 本地桥 ⇄ WebGL 前端 的中间站。目标不是 DCC。

## 先读（按顺序）
1. devlog/README.md — 索引 + 关键理念
2. devlog/decisions.md — 关键决策（端口 grill 纠正、HDA Subnet 多输出、serial 规则）
3. devlog/protocol.md — 通信协议（先看再动 bridge/web/hda 任何一端）
4. devlog/development-standards.md — 分支/版本/标注规范

## 代码地图（定点搜索，不要整文件读）
- 桥：bridge/bridge/{protocol,registry,workspace,logs,routes,ws,main,mcp_server,compute}.py
- 前端：web/src/{app,bridge,stores,nodes2,styles,viewport,tools,protocol}
- Houdini：hda/src/{cyl1nder_serializer,cyl1nder_bridge,cyl1nder_hda}.py
- 索引脚本：scripts/gen-{index,graph,api-index}.mjs

## 常用命令（Windows PowerShell）
- 桥：`cd bridge; .venv\Scripts\python -m bridge`（启动 8375）/ `.venv\Scripts\python -m pytest tests`（测试）
- 前端：`cd web; npm run dev / npm run typecheck / npm test`
- HDA 冒烟：`hython hda/scripts/hython_smoke.py`
- 索引：`node scripts/gen-index.mjs; node scripts/gen-api-index.mjs`

## 验证铁律
- 任何跨端协议改动：bridge pytest + web tsc + hython 冒烟三端同跑。
- 文档改动：Select-String 抽查链接/渲染。
