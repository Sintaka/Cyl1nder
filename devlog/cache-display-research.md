# 缓存与显示管理调研：Zeno vs Houdini vs Cyl1nder（可借鉴清单）

> 日期：2026-08-13 · 角色：主进程（调研整合 + 建议）· 关联：`zeno/cache-display-notes.md`（Zeno 源码细读，Kierkegaard 子智能体产出）、`bgeo-cache-research.md`（bgeo.sc 二进制缓存）、`viewport-gizmo-latency.md`（Cyl1nder 视口实时性 P1/P2）、`hda/src/cyl1nder_geometry.py`（HDA 侧缓存现状）
> 一句话结论：**Zeno = 对象级 stamp + 双缓冲增量 diff（渲染端）＋显式节点缓存/帧缓存（计算端）；Houdini = cook-on-dirty DAG + GU_Detail 内存缓存 + 显示驱动 cook + 视口常驻 GPU buffer 增量更新。Cyl1nder 已在 P1/P2 落地了 Houdini 式「位置-only 更新 + 链缓存」；下一步可借鉴 Zeno 的「对象级 stamp/变化分级」「SoA→TypedArray 直传」「GPU 拾取」与 Houdini 的「未显示分支跳过计算」**。

---

## 一、Zeno（MPL-2.0，计算/渲染双进程）

### 1.1 缓存线
- **显式节点缓存**（`zeno/src/nodes/CacheNodes.cpp`）：`CachedByKey` 用**用户提供的字符串 key**，`preApply` 命中即在拉上游前 return——整条上游链短路、零计算；`CachedIf/CachedOnce` 是「一轮内只算一次/跨帧失效」变体。另有 `CacheToDisk`（`FileDirtCache.cpp`）：DirtyChecker 判上游 dirty 才重算并覆盖磁盘缓存，否则直接读盘。
- **DirtyChecker**：就是 `std::set<nodeName>` 节点级脏标记（append-only 不清空，保守传递）。编辑器 `markNodeChanged` + `requireInput` 沿依赖向下游传播；Graph 每轮从根重新 lazy pull，`visited` 只防同轮重复执行。**没有隐式「输入未变不重算」**（ToView 每次 clone，指针必变）。
- **帧缓存**（`GlobalComm`）：内存 LRU（`maxCachedFrames`）+ 磁盘 ZENCACHE（runtype 4 文件 + 偏移表 + encodeObject 二进制）+ `stampInfo.txt` 增量重载。
- **stamp**：不是计数/哈希，是对象 userData 上的**变化分级标签**——`UnChanged / DataChange / ShapeChange(并入 TotalChange) / TotalChange` + `stamp-base` 基础帧号。`Stamp` 节点产生，`ToView` 按 mode 决定是否导出；渲染端按 stamp **复用旧对象/旧 GL 缓冲**（TotalChange 才重建），`fromDiskByStampinfo` 按字节区间只读变化对象。

### 1.2 显示管理线
- **双缓冲增量 diff**：`ObjectsManager`（对象级）与 `GraphicsManager`（图形级）都是 `MapStablizer`（m_curr/m_next 双 map + RAII InsertPass，finalize 时 swap，读取端永远看到完整旧帧快照）。`may_emplace` 命中旧 key → 0 上传；新 key → `makeGraphic` **整对象重建 GL 缓冲**（pos/clr/nrm/uv/tang 5 VBO + EBO，`GraphicPrimitive.cpp`）。**没有属性级部分更新路径**（DataChange 只是注释）。
- **SoA 直传**：PrimitiveObject 是 SoA（`AttrVector`），每属性连续 vector 直接 bind 成独立 VBO。
- **GPU 拾取**：`FrameBufferPicker` 用 `GL_RGB32UI` id FBO 输出 `uvec3(objId, gl_VertexID+1, 0)`，`glReadPixels` 单点/框选，深度反投影用无限远反向 Z + 逆视图矩阵。
- **编辑器→渲染同步**：改参数 → 命令流（含 markNodeChanged）→ runner 逐帧事件 → `updateViewport → paintGL → session->load_objects()`（GlobalComm→ObjectsManager→GraphicsManager diff）→ draw；显示开关 = ToView mode / invisible userData / runtype / DrawOptions。

### 1.3 可借鉴点（子智能体给出 9 条，摘要）
key+stamp 对象级增量（未变 0 上传）／stamp 四级简化为 three.js `needsUpdate`／SoA→Float32Array 直传 BufferAttribute／IndexedDB 帧缓存 + stampInfo 切帧／RGBA32UI 拾取 + 反向 Z 反投影替代 raycast（含框选）／Worker 产出 array + 帧首原子替换双缓冲防撕裂／visited 去重 + CachedByKey 式 memoize／每轮重建脏集合（避免 append-only 累积）／显示开关统一 renderOptions。

---

## 二、Houdini（SideFX，原生 DCC）

### 2.1 缓存线（cook / detail cache）
- **cook-on-dirty DAG**：SOP 节点参数/输入变化 → 该节点及下游标 dirty；未 dirty 的节点**直接复用缓存的 GU_Detail**（detail 缓存），只有被读取（显示/下游）时才 cook。
- **显示驱动 cook**：视口只 cook「被显示节点及其上游」，未显示分支不 cook——省算力、按需。
- **交互不重 cook**：拖 transform gizmo 时把「已 cook 几何 × 实时变换矩阵」上屏，松手/节流后 commit cook。
- **落盘**：bgeo.sc（原生二进制 + Snappy 无损压缩，见 bgeo-cache-research.md）。
- **Cyl1nder HDA 侧已对齐**（`hda/src/cyl1nder_geometry.py` `_GEO_CACHE`）：按 (serial, role) 缓存 `hou.Geometry` + 拓扑签名；同 gen O(1) 拷贝、拓扑不变走「批量 P 原地更新」fast path、拓扑变才 rebuild——正是 Houdini「detail 缓存 + 增量 P」的思想。

### 2.2 显示管理线
- **Display flag 唯一**：一个网络一个 display 节点（蓝 D），视口显示它的输出；display 也决定 cook 范围。
- **视口常驻 GPU buffer + 增量**：显示几何常驻 GPU；交互只做增量（矩阵/脏位置），不重传全量。
- **Spreadsheet/Params 跟随选中**；视口跟随 display flag。

---

## 三、对比表

| 维度 | Zeno | Houdini | Cyl1nder 现状（P1/P2 后） |
|---|---|---|---|
| 计算缓存 | 显式 CachedByKey/CacheToDisk + 帧缓存；无隐式 memo | cook-on-dirty DAG + GU_Detail 缓存 | 链缓存 + delta 快路径（已落地）；拓扑版本 + isFresh 门控 |
| 变化检测 | 节点级 dirty set + stamp 分级 | dirty 传播（节点/端口级） | graphVersion + inputsRev sig（链级）；位置-only 由 sameTopology 判定 |
| 显示刷新 | MapStablizer 双缓冲增量 diff；未变对象 0 上传 | 常驻 GPU buffer + 增量矩阵/位置 | pre-render pump + 位置-only 更新（P1）；隐藏组跳过 |
| 拾取 | GPU id-FBO + 深度反投影 | GPU 原生拾取 | three.js 逐曲线 raycast（未优化，见 viewport-gizmo-latency §3 #8） |
| 数据布局 | SoA AttrVector → 独立 VBO | 原生并行数组 | number[][] → BufferAttribute（可 SoA 化） |
| 防撕裂 | 双 map swap + 多进程 | 原生多线程 | 单主线程（计算/渲染同线程；Worker 是候选） |

---

## 四、Cyl1nder 可借鉴清单（按优先级）

### 4.1 直接受益（下一步）
1. **未显示分支跳过计算（Houdini 显示驱动 cook）**：现在 `computeOutputsCached` 每帧算全部 4 个 output 链；display 是 transform/null 时只有显示分支要真实结果。可加「懒输出」：非显示且非被编辑的 output 链用缓存零 delta 返回即可（链缓存已让它很便宜，进一步可在结构 trace 后只对显示/编辑链做点级工作）。
2. **SoA→Float32Array 直传（Zeno AttrVector）**：把 `number[][]` 换成 flat `Float32Array`（协议/缓存/几何写入三处一起改），配合 Web Worker 计算 + Transferable，消除 JSON 数组对象开销。这是 P2 之后的自然一步（§6.5 已列 Worker 候选）。
3. **Worker 双缓冲（Zeno MapStablizer 思想）**：计算（computeOutputs + 几何写入）移进 Web Worker，主线程只渲染；Worker 产出 Float32Array 帧首原子替换（双缓冲），避免拖拽撕裂。与 P1 的 pre-render pump 组合：pump 从 Worker 取「已算好的一帧」。
4. **变化分级（Zeno stamp 简化版）**：给 chain-cache entry 加 `change: "none" | "data" | "topology"`——none 零工作、data 走位置-only、topology 全量重建；three.js 对应 `needsUpdate`/`computeBoundingSphere`/重建。这比每次都 sameTopology 更显式（当前 sameTopology 已等价实现，可加显式标记减少比较成本）。

### 4.2 中期（大场景/动捕级）
5. **GPU 拾取（Zeno FrameBufferPicker）**：替代 three.js 逐曲线 raycast——`RGBA32UI` id-FBO + 反向 Z 反投影，天然支持框选/所见即所得；three.js 可用 `WebGLRenderTarget` 自定义材质实现。动捕级大场景点选才值得。
6. **IndexedDB 帧缓存 + stampInfo 切帧（Zeno GlobalComm）**：场景多帧缓存时，按变化对象增量读盘/读缓存；当前单帧场景收益小，做时间轴/缓存序列时再上。
7. **节点级输出缓存 + 脏传播（Zeno CachedByKey / Houdini DAG）**：把链缓存推广到「每个节点输出缓存 + 端口级脏标记」，只在脏分支重算——Houdini DAG 的 Web 版。收益：多节点大图只重算变化链（当前链缓存已覆盖单链，节点级可进一步减算未变链）。

### 4.3 借鉴时注意的坑（子智能体提示）
- Zeno 的 DirtyChecker 集合 **append-only 不清空**（单向累积的保守信号）——我们要每轮重建脏集合，避免累积。
- Zeno 渲染端「整对象重建缓冲、DataChange 只注释」——**属性级部分更新是缺失项**，我们已用 position-only 更新补上，别退回去。
- 显式缓存 key 靠用户字符串（易撞/易脏）——我们应优先内容/结构签名（已用 sig）。

---

## 五、结论
- **缓存**：Houdini 是「依赖驱动的按需 cook + 原生 detail 缓存」，Zeno 是「显式节点/帧缓存 + stamp 复用」；Cyl1nder 的链缓存 + delta 快路径已对齐 Houdini 的增量思想，下一步按 4.1.1/4.1.2 做「懒输出 + SoA/Worker」。
- **显示管理**：Houdini「常驻 GPU + 增量」与 Zeno「双缓冲 diff + 未变 0 上传」本质相同；Cyl1nder 的 pre-render pump + 位置-only 更新已是这个方向。中期按 4.1.3/4.1.4 引入 Worker 双缓冲与显式变化分级。
- 详细 Zeno 源码证据见 `devlog/zeno/cache-display-notes.md`。