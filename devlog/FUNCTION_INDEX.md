# 函数索引 / FUNCTION INDEX

> 机器生成（2026-08-14），由 `node scripts/gen-index.mjs` 产出。共 **674** 个函数/类。
> 用途：agent 先 grep 函数名定位，再跳读对应文件/行号；`calls` = 文件内 `name(` 出现次数（hub 指标，越大越核心）。

## bridge/bridge/__init__.py（5 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## bridge/bridge/__main__.py（15 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `main` | 7 | def |  | 2 |

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

## bridge/bridge/houdini_routes.py（482 行）

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
| `houdini_cmd` | 446 | def |  | 1 |
| `PythonBody` | 461 | class |  | 1 |
| `houdini_python` | 467 | def |  | 1 |

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

## bridge/bridge/main.py（53 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `lifespan` | 20 | def |  | 1 |
| `create_app` | 34 | def |  | 2 |

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

## bridge/bridge/protocol.py（146 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_b36` | 70 | def |  | 3 |
| `generate_serial` | 81 | def |  | 1 |
| `is_valid_serial` | 92 | def |  | 1 |
| `AttributeData` | 96 | class |  | 1 |
| `CurveData` | 102 | class |  | 1 |
| `InputPayload` | 107 | class |  | 1 |
| `OutputBuffer` | 118 | class |  | 1 |
| `InputsPut` | 129 | class |  | 1 |
| `OutputsPut` | 138 | class |  | 1 |
| `SyncEnabledPut` | 143 | class |  | 1 |

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

## bridge/bridge/routes.py（420 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `root` | 38 | def |  | 1 |
| `_check_serial` | 45 | def |  | 15 |
| `health` | 51 | def |  | 1 |
| `list_serials` | 57 | def |  | 1 |
| `status` | 62 | def |  | 2 |
| `put_inputs` | 75 | def |  | 1 |
| `get_outputs` | 93 | def |  | 1 |
| `put_outputs` | 111 | def |  | 2 |
| `_parse_outputs_body` | 134 | def |  | 2 |
| `SyncFpsPut` | 159 | class |  | 1 |
| `put_sync_fps` | 165 | def |  | 1 |
| `put_sync_enabled` | 174 | def |  | 1 |
| `pending` | 183 | def |  | 1 |
| `_ndjson` | 205 | def |  | 9 |
| `stream` | 211 | def |  | 1 |
| `kick` | 258 | def |  | 1 |
| `serial_logs` | 280 | def |  | 1 |
| `get_snapshot` | 290 | def |  | 1 |
| `get_ui_layout` | 301 | def |  | 1 |
| `put_ui_layout` | 308 | def |  | 1 |
| `put_snapshot` | 316 | def |  | 1 |
| `ui_layouts` | 334 | def |  | 1 |
| `ui_layout_save` | 340 | def |  | 1 |
| `ui_layout_load` | 347 | def |  | 1 |
| `global_logs` | 354 | def |  | 1 |
| `scenes_list` | 365 | def |  | 1 |
| `scenes_create` | 371 | def |  | 1 |
| `scenes_cleanup` | 378 | def |  | 1 |
| `scene_save` | 384 | def |  | 1 |
| `scenes_open` | 395 | def |  | 1 |
| `get_usdz` | 408 | def |  | 1 |

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

## bridge/bridge/snapshot.py（292 行）

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

## bridge/bridge/state.py（246 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeState` | 27 | class |  | 2 |
| `__init__` | 28 | def |  | 1 |
| `set_sync_fps` | 57 | def |  | 1 |
| `get_sync_fps` | 68 | def |  | 3 |
| `set_sync_enabled` | 72 | def |  | 1 |
| `get_sync_enabled` | 77 | def |  | 1 |
| `set_kick` | 83 | def |  | 1 |
| `take_kick` | 88 | def |  | 1 |
| `try_arm_kick` | 93 | def |  | 1 |
| `subscribe` | 110 | def |  | 1 |
| `unsubscribe` | 119 | def |  | 2 |
| `notify_stream` | 128 | def |  | 1 |
| `_wake_stream` | 157 | def |  | 1 |
| `stage_broadcast` | 168 | def |  | 1 |
| `_arm_broadcast_flush` | 200 | def |  | 1 |
| `_flush_broadcast` | 207 | def |  | 3 |
| `default_data_dir` | 227 | def |  | 2 |
| `get_state` | 234 | def |  | 1 |
| `reset_state` | 241 | def |  | 1 |

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

## bridge/bridge/ws.py（168 行）

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

## hda/scripts/build_hda.py（200 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_parm_group` | 57 | def |  | 3 |
| `build` | 116 | def |  | 2 |

## hda/scripts/hython_smoke.py（818 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_req` | 31 | def |  | 8 |
| `_make_curve_input` | 40 | def |  | 2 |
| `_wait_ready_rev` | 58 | def |  | 4 |
| `_FakeClock` | 74 | class |  | 3 |
| `__init__` | 77 | def |  | 8 |
| `now` | 80 | def |  | 1 |
| `step` | 83 | def |  | 13 |
| `_test_stream_loop` | 88 | def |  | 2 |
| `_FakeClient` | 107 | class |  | 5 |
| `probe_once` | 116 | def |  | 5 |
| `stream_once` | 119 | def |  | 4 |
| `pull_outputs` | 125 | def |  | 4 |
| `_Gate` | 129 | class |  | 2 |
| `__call__` | 136 | def |  | 2 |
| `wait_len` | 144 | def |  | 8 |
| `_feed` | 160 | def |  | 10 |
| `_seed_caches` | 166 | def |  | 3 |
| `_assert_caches_cleared` | 175 | def |  | 3 |
| `_test_kick_force_recook` | 314 | def |  | 2 |
| `_test_stop_all_sync` | 372 | def |  | 3 |
| `_test_push_inputs_frame` | 444 | def |  | 2 |
| `_FakeNode` | 454 | class |  | 1 |
| `inputs` | 455 | def |  | 1 |
| `push_inputs` | 462 | def |  | 1 |
| `_FakeRoot` | 465 | class |  | 1 |
| `path` | 466 | def |  | 3 |
| `_test_sync_enabled_gate` | 517 | def |  | 2 |
| `main` | 627 | def |  | 2 |
| `_stats` | 718 | def |  | 5 |

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

## hda/src/cyl1nder_bridge.py（165 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_b36` | 17 | def |  | 3 |
| `generate_serial` | 28 | def |  | 1 |
| `BridgeClient` | 35 | class |  | 0 |
| `__init__` | 36 | def |  | 1 |
| `push_inputs` | 52 | def |  | 1 |
| `_pump` | 59 | def |  | 1 |
| `report_houdini_mcp` | 88 | def |  | 1 |
| `pending_outputs` | 108 | def |  | 1 |
| `probe_once` | 129 | def |  | 1 |
| `stream_once` | 139 | def |  | 1 |
| `pull_outputs` | 156 | def |  | 1 |

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

## web/src/app/address-bar.ts（308 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `splitAddress` | 30 | function | export | 3 |
| `completeSegment` | 46 | function | export | 2 |
| `createAddressBar` | 89 | function | export | 1 |

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

## web/src/bridge/client.ts（327 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeClient` | 24 | class | export | 0 |
| `connectWs` | 284 | function | export | 1 |
| `connect` | 289 | arrow |  | 1 |

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

## web/src/core/dataflow.ts（241 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `displayNodeOutputIndex` | 41 | function | export | 2 |
| `createDataflow` | 52 | function | export | 1 |
| `getDisplayNodeInfo` | 70 | function |  | 4 |
| `refreshNodeFlags` | 90 | function |  | 5 |
| `flush` | 196 | function |  | 5 |
| `wireSelection` | 231 | function |  | 2 |

## web/src/core/gizmo.ts（162 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createGizmoController` | 51 | function | export | 1 |

## web/src/core/kick.ts（46 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createKickController` | 12 | function | export | 1 |

## web/src/core/lifecycle.ts（58 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createAutosave` | 7 | function | export | 1 |
| `createHdaWatchdog` | 31 | function | export | 1 |
| `check` | 42 | arrow |  | 1 |

## web/src/core/network.ts（113 行）

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

## web/src/core/session.ts（100 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createSessionController` | 33 | function | export | 1 |

## web/src/core/shortcuts.ts（59 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `bindShortcuts` | 18 | function | export | 1 |

## web/src/core/timeline.ts（184 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createTimelineController` | 43 | function | export | 1 |

## web/src/main.ts（1002 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `matchLogFilter` | 55 | arrow |  | 0 |
| `renderLog` | 56 | arrow |  | 3 |
| `toggle` | 170 | arrow |  | 8 |
| `updateLayoutMenuLabel` | 202 | function |  | 5 |
| `getDockJson` | 205 | arrow |  | 6 |
| `saveCurrentLayout` | 209 | arrow |  | 2 |
| `refreshLayoutPresets` | 218 | arrow |  | 1 |
| `writeJsonToDir` | 324 | function |  | 7 |
| `readJsonFromDir` | 335 | function |  | 5 |
| `saveSceneAs` | 349 | function |  | 3 |
| `openSceneFromDir` | 403 | function |  | 2 |
| `applyLayoutSettings` | 690 | function |  | 4 |
| `refreshSelectionPanels` | 705 | function |  | 1 |
| `inputStatsText` | 780 | function |  | 2 |
| `outputStatsText` | 789 | function |  | 2 |
| `renderInspector` | 798 | function |  | 2 |
| `updateGraphAddress` | 819 | function |  | 3 |
| `scheduleNetwork` | 847 | function |  | 1 |
| `flushStoreView` | 850 | function |  | 2 |
| `loadSnapshotIntoStore` | 875 | function |  | 3 |
| `applyLoadedPreference` | 912 | function |  | 3 |
| `markGraphDirty` | 995 | function |  | 2 |

## web/src/nodes2/chain-cache.ts（354 行）

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
| `computeOutputsCached` | 299 | function | export | 1 |
| `computeNodeResultCached` | 343 | function | export | 1 |

## web/src/nodes2/graph-interact.ts（1425 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `isReconnectBusy` | 59 | function | export | 4 |
| `registerInteractionCanceller` | 66 | function | export | 5 |
| `cancelGraphInteractions` | 71 | function | export | 1 |
| `attachTabSearch` | 75 | function | export | 1 |
| `render` | 91 | arrow |  | 3 |
| `create` | 106 | arrow |  | 2 |
| `close` | 135 | arrow |  | 6 |
| `update` | 143 | arrow |  | 3 |
| `distToSegment` | 173 | function |  | 2 |
| `sampleConnectionPath` | 183 | function |  | 2 |
| `attachCutMode` | 204 | function | export | 1 |
| `isTyping` | 230 | arrow |  | 1 |
| `pathLen` | 236 | arrow |  | 1 |
| `setPoints` | 241 | arrow |  | 2 |
| `clear` | 245 | arrow |  | 2 |
| `cutConnection` | 250 | arrow |  | 1 |
| `cutByPolyline` | 265 | arrow |  | 1 |
| `up` | 344 | arrow |  | 0 |
| `attachFlagMenu` | 366 | function | export | 1 |
| `show` | 378 | arrow |  | 2 |
| `setNodeStateHandler` | 432 | function | export | 1 |
| `fireNodeState` | 438 | function | export | 1 |
| `setRenameHandler` | 444 | function | export | 1 |
| `fireRename` | 448 | function | export | 1 |
| `initTooltip` | 454 | function | export | 1 |
| `showTooltip` | 461 | function | export | 1 |
| `hideTooltip` | 475 | function | export | 1 |
| `attachMMBPan` | 483 | function | export | 1 |
| `onMove` | 494 | arrow |  | 0 |
| `onUp` | 497 | arrow |  | 0 |
| `attachDotGrid` | 515 | function | export | 1 |
| `hitTestConnection` | 549 | function |  | 5 |
| `connectionPathD` | 578 | function |  | 7 |
| `isInsertable` | 586 | function |  | 2 |
| `attachInsertion` | 590 | function | export | 1 |
| `refreshPreview` | 638 | arrow |  | 2 |
| `updatePreview` | 646 | arrow |  | 3 |
| `setHover` | 669 | arrow |  | 3 |
| `attachRectSelect` | 798 | function | export | 1 |
| `attachShakeDisconnect` | 874 | function | export | 1 |
| `reset` | 885 | arrow |  | 0 |
| `shakeNode` | 891 | arrow |  | 1 |
| `getSelectedConnectionId` | 1005 | function | export | 1 |
| `connectionPathEl` | 1009 | function |  | 4 |
| `selectConnection` | 1013 | function |  | 2 |
| `clearConnectionSelection` | 1020 | function | export | 3 |
| `attachConnectionSelect` | 1029 | function | export | 1 |
| `hitTestPort` | 1062 | function |  | 4 |
| `attachReconnect` | 1098 | function | export | 1 |
| `toLocal` | 1127 | arrow |  | 2 |
| `setPortHighlight` | 1148 | arrow |  | 2 |
| `markGrabbedPath` | 1162 | arrow |  | 2 |
| `clearReconnect` | 1200 | arrow |  | 11 |
| `labelOf` | 1216 | arrow |  | 8 |
| `applyReconnect` | 1219 | arrow |  | 2 |
| `insertDotAt` | 1301 | arrow |  | 1 |

## web/src/nodes2/graph-model.ts（440 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `notifySelection` | 95 | function | export | 2 |
| `onSelectionChange` | 99 | function | export | 1 |
| `nodeByKind` | 104 | function | export | 1 |
| `resolveInputSourcePort` | 115 | function | export | 2 |
| `nodeFromTarget` | 139 | function | export | 1 |
| `renderNode` | 155 | function | export | 1 |
| `portIndexFromTarget` | 170 | function | export | 1 |
| `CylNode` | 178 | class | export | 5 |
| `makeInputNode` | 207 | function | export | 2 |
| `makeOutputNode` | 212 | function | export | 2 |
| `makeNullNode` | 219 | function | export | 2 |
| `makeDotNode` | 230 | function | export | 2 |
| `claimDotLabel` | 241 | function | export | 2 |
| `makeTransformNode` | 250 | function | export | 2 |
| `getConnectionBypass` | 277 | function | export | 2 |
| `setConnectionBypassFlag` | 281 | function | export | 2 |
| `applyConnectionBypassVisual` | 290 | function | export | 2 |
| `serializeGraph` | 308 | function | export | 2 |
| `restoreGraph` | 353 | function | export | 2 |
| `getNetworkSnapshot` | 425 | function | export | 2 |

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

## web/src/nodes2/graph.ts（442 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `displayChainConnectionIds` | 70 | function |  | 2 |
| `buildGraph` | 90 | function |  | 2 |
| `createReteGraph` | 203 | function | export | 1 |

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

## web/src/overview.ts（271 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `HttpError` | 35 | class |  | 3 |
| `$` | 46 | function |  | 0 |
| `epochMs` | 68 | function |  | 5 |
| `relTime` | 72 | function |  | 5 |
| `clockTime` | 84 | function |  | 2 |
| `setBanner` | 90 | function |  | 4 |
| `openSerial` | 95 | function |  | 3 |
| `activeState` | 100 | function |  | 2 |
| `activeRowHtml` | 116 | function |  | 1 |
| `historyRowHtml` | 133 | function |  | 1 |
| `renderActive` | 142 | function |  | 2 |
| `renderHistory` | 148 | function |  | 2 |
| `renderUnavailable` | 154 | function |  | 2 |
| `fetchScenes` | 163 | function |  | 2 |
| `failMessage` | 170 | function |  | 3 |
| `loadScenes` | 179 | function |  | 4 |
| `cleanupScenes` | 200 | function |  | 2 |

## web/src/protocol/compare.ts（24 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `payloadEqual` | 4 | function |  | 2 |
| `inputsEqual` | 16 | function | export | 1 |

## web/src/protocol/types.ts（146 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

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
