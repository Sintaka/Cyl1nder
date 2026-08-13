# 时间轴系统设计 / Timeline system design

> 日期：2026-08-12 · 角色：并行子智能体（时间轴系统设计，仅设计不实现）· 仓库：`D:\code\dev\Cyl1nder` · 分支：`codex/cyl1nder-v0`
> 写集：**仅本文件** `devlog/timeline-design.md`（新建）。未改任何代码 / 其它 devlog；不 commit、不重启任何服务。
> 方法：只读按序读 devlog（protocol / decisions / sync-architecture / livelink-roadmap / streaming-push-dirty / python-runtime-design / streaming-hda-review / streaming-sync-gap / README）+ 只读源码（bridge/bridge/protocol.py、routes.py、ws.py、state.py、workspace.py、registry.py；hda/src/cyl1nder_hda.py、cyl1nder_bridge.py；web/src/bridge/client.ts、protocol/types.ts、app/layout.ts、app/scrub.ts、main.ts）+ grep（pending/kick/_sync_loop/status/frame/fps/timeline）。
> **本轮仅设计不实现**：协议三处（protocol.py / types.ts / protocol.md）与任何代码改动全部留到实现阶段，届时按铁律同步。
> **状态注记（v0.1.00100，2026-08-14）**：`本地优先`时间轴 v1 已按 timeline-plan.md Phase A 落地——H→C inputs 捎带 frame → web 逐帧收集 → 纯本地 scrub（零 /stream、零 pushOutputs、零 Houdini 往返）。本设计的 engaged 门控 / C→H setFrame / fps 跟随 / 播放对齐留待 Phase B 手动同步开关后按需实现。

## 0. 一句话结论

时间轴 = bridge 每 serial 一份 **`TimelineState`**（frame/fps/engaged/h2cSeq/c2hSeq/pendingFrame/dragging/ts，`bridge/bridge/state.py` 新增小 store）。**H→C（读）复用 HDA 现有 `/pending` 轮询**：HDA 的 `_sync_loop` 把 `frame/fps/engaged/h2cSeq` 作为 GET 查询参数捎带上传（零新请求、天然 33–500ms 自适应节奏）；**C→H（写）复用 kick 模式**：web → WS `{type:"timeline",frame,seq}` → bridge 存 `pendingFrame`（latest-wins）→ `/pending` 响应新增 `timelineFrame` → HDA 主线程 `hou.setFrame`。**门控 = HDA 锚**：`engaged = selected OR recentlyCooked`（Houdini 侧判定、经轮询上报）；不 engaged 时 Cyl1nder 走本地帧（默认 30fps），Houdini 不参与。

## 1. 目标 / 需求拆解

| # | 用户原话 | 设计含义 |
|---|---|---|
> **状态注记（v0.1.00063 归档前）**：本设计**未实现**。v0.1.00056 起 HDA 主通道为 `/stream` 长轮询（`/pending` 降为 fallback），Phase1 的「复用 `/pending` 捎带 frame/fps/engaged」需改为**复用 `/stream`**（事件携带 timeline 字段），其余方案要点（engaged 门控 / latest-wins / 回显抑制 / h2cSeq 自愈）仍适用。

| 1 | 默认 30fps | 无 Houdini / 未连接 / 本地模式时 fps=30；Cyl1nder 本地时间轴始终可跑 |
| 2 | Cyl1nder 启动的时候和 Houdini 中的场景 fps 同步 | 启动/连接时读取 Houdini 场景 `hou.fps()` 覆盖本地 fps；之后 fps 变化也跟随（H→C） |
| 3 | 时间轴双向同步 | H→C：Houdini playhead → Cyl1nder 帧；C→H：Cyl1nder 拖帧 → Houdini playhead |
| 4 | hda cook 状态下拖动任意一边才能双向同步 | 双向同步以 **HDA 锚定（engaged）** 为门控：只有 HDA 被经过（在 cook/显示链中）或被选中时，两边才互相影响 |
| 5 | 不要我在 Houdini 里没经过或选中 HDA 也在同步 | 未锚定时：Cyl1nder 拖动只动本地帧；Houdini 拖动/播放不影响 Cyl1nder；fps 启动同步除外（纯数值、无副作用） |

术语表：

| 术语 | 定义 |
|---|---|
| frame | Houdini playhead 当前帧（`hou.frame()`，可为小数）；Cyl1nder 时间轴显示同一数值 |
| fps | 场景帧率（`hou.fps()`），默认 30 |
| engaged（锚定） | HDA 侧门控布尔：`selected OR recentlyCooked`，见 §4 |
| H→C | Houdini → bridge → web（读：帧/fps/engaged） |
| C→H | web → bridge → HDA → Houdini（写：设帧） |
| h2cSeq / c2hSeq | 两方向各自单调序号，乱序/重放丢弃依据 |

## 2. 同步语义（状态机）

```
[Houdini] HDA cook/轮询 ──> bridge 8375 ──> [Web] 底部栏时间轴
  cook 主线程采样 frame/fps/selected → _TIMELINE_CACHE
  _sync_loop ── GET /pending?frame&fps&engaged&h2cSeq ──> TimelineStore ── WS {type:"timeline"} ──> 显示
  _sync_loop 消费 timelineFrame <── (/pending 响应) <── pendingFrame(latest-wins) <── WS {type:"timeline",frame,seq} <── 拖动
  主线程 hou.setFrame(frame) <── hdefereval.executeDeferred ──┘
```

| 场景 | engaged | 行为 |
|---|---|---|
| 启动/连接，HDA 在线 | — | 拉 `GET /api/hda/{serial}/status` 的 `timeline` 块：fps 覆盖本地（30 兜底）、frame 初始化 |
| Houdini 拖动/播放 playhead | true | H→C：`_sync_loop` 轮询上报 → bridge → WS → web 跟随（web 非拖动期） |
| Houdini 拖动/播放 playhead | false | H→C 不上报（或上报但 web 不应用）：web 保持本地帧 |
| Cyl1nder 拖动帧 | true | C→H：web 发帧号（节流 + 拖动期抑制回显）→ bridge → `/pending.timelineFrame` → HDA `hou.setFrame`；HDA recook → cook 采样回传 → web 回显（bridge 去重） |
| Cyl1nder 拖动帧 | false | C→H 丢弃：只动本地帧（本地时间轴照常走） |
| Houdini 里未经过/未选中 HDA | false | 双向都不同步（规则 4/5） |

> 关键取舍：**门控对两方向同时生效**，判定权在 Houdini 侧（唯一知道「选中/经过」的地方），经轮询把 `engaged` 镜像到 bridge/web。web 再叠加「拖动抑制」避免回显打架（§5）。

## 3. 数据通道选型

### 3.1 H→C（读）三选一

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| A（推荐） | **复用 `/pending` GET**：`_sync_loop` 在 GET `/api/hda/{serial}/pending?since=…` 时捎带 `frame&fps&engaged&h2cSeq` 查询参数；bridge 写入 TimelineStore 并广播 | 零新端点、零新请求；自适应节奏（33ms 活跃 / 500ms 空闲）天然匹配拖动与心跳；协议改动最小 | 把「状态上报」混进「dirty 检查」，`/pending` 语义变重；GET 参数进日志（可接受） | **Phase1 采用** |
| B | 新 `PUT /api/hda/{serial}/timeline`（防抖线程，仿 inputs push） | 语义干净、与 dirty 解耦 | 多一条 HTTP 往返与线程；时序与 /pending 轮询重复 | Phase2 若 A 的语义问题暴露再上 |
| C | 未来 `/stream`（long-poll NDJSON，bridge→HDA 方向，见 streaming-push-dirty.md） | 事件级低延迟 | `/stream` 是 C→H 方向；H→C 仍需 A/B 反向 | Phase3 播放/动画帧流时配合 |

### 3.2 C→H（写）

| 环节 | 设计 |
|---|---|
| web → bridge | WS 客户端消息 `{type:"timeline", frame:number, seq:number, dragging?:boolean}`（低延迟、复用现 WS 连接；REST `PUT /timeline` 作兜底） |
| bridge | 校验 serial → TimelineStore：**latest-wins**（只保留最新 frame；`c2hSeq` 单调，乱序/旧 seq 丢弃）；`engaged=false` 时仍记本地帧但不置 `pendingFrame`（不转发给 HDA） |
| bridge → HDA | `/pending` 响应新增 `"timelineFrame": <number|null>`（+ 可选 `timelineSeq`）；HDA 轮询拿到后置 `_TIMELINE_CACHE["pendingFrame"]` |
| HDA → Houdini | 主线程 `hdefereval.executeDeferred(lambda: _apply_timeline_frame(...))`；实现时二选一并在目标 Houdini 版本验证：`hou.setFrame(f, suppress_cook=True)`（设帧 + 抑制立即 cook）或 `hou.playbar.setPlaybarFrame(f)`（只移 playhead）；与上次已应用 frame 相同则跳过（去重） |

### 3.3 协议改动清单（实现阶段三处同步：protocol.py / types.ts / protocol.md）

| 位置 | 新增 |
|---|---|
| `protocol.py` | `TimelineState(BaseModel)`：`frame:float=0`、`fps:float=30.0`、`engaged:bool=False`、`h2cSeq:int=0`、`c2hSeq:int=0`、`pendingFrame:float|None=None`、`dragging:str|None=None`、`ts:float=0` |
| `GET /api/hda/{serial}/status` | 响应加 `timeline` 块（TimelineState 镜像，供启动同步） |
| `GET /api/hda/{serial}/pending` | 请求可带 `frame/fps/engaged/h2cSeq`；响应加 `timelineFrame/timelineSeq` |
| WS client→server | `{type:"timeline", frame, seq, dragging?}` |
| WS server→client | `{type:"timeline", frame, fps, engaged, seq, source:"hou"|"web"|"bridge"}` |
| `types.ts` | 上述类型镜像 + `TimelineState` |

## 4. 门控方案（HDA 锚，核心）

### 4.1 定义

```
engaged = selected(Houdini 中选中该 HDA) OR recentlyCooked(最近 WINDOW 内该 HDA 的 python SOP 发生过 cook)
recentlyCooked = now - lastCook <= ENGAGED_WINDOW   # 默认 1.0s，HDA 参数化（如 timeline_engaged_window）
```

- 用户语义映射：**「经过」≈ recentlyCooked**（正在被 cook 的 HDA 必然在被经过的显示/cook 链上）；**「选中」≈ selected**。满足其一即可同步。

### 4.2 为何不用现有 lastActivity / lastSeen（用户明确问）

| 字段 | 现状语义（代码证据） | 能否作门控 | 结论 |
|---|---|---|---|
| `lastSeen` | `/pending` 心跳 touch，Houdini 活着就持续刷新（registry.py touch；routes.py pending） | **不能**：HDA 没被选中/没被经过也一直新鲜 → 会违反「没经过/选中也在同步」 | 仅作在线/离线判定 |
| `lastActivity` | 仅 inputs/outputs 写入时 mark（registry.py mark_activity；routes.py put_inputs/put_outputs） | **不充分**：只标记「推过数据」，与「被选中/被经过」无关；cook 未变数据时无活动 | 仅作活跃度参考 |
| **engaged（新增）** | HDA 侧回传「本节点被选中/在处理」标志 | **是（门控唯一来源）** | 采用：HDA 采样 → 轮询上报 → bridge/web 镜像 |

### 4.3 判定与采样（Houdini 侧，主线程优先）

| 采样点 | 内容 | 线程 | 说明 |
|---|---|---|---|
| python SOP cook（主线程，必做） | `lastCook=now; frame=hou.frame(); fps=hou.fps(); selected=hou.node(path).isSelected()` 写入 `_TIMELINE_CACHE`（加锁） | 主线程 | 「经过」的主来源；也是「选中且被显示」的天然采样 |
| `_sync_loop` 后台线程（Phase2 可选） | 直接读 `hou.frame()/hou.fps()/isSelected()` 补帧 | 后台 | 覆盖「显示但网络无时间依赖、cook 不重跑」的播放/scrub；**需先验证 HOM 后台线程只读安全性**（python-runtime-design.md 铁律：hou 只在主线程碰）；验证不过改用 runtime panel QTimer |
| python runtime panel（Phase2，可选） | QTimer ~10Hz 主线程采样同上 | 主线程 | 复用 `hda/panels/cyl1nder_runtime.pypanel` 模式（python-runtime-design.md §2.1）；panel 需可见才运行 |

### 4.4 engaged 上报链路

```
HDA cook / panel 采样 ──> _TIMELINE_CACHE（模块级 dict + lock）
_sync_loop（已有后台线程，33–500ms）── GET /pending?frame&fps&engaged&h2cSeq ──> bridge TimelineStore
bridge ── WS {type:"timeline", …} ──> web 底部栏（锚定灯 + 帧/fps）
```

- 心跳兜底：`_sync_loop` 空闲期 500ms 仍上报 → engaged 变化延迟 ≤ 500ms。
- 桥重启自愈：`h2cSeq` 单调递增，bridge 重启归零 → HDA 重新从当前值上报（与 `get_outputs_since` 的 `since>rev→全量` 同理，状态对比天然自愈）。

### 4.5 未锚定行为（本地模式）

- web 时间轴独立运行：本地帧 + 本地 fps（默认 30），拖动/播放只改本地 store。
- UI 明示：时间轴右侧小灯「锚定 Houdini」/「本地」，本地时帧号区弱化。
- 恢复锚定：**以 Houdini 当前帧为准**覆盖本地帧（避免两边数值分歧）。

### 4.6 边界与已知取舍（如实记录）

| 情形 | 行为 | 备注 |
|---|---|---|
| 静态网络（无时间依赖）被显示、scrub 不 recook | recentlyCooked 过期 → 未锚定 → 不同步 | 符合「hda cook 状态下才能同步」字面语义；若产品要「显示即经过」，Phase2 加 displayNode 检测（`node.parent().displayNode()` 链）或 T2 采样 |
| 仅选中、未显示、无 cook | Phase1 未锚定；Phase2 若 panel/T2 可用则锚定 | 选中检测依赖 panel 或后台线程 isSelected 验证结果 |
| Houdini 播放中 | H→C 持续跟随（轮询节奏）；此时 web 拖动仍可发帧（H 从新帧继续播放） | 播放态视为「H 持续写」；冲突见 §5 |

## 5. 双向拖动的冲突 / 节流

| 机制 | 设计 |
|---|---|
| latest-wins | 两方向各自单调 seq；bridge 只保留最新（H→C 按 `h2cSeq`、C→H 按 `c2hSeq`，旧 seq 丢弃） |
| C→H 节流 | web 拖动：pointermove → rAF 合并 → 至多每 50ms 发一帧（或对齐 HDA 活跃轮询 33ms），pointerup 发最终帧 + `dragging:false`；**只发帧号**（用户原话「拖动帧时只发帧号」），不带几何/其它负载 |
| 回显抑制 | web 拖动期间忽略收到的 H→C `timeline` 消息（本地帧为准）；松手后若 H 帧 ≠ 本地帧，以最后一次 C→H 为准 |
| 重复帧去重 | HDA 应用层：`pendingFrame == 上次已应用 frame` 则跳过 `setFrame`；bridge：H→C 上报帧与已存相同 → 不广播（仿 `_same_content` echo 去重） |
| 双写冲突 | `dragging:"web"|"hou"|null` 作信息字段（不强制互斥）；真冲突由 latest-wins + 回显抑制兜底，不引入锁 |
| 播放叠加 | Houdini 播放 = 连续 H→C 写；web 拖一次 C→H 后 H 继续播（行为合理；Phase3 再评估「拖动即暂停」） |

## 6. UI 设计（底部栏时间轴）

> 承载：底部栏 = 非 docking 组件（web 并行 agent 正在添加）；时间轴挂在其上。**本设计不实现 web。**

| 元素 | 行为 |
|---|---|
| 时间轴游标（可拖） | 拖动 → 更新帧号 + C→H（engaged 时） |
| 帧号输入 | 可键入/滚轮，回车应用（同拖动语义） |
| 播放 / 停止 | Phase3：本地播放器，engaged 时可对齐 Houdini playbar |
| 上一帧 / 下一帧 | ±1（整数帧）；Shift 加速 ±10 |
| fps 显示 | 只读跟随 H（启动同步 + 变更跟随）；Phase2/3 提供下拉（C→H 写 fps 可选，`hou.setFps`） |
| 锚定灯 | ● Houdini 锚定 / ○ 本地（engaged 指示；本地帧 fps=30） |
| 播放范围（Phase3） | start/end + 循环开关，对齐 `hou.playbar` range |

web 数据：`stores/workspace.ts` pub-sub store 增 `timeline` 切片 `{frame, fps, engaged, dragging}`（订阅即渲染）；不引入新框架。

## 7. 分期

| 阶段 | 内容 | 涉及（实现时） | 验证 |
|---|---|---|---|
| **Phase1 单向读** | H→C 帧+fps（/pending 捎带）；启动 fps 同步；engaged=recentlyCooked（cook 采样）+ selected（cook 时采样）；web 底部栏只读时间轴（本地默认 30fps）；本地模式 | protocol.py/types.ts/protocol.md 三处；state.py TimelineStore；routes.py /pending & status；cyl1nder_hda.py cook 采样 + _sync_loop 上传；web timeline store + 底部栏 | pytest（TimelineStore、/pending 参数解析、status.timeline）；hython 冒烟（cook 采样）；vitest/tsc（store、时间轴组件）；E2E（H 拖帧→web 跟随；不经过→web 不动；fps 启动同步） |
| **Phase2 双向拖帧** | C→H `setFrame`（/pending.timelineFrame → HDA 主线程 setFrame）；web 拖动节流 + 回显抑制 + latest-wins；selected 采样升级（T2 线程安全验证或 runtime panel）；fps C→H 写入（可选） | ws.py 客户端消息；web 拖动交互；HDA `_apply_timeline_frame`；可选 `PUT /timeline` 或 panel | 同上 + E2E（双向拖动、冲突、回显去重） |
| **Phase3 播放/循环/动画帧流** | 播放/循环/range；对齐 `/stream` 事件通道（streaming-push-dirty.md §2.4）；Apex Animation Layer 写 key 时 `frame` 对齐（python-runtime-design.md §4.1） | bridge `/stream`；web 播放器；HDA 消费线程 | 完整 E2E + 动画帧流压测 |

## 8. 验证（对齐 AGENTS.md 铁律）

- bridge：pytest（TimelineStore 单测：latest-wins、seq 乱序、engaged 门控、/pending 参数与响应）。
- web：`tsc --noEmit` + vitest（store 切片、时间轴组件、拖动节流纯函数）。
- hda：hython 冒烟（cook 采样写 `_TIMELINE_CACHE`；`_sync_loop` 上传参数）。
- 跨端：E2E（启动 fps 同步；H→C 跟随；C→H 设帧；门控两态；本地模式）。

## 9. 风险与待验证点

| # | 风险/待验证 | 缓解 |
|---|---|---|
| 1 | HOM 后台线程读 `hou.frame()/isSelected()` 的安全性（python-runtime-design 铁律：hou 只主线程） | Phase1 只用 cook 主线程采样；T2/panel 留 Phase2，先做最小实验 |
| 2 | `hou.setFrame(suppress_cook=…)` / `hou.playbar.setPlaybarFrame` 的确切签名随 Houdini 版本而异 | 实现时在目标版本 hython 验证；二者二选一 |
| 3 | 静态网络「显示但不 recook」→ 不锚定（§4.6） | 字面符合需求；如需「显示即经过」加 displayNode 检测（Phase2 选项） |
| 4 | `/pending` 语义变重（dirty 检查 + 状态上报 + C→H 指令） | 字段隔离、HDA 侧轻量解析；若恶化再拆 B 方案 `PUT /timeline` |
| 5 | 拖动回显打架 | web 拖动期抑制 + bridge/HDA 双重去重（§5） |
