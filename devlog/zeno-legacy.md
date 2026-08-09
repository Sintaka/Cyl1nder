# Zeno 技术遗产调研（Cyl1nder 前端选型参考）

> 调研对象：`D:\code\dev\zeno`（Zeno 2.0，zenustech/zeno，MPL-2.0）。只读探索，未修改任何文件。
> 评估目标：为 Houdini ⇄ WebGL 前端（three.js + @antv/x6 + Vite/TS）挖掘可迁移的技术与可借鉴的架构。

## 0. 项目现状与"破坏"情况（先说结论）

- Git 工作树干净，位于 `master`，HEAD 为 `56c74cc3e "Remove garbage images"`（2025-09-19）。所谓"破坏"主要是最近两个 commit 删除了 `docs/` 下 5 张图片和 README 里的图片链接，代码本体基本完好。**不建议把这次删除理解为源码损坏**，但仓库确实存在以下"不可直接用"的问题：
- **所有 git submodule 均为空目录**（克隆未初始化）：`projects/cgmesh/libigl`、`projects/Alembic/Alembic`、`projects/zenvdb/openvdb`、`projects/FBX/assimp`、`projects/Rigid/bullet3`、`projects/Python/CPython`、`projects/CUDA/zpc`、`projects/MeshSubdiv/OpenSubdiv`、`projects/Geometry/instant_meshes`、`projects/Geometry/fTetWild` 等。因此依赖这些库的求解器节点库（OpenVDB、Bullet、FBX、CPython 等）**无法离线编译**。
- 少量空/占位源文件（Git 已跟踪，多为无关紧要的残留）：`ui/zenodesign/resizablesvgitem.{cpp,h}`、`ui/zenodesign/ztabbar.cpp`（0 字节）；`ui/zenoedit/zenoversion.cpp`（2 字节）；`ui/zenoio/acceptor/coreacceptor.{h,cpp}`（纯占位）；`ui/zenoedit/util/log.cpp`（20 字节）。`zenodesign` 是独立的 Designer 子程序，默认 `ZENO_BUILD_DESIGNER=OFF`，不影响主编辑器。
- 无 `build/` 产物目录；本次未尝试编译（离线且子模块缺失），以下判断全部基于源码阅读。
- 规模：Git 跟踪约 3364 个文件；`zeno/`(核心) 841、`zenovis/`(渲染) 207、`ui/`(界面) 1111、`projects/`(节点库) 1063 个文件。

## 1. 技术栈总览

| 层面 | 技术 | 关键证据 |
|---|---|---|
| 语言/构建 | C++（C++17 风格），CMake，可选 TBB/OpenMP | 根 `CMakeLists.txt`、`BUILD.md` |
| 桌面 UI | **Qt 5.14+ Widgets**（QGraphicsScene 节点画布、QDockWidget 面板、QStandardItemModel） | `ui/zenoedit`、`ui/zenomodel` |
| 节点编辑器 | 自研 QGraphicsScene 场景 + QGraphicsItem（`ZenoNode`/`ZenoLink`），模型/视图分离 | `ui/zenoedit/nodesys/*` |
| 渲染器 | **OpenGL 3.3 自研**（GLAD 加载，前向管线）；另有 OptiX 引擎与旧版 zhxx 引擎 | `zenovis/` |
| 序列化 | JSON（rapidjson，`.zsg` 编辑器格式 + 核心"命令流"格式）+ 自定义二进制对象编码 | `zeno/.../loadGraph.cpp`、`ui/zenoio/*`、`zeno/src/funcs/ObjectCodec*` |
| Python 桥 | **原生 CPython C API（非 pybind11）**：ctypes 加载 C 导出 + 嵌入式解释器 | `zeno/extra/CAPI.h`、`projects/Python/Lib/ze/zeno.py`、`zeno/src/nodes/PythonNode.cpp` |
| 外部进程桥 | 编辑器⇄计算子进程 TCP/管道 IPC（自定义包协议）；LiveSync HTTP/TCP；Unreal HTTP+msgpack；gRPC 风格 protobuf 原型 | `ui/zenoedit/launch/*`、`projects/UnrealTool`、`projects/RPC` |
| 内置依赖 | rapidjson/glm/half_float/tinygltf（`zeno/tpls/include`）、qwt、curl | 各目录 | 

## 2. 节点系统架构（`zeno/`，最值得借鉴的部分）

### 2.1 核心数据结构（`zeno/include/zeno/core/`）
- `Session.h`：全局"节点类注册表" `nodeClasses: map<string, INodeClass>`；每个 `INodeClass = Descriptor + 工厂函数`；还持有 `GlobalState/GlobalComm/GlobalStatus/EventCallbacks/UserData`。静态单例 `getSession()`。
- `Descriptor.h`：节点类型自描述——`inputs/outputs/params/categories/doc`，每个 socket 是 `(type, name, defl, doc)`。**这是 UI 自动生成节点面板与端口的基础**，等价于 x6 的节点元数据。
- `Graph.h`：一张图 = `nodes: map<id, INode>` + `inputBounds: map<dstSocket, (srcNode, srcSocket)>`（即"边"）+ `nodesToExec` + `portals`（PortalIn/PortalOut 跨子图传值）+ 子图（`SubnetNode` 内嵌 `Graph`）+ `Context`（求值访问集）+ `DirtyChecker`。
- `INode.h`：节点实例 = `inputs/outputs: map<string, zany>` + `kframes`（关键帧参数）+ `formulas`（表达式参数）+ `inputBounds`（入边）。`zany = shared_ptr<IObject>`，所有数据统一走智能指针。
- `IObject.h`：数据对象多态基类，带 `clone/assign/move_clone/move_assign` 与 `method_node("view")` 序列化钩子；`zany` 是全局数据句柄。**数据与节点解耦、全部经 shared_ptr 传递**是它"易扩展"的根因。
- `defNode.h`：`ZENO_DEFNODE`/`ZENDEFNODE` 宏，声明式注册节点（类 + Descriptor），一行定义一个节点。

### 2.2 求值/调度模型（`zeno/src/core/Graph.cpp`、`INode.cpp`）
- **惰性拉取式（lazy pull）**：`Graph::applyNode(id)` 先查 `Context.visited`（防重复执行），再 `node->doApply()`；`doApply → preApply →` 对每条入边 `requireInput(ds)`，`requireInput` 递归 `graph->applyNode(srcNode)` 上游节点。整图由 `applyNodes(nodesToExec)` 从"执行出口节点集"触发。
- **DirtyChecker**（`zeno/extra/DirtyChecker.h`）：上游节点被重新执行后，向下游 `taintThisNode`，下游据此决定是否重算/是否报脏——一个很轻的增量失效机制（配合缓存/调度）。
- **输入优先级**：`get_input(id)` = 关键帧 > 公式 > 字面量输入；无连接时回落到参数（`id + ":"` 后缀），实现"参数即默认输入"。
- **临时节点调用**（`TempNode.h` / `Graph::callTempNode`）：不建图直接实例化一个节点类并传参运行，用于表达式求值（`StringEval`/`NumericEval`）和公式（`get_formula` 把 `=...` 表达式丢给临时节点算）。**这在 Web 端可平移为"运行时函数注册表 + 直接调用"。**
- **控制流节点**（`zeno/src/nodes/ControlNodes.cpp`）：`IBeginFor/EndFor/BreakFor`、`IfElse/IF/EndIF`、`IBranch/EndBranch`、`ConditionedDo`、`SubstepDt`、`CachedIf/CachedByKey`（节点级缓存）。`ContextManagedNode`（`zeno/extra/ContextManaged.h`）通过压栈/出栈 `Context` 实现"域"（for 循环体各自独立 visited 集）——**图灵完备的命令式数据流**，明显强于纯 DAG。
- **子图/端口**：`SubnetNode`（内嵌子 Graph）、`ISubgraphNode`（`get_subgraph_json` 懒加载子图）、`PortalNodes.cpp`（PortalIn/PortalOut 跨子图接线）、`Subgraph.cpp`（SubInput/SubOutput/SubEndpoint 声明子图边界）。嵌套图 + 端口映射在 x6 里对应"复合节点"，可直接照搬这套语义。
- **帧/步进状态**（`GlobalState.h`）：`frameid/substepid/frame_time` + `frameBegin/substepBegin/frameEnd`；`GlobalComm`（`extra/GlobalComm.h`）维护**逐帧 ViewObjects 缓存**（`m_frames`：每帧一组"要渲染的对象"），支持磁盘缓存与 **stamp 增量**（见渲染节）。

### 2.3 类型系统（`zeno/include/zeno/types/`）
- `PrimitiveObject.h` + `AttrVector.h`：**核心网格数据类型**——`verts/points/lines/tris/quads/loops/polys/edges/uvs` 各自是一个 `AttrVector<BaseVector>`（`values` + 任意 `attrs: map<string, variant<vector<vec3f>, vector<float>, vector<vec3i>, int, ...>>`）。即"位置数组 + 每元素任意属性数组"，与 three.js `BufferGeometry` 的 attribute 模型几乎一一对应（见 §6 映射表）。
- 其余：`NumericObject`（int/float/vecN）、`StringObject`、`ListObject`、`DictObject`、`CurveObject`（关键帧曲线）、`MaterialObject`、`InstancingObject`、`LightObject`、`CameraObject`、`ShaderObject`、`UserData`（对象附加元数据，如 `interactive`、`objRunType`、`stamp-*`）。

## 3. 渲染器（`zenovis/`）

- **Scene 三件套**（`Scene.h`/`Scene.cpp`）：`camera + drawOptions + shaderMan + objectsMan + renderMan`；`RenderManager` 支持按引擎名切换 `bate`（OpenGL 前向）/`optx`（OptiX）/`zhxx`（旧）。`Session`（`zenovis/Session.cpp`）是给 UI 的薄封装（set_window_size、set_show_grid、set_render_wireframe、paint 驱动）。
- **增量对象管理**（最值得抄的渲染侧设计）：
  - `ObjectsManager`（`ObjectsManager.cpp`）：`insertPass()/may_emplace(key)/has_changed()` 的**增量 diff 模式**——每帧只对"新 key"建图形，旧 key 复用；配合 `stamp-change`（`TotalChange/DataChange/ShapeChange/UnChanged`）元数据，实现**未变对象不重建**。
  - `GraphicsManager`（`bate/GraphicsManager.h/.cpp`）：`key → IGraphic` 映射，`makeGraphic(Scene*, IObject*)` 按对象类型分派（Primitive/Light/Camera/实例/贴图…），`realtime_graphics` 与静态 graphics 分层。
- **图形对象**（`bate/IGraphic.h`、`bate/GraphicPrimitive.cpp`）：`IGraphicDraw::draw()` 每帧画；`GraphicPrimitive` 把 `PrimitiveObject` 的 attrs 打包进 VBO（pos/clr/nrm/uv/tang），按 points/lines/tris/loops/polys 分发 draw call，含切线计算、实例化（`InstancingObject`）。
- **Shader 与后处理**：`bate/shader/*`（tris/lines/points/edge 的 vert/frag，前向 PBR-ish 工作室光照）；`bate/FrameBufferRender.h`（**纯头文件**：MSAA FBO → 中间 FBO → 屏幕 quad blit，`getDepth` 读回深度）；`bate/FrameBufferPicker.cpp`（**GPU picking**：把 `gObjectIndex`/`gVertexIndex` 写进 uvec3 FBO，读像素得到"点选了哪个对象/哪个顶点"，再配合深度反投影）。WebGL 端可直接抄这套"id 着色 + 读回"方案，或直接改用 three.js Raycaster。
- **相机**（`Camera.h/.cpp`）：orbit/turntable（pivot + quat），safe-frame 信箱式分辨率，支持 ortho。
- **HUD/交互**：`HudGraphicGrid/Axis/SelectBox`、`GraphicTrans/Rotate/ScaleHandler`（gizmo）、`GraphicHandlerUtils.h`——这些在 Web 端对应 three.js `TransformControls`，不必移植。

## 4. UI 层（`ui/`，与 x6 前端最相关的部分）

- **模型（数据源）**：`ui/zenomodel/`。`IGraphsModel`（`graphsmodel.cpp` 84KB 实现）是整张图的唯一数据源（节点/链接/参数/子图/时间线），用 Qt roles（`modelrole.h`、`modeldata.h`）承载数据；`GraphsManagment` 单例管理"当前模型 + 打开/保存/日志"；**撤销/重做 = QUndoCommand 命令栈**（`command.cpp` 的 AddNodeCommand/RemoveNodeCommand/…）。→ 对应前端可做"单一 store（如 zustand）+ 命令式 undo"，x6 自带 undo/redo 钩子可复用。
- **IO 用 Acceptor 模式解耦**：`ui/zenoio/` 的 `ZsgReader` 只负责把 ZSG JSON 解析成一系列 `IAcceptor` 回调（`addNode/setInputSocket/setParamValue/setPos/…`）；`ModelAcceptor`（`ui/zenomodel/src/modelacceptor.cpp`）把回调翻译进模型；`TransferAcceptor`（`zenoedit/acceptor/transferacceptor.cpp`）用于跨文件/复制粘贴。**同一解析器换不同"落地器"**——前端可以做一个 ZSG 解析器，分别喂给 x6 构建器与运行时构建器。
- **节点画布**：`ui/zenoedit/nodesys/`。`ZenoSubGraphScene`（QGraphicsScene，46KB）、`ZenoNode`（77KB 的节点图形项：端口、参数嵌入、折叠）、`ZenoLink`（连线）、`ZenoSubGraphView`（缩放平移）、`GroupNode/BlackboardNode/SearchView/NewMenu`、`zenosubnetlistview`（子图树）。→ 这些就是 x6 的 Node/Edge/Port/Group 的 Qt 版参考实现。
- **面板/Dock**：`ui/zenoedit/panel/`（`zenoproppanel` 参数面板 47KB、`zenospreadsheet` 属性表、`zenolights` 灯光、`zlogpanel` 日志、`zenoimagepanel`）、`ui/zenoedit/dock/`（`ztabdockwidget` 可拆分布局，布局可序列化 `layout/winlayoutrw.cpp`）、`ui/zenoedit/timeline/`（`ztimeline` + 播放/帧滑条）。
- **参数控件**：`ui/zenoui/comctrl/gv/`（`zenoparamwidget`、`zgraphicslayout`、`zveceditoritem`、`zlineedititem`、`zsocketitem`、`zdictpanel`）——每类 socket/param 一种嵌入式控件，前端可参考它如何"按 Descriptor 动态生成控件"。
- **视口**：`ui/zenoedit/viewport/`（`displaywidget` 46KB、`viewportwidget`、`zenovis.cpp` 的 GL 封装、`cameracontrol` 33KB、`optixviewport`、`recordvideomgr`）+ `viewportinteraction/`（`picker`、`transform`、`nodesync`：视口与节点参数双向同步）。

## 5. 序列化（三种"格式"，要分清）

1. **编辑器 .zsg（JSON）**：`{"graph": {"main": {"nodes": {...}, "subgraphs": {...}}}, "descs": {节点类型描述...}, "version":"v2"}`。节点含 `inputs`（每输入 `[linkNode, linkSock, defaultValue]` 或 `[null, null, default]`）、`params`、`uipos`、`options`（如 `VIEW`）、时间线/录制/布局/自定义 UI。**descs 块自描述全部节点 schema**（`misc/graphs/1.zsg` 就是样例）——前端可用它自动生成 x6 节点库。解析器：`ui/zenoio/reader/zsgreader.cpp`（45KB）。
2. **核心命令流（JSON）**：`Graph::loadGraph`（`zeno/src/core/loadGraph.cpp`）吃的扁平指令数组：`["addNode", cls, id]`、`["setNodeInput", id, sock, value]`、`["bindNodeInput", dstNode, dstSock, srcNode, srcSock]`、`["setKeyFrame"]`、`["setFormula"]`、`["addSubnetNode"]`、`["pushSubnetScope"]/["popSubnetScope"]`、`["setBeginFrameNumber"]`… 由 `ui/zenoedit/launch/serialize.cpp` 从模型生成、喂给核心/子进程。**这是引擎无关的中间表示，Web 运行时可直接用 TS 实现一个等价的 loadGraph。**
3. **对象二进制编码**：`zeno/funcs/ObjectCodec.*`——PrimitiveObject 的紧凑二进制（各 AttrVector 的 header+data，含属性名/类型/长度），用于磁盘帧缓存与进程间传输。**前端可在 JS 里用 ArrayBuffer 解码同构格式**（见 §6）。

## 6. Python / 脚本桥（三种层次）

- **C ABI + ctypes（推荐参照）**：`zeno/extra/CAPI.h` + `src/extra/CAPI.cpp`——纯 `extern "C"` 导出（`Zeno_CreateGraph/Zeno_GraphLoadJson/Zeno_GraphCallTempNode/Zeno_CreateObject*/Zeno_GetObjectPrimData`…）；用 `LUT<shared_ptr>` 把 C++ 对象转成 uint64 句柄，`LastError` 捕获异常为错误码；`Zeno_GetObjectPrimData` 直接返回 PrimData 裸指针+类型。Python 侧 `projects/Python/Lib/ze/zeno.py` 用 ctypes 声明函数原型并自动查错——**一条干净的"宿主引擎 ⇄ 外部脚本"边界**。Houdini 侧可做等价的 C/JSON 服务层。
- **嵌入式 Python 节点**：`zeno/src/nodes/PythonNode.cpp`——核心内嵌 CPython，节点可跑 Python；初始化挂在 `EventCallbacks("init")`，回调 C API（`import ze; ze.init_zeno_lib("zeno.dll")`）。`projects/Python/PythonNodes.cpp`、`Lib/ze/*`（`zeno.py`/`zpc.py`）为配套。
- **编辑器 Python API**：`ui/zenoedit/interface/`（`zenopyapi.cpp`、`graphimpl.cpp`、`nodeimpl.cpp`，扩展模块名 `custom`）——把 `ZSubGraph/ZNode` 暴露给 Python 操作 UI（建图/加节点/设参），说明"脚本可控编辑器"的姿势。

## 7. 桥接设计（对 Houdini⇄Web 最有直接参考价值的遗产）

- **编辑器 ⇄ 计算子进程 IPC**（`ui/zenoedit/launch/`）：`corelaunch.cpp`（启动）、`runnermain.cpp`（子进程：loadGraph → GlobalComm 逐帧跑 → 发包）、`ztcpserver.cpp`（主进程收包）、`viewdecode.cpp`（解码缓存对象给视口）。**包协议**：`'\a\b\r\t' + Header(total_size, info_size, magicnum=314159265, checksum) + JSON 元信息 + 二进制载荷`，走 localhost TCP 或 stdio 管道。→ Houdini 侧做 WebSocket 服务时可照抄"JSON 头 + 二进制 body + magic/校验"的封包思路。
- **LiveSync（面向 Blender 的实时同步）**：`livehttpserver.cpp`（crow，端口 18080，`POST /sync_data` 收帧网格 JSON，`/set_client_info` 管理客户端列表）+ `livetcpserver.cpp`（QTcpServer 5236 收/发顶点与相机数据）。**这就是"Zeno 把帧网格推给外部客户端"的现成范式**，等价于我们要做的"Houdini 把网格推给 Web"。
- **Unreal 桥**：`projects/UnrealTool/RemoteServer.cpp`——HTTP（httplib）+ msgpack + Token 鉴权（`X-Zeno-SessionKey`），含 Session 概念与事件钩子。
- **RPC 原型**：`projects/RPC/`——protobuf 的 client/server（event_bus.proto 事件总线、ping/status），说明团队尝试过更重的 RPC 方案。
- `ui/zenoedit/updaterequest/`（`zsinstance/zsnetthread`）是用 curl 的异步网络请求小工具。

## 8. 可迁移到 three.js/x6 的清单

**可直接移植/几乎等价：**
1. **PrimitiveObject → THREE.BufferGeometry 映射**：`verts`→`position`，`tris`→`index`，`points`/`lines`→`Points`/`LineSegments`，`attrs`（pos/clr/nrm/uv/tang）→ buffer attributes；`InstancingObject`→`InstancedMesh`。参考 `GraphicPrimitive.cpp` 的打包逻辑与 `ObjectCodecPrimitive.cpp` 的二进制布局（JS 解码同构）。
2. **Graph 求值语义 → TS 运行时**：`applyNode/requireInput/visited` 惰性求值、`get_input` 优先级（keyframe>formula>literal>param）、`TempNodeCaller` 表达式求值、`DirtyChecker` 增量失效——逻辑量很小，非常适合在 Web 端做一个同构 `Graph` 类。
3. **命令流 JSON**：`serialize.cpp` 的输出格式可原样作为"场景交换格式"；TS 实现 `loadGraph` 后，前端可跑 Houdini 导出的命令流。
4. **GPU picking**：`FrameBufferPicker` 的 id 着色方案，或直接 three.js Raycaster。
5. **相机**：pivot+quat orbit 相机模型（three.js OrbitControls 语义一致）。
6. **渲染循环**：`Zenovis::paintGL` = 更新帧对象 → `session->new_frame()` → draw，等价于 rAF 循环。
7. **x6 节点/边/端口**：`ZenoNode/ZenoLink` 的端口布局、参数内嵌控件、group/blackboard/搜索菜单，都可作为 x6 交互设计的功能清单。

**架构借鉴（概念层面）：**
- **增量对象管理**：`ObjectsManager/GraphicsManager` 的 `insertPass/may_emplace/has_changed` + `stamp-change`（Total/Data/Shape/UnChanged）→ 前端维护 `Map<key, Object3D>`，按 stamp 只重建必要部分；这是"逐帧模拟流 + 前端增量更新"的核心模式，比每帧全量重建省太多。
- **单一数据源 + 视图分离**：`IGraphsModel`（store） + `ZenoSubGraphScene/ZenoNode`（view） + QUndoCommand（命令栈）→ 对应 zustand store + x6 渲染 + undo 中间件。
- **Acceptor 模式**：一个 ZSG 解析器多路落地（x6 构建 / 运行时构建 / 导出）。
- **Descriptor 自描述节点库**：从 `.zsg` 的 `descs` 或 `Session::dumpDescriptors()` 自动生成节点注册表/端口元数据，避免前端手工维护节点清单。
- **Frame 缓存 + 二进制传输**：`GlobalComm` 逐帧缓存 + `ObjectCodec` 二进制 → 前端可以按帧拉取二进制 mesh，双缓冲播放。
- **事件总线**：`EventCallbacks`（string key → 回调列表）很轻，适合 Web 端做插件/脚本钩子。

## 9. 注意事项 / 风险

- **不要把它当规范，当参考**：代码里有大量 `#if 0` 注释掉的旧实现、`deprecated` 宏、双写 API（`setNodeInput` vs `setNodeParam`、`ZsgReader` 新旧两套 `setInputSocket/setInputSocket2`），照抄前先确认分支是活的。
- **子模块缺失**：OpenVDB/Bullet/FBX/CPython 等节点库源码不在本地，需要时须 `git submodule update --init`（需网络）。核心 `zeno/`、渲染 `zenovis/`、UI `ui/` 的源码完整可用。
- **C++ 语义坑**：`zany` 引用计数、`DST` dummy 输出（`doComplete` 必然产出 `DST`）、参数 `:` 后缀、输入优先级——TS 移植要严格复刻，否则图行为不一致。
- **性能前提**：Zeno 的 C++ 求解器性能（FLIP 4x Houdini 之类的宣传）来自原生代码，Web 端只有"演示/预览"级能力；继承"节点图 + 增量渲染"架构合理，但别期待在浏览器复刻求解器性能。
- **许可证**：MPL-2.0（文件级 copyleft），若复制源码逻辑需保留对应文件的开源声明；仅"借鉴架构/思想"不受限。

## 10. 建议优先阅读的文件（按优先级）

1. `zeno/src/core/loadGraph.cpp` + `Graph.cpp` + `INode.cpp` —— 求值模型全貌（量小，50 分钟内可读完）。
2. `zeno/include/zeno/core/{Graph,INode,IObject,Session,Descriptor}.h` —— 数据结构契约。
3. `ui/zenoedit/launch/serialize.cpp` —— 模型→命令流的完整映射（含 keyframe/formula/子图处理）。
4. `zeno/src/funcs/ObjectCodecPrimitive.cpp` —— 二进制网格格式。
5. `zenovis/src/bate/GraphicPrimitive.cpp` + `zenovis/src/ObjectsManager.cpp` —— 渲染增量更新。
6. `ui/zenoio/reader/zsgreader.cpp` + `ui/zenomodel/src/modelacceptor.cpp` —— ZSG→模型管线（Acceptor 用法）。
7. `ui/zenoedit/nodesys/zenosubgraphscene.cpp` + `zenonode.cpp`（略读）+ `ui/zenoedit/nodesview/zenographseditor.cpp`（略读）—— 节点编辑器的交互与结构。
8. `zeno/extra/CAPI.h` + `projects/Python/Lib/ze/zeno.py` —— 宿主↔脚本边界范式。
9. `ui/zenoedit/launch/{runnermain,ztcpserver,viewdecode,livehttpserver,livetcpserver}.cpp` —— 多进程/实时桥接范式。
10. `misc/graphs/1.zsg` —— 真实 ZSG 样例（含 descs 自描述节点库）。