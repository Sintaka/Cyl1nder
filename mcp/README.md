# Cyl1nder MCP

两个 MCP 服务器：

## 1) Houdini MCP（Codex 看 Houdini 场景/节点/报错/视口）
复用本地 fork：`Documents\Codex\tools\houdini-mcp-codex-windows-stdio-fixes`（oculairmedia/houdini-mcp + Windows stdio 修复）。
架构：`Codex → stdio FastMCP（普通 Python）→ rpyc 5.x → Houdini hrpyc:18811`

安装（一次性）：
```powershell
# 1) 外部 Python 依赖（系统 Python312，供 stdio server 用）
py -3.12 -m pip install "rpyc==5.3.1" fastmcp python-dotenv requests beautifulsoup4

# 2) 启动器（config.toml 已指向 Documents\Codex\run_houdini_mcp.py）
#    本仓库 mcp\run_houdini_mcp.py 会自动拷贝过去；或手动拷贝：
Copy-Item mcp\run_houdini_mcp.py "$env:USERPROFILE\Documents\Codex\run_houdini_mcp.py"

# 3) Houdini 插件（shelf "Houdini MCP" -> Start Remote）
powershell -ExecutionPolicy Bypass -File mcp\install_houdini_plugin.ps1
#    重启 Houdini 后点 Start Remote（hrpyc 18811）
```

config.toml 片段（通常已存在）：
```toml
[mcp_servers.houdini]
type = "stdio"
command = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
args = ['C:\Users\Administrator\Documents\Codex\run_houdini_mcp.py']
startup_timeout_sec = 30
```

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

> 注意：MCP 是 stdio 子进程，与桥 REST 进程各自独立但共享同一 data 目录与内存状态只在同一进程内；
> 若你希望 MCP 看到当前 REST 桥的状态，请让 MCP 进程与 REST 进程共享 CYL1NDER_DATA_DIR
> （默认都指向 bridge/data/，registry 落盘后两边可读）。v0.1 内存 workspace 不跨进程共享，属已知限制。