# 函数索引 / FUNCTION INDEX

> 机器生成（2026-08-12），由 `node scripts/gen-index.mjs` 产出。共 **504** 个函数/类。
> 用途：agent 先 grep 函数名定位，再跳读对应文件/行号；`calls` = 文件内 `name(` 出现次数（hub 指标，越大越核心）。

## bridge/bridge/__init__.py（5 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## bridge/bridge/__main__.py（13 行）

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

## bridge/bridge/registry.py（200 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `RegistryError` | 29 | class |  | 2 |
| `RegistryRecord` | 33 | class |  | 3 |
| `__init__` | 36 | def |  | 2 |
| `to_dict` | 55 | def |  | 2 |
| `from_dict` | 67 | def |  | 2 |
| `SerialRegistry` | 79 | class |  | 0 |
| `register` | 89 | def |  | 3 |
| `get` | 116 | def |  | 11 |
| `touch` | 120 | def |  | 3 |
| `mark_activity` | 136 | def |  | 3 |
| `remove` | 150 | def |  | 3 |
| `list` | 159 | def |  | 1 |
| `serials` | 163 | def |  | 1 |
| `_save` | 167 | def |  | 5 |
| `_load` | 191 | def |  | 2 |

## bridge/bridge/routes.py（385 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_maybe_snapshot` | 38 | def |  | 3 |
| `root` | 59 | def |  | 1 |
| `_check_serial` | 66 | def |  | 14 |
| `health` | 72 | def |  | 1 |
| `list_serials` | 78 | def |  | 1 |
| `status` | 83 | def |  | 2 |
| `put_inputs` | 95 | def |  | 1 |
| `get_outputs` | 113 | def |  | 1 |
| `put_outputs` | 122 | def |  | 2 |
| `SyncFpsPut` | 137 | class |  | 1 |
| `put_sync_fps` | 143 | def |  | 1 |
| `pending` | 152 | def |  | 1 |
| `_ndjson` | 173 | def |  | 9 |
| `stream` | 179 | def |  | 1 |
| `kick` | 225 | def |  | 1 |
| `serial_logs` | 245 | def |  | 1 |
| `get_snapshot` | 255 | def |  | 1 |
| `get_ui_layout` | 266 | def |  | 1 |
| `put_ui_layout` | 273 | def |  | 1 |
| `put_snapshot` | 281 | def |  | 1 |
| `ui_layouts` | 299 | def |  | 1 |
| `ui_layout_save` | 305 | def |  | 1 |
| `ui_layout_load` | 312 | def |  | 1 |
| `global_logs` | 319 | def |  | 1 |
| `scenes_list` | 330 | def |  | 1 |
| `scenes_create` | 336 | def |  | 1 |
| `scenes_cleanup` | 343 | def |  | 1 |
| `scene_save` | 349 | def |  | 1 |
| `scenes_open` | 360 | def |  | 1 |
| `get_usdz` | 373 | def |  | 1 |

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

## bridge/bridge/state.py（214 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeState` | 22 | class |  | 2 |
| `__init__` | 23 | def |  | 1 |
| `set_sync_fps` | 49 | def |  | 1 |
| `get_sync_fps` | 60 | def |  | 3 |
| `set_kick` | 66 | def |  | 1 |
| `take_kick` | 71 | def |  | 1 |
| `subscribe` | 78 | def |  | 1 |
| `unsubscribe` | 87 | def |  | 2 |
| `notify_stream` | 96 | def |  | 1 |
| `_wake_stream` | 125 | def |  | 1 |
| `stage_broadcast` | 136 | def |  | 1 |
| `_arm_broadcast_flush` | 168 | def |  | 1 |
| `_flush_broadcast` | 175 | def |  | 3 |
| `default_data_dir` | 195 | def |  | 2 |
| `get_state` | 202 | def |  | 1 |
| `reset_state` | 209 | def |  | 1 |

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

## bridge/bridge/ws.py（103 行）

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

## hda/scripts/hython_smoke.py（545 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_req` | 29 | def |  | 7 |
| `_make_curve_input` | 38 | def |  | 2 |
| `_wait_ready_rev` | 56 | def |  | 4 |
| `_FakeClock` | 72 | class |  | 2 |
| `__init__` | 75 | def |  | 4 |
| `now` | 78 | def |  | 1 |
| `step` | 81 | def |  | 9 |
| `_test_stream_loop` | 86 | def |  | 2 |
| `_FakeClient` | 104 | class |  | 3 |
| `stream_once` | 113 | def |  | 2 |
| `pull_outputs` | 119 | def |  | 2 |
| `_Gate` | 123 | class |  | 1 |
| `__call__` | 130 | def |  | 1 |
| `wait_len` | 138 | def |  | 3 |
| `_feed` | 154 | def |  | 10 |
| `_seed_caches` | 160 | def |  | 3 |
| `_assert_caches_cleared` | 169 | def |  | 3 |
| `_test_kick_force_recook` | 327 | def |  | 2 |
| `main` | 379 | def |  | 2 |
| `_stats` | 448 | def |  | 5 |

## hda/scripts/reload_hda.py（89 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_reload_modules` | 31 | def |  | 2 |
| `_instances` | 44 | def |  | 2 |
| `_force_recook_all` | 49 | def |  | 3 |
| `_rebuild_hda` | 63 | def |  | 2 |
| `_reload_definition` | 69 | def |  | 2 |
| `reload_cyl1nder` | 76 | def |  | 3 |

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

## hda/src/cyl1nder_hda.py（812 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_ui_healthy` | 95 | def |  | 2 |
| `_ensure_frontend` | 104 | def |  | 3 |
| `_bridge_healthy` | 129 | def |  | 2 |
| `_ensure_bridge` | 137 | def |  | 3 |
| `_ready_state` | 164 | def |  | 2 |
| `_refresh_ready` | 174 | def |  | 4 |
| `_reset_ready` | 201 | def |  | 2 |
| `_reset_caches` | 211 | def |  | 2 |
| `_stream_loop` | 226 | def |  | 1 |
| `_schedule_recook` | 314 | def |  | 3 |
| `_force_cook_node` | 322 | def |  | 1 |
| `ensure_sync` | 350 | def |  | 3 |
| `_root` | 392 | def |  | 4 |
| `_ensure_serial` | 396 | def |  | 3 |
| `_parm` | 409 | def |  | 14 |
| `_set_status` | 419 | def |  | 6 |
| `_serialize_geo` | 428 | def |  | 3 |
| `_build_detail` | 438 | def |  | 2 |
| `_buffer_sig` | 469 | def |  | 2 |
| `_apply_output` | 485 | def |  | 2 |
| `_snapshot_parts` | 529 | def |  | 2 |
| `_flat_signature` | 577 | def |  | 2 |
| `_build_core_detail` | 589 | def |  | 3 |
| `cook_core` | 613 | def |  | 2 |
| `_same_geo` | 677 | def |  | 2 |
| `_role_buffer` | 688 | def |  | 2 |
| `_input_signature` | 707 | def |  | 2 |
| `cook` | 742 | def |  | 5 |

## hda/src/cyl1nder_serializer.py（63 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_norm_value` | 12 | def |  | 2 |
| `serialize_input` | 20 | def |  | 1 |

## web/src/app/app-config.ts（7 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/app/color.ts（527 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `rgbToHex` | 32 | function | export | 3 |
| `hexToRgb` | 38 | function | export | 6 |
| `rgbToHsl` | 59 | function |  | 2 |
| `hslToRgb` | 79 | function |  | 2 |
| `rgbToHsv` | 105 | function |  | 5 |
| `hsvToRgb` | 123 | function |  | 4 |
| `loadRecents` | 164 | function |  | 3 |
| `recordRecent` | 178 | function |  | 2 |
| `esc` | 237 | function |  | 2 |
| `valuesForMode` | 244 | function |  | 3 |
| `colorFromMode` | 254 | function |  | 2 |
| `openColorPicker` | 265 | function | export | 1 |

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

## web/src/app/layout.ts（217 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `buildLayout` | 24 | function | export | 1 |
| `buildLayoutLegacy` | 124 | function | export | 1 |

## web/src/app/layouts.ts（11 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/app/log.ts（4 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `formatLog` | 2 | function | export | 1 |

## web/src/app/param.ts（262 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `esc` | 29 | function |  | 5 |
| `attrEscape` | 34 | function |  | 4 |
| `color3ToRgb` | 41 | function |  | 3 |
| `color3Hex` | 53 | function |  | 3 |
| `parseColor3` | 59 | function |  | 3 |
| `controlHtml` | 75 | function |  | 2 |
| `applyEdit` | 100 | function |  | 5 |
| `paramDefault` | 116 | function | export | 3 |
| `renderParams` | 131 | function | export | 1 |
| `commit` | 172 | arrow |  | 1 |

## web/src/app/preference.ts（276 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `clampSyncFps` | 39 | function | export | 4 |
| `parseUpdateMode` | 45 | function |  | 4 |
| `parseAutosaveInterval` | 50 | function |  | 3 |
| `parseViewportBg` | 57 | function |  | 4 |
| `loadPreferences` | 63 | function | export | 1 |
| `savePreferences` | 87 | function | export | 1 |
| `applyPreferences` | 93 | function | export | 1 |
| `openPreferenceDialog` | 107 | function | export | 1 |

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

## web/src/main.ts（1128 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `matchLogFilter` | 42 | arrow |  | 0 |
| `renderLog` | 43 | arrow |  | 3 |
| `toggle` | 105 | arrow |  | 7 |
| `updateLayoutMenuLabel` | 137 | function |  | 5 |
| `getDockJson` | 140 | arrow |  | 6 |
| `saveCurrentLayout` | 144 | arrow |  | 2 |
| `refreshLayoutPresets` | 153 | arrow |  | 1 |
| `writeJsonToDir` | 258 | function |  | 7 |
| `readJsonFromDir` | 269 | function |  | 5 |
| `saveSceneAs` | 283 | function |  | 3 |
| `openSceneFromDir` | 337 | function |  | 2 |
| `applyLayoutSettings` | 486 | function |  | 4 |
| `readParamFloats` | 491 | function |  | 3 |
| `cloneParams` | 502 | function |  | 3 |
| `paramsEqual` | 507 | function |  | 2 |
| `flushParamUndo` | 529 | function |  | 2 |
| `refreshSelectionPanels` | 540 | function |  | 3 |
| `bindGizmoToTransform` | 609 | function |  | 3 |
| `bindEnterGizmoToSelection` | 658 | function |  | 3 |
| `applyTransformDrag` | 676 | function |  | 3 |
| `toggleEnterEdit` | 691 | function |  | 2 |
| `getDisplayNodeInfo` | 717 | function |  | 2 |
| `refreshNodeFlags` | 733 | function |  | 4 |
| `inputStatsText` | 793 | function |  | 2 |
| `outputStatsText` | 802 | function |  | 2 |
| `renderInspector` | 811 | function |  | 2 |
| `runNetwork` | 848 | function |  | 6 |
| `kickHdaOnce` | 863 | function |  | 2 |
| `startHdaWatch` | 876 | function |  | 2 |
| `check` | 878 | arrow |  | 1 |
| `stopHdaWatch` | 896 | function |  | 2 |
| `loadSnapshotIntoStore` | 905 | function |  | 3 |
| `applyLoadedPreference` | 942 | function |  | 3 |
| `connect` | 968 | function |  | 4 |
| `markGraphDirty` | 1098 | function |  | 2 |
| `startAutoSave` | 1108 | function |  | 5 |

## web/src/nodes2/graph.ts（1652 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `actionContainsParams` | 108 | function |  | 2 |
| `log` | 113 | arrow |  | 17 |
| `notifySelection` | 117 | function |  | 3 |
| `nodeByKind` | 124 | function |  | 4 |
| `resolveInputSourcePort` | 135 | function |  | 4 |
| `nodeFromTarget` | 159 | function |  | 7 |
| `renderNode` | 175 | function |  | 1 |
| `portIndexFromTarget` | 190 | function |  | 2 |
| `CylNode` | 202 | class | export | 4 |
| `makeInputNode` | 233 | function |  | 3 |
| `makeOutputNode` | 238 | function |  | 3 |
| `makeNullNode` | 245 | function | export | 2 |
| `makeTransformNode` | 256 | function | export | 2 |
| `buildGraph` | 280 | function |  | 2 |
| `createReteGraph` | 366 | function | export | 1 |
| `attachTabSearch` | 661 | function |  | 2 |
| `render` | 677 | arrow |  | 4 |
| `create` | 692 | arrow |  | 2 |
| `close` | 721 | arrow |  | 6 |
| `update` | 727 | arrow |  | 3 |
| `distToSegment` | 757 | function |  | 2 |
| `sampleConnectionPath` | 767 | function |  | 2 |
| `findConnectionByRef` | 789 | function |  | 2 |
| `applyUndoAction` | 800 | function |  | 3 |
| `addConn` | 805 | arrow |  | 8 |
| `delConn` | 813 | arrow |  | 8 |
| `lbl` | 817 | arrow |  | 2 |
| `attachCutMode` | 884 | function |  | 2 |
| `isTyping` | 910 | arrow |  | 1 |
| `pathLen` | 916 | arrow |  | 1 |
| `setPoints` | 921 | arrow |  | 2 |
| `clear` | 925 | arrow |  | 2 |
| `cutConnection` | 930 | arrow |  | 1 |
| `cutByPolyline` | 945 | arrow |  | 1 |
| `up` | 1024 | arrow |  | 0 |
| `attachFlagMenu` | 1046 | function |  | 2 |
| `show` | 1058 | arrow |  | 2 |
| `setNodeStateHandler` | 1112 | function | export | 2 |
| `fireNodeState` | 1115 | function | export | 1 |
| `setRenameHandler` | 1121 | function | export | 2 |
| `fireRename` | 1124 | function | export | 1 |
| `initTooltip` | 1130 | function | export | 2 |
| `showTooltip` | 1136 | function | export | 1 |
| `hideTooltip` | 1149 | function | export | 1 |
| `attachMMBPan` | 1157 | function |  | 2 |
| `onMove` | 1165 | arrow |  | 0 |
| `onUp` | 1168 | arrow |  | 0 |
| `attachDotGrid` | 1186 | function |  | 2 |
| `hitTestConnection` | 1217 | function |  | 3 |
| `connectionPathD` | 1246 | function |  | 3 |
| `isInsertable` | 1254 | function |  | 2 |
| `attachInsertion` | 1258 | function |  | 2 |
| `refreshPreview` | 1306 | arrow |  | 2 |
| `updatePreview` | 1314 | arrow |  | 1 |
| `setHover` | 1337 | arrow |  | 2 |
| `attachRectSelect` | 1457 | function |  | 2 |
| `attachShakeDisconnect` | 1531 | function |  | 2 |
| `reset` | 1542 | arrow |  | 0 |
| `shakeNode` | 1548 | arrow |  | 1 |

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

## web/src/stores/workspace.ts（83 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `WorkspaceStore` | 6 | class | export | 1 |

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

## web/src/viewport/renderer.ts（780 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `Viewport` | 44 | class | export | 1 |
| `showModeMenu` | 133 | arrow |  | 1 |
| `hideModeMenu` | 145 | arrow |  | 2 |
| `applyMode` | 146 | arrow |  | 1 |
| `openModeMenu` | 161 | arrow |  | 1 |
| `closeModeMenu` | 162 | arrow |  | 3 |
