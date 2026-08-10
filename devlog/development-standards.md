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
- **使用 fxhoudinimcp 前必须先读官方使用手册**（github healkeiser/fxhoudinimcp 的 README/源码，尤其 `bridge.py` 与工具参数）。工具名/参数一律以官方为准，**禁止凭猜测调用**。已踩过的坑：
  - `shelf.run_shelf_tool` 参数是 `tool_name`（不是 `name`），可选 `kwargs/parent_path`。
  - `code.execute_python` 的代码**不支持顶层 return**（exec 语义）；想返回值就写文件或打印，从外部读。
  - `hou.severityType` 枚举**没有 `Info`**，只有 `Message/Warning/Error/Fatal`。
  - HTTP 直连（免 MCP 客户端）格式：`POST http://127.0.0.1:8100/api`，`Content-Type: application/x-www-form-urlencoded`，body `json=["namespace.function",[args],{kwargs}]`；可用 `mcp.health` / `mcp.list_commands` 探活，用官方包 `from fxhoudinimcp.bridge import HoudiniBridge` 最省事。
- **禁止用会弹 Windows 消息框/错误框的方式调试**（如 `cmd /c start` 引号错误会弹 "Windows cannot find ..."）。调试信息一律写文件/日志（如 `bridge_control.log`、`spawn_out.txt`）或经 fxhoudinimcp 读回，不要用窗口。启动外部进程统一 `subprocess.CREATE_NEW_CONSOLE`（可见但非弹窗）。
- **从 Houdini 拉外部 Python 必须剥离 PYTHONHOME/PYTHONPATH**：Houdini 把 `PYTHONHOME` 指向自己的 3.11 stdlib，子进程（如 bridge venv 3.12）继承后启动即崩（SRE module mismatch）。spawn 时 `env={k:v for k,v in os.environ.items() if not k.upper().startswith("PYTHON")}`。详见 annotations-hda v0.1.00010。
- **Houdini 可能随时重启，Codex 不会收到任何消息**：fxhoudinimcp（8100）连不上时按序排查——① 先尝试重连（重试当前 MCP 调用 / 新会话）；② 仍连不上 → 查找是否有 `Houdini.exe` 进程（`tasklist | findstr Houdini` 或 `Get-Process houdini*`）：有进程 = Houdini 在跑，只是 MCP 服务未起/端口变化（看 8100~8115 或让用户确认），无进程 = Houdini 没开，需提示用户启动。不要一上来就假设是 MCP 配置坏了。
- **浏览器实例注意事项（2026-08-10）**：
  - **命令行/无头开的浏览器与用户手操作的浏览器是不同实例**（不同 profile），`localStorage` / cookie / session **互不互通**。
  - 判断"用户实际看到什么"时，**以用户的浏览器为准**：用户改动的 UI 状态（如 dockview 布局）只存在于用户浏览器，agent 的 headless 浏览器默认看不到。
  - **多关注用户的浏览器**：需要读用户 UI 状态时走**共享通道**——本项目已把 dockview 布局经 `PUT /api/ui/layout` 存到 bridge 文件（`bridge/data/ui-layout.json`），agent 读该文件即拿到用户布局；布局变化也会在 Log 面板输出 `[layout]` 边界摘要。
  - **测试时再自己开**：验证/回归用自己的 Playwright headless 实例（独立 profile），不要假设它等于用户环境；测试中写 localStorage/文件的副作用要清理（如布局测试前备份 `ui-layout.json`，测完恢复）。
