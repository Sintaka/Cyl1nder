# Cyl1nder MCP

两个 MCP 服务器：

## 1) Houdini MCP = 官方 fxhoudinimcp（直接复用，不自己写）
官方 pip 包：`fxhoudinimcp` v2.10.0（github healkeiser/fxhoudinimcp）。
- Houdini 内插件（hwebserver HTTP MCP）：默认端口 **8100**，被其他 Houdini 实例占用时自动 8101+。
- 外部 MCP server：`python -m fxhoudinimcp`（stdio，约 188 工具，如 `execute_python`、`get_node_info`、`get_parameter_schema`、`get_node_errors_detailed`）。
- Codex config.toml（已配置，改名 `fxhoudinimcp` 避免与其它实现混淆）：
```toml
[mcp_servers.fxhoudinimcp]
# 官方 fxhoudinimcp——Houdini 端与 Codex 一律用它，不自己写 MCP 桥
type = "stdio"
command = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
args = ['-m', 'fxhoudinimcp']
startup_timeout_sec = 30

[mcp_servers.fxhoudinimcp.env]
HOUDINI_HOST = "127.0.0.1"
```
- 依赖（外部 Python312）：`py -3.12 -m pip install fxhoudinimcp`。
- Houdini 侧：shelf **FXHoudini → MCP Server** 启动（或 `FXHOUDINIMCP_PORT=8100` 环境）。
- ⚠️ config.toml 已实际改名 `[mcp_servers.fxhoudinimcp]`（2026-08-10 v0.1.00013 落实，替换旧 `houdini`/run_houdini_mcp.py）；**重启 Codex 后生效**。重启前可直接用官方桥 HTTP（`POST http://127.0.0.1:8100/api`，`json=["mcp.health",[],{}]`，`Content-Type: application/x-www-form-urlencoded`）或 `from fxhoudinimcp.bridge import HoudiniBridge`。

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