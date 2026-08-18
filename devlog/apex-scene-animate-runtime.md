# APEX Scene Animate runtime — 控制器世界坐标解析

> 环境 Houdini 22.0.368 · 经 fxhoudinimcp（8100）实机验证 · 测试场景 `/obj/geo1/sceneanimate1`
> **完整知识库（权威，先读这个）**：[apex-runtime-knowledge.md](apex-runtime-knowledge.md)
> —— 已吸收 spaceMouse3 的 APEX_RUNTIME_KNOWLEDGE.md，做 APEX 工作不必再去翻那个目录。
> 复用模块：`research/apex_world_xform.py` · 桥适配器：`bridge/bridge/data_adapters/apex_ctrl.py`
> 本轮落地（v0.1.00113）：`apex-ctrl` 数据通道 + 吊牌接入 + web transform 驱动，见文末「落地」。

## 背景

Cyl1nder 的目标之一是兼容 APEX Scene Animate 的动画层数据 runtime。
此前无法解析 packfolder 里的 animation layer，读控制器只能拿到相对父的坐标
（一读就是 `(0,0,0)`），写入只能绝对值写，导致相机相对的交互（3D 鼠标）做不了。

## 结论

**能在纯 Python 里、不进视口 Animate state 读写控制器世界位姿。**

| 项 | 结论 |
|---|---|
| 世界坐标 | `ControlManager.getControlData(ctrl).xform` |
| 读到 000 的原因 | 读的是 `.local` / `graph_parms`，那是相对父的量 |
| `graph_parms` 语义 | 叠加在 `restlocal` 上的 **delta**，不是局部矩阵 |
| 世界→局部 | `delta = world × parentxform⁻¹ × restlocal⁻¹` |
| 写入落地 | `animbinding.setKeysFromDict(...)`；只写 graph_parms 会被动画层覆盖 |

读写误差均为 `0.00000000`（读值与 `Skel_Invoke_OUT` 三点 P 完全一致；
写入 `T=[0.4,0.6,0.5] R=[0,25,0]` 存盘重载后完全一致）。

## 无视口求值配方

```python
import hou, apex
frame = hou.frame()
scene = apex.Scene()
scene.loadFromGeometry(hou.node('/obj/geo1/sceneanimate1').geometryAtFrame(frame))
scene.addRigToEvaluation('/line1.char/Base.rig')
scene.updateEvaluationParms(frame)     # 帧驱动动画
scene.updateDirtyRigs()
cm = scene.control_manager
cm.update(scene)                       # 必须，否则 getControlData 返回 None
world = cm.getControlData('/line1.char/Base.rig/point_1').xform
```

`statecommandutils.getAnimateState()` 视口不在 Animate 状态时返回 `None`——
本配方不依赖它，这是关键收获。

## 数据结构

```
line1.char / Base.skel / Base.rig
animation / default.clip / _line1.char_Base   ← ChannelPrim: point_0_tx ...
                         / layer.data          ← 层权重
```

通道命名 `<控制器>_<t|r|s><x|y|z>`；`animbinding.parms()` 给未拆分名（`point_0_t`）。
**值可以只存在 `defaultValue()` 里而没有任何 key**——只读 `keyFrames()` 会误判无动画，
须用 `ChannelPrim.eval(frame)`。控制器只在被改动过后才有通道（`add_missing=True` 按需创建）。

## 主要踩坑

- `updateDirtyRigs()` 之后 `getControlData()` 返回 `None`，必须 `cm.update(scene)` 重建缓存。
- 动画启用时动画层每次求值覆盖 `graph_parms`；`enableAnimation(False)` 能让写入立刻生效，
  但姿态回退到 rest（丢动画），只适合静态求解，不适合交互。
- `rig.graph.outputPorts()` 元素是 int 没有 `portName()`，用 `scene.outputBindings()`。
- `xordString` / `rordString` 是方法要加 `()`；`activeLayerGeoPath()` 需传 `scene`。
- `control_2.getControlTransforms()` 返回的 key 是控制器短名，不是完整路径。

## 落地（v0.1.00113）

### 活动节点写入：`animation` Data parm

活动 `sceneanimate` 的状态在 `animation` **Data parm**（`asData()` → `{'geometry': <base85 字符串>}`）。
写回：`base64.b85encode(geo.data()).decode('ascii')`。

**两条铁律（都是踩出来的）：**

1. **绝不对该 parm 调 `revertToDefaults()`** —— 它不是「撤销上次写入」，而是清空整个
   APEX 场景状态（`/animation/*`、层栈、animbinding 全没）。曾因此弄坏用户活动节点、
   自行恢复失败，最后靠用户侧恢复。
2. **写回必须保留该 parm 原有的全部顶层 packed prim**（`catalog.data` / `default.clip` /
   `animation`），只删多出来的 char 折叠（`line1.char`）。只挑 `animation` 一个写回 →
   姿态塌回 rest。这是「写回有损」的真实原因。

### 两趟规则（父级先提交）

改父级后**必须先提交、再重载**才能拿到新的 `parentxform`；同一趟里解子级会用到旧
`parentxform`，世界坐标漂移（实测漂 0.16~0.36）。

```
pass 1: 写父级 → setKeysFromDict → 提交回 parm → cook
pass 2: 重新 loadFromGeometry → 取新 parentxform → 解子级 → 提交
```

修正前后实测（`point_1` 钉在世界 `[0.22,0.48,0.31]`，转根骨骼）：

| root_rx | 一趟（错） | 两趟（对） |
|---|---|---|
| -32.542 | err 0（巧合起点） | err 0.0000000 HOLD |
| -60 | err 0.1613157 DRIFT | err 0.0000000 HOLD |
| 15 | err 0.2751319 DRIFT | err 0.0000000 HOLD |
| 40 | err 0.2301105 DRIFT | err 0.0000000 HOLD |

### `apex-ctrl` 数据通道

`bridge/bridge/data_adapters/apex_ctrl.py`（注册进 `ADAPTERS`）。两种寻址，
bridge 的 `_resolve_data_target` 按最后一个 `/` 切分，无需改路由：

| 形式 | 通道路径 | 读 | 写 |
|---|---|---|---|
| 整体 | `<sceneanimate>/<ctrl>` | `{t:[…],r:[…],ctrl}` | `{t:[…]}` / `{r:[…]}` |
| 分量 | `<sceneanimate>/<ctrl>/<tx…rz>` | 标量 | 标量 |

分量形式的意义：web 侧既有「通道引用绑定」走 `putChannelValues` 传**标量**，
分量通道让 transform 节点的 `tx/ty/tz` 直接驱动控制器，**web 绑定链路零改动**。
分量写内部实现 = 读当前世界位姿 → 只改该分量 → 整体写回。

吊牌条目（`Cyl1nderTag.entries`）：

```
@apex-ctrl:/obj/geo1/sandbox_sceneanimate/point_1
@apex-ctrl:/obj/geo1/sandbox_sceneanimate/point_1/tx
@apex-ctrl:/obj/geo1/sandbox_sceneanimate/point_1/ty
@apex-ctrl:/obj/geo1/sandbox_sceneanimate/point_1/tz
```

### web 场景

快照 `bridge/data/snapshots/C1-msyhkp0l-8oiw/scene/node-graph.json`：
transform 节点 `apex_point1_driver`，`bindings` 把 `tx/ty/tz` 指到上面三个分量通道。
打开 `http://127.0.0.1:3080/?serial=C1-msyhkp0l-8oiw` 即见。

### 安全纪律

所有写入实验在 `sandbox_sceneanimate`（用户节点的一次性副本，display 关）上做，
用户的 `sceneanimate1` 全程未被本轮触碰。**新增适配器/写路径一律照此办理。**

## 未验证

- biped 复杂绑定（IK / space-switch / MultiControl / GroupMapping）、约束启用后的
  `post_constraint_parms`、多层 additive 动画与层权重合成、scale 通道（本 rig `mapping.s` 为空）。
- **web 端到端未实测**：适配器与快照都验证过（HTTP 直调零误差），但没在浏览器里
  拖 gizmo/参数跑一遍；`channel-bind` 的防回环与 `apex-ctrl` 的「读-改-写」时序是否
  在连续拖动下稳定，待实机。
- 旋转分量（`rx/ry/rz`）通道已实现但只单测过整体形式的 `r`，分量旋转未逐一验证。
- 用户活动节点上残留的结构冗余（`/catalog.data`、`/default.clip/*` 与 `/animation/*` 并存），
  由本轮早期失败写入造成，功能上不影响读写，未清理。
