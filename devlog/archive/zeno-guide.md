# Zeno 代码检索指引字典（agent 快速导航）

> 仓库根：`D:\code\dev\zeno`。每条 = `路径` → 一句话职责（可 grep 的关键词/函数）。
> 惯例：`zeno/`=核心，`zenovis/`=渲染，`ui/`=Qt 编辑器，`projects/`=节点库；`ZENO_*` 为 CMake 开关。

## A. 核心节点系统 `zeno/`

| 路径 | 一句话职责 |
|---|---|
| `zeno/include/zeno/core/Session.h` / `src/core/Session.cpp` | 全局节点类注册表 `nodeClasses`、`defNodeClass`、`dumpDescriptors()`（节点 schema 导出，UI 依赖） |
| `zeno/include/zeno/core/Graph.h` / `src/core/Graph.cpp` | 图对象：`nodes/inputBounds/nodesToExec/portals`；`applyNode/applyNodes/bindNodeInput/setKeyFrame/setFormula/callTempNode` |
| `zeno/include/zeno/core/INode.h` / `src/core/INode.cpp` | 节点实例：`inputs/outputs/kframes/formulas`；`doApply→preApply→requireInput`（上游递归）、`resolveInput`、`get_keyframe/get_formula` |
| `zeno/include/zeno/core/IObject.h` / `src/core/IObject.cpp` | 数据对象基类，`zany=shared_ptr<IObject>`，`clone/assign/method_node` |
| `zeno/include/zeno/core/Descriptor.h` / `src/core/Descriptor.cpp` | 节点类型自描述：inputs/outputs/params/categories |
| `zeno/include/zeno/core/defNode.h` | `ZENO_DEFNODE/ZENDEFNODE` 注册宏（声明式定义节点） |
| `zeno/src/core/loadGraph.cpp` | **核心命令流 JSON 解析**（`addNode/bindNodeInput/setKeyFrame/pushSubnetScope/...`） |
| `zeno/include/zeno/extra/DirtyChecker.h` | 轻量增量失效：`taintThisNode/amIDirty` |
| `zeno/include/zeno/extra/GlobalState.h` / `src/extra/GlobalState.cpp` | 帧/子步状态机：`frameid/substepid/frameBegin/substepBegin` |
| `zeno/include/zeno/extra/GlobalComm.h` / `src/extra/GlobalComm.cpp` | 逐帧 ViewObjects 缓存、磁盘帧缓存、stamp 增量、`toDisk/fromDisk` |
| `zeno/include/zeno/extra/EventCallbacks.h` | 字符串事件总线 `hookEvent/triggerEvent`（init/exit 等钩子） |
| `zeno/include/zeno/extra/GlobalStatus.h` / `src/extra/GlobalStatus.cpp` | 全局错误状态（节点名+错误），运行失败上报 |
| `zeno/include/zeno/extra/TempNode.h` | `TempNodeCaller`：不建图直接调用节点类（表达式求值用） |
| `zeno/include/zeno/extra/ContextManaged.h` | for/if 域的 visited 集压栈/出栈（控制流求值核心） |
| `zeno/include/zeno/extra/SubnetNode.h` / `src/extra/SubnetNode.cpp` | 子图节点：内嵌 `Graph`，`subOutputNodes/nodesToExec` |
| `zeno/include/zeno/extra/ISubgraphNode.h` / `src/extra/ISubgraphNode.cpp` | 可被 JSON 懒加载的子图节点（`get_subgraph_json`） |
| `zeno/include/zeno/extra/CAPI.h` / `src/extra/CAPI.cpp` | **C ABI 导出桥**：`Zeno_CreateGraph/Zeno_GraphLoadJson/Zeno_CreateObject*/Zeno_GetObjectPrimData`，句柄 LUT + LastError |
| `zeno/include/zeno/extra/CAPIInternals.h` | CAPI 内部辅助：`capiLoadGraphSharedPtr/capiFindObjectSharedPtr` 等 |
| `zeno/include/zeno/extra/ShaderNode.h` / `src/extra/ShaderNode.cpp` | 材质/Shader 相关节点基类（backend=GLSL 等） |
| `zeno/include/zeno/funcs/ObjectCodec.h` / `src/funcs/ObjectCodec*.cpp` | **对象二进制编解码**（Primitive/Numeric/String/List/Camera） |
| `zeno/include/zeno/funcs/LiterialConverter.h` | 字面量↔zany 转换（`objectFromLiterial/objectToLiterial`） |
| `zeno/include/zeno/funcs/ParseObjectFromUi.h` / `src/funcs/ParseObjectFromUi.cpp` | UI JSON 值→zany 对象 |
| `zeno/include/zeno/types/PrimitiveObject.h` | **核心网格类型**：verts/points/lines/tris/quads/loops/polys/edges/uvs |
| `zeno/include/zeno/types/AttrVector.h` | 属性容器：`values + attrs(map<string, variant<vec3f,float,vec3i,int,...>>)` |
| `zeno/include/zeno/types/*.h` | 其余类型：Numeric/String/List/Dict/Curve/Material/Instancing/Light/Camera/Shader/Texture/UserData |
| `zeno/src/nodes/ControlNodes.cpp` | 控制流：`IBeginFor/EndFor/BreakFor/IfElse/IF/EndIF/IBranch/EndBranch/ConditionedDo/SubstepDt` |
| `zeno/src/nodes/CacheNodes.cpp` | 节点级缓存：`CachedByKey/CachedIf`（`preApply` 短路） |
| `zeno/src/nodes/Subgraph.cpp` | `SubInput/SubOutput/SubEndpoint/SubResult`（子图边界声明） |
| `zeno/src/nodes/PortalNodes.cpp` | `PortalIn/PortalOut`（跨子图传值）、`Route`、`Stamp`（增量 stamp 节点） |
| `zeno/src/nodes/RunNodes.cpp` | 帧时间相关：`SetFrameTime/GetFrameTime/GetFrameNum/IntegrateFrameTime` |
| `zeno/src/nodes/InputParams.cpp` | 参数化/UI 参数节点（`ParamFormat` 等） |
| `zeno/src/nodes/PythonNode.cpp` | 嵌入式 Python 节点（`import ze; ze.init_zeno_lib`、PythonFunctor） |
| `zeno/src/nodes/JsonProcess.cpp` | JSON 节点：`ReadJson/WriteJson/JsonObject`（nlohmann ordered_json） |
| `zeno/src/nodes/FileDirtCache.cpp` | 文件脏检测缓存（增量重载） |
| `zeno/src/nodes/StringNodes.cpp` / `FuncNodes.cpp` / `ListNodes.cpp` / `DictNodes.cpp` | 字符串/函数/列表/字典节点集 |
| `zeno/src/nodes/neo/*`（39 文件） | "新"基础网格算子：`PrimMerge/PrimScatter/PrimDualMesh/PrimFilter/PrimProject/PrimWeld` 等 |
| `zeno/src/nodes/prim/*`（49 文件） | 基础 primitive 算子库 |
| `zeno/src/nodes/mtl/*`（16）/ `num/*`（6）/ `color/*`（1） | 材质/数值/颜色节点 |
| `zeno/src/nodes/ToNodes.cpp` / `DebugNodes.cpp` / `CameraNodes.cpp` / `LightNodes.cpp` | 输出接线辅助 / 调试触发器 / 相机 / 灯光节点 |
| `zeno/tpls/include/` | 内置三方头：rapidjson、glm、half_float、tinygltf |

## B. 渲染器 `zenovis/`

| 路径 | 一句话职责 |
|---|---|
| `zenovis/include/zenovis/Scene.h` / `src/Scene.cpp` | 渲染场景：camera/drawOptions/shaderMan/objectsMan/renderMan，引擎切换（bate/optx/zhxx） |
| `zenovis/include/zenovis/Camera.h` / `src/Camera.cpp` | pivot+quat orbit 相机、safe-frame、ortho、`setResolution` |
| `zenovis/include/zenovis/DrawOptions.h` | 显示开关集合：`show_grid/render_wireframe/uv_mode/bgcolor/handler` |
| `zenovis/include/zenovis/ObjectsManager.h` / `src/ObjectsManager.cpp` | **增量对象管理**：`insertPass/may_emplace/has_changed` + stamp 复用 |
| `zenovis/include/zenovis/RenderEngine.h` / `src/RenderEngine.cpp` / `src/ShaderManager.cpp` | 渲染引擎接口（`update/draw/cleanupWhenExit`）+ 着色器管理 |
| `zenovis/src/Session.cpp` | 给 UI 的渲染会话封装（窗口尺寸/网格/线框/paint） |
| `zenovis/include/zenovis/bate/GraphicsManager.h` / `src/bate/RenderEngineBate.cpp` | bate 引擎 + `key→IGraphic` 图形管理器（增量 diff） |
| `zenovis/include/zenovis/bate/IGraphic.h` | `IGraphic/IGraphicDraw/IGraphicHandler/IPicker/MakeGraphicVisitor`，`makeGraphic` 分派 |
| `zenovis/src/bate/GraphicPrimitive.cpp` | **PrimitiveObject→GL 缓冲/绘制**（VBO/EBO、切线、实例化） |
| `zenovis/src/bate/GraphicLight.cpp` / `GraphicCamera.cpp` | 灯光/相机图形表示 |
| `zenovis/src/bate/FrameBufferPicker.cpp` | **GPU picking**：object/vertex id 写 uvec3 FBO，读回 + 深度反投影 |
| `zenovis/include/zenovis/bate/FrameBufferRender.h` | 纯头文件：MSAA FBO→中间 FBO→屏幕 quad、`getDepth` |
| `zenovis/src/bate/HudGraphic*.cpp` / `Graphic*Handler.cpp` | HUD（grid/axis/selectbox/highlight）+ gizmo（trans/rotate/scale） |
| `zenovis/src/bate/shader/*` | 前向着色器：tris/lines/points/edge（GLSL 330，PBR 风格） |
| `zenovis/include/zenovis/opengl/*.h` | GL 封装：`buffer/shader/texture/vao/scope/common`（RAII 式） |
| `zenovis/src/optx/RenderEngineOptx.cpp` | OptiX 引擎（81KB，GPU 离线渲染） |
| `zenovis/src/zhxx/RenderEngineZhxx.cpp` | 旧版引擎入口 |
| `zenovis/zhxxvis/Hg/*` | 旧渲染内核：`Hg/OpenGL`、`Hg/IPC`、`Hg/VDBUtils`、`Hg/SIMD` |

## C. Qt 编辑器 UI `ui/`

| 路径 | 一句话职责 |
|---|---|
| `ui/zenoedit/main.cpp` | 主程序入口 |
| `ui/zenoedit/zenomainwindow.cpp/h` | 主窗口：菜单/Dock 布局/运行触发（`onRunTriggered`）/打开保存 |
| `ui/zenoedit/zenoapplication.cpp/h` | 应用单例（`zenoApp->graphsManagment()`、`cacheMgr()`） |
| `ui/zenoedit/recordmain.cpp` | 命令行离线渲染入口（--record/--optix/--zsg） |
| `ui/zenoedit/nodesview/zenographseditor.cpp` | 节点编辑器顶层 widget（工具栏/搜索/场景装配） |
| `ui/zenoedit/nodesys/zenosubgraphscene.cpp` | **节点画布场景**：模型→`ZenoNode/ZenoLink` 装配、连线/选中逻辑 |
| `ui/zenoedit/nodesys/zenonode.cpp` | 节点图形项（77KB：端口、参数控件嵌入、折叠） |
| `ui/zenoedit/nodesys/zenolink.cpp` | 连线图形项（曲线/选中/删除） |
| `ui/zenoedit/nodesys/zenosubgraphview.cpp` | 画布视图（缩放/平移/框选） |
| `ui/zenoedit/nodesys/groupnode.cpp` / `blackboardnode.cpp` / `searchview.cpp` / `zenonewmenu.cpp` | 组/黑板/搜索/新建节点菜单 |
| `ui/zenoedit/nodesys/zenosubnetlistview.cpp` / `subnettreeitemdelegate.cpp` | 子图树列表 |
| `ui/zenoedit/viewport/displaywidget.cpp` | 视口容器（GL+OptiX 切换、播放控制、`updateViewport`） |
| `ui/zenoedit/viewport/zenovis.cpp` | GL 视口封装：`paintGL=doFrameUpdate+new_frame+draw` |
| `ui/zenoedit/viewport/cameracontrol.cpp` | 视口相机交互（33KB） |
| `ui/zenoedit/viewport/optixviewport.cpp` / `zoptixviewport.cpp` | OptiX 视口 |
| `ui/zenoedit/viewportinteraction/picker.cpp` | 视口拾取→节点联动 |
| `ui/zenoedit/viewportinteraction/transform.cpp` | 视口变换 gizmo 交互 |
| `ui/zenoedit/viewportinteraction/nodesync.cpp` | 视口对象与节点参数双向同步 |
| `ui/zenoedit/dock/ztabdockwidget.cpp` / `docktabcontent.cpp` | 可拆分布局 Dock + 页签内容 |
| `ui/zenoedit/panel/zenoproppanel.cpp` | 节点参数面板（47KB） |
| `ui/zenoedit/panel/zenospreadsheet.cpp` / `PrimAttrTableModel.cpp` | 属性表/网格数据表 |
| `ui/zenoedit/panel/zenolights.cpp` / `zenoimagepanel.cpp` / `zlogpanel.cpp` | 灯光/图片/日志面板 |
| `ui/zenoedit/timeline/ztimeline.cpp` / `zslider.cpp` | 时间线/播放/帧滑条 |
| `ui/zenoedit/layout/winlayoutrw.cpp` | Dock 布局读写 |
| `ui/zenoedit/cache/zcachemgr.cpp` | 帧缓存目录管理 |
| `ui/zenoedit/settings/zenosettingsmanager.cpp` | 设置存取 |
| `ui/zenoedit/acceptor/transferacceptor.cpp` | 复制粘贴/跨文件转移落地器 |
| `ui/zenoedit/updaterequest/zsinstance.cpp` / `zsnetthread.cpp` | curl 异步网络请求（更新检查等） |
| `ui/zenoedit/interface/zenopyapi.cpp` / `graphimpl.cpp` / `nodeimpl.cpp` | **编辑器 Python API**（ZSubGraph/ZNode 暴露给脚本，`custom` 扩展） |

## D. 模型与 IO `ui/zenomodel` / `ui/zenoio`

| 路径 | 一句话职责 |
|---|---|
| `ui/zenomodel/src/graphsmodel.cpp` | **整图 Qt 模型**（84KB，节点/链接/参数/子图的数据源） |
| `ui/zenomodel/include/igraphsmodel.h` / `modeldata.h` / `modelrole.h` | 模型接口 + 数据容器 + role 枚举 |
| `ui/zenomodel/src/graphsmanagment.cpp` | 单例：当前模型、打开/保存 ZSG、日志模型 |
| `ui/zenomodel/src/command.cpp` | **QUndoCommand 撤销/重做命令**（AddNode/RemoveNode/…） |
| `ui/zenomodel/src/modelacceptor.cpp` | **ZSG JSON→模型**的 IAcceptor 实现（38KB） |
| `ui/zenomodel/src/api.cpp` / `uihelper.cpp` / `jsonhelper.cpp` | 模型公共 API / UI 数据转换 / JSON 工具 |
| `ui/zenomodel/src/nodeparammodel.cpp` / `parammodel.cpp` / `panelparammodel.cpp` / `viewparammodel.cpp` | 参数面板/节点参数/视图参数子模型 |
| `ui/zenomodel/src/subgraphmodel.cpp` | 子图数据模型 |
| `ui/zenomodel/src/curvemodel.cpp` | 关键帧曲线模型 |
| `ui/zenoio/reader/zsgreader.cpp` | **ZSG 文件解析**（→IAcceptor 回调，45KB） |
| `ui/zenoio/writer/zsgwriter.cpp` | 模型→ZSG JSON 写出 |
| `ui/zenoio/acceptor/iacceptor.h` | IAcceptor 接口（解析目标抽象，含新旧两套 socket API） |
| `ui/zenoio/acceptor/coreacceptor.*` | 占位空实现（忽略） |

## E. 共享控件 `ui/zenoui`

| 路径 | 一句话职责 |
|---|---|
| `ui/zenoui/comctrl/gv/zenoparamwidget.cpp` | 通用参数控件（按类型分发到子控件） |
| `ui/zenoui/comctrl/gv/zgraphicslayout.cpp` / `zgraphicsnetlabel.cpp` | 参数布局 / 网络标签 |
| `ui/zenoui/comctrl/gv/zveceditoritem.cpp` / `zlineedititem.cpp` / `zsocketitem.cpp` / `zdictpanel.cpp` | vec/文本/端口/dict 编辑控件 |
| `ui/zenoui/nodesys/nodegrid.cpp` / `zenosvgitem.cpp` | 画布网格背景 / SVG 图标项 |
| `ui/zenoui/render/ztfutil.cpp` | 模板工具（node-example.xml → 参数模板） |
| `ui/zenoui/style/zenostyle.h` / `ui/zenoui/customui/*` | 样式 / 自定义 UI |

## F. 启动与桥接 `ui/zenoedit/launch/`（重点）

| 路径 | 一句话职责 |
|---|---|
| `ui/zenoedit/launch/serialize.cpp` | **模型→核心命令流 JSON**（25KB，含 keyframe/formula/子图/字典链接展开） |
| `ui/zenoedit/launch/corelaunch.cpp` | 运行入口：进程内或拉起 runner 子进程 |
| `ui/zenoedit/launch/runnermain.cpp` | 计算子进程：loadGraph→逐帧跑→发包（Header magic 314159265 + JSON+binary） |
| `ui/zenoedit/launch/ztcpserver.cpp` | 主进程 TCP 收包服务（localhost 随机端口，处理帧数据/状态） |
| `ui/zenoedit/launch/viewdecode.cpp` | 解码 runner 发来的缓存对象给视口（与 runnermain 同 Header） |
| `ui/zenoedit/launch/livehttpserver.cpp` | **LiveSync HTTP**（crow:18080，`/sync_data` 收帧网格、`/set_client_info` 管理客户端） |
| `ui/zenoedit/launch/livetcpserver.cpp` | LiveSync TCP（:5236，收 VERT/CAME 数据） |
| `ui/zenoedit/launch/blendermain.cpp` | Blender 插件模式入口 |
| `ui/zenoedit/launch/offlinemain.cpp` / `optixmain.cpp` / `optixcmd.cpp` | 无头 / OptiX 渲染入口 |

## G. 节点库与外部桥 `projects/`

| 路径 | 一句话职责 |
|---|---|
| `projects/ZenoFX/` | FLIP 求解器 + **ZFX 表达式编译器**（`ZFX/`：tokenizer/parser/AST/IR/寄存器分配，类小型 shader 编译器） |
| `projects/Python/Lib/ze/zeno.py` | **Python 侧 C API 封装（ctypes）**：`init_zeno_lib`、ZenoObject/ZenoPrimitiveObject |
| `projects/Python/PythonNodes.cpp` | Python 相关节点定义 |
| `projects/FastFLIP/` | FLIP 流体（partio 子模块缺失） |
| `projects/Rigid/` `projects/zenvdb/` `projects/FBX/` `projects/Alembic/` `projects/CUDA/` `projects/Geometry/` `projects/MeshSubdiv/` | 求解器/格式节点库（**子模块为空，需 init**） |
| `projects/UnrealTool/RemoteServer.cpp` | Unreal 桥：HTTP(httplib)+msgpack+Token（`X-Zeno-SessionKey`） |
| `projects/RPC/` | protobuf client/server 原型（event_bus.proto） |
| `projects/GUI/` / `projects/ViewUI/` | 实验性 GL/UI 节点 |
| `projects/Nemo/` / `projects/ChatZeno/` / `projects/TreeSketch/` / `projects/Roads/` | 其他实验节点库 |

## H. 文档与样例

| 路径 | 一句话职责 |
|---|---|
| `README.md` / `BUILD.md` | 项目简介 / 构建说明（Qt5、CMake、可选依赖） |
| `docs/introduction.md` | 官方架构理念（数据流+控制流、可扩展性） |
| `docs/FAQ.md` / `docs/CONTRIBUTING.md` / `docs/BUILD_EXT.md` | FAQ / 贡献 / 扩展节点教程 |
| `docs/python_cihouer.md` | Python 用法说明 |
| `misc/graphs/1.zsg` 等 | **真实 ZSG 样例**（含完整 descs 节点 schema，前端生成节点库的起点） |
| `.gitmodules` | 全部子模块清单（决定哪些节点库可用） |
| `.tasks` | 开发者的构建配置模板（`ZENO_WITH_*` 开关全表） |
| `.github/workflows/cmake.yml` | 官方 CI 构建矩阵（cpu/cuda × linux/windows） |