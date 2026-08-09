# 函数索引 / FUNCTION INDEX

> 机器生成（2026-08-09），由 `node scripts/gen-index.mjs` 产出。共 **128** 个函数/类。
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

## bridge/bridge/protocol.py（92 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_b36` | 24 | def |  | 3 |
| `generate_serial` | 35 | def |  | 1 |
| `is_valid_serial` | 46 | def |  | 1 |
| `AttributeData` | 50 | class |  | 1 |
| `CurveData` | 56 | class |  | 1 |
| `InputPayload` | 61 | class |  | 1 |
| `OutputBuffer` | 71 | class |  | 1 |
| `InputsPut` | 81 | class |  | 1 |
| `OutputsPut` | 89 | class |  | 1 |

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

## bridge/bridge/routes.py（96 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_check_serial` | 13 | def |  | 6 |
| `health` | 19 | def |  | 1 |
| `list_serials` | 25 | def |  | 1 |
| `status` | 30 | def |  | 2 |
| `put_inputs` | 42 | def |  | 1 |
| `get_outputs` | 58 | def |  | 1 |
| `put_outputs` | 67 | def |  | 2 |
| `serial_logs` | 81 | def |  | 1 |
| `global_logs` | 91 | def |  | 1 |

## bridge/bridge/state.py（42 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `BridgeState` | 12 | class |  | 2 |
| `__init__` | 13 | def |  | 1 |
| `default_data_dir` | 23 | def |  | 2 |
| `get_state` | 30 | def |  | 1 |
| `reset_state` | 37 | def |  | 1 |

## bridge/bridge/workspace.py（99 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `Workspace` | 10 | class |  | 1 |
| `__init__` | 11 | def |  | 2 |
| `set_inputs` | 19 | def |  | 1 |
| `put_outputs` | 24 | def |  | 1 |
| `get_outputs_since` | 37 | def |  | 1 |
| `output_rev` | 42 | def |  | 1 |
| `to_summary` | 46 | def |  | 2 |
| `WorkspaceStore` | 75 | class |  | 0 |
| `get_or_create` | 80 | def |  | 2 |
| `get` | 88 | def |  | 4 |
| `serials` | 92 | def |  | 1 |
| `status` | 96 | def |  | 1 |

## bridge/bridge/ws.py（102 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `ConnectionManager` | 14 | class |  | 1 |
| `__init__` | 15 | def |  | 1 |
| `connect` | 19 | def |  | 2 |
| `disconnect` | 24 | def |  | 3 |
| `broadcast` | 32 | def |  | 2 |
| `ws_endpoint` | 53 | def |  | 1 |

## hda/scripts/build_hda.py（154 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_parm_group` | 44 | def |  | 3 |
| `build` | 88 | def |  | 2 |

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

## hda/src/cyl1nder_bridge.py（96 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_b36` | 17 | def |  | 3 |
| `generate_serial` | 28 | def |  | 1 |
| `BridgeClient` | 35 | class |  | 0 |
| `__init__` | 36 | def |  | 1 |
| `push_inputs` | 52 | def |  | 1 |
| `_pump` | 59 | def |  | 1 |
| `pull_outputs` | 87 | def |  | 1 |

## hda/src/cyl1nder_hda.py（130 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `_root` | 18 | def |  | 3 |
| `_ensure_serial` | 22 | def |  | 2 |
| `_parm` | 35 | def |  | 4 |
| `_set_status` | 45 | def |  | 4 |
| `_build_detail` | 54 | def |  | 2 |
| `cook` | 78 | def |  | 2 |

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
| `export ` | 15 | function | export | 0 |

## web/src/app/log.ts（4 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `export ` | 2 | function | export | 0 |

## web/src/bridge/client.ts（90 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `export ` | 23 | class | export | 0 |

## web/src/main.ts（147 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `inputStatsText` | 30 | function |  | 2 |
| `outputStatsText` | 39 | function |  | 2 |
| `renderInspector` | 48 | function |  | 2 |
| `runNetwork` | 81 | function |  | 2 |
| `connect` | 100 | function |  | 4 |

## web/src/nodes/cyl1nderNode.ts（120 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `export ` | 9 | function | export | 0 |

## web/src/protocol/types.ts（88 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|

## web/src/stores/workspace.ts（77 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `export ` | 6 | class | export | 0 |

## web/src/tools/transform.ts（41 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `export ` | 5 | function | export | 0 |

## web/src/viewport/controls.ts（31 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `export ` | 8 | class | export | 0 |
| `release` | 21 | arrow |  | 0 |

## web/src/viewport/geometry.ts（51 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `toVec` | 7 | function |  | 1 |
| `export ` | 12 | function | export | 0 |

## web/src/viewport/renderer.ts（150 行）

| 函数 | 行号 | 类型 | 导出 | calls |
|---|---|---|---|---|
| `export ` | 13 | class | export | 0 |
