# HDA「一次 cook 多输入多输出」架构可行性调研报告

> 调研对象：Cyl1nder 项目（Houdini⇄WebGL 中间站）。现状 = Subnet HDA（4 输入/4 输出），内部 4 个 Python SOP 薄壳，每个 Python SOP 从对应输入取几何→序列化推送本地桥→拉取结果写回对应 Output SOP；Houdini 因此 cook 4 次，且 4 个输出口曾全部返回第一个输入的几何。
> 调研方式：本机 Houdini 22.0.368 + HDK 22 头文件（`C:\Program Files\Side Effects Software\Houdini 22.0.368\toolkit\include`）+ hython 无头实测 + Cyl1nder 源码/文档交叉验证。Web 在线检索在本次会话中未完成，外部链接标注为「待复核」。
> 日期：2026-08-10

---

## 0. 结论摘要表

| 问题 | 结论 | 证据等级 |
|---|---|---|
| Q1 单个 SOP 节点能否有多个输出？ | 常规 SOP（含 Python SOP、Attrib Wrangle 等）原生**单输出**；多输出是 Subnet/HDA 的机制（内部放 N 个 Output SOP），HDK 的 `OP_Operator` 虽支持 `maxoutputs>1`，但注释明确「一般节点（VOP 除外）约定单输出」 | 本机 HDK 头文件 + hython 实测（强） |
| Q2 HDK C++ 写 4 进 4 出 SOP、一次 cook？ | **多输入**：完全可行（`min_sources/max_sources`，verb 的 `inputGeo(idx)` 读多输入）；**多输出**：理论可行（`maxoutputs=4` + 重载 `cookMySopOutput(outputidx)`），但**非典型、需要自己管理多个 detail 生命周期**，现代 verb 接口只支持单输出 detail；「一次 cook 产出 4 输出」需原型验证（待确认） | HDK 头文件（中~强）；一次 cook 为待确认 |
| Q3 单个 Python SOP 能否一次处理 4 输入？ | **能读 4 输入**（实测 Python SOP 有 4 个输入口，`node.inputs()[i].geometry()` 逐路读取）；**只能写 1 个输出**（单输出口，HOM 无法让单节点产出多个 detail）。可用「1 个 Python SOP 合并输出 + 4 个按角色 blast/Output」减少重 cook | hython 实测（强） |
| Q4 官方/社区做法 | 多输出官方载体 = Subnet + Output SOP（OTL/HDA）；VOP 是另一类多输出节点；Vellum 等官方 HDA 走 subnet 多输出（Cyl1nder decisions.md 已记载）。外部链接本轮未在线复核 | 本机验证（强）+ 链接待复核 |
| Q5 是否值得升级为「1 个多输出 HDK 节点」 | **当前不建议**。瓶颈不是 cook 次数本身，而是每次 cook 的序列化+HTTP 推拉与全量重建；Cyl1nder 已有决策（hda-core-cpp-discussion.md / streaming-plan-b.md）倾向「HDA 保持薄 Python 壳 + 本地原生 sidecar」，与 HDK 路线冲突。先做 Python 侧小改动降 cook/网络次数，HDK 多输出作为远期备选 | 源码/文档（强） |

---

## 1. Q1：一个 SOP 节点能否有多个输出？Subnet 是唯一多输出方案吗？

### 1.1 本机实测（hython，Houdini 22.0.368）

对 `sopnet` 下各节点类型实测输入/输出连接器数量：

| 节点类型 | inputConnectors | outputConnectors | 说明 |
|---|---|---|---|
| python | 4 | **1** | 可接 4 输入，但只有 1 个输出口 |
| attribwrangle | 4 | 1 | 官方多输入单输出先例 |
| subnet | 4 | 11（可动态增减） | 多输入多输出载体 |
| output / null / blast / file | 1 | 1 | 常规单输入单输出 |
| merge | 9999 | 1 | 只多输入，不多输出 |

结论：**常规 SOP 节点 = 单输出**。多输出不是通过「一个 SOP 多输出口」实现的，而是通过 **Subnet（内部放多个 Output SOP，每个 Output SOP 对应一个输出口）**。HDA（OTL）定义的节点可以声明任意多个输出，靠的就是 Subnet 语义。

### 1.2 HDK 头文件证据（Houdini 22.0.368）

- `OP/OP_Operator.h`：`OP_Operator` 构造器最后一个参数 `int maxoutputs = 1`（4 个重载都有），并有 `#define OP_MULTI_OUTPUT_MAX 9999`（「nodes that allow multiple outputs」）。即 HDK **允许**节点声明多个输出口。
- 但 `OP_Operator::maxOutputs()` 注释写得很直白：*"Management operators can't have outputs. Otherwise the general procedure (except for VOPs) is one output."* —— **除 VOP 外，一般节点（含 SOP）的惯例就是单输出**；多输出主要由 OTL 定义（`myOTLDefinition.getMaxOutputs()`，即 HDA/Subnet）承载。
- `SOP/SOP_Node.h`：`class SOP_API SOP_Node : public OP_Network` —— SOP_Node 本身继承自 OP_Network（具备子网语义）。多输出机制存在：
  - `SOP_Node *getOutputSop(int outputidx, ...)` —— 取第 outputidx 个 Output SOP（子网语义）；
  - `GU_DetailHandle cookOutput(OP_Context &context, int outputidx, SOP_Node *interests)` —— 「Cook an Output at index outputidx… return the node that was cooked inside the subnet」—— 这是 **Subnet 逐输出口 cook** 的机制；
  - `virtual GU_DetailHandle cookMySopOutput(OP_Context &context, int outputidx, SOP_Node *interests)` —— 每个输出口一个 cook 钩子（默认返回单 myGdpHandle）。
- 但基类只有**一个** `GU_DetailHandle myGdpHandle` + `GU_Detail *gdp`（单输出 detail），且现代 **verb 接口**（`SOP_NodeVerb::CookParms` 只有单个 `myDestGdh`）**不含 outputidx** —— verb 风格 SOP 天然单输出。

### 1.3 Subnet 是「SOP 层多输出」的标准/唯一成熟方案吗？

- 是 SOP 层事实上的标准做法：HDA 编辑节点用 Subnet，内部 Output SOP 定义每个输出口。Cyl1nder `devlog/decisions.md` 已记载同样结论：「SOP 节点原生单输出；Subnet 才能暴露多输出（Vellum 同款做法）」。
- Vellum 等官方工具的多输出：Vellum 求解是 DOP 网络，多输出/多入口同样靠子网/网络结构承载；SOP 侧没有「单节点多输出」的常规先例。（本轮未在线复核 Vellum 具体节点，标待确认。）
- 补充：VOP（着色器/CHOP 类）是另一类天生多输出的节点，但那是 VEX/VOP 体系，不是 SOP 几何体系，与本题无关。

---

## 2. Q2：HDK 编写 4 输入 + 4 输出的 SOP 节点是否可行？能否一次 cook？

### 2.1 可行性分层

| 能力 | 结论 | 依据 |
|---|---|---|
| 4 输入 | ✅ 完全可行 | `OP_Operator` 的 `min_sources/max_sources`（现有 `SOP_DevHello` 是 0–0；改成 4–4 即可）；verb 的 `CookParms::inputGeo(idx)` 按索引读多输入（`SOP_NodeVerb.h` 有 `inputGeo(exint idx)`） |
| 单输出 | ✅ 标准做法 | `cookMySop` / verb `cook()` 写单个 `myGdpHandle` |
| 4 输出 | ⚠️ 理论可行、非典型 | `maxoutputs=4` + 重载 `cookMySopOutput(context, outputidx, interests)` 为每个输出口返回不同 `GU_DetailHandle`；但基类只有单 `myGdpHandle/gdp`，多 detail 需自管生命周期与 data ID |
| 现代 verb 风格下多输出 | ❌ 不支持 | `SOP_NodeVerb::CookParms` 只有单个 `myDestGdh`，无 outputidx 参数；verb 式 SOP 只能单输出。多输出必须走传统 `cookMySop`/子网式路径 |
| 编译为 .dll 内嵌 HDA | ✅ 可行 | 现有工程已验证 HDK DSO 编译/加载/热重载链路（`SOP_DevHello.dll`）；HDA 可嵌入 DSO 节点 |
| 「一次 cook 产出 4 输出」 | ❓ 需原型验证 | HDK 机制上可在一次 `cookMySop` 里填好 4 个 detail，下游输出口走 `cookOutput(outputidx)` 取缓存；但 Houdini 对 `maxoutputs>1` 的 SOP 是否会为每个输出口分别触发一次 cook 路径，未在本轮实测，列为**待确认项** |

### 2.2 对「Houdini 是否只 cook 一次」的解读

- 若用 **Subnet HDA**（现状）：HDA 的每个输出口对应内部一个 Output SOP；Houdini 为满足输出请求会 cook 内部网络，**每个内部节点（4 个 Python SOP + 4 个 Output SOP）各 cook 一次** —— 这就是「cook 4 次」的根源。
- 若用 **自定义 maxoutputs=4 的 C++ SOP**：核心逻辑理论上可收敛到一次 `cookMySop`，但前提是把 4 路输出都塞进该节点的 cook 内完成，且下游请求各输出口时不重复执行核心逻辑。这需要原型验证，且实现路径（传统 cookMySop + 自管多 detail）与现行 verb 工程（`SOP_DevHello` 用的 verb 模板）不兼容，要换写法。

---

## 3. Q3：单个 Python SOP 能否一次处理 4 输入？

### 3.1 实测结论（hython，Houdini 22.0.368）

- **Python SOP 有 4 个输入口**：`inputConnectors()` 返回 4 槽；`setInput(0)`~`setInput(3)` 全部成功，`node.inputs()` 返回 4 个输入节点。
- **Python SOP 只有 1 个输出口**：`outputConnectors()` 返回 1。
- **读多输入的正确姿势**：`node.inputs()[i].geometry()` 逐路读取（实测 4 路 grid 都能拿到）。
- **重要坑（正是「4 输出口都返回第一个输入几何」的 API 根源）**：`hou.Node.geometry()` 的签名是 `geometry(output_index=0)` —— 参数是**输出索引**，不是输入索引！单输出节点的 `geometry(1)` 返回 `None`（实测 `AttributeError`）。脚本里若用 `node.geometry()` 拿「输入几何」，拿到的是**输入 0 的副本**，于是 4 个输出口全变成输入 0。Cyl1nder `hda/src/cyl1nder_hda.py` 代码注释里已自述此 bug：「node.geometry() is always the input0 copy on a multi-input python SOP, so keeping it made all 4 output ports emit the first input.」（该文件后续已尝试用 `srcs[role].geometry()` 修 passthrough，但部署中的 .hda 是否为最新代码待核对，见风险节。）

### 3.2 能否「单 Python SOP + 多输出」模拟？

没有「一个 Python SOP 节点直接产出 4 个不同 detail」的原生机制（HOM 无法给单 SOP 节点写多输出）。可行的**模拟**：

- **方案 A（合并输出 + 按角色拆分）**：1 个 Python SOP 在一次 cook 里完成「推 4 输入 + 拉 4 路 buffer」，把 4 路结果合并进**一个** detail，并用角色属性（如 `cyl1nder_role`）标记每路；下游 4 个 Output SOP 前各放一个「按角色 blast/delete」节点抽出对应路。效果：**重活（序列化/HTTP/反序列化）只发生 1 次**，4 个下游节点是本地轻量 blast。缺点：4 路几何被混在同一 detail（视口会同时显示全部 4 路），需靠 display/命名隔离；合并+拆分有额外内存/拷贝开销。
- **方案 B（集中拉取 + 进程内缓存）**：保持 4 个 Python SOP 结构不变，但**只有 role0 做网络拉取**（一次 HTTP 拉 4 路 buffer 存进程内缓存），role1..3 只从缓存读并重建几何。效果：4 次 HTTP 往返降为 1 次；cook 仍是 4 次，但每次都是本地轻量重建。改动最小、最贴合现有架构与热更新工作流。
- 两种方案都**不引入 C++**，可立刻在纯 Python 侧做。

---

## 4. Q4：官方/社区做法（本机已验证 + 待复核链接）

### 4.1 本机强证据（已完成交叉验证）

- HDK 头文件：`SOP/SOP_Node.h`（`cookOutput`/`cookMySopOutput`/`getOutputSop`，单 `myGdpHandle`）、`OP/OP_Operator.h`（`maxoutputs=1` 默认、`OP_MULTI_OUTPUT_MAX`、`maxOutputs()` 注释）、`SOP/SOP_NodeVerb.h`（`CookParms` 单 `myDestGdh`、`inputGeo(idx)`）。
- hython 实测：Python SOP 4 输入/1 输出；Subnet 4 输入/N 输出；`hou.Node.geometry()` 是 output_index。
- Cyl1nder 文档：`devlog/decisions.md`（Subnet 多输出、Vellum 同款）、`devlog/hda-core-cpp-discussion.md`、`devlog/streaming-plan-b.md`、`devlog/sync-architecture.md`。

### 4.2 官方/社区链接（本轮未在线复核，标「待复核」；建议按以下关键词补查）

官方：
- HDK SOP_Node 类参考（含 cookOutput/cookMySopOutput）：https://www.sidefx.com/docs/hdk/class_SOP_Node.html （待复核）
- HDK OP_Operator 类参考（maxoutputs）：https://www.sidefx.com/docs/hdk/class_OP_Operator.html （待复核）
- HDK 入门/创建插件：https://www.sidefx.com/docs/hdk/_hdk__intro__getting_started.html （devlog 已引用）
- Python SOP 节点文档：https://www.sidefx.com/docs/houdini/nodes/sop/python.html （待复核）
- HOM `hou.Node`（inputs() / geometry(output_index)）：https://www.sidefx.com/docs/houdini/hom/hou/Node.html （待复核）

社区（本轮未在线复核，待复核）：
- 搜索词建议：`houdini hdk multiple outputs SOP`、`SOP_Node multi output`、`vellum multi output subnet`、`houdini python sop multiple inputs outputs`、`odforce custom SOP multiple outputs`、`sidefx forum SOP multiple outputs subnet`。

---

## 5. Q5：评估与推荐架构路线

### 5.1 评估：是否值得从「4 Python SOP」升级为「1 个多输出 HDK 节点」？

**结论：当前不建议走 HDK 路线。**理由：

1. **瓶颈不是 cook 次数本身**。Cyl1nder `devlog/livelink-roadmap.md` 与 `hda-core-cpp-discussion.md` 已分析：瓶颈是①全量重建几何（视口频闪）②轮询粒度 ③cook 主线程内做同步/序列化；Python 薄壳本身不是热点。把 4 次 cook 变成 1 次，收益有限，且真正的热点（序列化/流式）在 HDK 里也绕不开。
2. **与既有架构决策冲突**。`devlog/decisions.md` 定调「Houdini 侧用 Python SOP（免重启热重载）；C++ 只在热路径需要时上」；`streaming-plan-b.md`（0.7/2.1）明确**不采用 DLL+ctypes 进 Houdini**：理由 = Houdini 锁 DLL、原生崩溃直接带崩 Houdini、无法独立热更新。HDK 多输出节点恰是「DLL 进 Houdini」路线。
3. **HDK 多输出是非典型路径**。verb 接口不支持多输出，要退回传统 `cookMySop` + 自管多 detail 生命周期 + data ID，工程成本与踩坑风险高；且「一次 cook 产 4 输出」还需原型验证。
4. **双实现漂移**：Python dev 版 + C++ release 版两套代码，行为/边界易漂移（`hda-core-cpp-discussion.md` 已指出）。

**何时再考虑 HDK**：若发行版要求「单文件、无 Python 依赖、节点级一次 cook」，可作为远期备选；前提是先做一个 `maxoutputs=4` 的最小原型，验证①一次 cook 是否真的只执行一次核心逻辑②多 detail 的 data ID/缓存语义是否稳定。

### 5.2 推荐路线（近期，纯 Python，不碰 C++）

1. **先修数据对接 bug**：所有读输入改为 `node.inputs()[role].geometry()`；明确 `hou.Node.geometry()` 是输出索引，绝不用它取输入几何；核对桥侧 `outputs[].index` 与 role 映射。
2. **方案 B：集中拉取 + 进程内缓存**（改动最小、推荐先做）：role0 一次 HTTP 拉 4 路 buffer 进进程内缓存，role1..3 只重建几何，把 4 次 HTTP 往返降为 1 次；同时为后续「单 Python SOP」铺路。
3. **方案 A：单 Python SOP + 合并输出 + 按角色 blast**（进阶原型）：验证「1 次重 cook + 4 个轻量 blast」的收益与视口隔离体验；可与方案 B 对比计时。
4. **量化验证**：用 hython 冒烟 + cook 计时（前后 `time.time()` 或 `hou.perfMon`）记录当前「4 次 cook」中序列化/HTTP/重建各占多少，用数据决定是否值得继续优化。

### 5.3 「现在就能做的小改动」清单

- [ ] 把 4 个 Python SOP 的输入读取从 `node.geometry()` 改为 `node.inputs()[i].geometry()`（修「4 输出口都返回第一个输入」）。
- [ ] 确认部署 .hda 与 `hda/src/cyl1nder_hda.py` 同步（重新 build_hda + reload），排除「.hda 内是旧逻辑」。
- [ ] role0 集中拉 4 路 + 模块级缓存分发（方案 B），role1..3 去网络。
- [ ] （可选原型）单 Python SOP 合并输出 + 4 个 blast，计时对比。
- [ ] 输出口 mapping 单测：桥侧 index 0..3 ↔ HDA 输出 0..3 ↔ 输入 0..3 三端一致。
- [ ] 记录 cook 计时基线，作为后续任何优化（含 HDK）的验收标准。

### 5.4 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 数据映射 bug 未根治 | `geometry()`=输出索引的误用可能还在 .hda 内嵌脚本/旧版里 | 统一走 `inputs()[i].geometry()`；hython 冒烟断言 4 路输出与 4 路输入一一对应 |
| 缓存/rev 失步 | 方案 B 引入进程内缓存，若违反「决策一律基于内容」铁律会复现脏几何（sync-architecture.md 教训） | 缓存只做加速，重建决策仍用内容对比 |
| 合并输出视觉混杂 | 方案 A 4 路几何同一 detail，视口会同时显示 | 用角色属性 + blast/display 隔离，或仅作为内部临时态 |
| HDK 多输出一次 cook 不确定 | `maxoutputs>1` 的 SOP 是否只 cook 一次未实测 | 先做最小 C++ 原型验证，再决定是否投入 |
| 热更新工作流被破坏 | C++ 编译-重启循环与现有 Python 热更新冲突 | 维持「Python 壳热更新」主路线，HDK 只作远期备选 |
| .hda 内部连线未核 | .hda 为 INDX 二进制格式，本轮未解包核对内部连线（源文件/文档一致描述为 4 Python SOP） | 下一轮用 `hou.hda` 或解包工具核对内部网络，确认 role 与输入/输出口接线 |

---

## 6. 待确认项（本轮未完成）

1. Web 在线检索未执行：第 4 节链接与社区帖均为「待复核」，需补查并核实链接有效性。
2. 「maxoutputs=4 的 C++ SOP 是否一次 cook 产 4 输出」未原型实测。
3. 部署中的 `Cyl1nder_1.0.hda` 内部连线/内嵌脚本未解包核对（INDX 二进制格式）。
4. Vellum 具体多输出节点的官方结构说明未在线复核。
5. 当前 4 次 cook 的耗时分布（序列化/HTTP/重建）未实测，建议作为下一步验收基线。

## 7. 参考（本机已核对）

- HDK 头文件（Houdini 22.0.368）：`SOP/SOP_Node.h`、`OP/OP_Operator.h`、`SOP/SOP_NodeVerb.h`
- hython 实验脚本（本会话生成，可复跑）：`hython_probe.py`、`hython_probe2.py`（位于本可视化目录）
- Cyl1nder：`hda/src/cyl1nder_hda.py`、`hda/src/cyl1nder_bridge.py`、`devlog/decisions.md`、`devlog/hda-core-cpp-discussion.md`、`devlog/streaming-plan-b.md`、`devlog/sync-architecture.md`、`devlog/hda-hot-reload.md`
- HDA_Test_2：`src/SOP_DevHello.C/.h`（verb 式单输出 SOP 参照）、`devlog.md`