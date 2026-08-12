# API 索引 / API INDEX

> 机器生成（2026-08-12），由 `node scripts/gen-api-index.mjs` 产出。单源：bridge/bridge/*.py

## REST (127.0.0.1:8375)

- `GET` `/` (routes.py:42)
- `GET` `/api/health` (routes.py:55)
- `GET` `/api/serials` (routes.py:61)
- `GET` `/api/hda/{serial}/status` (routes.py:66)
- `PUT` `/api/hda/{serial}/inputs` (routes.py:78)
- `GET` `/api/hda/{serial}/outputs` (routes.py:96)
- `PUT` `/api/hda/{serial}/outputs` (routes.py:105)
- `GET` `/api/hda/{serial}/pending` (routes.py:123)
- `POST` `/api/hda/{serial}/kick` (routes.py:145)
- `GET` `/api/hda/{serial}/logs` (routes.py:164)
- `GET` `/api/hda/{serial}/snapshot` (routes.py:174)
- `GET` `/api/ui/layout` (routes.py:185)
- `PUT` `/api/ui/layout` (routes.py:192)
- `PUT` `/api/hda/{serial}/snapshot` (routes.py:200)
- `GET` `/api/ui/layouts` (routes.py:217)
- `PUT` `/api/ui/layouts/{name}` (routes.py:223)
- `GET` `/api/ui/layouts/{name}` (routes.py:230)
- `GET` `/api/logs` (routes.py:237)
- `GET` `/api/scenes` (routes.py:248)
- `POST` `/api/scenes` (routes.py:254)
- `POST` `/api/scenes/cleanup` (routes.py:261)
- `POST` `/api/hda/{serial}/scene/save` (routes.py:267)
- `POST` `/api/scenes/open` (routes.py:278)
- `GET` `/api/hda/{serial}/usdz` (routes.py:291)
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
- `cyl1nder_viewport_settings` (mcp_server.py:196)
- `cyl1nder_node_params` (mcp_server.py:214)
- `cyl1nder_read_layout` (mcp_server.py:229)
- `cyl1nder_read_logs` (mcp_server.py:252)
- `cyl1nder_get_errors` (mcp_server.py:258)
- `cyl1nder_get_geometry_summary` (mcp_server.py:264)
- `cyl1nder_index_query` (mcp_server.py:274)

## WS 消息

- server->client: `hello` / `inputs` / `outputs` / `pong`
- client->server: `ping` / `edit`
