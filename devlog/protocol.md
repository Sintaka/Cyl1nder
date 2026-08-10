# Cyl1nder 通信协议 v1

> 本文件是**人读规范**；机器可读单源在 `bridge/bridge/protocol.py`，web 端类型镜像在 `web/src/protocol/types.ts`。
> 任何改动三处同步：protocol.py / types.ts / 本文件。

## 通用
- 桥地址：`http://127.0.0.1:8375`（REST）、`ws://127.0.0.1:8375/ws`（WS）
- 所有 REST 返回 JSON；错误返回 `{"error": "..."}` + 合适状态码。
- serial 格式：`C1-<base36毫秒时间戳>-<4位随机>`（如 `C1-m1abc2d3e-ab12`），小写字母数字。

## 几何信封（v1 JSON）
- inputs: `[{index, name, pointCount, primCount, curves: [{pointIndices, widths?}], points: [[x,y,z],...], attributes: {name: {type, count, values}}}]`
- outputs: `[{index, rev, curves, points, pointCount, primCount, ...}]`（编辑结果，按输出索引独立 rev）

## REST
- `GET  /api/health` -> `{status:"ok", version, serials}`
- `GET  /api/serials` -> `[serial, ...]`
- `GET  /api/hda/{serial}/status` -> registry + workspace 摘要
- `PUT  /api/hda/{serial}/inputs`（HDA 推输入，body = InputPayload[]）
- `GET  /api/hda/{serial}/outputs?since=<rev>`（HDA 拉编辑结果）
- `PUT  /api/hda/{serial}/outputs`（前端推编辑结果，body = OutputBuffer[]）
- `GET  /api/hda/{serial}/logs?level=&limit=`
- `GET  /api/logs?level=&limit=`（全局日志）

## WebSocket `/ws?serial=<serial>`
- 服务端 → 客户端：`{type:"hello", serial, rev}` / `{type:"inputs", inputs}` / `{type:"outputs", outputs}` / `{type:"log", ...}`
- 客户端 → 服务端：`{type:"ping"}` / `{type:"edit", outputs:[...]}`

## MCP（Cyl1nder 桥 MCP，stdio）
`cyl1nder_list_serials / cyl1nder_get_status / cyl1nder_read_logs / cyl1nder_get_errors / cyl1nder_get_geometry_summary / cyl1nder_index_query / cyl1nder_ping`

## faces 字段（v0.1.00023+）
- `InputPayload`/`OutputBuffer` 新增 `faces: list[list[int]]`：闭合 polygon 面的顶点索引（mesh，如 sphere）。
- serializer：闭合 `Polygon`(isClosed=True) → faces；开口 polyline → curves。
- viewport：faces 以 wireframe Mesh 渲染。
