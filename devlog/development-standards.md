# 开发规范 / Development guidelines

- 所有代码最简化：能简单就不复杂，避免过度设计。
- 仅必要注释：只写必要注释，不堆砌说明文字。
- 尽量复用成熟开源库，避免重复造轮子；少写自制半成品。
- 分支管理（2026-08-13 起统一单主线）：唯一长期主线分支 `codex/develop`，所有轮次都在其上提交（每次 commit 即版本检查点，见版本号规则）；不再为每一轮开 `codex/<版本>-<操作>` 分支（历史证明那只是同一条直线的重复指针，无隔离价值，徒增混乱——已清理）。仅在真正需要并行/分叉实验时才开短命特性分支（`codex/try-<主题>`），合入后即删；GitHub 默认分支保持指向 `codex/develop`。**禁止**直接改写已发布历史（`main`/已推提交）。
- 协议单源：`bridge/bridge/protocol.py` 是 REST/WS/MCP 的机器可读单源；改动必须同步 `web/src/protocol/types.ts` 与 `devlog/protocol.md`。
- 序列号：`C1-<base36毫秒>-<4位随机>`，创建时生成写入隐藏参数 `cyl1nder_serial`，不可变；复制节点生成新号。
- 端口：桥独占 8375，按 serial 路由；绝不为每个 HDA 开新端口。
- JS/TS 改动标注：在 devlog 对应专题文件记录与既有代码的差别。
- 版本号（2026-08-10 起，参考 Anime Hair Studio）：`x.xxx.xxxxx`（主版本.次版本.每日构建5位），如 `0.1.00001`；每次 commit 时 dailybuild++；主/次版本升级时 dailybuild 清零。写入 `bridge/bridge/protocol.py` 的 `VERSION`、`web/src/app/app-config.ts` 的 `APP_VERSION`、devlog「最近版本」。用 `node scripts/bump-version.mjs [build|minor|major]` 递增（默认 build）。
- 子智能体：适当时候可以直接使用子智能体（并行调研 / 独立小改动）。
- 许可证条款见根 `LICENSE`，此处不复述。引入第三方代码时核对许可兼容；Animehairstudio / Zeno(MPL-2.0) 只借鉴不复制。
- 设计理念：缓存与后端计算管理学习 Zeno + Houdini；能用开源就用开源（2026-08-13 起，铁律）：① 缓存/计算管理以 Houdini（cook-on-dirty DAG、显示驱动 cook、detail 缓存 + 增量 P、交互不重 cook、bgeo.sc）与 Zeno（显式节点缓存、stamp none/data/topology 变化分级、双缓冲增量 diff、SoA→TypedArray、帧缓存）为参考系，借鉴方法论不复制代码（Zeno MPL-2.0 可借鉴；Houdini 闭源只对齐行为）——详见 cache-display-research.md / cache-system-guide.md；② 能用开源就用开源：优先成熟第三方库（three.js / rete.js / FastAPI / FastMCP / msgpack / orjson / fast-deep-equal 等），自研仅限协议胶水、轻量交互与无成熟等价物的领域逻辑（group 表达式 / undo 回放 / 链缓存）——取舍清单见 oss-reuse-audit.md，引入前核对许可证兼容；③ 交互/术语/语义对齐 Houdini（gizmo 拖拽即时跟手、display 排他、参数表）。

## 并行修改规范（2026-08-11 起）
铁律：要求"子智能体并行完成"时，主脑按此流程执行，子智能体必须遵守。

1. 先评估，再调结构，最后并行：
   - 评估各改动落在哪些文件；同文件 = 不能并行（会互相覆盖），不同文件 = 可直接并行。
   - 值得调整结构时先由主脑改结构（如把共享单文件拆成按域小文件），使每个子智能体的写集完全不相交，然后再 spawn。
2. 写集（write set）唯一：每个子智能体只允许修改分配到的文件清单，**禁止碰任何其他文件**。CSS 归属固定：`base.css`(全局壳/滚动条) / `nodeview.css`(节点图) / `viewport.css`(3D视口) / `dock.css`(docking) / `spreadsheet.css`(表格)。
3. 跨文件交互先定契约：需要联动（如 main.ts 传 display focus 给 spreadsheet）时，主脑先在任务里写死函数签名/参数契约，子智能体按契约实现；主脑负责另一侧（如 main.ts 的调用点）在合并时补上。
4. 视觉样式冲突时的应急：某 agent 的样式本应进 CSS 但 CSS 归属他人 → 用内联样式（element.style.cssText），不越界改 CSS 文件。
5. 各自验证：每个 agent 提交前必须 `node node_modules/typescript/bin/tsc --noEmit`（web 目录）通过，并尽量用 Playwright headless Edge 连已在跑的 8376 dev server 自测（禁止另起 vite）。
6. 主脑合并：全部 agent 完成后，主脑统一 review diff → 全量验证（tsc / vitest / pytest / e2e / verify-all / 综合 Playwright 复测）→ 更新 devlog + 索引 + 版本号 → 单个 commit。
7. 并行纪律：agent 之间互不等待、互不读对方未提交的中间态；发现工作区有其他进程的并发修改时不动它们（只做自己写集）。
8. 完成并行任务后，把"本次结构拆分"与"并行过程"记入 devlog（annotations-web / README 最近版本）。

## 调试规范 / Debugging standards（2026-08-10 起累积，按条目追加）
- Houdini 端一律使用官方 fxhoudinimcp（pip 包 v2.10.0，github healkeiser/fxhoudinimcp，`python -m fxhoudinimcp`）；默认端口 8100，被其他 Houdini 实例占用时自动 8101+（官方 find_servers 探测 8100..8115）。**禁止自己写 MCP 桥；不用 oculairmedia fork / run_houdini_mcp.py / rpyc 18811 那套**。Codex 配置见 `[mcp_servers.fxhoudinimcp]`（config.toml）。
- Houdini 免重启热重载（详见 devlog/hda-hot-reload.md）：
  - 改 `hda/src/*.py`：Houdini Python Shell 执行 `exec(open(r"D:/code/dev/Cyl1nder/hda/scripts/reload_hda.py").read()); reload_cyl1nder()`
  - 改 HDA 定义（内部网络/参数/按钮）：`reload_cyl1nder(definition=True)`（重建 + `hou.hda.reloadFile`）
  - 改 bridge 进程：**重启一律走 Houdini shelf `cyl1nder::reload_bridge`**（内部 `bridge_control.restart_bridge()`：按端口 8375/8376 定位 LISTENING 进程后重启，并顺带拉起 vite 8376；结果落 `bridge_control.log`）。`cd bridge; .venv\scripts\python -m bridge` 手动起桥仅用于无 Houdini 的自起场景；与 Houdini 无关。
- 关键机制：python SOP 用 `cook(force=True)` 强制重跑（普通 cook() 命中缓存）；实例 `maintainstate=0` 使每次 HDA recook 自动重跑新代码。
- 使用 fxhoudinimcp 前必须先读官方使用手册（github healkeiser/fxhoudinimcp 的 README/源码，尤其 `bridge.py` 与工具参数）。工具名/参数一律以官方为准，**禁止凭猜测调用**。已踩过的坑：
  - `shelf.run_shelf_tool` 参数是 `tool_name`（不是 `name`），可选 `kwargs/parent_path`。
  - `code.execute_python` 的代码不支持顶层 return（exec 语义）；想返回值就写文件或打印，从外部读。
  - `hou.severityType` 枚举**没有 `Info`**，只有 `Message/Warning/Error/Fatal`。
  - HTTP 直连（免 MCP 客户端）格式：`POST http://127.0.0.1:8100/api`，`Content-Type: application/x-www-form-urlencoded`，body `json=["namespace.function",[args],{kwargs}]`；可用 `mcp.health` / `mcp.list_commands` 探活，用官方包 `from fxhoudinimcp.bridge import HoudiniBridge` 最省事。
- fxhoudinimcp 对接铁律（v0.1.00102 起，详见 devlog/fxhoudinimcp-compendium.md / houdini-mcp-integration.md）：
  - 端口识别：HDA 启动时获取「本 Houdini 实例」的 MCP 端口 = 扫 8100..8115 发 `mcp.health`，**`pid == os.getpid()` 是唯一可靠判据**（实测安装版 health 不带 hip_file；多实例时首个存活端口可能错实例——8100 是我们的测试实例，8101 是另一个 Houdini，绝不凭「第一个活口」猜）。Cyl1nder 已实现：`hda/src/cyl1nder_houdini_mcp.py`（纯 stdlib，发现跑短命 daemon 线程）+ 上报 bridge registry.mcpPort。
  - 死锁红线（实机复现）：HDA cook 主线程**禁止**同步 POST `mcp.execute`（dispatcher 必须回主线程执行，主线程却阻塞在 HTTP 上 → 直到超时）。`mcp.health` 探针例外（不经 dispatcher）。`mcp.execute` 的正规调用方只有 bridge（to_thread）。
  - 时间轴双向同步走 bridge 代理：`GET/PUT /api/hda/{serial}/timeline`（0.25s 缓存 get_frame / 0.1s 节流 set_frame）；命令白名单 `houdini_mcp.ALLOWED_COMMAND_PREFIXES`。
  - 安装版 fxhoudinimcp 端口被占不自动 8101+（那是 dev 版行为）、绑 0.0.0.0 无鉴权——只走 127.0.0.1，防火墙责任在使用者。
- reload HDA 崩溃注意（v0.1.00102 补）：热重载前必须 `stop_all_sync`（已内置于 reload_hda.py）；新 HDA 模块不得自带长生命周期线程（发现线程为短命 daemon + 纯 urllib，reload 无需额外停线）；HDA 定义层（definition=True）比运行时层（reload_cyl1nder()）风险高，非必要不重建定义。本轮实机热重载 2 次（8100 实例）均无崩溃。
- **禁止用会弹 Windows 消息框/错误框的方式调试**（如 `cmd /c start` 引号错误会弹 "Windows cannot find ..."）。调试信息一律写文件/日志（如 `bridge_control.log`、`spawn_out.txt`）或经 fxhoudinimcp 读回，不要用窗口。启动外部进程统一 `subprocess.CREATE_NEW_CONSOLE`（可见但非弹窗）。
- 从 Houdini 拉外部 Python 必须剥离 PYTHONHOME/PYTHONPATH：Houdini 把 `PYTHONHOME` 指向自己的 3.11 stdlib，子进程（如 bridge venv 3.12）继承后启动即崩（SRE module mismatch）。spawn 时 `env={k:v for k,v in os.environ.items() if not k.upper().startswith("PYTHON")}`。详见 annotations-hda v0.1.00010。
- Houdini 可能随时重启，主脑不会收到任何消息：fxhoudinimcp（8100）连不上时按序排查——① 先尝试重连（重试当前 MCP 调用 / 新会话）；② 仍连不上 → 查找是否有 `Houdini.exe` 进程（`tasklist | findstr Houdini` 或 `Get-Process houdini*`）：有进程 = Houdini 在跑，只是 MCP 服务未起/端口变化（看 8100~8115 或让用户确认），无进程 = Houdini 没开，需提示用户启动。不要一上来就假设是 MCP 配置坏了。
- **禁止随意杀进程（铁律，2026-08-15 起）**：本机同时跑着无关的 Python 项目（HQueue Server/Client、其他 Python312 进程）与 harness 托管的后台任务——**绝不允许按 PID 直接 `Stop-Process`/`taskkill` 杀进程**（进程清单里的 python 与端口无可靠映射，曾因试图杀候选 PID 被用户否决）。桥重启一律走官方路径：Houdini shelf `cyl1nder::reload_bridge`（内部 `bridge_control.restart_bridge()`，只按端口 8375/8376 精确定位 LISTENING 进程，并顺带拉起 vite）；Houdini MCP（8100）**绝不杀**；自己的后台任务用 job_kill；除桥外的任何进程（HQueue 等）一律不动。
- 浏览器实例注意事项（2026-08-10）：
  - 命令行/无头开的浏览器与用户手操作的浏览器是不同实例（不同 profile），`localStorage` / cookie / session 互不互通。
  - 判断"用户实际看到什么"时，以用户的浏览器为准：用户改动的 UI 状态（如 dockview 布局）只存在于用户浏览器，agent 的 headless 浏览器默认看不到。
  - 多关注用户的浏览器：需要读用户 UI 状态时走共享通道——本项目已把 dockview 布局经 `PUT /api/ui/layout` 存到 bridge 文件（`bridge/data/ui-layout.json`），agent 读该文件即拿到用户布局；布局变化也会在 Log 面板输出 `[layout]` 边界摘要。
  - 测试时再自己开：验证/回归用自己的 Playwright headless 实例（独立 profile），不要假设它等于用户环境；测试中写 localStorage/文件的副作用要清理（如布局测试前备份 `ui-layout.json`，测完恢复）。

## 过长标识串一律「中间省略」/ Middle-elide long identifiers（2026-08-19 起，铁律）

**任何可能过长的标识串（路径 / 序列号 / 逻辑名 / 节点名）在 UI 上截断时，一律保头保尾、中间用 `…`，禁止砍尾。** 实现见 `web/src/app/elide.ts`（`elideMiddle` / `elidePath`）。

理由（不是审美，是信息论）：这类字符串的辨识信息集中在两端——
- 路径：头部是盘符/项目（`D:/Animation_Project/…`），尾部是文件名（`beginTest-1.hip`）。中段目录层级恰恰是最不需要看的部分。
- 序列号：`C1-msm6dsp7-ob6t`，前缀表类型、后 4 位是唯一区分位。砍尾等于砍掉唯一能区分两个序列号的部分——两个不同 serial 会显示成同一个字符串，这比截断更糟：它制造了看起来相同的不同东西。
- 映射逻辑名：`sandbox_sceneanimate/point_1/tx`，尾段（`tx` vs `ty`）才是区分点。

策略照 Windows Explorer / VS Code 的路径显示。

配套要求：
- 完整值**必须**进 `title`（省略是显示层行为，不能丢信息）。
- 比较/去重/存储一律用完整值，**绝不**拿省略后的字符串当 key。
- 适用位置（全量）：overview 通道行与项目 hip 小字、nodeview 项目根节点、面板标题、映射表逻辑名、地址栏分段。

## 写入长度：分块，且写完必查 / Chunk every write（2026-08-20 起，铁律）

症状：单次 `write`/`edit` 的内容超长时会被静默截断，在文件里留下一句字面量
`...[N chars omitted]...`。它不是注释、不是占位符，就是一段非法源码。

为什么必须当铁律：截断产生的是语法错误，而报出来的往往是别的现象——
`SyntaxError: invalid syntax`、`Unexpected token`、`'NoneType' object is not iterable`、
甚至测试"失败"但错误信息与真因毫无关系（2026-08-20 一天内踩 6 次，其中 3 次在排查
"产品 bug"，实际跑的是被截断的语法错误源码）。

硬性纪律：
- 单次写入 ≤ 50 行且 ≤ 4000 字符。超了就拆成多次 `edit` 追加，或先写骨架再补内容。
- 每次写完立刻验：
  `node -e "const t=require('fs').readFileSync('<path>','utf8');console.log(t.includes('chars omitted'))"`
  —— 命中就先修文件，别去跑测试（跑了也只会得到误导性的错误）。
- 测试文件同样适用。夹具被截断时，测试会以"产品坏了"的形态失败。
- **往 e2e 里塞多行 `page.evaluate()` 最容易中招**：那种代码天然又长又密。
- 与 `??`（编码坏）、`-\uFEFF`（BOM 被吃）一样，属于写完必查清单的一项。

## Shell：项目硬性要求 pwsh 7 / pwsh 7 is mandatory（2026-08-20 起）

要求：所有命令跑在 pwsh 7+（PSEdition = Core）。本机 `powershell.exe` 5.1 确实存在，
兜底风险是真的 —— 5.1 的 `Set-Content -Encoding utf8` 默认带 BOM，会悄悄污染 diff。

这是唯一需要做的事（开工时一次，不是每次写文件）：
```powershell
if ($PSVersionTable.PSEdition -ne 'Core' -or $PSVersionTable.PSVersion.Major -lt 7) {
  throw "需要 pwsh 7+（当前 $($PSVersionTable.PSVersion) $($PSVersionTable.PSEdition)）"
}
```

**pwsh 7 下 `-Encoding utf8` 就是无 BOM**（7.6.5 实测：首字节 `78 0D 0A`；`utf8BOM` 才给
`EF BB BF`）。所以**不要每次写完手工验 BOM** —— 成本前移到开工卡一次 shell 即可。
想显式可写 `-Encoding utf8NoBOM`。

唯一残留的 BOM 风险：`edit`/`write` 工具可能吃掉已有文件的 BOM（工具行为，与 shell 无关）。
这条已并入 `scripts\check-staged.ps1`（查删除行里的 `^-\uFEFF`），**不要手搓等价检查**。

## 编码与 Git 卫生 / Encoding & git hygiene（2026-08-11 起）
- **禁止用 `@'...'@ | python -` 管道传中文/非 ASCII 内容**：PowerShell 把 here-string 按 `$OutputEncoding`（默认 ASCII）编码写进 python stdin，所有中文会变成字面 `?`（已踩坑：5 个 devlog 文件被写坏）。写含中文的文件用：
  - PowerShell here-string + `[System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))`（UTF-8 无 BOM）；或
  - 先 `Set-Content -Encoding utf8` 写 UTF-8 临时文件，再让 python 用 `utf-8-sig` 读取。
  - 乱码抽查**不要手搓**（裸 `??` 会命中 JS 空值合并运算符和讨论它的散文，一个会话误报 5 次，
    最后我在它打红之后照样提交了 —— 被训练成可以忽略的检查比没有检查更坏）。
    统一跑 `pwsh -File scripts\check-staged.ps1`。
    判乱码要按真实形态「3 个以上连续 `?`」（`\?{3,}`）判，且散文引用要豁免。
    别手搓，直接跑 `pwsh -File scripts\check-staged.ps1`（见下节）。
- **PowerShell `Invoke-RestMethod -Body` 传中文 JSON 同样会变 `?`**（body 字符串按 Latin-1 编码；2026-08-15 实踩：项目 label "P2a 验收项目" 落库成 "P2a ????"）：中文 body 改用 `[System.Text.Encoding]::UTF8.GetBytes($json)` 传字节数组，或验收/测试数据一律用 ASCII。
- PowerShell 里外部命令输出是字符串数组（按行拆分）：`git show` / `git log` / `Get-Content` 直接赋值得到的是 `string[]`。要当文本用必须先 `$out -join "`n"`；**严禁对数组直接 `.TrimEnd()` / `+ 字符串` 拼接**——数组会被隐式转成"用空格连接的一行"，毁掉 md 的换行/分隔线结构（已踩坑：viewport-bug-report / annotations-web 首行被压成 1.6 万字符）。
- git 历史卫生：devlog/文档保持小体积；**禁止把大文件或日志（如 append 循环产物）提交进历史**——GitHub 硬拒 >100MB、警告 >50MB，push 会被 pre-receive 拒绝。
- 历史清理流程（破坏性，先备份）：① `git bundle create <path>.bundle --all` 全量备份；② `git filter-branch --force --index-filter "if git cat-file -e \"$GIT_COMMIT:<path>\" 2>/dev/null; then git update-index --cacheinfo 100644,<新blob>,<path>; fi" -- <branch>` 把该文件在每个提交替换为小版本；③ 删 `refs/original` + `git reflog expire --expire=now --all` + `git gc --prune=now --aggressive`；④ 验证 `git cat-file --batch-all-objects --batch-check` 无 >1MB blob；⑤ `git push --force-with-lease`。备份在确认远端一切正常前不删（partial clone 下 prune 后旧对象本地不可恢复，bundle 是唯一备份）。

## 编排脚本必须是 `.mjs`，不能是 `.ps1`（沙箱可信前缀，2026-08-21 实测）
症状：同一套命令，直接跑全绿，包进 `verify-all.ps1` 再跑就崩：
- pytest 460 errors，全是 `PermissionError: [WinError 5] 拒绝访问` 落在 `tmp_path_factory.mktemp`；
- vitest `Error: spawn EPERM`，来自 `esbuild` 的 `ensureServiceIsRunning`（不许开命名管道）。

机制：本 harness 只对少数可信前缀解除文件沙箱 ——
`git` / `node` / `npm` / `pnpm` / `hython` / `.venv\scripts\python`。**`pwsh` 不在其中。**
`pwsh -File x.ps1` 的首个 token 是 `pwsh`，整个进程受限，它 spawn 的子进程继承这个限制。

实测对照（一次性 node 探针，跑完即删）：

| 调用方式 | 首个 token | 结果 |
|---|---|---|
| `.venv\Scripts\python -m pytest tests -q` | 可信 | 460 passed |
| `node node_modules/vitest/vitest.mjs run` | 可信 | 972 passed |
| `pwsh -File verify-all.ps1 -SkipHython` | 不可信 | pytest 460 errors / vitest spawn EPERM |
| node 里 `spawnSync(..., stdio:'inherit')` 起同样两条 | 可信 | 972 passed，exit 0 |

纪律：
- **需要 spawn 子进程的编排脚本一律写成 `.mjs`，用 `node` 跑**（`scripts/verify-all.mjs`）。
- `spawnSync` **默认的 `'pipe'` 会 EPERM**（沙箱不许开命名管道）。只要不需要读取输出，
  用 `stdio: 'inherit'` 让它直接打到控制台。

### 想读取子进程输出：用真实文件 fd，不要用管道（2026-08-21 实测）
沙箱卡的是「开管道」，不是「写文件」。所以给 `stdio` 塞一个由
`fs.openSync()` 拿到的真实文件描述符就能拿到文本：

```js
const fd = fs.openSync(tmp, "w");
const r = spawnSync("git", ["log", "-1", "--format=%h %s"], { stdio: ["ignore", fd, "ignore"] });
fs.closeSync(fd);
const text = fs.readFileSync(tmp, "utf8").trim();   // 拿到了，中文也正常
```

实测对照（同一个 node 脚本里跑）：

| 写法 | 结果 |
|---|---|
| `spawnSync("git", [...], { encoding: "utf8" })`（默认 pipe） | EPERM，`stdout` 是 `undefined` |
| `stdio: 'inherit'` | 能跑（exit 0），但拿不到文本 |
| `stdio: ['ignore', fd, 'ignore']`（`fs.openSync`） | exit 0 且拿到完整文本 |

这条推翻了我原先的判断：我在派活任务书里断言「只有 inherit 或 `--output=` 两条路」，
子智能体实测找出了第三条并且更通用 —— 因为 `--output=` 只有个别 git 子命令支持：
`git log --output=<file>` 可用，而 `git status --output=` / `git ls-files --output=`
都是 `unknown option`（exit 129）。fd 那条路对任何外部命令都成立。

`scripts/commit-step.mjs` 的 `runGitCapture()` 就是这么实现的，可直接抄。
- 只调 `git`、只读写 `$env:TEMP` 与仓库的 `.ps1` 仍可用（`check-staged.ps1` 实测 exit 0），
  **但别再往 `.ps1` 里加 pytest/vitest/esbuild 这类会 spawn 或写 TEMP 的步骤**。
- 判「工具没跑起来」看 `result.error` / `result.status === null`，**不要靠 try/catch**
  （`spawnSync` 不抛，失败塞在返回值里）。

### 环境实测事实（`--output=` 陷阱 / libuv 退出崩溃 / `$Args` 遮蔽）
→ 已移入 [sandbox-env-facts.md](sandbox-env-facts.md)（写 `.mjs`、用 `spawnSync`、
定退出码之前查一次即可，不是每轮必读）。

## 卫生检查交给脚本，不要手搓 grep（2026-08-21 起）
提交前一律跑 `pwsh -File scripts\check-staged.ps1`，**别再手写等价的 grep**。

四个退出码（都是实测触发过的，不是声明）：

| 码 | 含义 | 该怎么办 |
|---|---|---|
| 0 | 干净 | 可以提交 |
| 1 | 发现问题 | 停下来看，别照常提交 |
| 2 | VACUOUS：0 行可查 | 不构成通过——什么都没检查，先确认暂存内容 |
| 3 | 工具自身失败 | 修工具，这不是卫生结论 |

为什么必须是脚本而不是 LLM：这是确定性事实判定，脚本给的是退出码；
交给智能体（含我自己临场手写 grep）得到的是「它对该事实的报告」，可信度低于事实本身，
于是还得复核一遍 —— 净亏。本会话证据：子智能体报「变异 2 条红」而实际是 4 条；
手搓 grep 误报 5 次。

改判据必须重新用金丝雀验：埋一条真问题确认它变红，再删。
只见过它说 OK 的检测器等于没测过（同 §-37「探针先转常驻再删」）。

## 三层分流：机械的交脚本，机械但需判读的交 sonnet，判断留主脑（2026-08-21 起）
主脑（主管）的思考是最贵的资源，必须用在判断上。分流判据：

| 层 | 判据 | 交给谁 | 反例（本会话的实际浪费） |
|---|---|---|---|
| 1 | 确定性、可重复、零上下文 | 脚本（无 LLM） | 提交仪式手跑 ~12 次、完整性抽查 ~15 次、门禁手搓 7 轮 |
| 2 | 机械但需临场判读/适配代码 | sonnet-5 子智能体 | 这层用对了 |
| 3 | 判断、解释、拒绝行动 | 主脑 | 应当只剩这层 |

- 第 1 层已脚本化，**命令清单见 `devlog/AGENT_QUICKSTART.md`「固化脚本」表**（此处不重复，
  两处各记一份迟早对不上）。一律 `node scripts/*.mjs`。手跑它们的等价物 = 回归。
- 第 3 层的典型形态往往是不动手：本会话最高价值的一次决策是判断"读侧跳过通道"
  是合理降级、刻意不修（写侧同形状却是撒谎）。这种判断脚本和子智能体都做不了。
- 派活的公共前言沉到 `devlog/SUBAGENT_BRIEF.md`，任务书只写"先读它 + 本次差异"
  （本会话 10 份任务书里约 40% 是重复样板）。

## 代码修改默认派子智能体（铁律，2026-08-11 起）
主脑收到「继续开发 / 实现 X / 修复 Y」这类编码任务时，默认把代码修改交给并行子智能体执行——即使只有 1 个智能体也照派。用户不需要每次重复说明。

- 主脑职责：拆写集（写集不相交）→ 先定契约（函数签名/数据结构写死在任务里；必要时主脑先改结构建骨架文件锚定契约）→ 派发 → 合并 review → 全量验证（tsc/vitest/pytest/E2E）→ 更新 devlog + 索引 + 版本号 → 单 commit。
- 子智能体职责：只改分配到的写集文件，按契约实现，各自 `tsc --noEmit` 通过并尽量 Playwright 自测，完成后回报改了哪些文件。
- 主脑自己的写集：仅限 ① devlog/文档/版本号/索引；② 合并时补契约另一侧的调用点（如 main.ts）；③ 拆结构用的骨架/契约锚点文件。
- 例外：纯调研/只读任务、临时调试、一行级 hotfix 可主脑直接做；除此之外一律派子智能体。

## UI 规范（2026-08-13 起）
- File/Edit 等顶层菜单标签保持纯文字（.cyl-menu-label，不加 ▲▼ caret / 名称块）；只有「需要显示当前选中值」的选择控件（底部 Update Mode / 首选项 Update Mode·UI Font / 调色板 harmony 等）才用 Layout 箭头框（createDropdown）。
- 下拉菜单统一 Layout 风格：任何下拉选择（底部栏 Update Mode / 首选项 Update Mode·UI Font / 调色板 harmony 等）一律用 `web/src/app/widgets.ts` 的 `createDropdown`（圆角矩形触发盒 = 左侧 ▲▼ caret + 当前值名称块；弹出面板 = `.cyl-menu-drop`）。**不再用原生 `<select>`**。
- 带箭头的数值输入统一 Sync Max FPS 步进风格：用 `createStepper`（圆角矩形容器 + 数字输入 + 右侧 ▲▼ 步进列），保留 `inputId` 让 label `for` 指向内部 input；**不再用带原生 spinner 的裸 `input[type=number]`**（颜色通道 / 参数表这类已有滑块或中键 scrub 的除外）。
- 所有按钮 / 输入 / 面板统一圆角矩形（4-6px）、深色（#1b1e24 / #0f1012），焦点描边 `#2b6cb0`。
- 下拉控件要在所属面板 `close()` 里 `destroy()`（清理 document 级监听）；stepper 无需 destroy。
