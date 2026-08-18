# APEX 运行时知识库（`import apex` / Scene Animate）

> 环境 **Houdini 22.0.368**（运行时 Python 3.13，安装目录 `packages/apex/python3.13libs/apex/`）。
> 标注「**实机验证**」的结论经 fxhoudinimcp（8100）实机验证；标注「未验证」「文档推导」的是从
> 安装目录源码 / `dir()` 导出 / 论坛整理出来的 API 面，**不得当成已确认事实使用**。
> 本文吸收并取代 spaceMouse3 的 `APEX_RUNTIME_KNOWLEDGE.md` 与 `APEX_WORLD_XFORM_SOLVED.md`
> （原路径 `D:\code\dev\Houdini\spaceMouse3\` 仅作历史出处，做 APEX 工作不需要再打开那个目录）。
> 测试场景：`/obj/geo1/sceneanimate1`（`line1` 三点骨骼 → FK 绑定）。
> 复用模块：`research/apex_world_xform.py`。

---

## 目录

| 节 | 内容 | 可信度 |
|---|---|---|
| [0](#0-三个必须分清的东西) | 三个必须分清的东西（apex runtime / APEX script / hou.apex） | 实机验证 |
| [1](#1-可信度标注约定) | 可信度标注约定 | — |
| [2](#2-结论速览) | 结论速览 | 实机验证 |
| [3](#3-架构总览) | 架构总览（`_apex.pyd` / `_apexscene.pyd` / Python 包装层） | 文档推导 |
| [4](#4-c-扩展导出的核心类型api-面未验证) | C 扩展导出的核心类型 API 面 | 未验证 |
| [5](#5-scene-animate-核心-python-模块api-面未验证) | Scene Animate 核心 Python 模块 API 面 | 未验证 |
| [6](#6-scene-数据路径层次) | Scene 数据路径层次 | 混合 |
| [7](#7-packed-folder-与动画层的真实结构) | packed folder 与动画层的真实结构 | 实机验证 |
| [8](#8-无视口求值配方读) | 无视口求值配方（读） | 实机验证 |
| [9](#9-世界-vs-局部实测对照) | 世界 vs 局部实测对照 | 实机验证 |
| [10](#10-写入世界坐标--动画层) | 写入（世界坐标 → 动画层）：两个坑与正确写法 | 实机验证 |
| [11](#11-channelprimbindings-完整-api) | ChannelPrimBindings 完整 API | 实机验证 |
| [12](#12-关键帧动画验证) | 关键帧动画验证（含实测数值） | 实机验证 |
| [13](#13-animation-data-parm活动节点状态的真实载体) | `animation` Data parm：活动节点状态的真实载体 | 实机验证 |
| [14](#14-严重--破坏性reverttodefaults-会摧毁-apex-场景) | 【严重 / 破坏性】`revertToDefaults()` 会摧毁 APEX 场景 | 实机验证 |
| [15](#15-结构重建-api) | 结构重建 API | 实机验证 |
| [16](#16-通道--默认值--删键的语义细节) | 通道 / 默认值 / 删键的语义细节 | 实机验证 |
| [17](#17-写回活动节点已解决) | 写回活动节点（已解决）+ 两趟规则 | 实机验证 |
| [18](#18-测试设计指引故意让局部与世界不对齐) | 测试设计指引：故意让局部与世界不对齐 | 实机验证 |
| [19](#19-进入-scene-animate-运行时的三条路径) | 进入 Scene Animate 运行时的三条路径 | 未验证 |
| [20](#20-h22-新增-api-清单vs-h21) | H22 新增 API 清单（vs H21） | 文档推导 |
| [21](#21-踩坑清单) | 踩坑清单 | 实机验证 |
| [22](#22-注意事项) | 注意事项 | 文档推导 |
| [23](#23-复用模块) | 复用模块 | 实机验证 |
| [24](#24-未验证--后续) | 未验证 / 后续 | — |
| [25](#25-源出处与冲突裁决) | 源出处与冲突裁决 | — |

---

## 0. 三个必须分清的东西

**这三个东西名字像、实际毫无关系，是 APEX 相关工作中最常被混淆的一组概念。任何时候看到
"apex" 三个字母，先确定它指的是哪一个。**

| 名字 | 是什么 | 入口 | 与本文关系 |
|---|---|---|---|
| **`apex` runtime** | Scene Animate 的**运行时**：场景容器、控制器求值、动画层、通道原语。C 扩展 + Python 包装层，装在 `packages/apex/python3.13libs/apex/` | `import apex` | **本文全部内容都是这个** |
| **「APEX script」/ APEX Script 节点** | APEX 图里的一种脚本节点 / `ApexScript/*.py` 原型文件，用来在图求值时跑 VEX-ish / Python 逻辑 | APEX 图内节点 | **与 runtime 毫无关系**。不要因为看到 `ApexScript/apex_export_control_xforms.py` 之类文件就以为 runtime 会产出它写的属性 |
| **`hou.apex`** | HOM 侧的**图构建 API**：新建 session graph、节点、连线、便签 | `hou.apex.*`、`hou.ApexNode` 等 | 只用于构图，不参与动画求值 |

实机验证过的具体教训：spaceMouse3 旧代码试图从几何体点属性 `xform` / `transform` 抓控制器世界
旋转，**标准 APEX rig 图不产出这个属性**——只有一个未接线的 APEX Script 原型
（`ApexScript/apex_export_control_xforms.py`）会产出。于是几乎所有控制器都静默回退到
`np.eye(3)` 单位旋转，没有任何报错。这就是把「APEX script」当成「apex runtime」的直接代价。

---

## 1. 可信度标注约定

本文合并了两类材料，混用会出事，所以全文强制标注：

- **实机验证** — 经 fxhoudinimcp 直连 8100，在 Houdini 22.0.368 里实际调用过、有实测数值。
  可以直接依赖。
- **文档推导 / 未验证** — 从安装目录源码、C 扩展 `dir()` 导出、SideFX 论坛整理出来的 API 面。
  **签名、参数名、返回类型都可能不对**（本文第 21 节里好几条踩坑就是这类清单里的错）。
  写代码前必须自己 `dir()` / 试调一次。

第 4、5、19、20、22 节整体属于**未验证 API 面调查**。其余章节除明确标注外均为实机验证。

---

## 2. 结论速览

**实机验证。**

| 问题 | 答案 |
|---|---|
| 能否不进视口 Animate state 拿到世界坐标？ | **能**。`apex.Scene()` 可在纯 Python 里从 SOP 几何体加载并求值 |
| 世界坐标在哪 | `ControlManager.getControlData(ctrl).xform` |
| 之前读到 `000` 的原因 | 读的是 `.local` / `graph_parms`，那是**相对父**的量；且 `localtransform` **不包含 `restlocal`** |
| 写入为什么「只能绝对值写入」 | `graph_parms` 是**叠加在 `restlocal` 上的 delta**，且动画层每次求值都会覆盖它 |
| 世界 → 局部换算 | `delta = world × parentxform⁻¹ × restlocal⁻¹` |
| 落地写入 | `animbinding.setKeysFromDict(...)`，否则动画层覆盖 |
| 活动节点的场景状态存在哪 | `sceneanimate` 节点的 `animation` **Data parm**，值是 base85 字符串 |
| 最危险的操作 | 对 `animation` Data parm 调 `revertToDefaults()` —— **摧毁整个场景**（见 §14） |
| 回写活动节点 | 可行且零误差，但必须保留 parm 原有全部顶层 prim（见 §17.2） |
| 改父级后解子级 | 必须**两趟**：父级先提交并重载，否则 `parentxform` 是旧的、世界坐标漂移（见 §17.3） |

读写均已验证误差 **0.00000000**（含回写活动节点、含根骨骼旋转下钉住子控制器）。

---

## 3. 架构总览

**文档推导**（来自安装目录结构）。

```
import apex
  ├─ _apex.pyd (C 扩展, 1.7MB)        — 核心类型: Dict, Graph, Control, ControlManager, ...
  ├─ _apexscene.pyd (C 扩展, 1.0MB)   — 场景类型: Scene, SceneGraph, SceneTool, ...
  └─ Python 包装层 (~130 .py 文件)     — 工具函数, UI, undo, 动画层, ...
```

`apex/__init__.py`：

```python
from _apex import *
from _apexscene import *
ParmDict = Dict  # 向后兼容
```

C 扩展是编译后的二进制，`dir()` 能看到导出名但没有源码，签名只能试调确认。

---

## 4. C 扩展导出的核心类型（API 面，未验证）

> **未验证**：以下是 API 面调查结果，方法名多半存在，但**参数、返回类型、是属性还是方法都
> 可能与实际不符**。已被实机推翻的条目已在原地标注。

### apex.Dict

- 哈希表，key 为 `str`，value 可为任意类型（包括其他 `Dict`、`GeometryArray`、`StringArray`）
- 方法：`keys()`、`values()`、`items()`、`clear()`、`freeze()`、`update(other)`、`asDict()`、
  `writeToDetail(geo, attr)`、`updateFromDetail(geo, attr)`
- 等价于 `hou.ParmDict`（`ParmDict = Dict`）

### apex.Scene

动画场景容器，所有运行时数据的根。

| 方法 | 说明 |
|---|---|
| `getData(path)` / `setData(path, data)` / `popData(path)` | 读 / 写 / 删数据 |
| `findDataPaths(pattern)` | 通配符搜索，如 `"*.rig"`、`"/constraints/*.graph"` |
| `dataPaths()` | 全部数据路径（**实机验证**，见 §7） |
| `getGraphOutputData(path, key/pattern)` | 取图输出端口的求值结果 |
| `loadFromGeometry(geo)` / `saveToGeometry(geo)` | 与几何体序列化（`loadFromGeometry` **实机验证**；`saveToGeometry` 的回写语义见 §17） |
| `isGeometryLoadable(geo)` | 加载前检查（**实机验证**） |
| `loadRigGraph(rig_path, rig)` | 加载 rig 图 |
| `addRigToEvaluation(path)` / `removeRigFromEvaluation(path)` | 求值集合管理（前者**实机验证**） |
| `updateDirtyRigs()` | 重新求值脏 rig（**实机验证**） |
| `updateEvaluationParms(frame)` | 设置求值帧，**帧驱动动画求值的唯一入口**（**实机验证**） |
| `enableAnimation(bool)` | 开关动画层求值（**实机验证**，副作用见 §10） |
| `runSceneCallbacks()` | 刷新视口 |
| `activeLayer()` / `layers()` / `layer(name)` | 动画层（`layers()` **实机验证**存在，且会被 §14 的事故清空） |
| `control_manager` | 全局 `ControlManager`（**实机验证**：`scene.control_manager` 可直接取） |
| `outputBindings()` | 输出绑定路径（**实机验证**，见 §21） |
| `incrementChangeCount()` / `changeCount()` | 脏标记 |
| `getActiveClipPath()` / `setActiveClip(path)` | 活动 clip |
| `initializeAnimStack(...)` / `createAnimBinding(...)` / `addChannelPrimBinding(...)` | 结构重建（**实机验证**，见 §15） |

### apex.SceneGraph

代表一个 `.rig` 的运行时实例。

- `graph` → `apex.Graph`（rig 的构建图）
- `graph_parms` → `apex.Dict`。**注意**：API 面调查把它描述成「控制器的当前值」，
  这是**错的**。实机验证它是**叠加在 `restlocal` 上的 delta**，见 §10。
- `graph_parms[parm_name]` 可读可写 `hou.Vector3`（t/r/s）或标量（x/y/自定义 parm）
- `trackOutput(name, key)` / `showTrackedOutput(name, key, visible)`
- `getLevelsOfDetail(name)` → LOD
- `setDirty()`（**实机验证**）/ `setConstrainable(bool)`

### apex.SceneTool / apex.MultiControl

- `SceneTool` → `.tool` 后缀文件夹
- `MultiControl` → `.ctrl` 后缀文件夹

### apex.Control / apex.TransformControl / apex.AbstractControl

C 扩展对象，`ControlManager` 内部使用。

- `TransformControl`：`t_parm`、`r_parm`、`s_parm`
- `AbstractControl`：`parm_data`（dict）、`type_name`、`type_alias`
- 共有：`path`、`name`、`rig_path`、`data_path`、`animatable`、`node_properties`、`node_parms`

### apex.ControlManager

管理一个 rig 或全局的所有控制器。

| 方法 | 说明 |
|---|---|
| `controls` | `{ctrl_path: Control}` |
| `controlPaths()` | 所有路径列表（**实机验证**） |
| `update(scene)` | 刷新控制器求值数据（**实机验证，必调**） |
| `getControlMapping(ctrl_path)` | → `ControlMapping`（**实机验证**） |
| `getControlData(ctrl_path)` | → `ControlTransformData`（**实机验证，取世界坐标就靠它**） |
| `getControlXform(ctrl_path)` | 号称直接返回世界矩阵。**未验证**；实机走的是 `getControlData(...).xform`，优先用后者 |
| `getControlGadgetData(ctrl_path)` / `getControlGadgetType(ctrl_path)` | 自定义 gadget 参数 / 类型名 |
| `controlsByProperty(ctrl_path, trigger_type)` / `controlMapByProperty(...)` | 触发器关联 |
| `hasProperty(ctrl_path, name)` / `getProperty(ctrl_path, name)` | 属性查询 |
| `isSelectable(...)` / `showHandle(...)` / `isOrbit(...)` | 交互标志 |
| `getGroup(ctrl_path)` / `isGroupPath(ctrl_path)` | 分组 |
| `findControls(pattern)` | 模式匹配查找 |

### apex.Graph

- `outputPorts()` → 输出端口。**实机推翻**：返回的元素是 `int`，**没有 `portName()`**，
  用 `scene.outputBindings()` 代替（见 §21）。
- `getOutputData(port_name)` → 输出数据
- `matchNodes(pattern)` / `matchPorts(pattern)` → 模式匹配
- `nodeName(id)` / `portName(id)` / `getPort(node, port)`
- `properties()` → 图属性（含 rig 配置）
- `signature()` → 图签名（输入 / 输出）
- `getDefaultParameters(compiled)` → 默认参数值
- `freeze()` / `compileProgram()` / `loadFromGeometry(geo)` / `saveToGeometry(geo)`
- `addWire(a, b)` / `connectedPorts(port)`

### apex.ChannelPrim

动画层几何体里的 channel primitive（`hou.ChannelPrim` 的子类 / 包装）。

- `eval(frame)` → 求值。**实机验证：这是判定通道值的正确方法**，无 key 时返回 default。
- `keyFrames()` → 所有关键帧（**实机验证**：可能为空而值仍存在，见 §16）
- `defaultValue()` / `setDefaultValue(val)`（**实机验证**：姿态可以完全存在 default 里）
- `insertKey(frame)` / `setKeyValue(frame, val)` / `hasKeyAtFrame(frame)` / `destroyKey(frame)`
- `segmentType(frame)` / `setSegmentType(frame, type)`

---

## 5. Scene Animate 核心 Python 模块（API 面，未验证）

> **未验证**：函数名与行数来自安装目录源码浏览，签名未逐个试调。

### 5.1 `apex.sceneanimate` — Scene Animate SOP 相关

```python
findActiveSceneViewers(node) -> list[hou.SceneViewer]
getRigDebugParms(node) -> apex.Dict
```

Scene Animate SOP 节点的 debug 参数管理，内部通过 `state.scene` 和 `rig.graph_parms` 读取。

### 5.2 `apex.scene_2` — 场景管理与 Drawable（~1430 行）

```python
SceneOutputDrawable                 # 控件/形状的视口绘制
SceneShapeOutputDrawable            # 骨骼形状的 LOD 绘制
SceneInvokeSop                      # Scene Invoke SOP 的 Python 实现

buildDrawableForControls(scene, viewer, rigpath)
buildEvaluatorsForRigs(state, scene, viewer, sop_node)
createRig(state, rig_path, rig_graph, geo_outputs)
loadRig(state, rig_path, geo_outputs)
recreateRig(state, rig_path, rig_graph)
removeRig(state, scene, rig_path)
removeCharacter(state, scene, char_path)

getControlTransforms(scene, ctrl_paths)
getParmsForControls(scene, ctrl_paths)
isConstraintEnabled(scene, path)
getConstrainedControls(scene)
isControlConstrained(scene, ctrl)
```

### 5.3 `apex.control_2` — 控制器管理与参数映射（~1050 行）

`ControlMapping`（**实机验证存在**，字段实测见 §10）：

```python
class ControlMapping:
    t: str      # 位移参数名
    r: str      # 旋转参数名
    s: str      # 缩放参数名
    x: str      # 自定义标量
    y: str      # 自定义标量
    keys: set   # 非空的键
    # 还支持任意扩展键（来自 AbstractControl.parm_data）
```

`GroupMapping(ControlMapping)`：

```python
subcontrol_mapping: apex.Dict          # {parm_name: 'ctrl_path:parm_name'}
subControlData(parm_name) -> (ctrl_path, parm_name)
```

`ControlTransformData`（**实机验证**：字段全部存在；`xordString()` / `rordString()`
**是方法不是属性**）：

```python
xform        : hou.Matrix4   # 世界变换
local        : hou.Matrix4   # 局部变换（相对父，且不含 restlocal）
restlocal    : hou.Matrix4   # rest pose 局部变换
parentxform  : hou.Matrix4   # 父世界变换
parentlocal  : hou.Matrix4   # 父局部变换
xord         : int           # 变换顺序
rord         : int           # 旋转顺序
scaleinheritance : int       # 缩放继承
xordString() / rordString()  # 方法，要加 ()
```

关键独立函数：

```python
splitControlPath(ctrl_path) -> (rig_path, ctrl_name)
controlRigPath(ctrl_path) -> rig_path
controlName(ctrl_path) -> ctrl_name
groupControlPathsByRig(ctrl_paths) -> {rig_path: [ctrl_paths]}

getParmsForControls(scene, ctrl_paths, ...) -> {rig_path: [parm_names]}
getParmsForControlsFromManager(ctrl_mgr, ctrl_paths, ...) -> [parm_names]
getControlsFromChannels(scene, rig_path, channel_names) -> [ctrl_paths]

getControlTransforms(scene, ctrl_paths) -> {name: hou.Matrix4}
getControlXformsByAction(scene, ctrl_paths, action) -> {path: Matrix4}

setControlTemplateVisibility(geo, ctrl_paths, on, bits)
setControlTemplateEnabled(geo, ctrl_paths, on, bits)
getControlVisibleFromTemplate(geo, ctrl_path) -> bool
getVisibleControlsFromTemplate(geo, invert, bit_mask) -> [ctrl_paths]
getEnabledControlsFromTemplate(geo, invert, bit_mask) -> [ctrl_paths]
getInternalControlsFromTemplate(geo) -> [ctrl_paths]

clearControlAnimation(state, ctrl_paths, reset_to_default) -> None
```

`ControlManager` 上的这些方法是**通过 `@extends_class(ControlManager)` 在 Python 层扩展**的，
不在 C 扩展里——所以 `dir()` 看 C 扩展看不到它们。

`control_2.getControlTransforms(scene, paths)` 是官方封装，返回的矩阵与 `.xform` 一致
（**实机验证**），但 **key 是控制器短名**（`point_1`），不是完整路径。

### 5.4 `apex.channelutils` — Channel Primitive 操作（~685 行）

类：`ChannelData`（快照：geo + pending_channels）、`ChannelUndo`（undo/redo 数据）、
`ChannelManager`（单几何体的 channel 管理器）、`SceneChannelManager(ChannelManager)`（场景级，带 undo）。

```python
# ChannelManager
manager.getPendingChannels() -> dict
manager.addPendingKey(chan_name, value)
manager.evalChannel(channel, frame) -> float
manager.setChannelValue(channel, value, anim_prefs, frame, key, interpolation)

# SceneChannelManager
manager.channel_geo          -> hou.Geometry     # 从 scene data 读写
manager.channel_prims_path   -> str              # scene data 路径
manager.getChannel(name, geo) -> hou.ChannelPrim | None
manager.getChannelValue(name, frame) -> float | None
manager.getChannelNames() -> set[str]
manager.setupChannels(parm_dict, persist_existing_vals)
manager.addChannel(name, default_val) -> hou.ChannelPrim
manager.setChannelValueUndo(channel_names, value, frame, key)
manager.deleteChannelKeysUndo(channel_names, single, frame, default_value)
manager.scopeChannels(kwargs)                    # 被 Animate State 调用
manager.refresh()                                # scope + 刷新 channel list + runSceneCallbacks
manager.onChannelsChangedCallback(channel_names, collection_name)  # Animation Editor 回调
```

`pending_channels` 这个概念很重要：它解释了为什么 SOP 输出几何体里 `keyFrames()` 可能是空的
（见 §16）。

### 5.5 `apex.animstack` — 动画层系统（~1758 行）

`ApexAnimStack` 管理整个动画层栈：

```python
addLayer(name, parent, additive, activate, index, color)
deleteLayer(name, new_active_layer)
duplicateLayer(original, selected_controls_only, activate)
setActiveLayer(layer)
setLayerWeight(layers, value, change_type)
muteLayer(layer, mute) / lockLayer(layer, lock) / soloLayer(layer, solo)
renameLayer(layer, new_name)
addControlsToLayer(ctrl_paths, layer) / removeControlsFromLayer(ctrl_paths, layer)
bake(frame_range, sample_rate, replace, start_layer, end_layer)
flattenedLayers(start, end) -> 计算层
getLayerControls(layer) -> [ctrl_paths]
getLayerParms(layer) -> {rig_path: [parm_names]}
onPlaybackChangeEvent(event_type)   # 帧变化时更新层权重
scopeChannels(channel_list)         # 被 Animate State 调用
```

对应 Undo 类：`AddLayerUndo`、`DeleteLayerUndo`、`SetActiveLayerUndo`、`MuteUnmuteLayersUndo`、
`SetLayerWeightUndo`、`AddRemoveControlsToLayerUndo` 等。

### 5.6 `apex.stateutils_2` — State 工具与配置（~935 行）

配置常量：

```python
ANIM_NODE_CONFIG = 'animation_node'          # 自定义动画节点
EXCLUDE_GEO_PATTERN_CONFIG = 'exclude_geo_pattern'
DISABLE_AUTO_CHARACTER_CLEANUP_CONFIG = 'disable_auto_character_cleanup'
DISABLE_ANIM_TOOLS_CONFIG = 'disable_animation_tools'
DEFAULT_TOOL_CONFIG = 'default_tool'
TOOLS_CONFIG = 'tools'
USE_SPLIT_VIEW_CONFIG = 'use_split_view'
```

工具名：

```python
TOOL_ANIMATE         = 'animate'
TOOL_LOCATORS        = 'locatortool_2'
TOOL_RAGDOLL         = 'ragdolltool_2'
TOOL_FBIK            = 'fbikanimtool'
TOOL_SECONDARYMOTION = 'secondarymotiontool'
TOOL_CUSTOM          = 'customtool'
TOOL_EFFECT          = 'effecttool'
```

类：`Hotkeys`（Animate State 全部热键定义）、`SetChannelsUndo`（binding channel 几何体的 undo）、
`SetChannelsUndoBuilder`（构建 undo 的 context manager）、`setChannelsUndo(state, binding_path, layer)`
（context manager）。

独立函数：

```python
getAnimStack(scene, rig_path) -> apex.Dict   # {channelgeo, layerdata, layernames, activelayer}
spaceSwitchControlAction(state, setkeys)     # IK/FK 切换
toggleControlAction(state, ctrl_path)        # 切换 bool parm
pinControlAction(state)                      # pin 控件
```

### 5.7 `apex.ui.statecommandutils` — UI → State 命令桥（~289 行）

**从 Python Panel / 外部代码操作 Animate State 的入口**，方法多数通过
`scene_viewer.runStateCommand()` 把命令发给 viewer state。

```python
getSceneViewer() -> hou.SceneViewer | None
inAnimateState(scene_viewer) -> bool
getAnimateState(scene_viewer) -> state | None
getSceneData(path, scene_viewer) -> data
setSceneData(path, data, scene_viewer)
findSceneDataPaths(pattern, scene_viewer) -> list
updateControls(trs_dict, controls_list, update_channel_widget)
startTool(tool_module_name, on_activate_kwargs)
switchToPreviousTool() / exitCurrentTool()
getSceneControlManager() -> control_manager
getPrimaryControl(scene_viewer) -> str | None
getControlTransforms(ctrl_paths, group_by_rig) -> dict
getControlColors(control_paths) -> dict
getCallbackControls(control_paths) -> set
setControlXforms(mapping, scope)
setXformForControls(xform, control_paths)
switchHandleTool(tool_name)
channelList() -> hou.ChannelList
getGraphOutputData(path, scene_viewer) -> data
getSceneNode(scene_viewer) -> hou.OpNode | None
channelsChanged(channels, collection, write_animation, anim_path, scene_viewer)
buildPathRefs(paths) -> [refs]     # 路径 → 持久化引用
resolvePathRefs(refs) -> [paths]   # 引用 → 完整路径
```

**实机验证的关键点**：`getAnimateState()` 在视口不处于 Animate 状态时返回 `None`。
§8 的求值配方**完全不依赖它**——这是本轮最重要的收获。

### 5.8 `apex.utils` — 通用工具（~381 行）

```python
loadGraph(file_path) -> apex.Graph      # 从 .bgeo 加载图
saveGraph(graph, path)
apexDictToPythonDict(apex_dict) -> dict
pythonDictToApexDict(dict) -> apex.Dict
findControlNameFromPath(control_path) -> str
splitPathRef(ref) -> (tool_prefix, path)
prependCharToControlPath(ctrl_ref, char_folder) -> str
graphFromFile(file_name) -> apex.Graph
saveDrawableToGeometry(d, geo, prefix, suffix)
addAnimateStateUndo(undo, name, tag)    # hou.undos.add 包装
wirePorts(graph, port_mapping)
mergeGraph(graph, other_graph, prefix, offset)
```

---

## 6. Scene 数据路径层次

**通用层次结构（文档推导）**：

```
/char_name/                        ← 角色文件夹
  Base.rig/                        ← rig 实例
    graph                          ← 构建图
    graph_parms                    ← Dict: 控制器参数 delta（不是局部矩阵！见 §10）
    control_manager                ← ControlManager
    control_template               ← 几何体: 控件可见性/启用模板
    animbinding                    ← 动画绑定（ChannelPrimBindings）
      与绑定相关的几何体路径...      ← 每层一个 channel primitive 几何体
    drawable_output/               ← 控件绘制输出
    output/                        ← 骨骼形状输出
    drawables/                     ← Drawable 存储
    control_drawable               ← 控件 Drawable
    control_data/                  ← 控制器变换数据（__xform, __localxform 等）
    post_constraint_parms          ← 约束后的参数
/tool_name.tool/                   ← 工具
/constraints/                      ← 约束
  library/                         ← 约束库
/animation/                        ← 动画
  default.clip/                    ← 默认动画剪辑
    ...                            ← 动画层数据
```

**测试场景实测（实机验证）**，`scene.dataPaths()` 返回：

```
/__abstract___scene_graph
/__transform___scene_graph
/animation/catalog.data
/animation/default.clip/_line1.char_Base
/animation/default.clip/layer.data
/constraints/constraint.constr
/line1.char
/line1.char/Base.rig
/line1.char/Base.rig/animbinding
/line1.char/Base.skel
animstack
```

注意实测结构比通用层次简单得多：`drawables/`、`control_data/` 这些在纯 Python 加载
（无视口）的场景里并不出现。`animstack` 没有前导 `/`。

---

## 7. packed folder 与动画层的真实结构

**实机验证。**

`sceneanimate1` 输出只有 2 个 packed prim，递归展开：

```
line1.char                      pts=2 prims=2
  Base.skel                     pts=3 prims=1   ← 骨骼
  Base.rig                      pts=7 prims=16  ← APEX rig 图
animation                       pts=1 prims=1
  default.clip                  pts=2 prims=2
    _line1.char_Base            prims=6 kinds=['ChannelPrim']   ← 动画通道
    layer.data                  prims=1 kinds=['ChannelPrim']   ← 层权重
```

### 通道命名法

`_line1.char_Base` 里的 6 条 ChannelPrim：

```
point_0_rx  point_0_ry  point_0_rz
point_0_tx  point_0_ty  point_0_tz
```

| 项 | 规则 / 实测值 |
|---|---|
| 通道名 | `<控制器名>_<t\|r\|s><x\|y\|z>` |
| `animbinding.parms()` | 返回**未拆分量**的 parm 名：`['point_0_t', 'point_0_r']` |
| `channelCollectionName()` | `_line1.char_Base`，即 `<char>_<rig>`（`.` 被替换为 `_`，且有前导 `_`） |

只有**被改动过的控制器**才有通道：`point_1` / `point_2` 一开始根本没有通道，
调用 `setKeysFromDict(..., add_missing=True)` 时才按需创建。

---

## 8. 无视口求值配方（读）

**实机验证。** 这是本知识库最核心的可复用配方。

```python
import hou, apex

frame = hou.frame()
geo   = hou.node('/obj/geo1/sceneanimate1').geometryAtFrame(frame)

scene = apex.Scene()
assert scene.isGeometryLoadable(geo)
scene.loadFromGeometry(geo)

rig_path = '/line1.char/Base.rig'          # 或 scene.findDataPaths('*.rig')
scene.addRigToEvaluation(rig_path)
scene.updateEvaluationParms(frame)          # ← 帧驱动动画求值的唯一入口
scene.updateDirtyRigs()

cm = scene.control_manager
cm.update(scene)                            # ← 必须，否则 getControlData 返回 None

for ctrl in cm.controlPaths():
    world = cm.getControlData(str(ctrl)).xform   # hou.Matrix4，世界空间
```

两条硬性顺序约束（实测，违反就是 `None` + `AttributeError`）：

1. `updateEvaluationParms(frame)` 必须在 `updateDirtyRigs()` 之前，否则动画不按帧求值。
2. `updateDirtyRigs()` 之后 `getControlData()` 返回 `None`，**必须** `cm.update(scene)`
   重建缓存才能再读。

`statecommandutils.getAnimateState()` 在视口不处于 Animate 状态时返回 `None`——
上面这条路径完全不依赖它。

---

## 9. 世界 vs 局部实测对照

**实机验证。**

`point_0_rx = -17.46°` 造成的弯曲下（rest 状态 point_2 应在 z=1.0）：

| 控制器 | `.xform`（世界） | `.local`（相对父） | `.restlocal` | `.parentxform` |
|---|---|---|---|---|
| point_0 | `[0, 0, 0]` | `[0, 0, 0]` | `[0, 0, 0]` | `[0, 0, 0]` |
| point_1 | `[0, 0.15, 0.477]` | `[0, 0, 0.5]` | `[0, 0, 0.5]` | `[0, 0, 0]` |
| point_2 | `[0, 0.3, 0.9539]` | `[0, 0, 0.5]` | `[0, 0, 0.5]` | `[0, 0.15, 0.477]` |

`Skel_Invoke_OUT` 三点 P = `[[0,0,0], [0,0.15,0.477], [0,0.3,0.9539]]` —— **与 `.xform` 完全一致**。

这张表就是「读出来是 000」的全部答案：

- `point_0` 是根，`.local` 恒为 `000`，看起来像没数据；
- `point_1/2` 的 `.local` 永远是 `(0,0,0.5)` 这个 rest 偏移，与实际弯曲无关；
- 更准确的机制表述：**`localtransform` 不包含 `restlocal`**。局部量只是相对父的偏移，
  rest 姿态那一段根本不在里面，所以拿 `.local` 当世界坐标必然对不上；
- 只有 `.xform` 是世界空间。

`ControlTransformData` 字段清单见 §5.3。再次强调 `xordString()` / `rordString()` 是方法。

---

## 10. 写入（世界坐标 → 动画层）

**实机验证。**

### 10.1 坑 1：`graph_parms` 是 delta，不是局部矩阵

`getControlMapping(ctrl)` 给出 parm 名（实测）：

```python
mapping.t    = 'point_1_t'      # hou.Vector3
mapping.r    = 'point_1_r'
mapping.s    = ''               # 本 rig 无 scale 控制
mapping.keys = {'t', 'r'}
```

`rig.graph_parms` 的键（实测）：

```
['Base.rig', 'Base.skel',
 'point_0_r', 'point_0_t', 'point_1_r', 'point_1_t', 'point_2_r', 'point_2_t']
```

初始全为 `(0,0,0)`。写 `point_2_t = (1,2,3)` 后实测 `local = (1,2,3.5)`
（`restlocal` z=0.5 被叠加）、`world = (1,2,4)`。所以：

```
local = restlocal × delta        →        delta = local × restlocal⁻¹
world = local × parentxform      →        local = world × parentxform⁻¹
```

合并（Houdini 行向量约定，左乘先作用）：

```python
delta = world_desired * data.parentxform.inverted() * data.restlocal.inverted()
rig.graph_parms[mapping.t] = delta.extractTranslates()
rig.graph_parms[mapping.r] = delta.extractRotates()
```

### 10.2 坑 2：动画启用时，动画层每次求值都会覆盖 `graph_parms`

实测追踪（anim ON）：

```
baseline          parms.t=[0,0,0]    world=[0,0.3,0.9539]
write t=(1,2,3)   parms.t=[1,2,3]    world=[0,0.3,0.9539]   ← 没生效
setDirty          parms.t=[1,2,3]    world=[0,0.3,0.9539]
updateDirtyRigs   parms.t=[1,2,3]    world=None             ← 缓存失效
cm.update         parms.t=[1,2,3]    world=[0,0.3,0.9539]   ← 被动画层压回
```

`scene.enableAnimation(False)` 后同样的写入立刻生效（`world=[1,2,4]`），
但**代价是丢掉动画姿态**（姿态回到 rest：point_2 z=1.0 而非 0.9539）。
所以 `enableAnimation(False)` **只适合一次性静态求解，不适合交互工具**。

### 10.3 正确写法：提交到通道

```python
binding = scene.getData(rig_path + '/animbinding')   # _apexscene.ChannelPrimBindings

rig.graph_parms[mapping.t] = delta.extractTranslates()
binding.setKeysFromDict(scene, frame, True,          # add_missing=True → 按需建通道
                        pattern=mapping.t, force_key=True)
rig.setDirty(); scene.updateDirtyRigs(); cm.update(scene)
```

验证（保存到几何体 → 新 Scene 重载，**动画保持启用**）：

```
goal T=[0.25,0.55,0.8]              got T=[0.25,0.55,0.8]     err=0.00000000  MATCH
goal T=[0.1,0.4,0.3] R=[0,30,0]     got 同值                  T err=0 R err=0  MATCH
goal T=[0.4,0.6,0.5] R=[0,25,0]     got 同值                  T err=0 R err=0  MATCH
```

通道由 `['point_0_t','point_0_r']` 变为 `['point_0_t','point_2_t','point_0_r']`——
`point_2_t` 被自动创建。

注意：`setKeysFromDict` 之后在**同一个 Scene 内**再读，世界值可能仍是旧值（动画层缓存），
重载后才对。交互工具若要即时反馈，见 §10.4。

### 10.4 交互工具的推荐分离（实机验证 + 推导）

外部交互工具（如 3D 鼠标 / spaceMouse 类）接入 APEX 的正确形态：

```python
data      = cm.getControlData(ctrl_path)      # 取代任何「从几何体点属性抓 xform」的做法
cur       = data.xform                        # 当前世界
goal      = hou.hmath.buildTranslate(world_delta) * cur
delta     = goal * data.parentxform.inverted() * data.restlocal.inverted()
rig.graph_parms[mapping.t] = delta.extractTranslates()
```

- **拖动中**：只写 `graph_parms` + `rig.setDirty()` + `updateDirtyRigs()` + `cm.update()`；
  需要即时生效则该 Scene 用 `enableAnimation(False)`（临时求解态）。
- **松手**：`setKeysFromDict(..., force_key=True)` 落到动画层。

顺带记录一个已确认的封闭边界：视口 handle 系统对外部写入是封闭的
（`PI_OpHandleLink::setParmValue()` 是 protected，非 owning state 拿不到）。
本方案完全不碰 handle、走 runtime 数据，因此不受该限制。

---

## 11. ChannelPrimBindings 完整 API

**实机验证**（`scene.getData(rig_path + '/animbinding')` 的类型是 `_apexscene.ChannelPrimBindings`）。

```
setKeysFromDict(scene, frame, add_missing, pattern='*', autokey=True,
                autocommit=True, component_indices=None, only_existing=False,
                autokey_tuples=False, force_key=False, write_to_muted_layer=False)
setDefaultFromDict(scene, pattern='*', layer='BaseAnimation', initializing=False)
computeKeysFromDict(scene, parms: apex.Dict, frame) -> apex.Dict
createNewChannels(scene, py_channel_prims, parmtype, parmname, layer='BaseAnimation')
getChannelNamesForParms(scene, list[str]) -> dict[str, list[str]]
activeLayerGeoPath(scene) -> str          ← 需要 scene 参数
layerGeoPath(str) -> str
updateFromChannelPrims(scene, frame)
parms(layer='BaseAnimation') -> list[str]
getStaticParms(scene) / setStaticParmsFromDict(scene, dict)
constructLayer(scene, str) -> str
removeKeys / deleteChannels / renameChannels / clearChannels / clearPending
mute / unmute / isMuted / hasLayer / hasParm / bakeToGeometry
keyedFrameRange / getKeyedTimes / getKeyedTimesForParm
channelHasKeyAtFrame / channelHasKeyframes / channelIsPending
rig_path  geo_path  channelCollectionName()
```

已实测的具体签名补充：

```
removeKeys(scene, frame, pattern='*', component_indices=None, write_to_muted_layer=False)
```

用法要点：

| 目标 | 用什么 | 注意 |
|---|---|---|
| 落 timeline key | `setKeysFromDict(scene, frame, True, pattern=..., force_key=True)` | `add_missing=True` 是**唯一**会创建缺失通道的路径 |
| 写无 key 的 default 姿态 | `setDefaultFromDict(scene, pattern=...)` | **通道必须已存在**，否则静默无效（见 §16） |
| 删 key | `removeKeys(scene, frame, ...)` | 需要 `frame` 参数；删掉的是值本身，**不会退化成 default** |

---

## 12. 关键帧动画验证

**实机验证**（在内存副本上给 `point_1_r` 打 frame 1 / 48 两个 key 后）：

```
point_1_rx  keys=[1.0, 48.0]
point_1_ry  keys=[1.0, 48.0]
point_1_rz  keys=[1.0, 48.0]
```

| frame | `point_1` R | `point_2` world T |
|---|---|---|
| 1.0 | `[-17.46, -0.0, 0.0]` | `[0.0, 0.3, 0.9539]` |
| 12.0 | `[-17.63, 7.94, -2.51]` | `[0.0724, 0.2985, 0.9489]` |
| 24.0 | `[-19.79, 27.59, -9.46]` | `[0.2427, 0.2812, 0.894]` |
| 36.0 | `[-26.2, 47.19, -19.85]` | `[0.3845, 0.2459, 0.7819]` |
| 48.0 | `[-32.17, 55.7, -27.46]` | `[0.433, 0.225, 0.7154]` |

`point_2` **自身没有任何通道**，世界坐标却随父级 `point_1` 的旋转变化——
**父链传导正确**，这正是原来缺失的部分。
`updateEvaluationParms(frame)` 是帧驱动的唯一入口。

---

## 13. `animation` Data parm：活动节点状态的真实载体

**实机验证。**

活动 `sceneanimate` 节点的 APEX 场景状态**不在几何体里，而在节点的 `animation` Data parm 里**：

```python
p = hou.parm('/obj/geo1/sceneanimate1/animation')   # Data parm
d = p.asData()
# → {'geometry': <str>}
```

关键事实：

| 项 | 事实 |
|---|---|
| `asData()` 返回 | `dict`，形如 `{'geometry': <str>}` |
| `geometry` 的值 | **base85 字符串**，不是 `hou.Geometry` 对象 |
| 写回编码 | `base64.b85encode(geo.data()).decode('ascii')` |
| 直接塞 `hou.Geometry` | 报 `'Geometry' object has no attribute 'encode'` |

```python
import base64

payload = {'geometry': base64.b85encode(geo.data()).decode('ascii')}
p.setFromData(payload)
```

即：`setFromData` 要求 `geometry` 是可 `.encode()` 的字符串，Data parm 层不接受几何体对象。
**但在活动节点上做这件事之前，先读完 §14 和 §17。**

---

## 14. 【严重 / 破坏性】`revertToDefaults()` 会摧毁 APEX 场景

**实机验证。这是本文最危险的一条，单独成节。**

对持有 APEX 场景的 `animation` Data parm 调用 `revertToDefaults()`，**会清空整个 APEX 场景状态**：

| 调用后 | 结果 |
|---|---|
| `/animation/*` 数据路径 | 全部消失 |
| 层栈 `scene.layers()` | 消失 |
| `animbinding` | 消失 |
| `parm.isAtDefault()` | 变成 `True` |

它**不是**「撤销上一次写入」，而是**摧毁数据**。曾因此弄坏用户的活动节点，且无法自行恢复
（§15 的重建 API 只能重建空结构，恢复不了原有姿态与通道），最终靠用户侧恢复。

### 铁律

1. **绝不对持有 APEX 场景的 Data parm 调用 `revertToDefaults()`。**
2. 所有写入实验一律在**内存副本**（`apex.Scene()` + `loadFromGeometry(geometryAtFrame(...))`）
   或**一次性复制出来的测试节点**上做，不碰用户活动节点。
3. 动手前先确认自己在哪个节点上；破坏性调用没有回滚路径。

---

## 15. 结构重建 API

**实机验证**（场景被清空后可用；但**重建 ≠ 恢复原数据**——只能得到空结构，姿态与通道不会回来）。

```python
# 1. 建层栈
scene.initializeAnimStack(default_clip_path='/animation/default.clip')

# 2. 建动画绑定，返回两个路径
clip_geo_path, animbinding_path = scene.createAnimBinding(rig_path)

# 3. 挂上 ChannelPrim 绑定
scene.addChannelPrimBinding(data_path, animation_geo, rig_path)
```

| API | 签名 / 返回 |
|---|---|
| `Scene.initializeAnimStack` | `initializeAnimStack(default_clip_path='/animation/default.clip')` |
| `Scene.createAnimBinding` | `createAnimBinding(rig_path)` → `(clip_geo_path, animbinding_path)` |
| `Scene.addChannelPrimBinding` | `addChannelPrimBinding(data_path, animation_geo, rig_path)` |

这组 API 的正当用途是**从零构造**一个带动画层的场景，不是灾后恢复工具。

---

## 16. 通道 / 默认值 / 删键的语义细节

**实机验证。** 这一节是最容易导致「误判有没有动画」的地方。

### 16.1 值可以只存在 default 里，没有任何 key

测试场景实测：

```
chan point_0_rx   keys=[] default=-17.46032
chan point_0_ry   keys=[] default=0.00000
...
```

**全部通道 `keyFrames()` 为空**，姿态完全来自 `defaultValue()`；`keyedFrameRange()` 返回 `None`。

反过来也成立：通道可以只有 key 而 default 无意义。所以：

> **几何体层面的 `keyFrames()` 为空，不能证明「没有动画」。**
> key 可能还 pending 在视口 Animate state 里，没有提交进 SOP 输出几何体
> （对应 `channelutils` 的 `pending_channels` / `channelIsPending`）。

判定动画有无的正确做法：用 `ChannelPrim.eval(frame)`，**并同时看 `defaultValue()`**。

顺带提醒：这个测试场景实际上**没有关键帧**。如果你以为它 k 过动画，那些 key 没有存下来。

### 16.2 `setDefaultFromDict` 不会创建缺失通道

`setDefaultFromDict(scene, pattern=...)` **不会创建缺失的通道**——通道不存在时它**静默无效**，
不报错、不返回失败。

必须先建通道：

```python
binding.setKeysFromDict(scene, frame, True,          # add_missing=True
                        pattern=..., force_key=True)
# 之后 setDefaultFromDict 才有作用
binding.setDefaultFromDict(scene, pattern=...)
```

### 16.3 通道按需创建

只有被改动过的控制器才有通道。`setKeysFromDict(..., add_missing=True)` 是按需创建通道的入口
（实测：`point_2_t` 就是这样被创建出来的）。

### 16.4 `removeKeys` 的语义

```
removeKeys(scene, frame, pattern='*', component_indices=None, write_to_muted_layer=False)
```

- **需要 `frame` 参数**；
- 删 key 会**连值一起去掉**，**不会**退化成 `defaultValue()`。想保留静态姿态就别指望删 key 后
  fallback 到 default，要显式写 default。

---

## 17. 写回活动节点（已解决）

**实机验证。** 早期结论说这条路「有损」，那是**错的**——损耗来自提取步骤的 bug，
不是 API 限制。修正后零误差。

### 17.1 曾经的错法与真正的原因

```
scene.saveToGeometry()
  → 只挑出名为 `animation` 的 packed prim      ← 这里就是 bug
  → merge 进新 hou.Geometry
  → parm.setFromData({'geometry': b85(...)})
```

现象：写回后骨架塌回 rest，通道还在但姿态丢失。

原因：`animation` Data parm 的顶层有**三个** packed prim ——
`catalog.data`、`default.clip`、`animation`。只挑 `animation` 一个写回，
另外两个被丢掉，姿态随之丢失。

### 17.2 正确写法：保留 parm 原有的全部顶层 prim

按「原 parm 有哪些顶层 prim」为白名单，只删多出来的角色折叠（如 `line1.char`）：

```python
def commit(scene, node):
    keep = [p.attribValue('name') for p in node.parm('animation').eval().prims()
            if p.type() == hou.primType.PackedGeometry]        # 白名单 = parm 原有集合
    full = hou.Geometry(); scene.saveToGeometry(full)
    work = hou.Geometry(); work.merge(full)
    doomed = [p for p in work.prims()
              if p.type() == hou.primType.PackedGeometry
              and p.attribValue('name') not in keep]           # 通常只有角色折叠
    if doomed:
        work.deletePrims(doomed)
    node.parm('animation').setFromData(
        {'geometry': base64.b85encode(work.data()).decode('ascii')})
    node.cook(force=True)
```

实测：写回后重载，世界坐标与目标误差 `0.00000000`；原有姿态（`point_0_r` 的倾斜）保留。

`Scene.writeToGeometry()` 存在且输出的 prim 集合与 `saveToGeometry()` 相同
（实测都是 `['animation','catalog.data','default.clip','line1.char']`）；
上面的白名单写法用 `saveToGeometry` 已验证可用，`writeToGeometry` 未单独验证。

### 17.3 两趟规则：父级先提交，重载后再解子级

**实机验证。** 改父级后必须**先提交、再重载**才能拿到新的 `parentxform`。
同一趟里接着解子级，用到的是**旧** `parentxform`，世界坐标会漂移：

| root_rx | 一趟（错） | 两趟（对） |
|---|---|---|
| -60 | err 0.1613157 | err 0.0000000 |
| -10 | err 0.3635946 | err 0.0000000 |
| 20 | err 0.2751319 | err 0.0000000 |
| 40/45 | err 0.2301105 | err 0.0000000 |

```
pass 1: 写父级 graph_parms → setKeysFromDict → commit → cook
pass 2: 重新 loadFromGeometry（拿到新 parentxform）→ 解子级 → commit
```

根因同 §10 坑 2：只写 `graph_parms` 不会在动画启用时传导，`parentxform` 直到
提交并重新加载才更新。任何「相机相对 / 世界空间钉住子控制器」的工具都必须照此分两趟。

### 17.4 安全纪律（铁律）

写入实验一律在**一次性复制的测试节点**（display 关）或内存副本上做，
**绝不碰用户的活动节点**。§14 的事故就是违反这条的直接后果。

---

## 18. 测试设计指引：故意让局部与世界不对齐

**实机验证 / 给后来者的指引。**

本轮测试绑定**刻意保持三个点倾斜**，使局部坐标系与世界坐标系方向**不一致**
（`point_0_rx = -17.46°` 造成的弯曲就是为此）。

原因很直接：**如果局部与世界方向对齐，一个错误的世界坐标换算会看起来像成功了。**
`world == local` 的退化情形下，把 `.local` 当 `.xform` 用、漏掉 `parentxform` 或漏掉
`restlocal`，都能通过测试——然后在真实 biped 上全线崩掉。

**建议任何类似测试都照此办理**：

1. 让被测控制器的父链带上非零旋转，局部轴与世界轴不平行；
2. 让父链同时带上非零位移（本例 `restlocal` z=0.5），这样漏乘 `restlocal` 会立刻暴露；
3. 拿一个独立的真值来源交叉验证——本例用 `Skel_Invoke_OUT` 的三点 `P`
   与 `.xform` 逐点比对，误差 0.00000000 才算过；
4. 写入验证必须**保存到几何体 → 新 Scene 重载**再读，且**动画保持启用**，
   否则测的是缓存不是落地结果。

---

## 19. 进入 Scene Animate 运行时的三条路径

> **未验证**：以下三条是 API 面调查结果，代码片段未逐条实机跑通。
> 不进视口、纯 Python 的**已验证**路径见 §8，优先用那条。

### 方式 A：通过 SceneViewer

```python
import hou
sv = hou.ui.paneTabOfType(hou.paneTabType.SceneViewer)
kwargs = {}
sv.runStateCommand('getState', kwargs)
state = kwargs['state']

scene    = state.scene
rig      = scene.getData('/char/Base.rig')
ctrl_mgr = scene.getData('/char/Base.rig/control_manager')

mapping = ctrl_mgr.getControlMapping('/char/Base.rig/ctrl')
t = rig.graph_parms[mapping.t]                       # 注意：这是 delta，不是局部量
rig.graph_parms[mapping.t] = hou.Vector3(x, y, z)
state.runSceneCallbacks()
```

### 方式 B：通过 statecommandutils

```python
import apex.ui.statecommandutils as scu
state = scu.getAnimateState()      # 视口不在 Animate 状态时返回 None（实机验证）
scene = state.scene
```

### 方式 C：自定义 tool 注入

```python
import apex.ui.statecommandutils as scu
kwargs = {}
scu.startTool("mypackage.mytool", kwargs)
```

模块需提供 `load(viewer_state)` 返回 tool 对象，tool 对象接收 `onMouseEvent` / `onKeyEvent` 回调。

### 获取选中的控制器（未验证）

```python
state = scu.getAnimateState()
primary      = state.primary_control      # 最后选中的
all_selected = state.control_paths        # 所有选中的
ctrls        = getattr(state, 'control_selection', None)
```

### 读取输出端口数据（已被实机部分推翻）

API 面调查给的写法是 `rig.graph.outputPorts()` + `port.portName()`。
**实测 `outputPorts()` 的元素是 `int`，没有 `portName()`**。正确做法用 `scene.outputBindings()`，
实测返回：

```
/line1.char/Base.rig/controls_output
/line1.char/Base.rig/output
/line1.char/Base.rig/drawable_output
/line1.char/Base.rig/parms_output
/line1.char/Base.rig/post_constraint_parms
```

---

## 20. H22 新增 API 清单（vs H21）

**文档推导**（来自安装目录对比 + SideFX 论坛整理）。

| API | 说明 |
|---|---|
| `hou.apex.newSessionGraph()` | HOM 新增（属于 `hou.apex` 图构建 API，不是 runtime） |
| `apex.nodeFromSessionId()` / `apex.wireFromSessionId()` / `apex.stickyNoteFromSessionId()` | HOM 新增 |
| `hou.ApexNode` / `hou.ApexNodeConnection` / `hou.ApexStickyNote` | HOM 新增类 |
| `hou.SceneViewer.setCurrentState()` | HOM 新增方法 |
| `apex.control_2.getParmsForControls()` | 运行时新增（H22 论坛确认） |
| `state.primary_control` / `state.control_paths` | H22 论坛明确可用 |
| `state.hud_channel_panel.hud_window` | H22 论坛明确可用 |
| `apex.ui.animationhudwidgets` | H22 论坛出现 |
| `apex.ui.statecommandutils` 全套 | H22 论坛出现详细用法 |
| `binding.setKeysFromDict()` 详细参数 | H22 论坛出现更多参数说明（完整签名见 §11，已实机确认） |
| `binding.activeLayerGeoPath()` | H22 论坛确认（**实机修正**：需传 `scene`） |
| Python 3.11 → 3.13 | 运行时版本升级 |
| `_apex.pyd` / `_apexscene.pyd` | 两个版本都有，H22 功能更多 |

---

## 21. 踩坑清单

**全部实机验证。**

| 坑 | 现象 | 处理 |
|---|---|---|
| 对 `animation` Data parm 调 `revertToDefaults()` | **整个 APEX 场景被清空**，无法自行恢复 | **绝对禁止**，见 §14 |
| 读 `.local` / `graph_parms` 当世界坐标 | 恒为 `(0,0,0)` 或 rest 偏移 | 用 `.xform`；记住 `localtransform` 不含 `restlocal` |
| 忘记 `cm.update(scene)` | `getControlData` 返回 `None` | 每次求值后调用 |
| `updateDirtyRigs()` 后直接读 | `None`，`AttributeError` | 之后必须 `cm.update(scene)` |
| 只写 `graph_parms` | 动画层覆盖，写入无效 | `setKeysFromDict` 落地 |
| `enableAnimation(False)` 做交互 | 姿态回 rest，丢动画 | 仅用于静态求解 |
| 只看 `keyFrames()` | 空列表，误判无动画 | 用 `eval(frame)` + 看 `defaultValue()`；key 可能还 pending |
| `setDefaultFromDict` 对不存在的通道 | 静默无效，不报错 | 先 `setKeysFromDict(..., add_missing=True)` |
| `removeKeys` 少传 `frame` | 签名不匹配 | `removeKeys(scene, frame, ...)`；且删 key 不会退化成 default |
| 回写时只挑 `animation` 一个 prim | 骨架塌回 rest，姿态丢失 | 保留 parm 原有全部顶层 prim，见 §17.2 |
| 改父级后同一趟解子级 | 世界坐标漂移 0.16~0.36 | 两趟：父级先提交并重载，见 §17.3 |
| 把 `hou.Geometry` 交给 `setFromData` | `'Geometry' object has no attribute 'encode'` | 用 `base64.b85encode(geo.data()).decode('ascii')` |
| `getControlTransforms` 的 key | 是控制器短名不是全路径 | 自行映射 |
| `xordString` / `rordString` | 是方法 | 加 `()` |
| `activeLayerGeoPath()` 无参调用 | pybind11 参数错误 | 传 `scene` |
| `rig.graph.outputPorts()` | 元素是 `int`，无 `portName()` | 用 `scene.outputBindings()` |
| 从几何体点属性抓 `xform` / `transform` | 属性不存在，静默回退单位矩阵 | 标准 rig 图不产出该属性（那是 APEX Script 原型的事），用 `getControlData()` |
| `setKeysFromDict` 后同 Scene 内再读 | 仍是旧值（动画层缓存） | 重载后才对；交互反馈见 §10.4 |
| 局部轴与世界轴对齐的测试绑定 | 错误换算也能通过测试 | 刻意让父链带旋转+位移，见 §18 |

---

## 22. 注意事项

**文档推导。**

- **C 扩展不可直接内省**：`_apex.pyd` / `_apexscene.pyd` 是编译后的二进制，`dir()` 能看导出但无源码，
  签名只能试调。
- **undo 是手动管理的**：`hou.undos.add()` + `apex.utils.addAnimateStateUndo()`
  或 `apex.stateutils_2.SetChannelsUndo`。
- **Channel List 不自动刷新**：`rig.graph_parms` 写入后 `runSceneCallbacks()` 刷新视口
  但不刷新 Channel List UI——这是已知限制。
- **Python 3.13**：H22 运行时是 Python 3.13（H21 是 3.11），有 CPython 版本相关代码要注意。
- **视口 handle 对外部写入封闭**：`PI_OpHandleLink::setParmValue()` 是 protected，
  非 owning state 拿不到。走 runtime 数据可绕开（§10.4）。

---

## 23. 复用模块

`research/apex_world_xform.py`（**实机自检通过**）：

```python
load_scene(sop_node, frame=None)              # 加载 + 求值，返回 apex.Scene
control_paths(scene)                          # 全部控制器路径
get_world_xform(scene, ctrl)                  # 世界 hou.Matrix4
get_world_xforms(scene, ctrl_paths=None)      # 批量
world_to_parm_delta(scene, ctrl, world_xform) # 世界 → graph_parms delta
set_world_xform(scene, ctrl, world_xform, frame=None, key=True,
                translate=True, rotate=True)  # 世界写入（含落键）
commit(scene)                                 # 序列化回 hou.Geometry
```

自检结果：读值与 `Skel_Invoke_OUT` 完全一致；写入 `T=[0.4,0.6,0.5] R=[0,25,0]` 重载后误差 0；
测试全程在内存副本上进行，`/obj/geo1/sceneanimate1` 未被修改。

---

## 24. 未验证 / 后续

- **biped 复杂绑定**：本轮只验证 3 点 FK。IK / space-switch / MultiControl（`.ctrl`）/
  GroupMapping（`subcontrol_mapping`）未测；`getControlData` 应同样适用，但 IK 控制器的
  `parentxform` 语义需实测。
- **约束**：`/constraints/constraint.constr` 存在但未启用；`post_constraint_parms` 与
  `isConstraintEnabled` 的交互未测。
- **多层动画**：只有 `BaseAnimation` 单层。additive 层、层权重、`flattenedLayers()`
  的合成结果未验证。
- **scale**：本 rig `mapping.s` 为空，缩放路径未测（`scaleinheritance` 字段存在）。
- **写回活动节点**：已解决（§17），`writeToGeometry()` 与 `editanimation` 未单独验证。
  `Scene.writeToGeometry()` 与节点自身 `editanimation` 机制**待验证**。
  要影响视口的另一条未测路径是 Python SOP 输出 `commit()` 的几何体，
  或在 Animate state 内经 `statecommandutils` 操作。
- **灾后恢复**：§15 的重建 API 只能造空结构。被 `revertToDefaults()` 清空的场景
  **没有已知的程序化恢复手段**。
- **retargeting / biped mapping**：本轮未涉及。
- **第 4 / 5 / 19 / 20 / 22 节整体**：API 面调查，未逐项试调。

---

## 25. 源出处与冲突裁决

本文合并自：

| 出处 | 性质 | 处理 |
|---|---|---|
| `D:\code\dev\Houdini\spaceMouse3\APEX_RUNTIME_KNOWLEDGE.md` | apex runtime API 面调查（大部分未验证） | 全量吸收，标注为未验证 / 文档推导 |
| `D:\code\dev\Houdini\spaceMouse3\APEX_WORLD_XFORM_SOLVED.md` | 实机验证的世界变换结论 | 全量吸收，作为冲突裁决基准 |
| `devlog/apex-scene-animate-runtime.md` | Cyl1nder 侧既有短摘要 | 已并入，无新增独有内容 |

发现的源冲突及裁决（**一律以实机测量为准**）：

| 冲突点 | API 面调查说 | 实测说 | 采用 |
|---|---|---|---|
| `graph_parms` 语义 | 「控制器的当前值」 | 叠加在 `restlocal` 上的 **delta** | 实测（§10.1） |
| 取世界矩阵 | `getControlXform(ctrl_path)` | `getControlData(ctrl).xform` 已验证 | 实测，`getControlXform` 标为未验证（§4） |
| 遍历输出端口 | `graph.outputPorts()` + `port.portName()` | 元素是 `int`，无 `portName()` | 实测，改用 `scene.outputBindings()`（§19、§21） |
| `activeLayerGeoPath()` | 无参调用 | 必须传 `scene` | 实测（§11） |
| `setKeysFromDict` 签名 | 省略 `add_missing`，只给 `pattern` / `force_key` | `add_missing` 是第三个位置参数 | 实测完整签名（§11） |
| 无 key 姿态怎么写 | 「用 `setDefaultFromDict`」 | 通道不存在时它静默无效 | 实测，先 `setKeysFromDict(add_missing=True)` 建通道（§16.2） |
| 写通道几何体 | `scene.getData(channels_path, channels_geo)`（读接口传两参，疑为 `setData` 笔误） | 未实测该路径 | 保留但不推荐；落地一律走 `setKeysFromDict`（§10.3） |
| `getControlTransforms` 归属 | 同时出现在 `scene_2` 与 `control_2` | `control_2.getControlTransforms` 已验证，返回短名 key | 两者并存记录，推荐 `control_2`（§5.3） |
| 回写活动节点 | 两源均未给出结论 | 先判「有损」，后查明是提取 bug；保留 parm 原有全部顶层 prim 即零误差 | 实测，§17 已改写为「已解决」 |
