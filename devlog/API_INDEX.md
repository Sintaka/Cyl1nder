# API 索引 / API INDEX

> 机器生成（2026-08-10），由 `node scripts/gen-api-index.mjs` 产出。单源：bridge/bridge/*.py

## REST (127.0.0.1:8375)

- `GET` `/` (routes.py:40)
- `GET` `/api/health` (routes.py:53)
- `GET` `/api/serials` (routes.py:59)
- `GET` `/api/hda/{serial}/status` (routes.py:64)
- `PUT` `/api/hda/{serial}/inputs` (routes.py:76)
- `GET` `/api/hda/{serial}/outputs` (routes.py:93)
- `PUT` `/api/hda/{serial}/outputs` (routes.py:102)
- `GET` `/api/hda/{serial}/pending` (routes.py:118)
- `GET` `/api/hda/{serial}/logs` (routes.py:132)
- `GET` `/api/hda/{serial}/snapshot` (routes.py:142)
- `GET` `/api/ui/layout` (routes.py:153)
- `PUT` `/api/ui/layout` (routes.py:160)
- `PUT` `/api/hda/{serial}/snapshot` (routes.py:168)
- `GET` `/api/ui/layouts` (routes.py:185)
- `PUT` `/api/ui/layouts/{name}` (routes.py:191)
- `GET` `/api/ui/layouts/{name}` (routes.py:198)
- `GET` `/api/logs` (routes.py:205)
- `WEBSOCKET` `/ws` (ws.py:52)

## MCP tools (bridge.mcp_server)

- `cyl1nder_ping` (mcp_server.py:33)
- `cyl1nder_list_serials` (mcp_server.py:40)
- `cyl1nder_get_status` (mcp_server.py:46)
- `cyl1nder_read_snapshot` (mcp_server.py:58)
- `cyl1nder_nodeview_nodes` (mcp_server.py:98)
- `cyl1nder_nodeview_connections` (mcp_server.py:107)
- `cyl1nder_nodeview_status` (mcp_server.py:127)
- `cyl1nder_nodeview_connected` (mcp_server.py:154)
- `cyl1nder_read_layout` (mcp_server.py:185)
- `cyl1nder_read_logs` (mcp_server.py:208)
- `cyl1nder_get_errors` (mcp_server.py:214)
- `cyl1nder_get_geometry_summary` (mcp_server.py:220)
- `cyl1nder_index_query` (mcp_server.py:230)

## WS 消息

- server->client: `hello` / `inputs` / `outputs` / `pong`
- client->server: `ping` / `edit`
