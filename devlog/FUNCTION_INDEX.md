# 函数索引 / FUNCTION INDEX

> 机器生成（2026-08-10），由 `node scripts/gen-index.mjs` 产出。共 **225** 个函数/类。
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

## bridge/bridge/mcp_server.py（108 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_index_files` | 24 | def |  | 2 |
| `cyl1nder_ping` | 32 | def |  | 1 |
| `cyl1nder_list_serials` | 39 | def |  | 1 |
| `cyl1nder_get_status` | 45 | def |  | 1 |
| `cyl1nder_read_logs` | 57 | def |  | 1 |
| `cyl1nder_get_errors` | 63 | def |  | 1 |
| `cyl1nder_get_geometry_summary` | 69 | def |  | 1 |
| `cyl1nder_index_query` | 79 | def |  | 1 |
| `run_stdio` | 102 | def |  | 2 |

## bridge/bridge/protocol.py（94 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_b36` | 26 | def |  | 3 |
| `generate_serial` | 37 | def |  | 1 |
| `is_valid_serial` | 48 | def |  | 1 |
| `AttributeData` | 52 | class |  | 1 |
| `CurveData` | 58 | class |  | 1 |
| `InputPayload` | 63 | class |  | 1 |
| `OutputBuffer` | 73 | class |  | 1 |
| `InputsPut` | 83 | class |  | 1 |
| `OutputsPut` | 91 | class |  | 1 |

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

## bridge/bridge/routes.py（114 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `root` | 15 | def |  | 1 |
| `_check_serial` | 22 | def |  | 7 |
| `health` | 28 | def |  | 1 |
| `list_serials` | 34 | def |  | 1 |
| `status` | 39 | def |  | 2 |
| `put_inputs` | 51 | def |  | 1 |
| `get_outputs` | 67 | def |  | 1 |
| `put_outputs` | 76 | def |  | 2 |
| `pending` | 91 | def |  | 1 |
| `serial_logs` | 99 | def |  | 1 |
| `global_logs` | 109 | def |  | 1 |

## bridge/bridge/state.py（42 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeState` | 12 | class |  | 2 |
| `__init__` | 13 | def |  | 1 |
| `default_data_dir` | 23 | def |  | 2 |
| `get_state` | 30 | def |  | 1 |
| `reset_state` | 37 | def |  | 1 |

## bridge/bridge/workspace.py（120 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `Workspace` | 10 | class |  | 1 |
| `__init__` | 11 | def |  | 2 |
| `set_inputs` | 19 | def |  | 1 |
| `put_outputs` | 24 | def |  | 1 |
| `get_outputs_since` | 46 | def |  | 1 |
| `output_rev` | 53 | def |  | 1 |
| `to_summary` | 57 | def |  | 2 |
| `_same_content` | 86 | def |  | 2 |
| `WorkspaceStore` | 96 | class |  | 0 |
| `get_or_create` | 101 | def |  | 2 |
| `get` | 109 | def |  | 4 |
| `serials` | 113 | def |  | 1 |
| `status` | 117 | def |  | 1 |

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

## hda/scripts/build_hda.py（189 行）

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

## hda/src/cyl1nder_hda.py（521 行）

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
| `_snapshot_parts` | 291 | def |  | 2 |
| `_flat_signature` | 331 | def |  | 2 |
| `_build_core_detail` | 343 | def |  | 3 |
| `cook_core` | 367 | def |  | 2 |
| `_same_geo` | 431 | def |  | 2 |
| `_role_buffer` | 442 | def |  | 2 |
| `cook` | 461 | def |  | 4 |

## hda/src/cyl1nder_serializer.py（57 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_norm_value` | 12 | def |  | 2 |
| `serialize_input` | 20 | def |  | 1 |

## web/src/app/app-config.ts（7 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/app/layout.ts（108 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `buildLayout` | 15 | function | export | 1 |
| `attachSplitters` | 63 | function | export | 1 |
| `onDown` | 69 | arrow |  | 0 |
| `onMove` | 81 | arrow |  | 0 |
| `onUp` | 94 | arrow |  | 0 |

## web/src/app/log.ts（4 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `formatLog` | 2 | function | export | 1 |

## web/src/bridge/client.ts（113 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeClient` | 23 | class | export | 0 |
| `connectWs` | 77 | function | export | 1 |
| `connect` | 82 | arrow |  | 1 |

## web/src/main.ts（191 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `refreshNodeFlags` | 42 | function |  | 3 |
| `inputStatsText` | 63 | function |  | 2 |
| `outputStatsText` | 72 | function |  | 2 |
| `renderInspector` | 81 | function |  | 2 |
| `runNetwork` | 116 | function |  | 2 |
| `connect` | 135 | function |  | 4 |

## web/src/nodes/contextMenu.ts（83 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `attachContextMenu` | 7 | function | export | 1 |
| `close` | 19 | function |  | 5 |
| `show` | 26 | function |  | 3 |
| `onDown` | 58 | arrow |  | 0 |
| `onKey` | 61 | arrow |  | 0 |

## web/src/nodes/cutMode.ts（55 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `attachCutMode` | 6 | function | export | 1 |
| `isTyping` | 12 | arrow |  | 1 |
| `down` | 18 | arrow |  | 0 |
| `up` | 24 | arrow |  | 0 |
| `onEdgeClick` | 30 | arrow |  | 0 |
| `onNodeClick` | 35 | arrow |  | 0 |

## web/src/nodes/cyl1nderNode.ts（232 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `portItems` | 27 | function |  | 5 |
| `applyFlags` | 32 | function | export | 2 |
| `titleText` | 49 | function |  | 2 |
| `getFlags` | 54 | function | export | 4 |
| `setFlags` | 59 | function | export | 2 |
| `toggleFlag` | 66 | function | export | 1 |
| `makeMarkup` | 71 | function |  | 4 |
| `registerNodes` | 89 | function | export | 1 |
| `createGraph` | 134 | function | export | 1 |
| `upsertFlowGraph` | 172 | function | export | 1 |
| `getOrAdd` | 198 | function |  | 3 |
| `addNullNode` | 220 | function | export | 1 |

## web/src/nodes/flags.ts（28 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `isFrozen` | 24 | function | export | 1 |

## web/src/nodes/palette.ts（137 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `searchPalette` | 20 | function | export | 2 |
| `NodePalette` | 35 | class | export | 1 |
| `attachPalette` | 126 | function | export | 1 |

## web/src/nodes2/graph.ts（445 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `log` | 52 | arrow |  | 4 |
| `nodeByKind` | 57 | function |  | 4 |
| `nodeFromTarget` | 62 | function |  | 4 |
| `portIndexFromTarget` | 77 | function |  | 2 |
| `CylNode` | 89 | class | export | 3 |
| `makeInputNode` | 115 | function |  | 2 |
| `makeOutputNode` | 120 | function |  | 2 |
| `makeNullNode` | 125 | function | export | 2 |
| `buildGraph` | 138 | function |  | 2 |
| `createReteGraph` | 188 | function | export | 1 |
| `attachTabSearch` | 251 | function |  | 2 |
| `render` | 267 | arrow |  | 3 |
| `create` | 282 | arrow |  | 2 |
| `close` | 298 | arrow |  | 6 |
| `update` | 304 | arrow |  | 2 |
| `attachCutMode` | 333 | function |  | 2 |
| `isTyping` | 339 | arrow |  | 1 |
| `attachFlagMenu` | 384 | function |  | 2 |
| `show` | 396 | arrow |  | 2 |

## web/src/proto/main.ts（5 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/protocol/compare.ts（22 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `payloadEqual` | 3 | function |  | 2 |
| `inputsEqual` | 14 | function | export | 1 |

## web/src/protocol/types.ts（88 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/stores/workspace.ts（77 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `WorkspaceStore` | 6 | class | export | 1 |

## web/src/tools/transform.ts（41 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `translatePoint` | 5 | function | export | 3 |
| `translatePoints` | 9 | function | export | 1 |
| `applyTranslateToCurve` | 14 | function | export | 1 |
| `inputToOutput` | 31 | function | export | 1 |

## web/src/viewport/backend.ts（31 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `createRenderer` | 18 | function | export | 1 |

## web/src/viewport/controls.ts（41 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `HoudiniControls` | 11 | class | export | 0 |
| `release` | 30 | arrow |  | 0 |

## web/src/viewport/geometry.ts（51 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `toVec` | 7 | function |  | 1 |
| `buildCurves` | 12 | function | export | 3 |
| `buildInputs` | 33 | function | export | 1 |
| `buildOutputs` | 43 | function | export | 1 |

## web/src/viewport/renderer.ts（229 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `Viewport` | 20 | class | export | 1 |
