# 函数索引 / FUNCTION INDEX

> 机器生成（2026-08-20），由 `node scripts/gen-index.mjs` 产出。共 **1272** 个函数/类。
> 用途：agent 先 grep 函数名定位，再跳读对应文件/行号；`calls` = 文件内 `name(` 出现次数（hub 指标，越大越核心）。

## bridge/bridge/__init__.py（5 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## bridge/bridge/__main__.py（15 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `main` | 7 | def |  | 2 |

## bridge/bridge/channel_routes.py（526 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_check_serial` | 42 | def |  | 2 |
| `_key_of` | 47 | def |  | 3 |
| `_path_key` | 53 | def |  | 2 |
| `_probe_key` | 60 | def |  | 4 |
| `_find_channel` | 65 | def |  | 3 |
| `_resolve_data_target` | 70 | def |  | 3 |
| `ValuePut` | 79 | class |  | 1 |
| `get_channel_value` | 84 | def |  | 1 |
| `put_channel_value` | 117 | def |  | 1 |
| `put_channel` | 150 | def |  | 1 |
| `_sync_mapping_entry` | 167 | def |  | 3 |
| `list_channels` | 204 | def |  | 1 |
| `HeartbeatBody` | 208 | class |  | 1 |
| `heartbeat` | 228 | def |  | 1 |
| `_sync_project_hip` | 300 | def |  | 2 |
| `_replay_mapping_entries` | 327 | def |  | 2 |
| `_report_anchor` | 344 | def |  | 2 |
| `probe` | 373 | def |  | 1 |
| `_norm_type` | 421 | def |  | 2 |
| `_tag_options` | 432 | def |  | 2 |
| `serial_capabilities` | 463 | def |  | 1 |
| `_node_type_name` | 513 | def |  | 2 |

## bridge/bridge/channels.py（136 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ChannelRegistry` | 18 | class |  | 0 |
| `__init__` | 19 | def |  | 1 |
| `_key_of` | 30 | def |  | 3 |
| `register` | 35 | def |  | 1 |
| `get` | 51 | def |  | 12 |
| `list` | 56 | def |  | 3 |
| `touch` | 62 | def |  | 1 |
| `retire_except` | 73 | def |  | 1 |
| `save_now` | 103 | def |  | 1 |
| `_save` | 107 | def |  | 5 |
| `_load` | 125 | def |  | 2 |

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

## bridge/bridge/cook_cycle.py（119 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `logical_key` | 45 | def |  | 2 |
| `_params_of` | 58 | def |  | 2 |
| `graph_io_names` | 67 | def |  | 2 |
| `_walk` | 80 | def |  | 3 |
| `find_cycles` | 95 | def |  | 2 |
| `cycle_message` | 101 | def |  | 2 |
| `assert_acyclic` | 114 | def |  | 1 |

## bridge/bridge/cook_txn.py（461 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `FlushResult` | 65 | class |  | 2 |
| `CookTxn` | 69 | class |  | 1 |
| `__init__` | 79 | def |  | 2 |
| `begin` | 90 | def |  | 3 |
| `read` | 96 | def |  | 5 |
| `read_own` | 108 | def |  | 3 |
| `write` | 117 | def |  | 4 |
| `pending` | 122 | def |  | 1 |
| `flush` | 126 | def |  | 2 |
| `WritebackTargets` | 181 | class |  | 1 |
| `get_all` | 196 | def |  | 2 |
| `get` | 201 | def |  | 14 |
| `set` | 206 | def |  | 4 |
| `clear` | 218 | def |  | 4 |
| `clear_serial` | 230 | def |  | 1 |
| `serials` | 238 | def |  | 1 |
| `_save` | 244 | def |  | 4 |
| `_load` | 265 | def |  | 2 |
| `get_writeback_targets` | 298 | def |  | 2 |
| `is_tag_serial` | 314 | def |  | 2 |
| `resolve_target` | 343 | def |  | 3 |
| `_input_to_output` | 400 | def |  | 2 |
| `passthrough_outputs` | 416 | def |  | 1 |

## bridge/bridge/data_adapters/__init__.py（14 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `get_adapter` | 12 | def |  | 1 |

## bridge/bridge/data_adapters/apex_anim.py（54 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ApexAnimDataAdapter` | 11 | class |  | 0 |
| `read` | 14 | def |  | 1 |
| `write` | 28 | def |  | 1 |
| `_rpc` | 44 | def |  | 3 |

## bridge/bridge/data_adapters/apex_ctrl.py（188 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_load` | 28 | def |  | 4 |
| `_commit` | 41 | def |  | 2 |
| `ApexCtrlDataAdapter` | 64 | class |  | 0 |
| `_split` | 81 | def |  | 3 |
| `read` | 89 | def |  | 2 |
| `write` | 110 | def |  | 1 |
| `_unwrap` | 169 | def |  | 3 |
| `_rpc` | 180 | def |  | 3 |

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

## bridge/bridge/main.py（63 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `lifespan` | 24 | def |  | 1 |
| `create_app` | 38 | def |  | 2 |

## bridge/bridge/mapping_routes.py（561 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_check_pid` | 41 | def |  | 8 |
| `_resolved_or_404` | 46 | def |  | 3 |
| `_split_target` | 53 | def |  | 3 |
| `_resolve_port_for_anchor` | 61 | def |  | 1 |
| `_fallback_port_warned` | 106 | def |  | 2 |
| `_port_for` | 144 | def |  | 5 |
| `_trace` | 148 | def |  | 3 |
| `ValuePut` | 158 | class |  | 1 |
| `_find_port_by_pid_cached` | 187 | def |  | 2 |
| `_find_port_by_pid` | 214 | def |  | 2 |
| `_probe_health` | 242 | def |  | 4 |
| `probe_anchor` | 247 | def |  | 1 |
| `get_mapping_value` | 306 | def |  | 1 |
| `_read_vec3_components` | 360 | def |  | 2 |
| `get_cook_cycles` | 386 | def |  | 1 |
| `put_mapping_value` | 403 | def |  | 1 |
| `list_mappings` | 451 | def |  | 1 |
| `put_mapping` | 478 | def |  | 1 |
| `delete_mapping` | 489 | def |  | 1 |
| `WritebackPut` | 506 | class |  | 1 |
| `_writeback_view` | 511 | def |  | 2 |
| `get_writeback` | 525 | def |  | 1 |
| `put_writeback` | 534 | def |  | 1 |
| `delete_writeback` | 555 | def |  | 1 |

## bridge/bridge/mapping.py（337 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `resolve_path` | 28 | def |  | 2 |
| `MappingRegistry` | 36 | class |  | 0 |
| `__init__` | 37 | def |  | 1 |
| `upsert_anchor` | 50 | def |  | 1 |
| `mark_verified` | 119 | def |  | 1 |
| `get_anchor` | 142 | def |  | 1 |
| `list_anchors` | 147 | def |  | 1 |
| `put_entry` | 153 | def |  | 1 |
| `del_entry` | 186 | def |  | 1 |
| `get_entry` | 197 | def |  | 1 |
| `list_entries` | 202 | def |  | 1 |
| `resolve` | 208 | def |  | 1 |
| `resolve_all` | 217 | def |  | 1 |
| `_resolve_one` | 227 | def |  | 3 |
| `entries_for_anchor` | 258 | def |  | 1 |
| `_entries_for_anchor` | 262 | def |  | 4 |
| `prune_anchor` | 271 | def |  | 1 |
| `drop_project` | 284 | def |  | 1 |
| `save_now` | 295 | def |  | 1 |
| `_save` | 299 | def |  | 8 |
| `_load` | 317 | def |  | 2 |

## bridge/bridge/mcp_server.py（323 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_index_files` | 25 | def |  | 2 |
| `cyl1nder_ping` | 33 | def |  | 1 |
| `cyl1nder_list_serials` | 40 | def |  | 1 |
| `cyl1nder_get_status` | 46 | def |  | 1 |
| `cyl1nder_read_snapshot` | 58 | def |  | 1 |
| `_read_graph` | 81 | def |  | 5 |
| `_node_map` | 113 | def |  | 3 |
| `cyl1nder_nodeview_nodes` | 118 | def |  | 1 |
| `cyl1nder_nodeview_connections` | 127 | def |  | 1 |
| `cyl1nder_nodeview_status` | 147 | def |  | 1 |
| `cyl1nder_nodeview_connected` | 174 | def |  | 1 |
| `_read_snapshot_data` | 207 | def |  | 3 |
| `cyl1nder_viewport_settings` | 216 | def |  | 1 |
| `cyl1nder_node_params` | 234 | def |  | 1 |
| `cyl1nder_read_layout` | 249 | def |  | 1 |
| `walk` | 259 | def |  | 3 |
| `cyl1nder_read_logs` | 272 | def |  | 1 |
| `cyl1nder_get_errors` | 278 | def |  | 1 |
| `cyl1nder_get_geometry_summary` | 284 | def |  | 1 |
| `cyl1nder_index_query` | 294 | def |  | 1 |
| `run_stdio` | 317 | def |  | 2 |

## bridge/bridge/project_routes.py（636 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_check_project_serial` | 37 | def |  | 9 |
| `_drop_graph_dir` | 42 | def |  | 2 |
| `_cascade_delete` | 68 | def |  | 4 |
| `_member_probe_serial` | 90 | def |  | 7 |
| `_probe_port_for` | 94 | def |  | 2 |
| `_verify_member_in_hip` | 106 | def |  | 2 |
| `migrate_project_hip` | 143 | def |  | 3 |
| `_is_placeholder_member` | 221 | def |  | 2 |
| `is_residue_project` | 235 | def |  | 2 |
| `sweep_residue_projects` | 276 | def |  | 2 |
| `is_transient_hip` | 312 | def |  | 3 |
| `member_ref_for` | 335 | def |  | 3 |
| `bind_serial_to_hip` | 356 | def |  | 2 |
| `ProjectCreateBody` | 404 | class |  | 1 |
| `ProjectPatchBody` | 409 | class |  | 1 |
| `EnsureBody` | 413 | class |  | 1 |
| `MigrateBody` | 418 | class |  | 1 |
| `GraphPutBody` | 423 | class |  | 1 |
| `create_project` | 428 | def |  | 1 |
| `list_projects` | 434 | def |  | 1 |
| `get_project` | 452 | def |  | 1 |
| `rename_project` | 461 | def |  | 1 |
| `delete_project` | 471 | def |  | 1 |
| `cleanup_projects` | 484 | def |  | 1 |
| `add_member` | 497 | def |  | 4 |
| `remove_member` | 506 | def |  | 4 |
| `ensure_project` | 517 | def |  | 1 |
| `migrate_project` | 555 | def |  | 1 |
| `get_project_graph` | 568 | def |  | 1 |
| `_project_root_only` | 588 | def |  | 2 |
| `put_project_graph` | 626 | def |  | 1 |

## bridge/bridge/projects.py（243 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `hip_name_of` | 25 | def |  | 4 |
| `ProjectRegistry` | 32 | class |  | 0 |
| `__init__` | 33 | def |  | 1 |
| `_channel_key` | 44 | def |  | 4 |
| `_new_record` | 50 | def |  | 3 |
| `create` | 64 | def |  | 1 |
| `_find_by_hip_locked` | 75 | def |  | 3 |
| `find_by_hip` | 83 | def |  | 1 |
| `ensure_for_hip` | 92 | def |  | 1 |
| `rebind_hip` | 108 | def |  | 1 |
| `get` | 135 | def |  | 17 |
| `list` | 140 | def |  | 4 |
| `add_member` | 146 | def |  | 1 |
| `remove_member` | 164 | def |  | 1 |
| `set_label` | 179 | def |  | 1 |
| `delete` | 190 | def |  | 1 |
| `list_empty` | 198 | def |  | 1 |
| `save_now` | 202 | def |  | 1 |
| `_save` | 206 | def |  | 9 |
| `_load` | 224 | def |  | 2 |

## bridge/bridge/protocol.py（351 行）

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
| `generate_project_serial` | 159 | def |  | 1 |
| `is_valid_project_serial` | 166 | def |  | 1 |
| `ProjectRef` | 170 | class |  | 1 |
| `SaveAsMigration` | 196 | class |  | 1 |
| `AnchorRef` | 228 | class |  | 1 |
| `AnchorProbeResult` | 248 | class |  | 1 |
| `MappingEntry` | 263 | class |  | 1 |
| `MappingResolved` | 273 | class |  | 1 |
| `MappingsResponse` | 285 | class |  | 1 |
| `AnchorMovedMsg` | 293 | class |  | 1 |
| `OutputsPut` | 303 | class |  | 1 |
| `SyncEnabledPut` | 308 | class |  | 1 |
| `SerialPortOption` | 323 | class |  | 1 |
| `SerialCapabilities` | 337 | class |  | 1 |

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

## bridge/bridge/routes.py（514 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `root` | 40 | def |  | 1 |
| `_check_serial` | 47 | def |  | 15 |
| `health` | 53 | def |  | 1 |
| `list_serials` | 59 | def |  | 1 |
| `status` | 64 | def |  | 2 |
| `_reestablish_project_if_missing` | 76 | def |  | 2 |
| `_apply_passthrough` | 108 | def |  | 2 |
| `put_inputs` | 142 | def |  | 1 |
| `get_outputs` | 172 | def |  | 1 |
| `put_outputs` | 190 | def |  | 3 |
| `_parse_outputs_body` | 221 | def |  | 2 |
| `SyncFpsPut` | 246 | class |  | 1 |
| `put_sync_fps` | 252 | def |  | 1 |
| `put_sync_enabled` | 261 | def |  | 1 |
| `pending` | 270 | def |  | 1 |
| `_ndjson` | 292 | def |  | 9 |
| `stream` | 298 | def |  | 1 |
| `kick` | 345 | def |  | 1 |
| `serial_logs` | 367 | def |  | 1 |
| `get_snapshot` | 377 | def |  | 1 |
| `get_ui_layout` | 388 | def |  | 1 |
| `put_ui_layout` | 395 | def |  | 1 |
| `put_snapshot` | 403 | def |  | 1 |
| `ui_layouts` | 428 | def |  | 1 |
| `ui_layout_save` | 434 | def |  | 1 |
| `ui_layout_load` | 441 | def |  | 1 |
| `global_logs` | 448 | def |  | 1 |
| `scenes_list` | 459 | def |  | 1 |
| `scenes_create` | 465 | def |  | 1 |
| `scenes_cleanup` | 472 | def |  | 1 |
| `scene_save` | 478 | def |  | 1 |
| `scenes_open` | 489 | def |  | 1 |
| `get_usdz` | 502 | def |  | 1 |

## bridge/bridge/scenes.py（207 行）

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

## bridge/bridge/snapshot.py（667 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `scene_dir_name` | 59 | def |  | 4 |
| `_sanitize_dir_part` | 77 | def |  | 3 |
| `_log_once` | 90 | def |  | 3 |
| `resolve_project_id` | 103 | def |  | 3 |
| `member_root` | 147 | def |  | 3 |
| `snapshot_root` | 164 | def |  | 4 |
| `_part_path` | 195 | def |  | 3 |
| `_read_root` | 200 | def |  | 3 |
| `read_snapshot` | 223 | def |  | 2 |
| `migrate_snapshot_dir` | 244 | def |  | 2 |
| `migrate_member_snapshot_dir` | 281 | def |  | 2 |
| `_legacy_roots` | 317 | def |  | 2 |
| `write_snapshot` | 349 | def |  | 2 |
| `build_meta` | 415 | def |  | 3 |
| `maybe_snapshot` | 429 | def |  | 1 |
| `restore_workspace` | 458 | def |  | 2 |
| `restore_all_workspaces` | 509 | def |  | 1 |
| `flush_workspace` | 524 | def |  | 2 |
| `flush_all_workspaces` | 549 | def |  | 1 |
| `project_scene_dir_name` | 568 | def |  | 3 |
| `project_graph_root` | 575 | def |  | 3 |
| `project_graph_path` | 588 | def |  | 4 |
| `migrate_project_graph_dir` | 594 | def |  | 3 |
| `read_project_graph` | 621 | def |  | 1 |
| `_project_graph_candidates` | 640 | def |  | 2 |
| `write_project_graph` | 649 | def |  | 1 |

## bridge/bridge/state.py（255 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeState` | 31 | class |  | 2 |
| `__init__` | 32 | def |  | 1 |
| `set_sync_fps` | 66 | def |  | 1 |
| `get_sync_fps` | 77 | def |  | 3 |
| `set_sync_enabled` | 81 | def |  | 1 |
| `get_sync_enabled` | 86 | def |  | 1 |
| `set_kick` | 92 | def |  | 1 |
| `take_kick` | 97 | def |  | 1 |
| `try_arm_kick` | 102 | def |  | 1 |
| `subscribe` | 119 | def |  | 1 |
| `unsubscribe` | 128 | def |  | 2 |
| `notify_stream` | 137 | def |  | 1 |
| `_wake_stream` | 166 | def |  | 1 |
| `stage_broadcast` | 177 | def |  | 1 |
| `_arm_broadcast_flush` | 209 | def |  | 1 |
| `_flush_broadcast` | 216 | def |  | 3 |
| `default_data_dir` | 236 | def |  | 2 |
| `get_state` | 243 | def |  | 1 |
| `reset_state` | 250 | def |  | 1 |

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

## hda/scripts/build_hda.py（339 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_parm_group` | 86 | def |  | 3 |
| `_tag_parm_group` | 145 | def |  | 3 |
| `build_tag` | 189 | def |  | 2 |
| `build` | 254 | def |  | 2 |

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

## hda/src/cyl1nder_tag.py（426 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_set_status` | 36 | def |  | 5 |
| `_parse_entries` | 45 | def |  | 2 |
| `_resolve` | 60 | def |  | 3 |
| `_read_mode` | 77 | def |  | 2 |
| `_network_of` | 92 | def |  | 3 |
| `_rel_to_network` | 103 | def |  | 4 |
| `_parse_entry` | 114 | def |  | 2 |
| `_parm_value_type` | 179 | def |  | 2 |
| `_fingerprint` | 217 | def |  | 2 |
| `register_channels` | 230 | def |  | 2 |
| `_read_param_values` | 295 | def |  | 2 |
| `_instance_identity` | 308 | def |  | 2 |
| `heartbeat` | 331 | def |  | 2 |
| `cook` | 375 | def |  | 3 |

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

## web/src/app/channel-value.ts（33 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `parseChannelValue` | 20 | function | export | 1 |

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

## web/src/app/elide.ts（78 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `points` | 19 | function |  | 5 |
| `limitOf` | 24 | function |  | 3 |
| `elide` | 46 | function | export | 1 |
| `elideEnd` | 68 | function | export | 1 |

## web/src/app/graph-address.ts（22 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `buildGraphAddress` | 18 | function | export | 1 |

## web/src/app/graph-scope.ts（127 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `pathSuffix` | 43 | function |  | 4 |
| `addressOf` | 51 | function | export | 1 |
| `canWriteProjectGraph` | 87 | function | export | 1 |
| `pathOf` | 92 | function | export | 2 |
| `isInSubNetwork` | 98 | function | export | 1 |
| `withPath` | 104 | function | export | 1 |
| `snapshotSerialOf` | 117 | function | export | 1 |
| `projectIdOf` | 123 | function | export | 1 |

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

## web/src/app/param.ts（1296 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `esc` | 59 | function |  | 12 |
| `attrEscape` | 64 | function |  | 19 |
| `color3ToRgb` | 71 | function |  | 3 |
| `color3Hex` | 83 | function |  | 4 |
| `parseColor3` | 89 | function |  | 3 |
| `portSideOf` | 140 | function |  | 5 |
| `serialOf` | 147 | function |  | 4 |
| `portOptionText` | 156 | function | export | 2 |
| `portOptionsHtml` | 165 | function | export | 3 |
| `portPlaceholder` | 191 | function | export | 3 |
| `portControlHtml` | 201 | function |  | 2 |
| `controlHtml` | 213 | function |  | 3 |
| `applyEdit` | 252 | function |  | 5 |
| `applyEditRaw` | 268 | function |  | 2 |
| `wirePortMenu` | 305 | function |  | 2 |
| `repaint` | 338 | function |  | 5 |
| `planVecGroups` | 388 | function | export | 3 |
| `planParamRows` | 407 | function | export | 2 |
| `paramDefault` | 429 | function | export | 3 |
| `currentParamRefClip` | 504 | function | export | 1 |
| `relativeAddress` | 514 | function | export | 2 |
| `absoluteAddress` | 524 | function | export | 2 |
| `adaptRefToTarget` | 543 | function | export | 2 |
| `resolvePasteSink` | 584 | function | export | 2 |
| `pasteDisabledReason` | 600 | function | export | 2 |
| `buildRefMenuItems` | 629 | function | export | 2 |
| `closeLinkPop` | 710 | function |  | 10 |
| `tailOfPath` | 719 | function |  | 2 |
| `openLinkPop` | 724 | function |  | 2 |
| `loadChannelItems` | 760 | function |  | 2 |
| `closeRefMenu` | 806 | function |  | 7 |
| `refTargetFromEvent` | 826 | function |  | 2 |
| `copyParamRef` | 852 | function |  | 2 |
| `openRefMenu` | 869 | function |  | 2 |
| `wireRefMenu` | 932 | function |  | 2 |
| `valueEqual` | 976 | function |  | 2 |
| `paramValuesEqual` | 994 | function | export | 2 |
| `isParamEditorFocused` | 1008 | function | export | 1 |
| `shouldDeferParamRender` | 1040 | function | export | 1 |
| `renderParams` | 1062 | function | export | 2 |
| `commit` | 1181 | arrow |  | 1 |

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

## web/src/bridge/client.ts（700 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeClient` | 24 | class | export | 0 |
| `connectWs` | 657 | function | export | 1 |
| `connect` | 662 | arrow |  | 1 |

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

## web/src/core/dataflow.ts（587 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `displayNodeOutputIndex` | 52 | function | export | 2 |
| `collectAddressEntries` | 75 | function | export | 2 |
| `collectWritebackTargets` | 103 | function | export | 1 |
| `resolveRefInGraph` | 146 | function |  | 2 |
| `nodesFeedingOutputs` | 209 | function |  | 2 |
| `collectExternRefAddresses` | 223 | function | export | 1 |
| `valueFromSlotFeeder` | 265 | function |  | 2 |
| `resolveWritebackValue` | 285 | function | export | 2 |
| `valueFromConnection` | 300 | function |  | 3 |
| `createDataflow` | 355 | function | export | 1 |
| `getDisplayNodeInfo` | 376 | function |  | 4 |
| `refreshNodeFlags` | 398 | function |  | 5 |
| `flush` | 504 | function |  | 5 |
| `wireSelection` | 577 | function |  | 2 |

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

## web/src/core/shortcuts.ts（64 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `bindShortcuts` | 18 | function | export | 1 |

## web/src/core/timeline.ts（184 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createTimelineController` | 43 | function | export | 1 |

## web/src/main.ts（2218 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `matchLogFilter` | 90 | arrow |  | 0 |
| `renderLog` | 91 | arrow |  | 3 |
| `isSerial` | 178 | arrow |  | 2 |
| `isProject` | 179 | arrow |  | 2 |
| `toggle` | 300 | arrow |  | 8 |
| `updateLayoutMenuLabel` | 332 | function |  | 5 |
| `getDockJson` | 335 | arrow |  | 7 |
| `saveCurrentLayout` | 339 | arrow |  | 2 |
| `refreshLayoutPresets` | 348 | arrow |  | 1 |
| `writeJsonToDir` | 459 | function |  | 7 |
| `readJsonFromDir` | 470 | function |  | 5 |
| `saveSceneAs` | 484 | function |  | 3 |
| `navigateToMemberPage` | 554 | function |  | 3 |
| `openSceneFromDir` | 570 | function |  | 2 |
| `bootIsMemberEntry` | 640 | arrow |  | 0 |
| `applyLayoutSettings` | 976 | function |  | 4 |
| `refreshSelectionPanels` | 1031 | function |  | 5 |
| `sameWritebackValue` | 1237 | function |  | 4 |
| `scheduleWriteback` | 1248 | function |  | 7 |
| `runWritebackGuarded` | 1273 | function |  | 2 |
| `armExternRefPoll` | 1331 | function |  | 2 |
| `prefetchExternRefs` | 1339 | function |  | 2 |
| `pushWritebackOnce` | 1380 | function |  | 2 |
| `syncWritebackPointer` | 1460 | function |  | 2 |
| `anchorNetPathOf` | 1495 | function |  | 2 |
| `inputStatsText` | 1520 | function |  | 2 |
| `outputStatsText` | 1529 | function |  | 2 |
| `renderInspector` | 1538 | function |  | 2 |
| `isProjectModeActive` | 1556 | function |  | 3 |
| `projectAddress` | 1562 | function |  | 3 |
| `onNetPathChanged` | 1581 | function |  | 1 |
| `waitNetPath` | 1591 | function |  | 5 |
| `enterableNodeNames` | 1605 | function |  | 3 |
| `enterNodeAwaited` | 1616 | function |  | 3 |
| `enterByName` | 1629 | function |  | 3 |
| `exitToDepth` | 1636 | function |  | 5 |
| `navigateByName` | 1654 | function |  | 2 |
| `saveProjectGraph` | 1682 | function |  | 5 |
| `enterProjectMode` | 1729 | function |  | 7 |
| `openProjectMember` | 1846 | function |  | 2 |
| `enterMemberWorkspace` | 1868 | function |  | 3 |
| `commitPendingMemberScope` | 1888 | function |  | 3 |
| `updateGraphAddress` | 1901 | function |  | 7 |
| `scheduleNetwork` | 1929 | function |  | 1 |
| `flushStoreView` | 1932 | function |  | 2 |
| `loadSnapshotIntoStore` | 1960 | function |  | 3 |
| `applyLoadedPreference` | 2005 | function |  | 3 |
| `syncMemberInAddress` | 2047 | function |  | 2 |
| `syncProjectInAddress` | 2067 | function |  | 2 |
| `connectSerial` | 2080 | arrow |  | 1 |
| `markGraphDirty` | 2211 | function |  | 2 |

## web/src/nodes2/chain-cache.ts（365 行）

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
| `computeNodeResultCached` | 354 | function | export | 1 |

## web/src/nodes2/graph-interact.ts（2175 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `setNetKindProvider` | 70 | function | export | 1 |
| `currentNetKind` | 74 | function |  | 2 |
| `paletteForCurrentLayer` | 80 | function |  | 2 |
| `isReconnectBusy` | 96 | function | export | 4 |
| `registerInteractionCanceller` | 103 | function | export | 5 |
| `cancelGraphInteractions` | 108 | function | export | 1 |
| `attachTabSearch` | 112 | function | export | 1 |
| `render` | 128 | arrow |  | 3 |
| `create` | 143 | arrow |  | 4 |
| `close` | 186 | arrow |  | 7 |
| `update` | 194 | arrow |  | 5 |
| `distToSegment` | 233 | function |  | 2 |
| `sampleConnectionPath` | 243 | function |  | 2 |
| `attachCutMode` | 264 | function | export | 1 |
| `isTyping` | 290 | arrow |  | 1 |
| `pathLen` | 296 | arrow |  | 1 |
| `setPoints` | 301 | arrow |  | 2 |
| `clear` | 305 | arrow |  | 2 |
| `cutConnection` | 310 | arrow |  | 1 |
| `cutByPolyline` | 325 | arrow |  | 1 |
| `up` | 404 | arrow |  | 0 |
| `attachFlagMenu` | 426 | function | export | 1 |
| `show` | 438 | arrow |  | 2 |
| `setNodeStateHandler` | 492 | function | export | 1 |
| `fireNodeState` | 498 | function | export | 1 |
| `setRenameHandler` | 504 | function | export | 1 |
| `fireRename` | 508 | function | export | 1 |
| `setEnterNodeHandler` | 533 | function | export | 1 |
| `attachEnterNode` | 547 | function | export | 1 |
| `initTooltip` | 600 | function | export | 1 |
| `showTooltip` | 607 | function | export | 1 |
| `hideTooltip` | 621 | function | export | 1 |
| `attachMMBPan` | 629 | function | export | 1 |
| `onMove` | 640 | arrow |  | 0 |
| `onUp` | 643 | arrow |  | 0 |
| `attachDotGrid` | 661 | function | export | 1 |
| `hitTestConnection` | 695 | function |  | 5 |
| `connectionPathD` | 724 | function |  | 7 |
| `isInsertable` | 732 | function |  | 2 |
| `attachInsertion` | 736 | function | export | 1 |
| `refreshPreview` | 784 | arrow |  | 2 |
| `updatePreview` | 792 | arrow |  | 3 |
| `setHover` | 815 | arrow |  | 3 |
| `attachRectSelect` | 944 | function | export | 1 |
| `attachShakeDisconnect` | 1041 | function | export | 1 |
| `reset` | 1052 | arrow |  | 0 |
| `shakeNode` | 1058 | arrow |  | 1 |
| `getSelectedConnectionId` | 1172 | function | export | 1 |
| `connectionPathEl` | 1176 | function |  | 4 |
| `selectConnection` | 1180 | function |  | 2 |
| `clearConnectionSelection` | 1187 | function | export | 3 |
| `attachConnectionSelect` | 1196 | function | export | 1 |
| `hitTestPort` | 1239 | function |  | 4 |
| `attachReconnect` | 1275 | function | export | 1 |
| `toLocal` | 1304 | arrow |  | 2 |
| `setPortHighlight` | 1325 | arrow |  | 2 |
| `markGrabbedPath` | 1339 | arrow |  | 2 |
| `clearReconnect` | 1377 | arrow |  | 12 |
| `labelOf` | 1394 | arrow |  | 8 |
| `applyReconnect` | 1397 | arrow |  | 2 |
| `clearWaypointDrag` | 1489 | arrow |  | 4 |
| `toGraph` | 1502 | arrow |  | 1 |
| `putWaypoint` | 1540 | arrow |  | 2 |
| `dropWaypoint` | 1549 | arrow |  | 1 |
| `onWaypointMove` | 1563 | arrow |  | 2 |
| `bindWaypointWindowMove` | 1582 | arrow |  | 1 |
| `resolveShiftEnterTarget` | 1814 | function | export | 2 |
| `planShiftEnterWire` | 1853 | function | export | 2 |
| `setApplyNodeParamsHandler` | 1955 | function | export | 2 |
| `setShiftEnterUndoHandler` | 1970 | function | export | 1 |
| `applyMirroredParams` | 1975 | function |  | 2 |
| `selectedNodesOfKind` | 1988 | function |  | 4 |
| `readParamValue` | 1994 | function |  | 3 |
| `toShiftEnterInput` | 2000 | function |  | 2 |
| `runShiftEnterWire` | 2035 | function |  | 2 |
| `startShiftEnterWire` | 2135 | function |  | 3 |
| `attachShiftEnterWire` | 2157 | function |  | 2 |

## web/src/nodes2/graph-model.ts（2487 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `isEnterableKind` | 38 | function | export | 1 |
| `netKindOfCreatable` | 43 | function | export | 1 |
| `isConnectableSocket` | 181 | function | export | 8 |
| `socketFamily` | 191 | function | export | 5 |
| `canConnectSockets` | 202 | function | export | 1 |
| `canConnectIntoSlot` | 228 | function | export | 1 |
| `convertSocketValue` | 247 | function | export | 1 |
| `toSocketType` | 260 | function | export | 3 |
| `socketTypeClass` | 277 | function | export | 1 |
| `toNodeErrorSeverity` | 323 | function | export | 2 |
| `toNodeErrors` | 337 | function | export | 1 |
| `multiSourceErrorsToNodeErrors` | 363 | function | export | 1 |
| `stringParam` | 408 | function |  | 3 |
| `findDuplicateOutputPorts` | 426 | function | export | 1 |
| `duplicateOutputPortsToNodeErrors` | 463 | function | export | 1 |
| `mergeNodeErrorMaps` | 484 | function | export | 1 |
| `worstSeverity` | 498 | function | export | 1 |
| `errorsSignature` | 505 | function |  | 3 |
| `sameNodeErrors` | 510 | function | export | 2 |
| `applyNodeErrors` | 529 | function | export | 1 |
| `nodeErrorsOf` | 542 | function | export | 1 |
| `notifySelection` | 555 | function | export | 2 |
| `onSelectionChange` | 559 | function | export | 1 |
| `nodeByKind` | 564 | function | export | 1 |
| `resolveInputSourcePort` | 575 | function | export | 3 |
| `nodeFromTarget` | 607 | function | export | 1 |
| `renderNode` | 623 | function | export | 1 |
| `portIndexFromTarget` | 638 | function | export | 1 |
| `CylNode` | 646 | class | export | 7 |
| `addressParams` | 757 | function |  | 4 |
| `isDerivedParam` | 788 | function | export | 1 |
| `portSideOfKind` | 795 | function | export | 2 |
| `derivePortType` | 814 | function | export | 1 |
| `applyDerivedPortType` | 840 | function | export | 1 |
| `seqLabel` | 872 | function |  | 3 |
| `claimInputLabel` | 880 | function | export | 2 |
| `claimOutputLabel` | 887 | function | export | 2 |
| `claimSeqLabel` | 895 | function |  | 3 |
| `makeInputNode` | 917 | function | export | 3 |
| `makeOutputNode` | 933 | function | export | 3 |
| `readParam` | 947 | function |  | 5 |
| `nodeSocketType` | 952 | function | export | 2 |
| `syncPortSocketType` | 961 | function | export | 2 |
| `hasDynamicInputs` | 1003 | function | export | 12 |
| `dynamicInputKey` | 1008 | function | export | 6 |
| `slotRefParamName` | 1047 | function | export | 3 |
| `legacyRefParamName` | 1053 | function | export | 3 |
| `slotRefScope` | 1086 | function | export | 2 |
| `syncRefParams` | 1107 | function | export | 2 |
| `nodeSlots` | 1137 | function | export | 2 |
| `slotIndexOfPort` | 1161 | function | export | 2 |
| `slotPortViews` | 1172 | function | export | 1 |
| `slotTypeOf` | 1182 | function | export | 7 |
| `slotTypesConsistent` | 1195 | function | export | 1 |
| `dynamicInputIndex` | 1211 | function | export | 12 |
| `dynamicOutputKey` | 1223 | function | export | 5 |
| `dynamicOutputIndex` | 1228 | function | export | 7 |
| `planDynamicInputs` | 1242 | function | export | 1 |
| `planDynamicSlotCount` | 1258 | function | export | 4 |
| `planDynamicOutputs` | 1276 | function | export | 1 |
| `syncDynamicInputs` | 1296 | function | export | 3 |
| `wiredInputKeysByNode` | 1344 | function | export | 3 |
| `wiredOutputKeysByNode` | 1359 | function | export | 3 |
| `resolveSlotTypes` | 1413 | function | export | 3 |
| `applyDynamicTypes` | 1439 | function | export | 2 |
| `propagateDynamicTypes` | 1484 | function | export | 2 |
| `findPortTypeConflicts` | 1532 | function | export | 1 |
| `portTypeConflictsToNodeErrors` | 1565 | function | export | 1 |
| `makeGeoNode` | 1589 | function | export | 2 |
| `claimGeoLabel` | 1601 | function | export | 2 |
| `makeNullNode` | 1618 | function | export | 2 |
| `makeTransformNode` | 1633 | function | export | 2 |
| `paletteFactory` | 1657 | function |  | 2 |
| `makePaletteNode` | 1686 | function | export | 1 |
| `makeProjectNode` | 1732 | function | export | 2 |
| `makeChannelNode` | 1742 | function | export | 2 |
| `getConnectionBypass` | 1759 | function | export | 2 |
| `getConnectionWaypoint` | 1769 | function | export | 2 |
| `setConnectionWaypoint` | 1777 | function | export | 2 |
| `setConnectionBypassFlag` | 1783 | function | export | 2 |
| `socketNameOf` | 1790 | function | export | 3 |
| `applyConnectionTypeVisual` | 1826 | function | export | 1 |
| `applyConnectionBypassVisual` | 1848 | function | export | 2 |
| `isDefaultAddressParam` | 1919 | function |  | 2 |
| `isDefaultRefParam` | 1932 | function |  | 2 |
| `serializableParams` | 1941 | function |  | 2 |
| `buildGraphSnapshot` | 1964 | function | export | 2 |
| `serializeGraph` | 2010 | function | export | 2 |
| `restoreNodeForKind` | 2065 | function | export | 2 |
| `sanitizeAddress` | 2135 | function | export | 3 |
| `sanitizePort` | 2143 | function | export | 3 |
| `syncAddressParams` | 2156 | function |  | 2 |
| `detectLegacyPorts` | 2184 | function | export | 2 |
| `restoreGraph` | 2208 | function | export | 2 |
| `sanitizeBindings` | 2326 | function | export | 2 |
| `nodeParamBindingsView` | 2336 | function | export | 1 |
| `listNodeParamBindingsView` | 2349 | function | export | 1 |
| `applyNodeBindings` | 2365 | function | export | 1 |
| `getNetworkSnapshot` | 2380 | function | export | 2 |
| `planProjectGraph` | 2431 | function | export | 1 |

## web/src/nodes2/graph-undo.ts（163 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `actionContainsParams` | 16 | function | export | 2 |
| `findConnectionByRef` | 23 | function |  | 2 |
| `applyUndoAction` | 34 | function | export | 3 |
| `addConn` | 40 | arrow |  | 11 |
| `delConn` | 48 | arrow |  | 11 |
| `lbl` | 52 | arrow |  | 4 |
| `createGraphUndoManager` | 130 | function | export | 1 |

## web/src/nodes2/graph.ts（1152 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `setChannelDisplayHandler` | 123 | function | export | 2 |
| `getChannelDisplaySerial` | 128 | function | export | 1 |
| `isNodeWired` | 134 | function | export | 1 |
| `isProjectMode` | 144 | function | export | 5 |
| `loadProjectGraph` | 156 | function | export | 2 |
| `projectGraphSnapshot` | 222 | function | export | 2 |
| `setNetPathChangedHandler` | 254 | function | export | 1 |
| `serializeGraphFromRoot` | 273 | function | export | 3 |
| `getNetPath` | 291 | function | export | 3 |
| `getCurrentNetKind` | 310 | function | export | 4 |
| `emptyChildGraph` | 317 | function |  | 2 |
| `enterNode` | 327 | function | export | 2 |
| `exitNode` | 360 | function | export | 1 |
| `getRefRegistry` | 394 | function | export | 1 |
| `refPathOf` | 406 | function |  | 3 |
| `registerAddressRef` | 415 | function |  | 2 |
| `rewriteRefsForRename` | 429 | function |  | 2 |
| `getNodeParamBindings` | 456 | function | export | 1 |
| `listNodeParamBindings` | 463 | function | export | 1 |
| `setNodeBindings` | 474 | function | export | 1 |
| `setNodeErrors` | 490 | function | export | 1 |
| `getNodeErrors` | 498 | function | export | 1 |
| `displayChainConnectionIds` | 505 | function |  | 2 |
| `wantsEmptyRootGraph` | 545 | function |  | 3 |
| `buildGraph` | 555 | function |  | 2 |
| `createReteGraph` | 760 | function | export | 1 |

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

## web/src/nodes2/mapping-types.ts（177 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `isMappingTypesPrimed` | 45 | function | export | 1 |
| `normalizeAddress` | 51 | function | export | 4 |
| `toMappingTypeName` | 63 | function | export | 2 |
| `resolveAddressType` | 76 | function | export | 1 |
| `unregisteredMessage` | 83 | function | export | 2 |
| `notPrimedMessage` | 89 | function | export | 2 |
| `mappingAddressErrors` | 104 | function | export | 1 |
| `setMappingTypes` | 125 | function | export | 2 |
| `primeMappingTypes` | 146 | function | export | 1 |
| `invalidateMappingTypes` | 171 | function | export | 1 |

## web/src/nodes2/network.ts（422 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `paramValue` | 73 | function | export | 6 |
| `asFiniteNumber` | 84 | function |  | 4 |
| `toGroupClass` | 90 | function |  | 2 |
| `findFeeder` | 98 | function | export | 4 |
| `firstWiredFeeder` | 114 | function | export | 2 |
| `slotFeederFor` | 132 | function | export | 2 |
| `findMultiSourceErrors` | 166 | function | export | 2 |
| `portDataType` | 196 | function | export | 2 |
| `isGeoPort` | 203 | function |  | 3 |
| `nodeById` | 207 | function | export | 6 |
| `parseInPort` | 212 | function |  | 2 |
| `isPositionDependent` | 224 | function |  | 2 |
| `traceChainSpecs` | 239 | function | export | 3 |
| `emptyBuffer` | 296 | function |  | 2 |
| `fallbackBuffer` | 301 | function |  | 2 |
| `traceChain` | 328 | function |  | 3 |
| `bufferFromResolved` | 345 | function |  | 3 |
| `computeOutputsDetailed` | 367 | function | export | 2 |
| `computeOutputs` | 393 | function | export | 1 |
| `computeNodeResult` | 410 | function | export | 1 |

## web/src/nodes2/param-ref.ts（203 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `parseCore` | 78 | function |  | 3 |
| `finishAddressOnly` | 125 | function |  | 3 |
| `unwrapChanFn` | 131 | function |  | 2 |
| `parseParamRef` | 171 | function | export | 1 |

## web/src/nodes2/ref-registry.ts（260 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `normalizeRefPath` | 95 | function | export | 5 |
| `isAtOrUnder` | 109 | function | export | 3 |
| `rewriteRefPath` | 120 | function | export | 2 |
| `siteKey` | 132 | function |  | 5 |
| `bySite` | 137 | function |  | 1 |
| `RefRegistry` | 147 | class | export | 1 |
| `makeRefRegistry` | 257 | function | export | 1 |

## web/src/nodes2/serial-capabilities.ts（206 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `normalizeSerial` | 57 | function | export | 4 |
| `unknownCapabilities` | 62 | function | export | 6 |
| `toPortType` | 74 | function | export | 2 |
| `sanitizePortOptions` | 80 | function | export | 3 |
| `sanitizeCapabilities` | 95 | function | export | 3 |
| `setCapabilities` | 110 | function | export | 1 |
| `cachedCapabilities` | 122 | function | export | 2 |
| `cachedPorts` | 129 | function | export | 3 |
| `cachedPortType` | 136 | function | export | 1 |
| `loadCapabilities` | 153 | function | export | 1 |
| `req` | 177 | arrow |  | 0 |
| `invalidateCapabilities` | 196 | function | export | 1 |

## web/src/nodes2/undo.ts（125 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createUndoManager` | 66 | function | export | 2 |

## web/src/nodes2/waypoint-path.ts（42 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `segment` | 21 | function |  | 4 |
| `waypointConnectionPath` | 29 | function | export | 1 |

## web/src/overview.ts（1365 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `HttpError` | 71 | class |  | 4 |
| `epochMs` | 86 | function |  | 16 |
| `relSince` | 91 | function |  | 7 |
| `relTime` | 102 | function |  | 5 |
| `clockTime` | 114 | function |  | 2 |
| `channelValueString` | 124 | function | export | 3 |
| `formatChannelValue` | 134 | function | export | 1 |
| `channelActionButtons` | 141 | function | export | 1 |
| `isSerialTail` | 160 | function |  | 2 |
| `memberHint` | 166 | function |  | 2 |
| `bestMemberLabel` | 175 | function | export | 2 |
| `projectDisplayName` | 190 | function | export | 4 |
| `shortHipPath` | 204 | function | export | 2 |
| `migratedBadgeHtml` | 226 | function | export | 2 |
| `defaultProjectName` | 244 | function | export | 2 |
| `isStaleEvidence` | 272 | function | export | 2 |
| `seedEntryFromAnchor` | 279 | function | export | 2 |
| `probeEntryOf` | 288 | function |  | 2 |
| `probeVerdict` | 301 | function | export | 2 |
| `anchorSerialsOf` | 308 | function | export | 6 |
| `projectStatusLight` | 344 | function | export | 2 |
| `mappingRows` | 488 | function | export | 2 |
| `valuePlaceholder` | 503 | function | export | 3 |
| `anchorPidText` | 513 | function | export | 2 |
| `anchorEvidenceTitle` | 522 | function | export | 2 |
| `mappingRowHtml` | 544 | function | export | 1 |
| `parseMappingInput` | 584 | function | export | 2 |
| `probeProgressLabel` | 589 | function | export | 2 |
| `cleanupSummary` | 595 | function | export | 2 |
| `$` | 603 | function |  | 0 |
| `setBanner` | 612 | function |  | 7 |
| `openSerial` | 625 | function |  | 3 |
| `openProject` | 640 | function |  | 2 |
| `fetchChannels` | 691 | function |  | 2 |
| `showProjectsError` | 697 | function |  | 5 |
| `hideProjectsError` | 701 | function |  | 5 |
| `probeProject` | 707 | function |  | 3 |
| `syncRefreshButtons` | 724 | function |  | 6 |
| `probeAllProjects` | 739 | function |  | 2 |
| `seedProbesFromPersisted` | 772 | function |  | 2 |
| `autoProbeOnce` | 792 | function |  | 3 |
| `projectRowHtml` | 798 | function |  | 1 |
| `renderProjects` | 829 | function |  | 13 |
| `loadProjects` | 869 | function |  | 8 |
| `createProject` | 914 | function |  | 4 |
| `submitRename` | 932 | function |  | 3 |
| `removeProject` | 944 | function |  | 2 |
| `runProjectsCleanup` | 965 | function |  | 2 |
| `renderMappingsIdle` | 1052 | function |  | 4 |
| `loadMappings` | 1060 | function |  | 5 |
| `mappingInput` | 1084 | function |  | 4 |
| `setMappingResult` | 1091 | function |  | 4 |
| `readMapping` | 1110 | function |  | 2 |
| `writeMapping` | 1117 | function |  | 3 |
| `removeMapping` | 1137 | function |  | 2 |
| `activeState` | 1185 | function |  | 2 |
| `activeRowHtml` | 1201 | function |  | 1 |
| `historyRowHtml` | 1218 | function |  | 1 |
| `renderActive` | 1227 | function |  | 2 |
| `renderHistory` | 1233 | function |  | 2 |
| `renderUnavailable` | 1239 | function |  | 2 |
| `fetchScenes` | 1248 | function |  | 2 |
| `failMessage` | 1255 | function |  | 3 |
| `loadScenes` | 1264 | function |  | 4 |
| `cleanupScenes` | 1282 | function |  | 2 |

## web/src/protocol/compare.ts（24 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `payloadEqual` | 4 | function |  | 2 |
| `inputsEqual` | 16 | function | export | 1 |

## web/src/protocol/types.ts（336 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/stores/channels.ts（63 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ChannelsStore` | 10 | class | export | 1 |
| `channelIdOf` | 58 | function | export | 3 |

## web/src/stores/projects.ts（267 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ProjectsStore` | 8 | class | export | 1 |
| `encodeMappingName` | 100 | function | export | 2 |
| `patchProjectLabel` | 125 | function | export | 1 |
| `deleteProject` | 138 | function | export | 1 |
| `cleanupProjects` | 146 | function | export | 1 |
| `fetchMappings` | 154 | function | export | 1 |
| `deleteMapping` | 166 | function | export | 1 |
| `getMappingValue` | 175 | function | export | 1 |
| `putMappingValue` | 183 | function | export | 1 |
| `mappingValue` | 191 | function |  | 3 |
| `probeAnchor` | 236 | function | export | 1 |

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
