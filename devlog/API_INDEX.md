# API 索引 / API INDEX

> 机器生成（2026-08-09），由 `node scripts/gen-api-index.mjs` 产出。单源：bridge/bridge/*.py

## REST (127.0.0.1:8375)

- `GET` `/` (routes.py:14)
- `GET` `/api/health` (routes.py:27)
- `GET` `/api/serials` (routes.py:33)
- `GET` `/api/hda/{serial}/status` (routes.py:38)
- `PUT` `/api/hda/{serial}/inputs` (routes.py:50)
- `GET` `/api/hda/{serial}/outputs` (routes.py:66)
- `PUT` `/api/hda/{serial}/outputs` (routes.py:75)
- `GET` `/api/hda/{serial}/pending` (routes.py:90)
- `GET` `/api/hda/{serial}/logs` (routes.py:98)
- `GET` `/api/logs` (routes.py:108)
- `WEBSOCKET` `/ws` (ws.py:52)

## MCP tools (bridge.mcp_server)

- `cyl1nder_ping` (mcp_server.py:32)
- `cyl1nder_list_serials` (mcp_server.py:39)
- `cyl1nder_get_status` (mcp_server.py:45)
- `cyl1nder_read_logs` (mcp_server.py:57)
- `cyl1nder_get_errors` (mcp_server.py:63)
- `cyl1nder_get_geometry_summary` (mcp_server.py:69)
- `cyl1nder_index_query` (mcp_server.py:79)

## WS 消息

- server->client: `hello` / `inputs` / `outputs` / `pong`
- client->server: `ping` / `edit`
