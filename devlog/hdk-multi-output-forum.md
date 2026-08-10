# Houdini「SOP 节点多输出」桥接方案调研报告

> 项目背景：Cyl1nder（Houdini⇄WebGL 中间站）。HDA 内部当前为「1 个 Python SOP 合并输出 + blast 按 prim 属性拆分」，但**无 prim（纯点）数据流走不通**；用户拟回到「4 个 Python SOP + 进程内缓存」方案，并评估 HDK 多输出是否可行。
> 调研日期：2026-08-10（Asia/Shanghai）。信源：SideFX 官方论坛 / 官方 HDK 文档 / odforce 论坛 / 第三方技术博客；按要求避开国内 CSDN。
> 说明：本次调研为一次受限轮次，以下结论基于已抓取到的原始帖子正文，未做二次深挖；标注「未获权威答复」处请以官方 RFE / 新版本 changelog 复核为准。

## 0. 结论摘要表

| # | 问题 | 结论 | 主要证据 |
|---|---|---|---|
| Q1 | HDK 有没有「一次 cook 输出多个 detail」的 SOP？ | **有 API（`cookMySopOutput` / `cookOutput`），SESI 自家 Vellum 系节点在用；但第三方公开成功案例≈0**。2015 年唯一直接讨论帖以「invalid input」失败告终；2026 年官方对「普通 SOP 多输出」仍挂 RFE#144407；目前唯一可行思路是 SOP Invoke（compiled）变通 | [39232](#q1) [102813](#q1) [SOP_Node.h](#q1) |
| Q2 | 社区主流多输出做法？ | **Subnet/HDA + 多个 Output SOP（子网原生 4 输出）**，或 Object Merge 直接抓内部 null，或合并后按属性拆分；「核心节点算好 + 多下游各扒结果」正是官方多输出 HDA 的标准形态 | [39056](#q2) [78801](#q2) [32221](#q2) |
| Q3 | `maxoutputs` / `cookMySopOutput` 真实可用性？ | `OP_Operator` 构造确有 `maxoutputs`（默认 1），但**公开插件中无成功使用 `cookMySopOutput` 的先例**；2025 年 odforce 明确「SOP 节点上加输出无效」；官方 `cookOutput(outputidx)` 按输出口逐个、按需 cook，无证据表明一次 cook 即产出全部输出 | [59396](#q3) [SOP_Node.h](#q3) |
| Q4 | Python SOP 多输入单输出下如何共享一次网络拉取？ | 官方推荐 **`cachedUserData`**（进程级、任意 Python 对象、跨 cook 复用）；社区模式是「core 节点算一次 + 多个下游各读」，或落盘 bgeo + File SOP 读回；Python SOP 本身无法多输出，需多节点共享缓存 | [nodeuserdata](#q4) [43435](#q4) [46835](#q4) |
| 推荐 | 对「4 Python SOP + 一次网络缓存」的验证/修正 | **方向成立**：Subnet 外壳 + 4 个 Output SOP + 进程内缓存（core 节点 `cachedUserData` 或模块级 dict）符合社区标准；**HDK 多输出不建议投入**；blast 拆 prim 必须改为「点/组属性 + delete」或 pack + path 属性拆分 | [推荐路线](#推荐路线) |

---

## Q1. HDK 里有没有人实现过「一次 cook 输出多个 detail」的 SOP 节点？

### 直接证据

1. **SideFX 官方论坛 39232「Multiple outputs from HDK node?」（2015-06-21，forum）** —— 这是全网唯一直接讨论 `cookMySopOutput` 的帖子：
   - 用户 `KMcNamara` 把 `OP_Operator` 的 maxoutputs 设为 2，重写：
     ```cpp
     GU_DetailHandle
     SOP_myNode::cookMySopOutput(OP_Context &context, int outputidx, SOP_Node *interests)
     {
         GU_Detail* second_input = new GU_Detail();
         duplicateSource(1, context, second_input);
         GU_DetailHandle handle;
         handle.setGdp(second_input);
         return handle;
     }
     ```
   - 结果：把第二个输出接到下游时得到 **“invalid input”**，帖子无有效回复，**社区侧无成功案例**。
   - 链接：https://www.sidefx.com/forum/topic/39232/ （lofi 版：https://www.sidefx.com/forum/topic/39232/lofi/ ）

2. **SideFX 官方论坛 102813「SOP create - is it possible to create more than one output?」（2025-03 发起，2026-01 更新，forum）** —— 目前最权威的现状答复：
   - `tamte`（Tomas Slancik，Framestore CG Supervisor）：*“AFAIK this is not yet possible, I have RFE#144407 requesting exactly this feature to output geo for every Output SOP with positive index…”* → **普通 SOP 节点多输出至今未实现，官方 RFE 编号 144407**。
   - `alex_sidefx`（SideFX 员工）：*“For now, there is a sneaky workaround to get multiple geo outputs in a SOP Geometry style with SOP Invoke. Of course you're limited to compilable nodes.”* → **SOP Invoke（compiled block）变通**；`tamte` 补充：用空 compiled block 替代 Output SOP 后几乎等同于「SOP Import + Output SOP」的多输出效果。
   - 链接：https://www.sidefx.com/ja/forum/topic/102813/?page=1#post-452317

3. **官方 HDK API 存在性（官方文档）**：
   - `SOP_Node` 公开方法 `GU_DetailHandle cookOutput(OP_Context &context, int outputidx, SOP_Node *interests)`，注释：“Cook an Output at index outputidx. Add data interests to interests pointer if it isn't null.”
   - `SOP_Node::getOutputSop(int outputidx, bool fallback_to_display_render=true)`：“SOP networks need some logic to switch between using output nodes, display nodes, or render nodes… also be used to just return the Output SOPs.”
   - `cookMySopOutput` 在公开文档中**无任何文字说明**（2015 帖子里同样抱怨“the cookMySopOutput is totally blank”），仅在头文件可见。
   - 链接：https://www.sidefx.com/docs/hdk/class_s_o_p___node.html ；https://www.sidefx.com/docs/hdk/_s_o_p___node_8h_source.html ；https://www.sidefx.com/docs/hdk/_h_d_k__data_flow__s_o_p.html

4. **SESI 自家 HDK 多输出节点的存在证明（forum + 官方文档）**：
   - 论坛 96740（2024-06）：*“Some nodes have multiple outputs (for example, Vellum SOPs usually output constraint network besides the geometries).”* → 原生节点（如 Vellum 系列）确实有多输出，**但这些是 SESI 内部 C++ 实现，源码不公开**。
   - 官方 Vellum 文档（brush.html）：*“connect the first two inputs with the first two outputs of vellumcloth1. This connects the Vellum Geometry (grid) and Constraint Geometry…”* → Vellum Cloth 有「几何 + 约束」两个输出。
   - 链接：https://www.sidefx.com/ja/forum/topic/96740/ ；https://www.sidefx.com/docs/houdini/vellum/brush.html

### 小结（Q1）
- HDK 理论上有「每输出口一个 detail」的机制（`cookOutput(outputidx)` → `cookMySopOutput`），**内部节点（Vellum）已生产级使用**。
- 但**第三方公开实现无一成功**：2015 年唯一帖子失败；2026 年官方仍把「普通 SOP 多输出」列为未实现（RFE#144407）。对 Cyl1nder 而言，**把 HDK 多输出当可行性路线风险极高，不应作为依赖项**。

---

## Q2. 社区主流做法：多输出是不是都用 Subnet + 多个 Output SOP？

### 直接证据

1. **SideFX 论坛 39056「HDA multiple outputs」（2015 发起，多次更新，forum）**：
   - `tamte`：*“yes, it is possible for SOPs created from subnet (subnet itself has already 4 outputs) then use Output SOP to redirect your data to specific output”* → **SOP 子网原生就有 4 个输出口，用 Output SOP 把数据导向指定输出口**。
   - 链接：https://www.sidefx.com/forum/topic/39056/

2. **SideFX 论坛 78801（2021-04 发起，2025-09 更新，forum）**：`Kj9` 给出 Houdini 20.5 双输出 HDA 完整步骤：
   1. 右键 HDA > Allow Editing of Contents
   2. Type Properties > Basic > **Maximum Outputs > 2**
   3. Input/Output 页给输出口命名
   4. 进入 HDA 内部，Tab 新建 **Output 节点** 并接入要输出的内容
   5. 返回上层 HDA > 右键 > **Match Current Definition**
   - 注：另一用户（akfheaven，2026-07）反馈 Maximum Outputs 滑块仍会置灰——**只有基于 Subnet 的 HDA 才有此能力**。
   - 链接：https://www.sidefx.com/ja/forum/topic/78801/lofi/

3. **第三方博客 James Robinson VFX「Display Intermediate Results And Visualization Geo in an HDA」（2023-01）**：
   - *“HDAs/Subnets can have multiple outputs when using the Output SOP.”*
   - 关键行为：HDA/Subnet 内使用 Output SOP 时 **Display Flag 被忽略**，`Output SOP`（索引 0）接的内容才显示在视口；可用 **“Output for View Flag”** 切换显示哪个输出；还提供 `kwargs["node"].setOutputForViewFlag(...)` 回调示例。
   - 链接：https://www.jamesrobinsonvfx.com/blog/display-intermediate-results-and-viz-geo/

4. **SideFX 论坛 49013「Being able to display and output different geometry in an hda」（2017，forum）**：
   - `sidenimjay`：*“you need to set multiple outputs in the parameter interface and then use output sops to designate what sops you want to export. have a look at the collision source sop as an example of this method”* → **Collision Source SOP 是「多输出 + Output SOP」的官方范例**。
   - `KaiStavginski`（SideFX）：*“Don't use separate display/render flags in SOPs. The cache of all subsequent SOPs will be cleared whenever you render and then go back to displaying…”* → 与多输出无关但很重要：别用 display/render flag 区分输出流，会反复清缓存导致巨量 recook。
   - 链接：https://www.sidefx.com/forum/topic/49013/

5. **odforce 22448「Foreach, multiple outputs」（2015 发起，2021 最终回复，odforce）** —— 「没有多输出，就合并」的社区共识：
   - *“There is no way to output multiple data without merging. Otherwise we would have the ability to modify multiple inputs and return multiple outputs out of nodes like Attribute Wrangle SOP.”*
   - 推荐做法：**pack 后合并，用 path 属性区分，最后按 path 拆开再 unpack**（避免 detail 属性互相覆盖）。
   - 链接：https://forums.odforce.net/topic/22448-foreach-multiple-outputs/

6. **SideFX 论坛 32221「subnet (digital asset): more out connections」（forum）**：
   - `AdamT`：*“You can only have a single out path on a node… 1. Parametrize and/or group the separate data, merge it on it's way out and filter it in the next node. 2. Object Import the separate geometry & polyline branches to the nodes that need them (not dependent on the Display flag).”* → **Object Merge 直接指向 HDA 内部 null，不依赖 display flag**，是「多分支各取所需」的另一种标准做法。
   - 链接：https://www.sidefx.com/forum/topic/32221/

### 小结（Q2）
- 社区主流 = **Subnet/HDA + 多个 Output SOP**（SOP 子网原生 4 输出；SOP 上下文内唯一官方支持的多输出形态）。
- 「一个核心节点算好结果、多个下游节点各自扒结果」的模式，在 HDA 里就是「内部多个 Output SOP 各自接下游拆分/消费节点」；在 HDA 外就是 **Object Merge 直接抓内部 null**（不依赖 display flag）。
- 纯 SOP 层面若不想用 Subnet，社区共识是**合并 + 属性拆分**（pack + path 属性；或 group + delete）。这正好对应 Cyl1nder 当前 blast 方案的来源，但 blast 只对 prim 有效。

---

## Q3. `OP_Operator::maxoutputs` 与 `cookMySopOutput(outputidx)` 的真实行为

### 直接证据

1. **`OP_Operator` 构造确实有 `maxoutputs`（官方 HDK 文档）**：
   - 构造签名（odforce 59396 引用 + DOP_Operator 文档可见）：`OP_Operator(name, english, OP_Constructor, PRM_Template *parms, mininputs=0, maxinputs=0, localvars=0, flags=0, inputlabels=0, int maxoutputs=1, tab_submenu_path=0)` → **默认 maxoutputs=1，可调大**。
   - 链接：https://www.sidefx.com/docs/hdk18.5/class_d_o_p___operator-members.html ；https://forums.odforce.net/topic/59396-how-to-put-my-asset-in-the-right-section-in-tab-menu/

2. **`maxoutputs` 调大后是否真的路由数据？公开结论是：SOP 上无效（2015 与 2025 两次独立验证）**：
   - 2015，论坛 39232：maxoutputs=2 + `cookMySopOutput` 重写 → 第二输出 “invalid input”。
   - 2025-04，odforce 59396：*“However, as far as adding outputs on a node - this doesn't work for nodes in SOP. The output itself appears, but there is no way to pass data to it (I have not found a way).”* → **输出口能出现，但数据传不进去**。
   - 链接：https://forums.odforce.net/topic/59396-how-to-put-my-asset-in-the-right-section-in-tab-menu/#comment-258889

3. **`cookMySopOutput` 是「每输出口各 cook 一次」还是「一次 cook 出全部」？**
   - **未找到官方/论坛的权威答复**。从 API 设计推断（公开头文件 + `cookOutput(outputidx, …)` 语义）：
     - Houdini 是依赖驱动的惰性 cook：`cookOutput(context, outputidx, interests)` 按 outputidx **逐个、按需**被下游请求触发；
     - 第 0 输出走常规 `cookMySop()`（`cookOutput` 内部逻辑），第 1..n 输出走 `cookMySopOutput`；
     - 若某个输出口没有下游连接，**它不会被 cook**（这与 Subnet 的 Output SOP 行为一致）。
   - 因此**不能指望「一次 cook 就同时产出所有输出口」**；若要在多个输出间共享重计算，必须在节点实例内部自行缓存（例如 cook 0 时算好并存成员变量 / `UT_SharedPtr`，cook 1..n 时复用）。
   - 链接（推断依据）：https://www.sidefx.com/docs/hdk/_s_o_p___node_8h_source.html （`cookOutput` 注释）；https://www.sidefx.com/docs/hdk/_h_d_k__data_flow__s_o_p.html

4. **HDA 层面 `Maximum Outputs` 的可用性**：
   - 对 **Subnet 型 HDA**：可用（Type Properties > Basic > Maximum Outputs；内部放 Output 节点），见 Q2 的 78801 步骤（Houdini 20.5）。
   - 对 **Python SOP 型 / 普通 SOP 型 HDA**：置灰不可改（论坛 39056 多次反馈 “Maximum Outputs … disabled / grey'd out”）。
   - 对 **OBJ 层级 HDA**：不可用（论坛 78801：obj 层多输出被反复请求多年无果；论坛 85122 也有 “Object level nodes have just 1 output”）。
   - 链接：https://www.sidefx.com/forum/topic/39056/ ；https://www.sidefx.com/ja/forum/topic/78801/lofi/ ；https://www.sidefx.com/ja/forum/topic/85122/

5. **原生多输出节点的第二个输出如何被外部引用（forum）**：
   - 论坛 96568（2024）：没有 `/obj/geo/vellumsolver:2` 这类通用路径语法；`animatrix_` 反映 *“I asked for this a few years ago and SESI told me this is not possible.”*；只能用 `opoutputpath("/obj/geo/vellumsolver", 1)`，且**索引只数“已连接”的节点**，很脆弱。
   - 链接：https://www.sidefx.com/ja/forum/topic/96568/

### 小结（Q3）
- `maxoutputs` 参数真实存在，但对 SOP 型节点（含 Python SOP）**路由数据无效**，仅对 Subnet 型 HDA 生效（经 Output SOP）。
- `cookMySopOutput` 没有可用的公开成功先例，且行为无文档；**大概率是每输出口各自惰性 cook**，需要节点内部自行共享重计算。
- 结论：**HDK 多输出对 Cyl1nder 不是可靠路线**（与 Q1 一致）。

---

## Q4. Python SOP「多输入单输出」下，社区怎么实现「一次网络拉取、多个输出口共享」？

### 直接证据

1. **Python SOP 本身没有多输出口（forum 46835）**：
   - 用户 deadalvs 问「Python SOP 能不能有 n 个输出 plug 直接输出多路数据」；回答（Enivob）：*“That is what groups are for. Just assign the red ones to a red group and the green ones to a green group. In your down stream processing simply use the group filter option of the node to isolate those elements.”* → **官方/社区路线：单输出 + group/delete 拆分，而不是多输出口**。
   - 链接：https://www.sidefx.com/forum/topic/46835/

2. **官方「Per-node user-defined data」文档 —— `cachedUserData` 就是给 Python 节点跨 cook 缓存用的**：
   - *“The ‘cached’ user data dictionary is useful for nodes implemented in Python to save computed values between cooks to avoid recomputing them.”*
   - 官方示例：Cook tab 里先查 `node.cachedUserData("config_file_name")`，命中则直接用缓存对象，否则解析并 `setCachedUserData`——**正是「一次拉取、多次复用」的官方范式**。
   - 属性区别：`userData()` 只存字符串且随 hip 保存；`cachedUserData()` 可存**任意 Python 对象**、**不随 hip 保存（进程级）**、场景关闭即失。
   - 链接：https://www.sidefx.com/docs/houdini/hom/nodeuserdata

3. **论坛 43435「Python Node accessing Python Object」（forum）**：
   - *“the code itself would have to store python objects in the node's user data. You can specify strings in userData, or objects in cachedUserData.”*
   - 确认：Python 节点之间共享对象的标准渠道就是 `cachedUserData`（HOM 可以读任意节点的 `cachedUserData`，所以「core 节点写、多个下游节点读」可行）。
   - 链接：https://www.sidefx.com/ja/forum/topic/43435/

4. **论坛 97722（TOPs + Python SOP 场景，forum）** 展示的另一种共享模式——**落盘 + 读回**：
   - 流程：Python SOP 拉 JSON/网络 → `hou.Geometry.saveToFile()` 写成 `.bgeo` → 下游用 File SOP 读回；或直接把 `hou.Geometry` 当作内存容器在 TOPs Python Processor 里构造并序列化。
   - 链接：https://www.sidefx.com/forum/topic/97722/lofi/

5. **避免重复 cook 的官方/社区辅助节点**：
   - **Cache SOP**（官方文档：“Caches its input geometry for faster playback”）与 **Cache If SOP**（“Chooses whether to cook the input or re-use cached output based on configurable conditions”）——论坛 86880 建议用 Cache If 来抑制无关 recook。
   - 链接：https://www.sidefx.com/forum/topic/86880/ ；官方节点文档：https://www.sidefx.com/docs/houdini/nodes/sop/cache.html

6. **已知坑：Python SOP 场景保存后可能 recook（论坛 95178）**：
   - *“Why do Python Sop nodes recook after saving the scene? … One known issue is if your Python SOP was never cooked to begin with and there's some menu script parameter that references data from it.”* → 缓存方案必须处理「保存/加载后缓存失效导致重拉」的风险。
   - 链接：https://www.sidefx.com/ja/forum/topic/95178/

### 小结（Q4）
- **「一次网络拉取、多输出口共享」的社区标准做法 = 一个 core Python SOP 负责拉取/解析并把结果放 `cachedUserData`，N 个下游 Python SOP（或普通 SOP）各自读缓存、各产出一份 detail**。这与 Cyl1nder 拟定的「4 个 Python SOP + 进程内缓存」完全同构，且 `cachedUserData` 正是官方为 Python 节点准备的缓存设施。
- 备选：落盘 bgeo + File SOP（跨进程/跨 TOPs 更稳，但有 IO 成本）；或用 Cache If / Cache SOP 减少重复 cook。
- 注意：`cachedUserData` 不随 hip 保存，需按「参数+源版本」做缓存键，并在源变化时失效。

---

## 推荐路线（对「4 Python SOP + 一次网络缓存」的验证与修正）

### 已验证成立的部分
1. **「4 个 Python SOP + 一次进程内缓存」方向正确**：官方文档明确 `cachedUserData` 用于 Python 节点跨 cook 缓存；论坛确认可用它跨节点共享 Python 对象（core 写、下游读）。社区没有更好的「多输出」替代品给 Python SOP（它连多输出口都不支持）。
2. **Subnet/HDA 是唯一官方支持的 SOP 多输出外壳**：HDA 基于 Subnet 时原生 4 输出口，内部放 Output SOP 即可把 4 路数据引出——正好匹配「4 个 Python SOP 各接一个 Output SOP」的封装。
3. **blast 拆 prim 确实是纯点数据流的死路**：blast 按 prim 属性/组删除的是 primitive，纯点流没有 prim 可删；odforce 22448 的社区结论也是「合并后必须靠 pack + path 属性/组拆分」，本质要求有可寻址载体。

### 需要修正/加固的部分
1. **拆分逻辑从 blast 换成「点属性 + delete/group」或「pack + path 属性」**：对纯点数据，用 point attribute + Delete（按 point 组/表达式）或 Attribute Wrangle 标记 + Group Delete；对混合数据，用 pack + `path` 属性再 unpack，避免 detail 属性互相覆盖（odforce 22448 的最终方案）。
2. **缓存设计细节**：
   - 用 core 节点（或一个常驻 Python SOP）做「一次网络拉取 + 解析」，结果存 `cachedUserData`，缓存键包含源标识 + 参数版本；4 个输出 Python SOP 只做「读缓存 → 建自己的 detail」，命中时开销极小。
   - `cachedUserData` 是进程级、不随 hip 保存——**保存/重开场景后会重新拉取**；若想持久化，改走落盘 bgeo + File SOP（论坛 97722 模式）。
   - 每个 SOP 节点有自己独立的输出 detail 缓存，4 个输出 = 内存里 4 份 detail（除非用 packed/instanced 或让下游共享引用）；数据量大时注意内存。
   - 尽量不设时间依赖、不用 display/render flag 区分输出流（官方 49013 警告会引发大规模 recook）；必要时用 Cache If SOP 抑制无关 recook。
3. **HDK 多输出：不建议投入**。理由：(a) 唯一直接讨论帖（2015）失败；(b) 2026 年官方仍以 RFE#144407 挂起「普通 SOP 多输出」；(c) 2025 年 odforce 仍有人确认 SOP 上加了输出口也传不进数据；(d) `cookMySopOutput` 无文档、无公开成功先例，且疑似每个输出口各自惰性 cook、需自行共享计算。真要评估，可订阅 RFE#144407 或试用 SOP Invoke + 空 compiled block 变通（alex_sidefx 2026 帖子）。
4. **对「1 个 Python SOP 合并输出」的修正**：如果坚持单 Python SOP，那下游必须能区分数据流——纯点数据建议给每类数据打 **point 属性（如 `stream`）**，下游用 Group/Delete 按 point 属性拆分，替代 blast 按 prim 拆分。

### 一句话结论
> 走「Subnet HDA（4 输出）+ 4 个 Python SOP + core 节点 `cachedUserData` 进程内缓存」是社区认可、官方文档背书的最稳路线；blast 按 prim 拆分改为按 point 属性/pack-path 拆分即可解决纯点数据流；HDK `cookMySopOutput` 多输出在当前公开证据下不可行，不宜作为依赖。

---

## 风险清单

| 风险 | 说明 | 缓解 |
|---|---|---|
| HDK 多输出不可用 | 2015 帖子失败、2026 RFE#144407 未实现、2025 odforce 确认数据传不进 SOP 输出口 | 不依赖 HDK 多输出；订阅 RFE 或用 SOP Invoke 变通 |
| `cookMySopOutput` 行为未定义 | 官方无文档；推断为按输出口惰性 cook，需节点内自行共享计算 | 避免使用；若测试需做最小 Demo 验证 |
| blast 无法处理纯点数据 | blast 只删 primitive，纯点流无 prim 可寻址 | 改用 point 属性 + delete/group，或 pack + path 属性 |
| 进程内缓存不持久 | `cachedUserData` 不随 hip 保存，场景重开会重拉网络 | 接受重拉，或落盘 bgeo + File SOP 持久化 |
| 缓存失效/脏数据 | 源文件或参数变化后缓存未按版本键失效 | 缓存键含源标识 + 参数版本 + 修改时间 |
| 内存 N 份 detail | 4 个输出 SOP 各自持有独立 detail 缓存 | 数据大时用 packed/instanced 或共享引用 |
| 意外 recook | 保存场景、menu script 引用、display/render flag 切换都可能触发 recook | 避免时间依赖；用 Cache If / Cache SOP；参考论坛 95178、49013 |
| 第二输出引用脆弱 | 原生多输出节点（如 Vellum）的第二输出无通用路径语法，`opoutputpath` 只数已连接节点 | 尽量走 HDA 封装 + Output SOP 命名输出 |

---

## 附：完整链接清单

**SideFX 官方论坛（forum）**
- Multiple outputs from HDK node?（2015）：https://www.sidefx.com/forum/topic/39232/
- 同上 lofi 版：https://www.sidefx.com/forum/topic/39232/lofi/
- SOP create - is it possible to create more than one output?（2025-2026，含 RFE#144407 / SOP Invoke 变通）：https://www.sidefx.com/ja/forum/topic/102813/
- HDA multiple outputs（2015-2019）：https://www.sidefx.com/forum/topic/39056/
- subnet / HDA 双输出步骤（2021-2026，Houdini 20.5）：https://www.sidefx.com/ja/forum/topic/78801/lofi/
- Being able to display and output different geometry in an hda（2017）：https://www.sidefx.com/forum/topic/49013/
- subnet (digital asset): more out connections：https://www.sidefx.com/forum/topic/32221/
- Is it possible to display another output on viewport?（2024）：https://www.sidefx.com/ja/forum/topic/96740/
- Path to second output of a node?（2024）：https://www.sidefx.com/ja/forum/topic/96568/
- python SOP with n outputs (node plugs)：https://www.sidefx.com/forum/topic/46835/
- Python Node accessing Python Object（cachedUserData 跨节点）：https://www.sidefx.com/ja/forum/topic/43435/
- Setting up TOPs graph / Python SOP 缓存落盘（2024）：https://www.sidefx.com/forum/topic/97722/lofi/
- no "On Incoming Geometry Changed" event handler for HDAs?（Cache If SOP）：https://www.sidefx.com/forum/topic/86880/
- Why do Python Sop nodes recook after saving the scene?：https://www.sidefx.com/ja/forum/topic/95178/
- subnet with multiple outputs at obj level：https://www.sidefx.com/ja/forum/topic/85122/

**odforce**
- Foreach, multiple outputs（合并 + path 属性拆分的共识）：https://forums.odforce.net/topic/22448-foreach-multiple-outputs/
- How to put my asset in the right section in tab menu?（2025，SOP 加输出无效 + OP_Operator 构造签名）：https://forums.odforce.net/topic/59396-how-to-put-my-asset-in-the-right-section-in-tab-menu/

**官方文档**
- HDK SOP_Node Class Reference（cookOutput / getOutputSop）：https://www.sidefx.com/docs/hdk/class_s_o_p___node.html
- HDK SOP_Node.h 源码（cookOutput 注释）：https://www.sidefx.com/docs/hdk/_s_o_p___node_8h_source.html
- HDK SOP Concepts（cookMySop / duplicateSource）：https://www.sidefx.com/docs/hdk/_h_d_k__data_flow__s_o_p.html
- HOM Per-node user-defined data（cachedUserData 官方示例）：https://www.sidefx.com/docs/houdini/hom/nodeuserdata
- Python geometry node（Maintain State）：https://www.sidefx.com/docs/houdini/nodes/sop/python.html
- Vellum brush（vellumcloth1 双输出示例）：https://www.sidefx.com/docs/houdini/vellum/brush.html

**第三方博客**
- James Robinson VFX：Display Intermediate Results And Visualization Geo in an HDA（2023）：https://www.jamesrobinsonvfx.com/blog/display-intermediate-results-and-viz-geo/