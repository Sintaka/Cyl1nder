# zeno 缓存与显示管理调研笔记（只读调研）

- 调研对象：`D:\code\dev\zeno`（zenustech/zeno, MPL-2.0），commit `56c74cc3` (master, 2025-09-19)
- 范围：缓存线（节点级缓存 / DirtyChecker / stamp / 帧与磁盘缓存 / 惰性求值）与显示管理线（ObjectsManager / GraphicsManager / MapStablizer / IGraphic / GPU 拾取 / 编辑器→渲染同步）
- 主渲染引擎：`bate`（OpenGL，默认）；`zhxx`（旧）/`optx`（OptiX）仅作对比
- 总架构一句话：**计算进程（runner）与渲染进程（UI）分离**。计算端每帧把 `ToView` 出口的对象收集进 `GlobalComm`（可落盘 `ZENCACHE`）；渲染端按帧从内存/磁盘增量加载对象 → `ObjectsManager`（对象级 MapStablizer）→ `GraphicsManager`（图形级 MapStablizer）→ `IGraphic`（GL 缓冲在构造时一次性构建）→ draw。

---

## A. 缓存线

### A1 `CachedByKey` / `CachedIf` 的确切语义
文件：`zeno/src/nodes/CacheNodes.cpp`

- `CachedByKey`（L12-37）：
  - 缓存 key：**用户显式提供的字符串**（`get_input<StringObject>("key")->get()`），不是参数哈希、不是输入对象指针、不是 stamp。典型用法是用字符串节点给一个标识（如文件名/对象名）。
  - 存储：成员 `std::map<std::string, std::shared_ptr<IObject>> cache`（进程内、跨帧保留）。
  - 命中：`preApply` 中 `cache.find(key)` 命中 → 直接 `set_output("output", 缓存对象)` 并 return —— **既不 `requireInput("input")`（上游整条链不被拉取）也不执行 `apply()`**，从而短路整个重算。
  - 未命中：`requireInput("input")` 取新对象，写入 `cache`，`set_output`。`apply()` 为空实现。
- `CachedIf`（L40-68）：
  - 成员 `bool m_done`；`preApply`：若接了 `keepCache` 且 `evaluate_condition(...)` 为 false → `m_done=false`（下次强制重算）；`m_done==true` 时短路（不拉上游、不 apply）。
  - 语义：同一轮图形运行/帧序列内只算一次；跨帧靠 `keepCache` 条件决定是否失效。`CachedOnce`（L71-91）是无条件版本；`ToNodes.cpp` 里的 `HelperOnce` 同款。
- preApply 短路机制：`INode::doApply()` → 虚函数 `preApply()`（`zeno/src/core/INode.cpp`）。默认 `preApply` 对所有 `inputBounds` 调 `requireInput(ds)` 拉上游再 `apply()`；缓存节点在调用 `INode::preApply()` **之前** return，输出槽保留旧对象，下游 `requireInput` 只拿 shared_ptr 引用，零计算。再配合 `Graph::applyNode` 的 `ctx->visited`（同一轮求值内每节点至多执行一次），形成"命中即整条上游链跳过"。
- `CacheLastFrameBegin/End`（L94-155，deprecated）：跨帧缓存上一帧对象，Begin clone、End 更新缓存。

### A2 `DirtyChecker` 如何判定"这张图需要重算"
文件：`zeno/include/zeno/extra/DirtyChecker.h`、`zeno/src/core/Graph.cpp`、`zeno/src/core/INode.cpp`

- `DirtyChecker` 就是一个 `std::set<std::string> dirts`（节点名集合），只有 `taintThisNode` / `amIDirty` 两个操作 —— **节点级脏标记**，既不是内容哈希，也不是"全局重算"标志。
- 触发点：
  1. 编辑器序列化时对"参数被改过"的节点发 `markNodeChanged`（`ui/zenoedit/launch/serialize.cpp` L414），`zeno/src/core/loadGraph.cpp` L122-123 把它 taint 进 dirtyChecker；
  2. `INode::requireInput`（`INode.cpp` L165-169）：拉上游时若 `graph->applyNode(sn)` 返回 true（= 该节点本轮真实执行过 **且** 本身在 dirty 集合里），就把自己 taint —— 脏标记沿依赖**向下游传播**。
- `Graph::applyNode`（`Graph.cpp` L76-92）：先查 `ctx->visited` 防重复；执行 `doApply`；仅当 `dirtyChecker->amIDirty(id)` 为真才返回 true。
- 语义：不是内容级变化检测，而是**保守的传递性脏标记**：被编辑器标脏的节点 + 所有依赖它的下游，本轮会被真实重算；未标脏分支虽然仍会被 lazy pull 执行（zeno 每轮从零重算，没有通用 memo），但不会把下游标脏。注意 `dirts` 集合没有清空操作（append-only），是单向累积的保守信号。
- 消费方：`CacheToDisk`（`zeno/src/nodes/FileDirtCache.cpp` L20-33）——若输入上游节点 dirty → 删磁盘缓存并重算；否则 `preApply` 直接读磁盘缓存返回。即"节点级脏标记 + 节点级磁盘缓存"，不是整图判定。Graph 本身没有整图脏标志，每帧/每次 run 都从根（`nodesToExec`，ToView/SubOutput）重新 `applyNodes`，新 Context（visited 清空）。

### A3 stamp 机制
文件：`zeno/src/nodes/PortalNodes.cpp`（Stamp 节点 L68-110）、`zeno/src/extra/GlobalComm.cpp`、`zeno/src/nodes/ToNodes.cpp`、`zenovis/src/ObjectsManager.cpp`

- stamp **不是自增计数、不是内容哈希**，而是**挂在对象 userData 上的字符串标签 + 基础帧号**：
  - `stamp-change` ∈ {`UnChanged`, `DataChange`, `ShapeChange`, `TotalChange`}（四级；当前实现把 ShapeChange 并入 TotalChange，见 PortalNodes.cpp L89 注释"shapechange暂时全部按Totalchange处理"）
  - `stamp-base` = 该对象内容实际来自哪一帧（int）
  - `stamp-dataChange-hint` = DataChange 时指示哪些数据变了（字符串；消费端目前只有注释未实现合并）
- 产生：用户在图里放 `Stamp` 节点（`stampMode` 参数，编辑器 enum 现只暴露 UnChanged/TotalChange），apply 时按模式写 userData；编辑器序列化时把 Stamp 的 mode/name 转发给配套的 `ToView`（serialize.cpp 中 `if (name == "Stamp")` 分支）。
- `ToView`（`ToNodes.cpp` L14-90）是"显示出口"：把对象 clone 后以 `key = 节点名[:LISTi]:[frameid|static]:sessionid`（或自定义 name）加入 `GlobalComm::addViewObject`；`mode=="UnChanged"` 时不导出对象（L80）。
- 传播/消费三层：
  1. 计算端落盘：`GlobalComm::toDisk`（`GlobalComm.cpp` L37-240）写 `stampInfo.txt`（每对象 stamp-change/stamp-base/stamp-objType/startIndexInCache/ObjSize 的 JSON），对象本体写 4 个按 runtype 分的 `*.zencache`；非首帧从上一帧 stampInfo 继承 baseframe。
  2. 渲染端读盘：`fromDiskByStampinfo`（`GlobalComm.cpp` L376-550）——只 decode `TotalChange` 对象（按 stampInfo 记录字节区间 seek 局部读），`UnChanged` 构造空对象占位，`DataChange` 从 baseframe 读基础对象再合并；切帧时 runtype 强制 `RunAll`。
  3. 渲染端对象层：`ObjectsManager::load_objects`（`ObjectsManager.cpp` L28-49）——stamp-change != TotalChange 时**不替换旧对象**，从 `m_curr` 按 key 前缀复用旧 shared_ptr（渲染器 GL 缓冲继续用旧的），只更新 stamp 元数据；TotalChange 才插入新对象（→ 新 IGraphic → 重建缓冲）。
- "跳过未变化分支"：Stamp(UnChanged) → ToView 不导出；即使导出，渲染端也复用旧对象/旧图形，不重建。注意 stamp 的作用对象是**帧与帧之间对象的复用决策**，不是节点计算级跳过（节点计算级跳过靠 CachedByKey/CachedIf/CacheToDisk + visited）。

### A4 几何/帧级缓存
- 帧缓存：`zeno/include/zeno/extra/GlobalComm.h` + `zeno/src/extra/GlobalComm.cpp`
  - 内存：`m_frames` 每帧一个 `ViewObjects`（PolymorphicMap），`FRAME_STATE` 标记完成/中断；`maxCachedFrames` LRU：`_getViewObjects`（L724-769）"不在内存则从磁盘载入，超过上限则清掉最老一帧的 view_objects"。
  - 磁盘：`dumpFrameCache` → `toDisk`：按 runtype 分 4 个文件（lightCamera/material/matrix/normal `.zencache`），格式 = `ZENCACHE<count>` 头 + '\a' 分隔 key 列表 + `size_t` 偏移表 + 各对象 `encodeObject` 二进制；另有 `runInfo.txt`、`stampInfo.txt`（JSON）。
  - 增量重载：`fromDiskByStampinfo` 按 stamp 只读变化对象（见 A3），`fromDiskReadObject` 支持按名字从任意 baseframe 单对象读盘。
- 节点级磁盘缓存：`CacheToDisk`（`zeno/src/nodes/FileDirtCache.cpp`）：DirtyChecker 判定上游 dirty 才重算并覆盖 `CTD-<node>.zenobjbinarycache`；否则 `preApply` 直接 `decodeObject` 读盘返回。序列化入口 `encodeObject/decodeObject` 在 `zeno/include/zeno/funcs/ObjectCodec.h`。
- 渲染侧几何缓存：`ZhxxGraphicPrimitive` 构造时**深拷贝** prim（`primUnique`），做缺省属性补全/法线/细分/三角化等预处理并一次性上传全部 VBO/EBO（`GraphicPrimitive.cpp` L333-600）；`draw()` 只绑定缓存缓冲。缓存粒度是"对象/key"，无属性级缓冲缓存。
- 注：`INode::getTmpCache/writeTmpCaches`（`INode.cpp`）是 `#if 0` 关闭的历史代码（按帧+节点名落盘）。

### A5 惰性拉取下缓存与"输入未变则不重算"的关系
- 求值：`applyNodesToExec` 只从根（ToView/SubOutput 等 `nodesToExec`）开始，`requireInput` 沿边递归拉上游；`Context.visited` 保证一轮内每节点至多执行一次（`Graph.cpp` L77-79）。
- **每轮（每帧/每次 run）都从零开始**：没有"自动记住上一轮输出、输入未变就跳过 apply"的通用 memo，除非节点自己缓存。
- 会缓存输出的节点（显式）：
  - `CachedByKey` / `CachedIf` / `CachedOnce` / `HelperOnce`（preApply 短路，输出槽保留）；
  - `CacheToDisk`（磁盘缓存短路）；
  - `Stamp(UnChanged)` / `ToView(isStatic)`（渲染端复用旧对象，计算端实际每次仍算）；
  - `GlobalComm` 帧缓存（跨帧不重算，直接读内存/磁盘）。
- 每次都算的节点：所有普通节点（每次 apply 重新执行）；`Route`/`SetToMatrix`/`Clone` 等只是引用搬运，也会走 apply。
- 关键结论：zeno 的"不重算"主要发生在 (a) 同一轮求值内的 visited 去重（DAG 合并/portal），(b) 显式缓存节点，(c) 帧级磁盘缓存 + stamp 对象复用（渲染端）。**没有**"输入对象指针没变就不重算"的隐式机制——因为每次 ToView 都会 clone 新对象，指针必然不同；重算判定落在渲染端的 key/stamp 上。

---

## B. 显示管理线

### B6 `ObjectsManager` / `GraphicsManager` 增量更新
- `ObjectsManager`（`zenovis/include/zenovis/ObjectsManager.h` + `zenovis/src/ObjectsManager.cpp`）：
  - 持有 `MapStablizer<PolymorphicMap<std::map<string, shared_ptr<IObject>>>> objects`（对象级双缓冲 map）。
  - `load_objects(objs, runtype)`：`insertPass()`；两遍循环对每个 key 调 `may_emplace`（第一遍探测并把旧值搬进 `m_next`，第二遍对真新 key `try_emplace` 新对象）；返回是否新增。
  - stamp-change 非 TotalChange → 复用旧对象（见 A3）；`isRealTimeObject` 标记的对象单独收进 `lightObjects`。
  - runtype 过滤：非 RunAll/LoadAsset 时按 `objRunType` 保留其他类别对象（matrix/material/lightCamera 分批更新），见 L51-61。
- `GraphicsManager`（`zenovis/include/zenovis/bate/GraphicsManager.h`）：
  - 持有 `MapStablizer<PolymorphicMap<map<string, unique_ptr<IGraphic>>>> graphics` + `realtime_graphics`。
  - `load_objects`：`ins.may_emplace(key)` 为真才 `makeGraphic` 创建新 IGraphic（**key→IGraphic 的增量 diff**）；已存在 key 直接把旧 IGraphic 搬进 `m_next`，不重建。`has_changed()` 比较前后 key 集合是否一致（只比 key，不比内容）。
  - `draw()`：按 `pairs<IGraphicDraw>()` 遍历 drawable 图形绘制（Light/Camera 等非 draw 图形不出现）。
- 当 PrimitiveObject 变化时：**整对象重建 GL 缓冲，粒度是"对象/key"**。新 key（或 TotalChange 换新对象）→ `makeGraphic` → `ZhxxGraphicPrimitive` 构造器里深拷贝+预处理+一次性上传 pos/clr/nrm/uv/tang 5 个 VBO + points/lines/tris EBO（`GraphicPrimitive.cpp` L549-600）；旧 key → 完全不碰 GL。**不存在"只更新 changed 属性/部分 buffer"的路径**（DataChange 合并代码在 `ObjectsManager.cpp` L43-46 只有注释）。optx 引擎同款按 key diff（`RenderEngineOptx.cpp` L1011+）。

### B7 `MapStablizer` 双缓冲 + stamp-change 四级
- `MapStablizer`（`zeno/include/zeno/utils/MapStablizer.h`）：`m_curr`/`m_next` 双 map；`InsertPass` 是 RAII（scope_finalizer）——pass 期间写 `m_next`，finalize 时 `swap(m_curr, m_next)` 再清 `m_next`。
  - `may_emplace(key)`：key 已在 `m_curr` → 把旧值 move 进 `m_next` 并返回 false（= 复用）；不在 → 返回 true 让调用方构造。
  - `has_changed()`：比较 size 与 key 序列（仅 key，不比 value）。
  - "稳定" = 渲染/读取线程始终看到 `m_curr`（上一帧完整快照），更新在 `m_next` 上完成后再原子交换，遍历中不会看到半更新 map。
- stamp-change 四级：UnChanged / DataChange / ShapeChange（并入 TotalChange）/ TotalChange（见 A3）。
- 防撕裂：zeno 实际是**多进程**架构（`ui/zenoedit/launch/corelaunch.cpp` 启动 runner QProcess；`viewdecode.cpp` 收 `viewObject` 包解码后 addViewObject），计算线程与渲染线程之间没有共享可变对象；同一进程内用 shared_ptr + 深拷贝（IGraphic 持有自己的 prim 副本）+ MapStablizer 双缓冲。GL 缓冲只在"对象新增/重建"时整块重传；stamp 让"没变"的对象连重建都不发生（0 重传）。

### B8 `IGraphic` / `makeGraphic` 分派与属性打包
- `IGraphic`（`zenovis/include/zenovis/bate/IGraphic.h`）：基类带 `nameid`/`objholder`；子类 `IGraphicDraw`（draw）、`IGraphicHandler`（交互手柄）、`IPicker`（拾取）。`MakeGraphicVisitor` 用 `ZENO_XMACRO_IObject` 宏为每个 IObject 类型生成 visit 重载（`IGraphic.cpp` L24-45）。
- 分派表：
  - `PrimitiveObject` → `ZhxxGraphicPrimitive`（`GraphicPrimitive.cpp` L831-833，IGraphicDraw）
  - `LightObject` → `GraphicLight`（`GraphicLight.cpp`，只拷贝 LightData 到 scene 侧，不 draw）
  - `CameraObject` → `GraphicCamera`（`GraphicCamera.cpp`，直接把相机参数 set 到 `scene->camera`）
  - `StringObject`/`NumericObject`/`ListObject`/`DummyObject` → GraphicString/GraphicNumeric/GraphicList/GraphicDummy（`GraphicStringNumeric.cpp`，仅日志/占位，非 draw）
- 属性打包（SoA）：`PrimitiveObject` 是 SoA —— `AttrVector`（`zeno/include/zeno/types/AttrVector.h`）：`BaseVector values`（pos）+ `map<string, variant<vector<vec3f>,vector<float>,...>> attrs`（clr/nrm/uv/tang 等）。`GraphicPrimitive` 直接把每个属性的连续 `std::vector` 原样上传为独立 VBO：`vbos[i]->bind_data(attr.data(), ...)`（L549-566），顶点属性指针 stride=sizeof(float)*3、count=3；points/lines/tris 索引单独 EBO。即 **SoA → 每属性一个 GL_ARRAY_BUFFER**，天然对应 three.js 的 BufferAttribute（每属性一个 Float32Array）。

### B9 GPU 拾取 `FrameBufferPicker`
文件：`zenovis/src/bate/FrameBufferPicker.cpp`（注释引用 modern-opengl-tutorial tutorial29）
- 原理：离屏 FBO + `GL_RGB32UI` 整数纹理（picking_texture）+ 深度纹理（GL_DEPTH_COMPONENT）；shader 输出 `out uvec3 FragColor`。
- 编码（fragment shader）：obj 模式输出 `uvec3(objId, 0, 0)`（L55-62）；vertex 模式输出 `uvec3(objId, gl_VertexID+1, 0)`（L88-97，flat uint gVertexIndex）；prim 模式输出 `uvec3(objId, gl_PrimitiveID+1, 0)`（L101-107）。`objId = 遍历序 id+1`，`id_table[id+1] = 对象 key`（L498）。
- 模式：`PICK_OBJECT / PICK_VERTEX / PICK_LINE / PICK_MESH`（`Scene.h`），按 select_mode 画三角形/点/线，并配 `empty_shader` / `empty_and_offset_shader`（`gl_FragDepth = gl_FragCoord.z + offset`，offset=-0.00001 遮挡背面点/线，L108-126）。
- 读取：`glReadPixels(x, h-y-1, 1, 1, GL_RGB_INTEGER, GL_UNSIGNED_INT, &pixel)` 得到 `(obj_id, elem_id, blank)`（L530）；支持单点（L504-556）与矩形框选（L558-629，批量 region 读取+去重）。
- 深度反投影（`RenderEngineBate::getClickedPos`，`RenderEngineBate.cpp` L130-186）：读 `GL_DEPTH_COMPONENT` 深度 → 相机是**无限远反向 Z**（`MakeInfReversedZProjRH`，`Camera.h` L35/L118；绘制用 `glClipControl(GL_LOWER_LEFT, GL_ZERO_TO_ONE)` + `glDepthFunc(GL_GREATER)` + `glClearDepth(0.0)`，`RenderEngineBate.cpp` L56-58）→ `cz = inf_z_near / depth` 还原 view 空间 z → 由屏幕 uv 和 fov/宽高比求 view 空间 (cx, cy) → `glm::inverse(view_matrix) * (cx, cy, -cz, 1)` 得世界坐标。
- 优势 vs CPU 射线：拾取命中与渲染完全一致（所见即所得，含线宽/点大小/裁剪/背面等），复杂度 O(像素) 而非 O(网格) 射线求交，天然支持框选，无需 BVH/加速结构；代价是额外一遍拾取 pass 和整数纹理读取。

### B10 编辑器→渲染器同步
- 全链路（计算进程/渲染进程分离 + 帧事件驱动）：
  1. 编辑器改参数 → 序列化命令流（`serialize.cpp`：addNode/setNodeInput/bindNodeInput/markNodeChanged/...）→ 经 `corelaunch`（`ui/zenoedit/launch/corelaunch.cpp`）发给 runner 进程执行（多进程 QProcess，`viewdecode.cpp` 收包）。
  2. runner：每帧 `globalState->frameid=frame`；`globalComm->newFrame()`；`graph->applyNodesToExec()`（lazy pull，根是 ToView/SubOutput）；ToView 把 clone 对象 `addViewObject`；帧末 `dumpFrameCache` + `finishFrame`，回发 `newFrame`/`finishFrame` 事件。
  3. 渲染进程：`mainWin->updateViewport(action)`（`zenomainwindow.cpp` L1166）→ `DisplayWidget::updateFrame` → repaint → `Zenovis::paintGL`（`ui/zenoedit/viewport/zenovis.cpp` L46-57）→ `doFrameUpdate()` → `session->load_objects()` = `Scene::loadFrameObjects(frameid)`（`Scene.cpp` L139-179）：`GlobalComm::load_objects`（内存/磁盘取帧对象）→ `ObjectsManager::load_objects` → `renderMan->getEngine()->update()`（bate: `graphicsMan->load_objects`）→ 然后 `session->new_frame()` → `Scene::draw` → `RenderEngineBate::draw`。
  4. 驱动信号：不是 `onGraphUpdated` 回调，而是 (a) 编辑器侧 run 指令让计算进程逐帧发 newFrame/finishFrame 事件 → updateViewport；(b) 每帧 paintGL 主动拉取（GlobalComm 判帧是否已在内存/是否完成）；(c) 渲染引擎 `update()` 里 GraphicsManager 的 `may_emplace`/`has_changed` 做 key 级增量 diff。切帧时 `setCurrentFrameId` → 下一帧 paintGL 从磁盘按 stamp 增量加载。
- 显示开关：ToView `mode=="UnChanged"` 不导出对象（`ToNodes.cpp` L80）；对象 userData `invisible` → `ZhxxGraphicPrimitive::draw` 里 `show_grid==false && invisible` 跳过（`GraphicPrimitive.cpp` L636-638）；选中态 `scene->selected`（`Scene.h`）→ wireframe/uv 模式额外绘制；`objRunType` + runtype（RunLightCamera/RunMaterial/RunMatrix）控制只更新哪一类对象（`ObjectsManager.cpp` L51-61 + serialize.cpp 过滤）。`DrawOptions`（`DrawOptions.h`）是渲染端显示开关（show_grid/render_wireframe/uv_mode/...）的中枢。

---

## C. 对 Web(three.js) 可迁移点

1. **key+stamp 的对象级增量（照搬 MapStablizer 双缓冲 diff）**
   - zeno：`Map<key, IGraphic>` 双缓冲，key 不变 → 旧图形原样复用（0 上传）；新 key → 重建；`has_changed` 比 key 集合。
   - three.js：把后端对象列表 diff 成 `Map<key, THREE.Object3D/BufferGeometry>`：key 已存在 → 不动；新 key → 创建/重建 geometry；key 集变化 → 通知 UI 刷新。后端配合 stamp（UnChanged/TotalChange 两档就够）：unchanged 只发占位，前端复用旧 geometry，完全避免每帧全量重建。
2. **stamp-change 四级 → 简化为三级**：UnChanged（跳过）/ TotalChange（重建 geometry 全部 attribute）/ DataChange（可选：只更新指定 attribute 的 buffer）。zeno 的 DataChange 没实现；three.js 反而更容易：`geometry.attributes.position.needsUpdate = true` 只重传改动的 attribute。
3. **SoA 属性 → Float32Array 直传**：zeno 每个属性独立 vector 直接 bind 成独立 VBO；前端同样让后端输出 SoA（pos/clr/nrm/uv/tang 各一个 Float32Array），`new THREE.BufferAttribute(arr, 3)` 零转换直传；points/lines/tris 索引用 `THREE.Uint32BufferAttribute`。注意类型/字节序一致。
4. **帧级缓存 + 增量加载**（GlobalComm）：前端可做 IndexedDB 帧缓存：帧数据按 key 存 blob + stampInfo（每对象 change/base）存 JSON；切帧只拉 TotalChange 对象，UnChanged 从缓存取 base 对象 —— 对应 web 时间线快速切帧。
5. **GPU 拾取替代 raycast**：three.js（WebGL2）可做 —— `RenderTarget`（RGBA32UI 整数纹理）+ 每对象 id uniform，读 `uvec3(objId, elemId, 0)`；深度反投影移植 `MakeInfReversedZProjRH`（反向 Z + `gl.depthFunc(gl.GREATER)`，`cz = near/depth` 还原 + `unproject`）。所见即所得、支持框选（region readPixels）、无需 BVH；代价是额外一遍拾取 pass（对象级拾取通常够用）。
6. **深拷贝 + 双缓冲防撕裂**：`ZhxxGraphicPrimitive` 持有 prim 副本 + MapStablizer 双 map。three.js 端"计算 Worker"产出新 Float32Array 后经 transferable 交给主线程，渲染帧开始时**原子替换** `geometry.attributes.pos.array` + needsUpdate，而不是边算边改；渲染循环始终消费上一帧完整快照，避免拖拽/播放撕裂。等价于 m_curr/m_next 交换。
7. **惰性拉取 + visited 去重**：前端对 x6 节点图做按需求值时，照搬 `Context.visited` 防止同一节点在 DAG 合并（portal/多输出）时重复执行；配合 `CachedByKey`（key=字符串参数哈希）做显式 memo（命中即短路，等价前端 promise memoize）。
8. **DirtyChecker 的教训**：append-only 脏集合容易累积，若要做"输入未变不重算"，建议每轮 run 开始时根据 diff 重建脏集合，而非全局累积；zeno 磁盘缓存依赖它，但语义是保守的。
9. **显示开关集中管理**：借鉴 userData 标记（invisible/stamp_mode/objRunType）+ 渲染端统一 DrawOptions；three.js 对应 `object.visible` + 统一 renderOptions 对象，开关不散落各组件。

---

## 关键文件索引
| 文件 | 作用 |
| --- | --- |
| `zeno/src/nodes/CacheNodes.cpp` | CachedByKey/CachedIf/CachedOnce/CacheLastFrame 短路缓存 |
| `zeno/src/nodes/FileDirtCache.cpp` | CacheToDisk 节点磁盘缓存（DirtyChecker 驱动失效） |
| `zeno/include/zeno/extra/DirtyChecker.h` | 节点级脏标记集合 |
| `zeno/src/core/Graph.cpp` / `INode.cpp` | lazy pull、Context.visited、requireInput 脏传播 |
| `zeno/src/nodes/PortalNodes.cpp` | Route / Stamp 节点（stamp-change 四级标签） |
| `zeno/src/nodes/ToNodes.cpp` | ToView 显示出口（key 构造、isStatic/mode、clone） |
| `zeno/src/extra/GlobalComm.cpp` + `.h` | 帧缓存（内存 LRU + ZENCACHE 磁盘 + stampInfo 增量读盘） |
| `zeno/include/zeno/utils/MapStablizer.h` | 双缓冲 map（may_emplace/has_changed/InsertPass） |
| `zenovis/include/zenovis/ObjectsManager.h` + `zenovis/src/ObjectsManager.cpp` | 对象级增量（stamp 复用、runtype 过滤） |
| `zenovis/include/zenovis/bate/GraphicsManager.h` | key→IGraphic 增量 diff 与 draw 遍历 |
| `zenovis/src/bate/GraphicPrimitive.cpp` | Primitive→GL：深拷贝+预处理+SoA VBO 一次性上传 |
| `zenovis/src/bate/IGraphic.cpp` + `IGraphic.h` | makeGraphic 类型分派（XMACRO） |
| `zenovis/src/bate/FrameBufferPicker.cpp` | GPU 拾取（uvec3 id FBO + 深度反投影） |
| `zenovis/src/bate/RenderEngineBate.cpp` | bate 引擎 update/draw、getClickedPos 反投影 |
| `zenovis/src/Scene.cpp` | loadFrameObjects（GlobalComm→ObjectsManager→engine->update） |
| `ui/zenoedit/viewport/zenovis.cpp` | paintGL→doFrameUpdate→session->load_objects/new_frame |
| `ui/zenoedit/launch/serialize.cpp` / `corelaunch.cpp` / `viewdecode.cpp` | 编辑器→runner 命令流与帧事件 |
| `zeno/include/zeno/types/AttrVector.h` | SoA 属性容器 |
| `zeno/include/zeno/funcs/ObjectCodec.h` | 对象二进制编解码（磁盘缓存） |