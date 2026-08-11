# API 索引 / API INDEX

> 机器生成（2026-08-11），由 `node scripts/gen-api-index.mjs` 产出。单源：bridge/bridge/*.py

## REST (127.0.0.1:8375)

- `GET` `/` (routes.py:42)
- `GET` `/api/health` (routes.py:55)
- `GET` `/api/serials` (routes.py:61)
- `GET` `/api/hda/{serial}/status` (routes.py:66)
- `PUT` `/api/hda/{serial}/inputs` (routes.py:78)
- `GET` `/api/hda/{serial}/outputs` (routes.py:96)
- `PUT` `/api/hda/{serial}/outputs` (routes.py:105)
- `GET` `/api/hda/{serial}/pending` (routes.py:123)
- `GET` `/api/hda/{serial}/logs` (routes.py:137)
- `GET` `/api/hda/{serial}/snapshot` (routes.py:147)
- `GET` `/api/ui/layout` (routes.py:158)
- `PUT` `/api/ui/layout` (routes.py:165)
- `PUT` `/api/hda/{serial}/snapshot` (routes.py:173)
- `GET` `/api/ui/layouts` (routes.py:190)
- `PUT` `/api/ui/layouts/{name}` (routes.py:196)
- `GET` `/api/ui/layouts/{name}` (routes.py:203)
- `GET` `/api/logs` (routes.py:210)
- `GET` `/api/scenes` (routes.py:221)
- `POST` `/api/scenes` (routes.py:227)
- `POST` `/api/scenes/cleanup` (routes.py:234)
- `POST` `/api/hda/{serial}/scene/save` (routes.py:240)
- `POST` `/api/scenes/open` (routes.py:251)
- `GET` `/api/hda/{serial}/usdz` (routes.py:264)
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
