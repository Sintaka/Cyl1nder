# fxhoudinimcp 对接：设计与落地 / Houdini MCP Integration

> v0.1.00102 · 2026-08-14 · 主管合并记录（实现由并行子智能体 B/C/D 完成，主管粘合 + 实机验证）。
> 配套：工具速查 `devlog/fxhoudinimcp-tools-index.md`；全命令大全 `devlog/fxhoudinimcp-compendium.md`；协议 `devlog/protocol.md`。

## 0 动机（用户原话摘要）

- 「单靠 HDA 无法在 HDA 未 cook 的时候操控 Houdini」→ 接官方 fxhoudinimcp：大部分 Houdini 界面任务（含时间轴双向同步、Python runtime）经它完成。
- 「HDA 启动时获取 fxhoudinimcp 分配给当前 Houdini 实例的端口号」——8100 是我们的测试实例，8101 是另一个 Houdini，**绝不许碰错实例**。

## 1 架构

```
Houdini 进程（8100 测试实例）
 ├─ hwebserver /api（fxhoudinimcp 插件注册）
 └─ Cyl1nder HDA
      ├─ cook 主线程钩子（10s 节流）── pid=os.getpid() + hip 传入 ──┐
      └─ cyl1nder_houdini_mcp 发现线程（短命 daemon，纯 urllib）◄──┘
               │ 扫 8100..8115 匹配 mcp.health.pid
               ▼ 发现成功 → on_found 回调（同一线程，纯 stdlib）
      BridgeClient.report_houdini_mcp → PUT /api/hda/{serial}/houdini
                    │
bridge（8375）◄────┘ registry.mcpPort（每 serial，持久化）
 ├─ houdini_mcp.py   纯 stdlib HTTP RPC 客户端（rpc/health/discover_*/set_frame/get_frame/execute_python/白名单）
 ├─ houdini_routes.py REST 代理 + 时间轴（GET/PUT /timeline, /hou-timeline, /houdini, /houdini/cmd, /houdini/python）
 └─ /timeline：bridge 内 0.25s 缓存 get_frame；set_frame 0.1s 节流（to_thread，绝不阻塞事件循环）
                    ▲ 250ms 轮询 / PUT frame
web（8376）◄────────┘ timeline.ts（linkEnabled/dragging/applyRemote/onFrameCommit）+ timeline-ui（锚定灯 ●/○）
```

## 2 端口发现（HDA 启动时）

- **唯一可靠判据 = pid 匹配**：HDA 进程就是 Houdini 进程；扫 8100..8115 发 `mcp.health`，`health["pid"] == os.getpid()` 即本实例端口。hip_file 非空时二次比对（防极端情况），任一为空则只靠 pid。
- **实测注记**：安装版 `mcp.health` 直连响应只有 `status/pid/houdini_version`（无 hip_file）——外部 hip 匹配会退化，故 bridge 侧 `discover_by_hip → discover_first` 仅作兜底；registry.mcpPort 由 HDA 上报后即权威。
- 线程安全：发现跑在**短命 daemon 线程**（纯 urllib/json/os，零 hou import——HDA 崩溃红线的直接延续）；cook 主线程只负责传参（`os.getpid()`、`hou.hipFile.name()`）与节流。发现成功即经 `on_found` 回调当场 PUT 上报（不等下一次 cook），失败零影响。
- 上报端点 `PUT /api/hda/{serial}/houdini` 校验 1..65535 并立即落盘 registry（`mcpPort` 为可变字段，register() 重连不清空）。

## 3 时间轴双向同步（经 fxhoudinimcp）

- **C→H（web→Houdini 设帧）**：web scrub/step（`linkEnabled && !dragging` 门控）→ `PUT /timeline {frame}` → bridge `animation.set_frame`（to_thread + 0.1s/串行节流）。HDA 无需 cook、无需参与——这正是「未 cook 也能操控 Houdini」。
- **H→C（Houdini→web 跟随）**：web 每 250ms `GET /timeline` → bridge 对 `animation.get_frame` 做 0.25s 缓存后透传 → `applyRemote`（拖动态忽略；未命中本地帧快照时**不清空几何**，等 inputs 消息带 frame 到达）。
- **HDA 上报通道（预留）**：`PUT /hou-timeline` → WS 广播 `{type:"timeline",…}`；当前 web 以轮询为主，广播供后续消费者。
- 回环抑制：applyRemote 不触发 onFrameCommit；bridge set/get 双节流；web 拖动态双抑制。
- 门控：锚定灯 `linkEnabled = (bridge mcpPort > 0)`；`sync_enabled` 开关仍是几何双向同步门（与时间轴链接独立）；engaged 锚定门控留待 timeline-design.md Phase B。

## 4 Python runtime

- 代理 `POST /api/hda/{serial}/houdini/python` → `code.execute_python {code, return_expression?}`。
- 语义：exec（无顶层 return）→ `return_expression` eval 同一命名空间；stdout/stderr 捕获各 100KB 截断。
- **红线（实机复现）**：HDA cook 主线程同步调 `mcp.execute` 必死锁（dispatcher 需主线程执行而主线程正阻塞在 HTTP 上，直到超时）。因此：HDA 侧只保留 `mcp.health` 探针；`get_frame/set_frame` 在 HDA 模块中仅作后台线程/外部使用并已加死锁警示注释。bridge 是 mcp.execute 的唯一正规调用方。

## 5 安全与白名单

- `houdini_mcp.ALLOWED_COMMAND_PREFIXES`（21 命名空间前缀 + mcp.）；`POST /houdini/cmd` 前缀不过 → 403。
- 白名单内仍避免长阻塞/危险命令（`rendering.start_render`、`scene.new_scene/load_scene`、`workflow.setup_*`、`tops.cook_top_node(block=true)`）——见大全 §7。
- 安装版 fxhoudinimcp 绑 0.0.0.0 无鉴权（dev 版才有 localhost-only）——bridge 只走 127.0.0.1，防火墙/内网隔离责任在使用者。

## 6 崩溃防护（reload HDA）

- 新增模块零长生命周期线程（发现线程短命 daemon + 纯 urllib）；`reload_hda.py` MODULES 已含 `cyl1nder_houdini_mcp`，reload 顺序照旧「先 stop_all_sync 再 reload 再强制 recook」。
- 本轮实机热重载 2 次（8100 实例）均无崩溃；Houdini 存活经 `mcp.health` 复查通过。

## 7 实机验证清单（2026-08-14，8100 实例 / beginTest-1.hip）

| 项 | 结果 |
|---|---|
| bridge pytest | 106 passed（含新增 snapshot restore 7 例 + houdini_mcp 35 例） |
| web tsc / vitest | 0 错误 / 167 passed（timeline 14 例） |
| hython 冒烟 | SMOKE OK |
| HDA 热重载 ×2 | 无崩溃；`known_port()=8100, is_reported()=True` |
| registry.mcpPort | 8100（persist） |
| GET /houdini | alive=true, pid=48636 |
| POST /houdini/python | `hou.frame()*2 → 42` ✓ |
| POST /houdini/cmd | `animation.get_frame → {frame:21, fps:30}` ✓ |
| C→H | PUT /timeline 30 → Houdini playhead 30；复位 21 ✓ |
| H→C | Houdini 设帧 15 → bridge /timeline 0.6s 内跟随 15 ✓ |
| 快照启动恢复 | 真实 serial 桥重启后自动恢复 inputs=4/outputs=4（日志实证） |

## 8 文件清单（本轮写集）

- bridge：`houdini_mcp.py`（新）、`houdini_routes.py`（新）、`registry.py`（mcpPort）、`main.py`（挂载 houdini 路由）、`tests/test_houdini_mcp.py`（新）
- hda：`src/cyl1nder_houdini_mcp.py`（新，纯 stdlib）、`src/cyl1nder_bridge.py`（report_houdini_mcp）、`src/cyl1nder_hda.py`（cook 钩子）、`scripts/reload_hda.py`（MODULES）
- web：`src/bridge/client.ts`、`src/protocol/types.ts`、`src/core/timeline.ts`、`src/app/timeline-ui.ts`、`tests/timeline.test.ts`、`src/main.ts`（粘合：onFrameCommit + 250ms 轮询）
