# Cyl1nder Bridge

本地桥：单进程独占 `127.0.0.1:8375`，按 serial 路由。Houdini HDA 推输入、拉编辑结果；
Web 前端经 REST/WS 读输入、推编辑；MCP（stdio）暴露状态/日志/索引给 Codex。

## 运行
```powershell
cd bridge
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m bridge          # 启动 REST+WS (8375)
.venv\Scripts\python -m bridge.mcp      # 启动 MCP (stdio)
.venv\Scripts\python -m pytest tests    # 测试
```

## 结构
- `bridge/protocol.py` 协议单源（REST/WS/MCP 载荷模型 + serial 规则）
- `bridge/registry.py` 序列号注册表（不可变、JSON 持久化到 bridge/data/）
- `bridge/workspace.py` per-serial 输入/输出 rev buffers
- `bridge/logs.py` 环形日志
- `bridge/routes.py` REST；`bridge/ws.py` WebSocket
- `bridge/mcp_server.py` FastMCP 工具
- `bridge/compute/` 执行器接口（预留 pyd/dll，v1 仅 passthrough + ctypes demo）
