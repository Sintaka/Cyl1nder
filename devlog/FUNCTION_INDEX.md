# 函数索引 / FUNCTION INDEX

> 机器生成（2026-08-10），由 `node scripts/gen-index.mjs` 产出。共 **209** 个函数/类。
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

## bridge/bridge/routes.py（120 行）

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
| `serial_logs` | 105 | def |  | 1 |
| `global_logs` | 115 | def |  | 1 |

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

## web/src/app/layout.ts（114 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `buildLayout` | 16 | function | export | 1 |
| `attachSplitters` | 69 | function | export | 1 |
| `onDown` | 75 | arrow |  | 0 |
| `onMove` | 87 | arrow |  | 0 |
| `onUp` | 100 | arrow |  | 0 |

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

## web/src/main.ts（223 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `refreshNodeFlags` | 44 | function |  | 3 |
| `inputStatsText` | 65 | function |  | 2 |
| `outputStatsText` | 74 | function |  | 2 |
| `renderInspector` | 83 | function |  | 2 |
| `runNetwork` | 118 | function |  | 2 |
| `startHdaWatch` | 140 | function |  | 2 |
| `check` | 142 | arrow |  | 1 |
| `stopHdaWatch` | 159 | function |  | 2 |
| `connect` | 166 | function |  | 4 |

## web/src/nodes2/graph.ts（575 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `log` | 54 | arrow |  | 5 |
| `nodeByKind` | 59 | function |  | 4 |
| `nodeFromTarget` | 64 | function |  | 4 |
| `renderNode` | 80 | function |  | 1 |
| `portIndexFromTarget` | 95 | function |  | 2 |
| `CylNode` | 107 | class | export | 3 |
| `makeInputNode` | 133 | function |  | 2 |
| `makeOutputNode` | 138 | function |  | 2 |
| `makeNullNode` | 143 | function | export | 2 |
| `buildGraph` | 154 | function |  | 2 |
| `createReteGraph` | 211 | function | export | 1 |
| `attachTabSearch` | 295 | function |  | 2 |
| `render` | 311 | arrow |  | 4 |
| `create` | 326 | arrow |  | 2 |
| `close` | 342 | arrow |  | 6 |
| `update` | 348 | arrow |  | 3 |
| `attachCutMode` | 377 | function |  | 2 |
| `isTyping` | 383 | arrow |  | 1 |
| `attachFlagMenu` | 428 | function |  | 2 |
| `show` | 440 | arrow |  | 2 |
| `initTooltip` | 494 | function | export | 2 |
| `showTooltip` | 500 | function | export | 1 |
| `hideTooltip` | 513 | function | export | 1 |
| `attachMMBPan` | 521 | function |  | 2 |
| `onMove` | 529 | arrow |  | 0 |
| `onUp` | 532 | arrow |  | 0 |
| `attachDotGrid` | 550 | function |  | 2 |

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

## web/src/stores/workspace.ts（83 行）

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

## web/src/viewport/controls.ts（48 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `HoudiniControls` | 11 | class | export | 0 |
| `release` | 37 | arrow |  | 0 |

## web/src/viewport/geometry.ts（51 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `toVec` | 7 | function |  | 1 |
| `buildCurves` | 12 | function | export | 3 |
| `buildInputs` | 33 | function | export | 1 |
| `buildOutputs` | 43 | function | export | 1 |

## web/src/viewport/renderer.ts（232 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `Viewport` | 20 | class | export | 1 |
