# 同步信号重设计：事件驱动 + 心跳解耦 / Event-driven sync & heartbeat decoupling

> 版本 0.1.00056 候选 · 日期 2026-08-12 · 角色：主进程（调研 + 设计 + 契约 + 合并）
> 关联：`streaming-push-dirty.md` §8（/stream 长轮询计划 → 本文落地）、`livelink-roadmap.md`、`sync-architecture.md`（内容对比自愈）、`annotations-bridge.md`

## 一、问题（用户反馈）
- `/pending` 既当数据轮询又当心跳：HDA `_sync_loop` 在活跃窗口（距上次活动 <2s）按 `sync_fps=30` 轮询 → 拖动一下 transform、触发 hda 同步后，心跳随轮询飙到 **~20-30Hz**，即使只动了一下。
- 空闲 500ms 退避 = 2 req/s 仍偏高；高传输时两边 CPU 占用高、快速移动 transform 两边卡顿。
- 用户要求：心跳 **1min 一次即可**；重新设计低开销本地信号传输；研究 LiveLink「互相 kick」与「流启动/终止」方式。

## 二、LiveLink 调研结论（为什么这样设计）
| # | LiveLink 机制 | 对我们的启示 |
|---|---|---|
| 1 | **数据帧即心跳**：MessageBus 正常推帧时不额外发心跳；只有超过 `MessageBusHeartbeatFrequency` 无数据才补心跳 | 高传输**零额外心跳**；静默期低频心跳 → 我们：stream 请求本身兼心跳，hold=60s → 空闲 1 req/min |
| 2 | **超时判定是独立慢时钟**：`MessageBusHeartbeatTimeout`（provider 失联判定）与数据频率无关 | web 离线阈值 = 2.5×心跳 = 150s（原 15s），与轮询频率彻底解耦 |
| 3 | 发现/列表只在**请求时**刷新（`MessageBusPingRequestFrequency`） | 无常驻发现/列表轮询 |
| 4 | 事件推送 + 消费端取最新帧（`LiveLinkCustomTimeStep` 把传输当隐式 FIFO，hitch 时合帧 latest-wins） | 现有 `scheduled` 门控 + `_READY` latest-wins 已符合，保留 |
| 5 | source 生命周期：`ReceiveClient`（连接握手/注册）· `IsSourceStillValid`（健康）· `RequestSourceShutdown`（干净关闭） | stream 连接 touch=注册；循环内 node 存活检查=IsSourceStillValid；node 删除/stop → 干净退出线程（消灭孤儿轮询） |
| 6 | **互相 kick**：客户端订阅 subject（请求数据）↔ provider 推帧 | web→bridge `POST /kick` 一次性 force 保留并升级为**唤醒 stream**（`{type:"kick"}`）；bridge→web WS 广播、HDA→bridge PUT inputs 不变 |

参考：UE Live Link Plugin Development（ILiveLinkSource ReceiveClient / IsSourceStillValid / RequestSourceShutdown）、ULiveLinkSettings（MessageBusHeartbeatFrequency / MessageBusHeartbeatTimeout / MessageBusPingRequestFrequency）、FLiveLinkMessageBusSource、brpc server_push（长轮询 = 最有效的服务端推送）。

## 三、新设计（NDJSON 长轮询 /stream）

### 3.1 bridge 新端点（协议契约，三处同步）
`GET /api/hda/{serial}/stream?since=0&hold=20`（hold 默认 20、上限 60；HDA 用 60）

- 请求到达即 `registry.touch(serial)`（liveness = 心跳；auto-register 语义与 /pending 一致）。
- **立即返回**（任一命中）：
  - `since > rev` → `{"type":"reset","rev":rev}`（桥重启，rev 回退）
  - `rev > since` → `{"type":"outputs","rev":rev}`（有数据）
  - kick 已 armed（`take_kick` 消费，一次性）→ `{"type":"kick","force":true,"rev":rev}`
- 否则 **hold 至 `hold` 秒**：
  - `put_outputs` accepted 或 `kick` armed → 立刻唤醒返回对应事件（~ms 级）
  - 超时 → `{"type":"timeout","rev":rev}`（HDA 收到后立即重连，作为空闲 keep-alive）
- 响应：**NDJSON 单行 JSON**，`Content-Type: application/x-ndjson`。
- 实现：`BridgeState` 加 asyncio.Event waiter 集（`subscribe/unsubscribe/notify`；put_outputs / kick 都在主事件循环内 → 单循环内安全）；`notify_stream(serial)` 在 `routes.put_outputs`、`ws.py` edit 分支、`routes.kick` 之后调用。
- `/pending` **保留**（fallback + 兼容，语义不变）；HDA 主通道改 `/stream`。

### 3.2 HDA 侧（`_stream_loop` 替换 `_sync_loop`）
- `BridgeClient.stream_once(since, hold)`：`urllib.urlopen(timeout=hold+5)` 读一行 NDJSON → dict；**连接错误返回 None**（区别于 timeout 事件）。
- 循环逻辑：
  - `None`（错误）→ `sleep 0.5s` 重连退避；
  - `{"type":"timeout"}` → **立即重连，不 sleep**（空闲 keep-alive）；
  - `{"type":"outputs"|"kick"}` → `_refresh_ready`（后台增量拉 `/outputs?since=<ready rev>`，latest-wins）+ `scheduled` 门控 `_schedule_recook`；`client.last_error` 时 `_PUSH_CACHE.pop`（self-heal 保留）；kick 且 rev 未变也 recook；
  - `{"type":"reset"}` → `_reset_ready` + 全量重拉 + recook；
  - `node_path` 非空且 `hou.node(node_path)` 已不存在 → **干净退出**（RequestSourceShutdown 语义）；`stop` event → 退出。
- 冷启动 `_refresh_ready` 预热保留；`_READY`/`_GEO_CACHE` 语义不变。
- **删除** `_SYNC_IDLE_INTERVAL`/`_SYNC_ACTIVE_AFTER` 自适应常量；`sync_fps` 参数保留但**不再驱动轮询频率**（build_hda.py 参数不变，文档标注「历史参数」）。
- 心跳：stream 请求到达即 touch → 空闲恰好 1 req/min（hold=60）；高传输时事件即心跳（LiveLink 原则）。

### 3.3 web 端（离线判定改慢时钟）
- `web/src/main.ts` watchdog：stale `15s → 150s`；检查间隔 `5000 → 15000` ms。
- `web/src/overview.ts`：`OFFLINE_MS 15_000 → 150_000`。
- `web/src/protocol/types.ts`：新增 `StreamEvent` 镜像（三处同步）。
- `web/e2e/round9-overview.spec.ts`：offline fixture `lastSeen: now - 30` → `now - 300`（150s 阈值下仍判离线）。

## 四、收益预估
| 指标 | 现状（/pending 自适应） | 目标（/stream + 心跳解耦） |
|---|---|---|
| 空闲流量 | ~2 req/s（500ms 退避） | **~1 req/min**（hold=60） |
| 高传输心跳 | 20-30Hz 轮询 = 心跳 | 事件即数据，**零额外心跳** |
| 同步延迟 | 33ms 轮询粒度（+ scheduled 门控） | 事件到达即推（~ms） |
| 线程生命周期 | 无停止路径（孤儿轮询） | node 消失/stop → 干净退出 |
| 动捕密集场景 | 事件率被轮询上限压住 | 事件率 = 实际变化率（稀疏零开销、密集即用即更新） |

## 五、落地分工（并行 agent + 主进程合并）
- **Agent bridge**（写集：`bridge/bridge/state.py`、`bridge/bridge/routes.py`、`bridge/bridge/ws.py`、`bridge/bridge/protocol.py`(仅注释/常量，**不动 VERSION**)、`bridge/tests/test_routes.py`）：/stream + notify + 测试。
- **Agent hda**（写集：`hda/src/cyl1nder_bridge.py`、`hda/src/cyl1nder_hda.py`、`hda/scripts/hython_smoke.py`）：stream_once + _stream_loop + 冒烟改造。
- **Agent web**（写集：`web/src/main.ts`、`web/src/overview.ts`、`web/src/protocol/types.ts`、`web/e2e/round9-overview.spec.ts`）：阈值/镜像/e2e fixture。
- **主进程**：devlog/protocol.md + annotations-* + README「最近版本」+ 版本号 bump（`node scripts/bump-version.mjs build`）+ 合并 review + 全量验证（pytest / tsc / vitest / hython 冒烟 / e2e）。

## 六、验证
- bridge：pytest（stream 立即 outputs / reset / kick 唤醒 / 小 hold 超时 / touch 更新 lastSeen；现有 pending 测试不回归）。
- hda：hython 冒烟（stream 事件 → recook；timeout → 不 recook；kick rev 不变也 recook；错误 → 退避重试；reset → 全量重拉；node 消失 → 线程退出）。
- web：`tsc --noEmit` + vitest + e2e（round9 overview 三态）。
- 跨端：协议三处一致（protocol.py / types.ts / protocol.md）。