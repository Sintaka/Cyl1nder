# Cyl1nder「完整场景快照系统」技术调研报告

> 调研日期：2026-08-10 · 调研角色：调研子智能体（只读，未改任何代码）
> 目标仓库：`D:\code\dev\Cyl1nder`（bridge/ + web/ + devlog/）
> 调研对象：rete.js 2 序列化、React Flow / litegraph / ComfyUI 快照 schema、dockview 布局保存、推荐 schema 与落地路径
> 代码证据：`web/src/nodes2/graph.ts`、`web/src/nodes2/NodeView.tsx`、`web/src/app/dock.ts`、`bridge/bridge/snapshot.py`、`bridge/bridge/routes.py`、`web/vendor/rete-src`、`web/vendor/rete-area-src`、`web/node_modules/dockview-core` 等

---

## 0. 结论摘要表

| # | 问题 | 结论 |
|---|---|---|
| 1 | rete.js 2 是否有内置 toJSON/fromJSON | **没有**。v1 有 `editor.toJSON()`；v2 官方文档（Import/export 指南）明确“current version doesn't support importing/exporting by default”，必须手写 `serializeGraph()` / `restoreGraph()` |
| 2 | 节点位置如何序列化 | 导出：`area.nodeViews.get(nodeId).position`（`{x, y}`）；恢复：**不能直接改 position**，须在 `editor.addNode(node)` 之后调用 `await area.translate(node.id, {x, y})`（rete 官方 issue #620） |
| 3 | viewport 的 zoom/平移如何序列化 | `area.area.transform` = `{ k, x, y }`（k=缩放，x/y=平移，源码 `rete-area-src/src/area.ts` L25）。恢复：先写 transform 三字段，再 `area.area.translate(x, y)` + `area.area.zoom(k, 0, 0)` 触发重绘；初始帧也可用 `AreaExtensions.zoomAt` |
| 4 | 连接如何序列化 | `editor.getConnections()` → `{ id, source, sourceOutput, target, targetInput }`（`ClassicPreset.Connection`）。恢复：**全部节点 addNode 之后**再 `new ClassicPreset.Connection(srcNode, srcOut, tgtNode, tgtIn)` + `editor.addConnection()`，并回填保存的 `id`（官方 issue #621） |
| 5 | React Flow 参考 | `useReactFlow().toObject()` → `{ nodes, edges, viewport: { x, y, zoom } }`；恢复 `setNodes` + `setEdges` + `setViewport`。这是“节点+连线+视口三合一”的成熟范式，与 rete 的 nodeViews.position / connections / area.transform 一一对应 |
| 6 | litegraph / ComfyUI 参考 | `LGraph.serialize()` → 顶层 `{ last_node_id, last_link_id, nodes[], links[], groups[], version }`；node 含 `pos/size/flags/order/mode/widgets_values`；link 为 `[link_id, from_id, from_slot, to_id, to_slot, type]`。ComfyUI 的“保存格式(带 UI 元数据)”与“API 格式(扁平 dict + 内联 [node_id, slot])”分离是重要启示 |
| 7 | dockview 布局保存 | `dv.toJSON()` → `SerializedDockview { grid:{root:{type:'leaf'|'branch',data,size},height,width,orientation}, panels:Record<id,PanelState>, activeGroup?, floatingGroups?, popoutGroups?, edgeGroups? }`；`dv.fromJSON(data, {reuseExistingPanels})`。本项目 dock.ts 已全局保存（localStorage + bridge `/api/ui/layout`），但 fromJSON 恢复因 5 面板渲染 bug 被注释禁用 |
| 8 | 布局与场景如何关联 | 现状：dockview 布局是**全局唯一**（跨浏览器/跨 serial）。建议：场景快照在 graph part 内嵌 `layout` 副本（每场景一布局），并保留现有全局 layout 作为“最后一次布局”兜底 |
| 9 | 推荐 schema（草案） | graph part 升级为 schemaVersion 2：`{ schemaVersion, serial, savedAt, viewport:{x,y,k}, layout?, nodes:[{id,kind,label,baseLabel,flags,x,y}], connections:[{id,source,sourceOutput,target,targetInput}], meta:{nullSeq, appVersion} }` |
| 10 | 与现有 bridge 快照合并 | `meta/inputs/outputs` 三部分不动；graph part 从占位扩展为完整场景（节点+位置+连线+视口+布局）。保存：web 序列化 → `PUT /api/hda/{serial}/snapshot {graph}` → `write_snapshot(graph=...)` 原子落盘；加载：`GET snapshot?view=graph` → `restoreGraph()` |

---

## 1. 调研点一：rete.js 2 如何序列化保存编辑器状态

### 1.1 官方能力边界（重要结论：没有内置序列化）

- **v1 有**：老版 `NodeEditor` 提供 `toJSON()`（rete.readthedocs.io 的 Editor 文档）。
- **v2 没有**：官方指南 [Import/export](https://retejs.org/docs/guides/import-export/) 原文：“The current version of the editor doesn't support importing/exporting by default”，并列出两个原因：序列化含方法/循环引用的 class 实例困难、导入顺序随图结构变化。文档给出的是**手写参考代码**而非内置 API。
- **数据结构规范化**（[Data structures](https://retejs.org/docs/guides/data-structures/) 指南 + `web/vendor/rete-src/src/editor.ts` 源码）：
  - 节点：至少 `{ id: string }`；本项目用 `ClassicPreset.Node` 子类 `CylNode`（`web/src/nodes2/graph.ts` L100-131）。
  - 连接：至少 `{ id, source, target }`；`ClassicPreset.Connection` 实际字段为 `{ id, source, sourceOutput, target, targetInput }`（`rete-src/src/presets/classic.ts` L207-246）。
  - `NodeEditor` 只提供 `getNodes() / getConnections() / getNode(id) / getConnection(id) / addNode / addConnection / removeConnection / clear`，**没有任何序列化方法**（`editor.ts` L29-173）。

### 1.2 节点位置（area-plugin）

源码证据（`web/vendor/rete-area-src/src/node-view.ts`、`area.ts`、`index.ts`）：

- `AreaPlugin.nodeViews` 是 `Map<NodeId, NodeView>`；`NodeView.position` 是 `{ x, y }`（`node-view.ts` L21, L55）。
- **导出**：`area.nodeViews.get(nodeId)?.position` —— 官方 issue #620 确认这就是 v2 的取法（`node.position // [x, y]` 是 v1）。
- **恢复**：`await area.translate(node.id, { x, y })`，且必须在节点 `addNode` **之后**（addNode 才会创建 NodeView，`AreaPlugin.addNodeView` 在 `nodecreated` 管道中触发）。官方明确“不能直接改 position”。
- 本项目已有先例：`graph.ts` L192-193 `await area.translate(input.id, { x: 24, y: 40 })`、L349-350 Tab 创建节点后 translate 到中心。

### 1.3 viewport 的 zoom / 平移（area.area.transform）

- `area.area` 是 `Area` 实例，`transform: Transform = { k: 1, x: 0, y: 0 }`（`rete-area-src/src/area.ts` L6, L25）。`k` 为缩放、`x/y` 为画布平移；`update()` 用 `translate(x,y) scale(k)` 渲染到 `content.holder.style.transform`。
- 本项目读取点：`graph.ts` L545 `const t0 = { ...area.area.transform }`（MMB 平移起点）、L573-574 dot-grid 读 `area.area.transform.k / .x / .y`。**serialize 时直接读这三字段即可**。
- **恢复**：`transform` 是 public 字段，可直接写：

```ts
const t = area.area.transform;
t.x = saved.viewport.x; t.y = saved.viewport.y; t.k = saved.viewport.k;
void area.area.translate(t.x, t.y);   // 触发 update() + translated 事件
void area.area.zoom(t.k, 0, 0);       // 同 k 时 d=0，x/y 不变，触发 update() + zoomed 事件
```

注意 `update()` 是 private，不能直接调；用上面两个 public 方法即可。也可以把 `AreaExtensions.zoomAt(area, nodes)`（`rete-area-src/src/extensions/zoom-at.ts`）作为“无保存视口时的初始取景”。

- 时机坑：视口恢复应在**节点/连线都渲染完、容器有实际尺寸**之后做（否则 zoomAt 计算的 clientWidth/Height 为 0）。

### 1.4 连接序列化

- 导出：`editor.getConnections()`，每条的 `{ id, source, sourceOutput, target, targetInput }` 都是原始标量，直接可 JSON。社区范例（issue #621）导出为 `{ id, from: {id, portName}, to: {id, portName} }`，本项目扁平化存 `{source, sourceOutput, target, targetInput}` 即可。
- 恢复顺序（关键，issue #621 的血泪教训）：
  1. 先按 nodes 依次 `await editor.addNode(node)`（**顺序 await，官方建议避免并发 addNode**，`#620` 回复）；
  2. 每节点 addNode 后 `await area.translate(id, {x,y})`；
  3. **所有节点就绪后**，再遍历 connections，用 `editor.getNode(source)` 拿到实例，`new ClassicPreset.Connection(srcNode, sourceOutput, tgtNode, targetInput)`，**回填保存的 `connection.id`**（否则引用丢失/悬空），再 `await editor.addConnection(conn)`。
- `ClassicPreset.Connection` 构造时会校验 `source.outputs[sourceOutput]` 与 `target.inputs[targetInput]` 存在（`classic.ts` L231-236），所以**节点必须先恢复端口**（本项目端口由 `makeInputNode/makeOutputNode/makeNullNode` 固定生成，属“静态端口”，恢复时按 kind 重建即可）。

### 1.5 本项目（graph.ts）序列化要点清单

| 需要保存的东西 | 读取方式（代码证据） | 恢复方式 |
|---|---|---|
| 节点存在性与 kind | `editor.getNodes()`；`(n as CylNode).kind` | 按 kind 重建：`makeInputNode/makeOutputNode/makeNullNode`，回填 `node.id` |
| 节点 label（null/null1/null2…） | `node.label` / `node.baseLabel` | 回填 label；**模块级 `nullSeq` 需按最大后缀续号**（`graph.ts` L163-171） |
| flags | `node.flags = {display,bypass,freeze,wireframe}`（`NodeFlags`） | 直接回填 flags；注意 display 唯一语义（`setDisplayHandler` L254-273） |
| stats | `node.stats`（运行态，由 `setStats` 写入） | **不建议持久化**（运行态），或存 `lastStats` 仅展示 |
| 节点位置 | `area.nodeViews.get(id).position` | `area.translate(id, {x,y})`（addNode 后） |
| 视口 | `area.area.transform` = `{k,x,y}` | 写 transform + `translate/zoom` 触发重绘 |
| 连线 | `editor.getConnections()` | 全部节点后 `addConnection` + 回填 id |

---

## 2. 调研点二：其他节点编辑器工程的快照 schema（成熟参考）

### 2.1 React Flow（@xyflow/react）—— 官方 save/restore 范式

官方示例 [Save and Restore](https://reactflow.dev/examples/interaction/save-and-restore)：

```ts
const flow = rfInstance.toObject();          // { nodes, edges, viewport }
localStorage.setItem('flow', JSON.stringify(flow));
// restore:
const { x = 0, y = 0, zoom = 1 } = flow.viewport;
setNodes(flow.nodes || []);
setEdges(flow.edges || []);
setViewport({ x, y, zoom });
```

- `toObject()` 返回 `{ nodes: Node[], edges: Edge[], viewport: {x, y, zoom} }` —— **节点、连线、视口三合一**，与我们要做的完全同构。
- node 结构：`{ id, type, position:{x,y}, data, ... }`；edge 结构：`{ id, source, sourceHandle, target, targetHandle }`。
- 社区实践（tessl/gedsys registry 规则）建议在 toObject 结果上再包一层 `{ flowVersion, ... }` 做版本化 —— 佐证“外层加 schemaVersion”的通用做法。

### 2.2 litegraph.js —— LGraph.serialize / configure

ComfyUI 用的就是 litegraph（fork）。`LGraph.serialize()` 产出（ComfyUI 保存格式 = ComfyWorkflowJSON，见 [ComfyUI workflows](https://mintlify.wiki/Comfy-Org/ComfyUI/concepts/workflows) 与 DeepWiki [LiteGraph Integration](https://deepwiki.com/Comfy-Org/ComfyUI_frontend/2.2-litegraph-integration)）：

```json
{
  "revision": 0,
  "last_node_id": 8,
  "last_link_id": 6,
  "nodes": [
    {
      "id": 1,
      "type": "CheckpointLoaderSimple",
      "pos": [100, 100],
      "size": [315, 98],
      "flags": {},
      "order": 0,
      "mode": 0,
      "inputs": [],
      "outputs": [{ "name": "MODEL", "type": "MODEL", "links": [1] }],
      "properties": {},
      "widgets_values": ["sd_xl_base_1.0.safetensors"]
    }
  ],
  "links": [
    [1, 1, 0, 3, 0, "MODEL"]   // [link_id, from_node, from_slot, to_node, to_slot, type]
  ],
  "groups": [ { "title": "g", "bounding": [0, 0, 100, 100], "color": "#3f789e" } ],
  "version": 0.4
}
```

- 恢复：`LGraph.configure(data)`（`LGraph.ts` L917）。
- 启示：**位置用数组 `[x, y]`、连线用扁平 link 数组**、节点自带 `flags/mode`（对应我们的 `NodeFlags`）、顶层有 `version`（= schema 版本）与 `last_node_id/last_link_id` 计数器（= 我们的 `nullSeq`）。

### 2.3 ComfyUI —— “保存格式”与“API 格式”分离

- **保存格式**（ComfyWorkflowJSON）：上面那套，含 `pos/size/color/groups/title` 等全部 UI 元数据，用于前端重开。
- **API 格式**（ComfyApiWorkflow，[workflow-api-format](https://docs.comfy.org/development/api-development/workflow-api-format)）：扁平 dict，key 为节点 id，值为 `{ class_type, inputs, _meta:{title} }`，连线内联在 inputs 里如 `"model": ["4", 0]`（源节点 id + 槽位），**省略全部 UI 元数据**。
- 启示：**执行/传输格式与编辑/快照格式分开**。Cyl1nder 的 bridge snapshot 承担“编辑格式”角色，应保留 viewport/positions/layout；若未来要“只恢复数据不回放 UI”，可另出扁平 API 格式（类似 ComfyUI）。

### 2.4 三家对照表

| 维度 | React Flow toObject | litegraph / ComfyUI 保存格式 | Cyl1nder（rete2，本方案） |
|---|---|---|---|
| 顶层 | `{nodes, edges, viewport}` | `{last_node_id, last_link_id, nodes, links, groups, version}` | `{schemaVersion, viewport, nodes, connections, layout?}` |
| 节点标识 | `id`（字符串/数字） | `id`（数字） | `id`（getUID 16 位 hex 字符串） |
| 位置 | `position: {x,y}` | `pos: [x,y]` | `x, y`（源自 `nodeViews.get(id).position`） |
| 节点参数 | `data`（任意 JSON） | `widgets_values / properties / flags / mode` | `flags / kind / label / baseLabel / stats(可选)` |
| 连线 | `{id, source, sourceHandle, target, targetHandle}` | `[link_id, from, from_slot, to, to_slot, type]` | `{id, source, sourceOutput, target, targetInput}` |
| 视口 | `viewport: {x, y, zoom}` | 画布 transform（未在 serialize 中） | `viewport: {x, y, k}` |
| 版本 | 无内置（社区加 flowVersion） | `version` 字段 | `schemaVersion` 字段 |

---

## 3. 调研点三：dockview 布局保存

### 3.1 官方 API（本项目 node_modules/dockview-core@7 源码证据）

- 类型（`dockview-core/dist/cjs/dockview/dockviewComponent.d.ts` L98-112，`gridview/gridview.d.ts` L55-59）：

```ts
interface SerializedDockview {
  grid: {
    root: SerializedGridObject<GroupviewPanelState>;  // {type:'leaf'|'branch', data, size?, visible?}
    height: number; width: number; orientation: 'HORIZONTAL' | 'VERTICAL';
  };
  panels: Record<string, GroupviewPanelState>;  // {id, contentComponent?, tabComponent?, title?, renderer?, params?, min/max size}
  activeGroup?: string;
  floatingGroups?: SerializedFloatingGroup[];
  popoutGroups?: SerializedPopoutGroup[];
  edgeGroups?: SerializedEdgeGroups;
}
```

- 组件方法：`toJSON(): SerializedDockview`、`fromJSON(data, options?: { reuseExistingPanels: boolean })`、`onDidLayoutFromJSON: Event<void>`（dockview 官方文档 Loading State：`fromJSON` 传入非法对象会抛错并优雅重置）。
- 官方推荐用法（[Core Concepts](https://dockview.dev/docs/core/overview/)）：`api.toJSON()` → localStorage/后端；`api.fromJSON(JSON.parse(saved))` 恢复。

### 3.2 本项目现状（web/src/app/dock.ts）

- 保存：`dv.api.onDidLayoutChange` → 600ms 防抖 → `dv.toJSON()` → `localStorage.setItem("cyl1nder.dock.layout.v1", ...)` + `client.putUiLayout(json)`（bridge `PUT /api/ui/layout` 写 `ui-layout.json`，跨浏览器/跨会话，`routes.py` L159-164）。
- 恢复：**当前被禁用**。dock.ts 注释明确记录：dockview 7 的 fromJSON 在 5 面板布局下会丢 content renderer（Log 面板 tab 幸存但 `.cyl-log` 离开 DOM），所以每次启动都走程序化默认布局，只保留保存。→ **完整场景快照若想恢复布局，必须先解决/绕过这个 bug**（见 4.5、6.2）。
- 布局是**全局唯一**的（`/api/ui/layout` 无 serial 参数），不区分场景。

### 3.3 场景 ↔ 布局关联：推荐做法

- 需求是“⑥使用哪个 desktop 布局”。两种方案：
  - **A（推荐）内嵌副本**：graph part 里存 `layout: SerializedDockview`，每场景一份。恢复场景 = 恢复节点图 + 视口 + 布局。缺点：JSON 变大（多面板布局 JSON 约几 KB～几十 KB），且需绕过 fromJSON bug。
  - **B（轻量）layoutId 引用**：布局仍全局存（现有 `/api/ui/layout`），场景里只存 `layoutId`（如 `"default" | "custom"`），恢复时按 id 取全局布局。缺点：场景与全局布局耦合，跨机器不同步。
- 结论：选 **A 内嵌副本**（每场景一个布局，符合“保存完整场景”语义），同时保留现有全局 layout 作为新场景/未存布局时的默认值。若 fromJSON bug 短期修不了，P0 可先存不恢复，P1 再启用（见第 6 节）。

---

## 4. 调研点四：工程建议 —— 推荐 schema 草案

### 4.1 文件与版本化

延续现有设计（`devlog/snapshot-design.md`）：快照目录 `<hip>/Cyl1nder/<serial>/`，4 个文件 `meta/graph/inputs/outputs`。**本轮只升级 graph part**，其余不动：

- `<serial>.graph.json` 从“占位”升级为 **schemaVersion 2** 的完整场景。
- 每文件独立 `schemaVersion`（已有约定）；读取端前向兼容（只读 <= current，拒绝 > current 并告警）。

### 4.2 推荐 schema（graph.json v2 草案）

```jsonc
{
  "schemaVersion": 2,                          // graph part 版本
  "serial": "C1-xxxxxxxx-xxxx",
  "savedAt": 1770000000.0,                     // epoch s
  "viewport": { "x": 24, "y": 40, "k": 0.9 },  // rete area.area.transform
  "layout": {                                  // 可选；SerializedDockview（方案 A 内嵌）
    "grid": { "root": { "type": "branch", "data": [], "size": 0.5 }, "height": 800, "width": 1200, "orientation": "HORIZONTAL" },
    "panels": { "graph": { "id": "graph", "contentComponent": "graph", "title": "Node Graph" } },
    "activeGroup": "g1"
  },
  "nodes": [
    {
      "id": "a1b2c3d4e5f6a7b8",                // 必须回填原 id（连接引用它）
      "kind": "input",                          // input | output | null
      "label": "_input_",                       // 恢复显示名；null 系列需由 nullSeq 校验
      "baseLabel": "_input_",
      "flags": { "display": true, "bypass": false, "freeze": false, "wireframe": false },
      "x": 24, "y": 40                          // 源自 area.nodeViews.get(id).position
    }
  ],
  "connections": [
    { "id": "...", "source": "a1b2...", "sourceOutput": "in0", "target": "c3d4...", "targetInput": "out0" }
  ],
  "meta": {
    "nullSeq": 3,                               // 恢复后继续编号（null/null1/null2...）
    "appVersion": "0.1.0"
  }
}
```

字段说明与取舍：

- `nodes[].kind`：决定用哪个工厂函数重建（端口是静态的，`makeInputNode/makeOutputNode/makeNullNode`），**不需要序列化端口**（rete 官方“静态端口只存节点名+数据”建议）。
- `nodes[].flags`：即 `NodeFlags`，全量保存；`stats` 默认不存（运行态），如需保留最近统计可加 `"lastStats"` 只读字段。
- `viewport`：`area.area.transform` 直读；`k` 与 React Flow 的 `zoom` 同义。
- `connections`：扁平化 `{source, sourceOutput, target, targetInput}` + 回填 id。
- `meta.nullSeq`：graph.ts 模块级计数器，恢复时按 `max(label 后缀)` 续号，避免新建节点重名（`null1` 冲突）。
- `layout`：方案 A 内嵌 `SerializedDockview`；P0 可先存不恢复。

### 4.3 保存 / 加载流程

保存（web → bridge → 磁盘，单写者铁律不变）：

```
Ctrl+S / 防抖  →  serializeGraph():
                   nodes   = editor.getNodes().map(n => ({ id, kind, label, baseLabel, flags, ...nodeViews.get(id).position }))
                   conns   = editor.getConnections().map(c => ({ id, source, sourceOutput, target, targetInput }))
                   viewport= area.area.transform
                   layout  = dv.toJSON()
                 → PUT /api/hda/{serial}/snapshot  body { graph }
                 → bridge write_snapshot(graph=..., meta=build_meta(...))  // 原子 tmp+replace + 内容对比
```

加载（页面打开 / 桥重启兜底）：

```
GET /api/hda/{serial}/snapshot?view=graph
  → restoreGraph(json):
      editor.clear()
      for node of json.nodes:  instance = makeByKind(kind); 回填 id/label/flags;  await editor.addNode;  await area.translate(x,y)
      for conn of json.connections:  new ClassicPreset.Connection(getNode(source), sourceOutput, getNode(target), targetInput); 回填 id;  await editor.addConnection
      viewport 恢复（容器有尺寸后）：transform = json.viewport;  area.area.translate/zoom
      layout 恢复（P1，绕过 fromJSON bug 后）：dv.fromJSON(json.layout)
      nullSeq 续号；恢复 display 唯一语义；notifyNodeChanged()
```

### 4.4 与现有 bridge 快照（meta/inputs/outputs）如何合并

| 部分 | 现状 | 本轮 |
|---|---|---|
| meta | `build_meta()`（schemaVersion/serial/hip/nodePath/version/inputRev/outputRev/savedAt/snapshotId） | 不变 |
| inputs / outputs | `_maybe_snapshot` 节流写 `ws.inputs/all_outputs()` | 不变 |
| graph | 占位（从未写） | **升级为完整场景**：节点+位置+连线+视口+布局 |

合并原则（沿用 `snapshot-design.md` R1-R5）：

- 场景快照 = **UI 编排状态**（graph part），数据快照 = **几何状态**（inputs/outputs part），meta = **身份/时间戳**；三者同目录、同 serial、独立 schemaVersion，`read_snapshot` 聚合返回。
- `_maybe_snapshot`（cook 节流路径）只写 inputs/outputs/meta，**不写 graph**（避免 HDA cook 高频覆盖 UI 编排）；graph 只由 **web 显式保存**写入。这样“场景编排”与“数据流”两套节奏解耦。
- 桥重启自愈：workspace 归零时，inputs/outputs 用快照回填（现有场景 B），graph 由 web `GET snapshot?view=graph` 恢复 —— 两路互不阻塞。

### 4.5 关键坑与对策

1. **恢复顺序**：节点 → 位置 → 连线 → 视口；连线必须在两端节点就绪后（`ClassicPreset.Connection` 构造会校验端口）。
2. **节点/连线 id 必须回填**：连接按 id 引用节点；丢失 id = 引用断裂（issue #621 的踩坑点）。
3. **nullSeq 续号**：否则恢复后新建 null 会与已有 label 冲突。
4. **display 唯一语义**：恢复时若多个节点 display=true，只保留保存时的那个（或首个）。
5. **视口恢复时机**：容器有尺寸后再恢复/zoomAt，否则 transform 计算基于 0 尺寸。
6. **dockview fromJSON 5 面板 bug**：P0 存不恢复；P1 先复现并修（可能需自定义 renderer 迁移或升级 dockview），再启用。
7. **schema 演进**：`schemaVersion` 只进不退；读取端对 `> current` 的文件拒绝并提示升级。
8. **并发/原子性**：保持 bridge 单写者 + tmp+replace（已有实现），web 端 serialize 时对 `area.nodeViews`/`area.area.transform` 做快照拷贝（防异步渲染中位置漂移）。

---

## 5. 分阶段落地建议

### P0 —— 最小闭环（v0.1.x 即可做）

- `web/src/nodes2/graph.ts`：新增 `serializeGraph(): SceneGraphJson` 与 `restoreGraph(json): Promise<void>`（按 4.3 顺序），导出 `ReteGraph` 接口；处理 nullSeq 续号、id 回填、display 唯一语义。
- `bridge`：`routes.py` 的 `PUT /api/hda/{serial}/snapshot` 接受 `{ graph }` 并透传 `write_snapshot(graph=...)`；`GET ?view=graph` 返回 graph part（现有 read_snapshot 已支持）。
- `web`：保存按钮 + Ctrl+S 调 `serializeGraph()` → `client.putSnapshot(serial, { graph })`；打开页面时 `GET snapshot?view=graph` → `restoreGraph()`。
- 验证：bridge pytest（graph round-trip / 原子性）、web vitest（serialize→restore 相等性，含 viewport/positions/connections）、e2e（保存→刷新→恢复）。

### P1 —— 自动与自愈 + 布局

- 自动防抖保存（内容变才请求，复用现有 3s 节奏；graph 变更源：`nodecreated/nodetranslated/connectioncreated/zoomed/translated` 事件）。
- 场景内嵌 layout：`dv.toJSON()` 进 graph part；**先复现并绕过 dockview 7 fromJSON 5 面板 bug**（候选：升级 dockview、恢复后手动 re-init 内容元素、或加 contentComponent 白名单校验），再启用 `dv.fromJSON`。
- 桥重启自愈：web 检测 reset → 提示一键「从快照恢复」（恢复 graph + inputs/outputs 回填）。

### P2 —— 备份与流式对齐

- 备份扩展：`history/<snapshotId>/` + 保留策略（数量/天数），current 文件名不变（`snapshot-design.md` §8）。
- 与 `streaming-plan-b.md` 对齐：inputs/outputs 快照字段升级（topoId 等）；graph part 如需“执行格式”可仿 ComfyUI 出扁平 API 变体。
- schemaVersion 迁移工具（v2 → v3 若发生），文档模板。

---

## 6. 参考链接

- rete.js 2 官方 Import/export 指南：https://retejs.org/docs/guides/import-export/
- rete.js 2 Data structures（节点/连接最小结构）：https://retejs.org/docs/guides/data-structures/
- rete.js 官方讨论 #620（节点位置导出/恢复）：https://github.com/retejs/rete/discussions/620
- rete.js 官方讨论 #621（完整 importGraphJSON 社区实现）：https://github.com/retejs/rete/discussions/621
- React Flow Save and Restore 示例（toObject/setViewport）：https://reactflow.dev/examples/interaction/save-and-restore
- ComfyUI Workflow API 格式（保存 vs API 格式）：https://docs.comfy.org/development/api-development/workflow-api-format
- ComfyUI workflows 概念（保存格式 JSON 示例）：https://mintlify.wiki/Comfy-Org/ComfyUI/concepts/workflows
- ComfyUI_frontend DeepWiki（LiteGraph serialize / 序列化管线）：https://deepwiki.com/Comfy-Org/ComfyUI_frontend/2.2-litegraph-integration
- Dockview Core Concepts / Loading State（toJSON/fromJSON）：https://dockview.dev/docs/core/overview/ 、https://dockview.dev/docs/core/state/load/
- 本地代码：`D:\code\dev\Cyl1nder\devlog\snapshot-design.md`、`web\src\nodes2\graph.ts`、`web\src\app\dock.ts`、`bridge\bridge\snapshot.py`、`bridge\bridge\routes.py`、`web\vendor\rete-*-src`