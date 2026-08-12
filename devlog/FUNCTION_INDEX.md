# 函数索引 / FUNCTION INDEX

> 机器生成（2026-08-12），由 `node scripts/gen-index.mjs` 产出。共 **519** 个函数/类。
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

## bridge/bridge/main.py（31 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `create_app` | 14 | def |  | 2 |

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

## bridge/bridge/protocol.py（124 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_b36` | 54 | def |  | 3 |
| `generate_serial` | 65 | def |  | 1 |
| `is_valid_serial` | 76 | def |  | 1 |
| `AttributeData` | 80 | class |  | 1 |
| `CurveData` | 86 | class |  | 1 |
| `InputPayload` | 91 | class |  | 1 |
| `OutputBuffer` | 102 | class |  | 1 |
| `InputsPut` | 113 | class |  | 1 |
| `OutputsPut` | 121 | class |  | 1 |

## bridge/bridge/registry.py（201 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `RegistryError` | 29 | class |  | 2 |
| `RegistryRecord` | 33 | class |  | 3 |
| `__init__` | 36 | def |  | 2 |
| `to_dict` | 55 | def |  | 2 |
| `from_dict` | 67 | def |  | 2 |
| `SerialRegistry` | 79 | class |  | 0 |
| `register` | 90 | def |  | 3 |
| `get` | 117 | def |  | 11 |
| `touch` | 121 | def |  | 3 |
| `mark_activity` | 137 | def |  | 3 |
| `remove` | 151 | def |  | 3 |
| `list` | 160 | def |  | 1 |
| `serials` | 164 | def |  | 1 |
| `_save` | 168 | def |  | 5 |
| `_load` | 192 | def |  | 2 |

## bridge/bridge/routes.py（389 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_maybe_snapshot` | 38 | def |  | 3 |
| `root` | 61 | def |  | 1 |
| `_check_serial` | 68 | def |  | 14 |
| `health` | 74 | def |  | 1 |
| `list_serials` | 80 | def |  | 1 |
| `status` | 85 | def |  | 2 |
| `put_inputs` | 97 | def |  | 1 |
| `get_outputs` | 115 | def |  | 1 |
| `put_outputs` | 124 | def |  | 2 |
| `SyncFpsPut` | 139 | class |  | 1 |
| `put_sync_fps` | 145 | def |  | 1 |
| `pending` | 154 | def |  | 1 |
| `_ndjson` | 175 | def |  | 9 |
| `stream` | 181 | def |  | 1 |
| `kick` | 227 | def |  | 1 |
| `serial_logs` | 249 | def |  | 1 |
| `get_snapshot` | 259 | def |  | 1 |
| `get_ui_layout` | 270 | def |  | 1 |
| `put_ui_layout` | 277 | def |  | 1 |
| `put_snapshot` | 285 | def |  | 1 |
| `ui_layouts` | 303 | def |  | 1 |
| `ui_layout_save` | 309 | def |  | 1 |
| `ui_layout_load` | 316 | def |  | 1 |
| `global_logs` | 323 | def |  | 1 |
| `scenes_list` | 334 | def |  | 1 |
| `scenes_create` | 340 | def |  | 1 |
| `scenes_cleanup` | 347 | def |  | 1 |
| `scene_save` | 353 | def |  | 1 |
| `scenes_open` | 364 | def |  | 1 |
| `get_usdz` | 377 | def |  | 1 |

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

## bridge/bridge/snapshot.py（140 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `snapshot_root` | 39 | def |  | 3 |
| `_part_path` | 51 | def |  | 3 |
| `read_snapshot` | 56 | def |  | 1 |
| `write_snapshot` | 80 | def |  | 1 |
| `build_meta` | 128 | def |  | 1 |

## bridge/bridge/state.py（235 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeState` | 27 | class |  | 2 |
| `__init__` | 28 | def |  | 1 |
| `set_sync_fps` | 55 | def |  | 1 |
| `get_sync_fps` | 66 | def |  | 3 |
| `set_kick` | 72 | def |  | 1 |
| `take_kick` | 77 | def |  | 1 |
| `try_arm_kick` | 82 | def |  | 1 |
| `subscribe` | 99 | def |  | 1 |
| `unsubscribe` | 108 | def |  | 2 |
| `notify_stream` | 117 | def |  | 1 |
| `_wake_stream` | 146 | def |  | 1 |
| `stage_broadcast` | 157 | def |  | 1 |
| `_arm_broadcast_flush` | 189 | def |  | 1 |
| `_flush_broadcast` | 196 | def |  | 3 |
| `default_data_dir` | 216 | def |  | 2 |
| `get_state` | 223 | def |  | 1 |
| `reset_state` | 230 | def |  | 1 |

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

## bridge/bridge/workspace.py（124 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `Workspace` | 10 | class |  | 1 |
| `__init__` | 11 | def |  | 2 |
| `set_inputs` | 19 | def |  | 1 |
| `put_outputs` | 24 | def |  | 1 |
| `get_outputs_since` | 46 | def |  | 1 |
| `output_rev` | 53 | def |  | 1 |
| `all_outputs` | 57 | def |  | 1 |
| `to_summary` | 61 | def |  | 2 |
| `_same_content` | 90 | def |  | 2 |
| `WorkspaceStore` | 100 | class |  | 0 |
| `get_or_create` | 105 | def |  | 2 |
| `get` | 113 | def |  | 4 |
| `serials` | 117 | def |  | 1 |
| `status` | 121 | def |  | 1 |

## bridge/bridge/ws.py（104 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ConnectionManager` | 14 | class |  | 1 |
| `__init__` | 15 | def |  | 1 |
| `connect` | 19 | def |  | 2 |
| `disconnect` | 24 | def |  | 3 |
| `broadcast` | 32 | def |  | 1 |
| `ws_endpoint` | 53 | def |  | 1 |

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

## hda/scripts/hython_smoke.py（604 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_req` | 29 | def |  | 7 |
| `_make_curve_input` | 38 | def |  | 2 |
| `_wait_ready_rev` | 56 | def |  | 4 |
| `_FakeClock` | 72 | class |  | 2 |
| `__init__` | 75 | def |  | 5 |
| `now` | 78 | def |  | 1 |
| `step` | 81 | def |  | 9 |
| `_test_stream_loop` | 86 | def |  | 2 |
| `_FakeClient` | 104 | class |  | 3 |
| `stream_once` | 113 | def |  | 3 |
| `pull_outputs` | 119 | def |  | 3 |
| `_Gate` | 123 | class |  | 1 |
| `__call__` | 130 | def |  | 1 |
| `wait_len` | 138 | def |  | 3 |
| `_feed` | 154 | def |  | 10 |
| `_seed_caches` | 160 | def |  | 3 |
| `_assert_caches_cleared` | 169 | def |  | 3 |
| `_test_kick_force_recook` | 308 | def |  | 2 |
| `_test_stop_all_sync` | 360 | def |  | 3 |
| `main` | 428 | def |  | 2 |
| `_stats` | 506 | def |  | 5 |

## hda/scripts/reload_hda.py（118 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_stop_sync_threads` | 31 | def |  | 3 |
| `_reload_modules` | 52 | def |  | 2 |
| `_instances` | 68 | def |  | 2 |
| `_force_recook_all` | 73 | def |  | 3 |
| `_rebuild_hda` | 87 | def |  | 2 |
| `_reload_definition` | 93 | def |  | 2 |
| `reload_cyl1nder` | 100 | def |  | 3 |

## hda/src/cyl1nder_bridge.py（134 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_b36` | 17 | def |  | 3 |
| `generate_serial` | 28 | def |  | 1 |
| `BridgeClient` | 35 | class |  | 0 |
| `__init__` | 36 | def |  | 1 |
| `push_inputs` | 52 | def |  | 1 |
| `_pump` | 59 | def |  | 1 |
| `pending_outputs` | 87 | def |  | 1 |
| `stream_once` | 108 | def |  | 1 |
| `pull_outputs` | 125 | def |  | 1 |

## hda/src/cyl1nder_hda.py（881 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_ui_healthy` | 99 | def |  | 2 |
| `_ensure_frontend` | 108 | def |  | 3 |
| `_bridge_healthy` | 133 | def |  | 2 |
| `_ensure_bridge` | 141 | def |  | 3 |
| `_ready_state` | 168 | def |  | 2 |
| `_refresh_ready` | 178 | def |  | 4 |
| `_reset_ready` | 205 | def |  | 2 |
| `_reset_caches` | 215 | def |  | 2 |
| `_stream_loop` | 230 | def |  | 1 |
| `_schedule_recook` | 320 | def |  | 4 |
| `_force_cook_node` | 339 | def |  | 1 |
| `stop_sync` | 367 | def |  | 5 |
| `stop_all_sync` | 390 | def |  | 1 |
| `ensure_sync` | 403 | def |  | 6 |
| `_root` | 461 | def |  | 4 |
| `_ensure_serial` | 465 | def |  | 3 |
| `_parm` | 478 | def |  | 14 |
| `_set_status` | 488 | def |  | 6 |
| `_serialize_geo` | 497 | def |  | 3 |
| `_build_detail` | 507 | def |  | 2 |
| `_buffer_sig` | 538 | def |  | 2 |
| `_apply_output` | 554 | def |  | 2 |
| `_snapshot_parts` | 598 | def |  | 2 |
| `_flat_signature` | 646 | def |  | 2 |
| `_build_core_detail` | 658 | def |  | 3 |
| `cook_core` | 682 | def |  | 3 |
| `_same_geo` | 746 | def |  | 2 |
| `_role_buffer` | 757 | def |  | 2 |
| `_input_signature` | 776 | def |  | 2 |
| `cook` | 811 | def |  | 7 |

## hda/src/cyl1nder_serializer.py（63 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_norm_value` | 12 | def |  | 2 |
| `serialize_input` | 20 | def |  | 1 |

## web/src/app/app-config.ts（7 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/app/color.ts（1042 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `rgbToHex` | 67 | function | export | 5 |
| `hexToRgb` | 73 | function | export | 7 |
| `rgbToHsl` | 94 | function |  | 7 |
| `hslToRgb` | 114 | function |  | 7 |
| `rgbToHsv` | 140 | function |  | 5 |
| `hsvToRgb` | 158 | function |  | 4 |
| `loadRecents` | 199 | function |  | 4 |
| `saveRecents` | 213 | function |  | 4 |
| `recordRecent` | 221 | function |  | 2 |
| `removeRecent` | 228 | function |  | 2 |
| `clearRecents` | 235 | function |  | 2 |
| `esc` | 393 | function |  | 2 |
| `valuesForMode` | 400 | function |  | 4 |
| `colorFromMode` | 410 | function |  | 3 |
| `harmonyDef` | 416 | function |  | 5 |
| `harmonyColor` | 421 | function |  | 3 |
| `openColorPicker` | 438 | function | export | 2 |

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

## web/src/app/layout.ts（253 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `wireFpsStepper` | 27 | function |  | 3 |
| `buildLayout` | 46 | function | export | 1 |
| `buildLayoutLegacy` | 153 | function | export | 1 |

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

## web/src/app/preference.ts（337 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `clampSyncFps` | 44 | function | export | 4 |
| `parseUpdateMode` | 50 | function |  | 4 |
| `parseAutosaveInterval` | 55 | function |  | 3 |
| `parseViewportBg` | 62 | function |  | 4 |
| `parseUiFont` | 66 | function |  | 4 |
| `loadPreferences` | 72 | function | export | 1 |
| `savePreferences` | 97 | function | export | 1 |
| `applyPreferences` | 104 | function | export | 1 |
| `openPreferenceDialog` | 127 | function | export | 1 |

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

## web/src/bridge/client.ts（237 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeClient` | 23 | class | export | 0 |
| `connectWs` | 201 | function | export | 1 |
| `connect` | 206 | arrow |  | 1 |

## web/src/main.ts（1193 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `matchLogFilter` | 42 | arrow |  | 0 |
| `renderLog` | 43 | arrow |  | 3 |
| `toggle` | 105 | arrow |  | 7 |
| `updateLayoutMenuLabel` | 137 | function |  | 5 |
| `getDockJson` | 140 | arrow |  | 6 |
| `saveCurrentLayout` | 144 | arrow |  | 2 |
| `refreshLayoutPresets` | 153 | arrow |  | 1 |
| `writeJsonToDir` | 259 | function |  | 7 |
| `readJsonFromDir` | 270 | function |  | 5 |
| `saveSceneAs` | 284 | function |  | 3 |
| `openSceneFromDir` | 338 | function |  | 2 |
| `applyLayoutSettings` | 503 | function |  | 4 |
| `readParamFloats` | 508 | function |  | 4 |
| `cloneParams` | 519 | function |  | 3 |
| `paramsEqual` | 524 | function |  | 2 |
| `flushParamUndo` | 546 | function |  | 2 |
| `refreshSelectionPanels` | 557 | function |  | 4 |
| `bindGizmoToTransform` | 626 | function |  | 3 |
| `bindEnterGizmoToSelection` | 675 | function |  | 3 |
| `applyTransformDrag` | 693 | function |  | 3 |
| `toggleEnterEdit` | 708 | function |  | 2 |
| `getDisplayNodeInfo` | 734 | function |  | 2 |
| `refreshNodeFlags` | 750 | function |  | 4 |
| `inputStatsText` | 810 | function |  | 2 |
| `outputStatsText` | 819 | function |  | 2 |
| `renderInspector` | 828 | function |  | 2 |
| `flushStoreView` | 851 | function |  | 2 |
| `runNetwork` | 886 | function |  | 6 |
| `kickHdaOnce` | 914 | function |  | 2 |
| `startHdaWatch` | 927 | function |  | 2 |
| `check` | 929 | arrow |  | 1 |
| `stopHdaWatch` | 947 | function |  | 2 |
| `loadSnapshotIntoStore` | 956 | function |  | 3 |
| `applyLoadedPreference` | 993 | function |  | 3 |
| `connect` | 1022 | function |  | 4 |
| `markGraphDirty` | 1163 | function |  | 2 |
| `startAutoSave` | 1173 | function |  | 5 |

## web/src/nodes2/graph.ts（1667 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `actionContainsParams` | 111 | function |  | 2 |
| `log` | 116 | arrow |  | 17 |
| `notifySelection` | 120 | function |  | 3 |
| `nodeByKind` | 127 | function |  | 4 |
| `resolveInputSourcePort` | 138 | function |  | 4 |
| `nodeFromTarget` | 162 | function |  | 7 |
| `renderNode` | 178 | function |  | 1 |
| `portIndexFromTarget` | 193 | function |  | 2 |
| `CylNode` | 205 | class | export | 4 |
| `makeInputNode` | 236 | function |  | 3 |
| `makeOutputNode` | 241 | function |  | 3 |
| `makeNullNode` | 248 | function | export | 2 |
| `makeTransformNode` | 259 | function | export | 2 |
| `buildGraph` | 283 | function |  | 2 |
| `createReteGraph` | 369 | function | export | 1 |
| `attachTabSearch` | 676 | function |  | 2 |
| `render` | 692 | arrow |  | 4 |
| `create` | 707 | arrow |  | 2 |
| `close` | 736 | arrow |  | 6 |
| `update` | 742 | arrow |  | 3 |
| `distToSegment` | 772 | function |  | 2 |
| `sampleConnectionPath` | 782 | function |  | 2 |
| `findConnectionByRef` | 804 | function |  | 2 |
| `applyUndoAction` | 815 | function |  | 3 |
| `addConn` | 820 | arrow |  | 8 |
| `delConn` | 828 | arrow |  | 8 |
| `lbl` | 832 | arrow |  | 2 |
| `attachCutMode` | 899 | function |  | 2 |
| `isTyping` | 925 | arrow |  | 1 |
| `pathLen` | 931 | arrow |  | 1 |
| `setPoints` | 936 | arrow |  | 2 |
| `clear` | 940 | arrow |  | 2 |
| `cutConnection` | 945 | arrow |  | 1 |
| `cutByPolyline` | 960 | arrow |  | 1 |
| `up` | 1039 | arrow |  | 0 |
| `attachFlagMenu` | 1061 | function |  | 2 |
| `show` | 1073 | arrow |  | 2 |
| `setNodeStateHandler` | 1127 | function | export | 2 |
| `fireNodeState` | 1130 | function | export | 1 |
| `setRenameHandler` | 1136 | function | export | 2 |
| `fireRename` | 1139 | function | export | 1 |
| `initTooltip` | 1145 | function | export | 2 |
| `showTooltip` | 1151 | function | export | 1 |
| `hideTooltip` | 1164 | function | export | 1 |
| `attachMMBPan` | 1172 | function |  | 2 |
| `onMove` | 1180 | arrow |  | 0 |
| `onUp` | 1183 | arrow |  | 0 |
| `attachDotGrid` | 1201 | function |  | 2 |
| `hitTestConnection` | 1232 | function |  | 3 |
| `connectionPathD` | 1261 | function |  | 3 |
| `isInsertable` | 1269 | function |  | 2 |
| `attachInsertion` | 1273 | function |  | 2 |
| `refreshPreview` | 1321 | arrow |  | 2 |
| `updatePreview` | 1329 | arrow |  | 1 |
| `setHover` | 1352 | arrow |  | 2 |
| `attachRectSelect` | 1472 | function |  | 2 |
| `attachShakeDisconnect` | 1546 | function |  | 2 |
| `reset` | 1557 | arrow |  | 0 |
| `shakeNode` | 1563 | arrow |  | 1 |

## web/src/nodes2/groups.ts（537 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `tokenize` | 85 | function |  | 2 |
| `mergeAttrTokens` | 129 | function |  | 2 |
| `isNumeric` | 149 | function |  | 4 |
| `parseToken` | 154 | function |  | 2 |
| `parseGroupExpression` | 193 | function | export | 1 |
| `stripAttrKey` | 217 | function |  | 2 |
| `resolveAttribute` | 226 | function | export | 4 |
| `idSpecMatches` | 243 | function |  | 2 |
| `uniq` | 271 | function |  | 3 |
| `primPointSets` | 284 | function |  | 2 |
| `vertexMap` | 292 | function |  | 2 |
| `range` | 299 | function |  | 7 |
| `rulePoint` | 306 | function |  | 2 |
| `elementPoints` | 330 | function |  | 2 |
| `compIndex` | 355 | function |  | 2 |
| `toNum` | 361 | function |  | 7 |
| `eqScalar` | 369 | function |  | 6 |
| `arraysEqual` | 374 | function |  | 3 |
| `parseValueList` | 382 | function |  | 2 |
| `firstNum` | 390 | function |  | 3 |
| `compareLhs` | 399 | function |  | 2 |
| `ruleMatchesElement` | 452 | function |  | 2 |
| `computeSelection` | 490 | function |  | 3 |
| `pointInGroup` | 529 | function | export | 1 |
| `matchingPoints` | 534 | function | export | 1 |

## web/src/nodes2/network.ts（200 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `paramValue` | 35 | function | export | 6 |
| `asFiniteNumber` | 46 | function |  | 4 |
| `toGroupClass` | 52 | function |  | 2 |
| `findFeeder` | 57 | function |  | 3 |
| `nodeById` | 65 | function |  | 4 |
| `parseInPort` | 70 | function |  | 2 |
| `emptyBuffer` | 76 | function |  | 2 |
| `fallbackBuffer` | 81 | function |  | 2 |
| `traceChain` | 108 | function |  | 4 |
| `bufferFromResolved` | 148 | function |  | 3 |
| `computeOutputs` | 168 | function | export | 1 |
| `computeNodeResult` | 191 | function | export | 1 |

## web/src/nodes2/undo.ts（115 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createUndoManager` | 56 | function | export | 2 |

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

## web/src/protocol/compare.ts（23 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `payloadEqual` | 3 | function |  | 2 |
| `inputsEqual` | 15 | function | export | 1 |

## web/src/protocol/types.ts（115 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/stores/workspace.ts（143 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `deepEqual` | 4 | function |  | 6 |
| `outputsEqual` | 26 | function | export | 2 |
| `WorkspaceStore` | 39 | class | export | 1 |

## web/src/tools/transform.ts（71 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `translatePoint` | 5 | function | export | 4 |
| `translatePoints` | 9 | function | export | 1 |
| `applyTranslateToCurve` | 14 | function | export | 1 |
| `inputToOutput` | 31 | function | export | 1 |
| `applyTranslateGrouped` | 52 | function | export | 1 |

## web/src/viewport/backend.ts（31 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createRenderer` | 18 | function | export | 1 |

## web/src/viewport/controls.ts（117 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `dollyCamera` | 12 | function |  | 3 |
| `HoudiniControls` | 36 | class | export | 0 |
| `onMove` | 73 | arrow |  | 0 |
| `up` | 82 | arrow |  | 1 |
| `release` | 106 | arrow |  | 0 |

## web/src/viewport/geometry.ts（148 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `toVec` | 7 | function |  | 1 |
| `buildWireSegments` | 13 | function |  | 2 |
| `buildMeshFaces` | 39 | function | export | 2 |
| `buildPoints` | 70 | function |  | 2 |
| `buildCurves` | 83 | function | export | 4 |
| `buildInputs` | 111 | function | export | 1 |
| `buildOutputs` | 121 | function | export | 1 |
| `buildNodeResult` | 138 | function | export | 1 |

## web/src/viewport/renderer.ts（785 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `Viewport` | 44 | class | export | 1 |
| `showModeMenu` | 133 | arrow |  | 1 |
| `hideModeMenu` | 145 | arrow |  | 2 |
| `applyMode` | 146 | arrow |  | 1 |
| `openModeMenu` | 161 | arrow |  | 1 |
| `closeModeMenu` | 162 | arrow |  | 3 |
