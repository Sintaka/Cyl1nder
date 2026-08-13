# bgeo.sc 缓存技术调研：二进制几何 vs JSON / Binary GEO & cache design

> 日期：2026-08-13 · 角色：主进程（调研 + 结论 + 迁移计划，本轮不实现协议层大改）· 状态：调研完成，给出分级建议
> 关联：`transport-tech-evaluation.md`（msgpack/zstd 已定 B2 方向）、`viewport-gizmo-latency.md`（JSON stringify/parse 主线程成本）、`streaming-plan-b.md`、`devlog/protocol.md`（协议单源铁律）
> 一句话结论：**bgeo.sc = Houdini 原生二进制几何（binary GEO） + 无损压缩（默认 Snappy）；其本质是「二进制 JSON + typed array + 流式压缩」。Cyl1nder 现在的 JSON number[][] 协议 / io/*.json 快照就是「文本版 .geo」，升级方向 = 对齐 bgeo.sc 的二进制 JSON + 压缩（协议层 B2 已定 msgpack/zstd，快照/缓存层新增 bgeo.sc 式二进制旁路）**。

---

## 一、bgeo / bgeo.sc 是什么技术

### 1.1 格式本质（官方 + 社区证据）
- `.geo` = Houdini 原生几何的 **ASCII/JSON 文本**格式（GU_Detail 序列化）。
- `.bgeo` = **Binary GEOmetry**：同一结构的**二进制编码**，是二进制形式的 JSON（`binary_geo` magic + version + UT_JSONWriter 二进制 JSON，typed array 直接存数值，无文本解析）。SideFX 提供参考实现 `$HH/public/binary_json`。
- `.bgeo.sc` = `.bgeo` + **流式无损压缩**（默认 Snappy；`.bgeo.gz` 是 gzip）。无损，不丢任何属性/拓扑，与 `.bgeo` 读进 Houdini 完全等价（论坛实测 spreadsheet 属性一致）。
- 底层 = `hou.Geometry`（GU_Detail）整体序列化：points / vertices / primitives / attributes（含 size/type）/ topology / detail 属性，全量无损。

### 1.2 关键机制
| 层 | bgeo.sc | Cyl1nder 现状（JSON） |
|---|---|---|
| 编码 | 二进制 JSON：标量带类型 tag、数值用原生二进制（float32/64、int 变长） | 文本 JSON：`[[0,0,0],[1,0,0],...]`，每个数字 ASCII 十进制 |
| 解析 | 直接读 typed array，无文本解析 | `json.loads` / `JSON.parse` 全量文本扫描 + 字符串→数字 |
| 压缩 | Snappy 流式无损（CPU 解压开销极小） | 无（或需整包 gzip） |
| 体积 | 数字不膨胀（~4-8 字节/坐标 + 压缩后更小） | 一个 float 最多 ~20+ 字符文本，10x+ 体积膨胀 |
| 流式 | 二进制块可流式读写 | 需要完整文本帧 |

### 1.3 社区实测结论（sidefx forum 48077 / artivoxa）
- `.bgeo.sc` 相比 `.bgeo`：**写缓存时间略长（压缩开销）、体积明显小、读取无感知差异**；现代 CPU 上压缩开销可忽略，且小文件 = 网络传输更快，往往总 I/O 更快。
- 使用场景：缓存/归档（File Cache、ROP Output Driver），高频读写用 `.sc` 通常更优。

---

## 二、对比 JSON 的优势 / 劣势（针对 Cyl1nder）

| 维度 | JSON（现状） | bgeo.sc（二进制 JSON + 压缩） |
|---|---|---|
| 人类可读/调试 | ✅ 直接 cat / diff / 手改 | ❌ 需工具（但可保留 JSON 旁路做 debug） |
| 体积（P=10 万点） | ~10-40MB（ASCII 数字 + 分隔符） | ~0.5-4MB（原生二进制 + Snappy） |
| 序列化/反序列化 | stringify/parse 主线程占用高（延迟链大头之一） | 快（typed array 直读 + 解压） |
| 传输带宽（bridge⇄web / HDA⇄bridge） | 大 | 小一个数量级 |
| 协议/快照通用性 | 单源好维护、跨语言零依赖 | 需三端（py/ts/hda）同一编解码实现（协议单源铁律） |
| 增量/delta | 文本 diff 可读但慢 | 二进制 diff 更快（B2 Rust core 双端复用后更稳） |
| 与 Houdini 对齐 | 无 | **对齐 Houdini 原生格式理念**（bgeo 即官方选择） |

结论：**JSON 唯一不可替代的优势是「可读/可调试」——保留为 debug/fallback 通道，主数据通道与磁盘缓存升级为二进制 + 压缩，即可兼得**。

---

## 三、Cyl1nder 现状盘点（缓存系统在哪里）

1. **HDA 端 `_GEO_CACHE` / `_OUT_CACHE` / `_PUSH_CACHE`（hda/src/cyl1nder_cache.py）**：已是「内存原生缓存」——按 (serial, role) 缓存 `hou.Geometry` 对象 + 拓扑签名，拓扑不变时走「批量 P 更新 fast path」，等价于「bgeo 反序列化后的内存对象 + 增量」。**这部分已经是 bgeo 思想，不需要改**。
2. **桥端内存 rev buffers（bridge put_outputs / workspace）**：直接存 JSON payload（`number[][]`）。瓶颈在「全量 JSON 文本」本身。
3. **磁盘快照（bridge data/<serial>/io/inputs.json + outputs.json，snapshot.py）**：pretty JSON，人类可读但体积大、写盘/读盘慢。
4. **协议（bridge/bridge/protocol.py ↔ web/src/protocol/types.ts ↔ devlog/protocol.md）**：JSON 单源。传输层走 WS/NDJSON 的 JSON 文本。

真正的瓶颈集中在 2/3/4 的「JSON 文本化」：大场景下 stringify/parse 占主线程（viewport-gizmo-latency.md 已定位）、体积膨胀、带宽浪费。HDA 端内存缓存反而是最健康的。

---

## 四、升级建议（分级，尊重协议单源铁律）

### 4.1 协议层（bridge⇄web / HDA⇄bridge）
- **B2 已定方向（transport-tech-evaluation.md）：`proto:"msgpack"` + 按需 `codec:"zstd"`**。msgpack 正是「二进制 JSON」的成熟实现，等价于 bgeo 的二进制 JSON 思路，且 Python/TS 都有零依赖实现（`msgpack` / `@msgpack/msgpack`），HDA 侧 Python stdlib 无依赖（py 有 msgpack 可选装；若 HDA 坚持零依赖，可先只在 bridge⇄web 启用，HDA 端继续 JSON，桥做转码）。
- 更激进对齐 bgeo.sc：把 points/curves/faces 改成 **flat typed array**（Float32Array + Uint32Array 索引），协议加 `"binary":true` 标记；三端实现单源（协议单源铁律要求 protocol.py/types.ts/protocol.md 同步改）。
- 本文件仅调研，**协议改动留到专门一轮**（涉及三端 + e2e + hython，必须独立分支按铁律走）。

### 4.2 磁盘快照/缓存层（bridge data/<serial>）
- **新增 bgeo.sc 式二进制旁路**：`io/inputs.bgeo.sc` / `io/outputs.bgeo.sc`（或 `.msgpack` + zstd）与 JSON 并存：
  - 读：优先读二进制（快），缺失/损坏回退 JSON（可读/可修）。
  - 写：双写（JSON 保可读调试 + 二进制保性能）；或 JSON 只写首次/小场景、二进制常写。
- HDA 侧 File Cache 语义：`hou.Geometry.saveToFile("*.bgeo.sc")` 可直接把整份 GU_Detail 落盘——若未来走「HDA 直接落盘缓存」路线，可完全复用官方格式（零自研编解码），bridge/web 只消费解出来的 JSON/二进制。

### 4.3 不改的部分
- HDA `_GEO_CACHE` 内存原生缓存保留（已是最优形态）。
- JSON 保留为 debug/fallback 通道（用户「文字可读」需求）。

---

## 五、落地顺序（建议下一轮独立分支）
1. 协议层：`proto:"msgpack"` 协商（streaming-plan-b 已预留字段）→ bridge⇄web 先启用，HDA 端 JSON→桥转码（最小三端改动）。
2. 快照层：新增 `io/*.bgeo.sc`/msgpack 二进制旁路 + 读优先/写双写。
3. 大场景：flat typed array + zstd（或 HDA 直接 `saveToFile(bgeo.sc)` 复用官方格式）。
每步都按铁律：protocol.py / types.ts / protocol.md 三处同步 + pytest/tsc/hython 三端验证 + devlog 记录。