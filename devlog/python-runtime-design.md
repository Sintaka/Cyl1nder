# Python Runtime 接口设计 — Houdini 接收端（transform 流式 panel 原型）

> 日期：2026-08-11 · 角色：并行子智能体（Houdini python runtime 接口设计 + transform 流式 panel）· 仓库：`D:\code\dev\Cyl1nder` · 分支：`codex/cyl1nder-v0`
> 写集：本文件 + `hda/panels/cyl1nder_runtime.pypanel`；只读调研 `D:\code\dev\Houdini\spaceMouse2`（未改动）。不 commit、不重启 Houdini。

## 0. 结论（3 行）

1. **接收端不是 SOP HDA**，用「常驻 Houdini Python Panel（带 UI）⇄ 可选 hou 后台脚本」承接 Cyl1nder 的流式 channel 更新；**transform translate 三 float 先行**，panel 原型已落在 `hda/panels/cyl1nder_runtime.pypanel`（Mock 自测 + Bridge HTTP 轮询双数据源）。
2. **传输不引 WS 依赖**：Houdini 内置 python 用 urllib 走 HTTP 轮询/长轮询（沿用 `hda/src/cyl1nder_bridge.py` 的 urllib + 后台线程模式）；流式协议定义为**增量 `set_channels`**（node + channels 稀疏子集 + seq/ts/frame），接收端 latest-wins 反压。
3. **Apex 最终目标（监控 Animation Layer 并实时写回）已记入 `6`**：核心难点 = scene data 里的 pack 类类型（graph_parms / control_manager / animbinding）、Channel List 是 channel primitive 几何体**不可像 rigpose 那样按 `t1x/r3y/s7x` 拆 parm**、关节世界坐标需 `control_manager.getControlXform/getControlData` 沿父子级累积。

## 1. 背景与目标

用户原话要点（转述）：

- 在 Cyl1nder 中更新了一套 channel list 的动画帧，但**只更新了一部分** → 需要能利用**流式传输优势**的同步方式和对接方。
- 对接方可能不是 HDA，而是**后台持续运行的 python 服务**；Houdini 支持 python runtime，要利用好。
- 第一个同步目标：**transform 节点的 translate 选项**（三个 float）；接收端先开发一个 **Houdini 内的 python panel**——一般不应该是 HDA，因为这显然不是 SOP 节点的工作。
- panel 以合理方式与 Cyl1nder 沟通，对**适配好的节点/数据做流式修改**；先拿 transform 下手（只有三个 float，非常方便），**重点设计交互界面与交互逻辑**。
- **最终目标（记下来）**：监控 **Apex Animate Scene SOP 中的 Animation Layer**，并且**实时写回去**。

## 2. spaceMouse2 调研要点（只读）

### 2.1 项目结构与 panel 模式

- 架构：SpaceExplorer HID → `hid_reader`（守护线程 → queue.Queue）→ `spacemouse_controller`（QTimer ~4ms）→ `data_processor`（轴映射/增益）→ `target_detector` → `target_mover` → Houdini 节点/参数。
- Panel 入口 `src/panel_entry.py`：粘贴到 Python Panel Editor，改 `SRC_PATH` 后 import 模块，`createInterface()` 返回 QWidget。
- 目标类型优先级：OBJ `worldTransform` > Rig Pose **scoped parm**（正则拆 `t{n}x` 组）> APEX `rig.graph_parms` > LOP `t/r` tuple。
- **可复用的关键模式** = 后台线程取数 → queue.Queue → UI 线程 QTimer 消费并写 hou；全程 `hou` 只在主线程碰（Houdini 线程安全铁律）。

### 2.2 Apex 处理现状（难点来源，README + APEX_RUNTIME_KNOWLEDGE + 源码）

- 入口：`hou.ui.paneTabOfType(SceneViewer).runStateCommand('getState')` 拿 state；`state.scene` / `state.control_manager` / `state.control_selection`（H22 起 `primary_control` / `control_paths`）。
- 热改控制器值（不落 key）：`rig.graph_parms[ctrl_mapping.t] = hou.Vector3(...)` + `state.runSceneCallbacks()`。
- 骨架世界坐标查找：遍历 `rig.graph.outputPorts()` → `getOutputData()`，几何输出读 @name/@xform 点属性，dict 输出收 `hou.Matrix4`（`apex_utils.build_skel_lookup`）。
- 已知限制（README「已知问题」+ knowledge 第 9 节）：
  1. `graph_parms` 写入**不可撤销**（Ctrl+Z 无效）、**Channel List 不会自动刷新**——Python 侧碰不到 `PI_Handle`。
  2. 目前只能改**视口/绝对坐标**：space mouse 对 apex 仍停在 viewport 内直接改绝对坐标（`target_mover._move_apex_controls`），未做局部坐标/相对位移/落 key。
  3. `_apex.pyd` / `_apexscene.pyd` 是编译二进制，`dir()` 可见导出但无源码；undo 需手动 `hou.undos.add()` + `apex.utils.addAnimateStateUndo()` 或 `apex.stateutils_2.SetChannelsUndo`。
  4. 版本差异：H21 = Py3.11，H22 = Py3.13，C 扩展功能 H22 更多。
- ApexScriptSamples 提示：graph 编程用 `from apexscript import *`（`graph.addOrUpdateNode` / `BindInput` / `character.getRig` / `character.updateRig`）；`export_control_xforms.py` 用 `dict::Build` 聚合各 TransformObject 的 xform_out 成 dict 端口；`PoseBlend_v1.py` / `SecondaryJoint_v1.py` 展示 graph 内用 Matrix4 做局部/rest 分解与父子级求解（= 关节世界坐标计算的 graph 内做法）。

## 3. 架构：Cyl1nder ⇄ Houdini Python Runtime 接收端 ⇄ 目标节点

```
[Cyl1nder web (Vite/Three.js)] ⇄ [bridge 8375 REST/WS] ⇄ [Houdini Python Runtime 接收端]
                                                              │
                                        (python panel 常驻 或 hou 后台脚本，非 SOP HDA)
                                                              │
                                    目标节点/数据（transform translate → apex Animation Layer）
```

- **为什么不是 SOP HDA**：写 transform 参数/动画层是「场景级运行时操作」，不是 4 输入 4 输出的 SOP 数据流；HDA 的 cook / 序列号 / 几何信封模型不适用。
- **接收端两种宿主**（先 panel，后可选纯后台服务）：
  - Python Panel（本原型）：有 UI（状态 / 目标 / 微调 / 日志），Houdini 内常驻，`createInterface()` 返回 widget。
  - hou 后台脚本（未来）：脚本/`hython` 内 `import hou` + threading + urllib 轮询，可无 UI 跑（如 Houdini 主进程的 python state 或伴随脚本）。
- **传输选型**：Houdini 内置 python 无 websocket 客户端依赖 → **HTTP 轮询/长轮询**（urllib + timeout），对齐现有 `hda/src/cyl1nder_bridge.py`（urllib + 后台线程 + debounce/latest-wins）。在 bridge 8375 上新增 `/api/runtime/*` 命名空间（本轮仅设计，未实现）。
- **线程模型（铁律）**：后台线程只做网络/取数；`hou` 调用只在 UI/主线程（QTimer 节流 ~30–60Hz 写 parm）。

## 4. 流式 channel 协议（草案）

目标：只传「变了的部分」→ 稀疏增量；携带排序/丢帧信息 → seq/ts；对齐动画 → frame。

### 4.1 增量更新消息

```json
{
  "op": "set_channels",
  "node": "/obj/char/transform1",
  "channels": { "tx": 0.12, "tz": -0.03 },
  "seq": 1042,
  "ts": 1723350000123,
  "frame": 42
}
```

- `op:"set_channels"`：流式写 channel（本轮唯一 op）。
- `node`：目标节点绝对路径（Phase3 换 apex control / layer 引用）。
- `channels`：**稀疏**——只含本次有变化的 channel；未出现的 key 接收端不动。
- `seq`：单调递增序号，丢包/断线重连检测（发现 gap → 拉全量/补帧）。
- `ts`：单调毫秒时间戳，乱序丢弃依据（本地跨进程按 ts 排序）。
- `frame`：可选，Houdini timeline 帧；Phase3 写 key 时对齐活动层。

### 4.2 批量 vs 稀疏 / 反压

- 全量 = `channels` 含全部目标 channel（transform 即 tx/ty/tz 三个）；稀疏 = 只含变化子集（部分帧/部分 channel 更新——对应「channel list 只更新一部分」的原始诉求）。
- **latest-wins 反压**：接收端队列 maxsize=1，高帧率只处理最新帧，丢中间帧不积压（panel 已实现）。

### 4.3 端点（草案，Phase2 落 protocol.py）

- `GET /api/runtime/channels?since=<seq>` → `{"updates":[{op,node,channels,seq,ts,frame?}...], "seq": <最新>}`；支持服务端长轮询 hold（~5s），空转返回空 updates + 心跳。
- `POST /api/runtime/channels`：注入/测试推送（body = `4.1` 消息），panel 侧可用简易 sender 脚本联调。
- 写回方向（Phase2/3 预留）：Houdini → bridge `{op:"channels_changed", node, channels, frame}`，供 web 监控 Houdini 本地编辑/动画层变化。
- **铁律 3**：协议落地必须三处同步 `protocol.py / types.ts / protocol.md`；本文件只定义概念与示例，未改三处。

## 5. transform 先行：接收端 panel 原型

- 文件：`hda/panels/cyl1nder_runtime.pypanel`（Houdini Python Panel，粘贴即用；hython py_compile 通过）。
- **数据源双模式**：
  - Mock（默认）：本地正弦漂移，验证「panel → transform parm」链路，无需 bridge。
  - Bridge：urllib 轮询 `GET {bridge}/api/runtime/channels?since=`，只取最新一条。
- **写 parm**：`node.parm("tx").set(...)`，EPS=1e-6 去抖，只写变化值；`CHANNEL_PARM_MAP`（tx/ty/tz 恒等映射，Phase3 换成 apex 映射表）。
- **交互界面（UI）设计**：
  - 状态行：idle / running / connected·Bridge / offline(原因) / paused，颜色区分。
  - 连接组：数据源下拉（Mock/Bridge）、Bridge URL、Poll Hz（1–120）。
  - 目标节点组：路径输入 + Pick（`hou.ui.selectNode()`）+ Use Sel（当前选中节点）。
  - 当前值/微调组：tx/ty/tz 读回显示（只读）+ 三个 QDoubleSpinBox + Apply（手动写）。
  - 日志：QPlainTextEdit 滚回（500 行上限），控制台同步 print。
- **交互逻辑要点**：
  - 后台线程取数 → queue → QTimer(30ms) UI 线程写 hou（线程安全铁律）。
  - Pause/Resume：本地编辑/调参时暂停流式，避免与手写冲突。
  - 目标缺失/桥离线 → 状态标红 + 日志，不抛异常不阻塞 UI。
- **待研究**：本地编辑冲突检测（parm callback 或 ts 比较决定谁赢）；写入频率与 Houdini 视口刷新成本权衡（当前上限 30Hz）。

## 6. Apex 最终目标（记下来）：监控 Animation Layer 并实时写回

- **目标链**：Apex Animate Scene SOP 的 Animation Layer → 实时监控 + 写回（web ⇄ runtime 双向）。
- **难点（spaceMouse2 调研所得）**：
  1. **pack 类数据类型**：运行时数据不是普通 parm，而是 `scene` 内的 `apex.Dict` / `hou.Matrix4` / Geometry 等 pack（`scene.getData(path)` / `setData` / `findDataPaths("*.rig")`）；`rig.graph_parms` 是热读写点（可读可写 Vector3/标量），但**不是参数面板**、无 per-parm 编辑。
  2. **Channel List 不可拆分**：apex 动画层 channel 是 animbinding 里的 **channel primitive 几何体**（`binding.activeLayerGeoPath()` + `ChannelPrim`：`eval/insertKey/setKeyValue/keyFrames`），不像 rigpose 有 `/.../t1x (r3y, s7x)` 拆分 parm 可逐个 set；增量改部分帧要操作 ChannelPrim 或 `binding.setKeysFromDict(scene, frame, pattern=ctrl_mapping.t, force_key=True)`。
  3. **关节世界坐标计算**：父子级复杂 apex 网格里要先算出关节世界坐标才能控制——`control_manager.update(scene)` + `getControlXform(ctrl_path)`（世界矩阵）/ `getControlData`（xform / local / restlocal / parentxform / parentlocal / xord / rord / scaleinheritance），或 `apex.ui.statecommandutils.getControlTransforms(ctrl_paths)`；graph 内做法见 `2.2` 的 PoseBlend/SecondaryJoint 样例。
  4. **当前只能改视口绝对坐标**：space mouse 对 apex 只做 `graph_parms` 热改（绝对坐标）→ `runSceneCallbacks()` 刷视口；不落 key、不可撤销、Channel List 不刷新。「相对位移 + 局部坐标 + 落 key 到活动层」是未解问题。
- **待研究点（Phase3 开工前）**：
  - `animbinding.setKeysFromDict` / `binding.activeLayerGeoPath` 的可用性与版本差异（H21 vs H22；Py3.11 vs 3.13）。
  - undo 桥接：`SetChannelsUndo` / `apex.utils.addAnimateStateUndo` 如何包进我们的流式写入。
  - 活动层切换/层权重（`apex.animstack.ApexAnimStack`）如何映射「web 选中哪个 layer 写哪个」。
  - pack 数据如何在 Cyl1nder 侧表达（序列化到 web 的 channel list 视图）。
- **约束**：铁律 4 不复制 Animehairstudio 代码；这里只借鉴 spaceMouse2（自有代码）+ SideFX 官方 API（HOM / `import apex` 运行时）。

## 7. 落地分期

| Phase | 内容 | 交付 |
|---|---|---|
| **Phase1（本轮）** | transform translate 三 float 流式接收 panel 原型 | `hda/panels/cyl1nder_runtime.pypanel`：Mock + Bridge 轮询 + 写 parm + UI + 日志；协议草案（`4`） |
| **Phase2** | channel list 增量（部分帧更新） | bridge `/api/runtime/channels` 落地（protocol.py/types.ts/protocol.md 三处同步）+ 接收端稀疏 channel 写 + 写回方向 `channels_changed` |
| **Phase3** | Apex Animation Layer | scene data 读写 + ChannelPrim 增量 + 关节世界坐标 + 活动层映射 + undo；先做 `6` 待研究点 |

## 8. 风险与注意

- **Houdini 线程安全**：`hou` 只能在主线程；后台线程严禁 hou 调用（panel 已按此设计：线程只产数据，QTimer 主线程写 parm）。
- **Panel 生命周期**：close/destroyed → 停线程、停 timer，避免悬挂后台线程。
- **协议三处同步（铁律 3）**：Phase2 落地时改 protocol.py + types.ts + protocol.md，不能只改一端。
- **与并行 agent 隔离**：本轮只写本文件 + panel 原型；bridge/web/hda src 由其他并行 agent 负责（工作树 `bridge/bridge/registry.py` 有他人改动，未触碰）。
- 本轮不 commit、不重启 Houdini、无跨端协议改动 → 不跑 bridge pytest / web tsc。

## 9. 本轮产物

- 新建 `devlog/python-runtime-design.md`（本文件，UTF-8 无 BOM，Node writeFileSync 写入）。
- 新建 `hda/panels/cyl1nder_runtime.pypanel`（Houdini Python Panel 原型，hython py_compile 通过）。
