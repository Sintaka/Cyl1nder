# Cyl1nder MCP

两个 MCP 服务器：

## 1) Houdini MCP（fxhoudinimcp 桥，Codex 看 Houdini 场景/节点/参数/报错）
fxhoudinimcp 是跑在 Houdini 内的 HTTP MCP（hwebserver，默认端口 **8100**，被另一实例占用则 8101）。
外部桥 `mcp/fxhoudinimcp_bridge.py`（FastMCP stdio）把 Codex 的 MCP 调用代理到
`POST http://127.0.0.1:{8100|8101}/api`（`mcp.execute` / `mcp.health` / `mcp.list_commands`），
启动时**动态注册全部 fxhoudinimcp 命令**为 MCP 工具（约 190 个，前缀 `houdini_`，如
`houdini_code_execute_python`、`houdini_nodes_get_node_info`、`houdini_parameters_get_parameter_schema`、
`houdini_context_get_node_errors_detailed`），另含 `houdini_health / houdini_commands / houdini_execute` 三个 meta 工具。

config.toml（已配置）：
```toml
[mcp_servers.houdini]
type = "stdio"
command = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
args = ['D:\code\dev\Cyl1nder\mcp\fxhoudinimcp_bridge.py']
startup_timeout_sec = 30
```

依赖（外部 Python312）：`fastmcp`（`py -3.12 -m pip install fastmcp`）。
> 改完 config.toml 后需**重启 Codex** 让 MCP 生效。
> Houdini 侧：shelf **FXHoudini → MCP Server** 启动；若 8100 被占则设 `FXHOUDINIMCP_PORT=8101` 再启动。

## 2) Cyl1nder 桥 MCP（Codex 看桥状态/日志/索引/几何摘要）
```toml
[mcp_servers.cyl1nder]
type = "stdio"
command = 'D:\code\dev\Cyl1nder\bridge\.venv\Scripts\python.exe'
args = ['-m', 'bridge.mcp_server']
startup_timeout_sec = 30
```
工具：`cyl1nder_ping / cyl1nder_list_serials / cyl1nder_get_status / cyl1nder_read_logs /
cyl1nder_get_errors / cyl1nder_get_geometry_summary / cyl1nder_index_query`

> 注意：MCP 是 stdio 子进程，与桥 REST 进程各自独立；v0.1 内存 workspace 不跨进程共享（registry 落盘可读）。