# 函数索引 / FUNCTION INDEX

> 机器生成（2026-08-15），由 `node scripts/gen-index.mjs` 产出。共 **811** 个函数/类。
> 用途：agent 先 grep 函数名定位，再跳读对应文件/行号；`calls` = 文件内 `name(` 出现次数（hub 指标，越大越核心）。

## bridge/bridge/__init__.py（5 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## bridge/bridge/__main__.py（15 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `main` | 7 | def |  | 2 |

## bridge/bridge/channel_routes.py（149 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_check_serial` | 29 | def |  | 2 |
| `_key_of` | 34 | def |  | 3 |
| `_path_key` | 40 | def |  | 2 |
| `_probe_key` | 47 | def |  | 2 |
| `put_channel` | 53 | def |  | 1 |
| `list_channels` | 70 | def |  | 1 |
| `HeartbeatBody` | 74 | class |  | 1 |
| `heartbeat` | 82 | def |  | 1 |
| `probe` | 101 | def |  | 1 |
| `_node_type_name` | 136 | def |  | 2 |

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

## bridge/bridge/houdini_routes.py（517 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_get_interval` | 76 | def |  | 3 |
| `_get_set_interval` | 81 | def |  | 3 |
| `_check_serial` | 86 | def |  | 8 |
| `_tl_default` | 91 | def |  | 6 |
| `_resolve_port` | 95 | def |  | 1 |
| `_poller_done` | 134 | def |  | 2 |
| `_inflight_done` | 140 | def |  | 2 |
| `ensure_poller` | 146 | def |  | 2 |
| `_poller_loop` | 160 | def |  | 2 |
| `_get_frame_once` | 193 | def |  | 2 |
| `_apply_frame` | 214 | def |  | 3 |
| `get_timeline` | 248 | def |  | 1 |
| `TimelinePut` | 281 | class |  | 1 |
| `put_timeline` | 286 | def |  | 1 |
| `_arm_set_flush` | 312 | def |  | 3 |
| `_flush_pending` | 323 | def |  | 2 |
| `_send_pending` | 333 | def |  | 3 |
| `HouTimelinePut` | 376 | class |  | 1 |
| `put_hou_timeline` | 382 | def |  | 1 |
| `get_houdini` | 409 | def |  | 1 |
| `HoudiniPut` | 419 | class |  | 1 |
| `put_houdini` | 424 | def |  | 1 |
| `CmdBody` | 440 | class |  | 1 |
| `_trace_houdini_cmd` | 445 | def |  | 2 |
| `houdini_cmd` | 471 | def |  | 1 |
| `PythonBody` | 488 | class |  | 1 |
| `houdini_python` | 494 | def |  | 1 |

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

## bridge/bridge/protocol.py（181 行）

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
| `generate_project_serial` | 153 | def |  | 1 |
| `is_valid_project_serial` | 160 | def |  | 1 |
| `ProjectRef` | 164 | class |  | 1 |
| `OutputsPut` | 173 | class |  | 1 |
| `SyncEnabledPut` | 178 | class |  | 1 |

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

## hda/scripts/hython_smoke.py（987 行）

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
| `path` | 468 | def |  | 4 |
| `_test_sync_enabled_gate` | 519 | def |  | 2 |
| `_test_tag_hda` | 629 | def |  | 2 |
| `_Handler` | 639 | class |  | 1 |
| `_record` | 640 | def |  | 3 |
| `_reply` | 645 | def |  | 4 |
| `do_PUT` | 651 | def |  | 1 |
| `do_POST` | 655 | def |  | 1 |
| `do_GET` | 659 | def |  | 1 |
| `log_message` | 662 | def |  | 1 |
| `_test_tag_resolve` | 726 | def |  | 2 |
| `_test_tag_fingerprint` | 737 | def |  | 2 |
| `_test_tag_heartbeat_throttle` | 748 | def |  | 2 |
| `_Client` | 750 | class |  | 1 |
| `heartbeat_channels` | 755 | def |  | 1 |
| `_test_tag_entries` | 778 | def |  | 2 |
| `main` | 790 | def |  | 2 |
| `_stats` | 881 | def |  | 5 |

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

## hda/src/cyl1nder_tag.py（157 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_set_status` | 30 | def |  | 4 |
| `_parse_entries` | 39 | def |  | 2 |
| `_resolve` | 54 | def |  | 2 |
| `_fingerprint` | 67 | def |  | 2 |
| `register_channels` | 73 | def |  | 2 |
| `heartbeat` | 109 | def |  | 2 |
| `cook` | 126 | def |  | 3 |

## web/src/app/address-bar.ts（310 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `splitAddress` | 32 | function | export | 3 |
| `completeSegment` | 48 | function | export | 2 |
| `createAddressBar` | 91 | function | export | 1 |

## web/src/app/app-config.ts（7 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/app/color.ts（3 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/app/dock.ts（541 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `layoutDebug` | 57 | function |  | 2 |
| `categorizeLog` | 80 | function |  | 2 |
| `renderLogBody` | 89 | function |  | 4 |
| `createFreshLog` | 95 | function |  | 2 |
| `createFreshInspector` | 123 | function |  | 2 |
| `render` | 126 | arrow |  | 2 |
| `createFreshSpreadsheet` | 148 | function |  | 2 |
| `createFreshParam` | 164 | function |  | 2 |
| `createPlaceholder` | 179 | function |  | 2 |
| `createInstanceContent` | 189 | function |  | 2 |
| `nextInstanceIndex` | 213 | function |  | 2 |
| `addInstancePanel` | 223 | function |  | 2 |
| `hideAddMenu` | 237 | function |  | 5 |
| `ensureAddMenu` | 242 | function |  | 2 |
| `toggleAddMenu` | 281 | function |  | 2 |
| `groupIdForButton` | 296 | function |  | 2 |
| `attachTabBarWheel` | 306 | function |  | 2 |
| `closeTabGroup` | 324 | function |  | 2 |
| `refreshAddButtons` | 340 | function |  | 4 |
| `setupDock` | 398 | function | export | 1 |
| `onLayoutChange` | 486 | arrow |  | 0 |
| `applyLayout` | 530 | function | export | 1 |

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

## web/src/app/param.ts（279 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `esc` | 31 | function |  | 5 |
| `attrEscape` | 36 | function |  | 5 |
| `color3ToRgb` | 43 | function |  | 3 |
| `color3Hex` | 55 | function |  | 4 |
| `parseColor3` | 61 | function |  | 3 |
| `controlHtml` | 77 | function |  | 2 |
| `applyEdit` | 106 | function |  | 5 |
| `paramDefault` | 130 | function | export | 3 |
| `renderParams` | 146 | function | export | 1 |
| `commit` | 187 | arrow |  | 1 |

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

## web/src/bridge/client.ts（459 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeClient` | 24 | class | export | 0 |
| `connectWs` | 416 | function | export | 1 |
| `connect` | 421 | arrow |  | 1 |

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

## web/src/core/session.ts（176 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createSessionManager` | 63 | function | export | 1 |

## web/src/core/shortcuts.ts（59 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `bindShortcuts` | 18 | function | export | 1 |

## web/src/core/timeline.ts（184 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createTimelineController` | 43 | function | export | 1 |

## web/src/main.ts（1162 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `matchLogFilter` | 56 | arrow |  | 0 |
| `renderLog` | 57 | arrow |  | 3 |
| `isSerial` | 132 | arrow |  | 2 |
| `isProject` | 133 | arrow |  | 2 |
| `toggle` | 216 | arrow |  | 8 |
| `updateLayoutMenuLabel` | 248 | function |  | 5 |
| `getDockJson` | 251 | arrow |  | 6 |
| `saveCurrentLayout` | 255 | arrow |  | 2 |
| `refreshLayoutPresets` | 264 | arrow |  | 1 |
| `writeJsonToDir` | 375 | function |  | 7 |
| `readJsonFromDir` | 386 | function |  | 5 |
| `saveSceneAs` | 400 | function |  | 3 |
| `openSceneFromDir` | 459 | function |  | 2 |
| `applyLayoutSettings` | 751 | function |  | 4 |
| `refreshSelectionPanels` | 766 | function |  | 1 |
| `inputStatsText` | 841 | function |  | 2 |
| `outputStatsText` | 850 | function |  | 2 |
| `renderInspector` | 859 | function |  | 2 |
| `isProjectModeActive` | 877 | function |  | 5 |
| `projectAddress` | 883 | function |  | 3 |
| `saveProjectGraph` | 893 | function |  | 5 |
| `enterProjectMode` | 906 | function |  | 4 |
| `updateGraphAddress` | 956 | function |  | 8 |
| `scheduleNetwork` | 984 | function |  | 1 |
| `flushStoreView` | 987 | function |  | 2 |
| `loadSnapshotIntoStore` | 1014 | function |  | 3 |
| `applyLoadedPreference` | 1051 | function |  | 3 |
| `connectSerial` | 1088 | arrow |  | 1 |
| `markGraphDirty` | 1155 | function |  | 2 |

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

## web/src/nodes2/graph-model.ts（646 行）

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
| `makeInputNode` | 232 | function | export | 2 |
| `makeOutputNode` | 237 | function | export | 2 |
| `makeNullNode` | 244 | function | export | 2 |
| `makeDotNode` | 255 | function | export | 2 |
| `claimDotLabel` | 266 | function | export | 2 |
| `makeTransformNode` | 275 | function | export | 2 |
| `makeProjectNode` | 305 | function | export | 2 |
| `makeChannelNode` | 314 | function | export | 2 |
| `getConnectionBypass` | 331 | function | export | 2 |
| `setConnectionBypassFlag` | 335 | function | export | 2 |
| `applyConnectionBypassVisual` | 344 | function | export | 2 |
| `buildGraphSnapshot` | 390 | function | export | 2 |
| `serializeGraph` | 413 | function | export | 2 |
| `restoreNodeForKind` | 458 | function | export | 2 |
| `restoreGraph` | 484 | function | export | 2 |
| `getNetworkSnapshot` | 560 | function | export | 2 |
| `planProjectGraph` | 609 | function | export | 1 |

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

## web/src/nodes2/graph.ts（566 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `setChannelDisplayHandler` | 83 | function | export | 2 |
| `getChannelDisplaySerial` | 88 | function | export | 1 |
| `isProjectMode` | 93 | function | export | 2 |
| `loadProjectGraph` | 105 | function | export | 2 |
| `projectGraphSnapshot` | 142 | function | export | 2 |
| `displayChainConnectionIds` | 149 | function |  | 2 |
| `buildGraph` | 169 | function |  | 2 |
| `createReteGraph` | 282 | function | export | 1 |

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

## web/src/overview.ts（672 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `HttpError` | 38 | class |  | 3 |
| `$` | 49 | function |  | 0 |
| `epochMs` | 71 | function |  | 6 |
| `relTime` | 75 | function |  | 8 |
| `clockTime` | 87 | function |  | 2 |
| `setBanner` | 93 | function |  | 4 |
| `openSerial` | 98 | function |  | 4 |
| `activeState` | 103 | function |  | 2 |
| `activeRowHtml` | 119 | function |  | 1 |
| `historyRowHtml` | 136 | function |  | 1 |
| `renderActive` | 145 | function |  | 2 |
| `renderHistory` | 151 | function |  | 2 |
| `renderUnavailable` | 157 | function |  | 2 |
| `fetchScenes` | 166 | function |  | 2 |
| `failMessage` | 173 | function |  | 3 |
| `loadScenes` | 182 | function |  | 4 |
| `cleanupScenes` | 203 | function |  | 2 |
| `channelLabel` | 279 | function |  | 2 |
| `channelState` | 289 | function |  | 2 |
| `channelRowHtml` | 297 | function |  | 1 |
| `renderChannels` | 338 | function |  | 4 |
| `findChannelRow` | 344 | function |  | 2 |
| `setChannelRowState` | 352 | function |  | 2 |
| `probeChannel` | 359 | function |  | 3 |
| `loadChannels` | 391 | function |  | 3 |
| `showProjectsError` | 467 | function |  | 6 |
| `hideProjectsError` | 471 | function |  | 5 |
| `projectDisplayName` | 476 | function |  | 2 |
| `memberDisplayName` | 481 | function |  | 2 |
| `memberRowHtml` | 486 | function |  | 2 |
| `projectRowHtml` | 502 | function |  | 1 |
| `renderProjects` | 524 | function |  | 5 |
| `loadProjects` | 530 | function |  | 6 |
| `removeMember` | 559 | function |  | 2 |
| `addMemberByDrop` | 571 | function |  | 2 |
| `clearDropHover` | 634 | function |  | 4 |

## web/src/protocol/compare.ts（24 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `payloadEqual` | 4 | function |  | 2 |
| `inputsEqual` | 16 | function | export | 1 |

## web/src/protocol/types.ts（191 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/stores/channels.ts（62 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ChannelsStore` | 10 | class | export | 1 |
| `channelIdOf` | 57 | function | export | 3 |

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
