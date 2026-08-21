# AGENTS.md — Cyl1nder 协作规范（给 Codex / 人类 agent 看）

Cyl1nder 是"中间站"项目：Houdini ⇄ 本地桥 ⇄ WebGL 前端 的轻量数据通道。
目标不是做成 DCC，而是最大限度复用现成库、保持轻量、用良好结构降低 token 消耗。

## 仓库结构
- `bridge/` Python 3.12 本地桥（FastAPI + WebSocket + FastMCP）：单进程独占 8375，按 serial 路由
- `hda/` Houdini 侧 Subnet HDA（4 输入/4 输出）+ Python 模块（序列化 / 桥客户端）
- `web/` Vite + TypeScript 前端（Three.js 视口 + @antv/x6 节点图），无 UI 框架
- `mcp/` MCP 启动器与安装脚本（Houdini MCP 补全 + Cyl1nder 桥 MCP）
- `scripts/` 机器生成索引脚本（函数索引 / 依赖图 / API 索引）
- `devlog/` 规范、决策、改动标注、协议（先读这里）

## 铁律
1. 序列号 `cyl1nder_serial` 创建时生成、持久化、不可变；cook 时绝不现算；复制节点生成新号。
2. 单桥 8375 + serial 路由；不要为每个 HDA 开端口。
3. 协议以 `bridge/bridge/protocol.py` 为单源；改协议必须同步 `web/src/protocol/types.ts` 与 `devlog/protocol.md`。
4. 不复制 Animehairstudio 代码（source-available 许可），只借鉴架构与方法论。
5. 分支：统一主线 `codex/develop`；仅在并行实验时开短命 `codex/try-<主题>`，合入即删（细则见 devlog/development-standards.md）。
6. 改动记 devlog：每 commit 一句话 + 指向专题文件。
7. 验证：bridge=pytest；web=`tsc --noEmit` + vitest；hda=hython 冒烟；跨端=E2E。
8. **代码修改默认派并行 codex 子智能体**（细则见 devlog/development-standards.md「代码修改默认派子智能体（铁律）」）：主进程负责拆写集（不相交）→ 定契约 → 派发 → 合并 review → 全量验证 → 文档/版本号/索引 → 单 commit；即使只有 1 个子智能体也照派；主进程写集仅限 devlog/文档/版本号/索引/契约锚点。

## 常用命令
见 devlog/AGENT_QUICKSTART.md。

## 主脑三层分流（铁律，2026-08-21 起）
主脑的思考是最贵的资源，只花在**判断**上。动手前先归层：

| 层 | 判据 | 交给谁 |
|---|---|---|
| 1 | 确定性、可重复、零上下文 | **脚本**：`verify-all.ps1`（三端门禁）/ `release-step.ps1`（版本号+索引+quickstart）/ `check-staged.ps1`（提交前卫生） |
| 2 | 机械但需读代码、临场判读 | **sonnet-5 子智能体**（`provider=luminai-claude`） |
| 3 | 判断、解释、**拒绝行动** | 主脑自己 |

- **手跑第 1 层脚本的等价物 = 回归**。确定性事实交脚本（退出码不必复核）；
  交 LLM 得到的是「它对事实的报告」，可信度低于事实本身，还得复核一遍，净亏。
- 派活的公共前言在 `devlog/SUBAGENT_BRIEF.md`，任务书只写「先读它 + 本次差异」。
- **每轮收尾做一次 Retro**：点数重复操作 → 归层 → 固化或记账，见
  `devlog/agent-calibration.md`。

## Houdini 集成（铁律）
- Houdini 端与 Codex 一律用**官方 fxhoudinimcp**（pip 包 `fxhoudinimcp`，命令 `python -m fxhoudinimcp`），默认端口 **8100**、被占自动 8101+。**禁止自己写 MCP 桥、禁止用 oculairmedia fork / run_houdini_mcp.py / rpyc 18811**。
- Houdini 免重启热重载：改 `hda/src/*.py` 用 `hda/scripts/reload_hda.py`（`reload_cyl1nder()` / `reload_cyl1nder(definition=True)`）；细节见 `devlog/hda-hot-reload.md`。