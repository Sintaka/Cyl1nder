# 缓存系统交接指引（给新会话）

> 目的：开新会话迭代 Cyl1nder 缓存系统时，先读这篇 + 下面 3 篇，即可动手。
> 状态：P1/P2 已完成（链缓存/位置-only/pump）；v0.1.00095 完成「懒输出（显示驱动 cook）+ 变化分级（none/data/topology）+ HDA cook-on-dirty 输入门控 + 推送/rev 分级」——见 cache-lazy-stamp-round.md。v0.1.00096 修复 display focus 重建清除 bug（round20 回归）；v0.1.00097 分支统一（唯一主线 codex/develop）+ 时间轴逐帧缓存设计（timeline-frame-cache-design.md）+ 开源库审计（oss-reuse-audit.md）。下一轮候选：时间轴帧缓存第一刀（内存 LRU + parmRev + session 命中判定，帧切换无 parm 变化零重算）+ fast-deep-equal 替换 compare.ts → 节点级输出缓存/脏传播 → SoA+Worker+msgpack 合并一轮 → HDA per-buffer 盖章 → IndexedDB 持久化 → WebGL2 GPU 拾取；WebGPU/SharedArrayBuffer/WebTransport 明确推迟。

## 1. 现在有什么（读完就知道从哪里接）

### Web 侧（已落地，别破坏）
- `web/src/nodes2/chain-cache.ts`：链状态缓存（按 `out:<i>` / `node:<id>`）。sig = `inputsRev|graphVersion|节点结构(组表达式/class/@P依赖)`；sig 命中且仅 tx/ty/tz 变 → 就地 delta（全点零分配/组子集只改命中点/零 delta 零工作）；sig 变或含 @P 规则 → 全量重 trace。
- `web/src/viewport/geometry.ts`（`sameTopology` + `updateGroupPositions`）+ `renderer.ts`：位置-only 更新（拓扑不变不重建）。
- `web/src/main.ts`：pre-render pump（flush 先于 render）+ `scheduleNetwork`（拖拽按帧合并）。
- `core/dataflow.ts`：`displayNodeOutputIndex` 复用 `store.outputs[i]` + `refreshNodeFlags(displayBuffer)`。
- `core/network.ts` + `nodes2/graph.ts`：`getGraphVersion`（拓扑版本）+ `isFresh()` 门控 + 拓扑变化 → 合并 cook（after 事件 + setTimeout 0）。

### HDA / Bridge 侧
- `hda/src/cyl1nder_geometry.py` `_GEO_CACHE`：按 (serial, role) 缓存 `hou.Geometry` + 拓扑 sig；同 gen O(1) 拷贝 / 拓扑不变批量 P 原地更新 / 拓扑变重建。另有 `_OUT_CACHE/_CORE_CACHE/_PUSH_CACHE`。
- bridge：内存 rev buffers（JSON payload）+ 磁盘快照 `data/<serial>/io/{inputs,outputs}.json`（pretty JSON）。

### 协议
- JSON `number[][]`，单源 `bridge/bridge/protocol.py` ↔ `web/src/protocol/types.ts` ↔ `devlog/protocol.md`（铁律 3）。

## 2. 下一步路线（按优先级，一次一轮）

1. ~~**懒输出：跳过未显示分支计算**~~ ✅ 已落地（v0.1.00095）——`computeOutputsCached` 按 ChainCtx.activeOutputs/activeNodeId 只对激活链做点级工作——`computeOutputsCached` 现在每帧算 4 条 output 链；只对「显示/被编辑」的链做点级工作，未显示链零 delta 返回即可。小、低风险。
2. **协议/快照二进制化**（bgeo.sc 式，见 `bgeo-cache-research.md`）——`proto:"msgpack"`（bridge⇄web 先启用，HDA 端 JSON→桥转码）或 flat Float32Array；快照新增二进制旁路（读优先/写双写，JSON 保可读）；**必须三处同步** protocol.py/types.ts/protocol.md。
3. **SoA→Float32Array + Worker 双缓冲**（Zeno AttrVector/MapStablizer）——flat 数组直传 BufferAttribute；计算+几何写入进 Web Worker、帧首原子替换防撕裂（与 pre-render pump 组合）。
4. ~~**变化分级显式化**~~ ✅ 已落地（v0.1.00095）——ChainChange none/data/topology + sameTopology O(1) 引用快路径 + 跳过 computeVertexNormals + per-buffer rev 跳过。
5. （中期）HDA 直接 `hou.Geometry.saveToFile(*.bgeo.sc)` 复用官方格式 / GPU 拾取替代 raycast / IndexedDB 帧缓存 / 节点级输出缓存+脏传播。

## 3. 关键契约 / 坑（务必遵守）

- **协议单源铁律**：改任何 wire 格式 → protocol.py + types.ts + protocol.md 三处一起改。
- **链缓存正确性**：sig 必须含 inputsRev+graphVersion+结构；含 @P 规则（`@P.y>0`）绝不走 delta；共享可变 points 数组安全的前提是 `upsertOutputs` 不去重 + `pushOutputs` 同步 stringify——别给 store 加内容去重。
- **新鲜度门控保留**：`isFresh()`（outputs 与当前拓扑同版本才复用）是 restore/拖线建连未 cook 时的兜底，别删。
- **不重新引入矩阵预览 hack**：理念是「更新 parms → 视口刷新 → 几何移动」，gizmo 与几何分离。
- **并行规范**：代码改交给 codex 子智能体（写集不相交、tsc 必过、e2e 串行跑），主进程合并 + devlog + 版本号 + 单 commit。
- **中文写入**：PowerShell 写 md 用 `[System.IO.File]::WriteAllText(path, text, [System.Text.UTF8Encoding]::new($false))`（UTF-8 无 BOM），写完抽查 `??`。
- **验证**：bridge=pytest；web=`tsc --noEmit` + vitest + e2e（`--workers=1`，共享 serial 并行会串扰）；hda=hython 冒烟。dev server 8376 / bridge 8375。

## 4. 新会话先读（按序）

1. `devlog/cache-system-guide.md`（本文）
2. `devlog/cache-display-research.md`（Zeno vs Houdini 可借鉴清单）
3. `devlog/bgeo-cache-research.md`（协议/快照二进制化分级建议）
4. `devlog/viewport-gizmo-latency.md` §6（P1/P2 链路分析与现状）
5. `devlog/AGENT_QUICKSTART.md`（命令与代码地图）