# 开发规范 / Development guidelines

- **所有代码最简化**：能简单就不复杂，避免过度设计。
- **仅必要注释**：只写必要注释，不堆砌说明文字。
- **尽量复用成熟开源库**，避免重复造轮子；少写自制半成品。
- **分支管理**：禁止直接 merge main；大改（重构/新功能/修 bug）独立分支 `codex/<版本>-<操作>`（如 `codex/0.1.0-cyl1nder.2-feature`）；小改（文档/版本号/单点修复）可直接在当前分支提交。
- **协议单源**：`bridge/bridge/protocol.py` 是 REST/WS/MCP 的机器可读单源；改动必须同步 `web/src/protocol/types.ts` 与 `devlog/protocol.md`。
- **序列号**：`C1-<base36毫秒>-<4位随机>`，创建时生成写入隐藏参数 `cyl1nder_serial`，不可变；复制节点生成新号。
- **端口**：桥独占 8375，按 serial 路由；绝不为每个 HDA 开新端口。
- **JS/TS 改动标注**：在 devlog 对应专题文件记录与既有代码的差别。
- **版本号（2026-08-10 起，参考 Anime Hair Studio）**：`x.xxx.xxxxx`（主版本.次版本.每日构建5位），如 `0.1.00001`；**每次 commit 时 dailybuild++**；主/次版本升级时 dailybuild 清零。写入 `bridge/bridge/protocol.py` 的 `VERSION`、`web/src/app/app-config.ts` 的 `APP_VERSION`、devlog「最近版本」。用 `node scripts/bump-version.mjs [build|minor|major]` 递增（默认 build）。
- **Codex 子智能体**：适当时候可以直接使用子智能体（并行调研 / 独立小改动）。
- **许可证**：本项目采用 **Cyl1nder Source-Available Non-Commercial License**（见根 LICENSE）：源码可用、**禁止商用**、个人学习/非商业不限、允许修改（宽松，衍生作品同约束并保留声明署名）、**最终使用者负全责、与作者无关**。引入第三方代码时确保许可兼容；Animehairstudio / Zeno(MPL-2.0) 代码只借鉴不复制。

## 调试规范 / Debugging standards（2026-08-10 起累积，按条目追加）
- **Houdini 端与 Codex 一律使用官方 fxhoudinimcp**（pip 包 v2.10.0，github healkeiser/fxhoudinimcp，`python -m fxhoudinimcp`）；默认端口 **8100**，被其他 Houdini 实例占用时自动 8101+（官方 find_servers 探测 8100..8115）。**禁止自己写 MCP 桥；不用 oculairmedia fork / run_houdini_mcp.py / rpyc 18811 那套**。Codex 配置见 `[mcp_servers.fxhoudinimcp]`（config.toml）。
- **Houdini 免重启热重载**（详见 devlog/hda-hot-reload.md）：
  - 改 `hda/src/*.py`：Houdini Python Shell 执行 `exec(open(r"D:/code/dev/Cyl1nder/hda/scripts/reload_hda.py").read()); reload_cyl1nder()`
  - 改 HDA 定义（内部网络/参数/按钮）：`reload_cyl1nder(definition=True)`（重建 + `hou.hda.reloadFile`）
  - 改 bridge 进程：重启 bridge（`cd bridge; .venv\Scripts\python -m bridge`），与 Houdini 无关
- 关键机制：python SOP 用 `cook(force=True)` 强制重跑（普通 cook() 命中缓存）；实例 `maintainstate=0` 使每次 HDA recook 自动重跑新代码。
- **从 Houdini 拉外部 Python 必须剥离 PYTHONHOME/PYTHONPATH**：Houdini 把 `PYTHONHOME` 指向自己的 3.11 stdlib，子进程（如 bridge venv 3.12）继承后启动即崩（SRE module mismatch）。spawn 时 `env={k:v for k,v in os.environ.items() if not k.upper().startswith("PYTHON")}`。详见 annotations-hda v0.1.00010。
- **Houdini 可能随时重启，Codex 不会收到任何消息**：fxhoudinimcp（8100）连不上时按序排查——① 先尝试重连（重试当前 MCP 调用 / 新会话）；② 仍连不上 → 查找是否有 `Houdini.exe` 进程（`tasklist | findstr Houdini` 或 `Get-Process houdini*`）：有进程 = Houdini 在跑，只是 MCP 服务未起/端口变化（看 8100~8115 或让用户确认），无进程 = Houdini 没开，需提示用户启动。不要一上来就假设是 MCP 配置坏了。