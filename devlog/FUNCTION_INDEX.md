# 函数索引 / FUNCTION INDEX

> 机器生成（2026-08-15），由 `node scripts/gen-index.mjs` 产出。共 **874** 个函数/类。
> 用途：agent 先 grep 函数名定位，再跳读对应文件/行号；`calls` = 文件内 `name(` 出现次数（hub 指标，越大越核心）。

## bridge/bridge/__init__.py（5 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## bridge/bridge/__main__.py（15 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `main` | 7 | def |  | 2 |

## bridge/bridge/channel_routes.py（243 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_check_serial` | 35 | def |  | 2 |
| `_key_of` | 40 | def |  | 3 |
| `_path_key` | 46 | def |  | 2 |
| `_probe_key` | 53 | def |  | 4 |
| `_find_channel` | 58 | def |  | 3 |
| `_resolve_data_target` | 63 | def |  | 3 |
| `ValuePut` | 72 | class |  | 1 |
| `get_channel_value` | 77 | def |  | 1 |
| `put_channel_value` | 110 | def |  | 1 |
| `put_channel` | 143 | def |  | 1 |
| `list_channels` | 160 | def |  | 1 |
| `HeartbeatBody` | 164 | class |  | 1 |
| `heartbeat` | 173 | def |  | 1 |
| `probe` | 195 | def |  | 1 |
| `_node_type_name` | 230 | def |  | 2 |

## bridge/bridge/channels.py（106 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ChannelRegistry` | 18 | class |  | 0 |
| `__init__` | 19 | def |  | 1 |
| `_key_of` | 30 | def |  | 3 |
| `register` | 35 | def |  | 1 |
| `get` | 51 | def |  | 9 |
| `list` | 56 | def |  | 2 |
| `touch` | 62 | def |  | 1 |
| `save_now` | 73 | def |  | 1 |
| `_save` | 77 | def |  | 4 |
| `_load` | 95 | def |  | 2 |

## bridge/bridge/compute/__init__.py（49 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ComputeContext` | 14 | class |  | 0 |
| `__init__` | 17 | def |  | 1 |
| `ComputeExecutor` | 23 | class |  | 1 |
| `run` | 26 | def |  | 2 |
| `register_executor` | 32 | def |  | 1 |
| `list_executors` | 36 | def |  | 1 |
| `run_node` | 40 | def |  | 1 |

## bridge/bridge/compute/ctypes_stub.py（61 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_passthrough` | 21 | def |  | 2 |
| `NativeStubExecutor` | 38 | class |  | 1 |
| `run` | 41 | def |  | 2 |

## bridge/bridge/compute/passthrough.py（29 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `PassthroughExecutor` | 8 | class |  | 1 |
| `run` | 11 | def |  | 1 |

## bridge/bridge/data_adapters/__init__.py（11 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `get_adapter` | 9 | def |  | 1 |

## bridge/bridge/data_adapters/apex_anim.py（54 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ApexAnimDataAdapter` | 11 | class |  | 0 |
| `read` | 14 | def |  | 1 |
| `write` | 28 | def |  | 1 |
| `_rpc` | 44 | def |  | 3 |

## bridge/bridge/houdini_mcp.py（185 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `HoudiniMcpError` | 56 | class |  | 5 |
| `_request_id` | 60 | def |  | 2 |
| `_decode_bytes` | 68 | def |  | 2 |
| `_post` | 81 | def |  | 3 |
| `rpc` | 104 | def |  | 4 |
| `health` | 116 | def |  | 3 |
| `discover_first` | 124 | def |  | 2 |
| `normalize_hip` | 132 | def |  | 3 |
| `discover_by_hip` | 141 | def |  | 1 |
| `_unwrap` | 157 | def |  | 4 |
| `set_frame` | 165 | def |  | 1 |
| `get_frame` | 169 | def |  | 1 |
| `execute_python` | 173 | def |  | 1 |
| `is_command_allowed` | 180 | def |  | 1 |

## bridge/bridge/houdini_routes.py（672 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_get_interval` | 85 | def |  | 3 |
| `_get_set_interval` | 90 | def |  | 5 |
| `_check_serial` | 95 | def |  | 10 |
| `_tl_default` | 100 | def |  | 6 |
| `_resolve_port` | 104 | def |  | 1 |
| `_poller_done` | 143 | def |  | 2 |
| `_inflight_done` | 149 | def |  | 2 |
| `ensure_poller` | 155 | def |  | 2 |
| `_poller_loop` | 169 | def |  | 2 |
| `_get_frame_once` | 202 | def |  | 2 |
| `_apply_frame` | 223 | def |  | 3 |
| `get_timeline` | 257 | def |  | 1 |
| `TimelinePut` | 290 | class |  | 1 |
| `put_timeline` | 295 | def |  | 1 |
| `_arm_set_flush` | 321 | def |  | 3 |
| `_flush_pending` | 332 | def |  | 2 |
| `_send_pending` | 342 | def |  | 3 |
| `get_channel_values` | 389 | def |  | 1 |
| `ChannelValuesPut` | 432 | class |  | 1 |
| `put_channel_values` | 437 | def |  | 1 |
| `_arm_cv_flush` | 465 | def |  | 3 |
| `_flush_cv_pending` | 476 | def |  | 2 |
| `_send_cv_pending` | 486 | def |  | 3 |
| `HouTimelinePut` | 531 | class |  | 1 |
| `put_hou_timeline` | 537 | def |  | 1 |
| `get_houdini` | 564 | def |  | 1 |
| `HoudiniPut` | 574 | class |  | 1 |
| `put_houdini` | 579 | def |  | 1 |
| `CmdBody` | 595 | class |  | 1 |
| `_trace_houdini_cmd` | 600 | def |  | 2 |
| `houdini_cmd` | 626 | def |  | 1 |
| `PythonBody` | 643 | class |  | 1 |
| `houdini_python` | 649 | def |  | 1 |

## bridge/bridge/logs.py（60 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `LogEntry` | 12 | class |  | 1 |
| `__init__` | 15 | def |  | 2 |
| `to_dict` | 22 | def |  | 2 |
| `LogRing` | 32 | class |  | 0 |
| `add` | 37 | def |  | 3 |
| `info` | 42 | def |  | 1 |
| `error` | 45 | def |  | 1 |
| `query` | 48 | def |  | 2 |
| `errors` | 58 | def |  | 1 |

## bridge/bridge/main.py（59 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `lifespan` | 23 | def |  | 1 |
| `create_app` | 37 | def |  | 2 |

## bridge/bridge/mcp_server.py（303 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_index_files` | 25 | def |  | 2 |
| `cyl1nder_ping` | 33 | def |  | 1 |
| `cyl1nder_list_serials` | 40 | def |  | 1 |
| `cyl1nder_get_status` | 46 | def |  | 1 |
| `cyl1nder_read_snapshot` | 58 | def |  | 1 |
| `_read_graph` | 81 | def |  | 5 |
| `_node_map` | 93 | def |  | 3 |
| `cyl1nder_nodeview_nodes` | 98 | def |  | 1 |
| `cyl1nder_nodeview_connections` | 107 | def |  | 1 |
| `cyl1nder_nodeview_status` | 127 | def |  | 1 |
| `cyl1nder_nodeview_connected` | 154 | def |  | 1 |
| `_read_snapshot_data` | 187 | def |  | 3 |
| `cyl1nder_viewport_settings` | 196 | def |  | 1 |
| `cyl1nder_node_params` | 214 | def |  | 1 |
| `cyl1nder_read_layout` | 229 | def |  | 1 |
| `walk` | 239 | def |  | 3 |
| `cyl1nder_read_logs` | 252 | def |  | 1 |
| `cyl1nder_get_errors` | 258 | def |  | 1 |
| `cyl1nder_get_geometry_summary` | 264 | def |  | 1 |
| `cyl1nder_index_query` | 274 | def |  | 1 |
| `run_stdio` | 297 | def |  | 2 |

## bridge/bridge/project_routes.py（143 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_check_project_serial` | 26 | def |  | 6 |
| `ProjectCreateBody` | 31 | class |  | 1 |
| `EnsureBody` | 35 | class |  | 1 |
| `GraphPutBody` | 39 | class |  | 1 |
| `create_project` | 44 | def |  | 1 |
| `list_projects` | 50 | def |  | 1 |
| `get_project` | 55 | def |  | 1 |
| `add_member` | 64 | def |  | 3 |
| `remove_member` | 73 | def |  | 2 |
| `ensure_project` | 84 | def |  | 1 |
| `get_project_graph` | 117 | def |  | 1 |
| `put_project_graph` | 135 | def |  | 1 |

## bridge/bridge/projects.py（130 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ProjectRegistry` | 21 | class |  | 0 |
| `__init__` | 22 | def |  | 1 |
| `_channel_key` | 33 | def |  | 4 |
| `create` | 38 | def |  | 1 |
| `get` | 53 | def |  | 9 |
| `list` | 58 | def |  | 2 |
| `add_member` | 64 | def |  | 1 |
| `remove_member` | 82 | def |  | 1 |
| `save_now` | 97 | def |  | 1 |
| `_save` | 101 | def |  | 5 |
| `_load` | 119 | def |  | 2 |

## bridge/bridge/protocol.py（183 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_b36` | 70 | def |  | 5 |
| `generate_serial` | 81 | def |  | 1 |
| `is_valid_serial` | 92 | def |  | 1 |
| `AttributeData` | 96 | class |  | 1 |
| `CurveData` | 102 | class |  | 1 |
| `InputPayload` | 107 | class |  | 1 |
| `OutputBuffer` | 118 | class |  | 1 |
| `InputsPut` | 129 | class |  | 1 |
| `ChannelRef` | 138 | class |  | 1 |
| `generate_project_serial` | 155 | def |  | 1 |
| `is_valid_project_serial` | 162 | def |  | 1 |
| `ProjectRef` | 166 | class |  | 1 |
| `OutputsPut` | 175 | class |  | 1 |
| `SyncEnabledPut` | 180 | class |  | 1 |

## bridge/bridge/registry.py（218 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `RegistryError` | 29 | class |  | 2 |
| `RegistryRecord` | 33 | class |  | 3 |
| `__init__` | 36 | def |  | 2 |
| `to_dict` | 57 | def |  | 2 |
| `from_dict` | 70 | def |  | 2 |
| `SerialRegistry` | 83 | class |  | 0 |
| `register` | 94 | def |  | 4 |
| `get` | 121 | def |  | 13 |
| `touch` | 125 | def |  | 3 |
| `mark_activity` | 141 | def |  | 3 |
| `set_houdini_mcp` | 155 | def |  | 1 |
| `remove` | 168 | def |  | 3 |
| `list` | 177 | def |  | 1 |
| `serials` | 181 | def |  | 1 |
| `_save` | 185 | def |  | 6 |
| `_load` | 209 | def |  | 2 |

## bridge/bridge/routes.py（436 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `root` | 38 | def |  | 1 |
| `_check_serial` | 45 | def |  | 15 |
| `health` | 51 | def |  | 1 |
| `list_serials` | 57 | def |  | 1 |
| `status` | 62 | def |  | 2 |
| `put_inputs` | 75 | def |  | 1 |
| `get_outputs` | 101 | def |  | 1 |
| `put_outputs` | 119 | def |  | 2 |
| `_parse_outputs_body` | 150 | def |  | 2 |
| `SyncFpsPut` | 175 | class |  | 1 |
| `put_sync_fps` | 181 | def |  | 1 |
| `put_sync_enabled` | 190 | def |  | 1 |
| `pending` | 199 | def |  | 1 |
| `_ndjson` | 221 | def |  | 9 |
| `stream` | 227 | def |  | 1 |
| `kick` | 274 | def |  | 1 |
| `serial_logs` | 296 | def |  | 1 |
| `get_snapshot` | 306 | def |  | 1 |
| `get_ui_layout` | 317 | def |  | 1 |
| `put_ui_layout` | 324 | def |  | 1 |
| `put_snapshot` | 332 | def |  | 1 |
| `ui_layouts` | 350 | def |  | 1 |
| `ui_layout_save` | 356 | def |  | 1 |
| `ui_layout_load` | 363 | def |  | 1 |
| `global_logs` | 370 | def |  | 1 |
| `scenes_list` | 381 | def |  | 1 |
| `scenes_create` | 387 | def |  | 1 |
| `scenes_cleanup` | 394 | def |  | 1 |
| `scene_save` | 400 | def |  | 1 |
| `scenes_open` | 411 | def |  | 1 |
| `get_usdz` | 424 | def |  | 1 |

## bridge/bridge/scenes.py（188 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_snapshot_base` | 23 | def |  | 3 |
| `_read_json` | 29 | def |  | 7 |
| `list_scenes` | 36 | def |  | 1 |
| `_invalid_snapshot_dir` | 69 | def |  | 2 |
| `cleanup_scenes` | 82 | def |  | 1 |
| `create_scene` | 119 | def |  | 1 |
| `save_scene` | 129 | def |  | 1 |
| `open_scene` | 160 | def |  | 1 |

## bridge/bridge/snapshot_routes.py（50 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `restore` | 23 | def |  | 1 |

## bridge/bridge/snapshot.py（326 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `snapshot_root` | 46 | def |  | 3 |
| `_part_path` | 58 | def |  | 3 |
| `_read_root` | 63 | def |  | 3 |
| `read_snapshot` | 86 | def |  | 2 |
| `write_snapshot` | 103 | def |  | 2 |
| `build_meta` | 151 | def |  | 3 |
| `maybe_snapshot` | 165 | def |  | 1 |
| `restore_workspace` | 194 | def |  | 2 |
| `restore_all_workspaces` | 245 | def |  | 1 |
| `flush_workspace` | 260 | def |  | 2 |
| `flush_all_workspaces` | 285 | def |  | 1 |
| `project_graph_path` | 299 | def |  | 3 |
| `read_project_graph` | 304 | def |  | 1 |
| `write_project_graph` | 314 | def |  | 1 |

## bridge/bridge/state.py（252 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeState` | 30 | class |  | 2 |
| `__init__` | 31 | def |  | 1 |
| `set_sync_fps` | 63 | def |  | 1 |
| `get_sync_fps` | 74 | def |  | 3 |
| `set_sync_enabled` | 78 | def |  | 1 |
| `get_sync_enabled` | 83 | def |  | 1 |
| `set_kick` | 89 | def |  | 1 |
| `take_kick` | 94 | def |  | 1 |
| `try_arm_kick` | 99 | def |  | 1 |
| `subscribe` | 116 | def |  | 1 |
| `unsubscribe` | 125 | def |  | 2 |
| `notify_stream` | 134 | def |  | 1 |
| `_wake_stream` | 163 | def |  | 1 |
| `stage_broadcast` | 174 | def |  | 1 |
| `_arm_broadcast_flush` | 206 | def |  | 1 |
| `_flush_broadcast` | 213 | def |  | 3 |
| `default_data_dir` | 233 | def |  | 2 |
| `get_state` | 240 | def |  | 1 |
| `reset_state` | 247 | def |  | 1 |

## bridge/bridge/trace_routes.py（53 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_project_channel_keys` | 25 | def |  | 2 |
| `trace` | 36 | def |  | 1 |

## bridge/bridge/trace.py（90 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `TraceStore` | 17 | class |  | 0 |
| `__init__` | 18 | def |  | 1 |
| `add` | 22 | def |  | 1 |
| `list` | 52 | def |  | 1 |
| `count` | 66 | def |  | 1 |
| `_filtered` | 70 | def |  | 2 |

## bridge/bridge/ui_layout.py（75 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `UiLayoutStore` | 12 | class |  | 0 |
| `__init__` | 13 | def |  | 1 |
| `read` | 16 | def |  | 1 |
| `write` | 24 | def |  | 1 |
| `list_layouts` | 41 | def |  | 1 |
| `save_layout` | 48 | def |  | 1 |
| `load_layout` | 66 | def |  | 1 |

## bridge/bridge/usdz.py（141 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_num` | 21 | def |  | 5 |
| `_points_text` | 25 | def |  | 4 |
| `_ints_text` | 29 | def |  | 4 |
| `_widths_text` | 33 | def |  | 2 |
| `_mesh_prim` | 37 | def |  | 2 |
| `_curves_prim` | 49 | def |  | 2 |
| `_points_prim` | 68 | def |  | 2 |
| `_payload_block` | 76 | def |  | 3 |
| `_build_usda` | 95 | def |  | 2 |
| `_resolve_hip` | 110 | def |  | 2 |
| `build_usdz_bytes` | 118 | def |  | 2 |
| `write_usdz` | 128 | def |  | 1 |

## bridge/bridge/workspace.py（126 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `Workspace` | 10 | class |  | 1 |
| `__init__` | 11 | def |  | 2 |
| `set_inputs` | 20 | def |  | 1 |
| `put_outputs` | 26 | def |  | 1 |
| `get_outputs_since` | 48 | def |  | 1 |
| `output_rev` | 55 | def |  | 1 |
| `all_outputs` | 59 | def |  | 1 |
| `to_summary` | 63 | def |  | 2 |
| `_same_content` | 92 | def |  | 2 |
| `WorkspaceStore` | 102 | class |  | 0 |
| `get_or_create` | 107 | def |  | 2 |
| `get` | 115 | def |  | 4 |
| `serials` | 119 | def |  | 1 |
| `status` | 123 | def |  | 1 |

## bridge/bridge/ws.py（176 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_pack_msg` | 25 | def |  | 2 |
| `ConnectionManager` | 34 | class |  | 1 |
| `__init__` | 35 | def |  | 1 |
| `connect` | 40 | def |  | 2 |
| `disconnect` | 46 | def |  | 3 |
| `send` | 55 | def |  | 6 |
| `receive` | 62 | def |  | 3 |
| `broadcast` | 83 | def |  | 1 |
| `ws_endpoint` | 106 | def |  | 1 |

## hda/scripts/bridge_control.py（229 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_clean_env` | 44 | def |  | 3 |
| `_console_flags` | 51 | def |  | 3 |
| `_get` | 57 | def |  | 3 |
| `_port_up` | 65 | def |  | 6 |
| `bridge_healthy` | 75 | def |  | 4 |
| `frontend_healthy` | 85 | def |  | 3 |
| `houdini_probe` | 89 | def |  | 3 |
| `find_pids` | 104 | def |  | 4 |
| `_wait_port_free` | 122 | def |  | 4 |
| `_kill_port` | 131 | def |  | 5 |
| `ensure_frontend` | 144 | def |  | 2 |
| `start_bridge` | 160 | def |  | 3 |
| `restart_bridge` | 181 | def |  | 1 |
| `toggle_bridge` | 186 | def |  | 1 |
| `status_bridge` | 193 | def |  | 1 |
| `probe` | 205 | def |  | 1 |
| `log_result` | 214 | def |  | 2 |

## hda/scripts/build_hda.py（303 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_parm_group` | 63 | def |  | 3 |
| `_tag_parm_group` | 122 | def |  | 3 |
| `build_tag` | 153 | def |  | 2 |
| `build` | 218 | def |  | 2 |

## hda/scripts/hython_smoke.py（1041 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_req` | 33 | def |  | 8 |
| `_make_curve_input` | 42 | def |  | 2 |
| `_wait_ready_rev` | 60 | def |  | 4 |
| `_FakeClock` | 76 | class |  | 3 |
| `__init__` | 79 | def |  | 9 |
| `now` | 82 | def |  | 1 |
| `step` | 85 | def |  | 13 |
| `_test_stream_loop` | 90 | def |  | 2 |
| `_FakeClient` | 109 | class |  | 5 |
| `probe_once` | 118 | def |  | 5 |
| `stream_once` | 121 | def |  | 4 |
| `pull_outputs` | 127 | def |  | 4 |
| `_Gate` | 131 | class |  | 2 |
| `__call__` | 138 | def |  | 2 |
| `wait_len` | 146 | def |  | 8 |
| `_feed` | 162 | def |  | 10 |
| `_seed_caches` | 168 | def |  | 3 |
| `_assert_caches_cleared` | 177 | def |  | 3 |
| `_test_kick_force_recook` | 316 | def |  | 2 |
| `_test_stop_all_sync` | 374 | def |  | 3 |
| `_test_push_inputs_frame` | 446 | def |  | 2 |
| `_FakeNode` | 456 | class |  | 1 |
| `inputs` | 457 | def |  | 1 |
| `push_inputs` | 464 | def |  | 1 |
| `_FakeRoot` | 467 | class |  | 1 |
| `path` | 468 | def |  | 5 |
| `_test_sync_enabled_gate` | 519 | def |  | 2 |
| `_test_tag_hda` | 629 | def |  | 3 |
| `_Handler` | 639 | class |  | 1 |
| `_record` | 640 | def |  | 3 |
| `_reply` | 645 | def |  | 4 |
| `do_PUT` | 651 | def |  | 1 |
| `do_POST` | 655 | def |  | 1 |
| `do_GET` | 659 | def |  | 1 |
| `log_message` | 662 | def |  | 1 |
| `_test_tag_resolve` | 740 | def |  | 2 |
| `_test_tag_parse_entry` | 751 | def |  | 2 |
| `_test_tag_fingerprint` | 782 | def |  | 2 |
| `_test_tag_heartbeat_throttle` | 793 | def |  | 2 |
| `_Client` | 795 | class |  | 1 |
| `heartbeat_channels` | 800 | def |  | 1 |
| `_test_tag_entries` | 831 | def |  | 2 |
| `main` | 843 | def |  | 2 |
| `_stats` | 934 | def |  | 5 |

## hda/scripts/reload_hda.py（121 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_stop_sync_threads` | 34 | def |  | 3 |
| `_reload_modules` | 55 | def |  | 2 |
| `_instances` | 71 | def |  | 2 |
| `_force_recook_all` | 76 | def |  | 3 |
| `_rebuild_hda` | 90 | def |  | 2 |
| `_reload_definition` | 96 | def |  | 2 |
| `reload_cyl1nder` | 103 | def |  | 3 |

## hda/src/cyl1nder_bridge.py（209 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_b36` | 18 | def |  | 3 |
| `generate_serial` | 29 | def |  | 1 |
| `BridgeClient` | 36 | class |  | 0 |
| `__init__` | 37 | def |  | 1 |
| `push_inputs` | 53 | def |  | 1 |
| `_pump` | 60 | def |  | 1 |
| `report_houdini_mcp` | 89 | def |  | 1 |
| `put_channel` | 109 | def |  | 1 |
| `heartbeat_channels` | 132 | def |  | 1 |
| `pending_outputs` | 152 | def |  | 1 |
| `probe_once` | 173 | def |  | 1 |
| `stream_once` | 183 | def |  | 1 |
| `pull_outputs` | 200 | def |  | 1 |

## hda/src/cyl1nder_cache.py（97 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_ready_state` | 18 | def |  | 2 |
| `_refresh_ready` | 28 | def |  | 1 |
| `_reset_ready` | 55 | def |  | 1 |
| `_reset_caches` | 65 | def |  | 1 |
| `_role_buffer` | 80 | def |  | 1 |

## hda/src/cyl1nder_geometry.py（239 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_serialize_geo` | 14 | def |  | 2 |
| `_build_detail` | 24 | def |  | 2 |
| `_buffer_sig` | 55 | def |  | 2 |
| `_apply_output` | 71 | def |  | 1 |
| `_snapshot_parts` | 111 | def |  | 1 |
| `_flat_signature` | 159 | def |  | 2 |
| `_build_core_detail` | 171 | def |  | 1 |
| `_same_geo` | 195 | def |  | 1 |
| `_input_signature` | 206 | def |  | 1 |

## hda/src/cyl1nder_hda.py（233 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_on_mcp_discovery_found` | 58 | def |  | 2 |
| `_maybe_report_houdini_mcp` | 69 | def |  | 3 |
| `_push_inputs_if_changed` | 104 | def |  | 3 |
| `cook_core` | 144 | def |  | 3 |
| `cook` | 185 | def |  | 3 |

## hda/src/cyl1nder_houdini_mcp.py（272 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_rid` | 43 | def |  | 3 |
| `_norm_hip` | 51 | def |  | 3 |
| `_post_rpc` | 56 | def |  | 4 |
| `probe` | 69 | def |  | 2 |
| `discover_port` | 87 | def |  | 2 |
| `get_frame` | 120 | def |  | 1 |
| `set_frame` | 153 | def |  | 1 |
| `_discover_worker` | 182 | def |  | 1 |
| `start_discovery` | 206 | def |  | 2 |
| `known_port` | 241 | def |  | 1 |
| `mark_reported` | 250 | def |  | 1 |
| `is_reported` | 258 | def |  | 1 |
| `reset_report` | 266 | def |  | 1 |

## hda/src/cyl1nder_lifecycle.py（128 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_ui_healthy` | 25 | def |  | 2 |
| `_ensure_frontend` | 34 | def |  | 1 |
| `_bridge_healthy` | 59 | def |  | 2 |
| `_ensure_bridge` | 67 | def |  | 1 |
| `_root` | 94 | def |  | 2 |
| `_ensure_serial` | 98 | def |  | 1 |
| `_parm` | 111 | def |  | 4 |
| `_set_status` | 121 | def |  | 2 |

## hda/src/cyl1nder_serializer.py（63 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_norm_value` | 12 | def |  | 2 |
| `serialize_input` | 20 | def |  | 1 |

## hda/src/cyl1nder_sync.py（273 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_stream_loop` | 23 | def |  | 1 |
| `_schedule_recook` | 133 | def |  | 4 |
| `_force_cook_node` | 152 | def |  | 1 |
| `stop_sync` | 180 | def |  | 5 |
| `stop_all_sync` | 203 | def |  | 1 |
| `ensure_sync` | 216 | def |  | 4 |

## hda/src/cyl1nder_tag.py（222 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_set_status` | 31 | def |  | 5 |
| `_parse_entries` | 40 | def |  | 2 |
| `_resolve` | 55 | def |  | 2 |
| `_parse_entry` | 68 | def |  | 2 |
| `_fingerprint` | 88 | def |  | 2 |
| `register_channels` | 97 | def |  | 2 |
| `_read_param_values` | 148 | def |  | 2 |
| `heartbeat` | 161 | def |  | 2 |
| `cook` | 182 | def |  | 3 |

## web/src/app/address-bar.ts（310 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `splitAddress` | 32 | function | export | 3 |
| `completeSegment` | 48 | function | export | 2 |
| `createAddressBar` | 91 | function | export | 1 |

## web/src/app/app-config.ts（7 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/app/channel-panel.ts（333 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `isNumericValue` | 43 | function | export | 3 |
| `parseInput` | 48 | function | export | 2 |
| `mergeValues` | 57 | function | export | 2 |
| `mergePending` | 72 | function | export | 2 |
| `clampFps` | 87 | function |  | 2 |
| `initChannelPanel` | 102 | function | export | 1 |
| `onInputChange` | 138 | function |  | 2 |
| `buildRow` | 155 | function |  | 3 |
| `replaceRow` | 177 | function |  | 2 |
| `setRowValue` | 185 | function |  | 2 |
| `renderList` | 195 | function |  | 4 |
| `refresh` | 222 | function |  | 4 |
| `applyValues` | 255 | function |  | 4 |
| `flushPending` | 267 | function |  | 2 |

## web/src/app/color.ts（3 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/app/dock.ts（616 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `layoutDebug` | 62 | function |  | 2 |
| `categorizeLog` | 85 | function |  | 2 |
| `renderLogBody` | 94 | function |  | 4 |
| `createFreshLog` | 100 | function |  | 2 |
| `createFreshInspector` | 128 | function |  | 2 |
| `render` | 131 | arrow |  | 2 |
| `createFreshSpreadsheet` | 153 | function |  | 2 |
| `createFreshParam` | 169 | function |  | 2 |
| `readSyncMaxFpsFromPrefs` | 185 | function |  | 1 |
| `setChannelValuesSink` | 200 | function | export | 1 |
| `createChannelPanel` | 208 | function |  | 3 |
| `createPlaceholder` | 227 | function |  | 2 |
| `createInstanceContent` | 237 | function |  | 2 |
| `nextInstanceIndex` | 263 | function |  | 2 |
| `addInstancePanel` | 273 | function |  | 2 |
| `hideAddMenu` | 287 | function |  | 5 |
| `ensureAddMenu` | 292 | function |  | 2 |
| `toggleAddMenu` | 331 | function |  | 2 |
| `groupIdForButton` | 346 | function |  | 2 |
| `attachTabBarWheel` | 356 | function |  | 2 |
| `closeTabGroup` | 374 | function |  | 2 |
| `refreshAddButtons` | 390 | function |  | 4 |
| `setupDock` | 448 | function | export | 1 |
| `onLayoutChange` | 561 | arrow |  | 0 |
| `applyLayout` | 605 | function | export | 2 |

## web/src/app/layout.ts（295 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `wireFpsStepper` | 31 | function |  | 3 |
| `buildLayout` | 50 | function | export | 1 |
| `buildLayoutLegacy` | 176 | function | export | 1 |

## web/src/app/layouts.ts（11 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/app/log.ts（4 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `formatLog` | 2 | function | export | 1 |

## web/src/app/param.ts（430 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `esc` | 43 | function |  | 8 |
| `attrEscape` | 48 | function |  | 9 |
| `color3ToRgb` | 55 | function |  | 3 |
| `color3Hex` | 67 | function |  | 4 |
| `parseColor3` | 73 | function |  | 3 |
| `controlHtml` | 89 | function |  | 2 |
| `applyEdit` | 118 | function |  | 5 |
| `paramDefault` | 142 | function | export | 3 |
| `closeLinkPop` | 167 | function |  | 9 |
| `tailOfPath` | 176 | function |  | 2 |
| `openLinkPop` | 181 | function |  | 2 |
| `loadChannelItems` | 216 | function |  | 2 |
| `renderParams` | 268 | function | export | 1 |
| `commit` | 315 | arrow |  | 1 |

## web/src/app/preference.ts（343 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `clampSyncFps` | 47 | function | export | 4 |
| `parseUpdateMode` | 53 | function |  | 4 |
| `parseAutosaveInterval` | 58 | function |  | 3 |
| `parseViewportBg` | 65 | function |  | 4 |
| `parseUiFont` | 69 | function |  | 4 |
| `loadPreferences` | 75 | function | export | 1 |
| `savePreferences` | 101 | function | export | 1 |
| `applyPreferences` | 108 | function | export | 1 |
| `openPreferenceDialog` | 131 | function | export | 1 |

## web/src/app/scrub.ts（270 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `format4` | 31 | function | export | 3 |
| `pickMultiplier` | 36 | function | export | 3 |
| `scrubValue` | 47 | function | export | 1 |
| `accumulatedScrub` | 56 | function | export | 3 |
| `scrubPopupTop` | 69 | function | export | 2 |
| `isScrubOutOfBounds` | 83 | function | export | 3 |
| `createScrubState` | 101 | function | export | 2 |
| `scrubPointerMove` | 117 | function | export | 2 |
| `attachScrub` | 139 | function | export | 1 |

## web/src/app/spreadsheet.ts（207 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `esc` | 31 | function |  | 6 |
| `htmlEscape` | 36 | function |  | 2 |
| `fmtNum` | 41 | function |  | 7 |
| `attrRow` | 48 | function |  | 2 |
| `rowHtml` | 58 | function |  | 5 |
| `bodyHtml` | 67 | function |  | 5 |
| `renderPayload` | 73 | function | export | 2 |
| `addVerts` | 114 | arrow |  | 2 |
| `renderSpreadsheet` | 158 | function | export | 1 |

## web/src/app/timeline-ui.ts（134 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createTimelineUI` | 9 | function | export | 1 |

## web/src/app/widgets.ts（210 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createPopupAnchor` | 38 | function |  | 2 |
| `createDropdown` | 46 | function | export | 1 |
| `createStepper` | 130 | function | export | 1 |

## web/src/bridge/client.ts（559 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeClient` | 24 | class | export | 0 |
| `connectWs` | 516 | function | export | 1 |
| `connect` | 521 | arrow |  | 1 |

## web/src/color/color-math.ts（147 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `rgbToHex` | 24 | function | export | 1 |
| `hexToRgb` | 30 | function | export | 1 |
| `rgbToHsl` | 49 | function | export | 1 |
| `hslToRgb` | 69 | function | export | 1 |
| `rgbToHsv` | 95 | function | export | 1 |
| `hsvToRgb` | 113 | function | export | 1 |

## web/src/color/harmony.ts（104 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `harmonyDef` | 93 | function | export | 1 |
| `harmonyColor` | 97 | function | export | 1 |

## web/src/color/palette.ts（53 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `loadRecents` | 14 | function | export | 3 |
| `saveRecents` | 28 | function | export | 4 |
| `recordRecent` | 36 | function | export | 1 |
| `removeRecent` | 43 | function | export | 1 |
| `clearRecents` | 50 | function | export | 1 |

## web/src/color/picker.ts（713 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `fitInViewport` | 64 | function | export | 4 |
| `esc` | 117 | function |  | 2 |
| `valuesForMode` | 124 | function |  | 2 |
| `colorFromMode` | 134 | function |  | 5 |
| `openColorPicker` | 148 | function | export | 2 |

## web/src/color/wheel-sv.ts（200 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createWheelSv` | 51 | function | export | 1 |

## web/src/core/channel-bind.ts（192 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `clampFps` | 58 | function |  | 2 |
| `createChannelBindManager` | 67 | function | export | 1 |
| `ensureSerial` | 81 | function |  | 5 |
| `collectChanges` | 93 | function |  | 2 |
| `flushPending` | 109 | function |  | 3 |
| `onNodeParamsCommitted` | 132 | function |  | 2 |
| `isEcho` | 139 | function |  | 2 |
| `applyIncoming` | 146 | function |  | 2 |
| `flushNow` | 164 | function |  | 2 |
| `dispose` | 171 | function |  | 2 |

## web/src/core/dataflow.ts（246 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `displayNodeOutputIndex` | 41 | function | export | 2 |
| `createDataflow` | 52 | function | export | 1 |
| `getDisplayNodeInfo` | 73 | function |  | 4 |
| `refreshNodeFlags` | 95 | function |  | 5 |
| `flush` | 201 | function |  | 5 |
| `wireSelection` | 236 | function |  | 2 |

## web/src/core/gizmo.ts（162 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createGizmoController` | 51 | function | export | 1 |

## web/src/core/kick.ts（46 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createKickController` | 12 | function | export | 1 |

## web/src/core/lifecycle.ts（67 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createAutosave` | 7 | function | export | 1 |
| `createHdaWatchdog` | 31 | function | export | 1 |
| `check` | 42 | arrow |  | 1 |

## web/src/core/network.ts（115 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createNetworkRunner` | 41 | function | export | 1 |

## web/src/core/param-undo.ts（33 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createParamUndo` | 10 | function | export | 1 |

## web/src/core/params.ts（31 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `readParamFloats` | 8 | function | export | 1 |
| `cloneParams` | 19 | function | export | 1 |
| `paramsEqual` | 24 | function | export | 1 |

## web/src/core/session.ts（184 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createSessionManager` | 66 | function | export | 1 |

## web/src/core/shortcuts.ts（59 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `bindShortcuts` | 18 | function | export | 1 |

## web/src/core/timeline.ts（184 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createTimelineController` | 43 | function | export | 1 |

## web/src/main.ts（1220 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `matchLogFilter` | 57 | arrow |  | 0 |
| `renderLog` | 58 | arrow |  | 3 |
| `isSerial` | 135 | arrow |  | 2 |
| `isProject` | 136 | arrow |  | 2 |
| `toggle` | 219 | arrow |  | 8 |
| `updateLayoutMenuLabel` | 251 | function |  | 5 |
| `getDockJson` | 254 | arrow |  | 6 |
| `saveCurrentLayout` | 258 | arrow |  | 2 |
| `refreshLayoutPresets` | 267 | arrow |  | 1 |
| `writeJsonToDir` | 378 | function |  | 7 |
| `readJsonFromDir` | 389 | function |  | 5 |
| `saveSceneAs` | 403 | function |  | 3 |
| `openSceneFromDir` | 462 | function |  | 2 |
| `applyLayoutSettings` | 787 | function |  | 4 |
| `refreshSelectionPanels` | 802 | function |  | 2 |
| `inputStatsText` | 899 | function |  | 2 |
| `outputStatsText` | 908 | function |  | 2 |
| `renderInspector` | 917 | function |  | 2 |
| `isProjectModeActive` | 935 | function |  | 5 |
| `projectAddress` | 941 | function |  | 3 |
| `saveProjectGraph` | 951 | function |  | 5 |
| `enterProjectMode` | 964 | function |  | 4 |
| `updateGraphAddress` | 1014 | function |  | 8 |
| `scheduleNetwork` | 1042 | function |  | 1 |
| `flushStoreView` | 1045 | function |  | 2 |
| `loadSnapshotIntoStore` | 1072 | function |  | 3 |
| `applyLoadedPreference` | 1109 | function |  | 3 |
| `connectSerial` | 1146 | arrow |  | 1 |
| `markGraphDirty` | 1213 | function |  | 2 |

## web/src/nodes2/chain-cache.ts（358 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `resetChainCache` | 119 | function | export | 1 |
| `resetFallbackMemo` | 126 | function | export | 1 |
| `getCacheChange` | 131 | function | export | 1 |
| `getCacheEntrySpecs` | 139 | function | export | 1 |
| `buildSig` | 144 | function |  | 2 |
| `fullReTrace` | 154 | function |  | 2 |
| `emptyBuffer` | 178 | function |  | 2 |
| `fallbackBuffer` | 183 | function |  | 2 |
| `wrapBuffer` | 198 | function |  | 3 |
| `computeChainCached` | 222 | function |  | 3 |
| `computeOutputsCached` | 303 | function | export | 1 |
| `computeNodeResultCached` | 347 | function | export | 1 |

## web/src/nodes2/graph-interact.ts（1427 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `isReconnectBusy` | 61 | function | export | 4 |
| `registerInteractionCanceller` | 68 | function | export | 5 |
| `cancelGraphInteractions` | 73 | function | export | 1 |
| `attachTabSearch` | 77 | function | export | 1 |
| `render` | 93 | arrow |  | 3 |
| `create` | 108 | arrow |  | 3 |
| `close` | 137 | arrow |  | 6 |
| `update` | 145 | arrow |  | 3 |
| `distToSegment` | 175 | function |  | 2 |
| `sampleConnectionPath` | 185 | function |  | 2 |
| `attachCutMode` | 206 | function | export | 1 |
| `isTyping` | 232 | arrow |  | 1 |
| `pathLen` | 238 | arrow |  | 1 |
| `setPoints` | 243 | arrow |  | 2 |
| `clear` | 247 | arrow |  | 2 |
| `cutConnection` | 252 | arrow |  | 1 |
| `cutByPolyline` | 267 | arrow |  | 1 |
| `up` | 346 | arrow |  | 0 |
| `attachFlagMenu` | 368 | function | export | 1 |
| `show` | 380 | arrow |  | 2 |
| `setNodeStateHandler` | 434 | function | export | 1 |
| `fireNodeState` | 440 | function | export | 1 |
| `setRenameHandler` | 446 | function | export | 1 |
| `fireRename` | 450 | function | export | 1 |
| `initTooltip` | 456 | function | export | 1 |
| `showTooltip` | 463 | function | export | 1 |
| `hideTooltip` | 477 | function | export | 1 |
| `attachMMBPan` | 485 | function | export | 1 |
| `onMove` | 496 | arrow |  | 0 |
| `onUp` | 499 | arrow |  | 0 |
| `attachDotGrid` | 517 | function | export | 1 |
| `hitTestConnection` | 551 | function |  | 5 |
| `connectionPathD` | 580 | function |  | 7 |
| `isInsertable` | 588 | function |  | 2 |
| `attachInsertion` | 592 | function | export | 1 |
| `refreshPreview` | 640 | arrow |  | 2 |
| `updatePreview` | 648 | arrow |  | 3 |
| `setHover` | 671 | arrow |  | 3 |
| `attachRectSelect` | 800 | function | export | 1 |
| `attachShakeDisconnect` | 876 | function | export | 1 |
| `reset` | 887 | arrow |  | 0 |
| `shakeNode` | 893 | arrow |  | 1 |
| `getSelectedConnectionId` | 1007 | function | export | 1 |
| `connectionPathEl` | 1011 | function |  | 4 |
| `selectConnection` | 1015 | function |  | 2 |
| `clearConnectionSelection` | 1022 | function | export | 3 |
| `attachConnectionSelect` | 1031 | function | export | 1 |
| `hitTestPort` | 1064 | function |  | 4 |
| `attachReconnect` | 1100 | function | export | 1 |
| `toLocal` | 1129 | arrow |  | 2 |
| `setPortHighlight` | 1150 | arrow |  | 2 |
| `markGrabbedPath` | 1164 | arrow |  | 2 |
| `clearReconnect` | 1202 | arrow |  | 11 |
| `labelOf` | 1218 | arrow |  | 8 |
| `applyReconnect` | 1221 | arrow |  | 2 |
| `insertDotAt` | 1303 | arrow |  | 1 |

## web/src/nodes2/graph-model.ts（735 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `notifySelection` | 114 | function | export | 2 |
| `onSelectionChange` | 118 | function | export | 1 |
| `nodeByKind` | 123 | function | export | 1 |
| `resolveInputSourcePort` | 134 | function | export | 2 |
| `nodeFromTarget` | 158 | function | export | 1 |
| `renderNode` | 174 | function | export | 1 |
| `portIndexFromTarget` | 189 | function | export | 1 |
| `CylNode` | 197 | class | export | 7 |
| `makeInputNode` | 235 | function | export | 2 |
| `makeOutputNode` | 240 | function | export | 2 |
| `makeNullNode` | 247 | function | export | 2 |
| `makeDotNode` | 258 | function | export | 2 |
| `claimDotLabel` | 269 | function | export | 2 |
| `makeTransformNode` | 278 | function | export | 2 |
| `makeProjectNode` | 308 | function | export | 2 |
| `makeChannelNode` | 317 | function | export | 2 |
| `getConnectionBypass` | 334 | function | export | 2 |
| `setConnectionBypassFlag` | 338 | function | export | 2 |
| `applyConnectionBypassVisual` | 347 | function | export | 2 |
| `buildGraphSnapshot` | 395 | function | export | 2 |
| `serializeGraph` | 420 | function | export | 2 |
| `restoreNodeForKind` | 467 | function | export | 2 |
| `restoreGraph` | 508 | function | export | 2 |
| `sanitizeBindings` | 595 | function | export | 2 |
| `nodeParamBindingsView` | 605 | function | export | 1 |
| `listNodeParamBindingsView` | 618 | function | export | 1 |
| `applyNodeBindings` | 634 | function | export | 1 |
| `getNetworkSnapshot` | 649 | function | export | 2 |
| `planProjectGraph` | 698 | function | export | 1 |

## web/src/nodes2/graph-undo.ts（202 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `actionContainsParams` | 16 | function | export | 2 |
| `findConnectionByRef` | 23 | function |  | 2 |
| `applyUndoAction` | 34 | function | export | 3 |
| `addConn` | 40 | arrow |  | 14 |
| `delConn` | 48 | arrow |  | 14 |
| `lbl` | 52 | arrow |  | 5 |
| `createGraphUndoManager` | 169 | function | export | 1 |

## web/src/nodes2/graph.ts（601 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `setChannelDisplayHandler` | 86 | function | export | 2 |
| `getChannelDisplaySerial` | 91 | function | export | 1 |
| `isProjectMode` | 96 | function | export | 2 |
| `loadProjectGraph` | 108 | function | export | 2 |
| `projectGraphSnapshot` | 145 | function | export | 2 |
| `getNodeParamBindings` | 159 | function | export | 1 |
| `listNodeParamBindings` | 166 | function | export | 1 |
| `setNodeBindings` | 177 | function | export | 1 |
| `displayChainConnectionIds` | 184 | function |  | 2 |
| `buildGraph` | 204 | function |  | 2 |
| `createReteGraph` | 317 | function | export | 1 |

## web/src/nodes2/groups.ts（32 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/nodes2/groups/matcher.ts（317 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `idSpecMatches` | 23 | function | export | 2 |
| `uniq` | 51 | function | export | 3 |
| `primPointSets` | 64 | function | export | 2 |
| `vertexMap` | 72 | function | export | 2 |
| `range` | 79 | function | export | 7 |
| `rulePoint` | 86 | function | export | 2 |
| `elementPoints` | 110 | function | export | 2 |
| `compIndex` | 135 | function | export | 2 |
| `toNum` | 141 | function | export | 7 |
| `eqScalar` | 149 | function | export | 6 |
| `arraysEqual` | 154 | function | export | 3 |
| `parseValueList` | 162 | function | export | 2 |
| `firstNum` | 170 | function | export | 3 |
| `compareLhs` | 179 | function | export | 2 |
| `ruleMatchesElement` | 232 | function | export | 2 |
| `computeSelection` | 270 | function | export | 3 |
| `pointInGroup` | 309 | function | export | 1 |
| `matchingPoints` | 314 | function | export | 1 |

## web/src/nodes2/groups/parser.ts（208 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `tokenize` | 53 | function | export | 2 |
| `mergeAttrTokens` | 97 | function | export | 2 |
| `isNumeric` | 117 | function | export | 1 |
| `parseToken` | 122 | function | export | 2 |
| `parseGroupExpression` | 161 | function | export | 1 |
| `stripAttrKey` | 185 | function | export | 2 |
| `resolveAttribute` | 194 | function | export | 1 |

## web/src/nodes2/network.ts（292 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `paramValue` | 66 | function | export | 6 |
| `asFiniteNumber` | 77 | function |  | 4 |
| `toGroupClass` | 83 | function |  | 2 |
| `findFeeder` | 88 | function | export | 3 |
| `nodeById` | 96 | function | export | 4 |
| `parseInPort` | 101 | function |  | 2 |
| `isPositionDependent` | 113 | function |  | 2 |
| `traceChainSpecs` | 128 | function | export | 3 |
| `emptyBuffer` | 171 | function |  | 2 |
| `fallbackBuffer` | 176 | function |  | 2 |
| `traceChain` | 203 | function |  | 3 |
| `bufferFromResolved` | 220 | function |  | 3 |
| `computeOutputsDetailed` | 242 | function | export | 2 |
| `computeOutputs` | 263 | function | export | 1 |
| `computeNodeResult` | 280 | function | export | 1 |

## web/src/nodes2/undo.ts（135 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createUndoManager` | 76 | function | export | 2 |

## web/src/overview.ts（772 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `HttpError` | 41 | class |  | 3 |
| `epochMs` | 56 | function |  | 6 |
| `relTime` | 60 | function |  | 8 |
| `clockTime` | 72 | function |  | 2 |
| `channelValueString` | 82 | function | export | 3 |
| `formatChannelValue` | 92 | function | export | 2 |
| `channelActionButtons` | 99 | function | export | 2 |
| `$` | 112 | function |  | 0 |
| `setBanner` | 130 | function |  | 4 |
| `openSerial` | 135 | function |  | 4 |
| `activeState` | 140 | function |  | 2 |
| `activeRowHtml` | 156 | function |  | 1 |
| `historyRowHtml` | 173 | function |  | 1 |
| `renderActive` | 182 | function |  | 2 |
| `renderHistory` | 188 | function |  | 2 |
| `renderUnavailable` | 194 | function |  | 2 |
| `fetchScenes` | 203 | function |  | 2 |
| `failMessage` | 210 | function |  | 3 |
| `loadScenes` | 219 | function |  | 4 |
| `cleanupScenes` | 240 | function |  | 2 |
| `channelLabel` | 316 | function |  | 2 |
| `channelState` | 326 | function |  | 2 |
| `channelRowHtml` | 334 | function |  | 1 |
| `renderChannels` | 378 | function |  | 4 |
| `findChannelRow` | 384 | function |  | 4 |
| `setChannelRowState` | 392 | function |  | 2 |
| `probeChannel` | 399 | function |  | 3 |
| `setValueCell` | 432 | function |  | 3 |
| `readChannelValue` | 447 | function |  | 2 |
| `writeChannelValue` | 457 | function |  | 2 |
| `loadChannels` | 478 | function |  | 3 |
| `showProjectsError` | 566 | function |  | 6 |
| `hideProjectsError` | 570 | function |  | 5 |
| `projectDisplayName` | 575 | function |  | 2 |
| `memberDisplayName` | 580 | function |  | 2 |
| `memberRowHtml` | 585 | function |  | 2 |
| `projectRowHtml` | 601 | function |  | 1 |
| `renderProjects` | 623 | function |  | 5 |
| `loadProjects` | 629 | function |  | 6 |
| `removeMember` | 658 | function |  | 2 |
| `addMemberByDrop` | 670 | function |  | 2 |
| `clearDropHover` | 733 | function |  | 4 |

## web/src/protocol/compare.ts（24 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `payloadEqual` | 4 | function |  | 2 |
| `inputsEqual` | 16 | function | export | 1 |

## web/src/protocol/types.ts（196 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/stores/channels.ts（63 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ChannelsStore` | 10 | class | export | 1 |
| `channelIdOf` | 58 | function | export | 3 |

## web/src/stores/projects.ts（48 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ProjectsStore` | 8 | class | export | 1 |

## web/src/stores/workspace.ts（152 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `deepEqual` | 4 | function |  | 6 |
| `outputsEqual` | 26 | function | export | 2 |
| `WorkspaceStore` | 39 | class | export | 1 |

## web/src/tools/transform.ts（100 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `translatePoint` | 5 | function | export | 4 |
| `translatePoints` | 9 | function | export | 1 |
| `applyTranslateToCurve` | 14 | function | export | 1 |
| `inputToOutput` | 31 | function | export | 1 |
| `applyTranslateGrouped` | 52 | function | export | 1 |
| `applyTranslateDeltaInPlace` | 77 | function | export | 1 |

## web/src/trace.ts（234 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `buildTraceQuery` | 24 | function | export | 1 |
| `truncateDigest` | 35 | function | export | 4 |
| `formatTraceTime` | 41 | function | export | 2 |
| `actorColor` | 56 | function | export | 2 |
| `$` | 70 | function |  | 0 |
| `setBanner` | 92 | function |  | 6 |
| `failMessage` | 98 | function |  | 2 |
| `loadProjects` | 108 | function |  | 2 |
| `currentFilters` | 134 | function |  | 2 |
| `eventRowHtml` | 147 | function |  | 2 |
| `renderEvents` | 161 | function |  | 2 |
| `toggleDigest` | 173 | function |  | 2 |
| `loadEvents` | 186 | function |  | 6 |
| `boot` | 205 | function |  | 2 |

## web/src/viewport/backend.ts（31 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createRenderer` | 18 | function | export | 1 |

## web/src/viewport/camera.ts（58 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createCamera` | 11 | function | export | 1 |
| `frameVisible` | 18 | function | export | 1 |
| `frameDefault` | 50 | function | export | 2 |

## web/src/viewport/controls.ts（117 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `dollyCamera` | 12 | function |  | 3 |
| `HoudiniControls` | 36 | class | export | 0 |
| `onMove` | 73 | arrow |  | 0 |
| `up` | 82 | arrow |  | 1 |
| `release` | 106 | arrow |  | 0 |

## web/src/viewport/geometry.ts（372 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `toVec` | 7 | function |  | 1 |
| `buildWireSegments` | 13 | function |  | 2 |
| `buildMeshFaces` | 45 | function | export | 2 |
| `buildPoints` | 78 | function |  | 2 |
| `buildCurves` | 91 | function | export | 5 |
| `buildInputs` | 130 | function | export | 1 |
| `buildOutputs` | 140 | function | export | 1 |
| `buildNodeResult` | 157 | function | export | 1 |
| `sameTopology` | 174 | function | export | 1 |
| `findDerivedCache` | 219 | function |  | 2 |
| `updateGroupPositions` | 243 | function | export | 1 |

## web/src/viewport/gizmo.ts（258 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createGizmo` | 43 | function | export | 1 |
| `setEnterEditHandler` | 93 | arrow |  | 1 |

## web/src/viewport/modes.ts（63 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `applyDisplayModeToGroup` | 28 | function | export | 1 |

## web/src/viewport/picking.ts（116 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createPicking` | 28 | function | export | 1 |
| `pickByNode` | 33 | function |  | 2 |
| `onPointerDown` | 63 | function |  | 2 |
| `select` | 76 | function |  | 3 |
| `clearSelection` | 89 | function |  | 2 |
| `commitEdit` | 96 | function |  | 2 |

## web/src/viewport/renderer.ts（594 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `Viewport` | 31 | class | export | 1 |
| `showModeMenu` | 119 | arrow |  | 1 |
| `hideModeMenu` | 131 | arrow |  | 2 |
| `applyMode` | 132 | arrow |  | 1 |
| `openModeMenu` | 147 | arrow |  | 1 |
| `closeModeMenu` | 148 | arrow |  | 3 |

## web/src/viewport/scene.ts（46 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `buildViewportScene` | 18 | function | export | 1 |
| `makeBox` | 40 | function | export | 3 |

## web/src/viewport/state.ts（11 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
