# 函数索引 / FUNCTION INDEX

> 机器生成（2026-08-13），由 `node scripts/gen-index.mjs` 产出。共 **542** 个函数/类。
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

## hda/scripts/hython_smoke.py（605 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_req` | 30 | def |  | 7 |
| `_make_curve_input` | 39 | def |  | 2 |
| `_wait_ready_rev` | 57 | def |  | 4 |
| `_FakeClock` | 73 | class |  | 2 |
| `__init__` | 76 | def |  | 5 |
| `now` | 79 | def |  | 1 |
| `step` | 82 | def |  | 9 |
| `_test_stream_loop` | 87 | def |  | 2 |
| `_FakeClient` | 105 | class |  | 3 |
| `stream_once` | 114 | def |  | 3 |
| `pull_outputs` | 120 | def |  | 3 |
| `_Gate` | 124 | class |  | 1 |
| `__call__` | 131 | def |  | 1 |
| `wait_len` | 139 | def |  | 3 |
| `_feed` | 155 | def |  | 10 |
| `_seed_caches` | 161 | def |  | 3 |
| `_assert_caches_cleared` | 170 | def |  | 3 |
| `_test_kick_force_recook` | 309 | def |  | 2 |
| `_test_stop_all_sync` | 361 | def |  | 3 |
| `main` | 429 | def |  | 2 |
| `_stats` | 507 | def |  | 5 |

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

## hda/src/cyl1nder_hda.py（172 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `cook_core` | 42 | def |  | 2 |
| `cook` | 102 | def |  | 2 |

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

## hda/src/cyl1nder_sync.py（251 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_stream_loop` | 22 | def |  | 1 |
| `_schedule_recook` | 112 | def |  | 4 |
| `_force_cook_node` | 131 | def |  | 1 |
| `stop_sync` | 159 | def |  | 5 |
| `stop_all_sync` | 182 | def |  | 1 |
| `ensure_sync` | 195 | def |  | 4 |

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

## web/src/app/layout.ts（273 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `wireFpsStepper` | 29 | function |  | 3 |
| `buildLayout` | 48 | function | export | 1 |
| `buildLayoutLegacy` | 164 | function | export | 1 |

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

## web/src/app/preference.ts（338 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `clampSyncFps` | 45 | function | export | 4 |
| `parseUpdateMode` | 51 | function |  | 4 |
| `parseAutosaveInterval` | 56 | function |  | 3 |
| `parseViewportBg` | 63 | function |  | 4 |
| `parseUiFont` | 67 | function |  | 4 |
| `loadPreferences` | 73 | function | export | 1 |
| `savePreferences` | 98 | function | export | 1 |
| `applyPreferences` | 105 | function | export | 1 |
| `openPreferenceDialog` | 128 | function | export | 1 |

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

## web/src/app/widgets.ts（210 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createPopupAnchor` | 38 | function |  | 2 |
| `createDropdown` | 46 | function | export | 1 |
| `createStepper` | 130 | function | export | 1 |

## web/src/bridge/client.ts（237 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeClient` | 23 | class | export | 0 |
| `connectWs` | 201 | function | export | 1 |
| `connect` | 206 | arrow |  | 1 |

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

## web/src/core/dataflow.ts（144 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createDataflow` | 29 | function | export | 1 |
| `getDisplayNodeInfo` | 31 | function |  | 2 |
| `refreshNodeFlags` | 47 | function |  | 5 |
| `flush` | 128 | function |  | 2 |
| `wireSelection` | 134 | function |  | 2 |

## web/src/core/gizmo.ts（154 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createGizmoController` | 47 | function | export | 1 |

## web/src/core/kick.ts（45 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createKickController` | 11 | function | export | 1 |

## web/src/core/lifecycle.ts（58 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createAutosave` | 7 | function | export | 1 |
| `createHdaWatchdog` | 31 | function | export | 1 |
| `check` | 42 | arrow |  | 1 |

## web/src/core/network.ts（53 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createNetworkRunner` | 18 | function | export | 1 |

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

## web/src/core/session.ts（86 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createSessionController` | 25 | function | export | 1 |

## web/src/core/shortcuts.ts（51 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `bindShortcuts` | 15 | function | export | 1 |

## web/src/main.ts（794 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `matchLogFilter` | 51 | arrow |  | 0 |
| `renderLog` | 52 | arrow |  | 3 |
| `toggle` | 119 | arrow |  | 8 |
| `updateLayoutMenuLabel` | 151 | function |  | 5 |
| `getDockJson` | 154 | arrow |  | 6 |
| `saveCurrentLayout` | 158 | arrow |  | 2 |
| `refreshLayoutPresets` | 167 | arrow |  | 1 |
| `writeJsonToDir` | 273 | function |  | 7 |
| `readJsonFromDir` | 284 | function |  | 5 |
| `saveSceneAs` | 298 | function |  | 3 |
| `openSceneFromDir` | 352 | function |  | 2 |
| `applyLayoutSettings` | 539 | function |  | 4 |
| `refreshSelectionPanels` | 546 | function |  | 1 |
| `inputStatsText` | 608 | function |  | 2 |
| `outputStatsText` | 617 | function |  | 2 |
| `renderInspector` | 626 | function |  | 2 |
| `flushStoreView` | 649 | function |  | 2 |
| `loadSnapshotIntoStore` | 676 | function |  | 3 |
| `applyLoadedPreference` | 713 | function |  | 3 |
| `markGraphDirty` | 787 | function |  | 2 |

## web/src/nodes2/graph-interact.ts（954 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `attachTabSearch` | 48 | function | export | 1 |
| `render` | 64 | arrow |  | 3 |
| `create` | 79 | arrow |  | 2 |
| `close` | 108 | arrow |  | 6 |
| `update` | 114 | arrow |  | 3 |
| `distToSegment` | 144 | function |  | 2 |
| `sampleConnectionPath` | 154 | function |  | 2 |
| `attachCutMode` | 175 | function | export | 1 |
| `isTyping` | 201 | arrow |  | 1 |
| `pathLen` | 207 | arrow |  | 1 |
| `setPoints` | 212 | arrow |  | 2 |
| `clear` | 216 | arrow |  | 2 |
| `cutConnection` | 221 | arrow |  | 1 |
| `cutByPolyline` | 236 | arrow |  | 1 |
| `up` | 315 | arrow |  | 0 |
| `attachFlagMenu` | 337 | function | export | 1 |
| `show` | 349 | arrow |  | 2 |
| `setNodeStateHandler` | 403 | function | export | 1 |
| `fireNodeState` | 409 | function | export | 1 |
| `setRenameHandler` | 415 | function | export | 1 |
| `fireRename` | 419 | function | export | 1 |
| `initTooltip` | 425 | function | export | 1 |
| `showTooltip` | 432 | function | export | 1 |
| `hideTooltip` | 446 | function | export | 1 |
| `attachMMBPan` | 454 | function | export | 1 |
| `onMove` | 465 | arrow |  | 0 |
| `onUp` | 468 | arrow |  | 0 |
| `attachDotGrid` | 486 | function | export | 1 |
| `hitTestConnection` | 520 | function |  | 3 |
| `connectionPathD` | 549 | function |  | 3 |
| `isInsertable` | 557 | function |  | 2 |
| `attachInsertion` | 561 | function | export | 1 |
| `refreshPreview` | 609 | arrow |  | 2 |
| `updatePreview` | 617 | arrow |  | 1 |
| `setHover` | 640 | arrow |  | 2 |
| `attachRectSelect` | 760 | function | export | 1 |
| `attachShakeDisconnect` | 834 | function | export | 1 |
| `reset` | 845 | arrow |  | 0 |
| `shakeNode` | 851 | arrow |  | 1 |

## web/src/nodes2/graph-model.ts（354 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `notifySelection` | 85 | function | export | 2 |
| `onSelectionChange` | 89 | function | export | 1 |
| `nodeByKind` | 94 | function | export | 1 |
| `resolveInputSourcePort` | 105 | function | export | 2 |
| `nodeFromTarget` | 129 | function | export | 1 |
| `renderNode` | 145 | function | export | 1 |
| `portIndexFromTarget` | 160 | function | export | 1 |
| `CylNode` | 168 | class | export | 4 |
| `makeInputNode` | 197 | function | export | 2 |
| `makeOutputNode` | 202 | function | export | 2 |
| `makeNullNode` | 209 | function | export | 2 |
| `makeTransformNode` | 220 | function | export | 2 |
| `serializeGraph` | 240 | function | export | 2 |
| `restoreGraph` | 274 | function | export | 2 |
| `getNetworkSnapshot` | 340 | function | export | 2 |

## web/src/nodes2/graph-undo.ts（149 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `actionContainsParams` | 15 | function | export | 2 |
| `findConnectionByRef` | 22 | function |  | 2 |
| `applyUndoAction` | 33 | function | export | 3 |
| `addConn` | 38 | arrow |  | 8 |
| `delConn` | 46 | arrow |  | 8 |
| `lbl` | 50 | arrow |  | 2 |
| `createGraphUndoManager` | 117 | function | export | 1 |

## web/src/nodes2/graph.ts（290 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `buildGraph` | 59 | function |  | 2 |
| `createReteGraph` | 145 | function | export | 1 |

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

## web/src/viewport/renderer.ts（499 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `Viewport` | 28 | class | export | 1 |
| `showModeMenu` | 103 | arrow |  | 1 |
| `hideModeMenu` | 115 | arrow |  | 2 |
| `applyMode` | 116 | arrow |  | 1 |
| `openModeMenu` | 131 | arrow |  | 1 |
| `closeModeMenu` | 132 | arrow |  | 3 |

## web/src/viewport/scene.ts（46 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `buildViewportScene` | 18 | function | export | 1 |
| `makeBox` | 40 | function | export | 3 |

## web/src/viewport/state.ts（11 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
