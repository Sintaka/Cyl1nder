> ⚠️ 状态注记（v0.1.00104 归档）：已被 sync-heartbeat-redesign.md 取代（事件驱动 + 心跳解耦）。

# livelink 级同步路线图 / Sync latency roadmap

> 版本 0.1.00004 起。背景：循环修复后 Houdini 视口曾"频闪"，当前同步达不到 livelink 级；未来可能在 Cyl1nder 对接实时动捕，Houdini 侧程序化 biped retargeting 预览。趁架构还能改，先记录延迟预算与升级路径。

## 一、现状延迟预算（本地）
| 环节 | 成本/粒度 |
|---|---|
| Houdini ↔ 桥 HTTP（单次 GET/PUT） | ~1-5ms（本地） |
| 桥 → web WebSocket 推送 | ~1ms |
| HDA 同步轮询 | 33ms 粒度（sync_fps=30） |
| HDA recook | 全量 clear+rebuild 几何（主要卡点）+ 主线程内做网络+序列化 |
| Houdini 视口重绘 | 几何重建后必然重绘 → 视觉频闪 |

## 二、瓶颈（不是 Python 本身）
- 本地 Python 单次 HTTP 是毫秒级，**不是瓶颈**。
- 真正卡点：
  1. **全量重建**：每次同步 clear+重建 points/prims → 视口闪、更新量大。livelink 是"拓扑不变、只更新 P 位置/变换"。
  2. **cook 内同步**：python SOP 主线程里做 HTTP 拉取 + 全量序列化，与渲染/交互争主线程。
  3. **轮询粒度**：30fps 轮询有 ~33ms 粒度；livelink 是事件推送（一改即推）。
  4. **协议**：JSON 全量传几何，大场景带宽/解析开销。

## 三、升级路径（趁早改，按优先级）
- **A. Houdini↔桥改 WebSocket 长连接**（替代逐次 HTTP）：持久双向，无握手；桥一有更新即推"信号"，HDA 只做轻量消费。把 33ms 轮询粒度降到事件级（轮询降为兜底）。
- **B. 位置流式更新（livelink 式，最关键）**：首次 cook 建立稳定拓扑（points/prims），后续同步**只改点位置**（`setPosition`），不清空重建 → 视口不闪、更新量小、延迟体感近无缝。
- **C. 同步移出 cook 主线程**：后台线程负责"拉取+反序列化"到就绪缓冲，cook 只消费（减少 cook 阻塞）。
- **D. 增量/二进制协议**：只传变化曲线/点；msgpack/flatbuffer 替代 JSON（动捕高频场景必做）。
- **E. 频率自适应**：mocap 60/120fps，日常 30fps（现有 sync_fps 参数化，可直接升）。

## 四、推荐落地
- v0.2：先做 **B（位置流式）**——收益最大（消频闪），改动集中在 HDA `_build_detail`/cook：首次建拓扑、之后只更 P；桥/协议基本不动。
- v0.3：A（Houdini↔桥 WS）+ C（后台线程）。
- v0.4：D（增量/二进制）用于动捕。
- 结论：**当前 Python 架构可保留**；livelink 级的关键是"事件推送 + 位置流式更新"，不是换语言。