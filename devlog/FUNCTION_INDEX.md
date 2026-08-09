# 函数索引 / FUNCTION INDEX

> 机器生成（2026-08-09），由 `node scripts/gen-index.mjs` 产出。共 **150** 个函数/类。
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

## hda/scripts/build_hda.py（165 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_parm_group` | 44 | def |  | 3 |
| `build` | 96 | def |  | 2 |

## hda/scripts/hython_smoke.py（111 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_req` | 24 | def |  | 3 |
| `_make_curve_input` | 33 | def |  | 2 |
| `main` | 51 | def |  | 2 |

## hda/scripts/reload_hda.py（87 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_reload_modules` | 30 | def |  | 2 |
| `_instances` | 43 | def |  | 2 |
| `_force_recook_all` | 48 | def |  | 3 |
| `_rebuild_hda` | 62 | def |  | 2 |
| `_reload_definition` | 68 | def |  | 2 |
| `reload_cyl1nder` | 75 | def |  | 3 |

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

## hda/src/cyl1nder_hda.py（281 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_bridge_healthy` | 31 | def |  | 2 |
| `_ensure_bridge` | 39 | def |  | 2 |
| `_same_as_buffer` | 61 | def |  | 2 |
| `_sync_loop` | 79 | def |  | 1 |
| `_schedule_recook` | 105 | def |  | 3 |
| `_force_cook_node` | 113 | def |  | 1 |
| `ensure_sync` | 138 | def |  | 2 |
| `_root` | 162 | def |  | 3 |
| `_ensure_serial` | 166 | def |  | 2 |
| `_parm` | 179 | def |  | 8 |
| `_set_status` | 189 | def |  | 5 |
| `_build_detail` | 198 | def |  | 2 |
| `cook` | 222 | def |  | 3 |

## hda/src/cyl1nder_serializer.py（57 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_norm_value` | 12 | def |  | 2 |
| `serialize_input` | 20 | def |  | 1 |

## web/src/app/app-config.ts（5 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/app/layout.ts（56 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `buildLayout` | 15 | function | export | 1 |

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

## web/src/main.ts（158 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `inputStatsText` | 32 | function |  | 2 |
| `outputStatsText` | 41 | function |  | 2 |
| `renderInspector` | 50 | function |  | 2 |
| `runNetwork` | 83 | function |  | 2 |
| `connect` | 102 | function |  | 4 |

## web/src/nodes/cyl1nderNode.ts（120 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `registerNodes` | 9 | function | export | 1 |
| `createGraph` | 61 | function | export | 1 |
| `upsertFlowGraph` | 73 | function | export | 1 |

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

## web/src/viewport/controls.ts（31 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `HoudiniControls` | 8 | class | export | 0 |
| `release` | 21 | arrow |  | 0 |

## web/src/viewport/geometry.ts（51 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `toVec` | 7 | function |  | 1 |
| `buildCurves` | 12 | function | export | 3 |
| `buildInputs` | 33 | function | export | 1 |
| `buildOutputs` | 43 | function | export | 1 |

## web/src/viewport/renderer.ts（150 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `Viewport` | 13 | class | export | 0 |
