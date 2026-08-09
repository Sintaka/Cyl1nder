# Cyl1nder Agent 检索流程 / 函数引导目录 / 项目结构指南

> 面向新 agent（或 Codex 会话）的仓库使用手册。基于现有结构（2026-08-10，v0.1.00003，22 个 serials），只读建议，未改任何文件。
> 仓库根：`D:\code\dev\Cyl1nder`

---

## 0. 现状基线（一句话）

Cyl1nder 是「Houdini ⇄ 本地桥 ⇄ WebGL 前端」的中间站：Python 桥（FastAPI+WS+FastMCP，127.0.0.1:8375）按 serial 路由；HDA（Subnet，4 进 4 出）推输入/拉编辑结果；web（Vite+TS，Three.js + @antv/x6）查看/编辑。全仓库 138 个函数/类，devlog 已具备三层索引雏形，体积小、边界清晰——**当前不需要大重构，重点是检索效率与文档补齐**。

---

## 1. 快速检索流程（三层金字塔 + MCP 优先）

```
L0 入口层（先读，<5 分钟）
   AGENTS.md                      —— 铁律（serial / 单桥 8375 / 协议单源 / 官方 MCP / 分支）
   devlog/README.md               —— devlog 字典 + 关键理念 + 最近版本
   devlog/AGENT_QUICKSTART.md     —— 代码地图 + 常用命令 + 验证铁律（必读）
   ↓ 按任务类型跳读 ↓
   devlog/decisions.md            —— 端口模型/序列号/HDA 形态/官方 MCP 的为什么
   devlog/development-standards.md—— 分支/版本/标注规范 + 调试规范（热重载三层）
   devlog/temp-scene-log.md       —— 当前 Houdini hip / serial / 各服务地址（实时值以 fxhoudinimcp 为准）

L1 检索层（定位函数/接口，机器生成 + MCP）
   devlog/FUNCTION_INDEX.md/.json —— 138 函数：文件→函数→行号→calls（hub 指标）
   devlog/API_INDEX.md            —— REST / WS / MCP 工具清单 + 源码行号
   devlog/MODULE_GRAPH.md         —— web/src 模块依赖（谁 import 谁）
   MCP 工具（桥在线时最快）：
     cyl1nder_index_query("关键词")  —— 搜 FUNCTION_INDEX/API_INDEX 返回行命中
     cyl1nder_list_serials / cyl1nder_get_status(serial)
     cyl1nder_read_logs / cyl1nder_get_errors(serial?, limit)
     cyl1nder_get_geometry_summary(serial, io)
   PowerShell 定点搜（索引命中后）：
     Select-String -Path D:\code\dev\Cyl1nder\bridge\bridge\*.py -Pattern "run_node"
     git -C D:\code\dev\Cyl1nder grep -n "inputsEqual" -- web/src

L2 详情层（按子系统读专题，不要顺序读全文）
   devlog/protocol.md             —— 人读协议（改协议前必读；机器单源 bridge/bridge/protocol.py）
   devlog/annotations-bridge.md   —— 桥改动标注（v0.1.00003 回显去重/自愈等）
   devlog/annotations-hda.md      —— HDA 改动标注（force cook/双向同步/反馈回路修复）
   devlog/annotations-web.md      —— web 改动标注（auto-run/回放/漂移修复/CORS）
   devlog/hda-hot-reload.md       —— 三层热重载手册（改 hda/src vs 定义 vs bridge 进程）
   源码头注（每个 .py/.ts 顶部 docstring 即职责）—— 桥 state/workspace/routes/ws 等
```

**检索顺序决策树**：

1. 任务涉及**协议/载荷**（serial、inputs/outputs 结构、WS 消息）→ 先 `devlog/protocol.md` + `bridge/bridge/protocol.py`，改协议必须三处同步（protocol.py / web/src/protocol/types.ts / protocol.md）。
2. 任务涉及**某个函数** → 先 `cyl1nder_index_query` 或 grep FUNCTION_INDEX.md 拿到 `文件:行号` → 再 `Select-String`/读该文件该段，**不整文件读**。
3. 任务涉及**某个 API 端点** → `API_INDEX.md` 拿到 routes.py:行号 → 读对应 handler。
4. 任务涉及**web 状态流转**（inputs 回放 / auto-run / 编辑回推）→ 读 `web/src/main.ts` + `stores/workspace.ts` + `bridge/client.ts`（三处联动）。
5. 任务涉及**Houdini 侧** → 先 `temp-scene-log.md` 拿现场 serial/hip → fxhoudinimcp（8100）实时查节点，改 `hda/src/*.py` 用 `reload_hda.py` 免重启。
6. 任务涉及**compute/节点执行器扩展** → `bridge/bridge/compute/__init__.py`（注册表模式）+ `compute/passthrough.py` 示例。

---

## 2. 函数引导目录（按子系统，`文件:行号` 为索引现值）

### 2.1 bridge 桥（`bridge/bridge/`）

| 文件 | 职责 | 关键函数（行号） |
|---|---|---|
| `protocol.py` | **协议单源**：serial 规则 + 载荷模型 + VERSION | `generate_serial`(37) / `is_valid_serial`(48) / `InputPayload`(63) / `OutputBuffer`(73) / `InputsPut`(83) / `OutputsPut`(91) |
| `registry.py` | serial 注册表（创建即不可变，JSON 落盘 data/registry.json） | `SerialRegistry`(67) / `register`(75) / `get`(102) / `touch`(106) / `serials`(116) |
| `workspace.py` | per-serial 输入 + 按输出 index 独立 rev 的缓冲 | `Workspace`(10) / `set_inputs`(19) / `put_outputs`(24，含回显去重) / `get_outputs_since`(46) / `WorkspaceStore`(96) |
| `logs.py` | 环形日志（1000 条，level/serial 过滤） | `LogRing`(32) / `add`(37) / `query`(48) / `errors`(58) |
| `routes.py` | REST 端点 | `put_inputs`(51) / `get_outputs`(67) / `put_outputs`(76) / `pending`(91，30fps 脏检查) / `serial_logs`(99) / `global_logs`(109) |
| `ws.py` | WebSocket 分桶 + 广播 + 连接回放 | `ConnectionManager`(14) / `broadcast`(32) / `ws_endpoint`(53) |
| `state.py` | 共享单例（registry+workspaces+logs），测试用 reset | `BridgeState`(12) / `get_state`(30) / `reset_state`(37) |
| `mcp_server.py` | FastMCP 7 工具（含读索引） | `cyl1nder_ping`(32) / `cyl1nder_get_status`(45) / `cyl1nder_get_geometry_summary`(69) / `cyl1nder_index_query`(79) |
| `compute/__init__.py` | **执行器注册表（预留扩展点）** | `register_executor`(32) / `run_node`(40) / `ComputeExecutor`(23) |
| `compute/passthrough.py` / `ctypes_stub.py` | v1 直通 + 原生 pyd/dll 演示桩 | `PassthroughExecutor.run`(11) / `NativeStubExecutor.run`(41) |

### 2.2 hda Houdini 侧（`hda/`）

| 文件 | 职责 | 关键函数（行号） |
|---|---|---|
| `src/cyl1nder_hda.py` | 内部 4 个 Python SOP 的 cook 逻辑 + 双向同步 | `cook`(167) / `_ensure_serial`(111) / `ensure_sync`(83) / `_sync_loop`(24) / `_force_cook_node`(58) / `_set_status`(134) |
| `src/cyl1nder_bridge.py` | 纯 stdlib 桥客户端（可脱离 Houdini 单测） | `BridgeClient`(35) / `push_inputs`(52) / `pending_outputs`(87) / `pull_outputs`(102) / `generate_serial`(28) |
| `src/cyl1nder_serializer.py` | Houdini 几何 → JSON 载荷 | `serialize_input`(20) |
| `scripts/reload_hda.py` | 免重启热重载入口 | `reload_cyl1nder`(75) / `_force_recook_all`(48) |
| `scripts/build_hda.py` | 重建 HDA 本体（一般不需要） | `build`(95) |
| `scripts/hython_smoke.py` | 无头冒烟（serial 不可变 / 推拉 / 几何） | `main`(51) |

### 2.3 web 前端（`web/src/`）

| 文件 | 职责 | 关键导出（行号） |
|---|---|---|
| `main.ts` | 编排层：接线布局/图/桥/store/视口 + auto-run + 回放门控 | `runNetwork`(83) / `connect`(102) / `inputStatsText`(32) |
| `bridge/client.ts` | REST+WS 客户端（连接、推送、订阅） | `BridgeClient`(23) / `connectWs` |
| `stores/workspace.ts` | **唯一状态 store**（pub-sub，per-serial） | `WorkspaceStore`(6) |
| `nodes/cyl1nderNode.ts` | X6 节点图（4 进 4 出数据流 + 边） | `createGraph` / `registerNodes` / `upsertFlowGraph`(9) |
| `viewport/renderer.ts` | Three 视口 + TransformControls + 编辑回推回调 | `Viewport`(13) |
| `viewport/geometry.ts` | 输入 JSON → 线/管几何 | (12) |
| `viewport/controls.ts` | Houdini 式导航（Alt 拖拽） | (8) |
| `tools/transform.ts` | 平移编辑 → OutputBuffer | (5) |
| `protocol/types.ts` | **协议 TS 镜像（与 protocol.py 同步）** | InputPayload/OutputBuffer 类型 |
| `protocol/compare.ts` | 内容相等判定（回显去重 / auto-run 触发条件） | `payloadEqual`(3) / `inputsEqual`(14) |

### 2.4 scripts 生成器（`scripts/`）

| 文件 | 职责 | 命令 |
|---|---|---|
| `gen-index.mjs` | 函数索引（web .ts + bridge/hda .py） | `node scripts/gen-index.mjs` |
| `gen-api-index.mjs` | REST/WS/MCP API 索引 | `node scripts/gen-api-index.mjs` |
| `gen-graph.mjs` | web/src 模块依赖图 | `node scripts/gen-graph.mjs` |
| `bump-version.mjs` | 版本号递增（build/minor/major，默认 build） | `node scripts/bump-version.mjs [build\|minor\|major]` |

---

## 3. 建议项目结构（现状 + 注释 + 调整建议）

```text
D:\code\dev\Cyl1nder\
├─ AGENTS.md                      # 铁律：serial/单桥/协议单源/官方 MCP/分支/验证/热重载
├─ README.md                      # 项目定位 + 快速开始 + 目录表（保持）
├─ bridge\                        # ★ Python 本地桥（FastAPI+WS+FastMCP，8375）
│  ├─ pyproject.toml              # 依赖：fastapi/uvicorn/websockets/fastmcp/pydantic；dev: pytest/httpx
│  ├─ README.md                   # 运行/结构/测试命令
│  ├─ bridge\
│  │  ├─ protocol.py              # 协议单源（serial/载荷/VERSION）——改协议三处同步
│  │  ├─ registry.py              # serial 注册表（JSON 落盘 data/registry.json）
│  │  ├─ workspace.py             # per-serial 输入 + rev 输出缓冲（回显去重）
│  │  ├─ logs.py                  # 环形日志
│  │  ├─ routes.py                # REST 端点（health/serials/inputs/outputs/pending/logs）
│  │  ├─ ws.py                    # WS 分桶 + 广播 + 回放
│  │  ├─ state.py                 # 共享单例 + 测试 reset
│  │  ├─ mcp_server.py            # FastMCP 工具（Codex 用）
│  │  ├─ main.py                  # create_app 装配
│  │  └─ compute\                 # ★ 执行器注册表（扩展点：node_type → executor）
│  │     ├─ __init__.py           # register_executor/run_node（ComfyUI 式懒加载预留）
│  │     ├─ passthrough.py        # v1 直通执行器
│  │     └─ ctypes_stub.py        # 原生 pyd/dll 演示桩
│  ├─ tests\                      # pytest：registry/workspace/routes/mcp
│  └─ data\                       # registry.json（运行时生成）
├─ hda\
│  ├─ README.md                   # 数据流/热更新/安装/serial 说明
│  ├─ package\cyl1nder.json       # Houdini 包（PYTHONPATH 注入 hda/src）
│  ├─ otls\Cyl1nder_1.0.hda       # 构建产物（backup/ 为历史备份，勿手动改）
│  ├─ src\                        # ★ 运行时逻辑（薄壳之外，热重载）
│  │  ├─ cyl1nder_hda.py          # 4 个 python SOP 的 cook + 双向同步
│  │  ├─ cyl1nder_bridge.py       # 纯 stdlib 桥客户端
│  │  └─ cyl1nder_serializer.py   # Houdini 几何 → JSON
│  ├─ scripts\                    # build_hda / hython_smoke / reload_hda
│  └─ shelf\Cyl1nder.shelf        # 工具架（Reload HDA / Reload Bridge）
├─ web\                           # ★ Vite + TS（strict），无 UI 框架
│  ├─ package.json                # dev/build/typecheck/test/e2e 脚本；three + @antv/x6
│  ├─ vite.config.ts              # 127.0.0.1:8376 strictPort；vitest node 环境
│  ├─ playwright.config.ts        # e2e（连真实桥）
│  ├─ src\
│  │  ├─ main.ts                  # 编排层（接线，不写业务）
│  │  ├─ app\                     # app-config（APP_VERSION）/ layout / log
│  │  ├─ bridge\client.ts         # REST+WS 客户端
│  │  ├─ nodes\cyl1nderNode.ts    # X6 数据流节点图
│  │  ├─ protocol\                # types.ts（协议镜像）+ compare.ts（相等判定）
│  │  ├─ stores\workspace.ts      # 唯一状态 store（新状态必须进这里）
│  │  ├─ tools\transform.ts       # 编辑工具
│  │  ├─ viewport\                # renderer/geometry/controls
│  │  └─ styles.css
│  ├─ tests\                      # vitest（compare/protocol/workspace）
│  └─ e2e\smoke.spec.ts           # Playwright 冒烟
├─ mcp\                           # 启动器 + 安装脚本（README 含两套 MCP 配置）
├─ scripts\                       # gen-index / gen-api-index / gen-graph / bump-version
└─ devlog\                        # ★ 检索入口（L0/L1/L2）
   ├─ README.md                   # 字典 + 关键理念 + 最近版本
   ├─ AGENT_QUICKSTART.md         # 先读（建议补 Keep list + 常见坑）
   ├─ development-standards.md    # 分支/版本/标注/调试/热重载规范
   ├─ decisions.md                # 决策 + 为什么（端口/serial/HDA 形态/MCP）
   ├─ protocol.md                 # 人读协议（与 protocol.py/types.ts 三处同步）
   ├─ FUNCTION_INDEX.md/.json     # 机器生成函数目录（重跑：node scripts/gen-index.mjs）
   ├─ API_INDEX.md                # 机器生成 API 目录
   ├─ MODULE_GRAPH.md             # web/src 依赖图
   ├─ annotations-{bridge,hda,web}.md  # 按子系统改动标注（追加不重写）
   ├─ hda-hot-reload.md           # 三层热重载手册
   └─ temp-scene-log.md           # 临时现场（非永久事实）
```

**结构调整建议（按收益排序，均为可选）**：

1. **修 `scripts/gen-index.mjs` 的 TS 导出名 bug（高收益、零风险）**：非 Python 分支 `const name = m[1] || m[2]` 会把所有 `export function/class` 记成名字 `"export "`（FUNCTION_INDEX.md 里 web 侧全部是 `export ` 即此 bug），web 侧索引失效。改为 `const name = m[2]`，重跑索引即可。这是目前"函数引导目录"对 web 端最痛的缺口。
2. **新增 `scripts/verify-all.ps1`**：一条命令依次跑 `bridge pytest → web tsc+vitest → hython 冒烟`（三端铁律脚本化，对应 AHS REFACTOR_PLAN「验证策略」），可在失败处停下并打印哪端挂了。避免 agent 只跑一端。
3. **QUICKSTART 补两节**：`Keep list（关键机制）`（协议单源三处同步、serial 创建即不可变、单桥 8375、官方 fxhoudinimcp、30fps 双向同步 + 回显去重 + 桥重启自愈、compute 注册表扩展点）与 `常见坑`（python SOP 缓存→`cook(force=True)`；X6 `Node.define` 不自动注册→`Graph.registerNode`；three r180 `TransformControls extends Controls`→`getHelper()`；auto-run 首帧 inputs 视为回放不触发网络；bridge 重启 rev 回退→`since > rev` 返回全部；CORS 8376→8375）。
4. **devlog/README 或新页加「子系统关键词→专题文件」索引表**（对标 AHS js-change-annotations.md）：例如 `serial → registry.py / decisions.md`、`回显/反馈回路 → annotations-hda.md`、`rev/pending/30fps → annotations-bridge.md + protocol.md`、`auto-run/回放 → annotations-web.md`。让 agent 按关键词跳读，不顺序读。
5. **新增 `devlog/web-state.md`（一页）**：记录 web 唯一状态入口（`stores/workspace.ts`）的字段语义（serial/inputs/outputs/inputRev/outputRev/status/logs/selectedInputIndex）与"回放 vs auto-run"触发条件——对标 AHS STATE_MANAGEMENT.md 的轻量版，防止未来在 main.ts 加裸全局。
6. **新增 `devlog/ROADMAP.md`（一页，可选）**：对标 AHS REFACTOR_PLAN.md——列出 compute/ 执行器扩展、节点图 DAG 执行、glTF/二进制几何、发布期打包（Vite build + 可选 Tauri）等候选批次 + 每批的验证方式；小项目不需要阶段表，一个"候选批次 + 依赖边界"列表即可。
7. **不建议**：为拆而拆（138 函数无需 15 store 式重构）；不要新增 `web/src/graph/` 之类的目录直到节点系统真的变大；`hda/otls/backup/*` 保持只读、靠 build_hda.py 重建。

---

## 4. 常用命令（Windows PowerShell）

```powershell
# 桥（127.0.0.1:8375）
cd D:\code\dev\Cyl1nder\bridge
.venv\Scripts\python -m bridge                    # 启动 REST+WS
.venv\Scripts\python -m bridge.mcp_server         # 启动 MCP（stdio）
.venv\Scripts\python -m pytest tests              # 桥单测

# 前端（Vite HMR，127.0.0.1:8376）
cd D:\code\dev\Cyl1nder\web
npm run dev                                       # dev server
npm run typecheck                                 # tsc --noEmit（TS 即文档）
npm test                                          # vitest
npm run e2e                                       # Playwright（需桥已启动）

# HDA
"$env:HFS\bin\hython.exe" hda/scripts/hython_smoke.py   # 冒烟（需桥已启动）
# 热重载 hda/src/*.py（Houdini Python Shell）：
exec(open(r"D:/code/dev/Cyl1nder/hda/scripts/reload_hda.py").read()); reload_cyl1nder()
# 重建 HDA 本体（一般不需要）：
"$env:HFS\bin\hython.exe" hda/scripts/build_hda.py

# 索引与版本
cd D:\code\dev\Cyl1nder
node scripts/gen-index.mjs; node scripts/gen-api-index.mjs; node scripts/gen-graph.mjs
node scripts/bump-version.mjs [build|minor|major]   # 每次 commit build++

# 定点检索
Select-String -Path D:\code\dev\Cyl1nder\bridge\bridge\*.py -Pattern "get_outputs_since"
git -C D:\code\dev\Cyl1nder grep -n "inputsEqual" -- web/src
```

---

## 5. 维护纪律（写进 devlog 的约定）

1. **每次 commit**：一句话 + 指向专题文件；dailybuild+1（`node scripts/bump-version.mjs`）；同步 protocol.py VERSION / app-config.ts APP_VERSION / devlog/README「最近版本」。
2. **改动标注**：桥→annotations-bridge.md；HDA→annotations-hda.md；web→annotations-web.md；跨端改动三端各记一条，且必须三端同验（bridge pytest + web tsc + hython 冒烟）。
3. **协议改动**：`protocol.py` / `web/src/protocol/types.ts` / `devlog/protocol.md` 三处同步，缺一不可。
4. **分支**：大改（重构/新功能/修 bug）独立分支 `codex/<版本>-<操作>`；文档/版本号/单点修复可当前分支直提；禁止直接 merge main，合并由主进程负责。
5. **并行**：按文件/子系统边界切分，子 agent 产出主进程审查整合；跨端功能（协议、双向同步）单 agent 串行；关键路径阻塞任务不委托。
6. **MCP 优先**：Houdini 侧只用官方 fxhoudinimcp（8100，被占自动 8101+），不写自己的 Houdini MCP；Cyl1nder 桥状态用自带 7 个 `cyl1nder_*` 工具，先 ping 再查 serial/日志/几何/索引。

---

## 6. 一句话总结

Cyl1nder 的架构已对齐 AHS 提炼的最佳实践（Python 控制总线 + JSON 场景 + WS 桥 + MCP + 热更新 + TS/Vite）；接下来最有价值的不是改架构，而是：**修 gen-index.mjs 的 TS 导出 bug → 补 verify-all 一键三端验证 → 给 QUICKSTART 补 Keep list 与常见坑 → 在 devlog 加"关键词→专题"索引表**。四条都是文档/工具级改动，零架构风险。