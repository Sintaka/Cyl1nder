# 缓存方案浏览器支持评估（v0.1.00096 前置调研）

> 角色：主进程。背景：用户要求「GPU buffer 等优化方案需慎重考虑浏览器界面支不支持」，评估剩余可做的缓存学习方案。
> 依据：cache-display-research.md（Zeno/Houdini 可借鉴清单）、cache-system-guide.md（路线）、transport-tech-evaluation.md（传输层）、bgeo-cache-research.md。
> 结论一句话：**纯 JS / TypedArray / Web Worker(Transferable) / WebGL2 / IndexedDB / msgpack 都是全浏览器通用，放心做；真正有浏览器门槛的是 WebGPU compute、SharedArrayBuffer/WASM threads（需 COOP/COEP 跨源隔离头 + Firefox/Safari 未完整支持）、WebTransport（Chromium 系）——这些推迟**。

## 一、浏览器支持分层（判断标准）
| 层 | 特性 | 支持情况 | 结论 |
|---|---|---|---|
| A 通用 | 纯 JS 算法、Map/Set、ArrayBuffer、Float32Array、Web Worker + postMessage(Transferable)、WebSocket 二进制帧、WebGL2（RGBA32UI readPixels / 多渲染目标）、IndexedDB、WASM | 全部主流浏览器长期支持 | **可直接做** |
| B 需头/flag | SharedArrayBuffer、WASM threads → 必须 COOP/COEP 跨源隔离头（影响 dev server 与部署）；WebGPU compute（Chrome/Edge 已开，Safari/Firefox 未完整） | 非通用 | **推迟/需 feature gate** |
| C 半吊子 | WebTransport（Chromium 系为主）、Draco 解码等 | 不通用 | **保持 WS/JSON 兜底** |

本项目桌面目标以 Chrome/Edge 为主（e2e 即 Edge/Chromium），A 层全覆盖；B/C 层即使 Chromium 可用，也会牺牲 Firefox/Safari 与「无头/无 header 部署」，故默认不进主线。

## 二、剩余候选逐项评估（按优先级）

### 1. 节点级输出缓存 + 脏传播（Zeno CachedByKey / Houdini DAG 的 Web 版）
- 浏览器风险：**无**（纯 JS）。
- 收益：多节点大图只重算脏分支；共享子链只算一次（修 W1 跨链重复 + node:<id>/out:<i> 双份）。
- 与现有链缓存关系：链缓存已覆盖单链；节点级把「每输出链」升级为「每节点输出 + 端口级脏标记」，active 概念可下沉到节点（Houdini 显示驱动 cook 的更细粒度）。
- 结论：**下一轮首选**（低风险、纯 JS、收益直接）。

### 2. SoA→Float32Array 直传 + Worker 双缓冲（Zeno AttrVector / MapStablizer）
- 浏览器风险：**无**——Float32Array、Worker、Transferable ArrayBuffer 全通用；不需要 SharedArrayBuffer（用 postMessage 转移所有权 + 帧首原子替换即可，不必共享内存）。
- 收益：计算/几何写入移出主线程；flat typed array 直传 BufferAttribute，消除 number[][] 对象开销与 JSON 序列化大头（viewport-gizmo-latency §6 已定位 stringify/parse 是延迟链大头之一）。
- 约束：协议层 number[][]→二进制/typed 属协议改动，须三处同步（protocol.py/types.ts/protocol.md）+ e2e + hython（铁律 3）。
- 结论：**值得做，但和「协议二进制化」合并成一轮**；Worker 用 Transferable（非 SharedArrayBuffer）规避 B 层门槛。

### 3. 协议/快照二进制化（msgpack / bgeo.sc 旁路）
- 浏览器风险：**msgpack 无**（`@msgpack/msgpack` 纯 JS；WS 二进制帧全通用）；**zstd 可选**（WASM 通用，但体积/复杂度↑，建议做成可选 codec，默认 msgpack 即可）；bgeo.sc 直接浏览器解析 = 自研 Houdini 私有格式解码器（非浏览器问题，是格式/维护成本问题）→ 不做，保留「HDA 可自写 bgeo.sc 做 File Cache，wire 仍走 JSON/msgpack」。
- 结论：**做 msgpack（bridge⇄web 先启用，HDA→桥转码）**；zstd 留 feature gate；bgeo.sc 只作 HDA 本地文件缓存语义。

### 4. HDA per-buffer 内容盖章（W9）
- 浏览器风险：**无**（HDA 侧）。
- 结论：**顺手做**（_refresh_ready 只在内容真变时 bump _gen，未变 role 跳过 P 重写）。

### 5. GPU 拾取（Zeno FrameBufferPicker：RGBA32UI id-FBO + 反向 Z 反投影）
- 浏览器风险：**WebGL2 全通用**（three.js r118+ 默认 WebGL2；RGBA32UI + UNSIGNED_INT readPixels、多渲染目标都是 WebGL2 标配）。真正门槛是**复杂度**（id 材质 + FBO + 反投影 + 框选），不是浏览器。
- 现状：three.js Raycaster 逐曲线，小场景够用；动捕级大场景才值得换 GPU 拾取。
- 结论：**保留为中期选项**，先测当前 raycast 是否成为瓶颈（大场景基准后再定）。

### 6. IndexedDB 帧缓存 + stampInfo 切帧（Zeno GlobalComm）
- 浏览器风险：**无**（IndexedDB 全通用；配额大）。
- 收益：做时间轴/多帧缓存序列时按变化对象增量读盘。当前单帧场景收益小。
- 结论：**做时间轴时再上**，不与本轮耦合。

### 7. HDA 直接 `saveToFile(*.bgeo.sc)`（官方格式落盘）
- 浏览器风险：无（Houdini 侧），但 web 若要消费 bgeo.sc 需自研解码（Houdini 私有格式）。
- 结论：HDA 侧可作 File Cache 语义（与桥无关）；web 消费仍走 JSON/msgpack 通道。

### 8. WebGPU compute + WASM threads + SharedArrayBuffer（动捕级）
- 浏览器风险：**高**——需 COOP/COEP 跨源隔离头（vite dev + 部署都要改）、Firefox/Safari WebGPU 未完整。
- 结论：**明确推迟**；用「Web Worker + Transferable」拿 80% 收益、0 浏览器风险。

### 9. WebTransport（v0.3+ 备选）
- 浏览器风险：**高**（Chromium 系为主）。
- 结论：**保持 WS 主通道 + JSON/msgpack 兜底**（transport-tech-evaluation.md 已定）。

## 三、落地顺序建议（浏览器风险从低到高）
1. **节点级输出缓存 + 脏传播**（纯 JS，下一轮）。
2. **SoA→Float32Array + Worker（Transferable）双缓冲**，与 **协议 msgpack 化** 合并一轮（三处同步铁律）。
3. **HDA per-buffer 内容盖章**（W9，随手小轮）。
4. 时间轴需求出现后：**IndexedDB 帧缓存**。
5. 大场景基准证明 raycast 是瓶颈后：**WebGL2 GPU 拾取**。
6. 永不默认：WebGPU compute / SharedArrayBuffer / WebTransport（除非用户明确接受 Chromium-only + COOP/COEP）。

## 四、本轮已确认的一个视口显示 bug（供追溯）
- 现象：拖动 transform gizmo 时，输入/输出节点的四个口一起显示（有概率）。
- 根因：`dataflow.flush()` 先 `refreshNodeFlags`（应用 display focus）后 `viewport.refresh()`；`refresh()` 在 inputRev/outputRev 变化时**重建** input/output 组，重建的子组默认全部可见 → focus 被清掉；且 pending-flush 已 drain，之后无新 emit 再触发 refreshNodeFlags → 四个口**持续**显示（帧探针实测 241/240 帧全可见）。
- 修复：Viewport 自持 focus 状态，`refresh()` 重建组后**同帧**重放 focus（round20-display-focus e2e 回归）。
- 触发源：Houdini recook/输入回声在拖拽期间 bump inputRev（v0.1.00095 的 F3 cook-on-dirty 已大幅减少；但 Force Cook / 首 recook / legacy 路径仍会触发）。