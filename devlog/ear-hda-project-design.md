# 挂耳 HDA + 项目绑定 + 轨迹页 —— 下一步架构设计提案

> v0.1.00103 提案稿 · 2026-08-14 · 主进程起草（前置分析见 timeline-sync-lag-analysis.md）。
> 状态：**提案待用户拍板**。用户原话要点已并入 §2/§3/§4；标注 ⚖️ 的是需要用户确认的决策点。实现分阶段，本轮不写代码。

## 0 问题陈述（用户原话归纳）

- HDA 能做到 geo 全流程 IO，但**实时性操作、非 geo 同步、小参数增量修改**无法覆盖。
- 例：只想改 `transform1` 的 translate 参数并让它与 Cyl1nder 里 transform 的 T 属性同步——现在没有轻量通道。
- 目标：**通过 runtime python 把用户的手延伸到整个 Houdini**，而不是等官方暴露适配参数；后续延伸到 apex scene animate 运行时修改、packfolder Animation Layer 数据同步。
- 多 HDA 场景：一个 hip 里会有多个 HDA，现有"一个页面绑定一个 serial"架构必须升级为**项目绑定**。
- 审计：一个参数可被多个项目引用/运行时修改 → 需要**轨迹页**监控"谁动了这个数据"。

## 1 三层身份模型

| 层 | 身份 | 序列号 | 生命周期 |
|---|---|---|---|
| 项目 Project | 工作单元（页面绑定对象） | `P1-<b36ms>-<4rand>`（新前缀，协议新增） | 显式创建；**隐式**（打开 `?serial=` 时若无项目则自动建单成员项目） |
| 通道 Channel | 项目成员：HDA（geo）/ 挂耳（参数）/ 属性通道… | 复用各自既有标识（HDA/挂耳 = `C1-` serial；参数通道 = 绝对路径字符串） | 在「关联注册大全」中登记 |
| 实例 Instance | Houdini 侧真实节点 | 节点绝对路径 + hip | 由 python runtime 存活探测 |

- 现有 web 页面：`?serial=X` → 自动解析为「含 X 的（隐式）项目」，nodeview 根部从 `/<serial>/` 改为 `/<projectSerial>/`（根 = 虚拟项目节点，成员 = 各通道）。向后兼容：单 HDA 场景行为不变。
- registry 扩展：`registry.json` 同目录新增 `projects.json`（`{projectSerial, label, createdAt, members: [channelRef…]}`）；channelRef = `{kind: "hda"|"ear"|"param", serial?, nodePath?, absolutePath?, hip, label}`。

## 2 挂耳 HDA（标签挂耳，Tag-Ear）

### 2.1 形态
- 节点外形：nodeview Z 形状选择器里的 **第 22 号**（默认圆角矩形是第 23 号）——纯视觉标识，build_hda.py 生成时设置。
- 结构：Subnet（同 Cyl1nder 模式），薄壳 python SOP + `cyl1nder_ear.py` 运行时模块；**输入 N（≥1，首个为上游）→ 输出 1（passthrough 上游几何）**，可串联在 `transform1` 之后、喂给下游 `transform`。⚖️ 待确认：挂耳是否需要几何 passthrough，还是纯参数侧挂件（不进几何链、只并排摆放+连线表示关联）？两者都支持的成本差不多，pass-through 版本能复用现有序列化，但会在几何链里多一个节点。
- 隐藏参数：`cyl1nder_serial`（沿用不可变序列号规则，复制节点生成新号——铁律 1 适用）。

### 2.2 注册流程（第一次）
1. 用户把挂耳放在目标节点下游并连线；在挂耳参数列表里编辑条目（参数名、相对/绝对路径、模式）。
2. 挂耳 **只在被修改时 cook**：把条目翻译成**绝对路径**（相对路径以「上游连接节点」为基准解析，如 `tx` → `/obj/geo1/transform1/tx`；⚖️ 基准锚 = 挂耳的第 0 输入来源节点，还是手动填写的目标节点路径？），连同 `serial/earNodePath/hip` 一起 PUT 到 bridge 注册：`POST /api/projects/{project}/channels`（或先注册到全局关联注册大全，再被项目引用——⚖️ 二选一，见 §5 问题 3）。
3. 注册成功后挂耳**静默**（不再主动推数据；上游变化导致 Houdini 自然 cook 它时也只做轻量心跳：推"我还在 + 上游还是那个节点"的摘要，节流 ≥5s）。

### 2.3 心跳 / 存活确认（用户要求：确认挂耳是否活着、上面连的是不是同一个节点）
- **主动探测（主路径）**：Cyl1nder 拿着注册的 `earNodePath`，经 bridge `POST /houdini/cmd`（`nodes.get_node_info` / `code.execute_python`）确认：节点存在、类型仍是挂耳、`cyl1nder_serial` 未变、输入连接来源节点路径与注册时一致。探测是显式/按需（页面打开、心跳间隔 10-30s 由配置定）。
- **被动心跳（辅助）**：挂耳 cook 时捎带摘要（同 inputs 推送模式，节流）。Houdini 主线程繁忙/挂耳从不 cook 时以主动探测兜底。
- 结论不一致 → 页面显示通道失联（沿用 HDA offline 徽标机制）。

### 2.4 参数修改（注册之后的日常——**不走 HDA**）
- Cyl1nder 修改参数一律经 **runtime python / 官方命令**：`POST /houdini/cmd parameters.set_parameter {node_path: 绝对路径, parm_name, value}`（现有代理已通，实测可用）；批量用 `parameters.set_parameters`；表达式用 `set_expression`。
- **回读**：① 按需 `parameters.get_parameter`；② 低频轮询（≤ sync fps）；③ Houdini 侧主动变化由挂耳 cook 心跳捎带（若该参数驱动了几何）。三者组合，事件优先。
- 这正是"Cyl1nder 存在的意义"：参数面板（web param.ts 已具备 set/get 形态）未来直接对接这些通道，web 上改 T 属性 → runtime 写 `transform1/tx` → Houdini 生效 → cook 心跳回传几何（若在链上）。

### 2.5 未来延伸（本提案留位）
- apex scene animate 运行时修改、packfolder Animation Layer 数据同步：都映射为「注册一个非 geo 数据源（绝对路径/对象句柄）+ runtime python 读写器」的通道类型——挂耳负责注册，读写器是 bridge 侧 python 脚本（`bridge/bridge/channels/apex_anim.py` 之类），保持 HDA 薄。

## 3 项目（Project）与关联注册大全

- **关联注册大全**：新页面/面板（overview 扩展）：列出全部通道（hda/ear/param）+ 项目；把通道拖入项目 = 项目成员。数据在 bridge `projects.json`。
- **nodeview 根部改项目驱动**：`/<projectSerial>/` 下挂成员通道节点；图快照（graph.json）按 project 存（`projects/<projectSerial>/graph.json`），旧 `Cyl1nder/<serial>/` 快照继续可读（迁移读：单成员项目直接映射）。
- **多 serial WS**：web 对项目内每个 hda/ear 通道各开一条 WS（现有机制复用），消息都打 project 上下文标签；bridge 侧不改路由模型（仍按 serial 路由）。
- ⚖️ 问题 4：项目是否需要显式"保存/打开项目文件"（类似场景文件），还是纯 bridge 注册表 + 隐式？

## 4 轨迹页（Trace，像 DeepSeek Harness 监控谁动了数据）

- **事件模型**（bridge 侧新增轻量 `TraceStore`，内存环形 10000 条 + 可选落盘 `bridge/data/trace/<projectSerial>.ndjson` 按天滚动）：
  `{ts, project, channel, actor: "web-gizmo"|"web-param"|"runtime-python"|"ear-hda"|"hda-cook"|"bridge", action: "param-set"|"expr-set"|"inputs-push"|"outputs-edit"|"register"|"heartbeat", target: 绝对路径/端口索引, digest: 新旧值指纹（几何用 rev+counts+内容 hash，参数用 old→new 值截断）}`
- **埋点**：现有 put_inputs / put_outputs / WS edit / houdini cmd·python / 挂耳注册与心跳路径各加一行 trace 记录（主进程合并时逐点补）。
- **页面**：`/trace.html?project=…`（overview 风格）：按时间/通道/actor 过滤，行展开看 digest；挂耳注册的每个参数 = 一个可过滤 key。
- 目的：一个参数被多个项目引用/修改时，可审计"谁、何时、改了什么、经哪条通道"。

## 5 待用户拍板（⚖️ 汇总）

1. 挂耳是否 passthrough 几何（进链），还是纯侧挂（只连线标识、不进几何数据流）？
2. 挂耳参数条目形态：字符串路径列表（`tx;ty;tz` / `../tx`）还是逐条下拉选择目标节点参数（menu 生成）？相对路径基准 = 挂耳第 0 输入的上游节点？
3. 注册归宿：通道先入全局「关联注册大全」再由项目引用（多对多，支持"一个参数被多个项目引用"），还是直接注册进当前项目（单归属）？用户明确说过"一个参数可以被好几个项目引用"→ 建议**多对多**（通道全局唯一，项目只存引用）。
4. 项目持久化：bridge 注册表即可（推荐），还是需要项目文件导出？
5. 轨迹落盘：仅内存环形 + 页面查看（推荐先做），还是每天 ndjson 落盘？
6. 隐式项目命名：`P1-…` 自动生成即可，还是弹窗让用户命名？

## 6 分期（拍板后实施顺序）

| 期 | 内容 |
|---|---|
| P1 | 挂耳 HDA 最小闭环：外形 #22、参数列表注册、绝对路径翻译、bridge 通道注册端点、存活探测（runtime）、`parameters.set_parameter` 修改通道、web 参数面板对接一个参数试点 |
| P2 | 项目层：projects.json、`?project=`、nodeview 项目根、多 serial WS、关联注册大全面板（overview 扩展）、单 serial 隐式项目兼容 |
| P3 | 轨迹页：TraceStore + 埋点 + /trace.html；多项目引用同一通道的审计 |
| P4 | 延伸通道：apex scene animate / Animation Layer 读写器；时间轴互补通道（挂耳 cook 主线程捎带 frame，绕开 dispatcher 忙时延迟，见 lag 分析 §4） |
