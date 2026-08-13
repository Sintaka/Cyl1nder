# 开发规范 / Development guidelines

- **所有代码最简化**：能简单就不复杂，避免过度设计。
- **仅必要注释**：只写必要注释，不堆砌说明文字。
- **尽量复用成熟开源库**，避免重复造轮子；少写自制半成品。
- **分支管理（2026-08-13 起统一单主线）**：唯一长期主线分支 **`codex/develop`**，所有轮次都在其上提交（每次 commit 即版本检查点，见版本号规则）；**不再为每一轮开 `codex/<版本>-<操作>` 分支**（历史证明那只是同一条直线的重复指针，无隔离价值，徒增混乱——已清理）。仅在真正需要**并行/分叉**实验时才开短命特性分支（`codex/try-<主题>`），合入后即删；GitHub 默认分支保持指向 `codex/develop`。禁止直接改写已发布历史（`main`/已推提交）。
- **协议单源**：`bridge/bridge/protocol.py` 是 REST/WS/MCP 的机器可读单源；改动必须同步 `web/src/protocol/types.ts` 与 `devlog/protocol.md`。
- **序列号**：`C1-<base36毫秒>-<4位随机>`，创建时生成写入隐藏参数 `cyl1nder_serial`，不可变；复制节点生成新号。
- **端口**：桥独占 8375，按 serial 路由；绝不为每个 HDA 开新端口。
- **JS/TS 改动标注**：在 devlog 对应专题文件记录与既有代码的差别。
- **版本号（2026-08-10 起，参考 Anime Hair Studio）**：`x.xxx.xxxxx`（主版本.次版本.每日构建5位），如 `0.1.00001`；**每次 commit 时 dailybuild++**；主/次版本升级时 dailybuild 清零。写入 `bridge/bridge/protocol.py` 的 `VERSION`、`web/src/app/app-config.ts` 的 `APP_VERSION`、devlog「最近版本」。用 `node scripts/bump-version.mjs [build|minor|major]` 递增（默认 build）。
- **Codex 子智能体**：适当时候可以直接使用子智能体（并行调研 / 独立小改动）。
- **许可证**：本项目采用 **Cyl1nder Source-Available Non-Commercial License**（见根 LICENSE）：源码可用、**禁止商用**、个人学习/非商业不限、允许修改（宽松，衍生作品同约束并保留声明署名）、**最终使用者负全责、与作者无关**。引入第三方代码时确保许可兼容；Animehairstudio / Zeno(MPL-2.0) 代码只借鉴不复制。
- **设计理念：缓存与后端计算管理学习 Zeno + Houdini；能用开源就用开源（2026-08-13 起，铁律）**：① 缓存/计算管理以 Houdini（cook-on-dirty DAG、显示驱动 cook、detail 缓存 + 增量 P、交互不重 cook、bgeo.sc）与 Zeno（显式节点缓存、stamp none/data/topology 变化分级、双缓冲增量 diff、SoA→TypedArray、帧缓存）为参考系，借鉴方法论不复制代码（Zeno MPL-2.0 可借鉴；Houdini 闭源只对齐行为）——详见 cache-display-research.md / cache-system-guide.md；② 能用开源就用开源：优先成熟第三方库（three.js / rete.js / FastAPI / FastMCP / msgpack / orjson / fast-deep-equal 等），自研仅限协议胶水、轻量交互与无成熟等价物的领域逻辑（group 表达式 / undo 回放 / 链缓存）——取舍清单见 oss-reuse-audit.md，引入前核对许可证兼容；③ 交互/术语/语义对齐 Houdini（gizmo 拖拽即时跟手、display 排他、参数表）。

﻿## 并行修改规范 / Parallel modification standards（2026-08-11 起）
**规则（铁律）：用户要求"codex 子智能体并行完成"时，主进程必须按此流程执行，子智能体必须遵守。**

1. **先评估，再调结构，最后并行**：
   - 评估各改动落在哪些文件；**同文件 = 不能并行**（会互相覆盖），**不同文件 = 可直接并行**。
   - 值得调整结构时**先由主进程改结构**（如把共享单文件拆成按域小文件），使每个子智能体的写集完全不相交，然后再 spawn。
2. **写集（write set）唯一**：每个子智能体只允许修改分配到的文件清单，**禁止碰任何其他文件**。CSS 归属固定：`base.css`(全局壳/滚动条) / `nodeview.css`(节点图) / `viewport.css`(3D视口) / `dock.css`(docking) / `spreadsheet.css`(表格)。
3. **跨文件交互先定契约**：需要联动（如 main.ts 传 display focus 给 spreadsheet）时，主进程先在任务里写死函数签名/参数契约，子智能体按契约实现；主进程负责另一侧（如 main.ts 的调用点）在合并时补上。
4. **视觉样式冲突时的应急**：某 agent 的样式本应进 CSS 但 CSS 归属他人 → 用**内联样式**（element.style.cssText），不越界改 CSS 文件。
5. **各自验证**：每个 agent 提交前必须 `node node_modules/typescript/bin/tsc --noEmit`（web 目录）通过，并尽量用 Playwright headless Edge 连**已在跑的 8376 dev server** 自测（禁止另起 vite）。
6. **主进程合并**：全部 agent 完成后，主进程统一 review diff → 全量验证（tsc / vitest / pytest / e2e / verify-all / 综合 Playwright 复测）→ 更新 devlog + 索引 + 版本号 → 单个 commit。
7. **并行纪律**：agent 之间互不等待、互不读对方未提交的中间态；发现工作区有其他进程的并发修改时**不动它们**（只做自己写集）。
8. 完成并行任务后，把"本次结构拆分"与"并行过程"记入 devlog（annotations-web / README 最近版本）。

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

## 编码与 Git 卫生 / Encoding & git hygiene（2026-08-11 起）
- **禁止用 `@'...'@ | python -` 管道传中文/非 ASCII 内容**：PowerShell 把 here-string 按 `$OutputEncoding`（默认 ASCII）编码写进 python stdin，所有中文会变成字面 `?`（已踩坑：5 个 devlog 文件被写坏）。写含中文的文件用：
  - PowerShell here-string + `[System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))`（UTF-8 无 BOM）；或
  - 先 `Set-Content -Encoding utf8` 写 UTF-8 临时文件，再让 python 用 `utf-8-sig` 读取。
  - 写完用 `??` 特征抽查（`Select-String -Pattern '\?\?'`）。
- **PowerShell 里外部命令输出是字符串数组（按行拆分）**：`git show` / `git log` / `Get-Content` 直接赋值得到的是 `string[]`。要当文本用必须先 `$out -join "`n"`；**严禁对数组直接 `.TrimEnd()` / `+ 字符串` 拼接**——数组会被隐式转成"用空格连接的一行"，毁掉 md 的换行/分隔线结构（已踩坑：viewport-bug-report / annotations-web 首行被压成 1.6 万字符）。
- **git 历史卫生**：devlog/文档保持小体积；**禁止把大文件或日志（如 append 循环产物）提交进历史**——GitHub 硬拒 >100MB、警告 >50MB，push 会被 pre-receive 拒绝。
- **历史清理流程（破坏性，先备份）**：① `git bundle create <path>.bundle --all` 全量备份；② `git filter-branch --force --index-filter "if git cat-file -e \"$GIT_COMMIT:<path>\" 2>/dev/null; then git update-index --cacheinfo 100644,<新blob>,<path>; fi" -- <branch>` 把该文件在每个提交替换为小版本；③ 删 `refs/original` + `git reflog expire --expire=now --all` + `git gc --prune=now --aggressive`；④ 验证 `git cat-file --batch-all-objects --batch-check` 无 >1MB blob；⑤ `git push --force-with-lease`。**备份在确认远端一切正常前不删**（partial clone 下 prune 后旧对象本地不可恢复，bundle 是唯一备份）。

## 代码修改默认派子智能体（铁律，2026-08-11 起）
**主进程（Codex 主管）收到「继续开发 / 实现 X / 修复 Y」这类编码任务时，默认把代码修改交给并行 codex 子智能体执行——即使只有 1 个智能体也照派。用户不需要每次重复说明。**

- **主进程职责**：拆写集（写集不相交）→ 先定契约（函数签名/数据结构写死在任务里；必要时主进程先改结构建骨架文件锚定契约）→ 派发 → 合并 review → 全量验证（tsc/vitest/pytest/E2E）→ 更新 devlog + 索引 + 版本号 → 单 commit。
- **子智能体职责**：只改分配到的写集文件，按契约实现，各自 `tsc --noEmit` 通过并尽量 Playwright 自测，完成后回报改了哪些文件。
- **主进程自己的写集**：仅限 ① devlog/文档/版本号/索引；② 合并时补契约另一侧的调用点（如 main.ts）；③ 拆结构用的骨架/契约锚点文件。
- **例外**：纯调研/只读任务、临时调试、一行级 hotfix 可主进程直接做；除此之外一律派子智能体。

## UI 规范（2026-08-13 起）
- **File/Edit 等顶层菜单标签保持纯文字**（.cyl-menu-label，不加 ▲▼ caret / 名称块）；只有「需要显示当前选中值」的选择控件（底部 Update Mode / 首选项 Update Mode·UI Font / 调色板 harmony 等）才用 Layout 箭头框（createDropdown）。
- **下拉菜单统一 Layout 风格**：任何下拉选择（底部栏 Update Mode / 首选项 Update Mode·UI Font / 调色板 harmony 等）一律用 `web/src/app/widgets.ts` 的 `createDropdown`（圆角矩形触发盒 = 左侧 ▲▼ caret + 当前值名称块；弹出面板 = `.cyl-menu-drop`）。**不再用原生 `<select>`**。
- **带箭头的数值输入统一 Sync Max FPS 步进风格**：用 `createStepper`（圆角矩形容器 + 数字输入 + 右侧 ▲▼ 步进列），保留 `inputId` 让 label `for` 指向内部 input；**不再用带原生 spinner 的裸 `input[type=number]`**（颜色通道 / 参数表这类已有滑块或中键 scrub 的除外）。
- 所有按钮 / 输入 / 面板统一圆角矩形（4-6px）、深色（#1b1e24 / #0f1012），焦点描边 `#2b6cb0`。
- 下拉控件要在所属面板 `close()` 里 `destroy()`（清理 document 级监听）；stepper 无需 destroy。
