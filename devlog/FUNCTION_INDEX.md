# 函数索引 / FUNCTION INDEX

> 机器生成（2026-08-11），由 `node scripts/gen-index.mjs` 产出。共 **371** 个函数/类。
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

## bridge/bridge/protocol.py（96 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_b36` | 26 | def |  | 3 |
| `generate_serial` | 37 | def |  | 1 |
| `is_valid_serial` | 48 | def |  | 1 |
| `AttributeData` | 52 | class |  | 1 |
| `CurveData` | 58 | class |  | 1 |
| `InputPayload` | 63 | class |  | 1 |
| `OutputBuffer` | 74 | class |  | 1 |
| `InputsPut` | 85 | class |  | 1 |
| `OutputsPut` | 93 | class |  | 1 |

## bridge/bridge/registry.py（138 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `RegistryError` | 21 | class |  | 2 |
| `RegistryRecord` | 25 | class |  | 1 |
| `__init__` | 28 | def |  | 2 |
| `to_dict` | 45 | def |  | 2 |
| `from_dict` | 56 | def |  | 2 |
| `SerialRegistry` | 67 | class |  | 0 |
| `register` | 75 | def |  | 1 |
| `get` | 102 | def |  | 9 |
| `touch` | 106 | def |  | 1 |
| `list` | 112 | def |  | 1 |
| `serials` | 116 | def |  | 1 |
| `_save` | 120 | def |  | 2 |
| `_load` | 129 | def |  | 2 |

## bridge/bridge/routes.py（211 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_maybe_snapshot` | 20 | def |  | 3 |
| `root` | 41 | def |  | 1 |
| `_check_serial` | 48 | def |  | 9 |
| `health` | 54 | def |  | 1 |
| `list_serials` | 60 | def |  | 1 |
| `status` | 65 | def |  | 2 |
| `put_inputs` | 77 | def |  | 1 |
| `get_outputs` | 94 | def |  | 1 |
| `put_outputs` | 103 | def |  | 2 |
| `pending` | 119 | def |  | 1 |
| `serial_logs` | 133 | def |  | 1 |
| `get_snapshot` | 143 | def |  | 1 |
| `get_ui_layout` | 154 | def |  | 1 |
| `put_ui_layout` | 161 | def |  | 1 |
| `put_snapshot` | 169 | def |  | 1 |
| `ui_layouts` | 186 | def |  | 1 |
| `ui_layout_save` | 192 | def |  | 1 |
| `ui_layout_load` | 199 | def |  | 1 |
| `global_logs` | 206 | def |  | 1 |

## bridge/bridge/snapshot.py（135 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `snapshot_root` | 37 | def |  | 3 |
| `_part_path` | 49 | def |  | 3 |
| `read_snapshot` | 54 | def |  | 1 |
| `write_snapshot` | 78 | def |  | 1 |
| `build_meta` | 124 | def |  | 1 |

## bridge/bridge/state.py（44 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeState` | 13 | class |  | 2 |
| `__init__` | 14 | def |  | 1 |
| `default_data_dir` | 25 | def |  | 2 |
| `get_state` | 32 | def |  | 1 |
| `reset_state` | 39 | def |  | 1 |

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

## bridge/bridge/ws.py（105 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ConnectionManager` | 14 | class |  | 1 |
| `__init__` | 15 | def |  | 1 |
| `connect` | 19 | def |  | 2 |
| `disconnect` | 24 | def |  | 3 |
| `broadcast` | 32 | def |  | 2 |
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

## hda/scripts/hython_smoke.py（122 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_req` | 24 | def |  | 3 |
| `_make_curve_input` | 33 | def |  | 2 |
| `main` | 51 | def |  | 2 |

## hda/scripts/reload_hda.py（89 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_reload_modules` | 31 | def |  | 2 |
| `_instances` | 44 | def |  | 2 |
| `_force_recook_all` | 49 | def |  | 3 |
| `_rebuild_hda` | 63 | def |  | 2 |
| `_reload_definition` | 69 | def |  | 2 |
| `reload_cyl1nder` | 76 | def |  | 3 |

## hda/src/cyl1nder_bridge.py（111 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_b36` | 17 | def |  | 3 |
| `generate_serial` | 28 | def |  | 1 |
| `BridgeClient` | 35 | class |  | 0 |
| `__init__` | 36 | def |  | 1 |
| `push_inputs` | 52 | def |  | 1 |
| `_pump` | 59 | def |  | 1 |
| `pending_outputs` | 87 | def |  | 1 |
| `pull_outputs` | 102 | def |  | 1 |

## hda/src/cyl1nder_hda.py（528 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_ui_healthy` | 52 | def |  | 2 |
| `_ensure_frontend` | 61 | def |  | 3 |
| `_bridge_healthy` | 82 | def |  | 2 |
| `_ensure_bridge` | 90 | def |  | 3 |
| `_same_as_buffer` | 113 | def |  | 2 |
| `_sync_loop` | 131 | def |  | 1 |
| `_schedule_recook` | 157 | def |  | 3 |
| `_force_cook_node` | 165 | def |  | 1 |
| `ensure_sync` | 193 | def |  | 3 |
| `_root` | 217 | def |  | 4 |
| `_ensure_serial` | 221 | def |  | 3 |
| `_parm` | 234 | def |  | 14 |
| `_set_status` | 244 | def |  | 6 |
| `_serialize_geo` | 253 | def |  | 3 |
| `_build_detail` | 263 | def |  | 2 |
| `_snapshot_parts` | 298 | def |  | 2 |
| `_flat_signature` | 338 | def |  | 2 |
| `_build_core_detail` | 350 | def |  | 3 |
| `cook_core` | 374 | def |  | 2 |
| `_same_geo` | 438 | def |  | 2 |
| `_role_buffer` | 449 | def |  | 2 |
| `cook` | 468 | def |  | 4 |

## hda/src/cyl1nder_serializer.py（63 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_norm_value` | 12 | def |  | 2 |
| `serialize_input` | 20 | def |  | 1 |

## web/src/app/app-config.ts（7 行）

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

## web/src/app/layout.ts（172 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `buildLayout` | 20 | function | export | 1 |
| `buildLayoutLegacy` | 99 | function | export | 1 |

## web/src/app/layouts.ts（11 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/app/log.ts（4 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `formatLog` | 2 | function | export | 1 |

## web/src/app/param.ts（131 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `esc` | 25 | function |  | 5 |
| `attrEscape` | 30 | function |  | 4 |
| `controlHtml` | 37 | function |  | 2 |
| `applyEdit` | 53 | function |  | 3 |
| `renderParams` | 71 | function | export | 1 |
| `commit` | 111 | arrow |  | 0 |

## web/src/app/scrub.ts（173 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `format4` | 22 | function | export | 3 |
| `pickMultiplier` | 27 | function | export | 3 |
| `scrubValue` | 38 | function | export | 2 |
| `attachScrub` | 43 | function | export | 1 |

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

## web/src/bridge/client.ts（162 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeClient` | 23 | class | export | 0 |
| `connectWs` | 126 | function | export | 1 |
| `connect` | 131 | arrow |  | 1 |

## web/src/main.ts（619 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `matchLogFilter` | 32 | arrow |  | 0 |
| `renderLog` | 33 | arrow |  | 3 |
| `toggle` | 86 | arrow |  | 6 |
| `getDockJson` | 100 | arrow |  | 3 |
| `saveCurrentLayout` | 104 | arrow |  | 2 |
| `refreshLayoutPresets` | 112 | arrow |  | 1 |
| `applyLayoutSettings` | 235 | function |  | 4 |
| `readParamFloats` | 240 | function |  | 3 |
| `refreshSelectionPanels` | 253 | function |  | 3 |
| `toggleEnterEdit` | 309 | function |  | 2 |
| `refreshNodeFlags` | 341 | function |  | 4 |
| `inputStatsText` | 391 | function |  | 2 |
| `outputStatsText` | 400 | function |  | 2 |
| `renderInspector` | 409 | function |  | 2 |
| `runNetwork` | 446 | function |  | 5 |
| `startHdaWatch` | 461 | function |  | 2 |
| `check` | 463 | arrow |  | 1 |
| `stopHdaWatch` | 480 | function |  | 2 |
| `loadSnapshotIntoStore` | 489 | function |  | 3 |
| `connect` | 517 | function |  | 4 |
| `scheduleSaveGraph` | 607 | function |  | 2 |

## web/src/nodes2/graph.ts（1578 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `log` | 90 | arrow |  | 15 |
| `notifySelection` | 94 | function |  | 3 |
| `nodeByKind` | 101 | function |  | 4 |
| `nodeFromTarget` | 106 | function |  | 7 |
| `renderNode` | 122 | function |  | 1 |
| `portIndexFromTarget` | 137 | function |  | 2 |
| `CylNode` | 149 | class | export | 4 |
| `makeInputNode` | 180 | function |  | 3 |
| `makeOutputNode` | 185 | function |  | 3 |
| `makeNullNode` | 192 | function | export | 2 |
| `makeTransformNode` | 203 | function | export | 2 |
| `buildGraph` | 227 | function |  | 2 |
| `createReteGraph` | 313 | function | export | 1 |
| `attachTabSearch` | 601 | function |  | 2 |
| `render` | 617 | arrow |  | 4 |
| `create` | 632 | arrow |  | 2 |
| `close` | 661 | arrow |  | 6 |
| `update` | 667 | arrow |  | 3 |
| `distToSegment` | 697 | function |  | 2 |
| `sampleConnectionPath` | 707 | function |  | 2 |
| `findConnectionByRef` | 729 | function |  | 2 |
| `applyUndoAction` | 740 | function |  | 2 |
| `addConn` | 745 | arrow |  | 8 |
| `delConn` | 753 | arrow |  | 8 |
| `lbl` | 757 | arrow |  | 2 |
| `attachCutMode` | 810 | function |  | 2 |
| `isTyping` | 836 | arrow |  | 1 |
| `pathLen` | 842 | arrow |  | 1 |
| `setPoints` | 847 | arrow |  | 2 |
| `clear` | 851 | arrow |  | 2 |
| `cutConnection` | 856 | arrow |  | 1 |
| `cutByPolyline` | 871 | arrow |  | 1 |
| `up` | 950 | arrow |  | 0 |
| `attachFlagMenu` | 972 | function |  | 2 |
| `show` | 984 | arrow |  | 2 |
| `setNodeStateHandler` | 1038 | function | export | 2 |
| `fireNodeState` | 1041 | function | export | 1 |
| `setRenameHandler` | 1047 | function | export | 2 |
| `fireRename` | 1050 | function | export | 1 |
| `initTooltip` | 1056 | function | export | 2 |
| `showTooltip` | 1062 | function | export | 1 |
| `hideTooltip` | 1075 | function | export | 1 |
| `attachMMBPan` | 1083 | function |  | 2 |
| `onMove` | 1091 | arrow |  | 0 |
| `onUp` | 1094 | arrow |  | 0 |
| `attachDotGrid` | 1112 | function |  | 2 |
| `hitTestConnection` | 1143 | function |  | 3 |
| `connectionPathD` | 1172 | function |  | 3 |
| `isInsertable` | 1180 | function |  | 2 |
| `attachInsertion` | 1184 | function |  | 2 |
| `refreshPreview` | 1232 | arrow |  | 2 |
| `updatePreview` | 1240 | arrow |  | 1 |
| `setHover` | 1263 | arrow |  | 2 |
| `attachRectSelect` | 1383 | function |  | 2 |
| `attachShakeDisconnect` | 1457 | function |  | 2 |
| `reset` | 1468 | arrow |  | 0 |
| `shakeNode` | 1474 | arrow |  | 1 |

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

## web/src/nodes2/network.ts（181 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `paramValue` | 35 | function | export | 6 |
| `asFiniteNumber` | 46 | function |  | 4 |
| `toGroupClass` | 52 | function |  | 2 |
| `findFeeder` | 57 | function |  | 3 |
| `nodeById` | 65 | function |  | 3 |
| `parseInPort` | 70 | function |  | 2 |
| `emptyBuffer` | 76 | function |  | 2 |
| `fallbackBuffer` | 81 | function |  | 2 |
| `traceChain` | 108 | function |  | 3 |
| `bufferFromResolved` | 148 | function |  | 2 |
| `computeOutputs` | 168 | function | export | 1 |

## web/src/nodes2/undo.ts（108 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createUndoManager` | 49 | function | export | 2 |

## web/src/protocol/compare.ts（23 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `payloadEqual` | 3 | function |  | 2 |
| `inputsEqual` | 15 | function | export | 1 |

## web/src/protocol/types.ts（90 行）

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

## web/src/viewport/geometry.ts（129 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `toVec` | 7 | function |  | 1 |
| `buildWireSegments` | 13 | function |  | 2 |
| `buildMeshFaces` | 39 | function | export | 2 |
| `buildPoints` | 70 | function |  | 2 |
| `buildCurves` | 83 | function | export | 3 |
| `buildInputs` | 111 | function | export | 1 |
| `buildOutputs` | 121 | function | export | 1 |

## web/src/viewport/renderer.ts（724 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `Viewport` | 44 | class | export | 1 |
| `showModeMenu` | 127 | arrow |  | 1 |
| `hideModeMenu` | 139 | arrow |  | 2 |
| `applyMode` | 140 | arrow |  | 1 |
| `openModeMenu` | 155 | arrow |  | 1 |
| `closeModeMenu` | 156 | arrow |  | 3 |
