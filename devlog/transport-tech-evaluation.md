> ⚠️ 状态注记（v0.1.00104）：结论已采纳（WS 主通道 + msgpack，B2 Rust core 未启动）；仅作技术参考。

# 后续数据快速传输技术栈评估：WASM / 串流 / 本地通信

> 日期：2026-08-11 · 状态：调研评估（只读，不改代码）· 关联：`streaming-plan-b.md`（B1/B2）、`livelink-roadmap.md`（延迟路线）、`hda-core-cpp-discussion.md`（native core 形态）、`sync-architecture.md`（内容对比自愈）、`decisions.md`（单桥 8375 / Houdini MCP 铁律）
> 一句话：**B1 继续 JSON + NDJSON 长轮询；B2 让 Rust core 一份代码双端复用（bridge sidecar + web WASM），协议升 `proto:"msgpack"`，压缩按需 zstd/Draco；动捕级大场景再上 WebGPU compute / WASM threads / WebTransport**；明确不做 WebRTC DataChannel、HDA 内引 WS、视频串流。

---

## 0. 结论摘要（先看这张表）

| 技术 | 评估 | 阶段 | 结论 |
|---|---|---|---|
| WebSocket（现状，loopback） | 本地已 0.1~1ms 量级，够用 | 现在 | **保持为主通道** |
| WebTransport（HTTP/3 QUIC） | 多流/不可靠数据报/无队头阻塞；2026 支持未齐（Chrome/Edge ✓，Safari 26.4 才首个稳定，Firefox 实现 draft-15 中） | v0.3+ | **备选**：等跨浏览器齐 + 确认 loopback 收益再上，保留 WS fallback |
| WebRTC DataChannel | 低延迟无序，但要信令 + SCTP；localhost 无 NAT 优势 | 不采用 | **不做**（复杂度不值） |
| MessagePack / CBOR | 比 JSON 快 ~1.5-2x、体积小，心智兼容 JSON | B2 | **推荐**：B2 启用 `proto:"msgpack"`（streaming-plan-b 已预留该字段） |
| FlatBuffers / Cap'n Proto | 零拷贝/最快反序列化，但 schema 编译链重 | B2 后期 | **备选**：极致性能才值得，与「轻量省 token」冲突 |
| zstd（WASM 解码） | 带宽敏感时压缩比高；loopback 带宽非瓶颈 | 按需 | **可选**：大场景/未来远程再启用 |
| Draco / meshoptimizer | 静态网格压缩 60-90%；对动态 delta 不适用 | 按需 | **可选**：仅全量快照通道（首次拓扑/大网格） |
| **WASM（Rust→wasm32）** | 计算热点 85-95% native（AutoCAD Web/Onshape/Google Earth 实测）；**与 bridge sidecar 共享同一 Rust crate = 单实现双端复用** | B2 | **强烈推荐**：diff/序列化/几何处理迁入 |
| WASM threads（SAB+Atomics） | 多点并行；需 COOP/COEP 跨源隔离 | 百万点后 | **按需**（动捕级） |
| WebGPU compute | GPU 并行点处理/变换；three r180 已预留 WebGPURenderer | 动捕级 | **按需**：百万点 60-120Hz 再上 |
| 原生 IPC（Named Pipe / Shared Memory） | μs 级；但 loopback TCP/WS 已毫秒级够用 | B2 可选 | **sidecar 默认 loopback**；延迟敏感再换 Windows 共享内存（前沿，谨慎） |
| 视频串流（WebCodecs/WebRTC 帧） | 只看画面、不可编辑 | 不采用 | **不做**（定位是数据中间站，可编辑可回推） |

---

## 1. 场景与约束回顾

Cyl1nder 三条链路 + 数据特征：

| 链路 | 现状 | 数据方向 |
|---|---|---|
| HDA ⇄ bridge | HTTP 轮询（30fps）/ pending?since；B1 计划 HTTP chunked 长轮询 | HDA 推 4 输入；HDA 拉 outputs |
| bridge ⇄ web | WebSocket JSON（全量 inputs/outputs） | bridge 推；web 编辑回推 |
| web 内部 | three.js 重建几何；rete 图 JSON 契约 | 渲染 + 编辑 |

数据特征：P 位置 float32×3、曲线索引、faces、属性。量级从当前测试的百级点，到**未来动捕 / 发丝 / 程序化预览的万~百万点、60-120Hz**（livelink-roadmap 的动捕场景）。

硬约束（来自 devlog 铁律）：
1. **Houdini 内置 Python 无 WebSocket 依赖**（stdlib 只有 urllib）→ HDA 侧不能引 WS（B1 用 NDJSON 长轮询是对的）。
2. **协议单源** `bridge/bridge/protocol.py` ↔ `web/src/protocol/types.ts` ↔ `devlog/protocol.md`。
3. **轻量省 token**：避免重型 schema/编译链/框架。
4. HDA 薄 Python 壳保持热更新；性能热点下沉 native core（B2 方案 B 已定）。

---

## 2. 候选技术盘点

### 2.1 web⇄bridge 传输层：WS / WebTransport / WebRTC

- **WebSocket（现状）**：本地 loopback 实测与 named pipe 相当（synopse 论坛数据：loopback WS 至少不慢于 named pipe）；单条可靠双向流、有队头阻塞。对 Cyl1nder 毫秒级诉求完全够用。
- **WebTransport（HTTP/3 QUIC）**：多路复用流 + 不可靠数据报 + 无队头阻塞，适合高频金融/云游戏/协同编辑（FOSDEM 2026 定位「下一个 WebSocket」）。但浏览器支持仍不齐：Chrome/Edge 支持；**Safari 26.4（2026-03）才首个稳定版**，Firefox 在实现 draft-15（2026-05 还在改 fetch :protocol）；社区明确建议**2026 全年保留 WebSocket fallback**。且本地 loopback 的延迟优势有限（WS 已毫秒内）。
- **WebRTC DataChannel**：无序/不可靠 + 背压测量是亮点，但需要信令 + SCTP，localhost 无 NAT 穿越价值，复杂度高。社区对比实验（Sh3b0/realtime-web）里 WebTransport 在丢包下比 DataChannel 更稳定。
- **结论**：主通道保持 WS；WebTransport 列为 v0.3+ 备选（等 2026 底浏览器齐），实现时保留 WS fallback，收益点不在延迟而在「不可靠数据报 + 多流」——可用于「最新帧 wins」的动捕级位置流。

### 2.2 传输负载：msgpack / FlatBuffers / zstd / Draco

- **JSON（现状）**：round(6) 紧凑但解析慢、体积大。B1 阶段继续（简单可调试，diff 只传变化）。
- **MessagePack / CBOR**：JSON 心智（有键、无 schema 编译），序列化/反序列化约 1.5-2x 快、体积小 30-50%。**B2 已预留 `proto:"msgpack"` 协商字段**（streaming-plan-b 0.3）→ 直接对齐。
- **FlatBuffers / Cap'n Proto**：反序列化最快、支持零拷贝随机访问；代价是 schema + 代码生成链（Python/Rust/TS 三端各生成一遍），与「轻量省 token + 协议单源手写同步」冲突。B2 后期若证明 msgpack 不够再议。
- **zstd（WASM 解码）**：`structured-zstd` / `zstddec` / `@ioai/wasm-zstd` 等 Rust/C→wasm 流式编解码已成熟；压缩比高、解压快。但 **loopback 带宽不是瓶颈**——只有未来远程/大场景（百万点全量）才值得。
- **Draco / meshoptimizer（WASM）**：静态网格压缩 60-90%（three.js 官方 DracoDecoder 集成成熟）。对「拓扑稳定只更 P 的 delta 流」**不适用**（delta 本来就小）；只用于**全量快照**通道（首次拓扑 / 大网格重传 / 场景归档）。
- **结论**：B2 上 msgpack；zstd/Draco 作为「大负载通道」按需叠加（协议层加 `codec` 字段，如 `{codec:"zstd", proto:"msgpack"}`）。

### 2.3 浏览器内计算：WASM / WASM threads / WebGPU

- **WASM（Rust→wasm32）**：重型 3D 引擎（AutoCAD Web / Onshape / Google Earth）报告**计算热点 85-95% native 性能**（SIMD128 向量化）。对 Cyl1nder 的关键价值不是跑得比 native 快，而是：**B2 的 Rust core（diff / 序列化 / 几何处理）可以一份代码同时编译成 bridge sidecar（native）和 web WASM** —— 单实现、双端复用、行为一致（消除 Python 参考实现 vs native 漂移的 fuzz 对拍负担，M5 的「对拍」直接变成「同一 crate」）。这是本评估里性价比最高的一项。
- **WASM threads（SharedArrayBuffer + Atomics + pthread）**：多点并行；需要 **COOP/COEP 跨源隔离**（本地 vite dev server 要加响应头，mujoco 等项目的 dev server 已这么干）。复杂度中等，**百万点级才值得**。
- **WebGPU compute**：GPU 并行点位置/变换/视锥剔除（cliffy-gpu 几何代数 compute、LiDAR 点云引擎百万点实时）。three r180 已带 `WebGPURenderer` 预留（`RENDER_MODE=webgpu` 可切）。**动捕级（百万点 60-120Hz）再上**，与 WASM 并存：GPU 管大数据并行、WASM 管小数据/协议。
- **结论**：B2 起 Rust core 双端复用（sidecar + wasm）；WebGPU/WASM-threads 留到动捕级，按需加 COOP/COEP。

### 2.4 HDA⇄bridge 本地通信：长轮询 / WS / 原生 IPC

- **现状 + B1**：HTTP 轮询 → chunked 长轮询（NDJSON 行流）。正确：Houdini stdlib 只有 urllib（digitfold 证实 Houdini 默认 Python 无 websocket 模块，需手动装）→ **不要在 HDA 引 WS**。
- **本地延迟量级参考**（nethereum / trading-ipc-bench / datasea 汇总）：HTTP ~3-10ms，loopback TCP/WS ~0.1-1ms，Named Pipe / UDS ~10μs-1ms，共享内存 <10μs。Cyl1nder 的目标是「视口不闪、编辑体感无缝」（毫秒级）→ **loopback TCP/WS 足够，不需要 μs 级 IPC**。
- **B2 native core 形态**：沿用方案 B —— sidecar 独立进程，bridge 托管，默认 **loopback（TCP/WS）**与现有架构一致、可热重启。若未来延迟敏感（动捕级回灌 HDA），可把 **bridge⇄core 之间**换成 Windows Named Shared Memory + Named Events（`winmmf` / `slotbus`，<10μs 唤醒，2026 前沿/实验级，需谨慎验证）；**HDA 侧保持 HTTP 长轮询**（薄 Python 壳不碰共享内存，保持热更新与 stdlib 约束）。
- **结论**：B1 长轮询不变；B2 sidecar 默认 loopback；共享内存是「B2 后期可选优化」，不作为默认。

### 2.5 替代方向：视频串流（WebCodecs / WebRTC 帧）

若诉求退化成「远程看 Houdini 视口画面」而非「拿数据」，可用 WebCodecs + WebRTC/WebTransport 帧串流（云游戏模式，低延迟、任意复杂场景都能看）。但 Cyl1nder 定位是**可编辑、可回推的数据中间站**：视频流不可拾取/不可编辑/不可回推，与产品定位冲突。**不推荐作主方向**，仅作「远程只读预览」的备选（v1 后再说）。

---

## 3. 推荐路线（融入现有 roadmap）

| 阶段 | 传输层 | 负载 | 浏览器计算 | 本地 IPC |
|---|---|---|---|---|
| **B1（现计划）** | web: WS JSON；HDA: HTTP chunked NDJSON | JSON（diff 只传变化） | 无（three.js 重建） | HTTP（不变） |
| **B2（native core）** | 不变 | **msgpack**（`proto` 协商）；大负载可叠 zstd/Draco | **Rust core 双端复用**：bridge sidecar + web wasm（diff/序列化/几何） | sidecar loopback（TCP/WS）；共享内存为可选优化 |
| **v0.3+（动捕级）** | web: 评估 **WebTransport**（等浏览器齐，保 WS fallback）；HDA: 保持长轮询 | msgpack + zstd | **WebGPU compute** + WASM threads（COOP/COEP） | 若需 μs 级：bridge⇄core 换共享内存（前沿） |

**明确不做**：WebRTC DataChannel（复杂度/无 localhost 收益）、HDA 内引 WS 或共享内存（stdlib + 热更新约束）、视频串流主方向（定位不符）。

**三个「值得现在记住」的关键决策**：
1. B2 的 Rust core **crate 结构要预留 `wasm32-unknown-unknown` target**（`#![cfg(target_arch="wasm32")]` 隔离 std 依赖），否则后面想复用 to wasm 要返工。
2. 协议层现在就留 `proto`/`codec` 协商字段（streaming-plan-b 已留 `proto`），**别把 JSON 写死在消息 schema 名里**。
3. 若将来要 WASM threads / SharedArrayBuffer，**vite dev server 与发行版托管都要配 COOP/COEP 头**；现在留一行注释即可。

---

## 4. 风险与注意（对照 streaming-plan-b 第 6 节）

| 风险 | 影响 | 缓解 |
|---|---|---|
| WebTransport 浏览器未齐 | 跨浏览器不可用 | 保持 WS 主通道 + fallback；2026 底再评估 |
| msgpack 三端同步 | 协议漂移 | 铁律 #3：protocol.py / types.ts / protocol.md 同步；`proto` 协商 + 测试夹具双编解码对拍 |
| wasm 与 sidecar 行为漂移 | 隐性错误 | **同一 crate 双端编译** → 天然一致（取代 fuzz 对拍负担）；跨端 CI 跑同一组测试 |
| WASM 线程/WebGPU 的跨源隔离 | SAB 不可用 | COOP/COEP 头（dev + 发行）；不支持时降级单线程 wasm |
| 共享内存实验级 crate | 稳定性/维护 | 默认不用；仅 B2 后期延迟敏感时小范围验证，保留 loopback 回退 |
| 视频串流诱惑 | 偏离定位 | 只在「远程只读预览」需求明确时再评估 |

---

## 5. 参考来源

- WebTransport：MDN WebSockets API（含「WebTransport 预期取代 WebSocket 于许多场景」）；FOSDEM 2026「Intro to WebTransport - the Next WebSocket?」（InfoQ）；Hivebook WebTransport 浏览器现状（Safari 26.4 首个稳定、2026 保 fallback）；caniuse webtransport / HTTP3；whatwg/fetch PR #1930（Firefox draft-15 实现中）
- WebRTC DataChannel vs WebTransport：Sh3b0/realtime-web（丢包对比实验）；ValorZard/datachannel-socket-rs（DataChannel 作为跨浏览器替代方案）
- WASM 性能：alldevtoolshub「WebAssembly in 2026: SIMD, Threads, Wasm 3.0」（AutoCAD Web/Onshape/Google Earth 85-95% native）；WasmGPU（WebGPU×WASM）
- WASM threads / SAB：mujoco PR #3130（dev server 配 COOP/COEP）；Zoom SAB 支持表（Chrome/Edge 92+、Firefox 79+、Safari 15.2+，均需 COOP/COEP）
- WebGPU compute：cliffy-gpu（几何代数 compute + SIMD fallback）；CESCG 2026 WebGPU 点云渲染论文；altersquare「three.js vs WebGPU 2026 大规模 viewer」
- 序列化：shybovycha/webapp-data-serialization-formats-comparison；codelit.io「Data Serialization Formats」（msgpack 1.5-1.8x JSON）；TCC 论文（FlatBuffers 反序列化领先、并发下更佳）
- 压缩：meshoptimizer JS/WASM API；Draco Web 集成（three.js 解码器）；structured-zstd / zstddec（Rust/C zstd→wasm 流式）
- 本地 IPC：nethereum JSON-RPC IPC 延迟（IPC 0.5-2ms vs HTTP 3-10ms）；suenot/trading-ipc-bench（TCP/UDS/ZeroMQ/WS/共享内存/命名管道对比）；synopse 论坛（loopback WS ≈ named pipe）；winmmf / slotbus（Windows 命名共享内存 + Named Events）；subetha（2026-07 共享内存基准，前沿实验级）
- Houdini Python：digitfold（Houdini 默认 Python 无 websocket 模块，需手动装）→ 支撑「HDA 不引 WS」决策

## 6. 本次只读调研，未改代码