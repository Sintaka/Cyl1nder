# fxhoudinimcp 对接大全 / Compendium

> 版本依据：以 `C:\Users\Administrator\Documents\houdini22.0\fxhoudinimcp\scripts\python\fxhoudinimcp_server\`（Houdini 22.0 实际加载版）为准；dev 检出 `D:\code\dev\Houdini\fxhoudinimcp` 仅作参考，二者有差异处已标注。
> 作者：调研子智能体（只读）· 主管审校并补入实机验证注记（2026-08-14，v0.1.00102）。落地实现见 `devlog/houdini-mcp-integration.md`。

## 0 概述

fxhoudinimcp 分两层：
- **Houdini 进程内插件**（`fxhoudinimcp_server`）：复用 Houdini 内置 `hwebserver`，注册 `@hwebserver.apiFunction` 端点，暴露 HTTP RPC。
- **进程外 MCP 服务器**（pip 包 `fxhoudinimcp`，`python -m fxhoudinimcp`）：stdio/streamable MCP 服务器，通过 httpx 调插件 HTTP。

Cyl1nder bridge 对接的是**第一层 HTTP RPC**（无需走 MCP 协议）。三层调用链：`bridge → POST /api → hwebserver worker 线程 → dispatcher.dispatch → hdefereval 回主线程 → hou.*`。

安装版加载方式：`fxhoudinimcp.json`（Houdini package）设 `FXHOUDINIMCP_AUTOSTART=0`，故**默认不自动启动**，需点工具栏「FXHoudini → MCP Server」shelf 按钮（内部 `startup.start()` 于后台线程 + `time.sleep(1)` 启动）；`python3.13libs/uiready.py` 仅在 `FXHOUDINIMCP_AUTOSTART=1` 时 `ensure_running()`。

## 1 HTTP RPC

**端点**：`POST http://127.0.0.1:<port>/api`
**Content-Type**：`application/x-www-form-urlencoded`（form 字段 `json`，值为 JSON 字符串）。直连必须 urlencode，否则 hwebserver 解析失败。

**两种 body 编码**（`bridge.py::_rpc_body`）：

1. **直连 RPC（hwebserver 原生约定）**：
   `json=["namespace.function", [位置参数], {关键字参数}]`
   例：`json=["mcp.health", [], {}]`
2. **MCP 包装（走 dispatcher）**：
   `json=["mcp.execute", [], {"command": "...", "params": {...}, "request_id": "..."}]`
   `request_id` 会在响应中原样回显。

**响应形状**：
- `mcp.execute`（唯一走 dispatcher 的入口）→ `dispatcher.dispatch` 返回：
  `{"status": "success", "data": <handler返回值>, "timing_ms": 12.3, "request_id": "..."}`
  或 `{"status": "error", "error": {"code":..., "message":..., "traceback":...}, "timing_ms":..., "request_id":...}`
- `mcp.health` / `mcp.list_commands` **无 dispatcher 包装**，直接返回：
  - health → `{"status":"ok","houdini_version":...,"hip_file":...,"pid":...}`
  - list_commands → `{"commands":["scene.get_scene_info",...]}`（排序后全量命令名）

> ⚠️ **实机验证注记（H22.0.368，2026-08-14）**：直连 `POST /api` 的 `mcp.health` 实测响应**只有 `status/pid/houdini_version`**（无 `hip_file`，虽然源码里写了该字段——hwebserver 序列化时未带出）。后果：外部按 hip_file 匹配的发现逻辑退化为"首个存活端口"，**HDA 内 `pid == os.getpid()` 匹配仍是唯一可靠判据**（Cyl1nder 已按此实现）。

**错误枚举**（`dispatcher.py`，`error.code`）：
| code | 含义 |
|---|---|
| `UNKNOWN_COMMAND` | 命令未注册（附 `available_commands` 全列表） |
| `TIMEOUT` | 主线程执行超过 120s |
| `DISPATCH_ERROR` | 调主线程失败 / hdefereval 异常 |
| `<异常类名>` | handler 抛出的任意异常，如 `hou.NodeError`、`hou.OperationFailed`、`ValueError` |

客户端侧（dev `errors.py`）另有：`CONNECTION_ERROR / NODE_NOT_FOUND / INVALID_PARAMETER / GEOMETRY_ERROR / USD_ERROR / COOK_ERROR / TIMEOUT_ERROR / COMMAND_ERROR`。

## 2 端口发现

**插件侧（安装版 `startup.py`）**：
- `start(port=None)`：`_port = port or int(os.environ.get("FXHOUDINIMCP_PORT","8100"))`；import handlers + hwebserver_app 触发注册；`hwebserver.run(_port, debug=False)`；随后 `_wait_for_current_process_health(_port)` 轮询 `mcp.health`（0.1s 间隔，默认 3s 超时），**要求 `health["pid"] == os.getpid()`**，否则抛 `RuntimeError("...owned by another Houdini process...")`。
- ⚠️ **安装版无自动跳端口**：端口被别的 Houdini 占用时直接报错（`RuntimeError`），不迁移 8101+。
- `get_port()` 返回 `_port`；`is_running()` 返回 `_server_started`（纯内存标志）；`ensure_running()` 无参，未运行才 start。
- `stop()` 仅置 `_server_started=False`，**不调 `hwebserver.requestShutdown()`**（注释：会杀掉 Houdini 内置 web server）。
- 安装版**未限制绑定地址**（无 `_bind_localhost_only`），hwebserver 默认绑 `0.0.0.0`（全网卡）→ 安全注意：`code.execute_python` 无鉴权。

**HDA 内识别自己实例端口**：`mcp.health` 返回 `pid`，用 `pid == os.getpid()` 匹配即可唯一确定本进程端口（多实例时唯一可靠判据）。`hip_file` 在未保存场景可能为空串。

**客户端侧（dev `bridge.py::find_servers`）**：扫 `base..base+15`（`PORT_SEARCH_RANGE=16`，即 8100..8115），每端口 POST `mcp.health`（timeout 1.0s），收集所有 `status=="ok"` 的 `{...health, "port"}`，按端口升序返回。`server.py::lifespan`：未 pin `HOUDINI_PORT` 时取 `servers[0]["port"]`，多个实例时 warning 并列其他 pid；`HOUDINI_HOST`/`HOUDINI_PORT` 可 pin。⚠️ dev 版插件侧 `_pick_free_port` 才是「8100 被占自动 8101+」的实现——安装版没有此逻辑，别把 dev 行为套到现场。

## 3 全命令清单（179 条）

> 参数列「必填 / 可选(=默认)」。返回字段列关键项。handler 文件见 `handlers/*.py`。

### scene（scene_handlers.py）
| 命令 | 关键参数 | 返回 | 用途 |
|---|---|---|---|
| get_scene_info | 无 | 版本/hip/fps/frame 等 | 场景总览 |
| new_scene | save_current=false | status | 新建空场景（危险） |
| save_scene | file_path=None | file_path | 存盘 |
| load_scene | file_path, merge=false | — | 打开/合并 hip |
| import_file | file_path, parent_path=/obj, node_name | node_path | 导入几何/USD/Alembic |
| export_file | node_path, file_path, frame_range | wrote_files | 导出节点输出 |
| get_context_info | context | context 信息 | 网络上下文信息 |

### nodes（node_handlers.py）
| 命令 | 关键参数 | 返回 | 用途 |
|---|---|---|---|
| create_node | parent_path, node_type, name, position | node_path | 建节点 |
| delete_node | node_path | — | 删节点 |
| rename_node | node_path, new_name | — | 重命名 |
| copy_node | node_path, dest_parent, new_name | new_path | 复制（新 serial） |
| move_node | node_path, dest_parent | — | 移动父级 |
| get_node_info | node_path | type/连接/flags/errors/非默认参数 | 节点详情 |
| list_children | parent_path, recursive=false, filter_type | children | 列子节点 |
| find_nodes | pattern, node_type, context, inside=/ | nodes | 搜索节点 |
| list_node_types | context, filter, limit=200 | types | 列节点类型 |
| connect_nodes | source_path, dest_path, output_index=0, input_index=0 | — | 连接 |
| connect_nodes_batch | connections[] | — | 批量连接 |
| disconnect_node | node_path, input_index, disconnect_all | — | 断连 |
| reorder_inputs | node_path, new_order[] | — | 重排输入 |
| set_node_flags | node_path, display/render/bypass/template/lock | — | 设旗标 |
| layout_children | parent_path, spacing | — | 自动布局 |
| set_node_position | node_path, x, y | — | 摆位置 |
| set_node_color | node_path, r, g, b | — | 上色 |

### graph（graph_handlers.py）
| 命令 | 关键参数 | 返回 | 用途 |
|---|---|---|---|
| build_network | parent_path, nodes[](spec), dry_run=false, layout=true | per-node errors + display 计数 | 一次建整网（推荐 3+ 节点） |
| verify_network | parent_path | healthy/error_nodes | 全网络体检 |
| get_node_card | node_type, context=Sop, parm_filter | 连接器/参数/帮助 | 节点权威文档卡 |
| find_expensive_nodes | root_path=/, frame, limit=15 | cook_ms 排行 | 性能热点定位 |

### parameters（parameter_handlers.py）
| 命令 | 关键参数 | 返回 | 用途 |
|---|---|---|---|
| get_parameter | node_path, parm_name | value+meta | 读参数 |
| set_parameter | node_path, parm_name, value | — | 设参数 |
| set_parameters | node_path, params{} | — | 批量设参数 |
| get_parameter_schema | node_path, parm_name/filter | 模板 | 参数 schema |
| set_expression | node_path, parm_name, expression, language=hscript | — | 设表达式 |
| get_expression | node_path, parm_name | expr | 读表达式 |
| revert_parameter | node_path, parm_name | — | 还原默认 |
| link_parameters | source_path/parm, dest_path/parm | — | 通道引用 |
| lock_parameter | node_path, parm_name, locked | — | 锁定 |
| create_spare_parameter | node_path, parm_name, parm_type, label, default_value, min/max | — | 加单个 spare |
| create_spare_parameters | node_path, parameters[], folder_name, folder_type=Tabs | — | 批量 spare（可建文件夹） |

### code（code_handlers.py，专节见 §4）
`execute_python` / `execute_hscript` / `evaluate_expression` / `get_env_variable`

### geometry（geometry_handlers.py）
| 命令 | 关键参数 | 返回 | 用途 |
|---|---|---|---|
| get_geometry_info | node_path | 点/面/属性摘要 | 几何总览 |
| get_points | node_path, attributes=["P"], start=0, count=1000, group | total/has_more/points[] | 分页读点（索引访问 O(page)） |
| get_prims | node_path, attributes, start, count, group | total_prims/has_more/prims[] | 分页读面 |
| get_attrib_values | node_path, attrib_name, attrib_class=point, start, count=200 | 扁平数组(element-major)/has_more | 分页读属性 |
| set_detail_attrib | node_path, attrib_name, value | attrib_node_path | 追加 attribcreate 设 detail 属性 |
| get_groups | node_path | point/prim/edge_groups | 列组 |
| get_group_members | node_path, group_name, group_type=point, start, count=5000 | members[]/has_more | 分页读组员 |
| get_bounding_box | node_path | min/max/size/center | 包围盒 |
| get_attribute_info | node_path, attrib_name, attrib_class | 元数据 | 属性元数据 |
| sample_geometry | node_path, sample_count=100, seed=0 | points[]+全属性 | 均匀采样 |
| get_prim_intrinsics | node_path, prim_index=None | intrinsics | 固有属性 |
| find_nearest_point | node_path, position[3], max_results=1 | results[](idx/pos/distance) | 最近点 |

### animation（animation_handlers.py，专节见 §5）
`set_keyframe` / `set_keyframes` / `delete_keyframe` / `get_keyframes` / `set_frame` / `get_frame` / `set_frame_range` / `set_playback_range` / `playbar_control`

### rendering（rendering_handlers.py）
| 命令 | 关键参数 | 返回 | 用途 |
|---|---|---|---|
| render_viewport | output_path, resolution, camera | file | 视口截图 |
| render_quad_view | output_path, resolution | 4 图 | 四视图截图 |
| list_render_nodes | 无 | nodes | 列 ROP |
| get_render_settings | node_path | settings | 读渲染设置 |
| set_render_settings | node_path, settings{} | — | 设渲染设置 |
| create_render_node | renderer, name, camera, output_path | node_path | 建 ROP |
| start_render | node_path, frame_range | output | 执行渲染（**长阻塞**） |
| render_node_network | node_path, output_path | file | 网络编辑器截图 |
| get_render_progress | node_path | progress | 渲染进度 |

### viewport（viewport_handlers.py）
`list_panes` / `get_viewport_info(pane_name)` / `set_viewport_camera(camera_path,pane_name)` / `set_viewport_display(display_mode,pane_name)` / `set_viewport_direction(direction,pane_name)` / `set_viewport_renderer(renderer,pane_name)` / `frame_selection(pane_name)` / `frame_all(pane_name)` / `capture_screenshot(output_path,pane_name)` / `capture_network_editor(output_path,node_path)` / `set_current_network(network_path)` / `find_error_nodes(root_path=/)` / `log_status(message,severity=message)`

### lops / dops / tops / cops / hda / vex / context / workflow / materials / chops / cache / takes / help
其余命名空间命令名+签名均已从 `register_handler` 提取（共 179 条），此处按文件给出关键项：
- **lops**（18）：`get_stage_info` `get_usd_prim` `list_usd_prims(root_path,prim_type,kind,depth)` `get_usd_attribute(prim_path,attr_name,time)` `get_usd_layers` `get_usd_prim_stats` `get_last_modified_prims` `create_lop_node(parent_path,lop_type,name,prim_path)` `set_usd_attribute(node_path,prim_path,attr_name,value)` `get_usd_materials` `find_usd_prims(node_path,pattern)` `get_usd_composition` `get_usd_variants` `inspect_usd_layer(layer_index=0)` `create_light(parent_path=/stage,light_type=dome,intensity,color,position)` `list_lights` `set_light_properties(node_path,prim_path,properties)` `create_light_rig(preset=three_point,intensity_mult)`。
- **dops**（8）：`get_simulation_info` `list_dop_objects` `get_dop_object(object_name)` `get_dop_field(object_name,data_path,field_name)` `get_dop_relationships` `step_simulation(steps=1)` `reset_simulation` `get_sim_memory_usage`。
- **tops**（10）：`get_top_network_info` `cook_top_node(block=true,generate_only=false)` `cancel_top_cook` `pause_top_cook` `dirty_work_items(remove_outputs=false)` `get_work_item_states` `get_work_item_info(work_item_index)` `get_pdg_graph` `generate_static_items` `get_top_scheduler_info`。
- **cops**（7）：`get_cop_info` `get_cop_geometry(output_index=0)` `get_cop_layer` `create_cop_node(parent_path,cop_type,name)` `set_cop_flags` `list_cop_node_types(filter)` `get_cop_vdb`。
- **hda**（10）：`list_installed_hdas(filter)` `get_hda_info(node_path/hda_file/type_name)` `install_hda(file_path,force)` `uninstall_hda` `reload_hda` `create_hda(node_path,hda_file,type_name,label,version=1.0)` `update_hda` `get_hda_sections` `get_hda_section_content(section_name)` `set_hda_section_content(section_name,content)`。
- **vex**（5）：`create_wrangle(parent_path,vex_code,justification,run_over=Points,name)` `set_wrangle_code` `get_wrangle_code` `create_vex_expression(node_path,parm_name,vex_code)` `validate_vex`。
- **context**（8）：`get_network_overview(path=/obj,depth=2)` `get_cook_chain` `explain_node` `get_selection` `set_selection(node_paths)` `get_scene_summary` `compare_snapshots(action=take,snapshot_name)` `get_node_errors_detailed(node_path/root_path)`。
- **workflow**（8）：`setup_pyro_sim` `setup_rbd_sim` `setup_flip_sim` `setup_vellum_sim` `create_material` `assign_material(geo_path,material_path)` `build_sop_chain(parent_path,steps)` `setup_render`（一键流程，多步且可能较慢）。
- **materials**（5）：`list_materials(root_path=/mat)` `get_material_info` `create_material_network(name,shader_type=principled,params)` `assign_material` `list_material_types`。
- **chops**（4）：`get_chop_data(channel_name,start,end)` `create_chop_node(parent_path,chop_type,name)` `list_chop_channels` `export_chop_to_parm(chop_path,channel_name,target_node_path,target_parm_name)`。
- **cache**（4）：`list_caches(root_path=/)` `get_cache_status` `clear_cache(frame_range)` `write_cache(frame_range)`。
- **takes**（4）：`list_takes` `get_current_take` `set_current_take(name)` `create_take(name,parent_name)`。
- **help**（2）：`search_help(query,scope,limit)` `get_help_page(path)`。

> ⚠️ dev 版 MCP 服务器（tools/*.py）比安装版插件**多**：`graph.cook_frame_range` `graph.get_cook_status` `geometry.get_attrib_stats` `geometry.get_volume_info` `viewport.set_viewer_context`。这些命令在安装版插件未注册，直连会返回 `UNKNOWN_COMMAND`。

## 4 Python Runtime

**code.execute_python(code, return_expression=None)**（`code_handlers.py::_execute_python`）：
- `exec(code, {"hou": hou})`——**exec 语义，无顶层 `return`**；要拿结果必须用 `return_expression` 走 `eval(return_expression, namespace)`（同一个命名空间，能看到 exec 定义的变量）。
- stdout/stderr 用 `io.StringIO` 捕获后各 `_truncate_output` **截断到 100KB**（超限加 `\n[truncated]` 标记）。
- 返回：`{"executed": true/false, "return_value":..., "stdout":..., "stderr":..., "eval_error":...}`；exec 抛错 → `executed:false` + `error`(完整 traceback)；eval 抛错 → `executed:true` + `return_value:null` + `eval_error`。
- 返回值经 `_serialize_result` 序列化（bool/int/float/str/list/dict 原样，bytes 解码，其他 `str()` 降级）。

**code.execute_hscript(command)** → `hou.hscript()` → `{"output":..., "errors":...}`（各自截断 100KB）。
**code.evaluate_expression(expression, language="hscript")** → `hou.hscriptExpression()` 或（`language="python"`）`eval(expr, {"hou":hou})` → `{"expression","language","result"}`。
**code.get_env_variable(var_name)** → `hou.getenv()` → `{"var_name","value","exists": value is not None}`。

**桥侧（FastAPI）调用注意**：`HoudiniBridge` 是 **async**（`httpx.AsyncClient`），async 端点里直接 `await bridge.execute(...)` 即可；若在同步路径用 `requests`/同步 httpx，会阻塞事件循环 → 用 `asyncio.to_thread()` / `run_in_executor`。请求超时：bridge 默认 60s，dispatcher 主线程硬超时 120s；`start_render`/`cook_top_node(block=true)` 等长任务可能顶到 120s 上限（dispatcher 返回 `TIMEOUT`）。

## 5 时间轴同步

命令（`animation_handlers.py`）：
| 命令 | 参数 | 返回 | 实现 |
|---|---|---|---|
| set_frame | frame:float | {frame,status} | `hou.setFrame()`，回读 `hou.frame()` |
| get_frame | 无 | {frame, fps} | `hou.frame()`/`hou.fps()`（**轻量**） |
| set_frame_range | start, end（start<end 否则报错） | {start,end,status} | `hou.playbar.setFrameRange()` |
| set_playback_range | start, end | {start,end,status} | `hou.playbar.setPlaybackRange()` |
| playbar_control | action=play/stop/reverse, real_time?, fps? | {action,current_frame,is_playing,real_time,fps} | `hou.playbar.play()/stop()/reverse()` |

**web⇄Houdini 双向同步建议**：
- 读方向用 `get_frame`，**0.25s 节流 + 缓存**（返回含 fps，可一并缓存；`get_frame` 不碰几何，极轻）。
- 写方向用 `set_frame`，**0.1s 节流**（拖拽 scrub 时合并为最新值，丢弃中间帧）。
- **回环抑制**：本地维护 `last_remote_frame` 与 `last_local_frame`，当收到 set 的帧 == 自己刚发出的值，或 get 到的帧 == 本地方向已广播的值时跳过回写；仅当差值 > 阈值（如 0.01）才触发，避免 ping-pong。
- 建议用 `animation.get_frame` 作为「Houdini 是否存活」的轻量心跳替代（比 `mcp.health` 更贴近时间轴状态，但 health 不碰主线程更稳）。

## 6 线程模型与风险

- **核心**（`dispatcher.py`）：hwebserver 的 handler 跑在 **worker 线程**；所有 `hou.*` 必须回主线程 → `hdefereval.executeInMainThreadWithResult(_execute)` 封送并阻塞等待。
- **超时**：`_COMMAND_TIMEOUT = 120s`。在另一 daemon 线程里调 hdefereval 并 `worker.join(120)`，超时返回 `TIMEOUT`（主线程仍在跑，无法真正中断）。
- **fallback**：`hdefereval` 仅在图形会话可用（`HAS_HDEFEREVAL`）；**hython 无 hdefereval 时直接 `_execute()`**（单线程，无封送）。
- **印证 HDA 铁律**：dispatcher 注释 + startup 的 `_confirm_ready_async` 明确「后台线程只做 urllib/os.getpid，**绝不碰 hou.**」——Cyl1nder 的 HDA 后台线程只应做 HTTP 客户端，任何 hou 调用都必须经由 HTTP 交给主线程的 dispatcher。
- **生命周期**：`stop()` 只清标志、不 `requestShutdown()`（会杀 Houdini 内置 web server）。hwebserver 由 Houdini 20.5+ 可能已为内置功能常驻，插件只是「注册函数到既有 server」；停止插件不影响 Houdini 内置功能，反之亦然。

## 7 白名单建议（Cyl1nder bridge 代理端点）

放行命名空间前缀（读为主 + 必要写）：
```
scene.get_scene_info, scene.save_scene, scene.get_context_info
nodes.(get_node_info|list_children|find_nodes|list_node_types|connect_nodes|connect_nodes_batch|set_node_flags|layout_children|create_node|delete_node|rename_node|copy_node)
graph.(build_network|verify_network|get_node_card)
parameters.(get_parameter|set_parameter|set_parameters|get_parameter_schema|link_parameters)
code.(execute_python|execute_hscript|evaluate_expression|get_env_variable)
geometry.*  (全放行，只读 + set_detail_attrib)
animation.(set_frame|get_frame|set_frame_range|set_playback_range|playbar_control|get_keyframes)
viewport.(list_panes|get_viewport_info|set_viewport_*|frame_all|frame_selection|set_current_network|log_status)
lops.(get_*|list_*|find_*|inspect_*|set_usd_attribute)
hda.(list_installed_hdas|get_hda_info|get_hda_sections|get_hda_section_content)
help.(search_help|get_help_page)
context.(get_*|get_scene_summary|get_network_overview|get_node_errors_detailed|explain_node)
```

**拦截/默认拒绝**（理由）：
- `scene.new_scene`（清空场景，不可逆）、`scene.load_scene`（覆盖打开）→ 需显式确认。
- `rendering.start_render`、`tops.cook_top_node(block=true)`、`cache.write_cache`、`dops.step_simulation/reset_simulation`、`workflow.setup_*` → **长阻塞**（顶 120s dispatcher 超时），要么不放行、要么异步 job + 进度轮询（`rendering.get_render_progress`）。
- `code.execute_python/execute_hscript` → **放行但需审慎**（任意代码执行 + 安装版绑 0.0.0.0 无鉴权）；建议 bridge 只透传受信调用，或限制到 `hou.*` 白名单表达式。
- `scene.export_file/import_file`、`hda.install_hda/uninstall_hda/create_hda/update_hda/set_hda_section_content` → 触碰磁盘/写定义，谨慎放行。

## 8 踩坑清单

1. **exec 语义**：`code.execute_python` 无顶层 `return`（`exec` 非 `eval`）；取结果用 `return_expression`，否则靠 `stdout`。
2. **hou.severityType 无 Info**：写日志/告警时注意 `severityType` 只有 Warning/Error 等级别，无 Info。
3. **直连 body 必须 urlencode form**：`Content-Type: application/x-www-form-urlencoded` + form 字段 `json`；发 raw JSON 会 400/解析失败。
4. **hip_file 可能为空**：未保存场景 `hou.hipFile.name()` 返回空串，别当唯一标识（用 `pid`）。
5. **端口 8100 被占**：**安装版**直接 `RuntimeError`（无自动 8101+，那是 dev 版 `_pick_free_port` 行为）；多实例时**pid 匹配是唯一可靠判据**。
6. **安装版绑 0.0.0.0**：无 `_bind_localhost_only`（dev 版才有，默认 127.0.0.1），无鉴权 + 任意 Python 执行 = 局域网可达风险，Cyl1nder 桥需自设防火墙/内网隔离。
7. **版本差**：dev MCP 服务器命令集 > 安装版插件；dev 独有 `cook_frame_range/get_cook_status/get_attrib_stats/get_volume_info/set_viewer_context` 在安装版返回 `UNKNOWN_COMMAND`。对接前先 `mcp.list_commands` 比对能力集。
8. **AUTOSTART 默认关**：`fxhoudinimcp.json` 设 `FXHOUDINIMCP_AUTOSTART=0`，服务器需手动 shelf 启动；Cyl1nder 依赖前须确保已启动。
9. **stdout/stderr 100KB 截断**：`code.execute_python` 打印多会截断，勿依赖 print 传大数据（走 return_expression + JSON 序列化）。
10. **dispatcher 120s 硬超时**：长 cook/渲染会 `TIMEOUT` 且**主线程仍在跑**（无法取消），需异步化 + 进度轮询。
11. **connect 后 RemoteProtocolError**：Houdini 重启后旧 keep-alive 连接失效，客户端需重试一次换新连接池（dev `HoudiniBridge._post` 已内置）。
12. **主线程同步调用 mcp.execute 必死锁（实机复现，v0.1.00102）**：HDA 在 cook 主线程里同步 POST `mcp.execute`（如 `animation.get_frame`）会阻塞等待响应，而 dispatcher 必须回到**同一主线程**才能执行 → 直到超时（实测 TimeoutError）。**红线：HDA 主线程只允许 `mcp.health` 探针（不经 dispatcher）；一切 `mcp.execute` 只能来自外部进程（bridge）或 HDA 后台线程**（后台线程同时必须保持 hou-free，见 devlog/houdini-mcp-integration.md）。

---

**调研源码路径与版本依据**：
- 权威（安装版，Houdini 22.0 实际加载）：`C:\Users\Administrator\Documents\houdini22.0\fxhoudinimcp\scripts\python\fxhoudinimcp_server\` —— `hwebserver_app.py`（RPC 入口/mcp.health/mcp.list_commands）、`dispatcher.py`（dispatch/线程模型/120s/错误码）、`startup.py`（端口/生命周期）、`config.py`（AUTO_LAYOUT）、`handlers/*.py`（179 条命令，`handlers/__init__.py` 列出 22 个模块）、`fxhoudinimcp.json`（AUTOSTART=0）、`toolbar/fxhoudinimcp.shelf`（手动启动）、`python3.13libs/uiready.py`（自动启动）。
- 参考（dev 检出，版本更新）：`D:\code\dev\Houdini\fxhoudinimcp\python\fxhoudinimcp\` —— `bridge.py`（`find_servers`/`PORT_SEARCH_RANGE=16`/`_rpc_body`/错误映射）、`server.py`（lifespan/端口选择）、`errors.py`、`__main__.py`；`houdini\scripts\python\fxhoudinimcp_server\startup.py`（`_pick_free_port`/`_bind_localhost_only`，安装版无）。
