# fxhoudinimcp 对接工具索引 / Tools Index

> 快速速查卡。全量 179 条命令表、参数细节、线程模型与踩坑 → `devlog/fxhoudinimcp-compendium.md`。
> 落地架构与实现 → `devlog/houdini-mcp-integration.md`。
> v0.1.00102 · 2026-08-14 · 主管编写（依据调研子智能体产出 + 实机验证）

## 0 速查卡（10 秒版）

| 项 | 值 |
|---|---|
| 端点 | `POST http://127.0.0.1:<port>/api` |
| Content-Type | `application/x-www-form-urlencoded`，form 字段 `json=<JSON 字符串>` |
| 直连 RPC | `json=["ns.fn", [位置参数], {关键字参数}]`（mcp.health / mcp.list_commands） |
| MCP 包装 | `json=["mcp.execute", [], {"command":"ns.fn", "params":{...}, "request_id":"..."}]` |
| 响应 | `{"status":"success","data":{...},"timing_ms":…}` 或 `{"status":"error","error":{code,message,traceback}}` |
| 端口 | 默认 8100（env `FXHOUDINIMCP_PORT`）；**安装版被占直接 RuntimeError，无自动 8101+** |
| 识别本实例 | `mcp.health` 的 `pid == os.getpid()`（唯一可靠；实测 health 不带 hip_file） |
| 执行模型 | hwebserver worker 线程 → `hdefereval.executeInMainThreadWithResult` 回 Houdini 主线程，120s 硬超时 |
| 死锁红线 | HDA 主线程同步调 `mcp.execute` 必死锁；`mcp.health` 探针例外（不经 dispatcher） |

## 1 高频命令速查

| 场景 | 命令 | 关键参数 | 返回 |
|---|---|---|---|
| 时间轴读 | `animation.get_frame` | — | `{frame, fps}`（极轻量） |
| 时间轴写 | `animation.set_frame` | `frame` | `{frame, status}` |
| 播放控制 | `animation.playbar_control` | `action=play/stop/reverse, real_time?, fps?` | `{action, current_frame, is_playing, fps}` |
| 帧范围 | `animation.set_frame_range` / `set_playback_range` | `start, end`（start<end） | `{start, end, status}` |
| Python 运行时 | `code.execute_python` | `code, return_expression?` | `{executed, return_value, stdout, stderr}` |
| HScript | `code.execute_hscript` | `command` | `{output, errors}` |
| 表达式 | `code.evaluate_expression` | `expression, language=hscript\|python` | `{result}` |
| 环境变量 | `code.get_env_variable` | `var_name` | `{var_name, value, exists}` |
| 场景总览 | `scene.get_scene_info` | — | 版本/hip/fps/frame |
| 读参数 | `parameters.get_parameter` | `node_path, parm_name` | 值+元数据 |
| 写参数 | `parameters.set_parameter` / `set_parameters` | `node_path, parm_name, value` / `params{}` | — |
| 参数 schema | `parameters.get_parameter_schema` | `node_path, parm_name\|filter` | 模板 |
| 建节点 | `nodes.create_node` | `parent_path, node_type, name?, position?` | `node_path` |
| 建整网 | `graph.build_network` | `parent_path, nodes[](spec), dry_run, layout` | 每节点错误+显示节点计数 |
| 网络体检 | `graph.verify_network` | `parent_path` | `healthy, error_nodes` |
| 节点卡片 | `graph.get_node_card` | `node_type, context, parm_filter?` | 连接器/参数/帮助（设参前先读） |
| 几何总览 | `geometry.get_geometry_info` | `node_path` | 点/面/属性摘要 |
| 读点（分页） | `geometry.get_points` | `node_path, attributes, start, count, group?` | `total, has_more, points[]` |
| 状态栏 | `viewport.log_status` | `message, severity=message` | —（UI 反馈） |
| 视口截图 | `rendering.render_viewport` | `output_path, resolution?, camera?` | 文件 |
| 帮助 | `help.search_help` / `help.get_help_page` | `query, scope?, limit?` / `path` | 文档 |

## 2 分类目录（→ 大全 §3 对应小节）

| 命名空间 | 条数 | 大全位置 | 备注 |
|---|---|---|---|
| scene / nodes / graph / parameters | 7 / 17 / 4 / 11 | §3 各表 | 场景与网络编辑 |
| code | 4 | §4 专节 | Python runtime |
| geometry | 12 | §3 表 | 只读为主 |
| animation | 9 | §5 专节 | 时间轴双向同步 |
| rendering | 9 | §3 表 | `start_render` 长阻塞 |
| viewport | 13 | §3 行 | 视口/截图/日志 |
| lops / dops / tops / cops | 18 / 8 / 10 / 7 | §3 行 | USD/模拟/PDG/COP |
| hda / vex / context | 10 / 5 / 8 | §3 行 | HDA 定义/wrangle/上下文 |
| workflow / materials / chops / cache / takes / help | 8 / 5 / 4 / 4 / 4 / 2 | §3 行 | 一键流程等 |

> dev 检出（github healkeiser/fxhoudinimcp 最新）比安装版多 5 条：`graph.cook_frame_range / graph.get_cook_status / geometry.get_attrib_stats / geometry.get_volume_info / viewport.set_viewer_context`——直连安装版会 `UNKNOWN_COMMAND`。

## 3 端口发现三法（HDA 启动时获取本实例端口）

| 方法 | 位置 | 判据 | 可靠性 |
|---|---|---|---|
| ① pid 匹配（**主路径**） | HDA 内 `hda/src/cyl1nder_houdini_mcp.py::discover_port(expected_pid, expected_hip)` | 扫 8100..8115，`mcp.health.pid == os.getpid()`；hip_file 非空时二次比对 | **唯一可靠**（多实例/无 hip_file 均成立）；HDA cook 钩子 10s 节流发起，发现线程成功后经 `on_found` 立即 PUT 上报 bridge |
| ② hip 匹配（退化路径） | bridge `bridge/bridge/houdini_mcp.py::discover_by_hip` | `health.hip_file` 归一化比对 registry.hip | 实测 health 无 hip_file → 实际退化 discover_first |
| ③ 首个存活（兜底） | bridge `discover_first` | 扫 8100..8115 首个 health 通过 | 多实例时可能拿到错误实例（8101 那个）——只作兜底，HDA 上报后以 registry.mcpPort 为准 |

端口归宿：bridge `registry.json` 的 `mcpPort`（每 serial，可变、持久化、force 落盘）。

## 4 Cyl1nder bridge 暴露面（web/HDA 经 8375 调用）

| 端点 | 用途 |
|---|---|
| `GET /api/hda/{serial}/houdini` | `{mcpPort, alive, health}` |
| `PUT /api/hda/{serial}/houdini` `{mcp_port}` | HDA 上报端口（并校验存活+hip 匹配） |
| `GET /api/hda/{serial}/timeline` | H→C 帧/fps（bridge 内 0.25s 缓存 get_frame，web 250ms 轮询） |
| `PUT /api/hda/{serial}/timeline` `{frame}` | C→H 设帧（0.1s 节流 → `animation.set_frame`） |
| `PUT /api/hda/{serial}/hou-timeline` `{frame, fps?}` | HDA 上报帧 → WS `{type:"timeline"}` 广播 |
| `POST /api/hda/{serial}/houdini/cmd` `{command, params?}` | 命令代理（命名空间前缀白名单，403 拦截） |
| `POST /api/hda/{serial}/houdini/python` `{code, return_expression?}` | Python runtime 代理 |

白名单前缀（`houdini_mcp.ALLOWED_COMMAND_PREFIXES`）：`animation. code. context. geometry. graph. help. hda. lops. materials. nodes. parameters. rendering. scene. takes. tops. vex. viewport. workflow. cache. chops. dops. cops. mcp.`——白名单内仍应避免长阻塞/危险命令（`rendering.start_render`、`scene.new_scene/load_scene`、`workflow.setup_*`、`tops.cook_top_node(block=true)` 等，见大全 §7）。

## 5 时间轴双向同步要素（实机验证 v0.1.00102）

- C→H：web scrub（linkEnabled 且非拖动态）→ `PUT /timeline` → bridge `animation.set_frame`（0.1s 节流）→ Houdini playhead。实测 21→30→21 往返正确。
- H→C：web 250ms 轮询 `GET /timeline` → bridge 0.25s 缓存 `animation.get_frame`。实测 Houdini 侧改帧 15 后 bridge 0.6s 内跟随。
- 回环抑制：web 拖动态忽略 applyRemote；applyRemote 不触发 onFrameCommit；bridge 侧 set_frame 0.1s 节流 + get_frame 0.25s 缓存。
- 门控：web 侧 `linkEnabled`（bridge mcpPort>0 即亮锚定灯 ●）；C→H 提交受 `sync_enabled` 之外的独立 `linkEnabled && !dragging` 门控；engaged 锚定门控（timeline-design.md Phase B）留待后续。
