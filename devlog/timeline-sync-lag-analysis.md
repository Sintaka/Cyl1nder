# 时间轴同步卡顿分析 / Timeline sync lag analysis

> v0.1.00102+ · 2026-08-14 · 主进程实测 + 代码分析。
> 结论先行：**fxhoudinimcp 本身没问题**（~52ms 单次封送是官方 dispatcher 的固有成本，非故障）；卡顿主要来自我们自己 4Hz 轮询 + 拖拽期全抑制 + 每帧全店刷新三个设计缺陷。修复全部落在 Cyl1nder 侧，不需要动 fxhoudinimcp。

## 1 实测数据（2026-08-14，8100 实例 / 空闲态，40 次采样）

| 路径 | 延迟 | 说明 |
|---|---|---|
| `mcp.execute get_frame`（经 dispatcher） | **avg 52.2ms / p50 52.1 / p95 54.7** | 官方通道，非常稳定 |
| `mcp.health`（不经 dispatcher） | avg 7.9ms | 对照组 |
| dispatcher 封送增量 | **≈44ms/次** | 52 − 8 |
| `set_frame` RPC | ≈78ms | 含写后回读 |
| bridge `GET /timeline`（热缓存） | ≈9ms | 纯内存读取 |

另一次实机观察：Houdini 刚重启、主线程繁忙时，`mcp.execute` 曾出现 **10s 超时**（hdefereval 队列排空前所有 dispatcher 请求都会等待）——这说明**主线程繁忙时请求会排队延迟**，是使用该通道必须接受的特性（任何官方工具都一样，因为所有 hou.* 都必须回主线程）。

## 2 根因判定

### 2.1 fxhoudinimcp 不是元凶（结论）
- 52ms 的来源是 `dispatcher.py` 的固定机制：hwebserver worker 线程 → `hdefereval.executeInMainThreadWithResult`（回 Houdini 主线程执行，约 44ms 封送周期）→ 返回。这是**官方插件保证 hou.* 主线程安全的标准做法**，任何走该通道的调用都有这份固定成本，不是故障、也不可消除。
- 通道吞吐上限 ≈ **1/52ms ≈ 19Hz**；超过这个频率请求会在 hdefereval 队列积压、延迟雪崩（已观察到 10s 超时）。**这是使用约束，不是 bug。**

### 2.2 真正的卡顿根因（三个，都在我们侧）
1. **H→C 更新量化到 4Hz**：web 每 250ms 轮询 `GET /timeline` + bridge 0.25s 缓存 → 帧更新只以 250ms 步进；Houdini 拖 playhead 时 web 时间轴一跳一跳。而 52ms 的通道成本明明支撑 ~15Hz。
2. **每帧全店刷新**：`store.setFrame` 每次都 emit → main.ts 的 flushStoreView 全量重渲（inspector/log/graph 统计/dataflow.flush/markGraphDirty），4Hz 的帧更新每次都拖着整个 UI 重绘一遍，放大了"卡"的体感。
3. **C→H 拖拽期全抑制**：scrub 拖动期间 onFrameCommit 被 dragging 完全抑制，松手才一次性 set_frame → Houdini playhead 落后整个拖拽过程，回显再经 4Hz 通道回来，来回都慢。

### 2.3 附带发现
- 上一轮 Houdini 重启后（pid 48636→77116），`mcp.health` 开始带 `hip_file`（旧实例不带）——安装版本差异，不影响 pid 判据（详见 fxhoudinimcp-compendium.md 实证注记，已更新认知）。
- 基准脚本 `scripts/bench_mcp_latency.py` 留存（用 bridge 自己的 urllib 客户端测延迟；PowerShell `ConvertTo-Json` 序列化 `@()` 是坑，勿用其测 RPC）。

## 3 修复设计（本轮实施，全部遵循 Sync Max FPS）

| # | 修复 | 位置 |
|---|---|---|
| 1 | bridge 常驻轮询器：interval = `max(66ms, 1000/sync_fps)`（≤15Hz 上限防 hdefereval 积压），single-flight（上一轮未完跳过本 tick）、连续失败退避、**10s 无消费者自动停**；帧变化 → WS `{type:"timeline"}` 推送（不再依赖 web 轮询） | houdini_routes.py |
| 2 | C→H 节流提交：scrub 拖动期间按 `max(33ms, 1000/sync_fps)` 节流提交（latest-wins），松手补最终帧；`setDragging` 只抑制回显 | timeline.ts + houdini_routes.py |
| 3 | 远端帧不触发全店刷新：`store.setFrame` 只改值不 emit；时间轴 UI 只读 controller | workspace.ts |
| 4 | web WS timeline 即时应用（session.ts applyTimeline）+ 250ms 轮询降为 1s 兜底（链接探测/WS 断线） | session.ts + main.ts |
| 5 | 所有与 Houdini 的**周期性**交互（get_frame 轮询、set_frame 节流）速率全部由 per-serial Sync Max FPS 派生 | 本轮 bridge/web |

预期：H→C 从 4Hz 步进 → ~15Hz 推送（帧变化才广播），C→H 拖拽实时跟随（≤15Hz 提交），UI 每帧开销只剩时间轴本身。

## 4 边界与后续
- 15Hz 上限是 hdefereval 队列约束（52ms 封送周期），与 sync_fps=60 的设定不冲突（60 是上限，实际轮询被 66ms 地板钳制——文档化于 protocol.md）。
- Houdini 主线程繁忙时（cook/播放/渲染）封送延迟会上升（观察到 10s 级），轮询器 single-flight + 退避已防雪崩；若产品需要忙时也低延迟，只能走"绕开 dispatcher 的进程内回调上报"（HDA cook 主线程直接推 frame 到 bridge）——那是 HDA 侧捎带通道（Phase A 已有 inputs.frame 捎带），可与 MCP 轮询互补（见 tag-hda-project-design.md 的时间轴小节）。
