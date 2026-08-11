# 方案B落地设计：流式传输 + 本地原生 core（streaming-plan-b）

> 状态：**设计定稿（决策完备）** —— 实现者按本文执行，不需要再做架构决策；个别标有「实现时确认」的仅限接口细节核对。
> 落地现状（2026-08-11）：**设计已定稿，但尚未开始实现**——M1–M6 均未落地，三端源码无 stream/topoId/diff/ring/chunked 实现（详见 `streaming-hda-review.md`，只读调研）。
> 关联文档：`hda-core-cpp-discussion.md`（方案讨论）、`livelink-roadmap.md`（延迟路线）、`sync-architecture.md`（脏几何/内容对比教训）、`protocol.md`（协议 v1）、`decisions.md`（铁律）、`hda-hot-reload.md`（热重载）。
> 一句话：HDA 保持薄 Python 壳；新增「快照 + 位置增量」流式协议；先纯 Python 打通三端（B1），再把 diff / 序列化 / 流式热点迁入本地原生 sidecar 进程（B2）。

## 0. 决策摘要（先看这张表）

| # | 问题 | 决策 |
|---|---|---|
| 0.1 | 流式协议核心模型 | 「快照 snapshot + 增量 delta」；拓扑不变时只传 P 位置 / 变换，任何拓扑变化都退化为整体快照 |
| 0.2 | 增量 diff 由谁算 | 生产者（bridge workspace 在 `put_outputs` / WS `edit` 时）对比新旧 buffer 产出 diff；B1 纯 Python，B2 迁入 native core，diff 决策规则完全一致（见 1.2） |
| 0.3 | v1 编码 | **JSON**（WS 文本帧 / NDJSON 长轮询）；msgpack 作为 B2 预留（`proto` 协商字段先入 schema）；flatbuffer 不采用（理由见 1.3） |
| 0.4 | 何时从 delta 退化为 snapshot | 拓扑变化（点数/prim/曲线/属性结构）、宽度或任何非 P 属性值变化、变化点占比 ≥ 50%、buffer 携带 `transform` 之外无法表达的变更 |
| 0.5 | 传输通道 | web↔bridge：继续 WS（新增 `snapshot`/`delta` 消息）；HDA↔bridge：新增 **HTTP chunked 长轮询** `GET /api/hda/{serial}/stream?from=&hold=`（NDJSON 行流），HDA 用 stdlib urllib 增量读行，**零新依赖** |
| 0.6 | 可靠性 / 自愈 | per-serial 单调 `streamRev` + 环形重放缓冲（512 条）+ `GET /stream?from=` 重放；`topoId` 失配或应用异常 → 全量对账；周期 5s 内容对比自愈（沿用 sync-architecture「决策一律基于内容」铁律） |
| 0.7 | 本地原生 core 形态 | **就近 sidecar 独立进程**：bridge 拉起/托管/重启，私有端口 127.0.0.1:8377，仅 bridge 可达；**不采用** DLL+ctypes 进 Houdini、**不采用** 同进程 pyd |
| 0.8 | core 语言与构建 | Rust（stable，`Cargo.toml` 锁 MSRV）；仅当团队强制 C++ 时切换（触发条件见 2.3），协议不变 |
| 0.9 | 线程模型 | core 内部：1 个 I/O 线程 + N 个工作线程（默认 `min(4, 核数)`）；bridge 侧：读线程 → `asyncio.Queue` → 事件循环发布，FastAPI 主循环绝不阻塞 |
| 0.10 | HDA 消费方式 | 后台消费线程（长轮询 /stream）写「就绪缓冲」，cook 主线程只取就绪数据并应用；latest-wins 合并；首次快照建拓扑，后续只 `setPosition`/应用变换 |
| 0.11 | compute/ 接入点 | 保留 `register_executor`；新增 `backend` 元数据（`"python"|"sidecar"|"dll"`）与 `NativeSidecarExecutor`；Python 面接口签名不变 |
| 0.12 | fallback | native 不可用/超时 → 同名 Python executor → `passthrough`；cook 永不因 core 失败而断流 |
| 0.13 | 实施顺序 | **B1**（纯 Python 位置流式，三端热更新验证）→ **B2**（native core 迁移，协议不变、只换实现）→ 发行打包 = bridge + core + Vite dist + 薄壳 HDA |

## 1. 流式传输协议设计

### 1.1 核心模型：快照 + 增量（拓扑稳定，只更 P/变换）

现状问题（livelink-roadmap）：每次同步 `geo.clear() + _build_detail()` 全量重建 → 视口频闪、更新量大。修复方向：**拓扑只建立一次，之后只更新点位置或整体变换**。

协议按「拓扑稳定性」把消息分成两类：

- **snapshot（快照）**：携带完整几何（points + curves + attributes + 元信息）。用于：拓扑建立、拓扑变化、重放、重连、自愈对账。消费者看到后整体重建该输出。
- **delta（增量）**：只携带 `transform`（整体变换，16 个 float 行主序 4x4）和/或 `positions`（稀疏点位置更新 `[{i, p:[x,y,z]}]`）。消费者仅在**已应用过同 `topoId` 的快照**时应用；否则请求重放。

不变量（写入实现）：

1. 同一输出的 `topoId` 不变 ⇔ 拓扑结构（点数、prim 数、曲线结构、属性结构、宽度）不变。**任何拓扑变化 → 必须发 snapshot，绝不用 delta 表达**。
2. v1 delta 的变更域 = **仅 P 位置与整体变换**。宽度/颜色/uv 等属性变化 → snapshot（v1 边界，B2 后再扩展属性增量）。
3. 消费者永远可以安全忽略 delta：丢帧/失配时走 `GET /stream?from=` 或周期对账重建，内容最终一致（与 sync-architecture 原则一致：rev/topoId 只是顺序提示，正确性靠内容对账兜底）。

**输出缓冲区新增字段**（`OutputBuffer`，见 1.4）：

- `topoId: int`：该输出的拓扑版本（bridge 维护，单调递增，0=从未建过）。
- `transform: number[16] | null`：可选整体变换。web 编辑器显式给出时，bridge 产 delta 传变换而不传点；无变换则不传。

### 1.2 增量 diff 规则（生产者侧，决策完备）

diff 在 **bridge workspace**（`bridge/bridge/workspace.py`）的 `put_outputs` 内完成（B1 纯 Python，B2 调 core 同规则实现）。对每个输出 index，比较「已存 buffer（prev）」与「新 buffer（new）」：

```
diff_output(prev, new):
  if prev is None 或 topology_changed(prev, new):
      topoId[new.index] += 1
      return Snapshot(index, topoId, rev, new)
  changed = changed_indices(prev.points, new.points)   # 按 round(x,6) 逐点比较
  if len(changed) == 0: return None                    # 内容相同 → 不产出（echo 去重已有）
  if len(changed) >= len(new.points) * DELTA_DENSE_RATIO:
      topoId[new.index] += 1                           # 稠密更新 → 退化快照（同时 bump topoId 保证一致性）
      return Snapshot(index, topoId, rev, new)
  return Delta(index, topoId(不变), rev,
               transform = new.transform if new.transform 且 未逐点变化 else None,
               positions = [{i, p} for i in changed])
```

规则定死：

- `topology_changed(prev, new)`：`pointCount`、`primCount`、`curves`（pointIndices 与 widths 结构）、`attributes`（name/type/count 集合）任一不同 → True。宽度**值**变化也算拓扑变化（v1 简化，见 1.1）。
- 位置比较精度：`round(v, 6)`，与现有 `_same_as_buffer` / `serialize_input` 完全一致，避免「桥认为没变、HDA 认为变了」的乒乓。
- `DELTA_DENSE_RATIO = 0.5`：变化点 ≥ 半数 → 直接快照（稀疏索引开销不划算）。
- 携带 `transform` 的 buffer：若拓扑未变，delta 只带 `transform`（不逐点算）；若同时有点级编辑，则 `transform` + `positions` 并存（先应用变换再叠加点位，语义为 `P' = M * P0`，`positions` 里的 p 为变换后绝对坐标，直接覆盖）。
- diff 只在「内容确有变化」时产出（复用现有 `_same_content` echo 去重逻辑，不 bump rev 就不产消息）。

### 1.3 编码取舍：JSON vs msgpack vs flatbuffer，v1 选择

| 维度 | JSON（v1 选择） | msgpack | flatbuffer/protobuf |
|---|---|---|---|
| 可调试性 | 直接肉眼读、curl 可查 | 需工具解码 | 需 codegen + 工具 |
| 依赖/构建 | 无新依赖（现有栈） | Python `msgpack` + TS `@msgpack/msgpack`，轻量 | codegen 步骤 + 双端代码生成，构建链变重 |
| 体积 | 基准（float 数组 ~2-3x 二进制） | 比 JSON 小 ~30-50% | 最小、可零拷贝 |
| 解析开销 | 本地毫秒级，够用 | 更低 | 最低（mmap/零拷贝） |
| 热更新友好 | 是（无编译步骤） | 是 | 否（改 schema 要重编译两端） |
| 适合阶段 | B1 全部 + B2 wire 层兼容 | B2 后期优化 | 不采用 |

**决策**：

- **v1（B1）= JSON**。理由：本地环回链路本身 <1ms，瓶颈是全量重建而非解析（hda-core-cpp-discussion 已论证）；JSON 让三端热更新零摩擦，且与现有 protocol.py / types.ts 镜像体系无缝。
- **B2 预留 msgpack**：envelope 增加 `proto: "json" | "msgpack"` 字段（v1 恒为 `"json"`）；WS 二进制帧、REST stream 的 `Content-Type: application/msgpack` 在 B2 按需启用；两端在 `hello` 里协商（client 声明支持列表，server 选第一个）。**协议是增量式的：新增编码 ≠ 改 schema**。
- **flatbuffer 不采用**：本地单机场景收益不足以覆盖 codegen 摩擦；若未来真实动捕 >120Hz 全场景且基准证明 msgpack 不够，再单独出设计（触发条件写明，不阻塞当前路线）。

### 1.4 消息 schema（决策完备）

统一信封（所有流消息，JSON v1）：

```
{
  "v": 1,                    // 协议版本
  "proto": "json",           // 本帧编码（B2 可 "msgpack"）
  "type": "hello"|"snapshot"|"delta"|"ack"|"close",
  "serial": "C1-...",        // 必填
  "streamRev": 42,           // per-serial 全局单调序号（bridge 分配）
  "ts": 1754300000000,       // 生产者墙钟 ms（诊断用）
  "payload": { ... }          // 按 type
}
```

- `hello`（server→client，连接建立时）：`{serial, proto:"json", streamRev, outputs:[{index, topoId, rev, pointCount, primCount}]}`
- `snapshot` payload：`{index, topoId, rev, pointCount, primCount, points:[[x,y,z],...], curves:[{pointIndices, widths?}], attributes:{name:{type,count,values}}, transform?: [16] | null}` —— 等价于 OutputBuffer + topoId。
- `delta` payload：`{index, topoId, rev, transform?: [16] | null, positions?: [{i:int, p:[x,y,z]}]}`；`topoId` 必须等于消费者已应用的该输出 topoId。
- `ack`（client→server，可选）：`{index, topoId, streamRev, ok:true|false, reason?}`。v1 不依赖 ack（可靠性走重放/对账），仅诊断；B2 可开启。
- `close`：服务端关闭流（如 serial 失效）。

REST 新增/修改（HDA 通道）：

- `GET /api/hda/{serial}/stream?from=<streamRev>&hold=<sec>` → **NDJSON 行流**（`application/x-ndjson`）：
  - `from=0` 或 `from` 早于环形缓冲最旧条目 → 先发当前所有输出的 snapshot（重放），再发 ring 中 `streamRev > from` 的后续消息。
  - 有数据立即推；无数据 hold（默认 15s）后以 `# keepalive` 注释行续命（客户端忽略注释行），连接不断。
  - `hold` 上限 30s；客户端 socket 超时设 35s。
- `GET /api/hda/{serial}/outputs?since=` / `PUT /api/hda/{serial}/outputs` / `GET /api/hda/{serial}/pending`：**保持原样**（B1 兼容 + fallback 路径）。
- WS（web 通道）：server→client 新增 `snapshot` / `delta`（同上信封）；保留现有 `inputs` / `outputs` 消息至 B1 结束（`outputs` 在 B1 期间等价于发 snapshot，web 渐进迁移）；client→server `edit` 不变（仍推完整 OutputBuffer，diff 由 bridge 做）。

**流状态存储**（bridge workspace 新增）：

- `stream_rev: int`：per-serial 全局单调，每次产消息 +1。
- `stream_ring: deque[tuple[int, dict]]`：`maxlen = STREAM_RING = 512`，存 `(streamRev, message)`，供重放。
- `topo_ids: dict[int, int]`：per output index 的拓扑版本，随 snapshot 递增。

### 1.5 传输通道决策（谁走 WS、谁走长轮询）

- **web↔bridge = WS**（现状 `ws://127.0.0.1:8375/ws?serial=`，`web/src/bridge/client.ts` 已有自动重连）。新增消息类型即可，前端改动最小。
- **HDA↔bridge = HTTP chunked 长轮询（NDJSON）**，而非 HDA 直接连 WS。理由：
  1. HDA 运行在 Houdini 内置 Python（当前只用 stdlib urllib），直接 WS 需要引入 `websocket-client`/`websockets` 依赖，违背「HDA 薄壳零新依赖、免重启热更新」。
  2. `urllib.request.urlopen` 返回的 `HTTPResponse` 对 chunked 响应支持增量 `readline()`/`read(n)`，纯 stdlib 即可实现推送式消费（不是 33ms 轮询粒度：bridge 有数据就写，最长 hold=15s 一个请求周期内即时到达）。
  3. livelink-roadmap 的「事件级」目标靠长轮询已达到（延迟 ~5ms 级，见 3.4）；B2 若需再降，再给 HDA 侧加原生 WS 客户端（协议不变，仅换传输）。
- bridge 是唯一对外面（8375），HDA 与 web 都不直连 core（见 2.2）。

### 1.6 可靠性 / 自愈（不违反 sync-architecture 铁律）

1. **顺序**：`streamRev` per-serial 单调；消费者记录已消费 `streamRev`，断线重连带 `from=` 续传；`from` 太旧（早于 ring 最旧）→ 全量重放。
2. **topoId 校验**：HDA 应用 delta 前校验「已应用 topoId == delta.topoId」，不等 → 丢弃该 delta，走 `GET /stream?from=0`（或 REST pull）重建该输出。
3. **周期内容对账**：HDA 每 `SELF_HEAL_SEC=5s`（流空闲时）对每个角色做一次 `_same_as_buffer` 内容对比（现有函数，纯 Python，便宜）；不一致 → 整体重建。这是兜底正确性，rev/topoId 只作提示（sync-architecture 铁律 #1）。
4. **bridge 重启**：workspace 内存态归零 → `stream_rev` 从 0 重新开始；HDA 检测到 `streamRev` 倒退（新 hello 的 streamRev < 已消费值）→ 视为 reset，`from=0` 全量重放（现有 `/pending` reset 语义同款）。
5. **echo 去重不变**：`_same_content` 仍拦截「内容相同」的写入，不 bump rev 不产消息，反馈回路不复活。

### 1.7 与现有协议/代码的兼容与迁移

- 兼容：`OutputBuffer` **新增可选字段** `topoId`、`transform`（缺省为 0/null），旧端忽略即可；所有旧 REST/WS 端点保留至 B1 完成。
- 单源同步义务（铁律 #3）：改动同步 `bridge/bridge/protocol.py` / `web/src/protocol/types.ts` / `devlog/protocol.md`。
- B1 结束时的清理清单：web 端 `outputs` WS 消息消费迁移到 `snapshot`/`delta` 后，`outputs` 保留（编辑器推 `edit` 仍用 OutputBuffer 全量，bridge diff），WS `outputs` 广播可退役（见 5.1 M3）。

## 2. 本地原生 core 形态

### 2.1 决策：就近 sidecar 独立进程（非 DLL、非同进程）

| 选项 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 独立进程（本地服务，自行常驻） | 崩溃隔离；可独立重启 | 生命周期/端口管理；多一个公共面 | 次选（违背「单桥 8375 唯一对外」铁律） |
| **就近 sidecar（bridge 拉起的私有子进程）** | 崩溃隔离；热更新 = 重启子进程；无公共端口；bridge 统一托管 | bridge 负责拉起/健康检查（实现成本可控） | **推荐（0.7）** |
| DLL + ctypes 进 Houdini | 无进程边界、调用开销最小 | Houdini 锁 DLL（HDK 老痛）；原生崩溃直接带崩 Houdini；无法独立热更新 | 不采用（v1/B2 默认） |
| pyd 进 bridge 进程 | 免子进程 | 同进程崩溃互炸；Windows 锁文件难热更新 | 不采用 |
| 同进程（Rust 编译成 pyd 由 bridge import） | 调用近 | 见上；bridge 重启才热更新 | 不采用 |

理由：native core 承载「解析不可信几何 + 高频 diff/编码」，**崩溃隔离是硬需求**——任何原生段错误都不能波及 bridge（REST/WS）或 Houdini。独立子进程配合「bridge 拉起 + 心跳 + 退避重启 + fallback 到 Python」，等于把「可热更新、可一键重启」贯彻到后端（hda-core-cpp-discussion 方案 B 的核心卖点）。

### 2.2 与 bridge 的关系

- **架构**：`HDA --HTTP/长轮询--> bridge(8375) <--WS--> web`，`bridge <--私有 TCP/msgpack--> core(127.0.0.1:8377)`。
- core 不是公共服务：只监听 `127.0.0.1:8377`（env `CYL1NDER_CORE_PORT` 可覆盖），**仅 bridge 连接**；不注册到任何发现机制；对外 REST/WS 面保持 8375 单桥不变（decisions.md 铁律）。
- bridge 是 core 的唯一客户端 + 生命周期 owner：启动时按 `CYL1NDER_CORE_BIN`（默认 `<repo>/native/target/release/cyl1nder-core.exe`，发行版为 `<dist>/bin/cyl1nder-core.exe`）拉起；5s 心跳 `ping`；失败按指数退避重启（1s→2s→…→30s 封顶）；core 退出不影响 bridge 主服务（fallback 见 4.4）。
- HDA/web 感知不到 core 存在：core 只是「bridge 内部的性能实现细节」。

### 2.3 语言与构建（Rust，含切换条件）

- **决策：Rust（stable，`edition = "2021"`，Cargo.toml 锁定 MSRV 1.75+）**。理由：无 GC 可预测延迟、内存安全（解析不可信几何的默认安全）、单静态二进制便于分发、`tokio`+`rmp-serde` 生态成熟；与 hda-core-cpp-discussion 的「C++/Rust 进程」表述兼容。
- **切换条件（仅当同时满足才改用 C++20/CMake+MSVC）**：团队无 Rust 工具链且拒绝引入，且有现成 C++ 构建流水线。切换只影响 `native/` 内部实现，协议/接口不变（ABI 见 2.4/4.3）。
- 目录：新增仓库顶层 `native/`（`Cargo.toml`、`src/main.rs`、`src/ipc.rs`、`src/geom.rs`、`src/stream.rs`、`src/exec.rs`、`tests/`）。
- 构建产物：`native/target/release/cyl1nder-core.exe`；发行目录 `<dist>/bin/`。

### 2.4 线程模型（决策完备）

**core 内部**：

- 1 个 I/O 线程（tokio 单线程 runtime 即可）持有 8377 监听 socket，负责帧收发与请求分发（`id` 关联 request/response）。
- N 个工作线程池（默认 `min(4, 可用核数)`，env `CYL1NDER_CORE_WORKERS` 覆盖）执行 `compute` / `stream_diff` / `encode` / `decode`；结果按 `id` 回写对应 socket 连接。
- 流发布（snapshot/delta 编码）在 work pool 内完成，把「产消息」做成 `op: "stream_diff"` 的返回值，由 bridge 侧负责真正广播——core 不持有任何 WS 连接，避免双端状态机。

**bridge 侧**：

- FastAPI 事件循环（uvicorn）继续服务 REST/WS；`put_outputs` / WS `edit` 处理函数把 diff 请求**同步转发给 core 客户端**（`SidecarClient`，带 `asyncio.Lock` 串行化 per-serial diff，超时 1000ms）。
- `SidecarClient` 内部：后台读线程（或 asyncio 读任务）把 core 响应放入 `asyncio.Queue`；bridge 的 WS 发布器是独立 asyncio task，从 queue 取消息广播给对应 serial 的 WS 连接与 stream 长轮询挂起者。
- **约束**：任何 core 调用都带超时；core 慢/挂 → bridge 走 Python fallback，绝不阻塞事件循环（不 await 无限）。

### 2.5 生命周期与热更新

- 启动：bridge 启动 → 探测 `CYL1NDER_CORE_BIN` → 拉起子进程 → `hello` 握手 → 就绪；core 缺省时 bridge 以纯 Python 模式运行（log warning，一切照常）。
- 热更新：替换 `cyl1nder-core.exe` 后，bridge 检测到 core 版本变化或手动触发（shelf 一键「重启后端」）→ 优雅停旧 core（`close` op）→ 拉起新 core；HDA/Web 无感（bridge 面不变）。
- 关停：bridge 退出 → 终止子进程（job object / 显式 `close`）；孤儿 core 由心跳超时自退。

## 3. HDA 薄壳如何消费流

### 3.1 架构：后台消费线程 + 就绪缓冲（cook 永不阻塞）

新增 `hda/src/cyl1nder_stream.py`（纯 stdlib，可 hython 冒烟）：

- `StreamState`（per serial）：`{roles: {0..3: RoleReady}, lock, thread, stop, last_stream_rev, connected}`。
- `RoleReady`：`{topoId, points, curves, widths, attrs, rev, dirty: bool, updated_ts}`。
- `ensure_stream(root, serial, bridge_url)`：幂等启动后台线程（daemon）。
- 后台线程循环：
  1. `urlopen(GET /api/hda/{serial}/stream?from=<last_stream_rev>&hold=15, timeout=35)`；
  2. `for line in resp`：跳过 `# keepalive`/空行；解析信封；`snapshot` → 整体覆盖 RoleReady（含拓扑）；`delta` → 校验 topoId，通过则把 `positions` 合并进 `points`、有 `transform` 则先整体变换，置 `dirty=True`；`hello` → 若 `streamRev` 倒退则 `last_stream_rev=0`（reset）；
  3. 更新 `last_stream_rev`；连接异常 → `connected=False`，sleep 1s 重试（指数 1s→5s 封顶）。
- 该线程**永不触碰 `hou`**：只维护纯 Python 数据。这是「cook 主线程不阻塞」的前提（livelink-roadmap C 项落地）。

### 3.2 cook 快速路径（拓扑首次建立、后续只更 P）

`cyl1nder_hda.cook(role)` 主线程逻辑改为：

```
1. bridge 健康/拉起（现状 _ensure_bridge）
2. 尝试流路径：
   if _STREAM 已连接 且 role 有就绪数据:
       with lock: 取 RoleReady（最新一份，latest-wins）
       if ready.topoId != applied_topoId[role]:   # 拓扑首次建立/变化
           geo.clear(); _build_detail(geo, ready); applied_topoId[role]=ready.topoId
           applied_points[role] = deepcopy(ready.points)
       else:                                       # 拓扑不变，只更 P
           for i,p in diff_indices(applied_points[role], ready.points):
               geo.points()[i].setPosition(hou.Vector3(p))
           # 批量优化：Houdini H20+ 有 geo.setPointPositions(...) 则整批调用（实现时确认 API 名）
           applied_points[role] = deepcopy(ready.points)
       dirty=False
       return
3. fallback（流未连接/无就绪）：现状 REST pull + _same_as_buffer 内容对比重建（原逻辑原样保留）
4. 周期自愈（见 3.4）
```

要点：

- **不做 `geo.clear()`**（除非 topoId 变化），Force Cook / 陈旧 recook 不再闪（现状「保留几何」策略延续）。
- 只对**变化的索引** `setPosition`：delta 是稀疏的，更新量 = 变化点数，10k 点场景单次增量应用 <2ms（见 3.4 预算）。
- 就绪缓冲是**最新一份**（后台线程合并中间 delta，latest-wins）：cook 比帧率慢时自动丢中间帧，视口永远追最新，不积压。
- `applied_points` 是应用过的点快照，用于与下一条就绪数据做差（只更变化的点）。

### 3.3 变换（transform）应用

- delta 带 `transform`（无 positions）：对全部点 `P' = M * P`（逐点 `setPosition`，或 H20+ 批量）；`applied_points` 同步更新。O(N) 但无拓扑变化、无重建，视口不闪。
- delta 同时带 `transform` + `positions`：先整体变换，再按 positions 覆盖（语义见 1.2）。
- 兜底：若 Houdini 侧不想逐点乘，可把变换放到 cook 后的 transform 节点——但决策**在 Python 壳内直接物化坐标**（保持 HDA 输出 = 绝对坐标，下游零改动，与 web 端 shader 应用矩阵的方案区分开：web 用 matrix 更新，HDA 用物化坐标）。

### 3.4 延迟预算（目标值，B1 验收对照）

| 环节 | 预算 |
|---|---|
| web 编辑 → bridge 收（WS） | ~1ms |
| bridge diff（B1 Python，10k 点） | <3ms（B2 core <0.5ms） |
| bridge → HDA 推送（长轮询 hold 内即时写） | ~1-5ms |
| HDA 后台线程反序列化 + 合并 | <2ms |
| HDA cook 增量应用（变化 100 点） | <2ms |
| 端到端（编辑→视口） | <15ms（B1），目标 <10ms（B2） |

### 3.5 模块接口（实现清单）

- `hda/src/cyl1nder_stream.py`：`ensure_stream / stop_stream / apply_ready(geo, role) -> bool / self_heal(geo, role) -> bool`。
- `cyl1nder_hda.cook()`：按 3.2 改；`_SYNC` 轮询保留为 fallback（`sync_fps` 语义变为「fallback 轮询频率 + 增量应用上限，默认 30，mocap 可 60/120」）。
- 热更新：全部在 `hda/src/*.py`，`reload_hda.py` 免重启（无需重建 HDA）。

## 4. compute/ 注册表作为原生执行器接入点

### 4.1 现状与目标

现状：`bridge/bridge/compute/__init__.py` 已有 `ComputeExecutor` Protocol（`name` / `run(ctx, inputs)->outputs`）、`register_executor`、`run_node`，内置 `passthrough` 与 `ctypes_stub`（native_demo，预留 DLL 接口，v1 未真正调用）。目标：把注册表变成 **native 执行器的正式接入点**，同时保持 Python 面接口不变（测试/调用方零改动）。

### 4.2 注册方式与接口签名（决策）

```python
# compute/__init__.py 扩展（B2 落地，B1 只加 backend 元数据）
class ComputeExecutor(Protocol):
    name: str
    backend: str = "python"          # "python" | "sidecar" | "dll"
    def run(self, ctx: ComputeContext, inputs: list[InputPayload]) -> list[OutputBuffer]: ...

def register_executor(executor: ComputeExecutor) -> None: ...   # 不变，仍按 name 注册
def resolve(node_type: str) -> tuple[ComputeExecutor, str] | None: ...  # (executor, backend)
def run_node(node_type, ctx, inputs, prefer: str = "native") -> list[OutputBuffer]: ...
```

- 一个 name 只允许一个注册（现状）；native 与 python 同名的场景，通过 `backend` 区分——**决策：同一 name 下 native 优先，python 同名作为 fallback**（见 4.4）。
- `ComputeContext` 保持 `{serial, nodePath, params}`；B2 如需透传流上下文再扩展（实现时确认，不影响签名形状）。

### 4.3 原生 ABI（sidecar 为主，DLL 为参考）

**Sidecar（默认，B2）**：私有 TCP 127.0.0.1:8377，长度前缀 + msgpack 帧：

```
request  = {"id": int, "op": "compute"|"stream_diff"|"encode"|"decode"|"ping"|"close",
            "node_type": str,                 # op=compute
            "ctx": {"serial": str, "nodePath": str, "params": {...}},
            "inputs": [ {index, pointCount, primCount,
                         points: {"type":"f64","count":3N,"values":[...]},   # 扁平 float 数组
                         curves: [{pointIndices:[...], widths:[...]|None}],
                         attributes: {...}} ]}
response = {"id": int, "ok": bool, "error": str|None,
            "outputs": [OutputBuffer 同构扁平化],      # op=compute
            "message": {信封…} 或 "messages": [...],    # op=stream_diff
            ...}
```

**DLL（参考，非默认）**：沿用 `ctypes_stub` 预留的 ABI 并升级为 msgpack：

```
int cyl1nder_process(const uint8_t* in, size_t in_len, uint8_t** out, size_t* out_len);
void cyl1nder_free(uint8_t* out);
```

B2 只实现 sidecar；DLL 路径仅在「不能起子进程」的环境（若出现）再补，不阻塞。

### 4.4 fallback 链（决策）

```
run_node(node_type, ctx, inputs, prefer="native"):
  1. native 优先：注册表中 backend=="sidecar" 且 core 健康 → 调 core（超时 1000ms）
  2. 失败（core 崩/超时/错）→ log warning → 同名 python executor（若有）→ run
  3. 都失败/不存在 → log error → passthrough（每输出 index 直通）→ 返回
  4. 任何路径都不抛到调用方；cook 永不因 compute 失败中断
```

- 与现有 `ctypes_stub`「没有 DLL 就降级 passthrough」哲学一致，pipeline 永不破。
- `list_executors()` 返回 `["name@backend", ...]`；`/api/health` 增加 `core: "native"|"python"|"down"` 字段，MCP 可查询，便于诊断 fallback 是否频繁触发。

### 4.5 何时走 native（热点清单，B2 范围）

core 实现且仅实现以下热点（其余仍 Python）：

1. `stream_diff`（1.2 规则的原生实现，与 Python 参考实现 fuzz 对拍）。
2. 几何编解码（points 扁平化 / msgpack / NDJSON 行编码）。
3. 未来真实 compute 节点（`op: compute`，如 retargeting）——B2 先以「透传 + 数值验证」接入，不承诺具体算法。

## 5. 分阶段实施计划

### 5.1 B1：位置流式（纯 Python，三端热更新）

目标：拓扑稳定 + 只更 P 的流式协议全链路跑通，端到端 <15ms、视口不闪；**不引入任何新依赖、不重建 HDA、不引入 native**。

**M1（bridge：协议 + diff + 流端点）**

- `protocol.py`：OutputBuffer 加 `topoId:int=0`、`transform:list[float]|None=None`；新增 Stream 消息模型与常量（`STREAM_RING=512`、`STREAM_HOLD=15`、`DELTA_DENSE_RATIO=0.5`）。
- `types.ts` / `protocol.md` 同步（铁律 #3）。
- `workspace.py`：`put_outputs` 内接 `diff_output`（纯 Python）；`stream_ring` / `topo_ids` / `stream_rev`。
- `routes.py`：新增 `GET /api/hda/{serial}/stream`（NDJSON 长轮询 + 重放）。
- `ws.py`：广播改为发 `snapshot`/`delta`（B1 期同时保留 `outputs` 别名）。
- 测试（pytest）：diff 单测（拓扑变→snapshot、点位变→delta、内容同→不产出、稠密→snapshot、transform）；重放端点（from=0 / from=旧 / from=超界）；stream 长轮询（hold 内推送、keepalive）；WS snapshot/delta。

**M2（web：增量消费）**

- `types.ts`：Stream 类型；`viewport/geometry.ts`：维护 per-output 几何，`applyOutputDelta` 稀疏更新 position attribute（`needsUpdate`）或应用 matrix；`stores/workspace.ts`：消费 `snapshot`/`delta`。
- 验证：`tsc --noEmit` + vitest；手工 HMR 拖动编辑 → 视口不重建不闪。
- 验收：单点编辑只产生 `delta`（bridge 日志），无 `outputs` 全量重建日志；10k 点拖动帧率 ≥ 30fps。

**M3（hda：流消费 + 增量应用）**

- `cyl1nder_stream.py` 新模块（后台线程 + 就绪缓冲 + topoId 校验 + latest-wins）；`cyl1nder_hda.py` cook 改 3.2 快速路径 + 周期自愈 + REST fallback。
- 验证：`reload_hda.py` 免重启热更；`hython hda/scripts/hython_smoke.py` 冒烟（建拓扑、delta 应用、topoId 失配重建）；Houdini 内 30fps 编辑 → 视口无频闪（截图对比）；`sync_fps` 提到 60/120 生效。
- 验收（B1 整体）：三端热更新验证通过（bridge pytest 绿、web tsc+vitest 绿、hda hython 冒烟绿）；E2E：web 编辑 → Houdini 视口 <15ms 更新、无 clear+rebuild（bridge 日志仅 delta）；10k 点增量 cook <2ms；断线/重连/桥重启自愈（内容对账兜底）。

### 5.2 B2：native core 迁移（协议不变，只换实现）

**M4（core 骨架 + 接入）**

- `native/` Rust crate：`main.rs`（监听 8377）、`ipc.rs`（长度前缀 msgpack 帧）、`hello/ping/close`；`bridge/compute/native_client.py`（SidecarClient + `NativeSidecarExecutor` + 健康/退避重启）；`compute/__init__.py` 加 `backend`。
- 验收：bridge 拉起 core、心跳、core 退出自动重启（退避）、`/api/health` 报 `core:native`；core 缺失时全链路纯 Python fallback 正常。

**M5（diff/编解码迁入 core）**

- `stream.rs`：`stream_diff` 原生实现（与 1.2 规则一致）；`geom.rs`：扁平化编解码。
- 对拍测试：随机 buffer 对（Python 参考实现 vs core）fuzz 1000 组，diff 决策与产出逐字段一致。
- 验收：bridge 的 `put_outputs`/`edit` 实际走 core diff；10k 点 diff <0.5ms；fallback 计数为 0（健康态）。

**M6（流热路径全走 core + 打包）**

- WS/REST stream 的编码发布由 core 产出（JSON 兼容）；`proto:"msgpack"` 协商上线（可选开关，默认 json）。
- 发行打包脚本：`dist/` = bridge + `dist/bin/cyl1nder-core.exe` + Vite dist + 薄壳 HDA；`verify-all.ps1` 覆盖。
- 验收：`CYL1NDER_CORE_BIN` 指向发行版 exe 时全链路通过；三端测试全绿；端到端 <10ms；**发行版不包含任何 C++ HDA**（hda-core-cpp-discussion 结论落实）。

### 5.3 里程碑与验收汇总

| 里程碑 | 内容 | 验收（全部达成才算完成） |
|---|---|---|
| M1 | bridge 协议+diff+流端点 | pytest 全绿；diff/重放/长轮询单测覆盖 |
| M2 | web 增量消费 | tsc+vitest 绿；拖动只产 delta、视口不重建 |
| M3 | hda 流消费+自愈 | hython 冒烟绿；E2E <15ms 无频闪；断线/桥重启自愈 |
| M4 | core 骨架接入 | 拉起/心跳/重启/fallback 达标 |
| M5 | diff/编解码迁 core | fuzz 对拍一致；diff <0.5ms |
| M6 | 热路径全 core + 打包 | 发行包全链路绿；端到端 <10ms |

版本号：每个 commit `build++`（development-standards.md）；协议版本 `VERSION` 按协议变更升级（M1 升 0.2.x，B2 不升协议版本）。

## 6. 风险与缓解

| # | 风险 | 影响 | 缓解（已内建于设计） |
|---|---|---|---|
| 6.1 | 拓扑失步：HDA 应用了与生产者不同拓扑的 delta | 几何错乱 | topoId 校验失配即重建；周期 5s 内容对账（sync-architecture 原则）；delta 应用异常 → REST 全量 pull |
| 6.2 | cook 主线程再次被网络/序列化拖慢 | 视口卡顿 | 后台消费线程 + 就绪缓冲 + latest-wins；cook 只 setPosition 变化点；batch API |
| 6.3 | 桥重启 rev/streamRev 重置 | 同步中断/脏 | hello 检测倒退 → from=0 全量重放；REST `/pending` reset 语义保留 |
| 6.4 | 高帧率 delta 风暴（60/120fps 全场景） | 带宽/CPU | 稀疏 delta + 稠密退化为 snapshot；latest-wins 丢中间帧；`sync_fps` 上限；B2 msgpack |
| 6.5 | 浮点乒乓（桥判变/HDA 判不变） | 反复重建 | diff 与 apply 统一 round(x,6)；epsilon 一致；内容相同不产消息（echo 去重） |
| 6.6 | native core 崩溃/挂起 | 流中断 | 崩溃隔离；心跳+退避重启；fallback 链（native→python→passthrough）；`/api/health` 可见 |
| 6.7 | core 与 Python 参考实现行为漂移 | 隐性错误 | fuzz 对拍（M5，1000 组）；同规则双实现测试常驻 CI |
| 6.8 | Houdini 内置 Python 缺 WS 依赖 | HDA 无法直连 WS | B1 用 stdlib urllib 长轮询；B2 若需再上原生 WS 客户端（协议不变） |
| 6.9 | Rust 工具链缺失/团队不接受 | 卡 B2 | 2.3 切换条件（C++20 备选）；B1 不依赖 native，先行收益不受影响 |
| 6.10 | 三端协议漂移（py/ts/md 不同步） | 联调事故 | 铁律 #3 三处同步；M1 一步到位；typecheck 纳入 verify-all |
| 6.11 | web 编辑器回显再次污染 | 脏几何复发 | echo 去重保留（_same_content）；auto-run 门控保留；内容对比自愈兜底 |
| 6.12 | 长轮询连接风暴（HDA 每 serial 常驻 1 连接） | 资源 | hold=15 + keepalive 复用连接；断线指数退避 1s→5s；bridge 对每个 serial 的 stream 挂起者计数限 1 |

## 7. 实现者清单（按文件）

- `bridge/bridge/protocol.py`：Stream 消息模型 + OutputBuffer 扩展 + 常量。
- `bridge/bridge/workspace.py`：`diff_output` + ring/topo/streamRev。
- `bridge/bridge/routes.py`：`GET /api/hda/{serial}/stream`。
- `bridge/bridge/ws.py`：snapshot/delta 广播 + outputs 别名（M3 退役）。
- `web/src/protocol/types.ts`：Stream 类型。
- `web/src/viewport/geometry.ts` / `web/src/stores/workspace.ts`：增量消费。
- `hda/src/cyl1nder_stream.py`（新）/ `hda/src/cyl1nder_hda.py`：消费 + 应用 + 自愈。
- `bridge/bridge/compute/__init__.py`：`backend` 元数据 + `resolve`。
- B2：`native/`（Rust crate）、`bridge/bridge/compute/native_client.py`、打包脚本。
- 文档：`devlog/protocol.md` 同步；本文件为方案 B 落地设计主文档。
