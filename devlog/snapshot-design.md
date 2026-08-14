# Cyl1nder 统一路径系统 + 文件快照系统设计

> 版本：v0.1 设计稿 · 日期：2026-08-10 · 作者：设计子智能体（只读设计，未改任何代码）
> **状态注记（v0.1.00104，2026-08-14）**：P0 已落地（bridge snapshot.py 双根合并 + web 保存/恢复），场景 B（桥重启回填）与 `/snapshot/restore`、shutdown flush 见 `snapshot-fix-00102.md`；**本文件仍是统一路径系统的权威设计**（R1~R5 规则、路径推导、schema 不变）。
> 关联源码：`bridge/bridge/{protocol,registry,workspace,routes,state,ws}.py`、`web/src/{main.ts,stores/workspace.ts,nodes2/graph.ts,protocol/types.ts}`、`hda/src/*.py`
> 关联文档：`devlog/{decisions,protocol,sync-architecture,streaming-plan-b,temp-scene-log,annotations-*}.md`
> 设计约束（用户原话）：以**网络（桥/registry/workspace）为最底层基准**，不解析 hda 文件；快照默认放 **hip 场景同目录 `Cyl1nder/<节点序列号>/`**；**当前不做备份系统**（单一最新、可覆盖写），但文件名/结构为将来备份留扩展位。

---

## 1. 结论摘要表

| # | 问题 | 结论 |
|---|---|---|
| 1.1 | 权威数据源 | bridge 的 `registry.json`（身份）+ workspace（数据）是唯一权威；hip/hda 文件只是输入来源，**任何路径不得从 .hda/.hip 解析** |
| 1.2 | 统一路径模型 | 逻辑路径 `cyl://<serial>/<domain>[/<index>]`；物理路径一律"固定前缀 + serial + 固定后缀"可推导，serial 是锚点；唯一上下文变量 = `registry[serial].hip` |
| 1.3 | 快照根目录 | `<hip目录>/Cyl1nder/<serial>/`（由 registry.hip 推导）；hip 缺失时回退 `CYL1NDER_SNAPSHOT_ROOT` → `bridge/data/snapshots/<serial>/` |
| 1.4 | 快照文件 | 4 个 JSON：`<serial>.meta.json` / `<serial>.graph.json` / `<serial>.inputs.json` / `<serial>.outputs.json`；原子覆盖写（tmp+replace），单一最新 |
| 1.5 | 保存时机 | ① web 手动（Ctrl+S / 按钮，立即）② web 自动防抖（3s，内容变才写）③ HDA cook 节流快照（可选参数，默认 off，≥5s）④ hip 目录 `scripts/onSaved.py`（扩展位，v1+） |
| 1.6 | 加载/恢复 | web 打开：workspace（权威态）WS 回放 + snapshot.graph 恢复节点图；workspace 归零（桥重启）→ 一键从快照回填 bridge；Houdini 无需自动恢复（hip 自带持久化），可选"导入快照"按钮 |
| 1.7 | 与现有系统关系 | registry=身份权威；workspace=运行态权威（内存）；snapshot=workspace + web 节点图的**磁盘持久化镜像**（非权威，不参与实时同步决策） |
| 1.8 | 备份扩展位 | 目录级预留 `history/`、文件名预留 `.rev`/`snapshotId`、每个文件带 `schemaVersion`；v0 只写 current 文件，不做历史/回收站 |
| 1.9 | 落地顺序 | P0 最小闭环（schema + bridge REST + web 保存/恢复）→ P1 自动防抖 + 桥重启自愈回填 → P2 对齐 streaming-plan-b 并启用备份扩展 |

---

## 2. 路径规则（统一路径系统）

### 2.1 总原则
- **网络为基准**：一切资源都挂在 serial 之下，以 bridge 的 registry/workspace 为权威；**禁止**从 `.hda`/`.hip` 二进制或节点名解析路径。
- **可推导**：任意资源的定位 = 固定模板 + serial（+少量固定参数），不存储自由路径。
- **唯一锚点**：serial（`C1-<base36ms>-<4rand>`，正则 `^C1-[0-9a-z]{8,}-[0-9a-z]{4}$`，见 `protocol.py`）是跨子系统唯一身份。

### 2.2 统一逻辑路径（cyl://）
```
cyl://<serial>/<domain>[/<sub>]
domain ∈ { meta, inputs, outputs, graph, snapshot }
sub    ∈ 端口索引 0..3（仅 inputs/outputs）
```
示例：
- `cyl://C1-msm006pg-8fz7/meta` —— 身份/元数据
- `cyl://C1-msm006pg-8fz7/inputs/0` —— 第 0 路输入几何
- `cyl://C1-msm006pg-8fz7/outputs/2` —— 第 2 路输出几何
- `cyl://C1-msm006pg-8fz7/graph` —— rete 节点图状态
- `cyl://C1-msm006pg-8fz7/snapshot` —— 磁盘快照集

### 2.3 物理路径推导表（路径函数）

| 逻辑资源 | 推导规则 | 物理位置 |
|---|---|---|
| 身份 | `registry.json[serial]` | `bridge/data/registry.json`（磁盘） |
| 输入几何 | bridge workspace（内存） | `GET/PUT http://127.0.0.1:8375/api/hda/{serial}/inputs` |
| 输出几何 | bridge workspace（内存） | `GET/PUT http://127.0.0.1:8375/api/hda/{serial}/outputs` |
| WS 通道 | 固定模板 | `ws://127.0.0.1:8375/ws?serial={serial}` |
| Web 工作区 | 固定模板 | `http://127.0.0.1:8376/?serial={serial}` |
| 快照目录 | `dirname(registry[serial].hip)/Cyl1nder/{serial}/` | 磁盘 |
| 快照文件 | `<snapshotDir>/<serial>.<part>.json`，part ∈ {meta,graph,inputs,outputs} | 磁盘 |

### 2.4 路径规则（写进规范，R1~R5）
- **R1 身份唯一**：serial 是跨端唯一 key；不得用节点名、hip 文件名、label 作为资源 ID。
- **R2 可推导**：资源路径一律模板化（见 2.3）；协议/快照内只存 serial + 推导必需的最小字段（如 hip，供目录推导），不存自由绝对路径。
- **R3 hip 是"输入"不是"根"**：快照目录从 `registry[serial].hip` 推导；hip 为空/失效时走回退链（2.5）。
- **R4 单写者**：磁盘快照只由 bridge 进程写入（web/HDA 只经 REST 提交），避免多进程并发覆盖。
- **R5 内容优先**：快照/恢复决策沿用 `sync-architecture.md` 铁律——同步/重建判断基于内容对比，rev/时间戳仅作提示。

### 2.5 回退链（hip 不可用时）
1. `CYL1NDER_SNAPSHOT_ROOT` 环境变量（用户/项目显式指定快照根）；
2. `bridge/data/snapshots/<serial>/`（桥自带目录，保证"有桥必有快照位"）；
3. 均不可用 → 快照请求报 `snapshot_dir_unavailable`，**不阻断实时同步**（快照是旁路能力）。

---

## 3. 目录结构

### 3.1 目标布局（以当前临时场景为例）
registry：`C1-msm006pg-8fz7` → hip `D:/Animation_Project/Houdini/Test/Cyl1nder/dev/beginTest-1/beginTest-1.hip`

```
D:/Animation_Project/Houdini/Test/Cyl1nder/dev/beginTest-1/
├── beginTest-1.hip                    # Houdini 场景（既有，非 Cyl1nder 权威）
├── scripts/                           # Houdini 场景脚本（可选扩展位）
│   └── onSaved.py                     # [v1+] hip 保存时触发快照（Houdini 约定目录，H22 需验证）
└── Cyl1nder/                          # ⚠ 快照根（项目约定：hip 场景同目录）
    └── C1-msm006pg-8fz7/              # 每个 serial 一个目录（锚点 = 目录名）
        ├── C1-msm006pg-8fz7.meta.json     # 元数据（单一最新，覆盖写）
        ├── C1-msm006pg-8fz7.graph.json    # rete 节点图状态
        ├── C1-msm006pg-8fz7.inputs.json   # 4 路输入几何
        ├── C1-msm006pg-8fz7.outputs.json  # 4 路输出几何
        └── .cyl-snapshot.lock             # 写锁标记（原子写辅助，可选）
        # —— 未来备份扩展位（v0 不建）——
        # └── history/
        #     └── <snapshotId>/   # 同结构 4 文件（v0.2+ 再做）
```

### 3.2 设计要点
- **目录名 = serial**：天然防冲突、可推导、可被工具枚举（`list(Cyl1nder/*/)` 即 serial 列表）。
- **文件名 = `<serial>.<part>.json`**：part ∈ {meta, graph, inputs, outputs}；未来备份用 `history/<snapshotId>/<serial>.<part>.json` 或 `<serial>.<part>.r<rev>.json` 扩展，**current 文件命名保持不变**（升级无损）。
- 多个 serial 共处一个 hip 目录：各自子目录互不干扰；同一 serial 出现在两个 hip（复制未 Regenerate）→ 各自目录 + 文档警告（见 §7 风险 7.4）。
- 快照根 `Cyl1nder/` 建议加入版本控制忽略（.gitignore），避免几何 JSON 入库。

---

## 4. 快照文件清单与 schema

### 4.1 总则
- 全部 UTF-8 JSON，每个文件带 `schemaVersion: 1`；读取端只认 `schemaVersion <= 当前`（前向只读兼容）。
- 几何数据与 wire protocol **完全同构**（`InputPayload` / `OutputBuffer`，复用 `bridge/bridge/protocol.py` 模型）；协议"三处同步"铁律不变。
- 写入一律 tmp+replace 原子替换（与 `registry.py._save` 同模式）。

### 4.2 meta.json（元数据）
```jsonc
{
  "schemaVersion": 1,
  "serial": "C1-msm006pg-8fz7",
  "hip": "D:/Animation_Project/Houdini/Test/Cyl1nder/dev/beginTest-1/beginTest-1.hip",
  "nodePath": "/obj/geo1/Cyl1nder1",
  "label": "Cyl1nder",
  "appVersion": "0.1.00017",          // 项目版本 x.xxx.xxxxx（protocol.py VERSION）
  "createdAt": 1786291780.2233033,     // serial 创建时间（复制自 registry）
  "savedAt": 1786360000.0,             // 本次快照落盘时间（epoch 秒）
  "inputRev": 42,                      // 保存时 workspace.input_rev（提示，非恢复依据）
  "outputRev": 17,                     // 保存时 workspace.output_rev（提示，非恢复依据）
  "counts": { "inputs": 4, "outputs": 4, "nodes": 2, "connections": 4 },
  "sources": { "inputs": "bridge:workspace", "outputs": "bridge:workspace", "graph": "web:rete" },
  "snapshotId": "c1msm006pg8fz7-20260810T103000Z"   // 预留：未来 history 键；v0 每次覆盖写时刷新
}
```

### 4.3 graph.json（rete 节点图状态）
要点：nodes（kind / label / 位置 / flags）、connections（按端口名）、viewport 变换（扩展位）。
```jsonc
{
  "schemaVersion": 1,
  "nodes": [
    {
      "id": "input",                    // v0：input_/output_ 按 kind 固定 id；null 用随机 id
      "kind": "input",                  // input | output | null
      "label": "input_",
      "x": 24, "y": 40,                 // rete area translate 位置
      "flags": { "display": true, "bypass": false, "freeze": false, "wireframe": false }
    },
    { "id": "output", "kind": "output", "label": "output_", "x": 420, "y": 40,
      "flags": { "display": false, "bypass": false, "freeze": false, "wireframe": false } }
  ],
  "connections": [
    { "from": { "node": "input",  "port": "in0" },  "to": { "node": "output", "port": "out0" } }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 },        // 可选：area.transform（扩展位）
  "selectedNode": null                               // 可选
}
```
恢复不变量：`input_`/`output_` 单例（同 kind 只保留一个）；`display` 唯一性（加载时若多个 true，保留第一个并清其余，与 Houdini display 语义一致）；未知 kind 忽略并告警。

### 4.4 inputs.json / outputs.json（几何）
与协议模型同构：
```jsonc
// inputs.json
{ "schemaVersion": 1, "rev": 42, "inputs": [ /* InputPayload[]：{index,name,pointCount,primCount,points,curves,attributes} */ ] }
// outputs.json
{ "schemaVersion": 1, "rev": 17, "outputs": [ /* OutputBuffer[]：{index,rev,pointCount,primCount,points,curves,attributes} */ ] }
```
- 恒为 4 路（index 0..3，缺路补空 `{index, pointCount:0, points:[], curves:[], attributes:{}}`）；恢复时按 index 对齐。
- 浮点统一 `round(x, 6)`（与 HDA 序列化一致，防浮点乒乓）。

---

## 5. 保存与加载流程

### 5.1 保存流程（写）
```
[web] 手动保存 / 自动防抖(3s) / 图结构变化
   │  PUT /api/hda/{serial}/snapshot   { graph?: GraphJson }
   ▼
[bridge] snapshot.save(serial, graph)
   │ 1. inputs/outputs ← workspace（权威内存态，不重新拉 HDA）
   │ 2. meta ← registry + VERSION + now + rev 快照
   │ 3. 原子写 4 个 JSON（tmp+replace，.lock 防并发）
   │ 4. WS 广播 { type:"snapshot-saved", savedAt, inputRev, outputRev }
   ▼
[web] 收到广播 → 状态栏「已保存 HH:MM:SS」
```
- **写盘只发生在 bridge**（R4 单写者）；web/HDA 永不直接写快照目录。
- **内容不变不写**：bridge 对比现有 current 文件（meta/graph 指纹），相同则跳过（省 IO，遵守 R5）。
- **HDA cook 时**：v0 **默认不写**（cook 为 30fps 级高频，写盘是灾难）；可选参数 `snapshot_on_cook`（默认 off，开启后 ≥5s 节流 + 内容变化才写），用于无人值守自动存档。
- **hip 保存钩子（扩展位）**：Houdini 会在 hip 目录执行 `scripts/onSaved.py`（官方约定目录，H22 版本需验证）→ 可在其中调 bridge 快照 API，实现"保存场景 = 保存 Cyl1nder 快照"。

### 5.2 加载/恢复流程（读）
**场景 A：web 正常打开（桥在线，workspace 有数据）**
```
web open ?serial=...
   ├─ GET /api/hda/{serial}/status → registry + workspace 摘要（权威态）
   ├─ GET /api/hda/{serial}/snapshot?view=graph → graph.json（若存在）
   ├─ 重建 rete 图：无快照 → 默认模板（input_+output_+4 条边）；有快照 → 按 graph.json 恢复节点/连线/flags/位置
   ├─ inputs/outputs ← WS hello 回放（现有机制，权威态优先）
   └─ 视口/统计照常（恢复流程不阻塞连接）
```
**场景 B：bridge 重启，workspace 归零（内存态丢失）**
```
web 检测 hello 的 rev 倒退/reset → 提示「桥重启，检测到快照」
   ├─ 用户点「从快照恢复」→ POST /api/hda/{serial}/snapshot/restore
   ├─ bridge 读快照 → 回填 workspace（set_inputs / put_outputs，rev 保持或重算）
   ├─ HDA 现有 30fps 轮询 + 内容对比自愈 → 自动拉回（无需人工干预）
   └─ 恢复前校验：快照 meta.serial 与请求 serial 一致；几何与当前 workspace 内容对比，一致则跳过
```
**场景 C：Houdini 侧**
- **无需自动恢复**：hip 文件本身就是 Houdini 的持久化；节点图/编辑结果最终由 bridge 拉回。
- 可选「导入快照」按钮（HDA 参数或 shelf）：把快照 inputs/outputs 推回 bridge（PUT inputs/outputs）→ 下次 cook 生效；用于换机器/桥数据丢失后重建现场。
- hip 移动/改名：`registry[serial].hip` 更新 → 快照目录自动指向新位置；旧目录保留，提供 `migrate snapshot` 命令（扩展位，v1+）。

### 5.3 时序建议
- 保存：手动立即 + 自动防抖 3s（web 图变化）+ 可中断（pending 标志）。
- 加载：**优先权威态**（bridge workspace）→ 快照只补 graph 与兜底；恢复永远可被用户取消（不自动覆盖运行态）。

---

## 6. 与现有系统关系（谁是谁的快照/镜像）

### 6.1 数据流总览
```
                 ┌─────────────────────────────────────────────┐
                 │ Houdini / HDA（hip 场景）                    │
                 │ 输入产生者 · 输出消费者（无需 Cyl1nder 持久化）│
                 └──────────────┬──────────────────────────────┘
                  cook 推 inputs│      30fps 轮询拉 outputs
                               ▼
   ┌──────────────────────────────────────────────────────────┐
   │ bridge（权威）                                            │
   │   registry.json（磁盘） → 身份权威 {serial,hip,nodePath,...} │
   │   workspace（内存）     → 数据权威 {inputs, outputs, rev}    │
   └───────┬───────────────────────────────┬──────────────────┘
           │ PUT snapshot(graph)           │ GET snapshot / restore
           ▼                               ▼
   ┌──────────────────────────────────────────────────────────┐
   │ snapshot（磁盘镜像，非权威）  <hipDir>/Cyl1nder/<serial>/   │
   │   meta / graph / inputs / outputs = workspace + 节点图落盘 │
   └──────────────────────────────────────────────────────────┘
           ▲
           │ PUT graph / GET graph / 手动保存 / 恢复回填
   ┌──────────────────────────────────────────────────────────┐
   │ web（无持久化）                                           │
   │   store(workspace.ts) = 运行态镜像 · rete graph = 内存态    │
   └──────────────────────────────────────────────────────────┘
```

### 6.2 镜像关系表

| 数据 | 权威源 | 镜像/快照 | 备注 |
|---|---|---|---|
| serial 身份（hip/nodePath/label/createdAt） | registry.json（磁盘） | snapshot meta.json | meta 是 registry 的**存档副本**；加载时以 registry 为准 |
| 输入几何 | HDA cook → bridge workspace（内存） | snapshot inputs.json | workspace 是运行态权威；快照是其持久化镜像 |
| 输出几何 | web 编辑 → bridge workspace（内存） | snapshot outputs.json | 同上 |
| 节点图（节点/连线/flags/display） | web 内存（rete） | snapshot graph.json | **graph 的唯一持久化载体**；无快照则刷新即丢 |
| 版本 x.xxx.xxxxx | protocol.py VERSION | meta.appVersion | 三处同步铁律（protocol.py / types.ts / protocol.md） |
| rev | workspace（内存） | meta.inputRev/outputRev | **仅提示，不作恢复依据**（R5 内容优先） |

### 6.3 一句话总结
registry 是「身份权威」，workspace 是「运行态权威」，snapshot 是「workspace + web 节点图的磁盘镜像（存档/兜底）」，hip/hda 只是「输入来源与输出去处」，web 只是「无持久化的客户端」。快照**不参与实时同步决策**——实时同步永远以 workspace 内容为准（sync-architecture 铁律），快照只在「打开页面恢复节点图」和「workspace 归零后兜底回填」两个场景被消费。

---

## 7. 风险与边界

| # | 风险 | 影响 | 缓解 / 边界 |
|---|---|---|---|
| 7.1 | hip 目录不可写/被删/移动 | 快照写失败 | 回退链：`CYL1NDER_SNAPSHOT_ROOT` → `bridge/data/snapshots/`；失败仅记日志，不阻断同步 |
| 7.2 | cook 高频写盘放大 | IO / 磁盘寿命 | v0 cook 默认不写；`snapshot_on_cook` 节流 ≥5s + 内容变化才写 |
| 7.3 | 并发写（多标签页/多端） | 文件撕裂 | R4 单写者（只有 bridge 写盘）+ tmp+replace 原子替换 + .lock |
| 7.4 | 复制节点未 Regenerate 共享 serial | workspace/快照互相污染 | 现有「Regenerate Serial」按钮缓解；快照 meta 记录 nodePath，恢复时 nodePath 不符给警告 |
| 7.5 | 快照 stale（比 workspace 旧） | 恢复旧数据 | 恢复前内容对比（与 workspace 一致则跳过）；快照不参与实时同步（R5） |
| 7.6 | 无备份 = 覆盖写丢历史 | 误操作数据丢失 | v0 明确接受（用户要求）；UI 提示「覆盖写」；预留 history/ 与 snapshotId |
| 7.7 | 大几何 JSON | 体积 / 解析慢 | 沿用 round(6) 紧凑 JSON；二进制/glTF 由 streaming-plan-b B2 承接（快照文件未来可加 `.bin` 对） |
| 7.8 | schema 演进 | 旧文件读不了 | 各文件均带 schemaVersion；读取端前向兼容（只读 <= current） |
| 7.9 | Windows 长路径/中文路径 | 快照写失败 | 路径规范化（正斜杠）；目录名 = serial（安全字符集）；hip 目录过深时提示使用 CYL1NDER_SNAPSHOT_ROOT |
| 7.10 | 几何数据入库/泄露 | 版本库膨胀 / 隐私 | 建议用户把 `Cyl1nder/` 加入 hip 目录 .gitignore；v0 本机工具不加密 |
| 7.11 | 桥重启 workspace 归零 | 运行态丢失 | 快照兜底 + `since>rev` 全量重拉自愈（现有机制）+ 场景 B 一键恢复 |
| 7.12 | 同一 serial 出现在多个 hip | 快照目录分散 | 按 serial 隔离已天然防碰撞；文档声明 serial 应唯一绑定实例 |

**边界声明（v0 不做）**：历史多版本 / 回收站 / 差异备份 / 云同步 / 加密 / 迁移工具 / 快照压缩。以上均只留扩展位，不做实现。

---

## 8. 分阶段落地建议

### P0 —— 最小闭环（建议 v0.1.00018）
- `bridge/bridge/snapshot.py`（新）：目录推导（含回退链）、4 文件读写、原子写、内容对比跳过、`get/save/restore` 三个函数。
- `bridge/bridge/routes.py` 新端点：
  - `GET  /api/hda/{serial}/snapshot[?view=meta|graph|inputs|outputs|all]`（默认 all，返回聚合 JSON）
  - `PUT  /api/hda/{serial}/snapshot`（body：`{ graph? }`；bridge 用 workspace 补 inputs/outputs 并落盘）
  - `POST /api/hda/{serial}/snapshot/restore`（读快照回填 workspace）
- `web`：保存按钮 + Ctrl+S；打开时 `GET snapshot?view=graph` 重建 rete 图（`nodes2/graph.ts` 新增 `serializeGraph()` / `restoreGraph(json)`）；store 增加 `lastSavedAt`。
- 验证：bridge pytest（round-trip / 原子性 / 回退链）、web tsc + vitest（graph 序列化反序列化）、hython 冒烟不受影响、e2e（保存 → 刷新 → 恢复）。

### P1 —— 自动与自愈（v0.1.x）
- web 自动防抖保存（3s，内容变才请求）。
- HDA 参数 `snapshot_on_cook`（默认 off）+ 节流；hip `scripts/onSaved.py` 钩子（先验证 H22 行为）。
- bridge 重启后：web 检测 reset → 提示一键「从快照恢复」；可选 `auto_restore_on_reset` 配置。
- 文档模板：`.gitignore` 加 `Cyl1nder/` 的建议。

### P2 —— 对齐流式与备份扩展（v0.2+）
- 与 `streaming-plan-b.md` 对齐：快照文件 = stream snapshot 的磁盘落地（`OutputBuffer.topoId` 等字段入 schema）。
- 备份扩展上线：`history/<snapshotId>/` + 保留策略（数量/天数）+ 回收站（软删除）；current 文件命名不变，升级无损。

---

## 附：新 REST 端点速查（P0 落地时的最小 API 面）
```
GET  /api/hda/{serial}/snapshot?view=all          # 聚合快照（meta+graph+inputs+outputs）
PUT  /api/hda/{serial}/snapshot                   # body { graph? } → bridge 落盘，返回 savedAt
POST /api/hda/{serial}/snapshot/restore           # 快照回填 workspace，返回 {ok, inputRev, outputRev}
WS   {type:"snapshot-saved", savedAt, inputRev, outputRev}   # 广播
```