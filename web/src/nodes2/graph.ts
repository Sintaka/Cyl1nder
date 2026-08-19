/**
 * Cyl1nder node graph on rete.js 2 (replaces the @antv/x6 custom graph).
 * Houdini-style vertical nodes: inputs on the left, outputs on the right,
 * 4-in/4-out, engine-level caching, node flags, Tab search, Y cut mode.
 *
 * v1 dataflow note: the network itself is still driven by the bridge/WS
 * (store.inputs -> runNetwork -> pushOutputs). The rete DataflowEngine is wired
 * so node outputs are cached and only recompute when inputs/connections change -
 * the future compute engine. Nodes visualize stats and drive the 3D viewport.
 *
 * 2.2 refactor: thin shell; logic lives in graph-model / graph-interact / graph-undo.
 */
import { ClassicPreset, NodeEditor } from "rete";
import { AreaPlugin, AreaExtensions } from "rete-area-plugin";
import { ClassicFlow, ConnectionPlugin, type SocketData } from "rete-connection-plugin";
import { DataflowEngine, type DataflowEngineScheme } from "rete-engine";
import { Presets, ReactPlugin } from "rete-react-plugin";
import { createRoot } from "react-dom/client";
import React from "react";
import { NodeView, notifyNodeChanged, setDisplayHandler } from "./NodeView";
import { ConnectionView } from "./ConnectionView";
import { store } from "../stores/workspace";
import type { UndoAction } from "./undo";
import {
  applyNodeBindings,
  applyNodeErrors,
  nodeErrorsOf,
  CylNode,
  DEFAULT_FLAGS,
  applyConnectionBypassVisual,
  applyConnectionTypeVisual,
  canConnectSockets,
  getConnectionBypass,
  isEnterableKind,
  HIER_GRAPH_SCHEMA,
  socketNameOf,
  syncPortSocketType,
  listNodeParamBindingsView,
  makeChannelNode,
  makeInputNode,
  makeOutputNode,
  makeProjectNode,
  nodeByKind,
  nodeFromTarget,
  nodeParamBindingsView,
  notifySelection,
  onSelectionChange,
  planProjectGraph,
  portIndexFromTarget,
  resolveInputSourcePort,
  serializeGraph,
  restoreGraph,
  getNetworkSnapshot,
  setConnectionBypassFlag,
  log,
} from "./graph-model";
import type { AreaExtra, NetKind, NodeError, NodeErrorMap, NodeKind, ParamSpec, ProjectGraphInput, ReteGraphHandlers, ReteGraph, Schemes } from "./graph-model";
import {
  attachConnectionSelect,
  attachCutMode,
  attachDotGrid,
  attachEnterNode,
  attachFlagMenu,
  attachInsertion,
  attachMMBPan,
  attachReconnect,
  attachRectSelect,
  attachShakeDisconnect,
  attachTabSearch,
  clearConnectionSelection,
  getSelectedConnectionId,
  initTooltip,
  setEnterNodeHandler,
  setNetKindProvider,
  setNodeStateHandler,
  setRenameHandler,
} from "./graph-interact";
import { cancelGraphInteractions } from "./graph-interact";
import { createGraphUndoManager } from "./graph-undo";
import { makeRefRegistry, type RefRegistry } from "./ref-registry";
// task #8：端口类型的唯一真源是映射系统（手打的 type 参数只作回退），见 setNodeParams。
import { resolveAddressType } from "./mapping-types";

export type { NodeKind, NodeFlags, ParamSpec, SelectedNodeInfo, ReteGraphHandlers, ReteGraph } from "./graph-model";
export type { ProjectGraphInput } from "./graph-model";
export type { NodeError, NodeErrorMap, NodeErrorSeverity } from "./graph-model";
export { DEFAULT_FLAGS, CylNode, makeNullNode, makeTransformNode } from "./graph-model";
// 节点错误系统 / 端口类型着色：NodeView 与错误产生方（network 运行器）的取用入口。
export {
  mergeNodeErrorMaps,
  multiSourceErrorsToNodeErrors,
  socketTypeClass,
  toNodeErrors,
  worstSeverity,
} from "./graph-model";
export { setNodeStateHandler, fireNodeState, setRenameHandler, fireRename, initTooltip, showTooltip, hideTooltip } from "./graph-interact";
// obj/sop 层级导航（v0.1.00119）：enterNode / exitNode / getNetPath / getCurrentNetKind /
// setNetPathChangedHandler 都是本文件下方的模块级实现，此处只是集中声明它们属于公开面。
export type { NetKind } from "./graph-model";

// ---------------------------------------------------------------------------
// P2b 项目模式模块态：当前图句柄 + channel display 独立状态机
// ---------------------------------------------------------------------------
// loadProjectGraph / projectGraphSnapshot / isProjectMode 是无参入口，需要编辑器/画布，
// 因此 createReteGraph 把当前图句柄注册到这里（单图场景）。channel display 是**独立于**
// 旧 kinds 的唯一 display 状态机：不碰 flags.display、不扫旧节点，只维护一个「当前点亮
// channel serial」+ 回调激活（写集 C 把它绑到活动成员）。
let activeGraph: { editor: NodeEditor<Schemes>; area: AreaPlugin<Schemes, AreaExtra> } | null = null;
let channelDisplaySerial: string | null = null;
let channelDisplayCb: ((serial: string) => void) | null = null;

/** channel 节点点 display chip 时回调 fn(serial)（写集 C：激活成员 + 地址刷新）；null 解除。 */
export function setChannelDisplayHandler(fn: ((serial: string) => void) | null): void {
  channelDisplayCb = fn;
}

/** 当前点亮的 channel serial（NodeView 读它渲染 chip 点亮态；无则 null）。 */
export function getChannelDisplaySerial(): string | null {
  return channelDisplaySerial;
}

/** 该节点是否已接线（任一端）。dot 用它决定配色：**未接线是白色**，接线后才取类型色。
 *  没有图时返回 false —— 未知一律按"未接线"，宁可显示中性白也不假装有类型。 */
export function isNodeWired(nodeId: string): boolean {
  if (!activeGraph) return false;
  return activeGraph.editor
    .getConnections()
    .some((c) => c.source === nodeId || c.target === nodeId);
}

/** 当前图是否为项目根（存在 project 节点）；无图/纯旧 kinds → false（?serial= 路径不变）。 */
export function isProjectMode(): boolean {
  return activeGraph
    ? activeGraph.editor.getNodes().some((n) => (n as CylNode).kind === "project")
    : false;
}

/**
 * P2b 项目模式入口（写集 C 调用）：清空现图（含连接）→ 按 planProjectGraph 的纯规划
 * 建 project 根 + 各 tag/hda 成员 channel 节点（param 成员跳过），恢复 saved（项目图
 * 快照 v3）中的位置/连接/viewport；缺失成员（saved 有、当前 members 没有）由 plan 天然
 * 排除。channel 的 1 in/1 out 关联线 v1 纯视觉：compute 由 getNetworkSnapshot 过滤跳过。
 */
export function loadProjectGraph(input: ProjectGraphInput, saved: unknown): void {
  const g = activeGraph;
  if (!g) return;
  const plan = planProjectGraph(input, saved);
  void (async () => {
    // 清空现图（含连接）——与 restoreGraph 相同的重建语义
    for (const c of g.editor.getConnections()) await g.editor.removeConnection(c.id);
    for (const n of g.editor.getNodes()) await g.editor.removeNode(n.id);
    for (const pn of plan.nodes) {
      const n =
        pn.kind === "project"
          ? makeProjectNode(pn.id, pn.label, pn.x, pn.y)
          : pn.channel
            ? makeChannelNode(pn.id, pn.channel, pn.label, pn.x, pn.y)
            : null;
      if (!n) continue;
      await g.editor.addNode(n);
      await g.area.translate(n.id, { x: pn.x, y: pn.y });
    }
    for (const c of plan.connections) {
      const src = g.editor.getNode(c.source) as CylNode | undefined;
      const tgt = g.editor.getNode(c.target) as CylNode | undefined;
      if (!src || !tgt || src.id === tgt.id) continue;
      await g.editor.addConnection(
        new ClassicPreset.Connection(src, c.sourceOutput, tgt, c.targetInput) as unknown as Schemes["Connection"],
      );
    }
    if (plan.viewport && plan.viewport.k) {
      await g.area.area.zoom(plan.viewport.k);
      await g.area.area.translate(plan.viewport.x ?? 0, plan.viewport.y ?? 0);
    }
    channelDisplaySerial = null; // 图重建后旧 serial 已不在图中 → display 重置
    log(`loaded project graph: ${plan.nodes.length} nodes / ${plan.connections.length} connections`);
  })();
}

/** 项目图快照（项目模式含 project/channel → 自动 v3；含层级 → v5）。
 *
 *  **走 serializeGraphFromRoot 而不是 serializeGraph**：在 geo 子网络里保存时，
 *  必须存顶层那张完整的图，否则子图会被当成整个项目图写进槽位、父层凭空消失
 *  （见 serializeGraphFromRoot 的注释——与此前那次真实数据丢失同类）。 */
export function projectGraphSnapshot(): unknown {
  return activeGraph ? serializeGraphFromRoot() : null;
}

// ---------------------------------------------------------------------------
// obj/sop 层级导航（v0.1.00119，task #4）：双击可进入节点 -> 下沉进其 children 子图。
//
// **子图存在哪里**：父节点的 `children` 字段（内联，graph-model 已定义）。进入时把
// 当前图 serializeGraph() 后写回父节点的 children，再清图恢复子图；退出时反向做一遍。
// 于是"子网络"始终只是父图的一部分，跟着同一份 graph.json 往返——无新增协议面、
// 无每层一个文件（用户明确要求不要为此浪费 token）。
//
// **为什么用栈而不是"路径 -> 图"的查找**：每一层的图内容只在**离开它时**才被写回上一层，
// 期间活的那份是编辑器本身。栈记住"回去的路"（父节点 id + 它所在的那张图），退出时
// 沿栈顶把编辑器内容塞回去即可，无需在任何时刻维护整棵树的副本。
// ---------------------------------------------------------------------------

/** 层级栈的一帧：进入某节点时记住"从哪来"。 */
interface NetFrame {
  /** 被进入的那个节点的 id（退出时把当前图写回它的 children）。 */
  nodeId: string;
  /** 该节点的标签（地址栏 net path 用；进入后节点已不在图中，只能预先记下）。 */
  label: string;
  /** 进入前那一层的完整图快照（退出时 restoreGraph 回去）。 */
  parentGraph: unknown;
}

/** 当前所处层级栈（空 = 顶层/项目根，即 obj 层）。 */
let netStack: NetFrame[] = [];

/** net path 变化回调（main.ts 注册 → 刷新地址栏）；在图**已经换完**之后触发。 */
let netPathChangedCb: (() => void) | null = null;
export function setNetPathChangedHandler(fn: (() => void) | null): void {
  netPathChangedCb = fn;
}

/**
 * **从根序列化**：把当前图折进层级栈，得到顶层那张完整的图。
 *
 * 为什么必须有这个（v0.1.00119 修的真 bug）：`serializeGraph` 只认**当前那一层**。
 * 而 `exitNode` 只在用户真的往上走时才把 children 写回父图。于是在子网络里按 Ctrl+S
 * （或触发自动保存）会把**子图当成整个场景**存下去，父层内容凭空消失——
 * 与本项目此前「成员图覆盖项目根」那次真实数据丢失是同一类事故，所以这里不留
 * 「先退到顶层再存」这种要求用户配合的方案，而是保存路径自己折叠。
 *
 * 折叠方向是**从最深处往外**：当前图写进最近一层父图的 children，那张父图再写进它
 * 上一层的 children，直到顶层。栈本身**不被修改**（保存不该改变用户所处的层级），
 * 所以对每一帧的 parentGraph 做浅层克隆后再改写 children。
 *
 * 顶层（栈为空）时退化成 `serializeGraph`，输出与改造前逐字一致。
 */
export function serializeGraphFromRoot(): unknown {
  const g = activeGraph;
  if (!g) return null;
  let folded = serializeGraph(g.editor, g.area);
  for (let i = netStack.length - 1; i >= 0; i--) {
    const frame = netStack[i];
    // 浅克隆到 nodes 数组与被改写的那个节点：其余键/节点保持同一引用，避免深拷大图。
    const parent = frame.parentGraph as { nodes?: Array<{ id: string }> } | null;
    if (!parent || !Array.isArray(parent.nodes)) return folded; // 形状意外：给出已折叠的部分，不崩
    const nodes = parent.nodes.map((n) =>
      n.id === frame.nodeId ? { ...n, children: folded } : n,
    );
    folded = { ...parent, nodes };
  }
  return folded;
}

/** 当前层级路径（节点标签栈，如 `["geo1","geo2"]`）；顶层 → `[]`。 */
export function getNetPath(): string[] {
  return netStack.map((f) => f.label);
}

/** 当前层级：深度 0 = obj（项目根/顶层），进入任何可进入节点之后 = sop。 */
export function getCurrentNetKind(): NetKind {
  return netStack.length === 0 ? "obj" : "sop";
}

/** 空子图标记：**不是** null。null 会让 restoreGraph 直接 return（图纹丝不动），
 *  而"进入一个还没建东西的 geo"必须看到一张**空图**，不是父图的残留。 */
function emptyChildGraph(): unknown {
  return { schemaVersion: HIER_GRAPH_SCHEMA, viewport: { k: 1, x: 0, y: 0 }, nodes: [], connections: [] };
}

/**
 * 进入某节点的子网络（双击 / 地址栏导航）。返回是否真的进入了。
 *
 * 顺序是关键：**先**序列化当前图 + 写回父节点 children，**再**清图恢复子图。反过来
 * 做会把父图内容丢掉（清图之后就没得序列化了）。
 */
export function enterNode(nodeId: string): boolean {
  const g = activeGraph;
  if (!g) return false;
  const node = g.editor.getNode(nodeId) as CylNode | undefined;
  if (!node) {
    log(`enter rejected: node ${nodeId} not found`);
    return false;
  }
  if (!isEnterableKind(node.kind)) {
    log(`enter rejected: ${node.kind} node ${node.label} is not enterable`);
    return false;
  }
  const label = node.label;
  // 子图：节点上没有 children（第一次进入）→ 空图，而不是默认 _input_/_output_ 对。
  const child = node.children != null ? node.children : emptyChildGraph();
  // parentGraph 快照里那个父节点仍带着**旧的** children；退出时由 exitNode 覆盖成子图的
  // 最新状态。所以活节点的 children 在进入时无需改动（改了也会被清图丢掉）。
  const parentGraph = serializeGraph(g.editor, g.area);
  void (async () => {
    netStack.push({ nodeId, label, parentGraph });
    await restoreGraph(g.editor, g.area, child);
    log(`entered ${label} (depth ${netStack.length}, net=${getCurrentNetKind()})`);
    netPathChangedCb?.();
  })();
  return true;
}

/**
 * 退出一层（回到父网络）。返回是否真的退出了（已在顶层 → false）。
 *
 * 退出时把**当前**图（子网络的最新状态）写进父图快照里那个父节点的 children，然后
 * restoreGraph 回父图——于是子网络的编辑被保住，且父图的其余部分逐字不变。
 */
export function exitNode(): boolean {
  const g = activeGraph;
  if (netStack.length === 0 || !g) return false;
  const frame = netStack[netStack.length - 1];
  const childGraph = serializeGraph(g.editor, g.area);
  netStack.pop();
  void (async () => {
    // 把子图塞回父图快照中对应节点的 children（纯数据改写，父图其余键不动）。
    const parent = frame.parentGraph as { nodes?: Array<{ id: string; children?: unknown }> } | null;
    const host = parent?.nodes?.find((n) => n.id === frame.nodeId);
    if (host) host.children = childGraph;
    await restoreGraph(g.editor, g.area, frame.parentGraph);
    log(`exited to depth ${netStack.length} (net=${getCurrentNetKind()})`);
    netPathChangedCb?.();
  })();
  return true;
}

// ---------------------------------------------------------------------------
// 引用注册表接线（v0.1.00119，task #7）：改名重写登记过的引用点。
//
// ref-registry.ts 是纯数据 + 纯函数（36 个单测），此前**零调用方**。这里是它唯一的
// 接线点：`_input_`/`_output_` 的 `address` 参数一被写入就登记成一条引用点，改名时
// 沿登记过的引用点重写，并把结果**写回节点的 address 参数/字段**。
//
// **registered-only 是刻意的**（ref-registry.ts 顶部长注释已论证，照 Houdini）：
// 没登记过的文本一个字都不动。所以用户手打进别处的路径不会被"顺手"改掉——那种
// 启发式猜测会在「@P.y>0」这类内容上误伤。
// ---------------------------------------------------------------------------

/** 本模块唯一的引用注册表实例（与 activeGraph 同生命周期：图重建时随之 clear）。 */
const refRegistry = makeRefRegistry();

/** 引用注册表的只读句柄（调试 / 将来的"谁引用了它"面板）。 */
export function getRefRegistry(): RefRegistry {
  return refRegistry;
}

/**
 * 某标签在**当前网络**里的引用路径。
 *
 * 语义：`getNetPath()` + 标签，即「当前网络内的节点标签路径」——与 register 时用的
 * 完全同一个构造，所以登记与重写必然对得上。顶层 → `/geo1`；在 geo1 里 → `/geo1/null1`。
 * 前导 `/` 让 ref-registry 的前缀边界规则（`p === old` 或 `p.startsWith(old + "/")`）
 * 拿到的是一条规整路径，`geo1` 与 `geo10` 因此不会互相误命中。
 */
function refPathOf(label: string): string {
  return `/${[...getNetPath(), label].join("/")}`;
}

/**
 * 登记一个 `_input_`/`_output_` 节点的 address 引用点（setNodeParams 调用）。
 * address 为空 → 注销该引用点（"清空地址"就是"这条依赖不存在了"，留着会让改名
 * 重写一个已经没人用的路径）。
 */
function registerAddressRef(node: CylNode, address: string): void {
  if (address === "") {
    refRegistry.unregister(node.id, "address");
    return;
  }
  refRegistry.register(node.id, "address", address);
}

/**
 * 改名后重写引用：算出旧/新引用路径 → rewriteOnRename → 把每条变化**落回节点**。
 *
 * 落回是关键的一半：注册表只改自己表里的字符串，节点上的 `address` 参数/字段才是
 * 序列化与桥侧解析读的东西，两者必须同时更新。
 */
function rewriteRefsForRename(editor: NodeEditor<Schemes>, oldLabel: string, newLabel: string): void {
  const oldPath = refPathOf(oldLabel);
  const newPath = refPathOf(newLabel);
  const result = refRegistry.rewriteOnRename(oldPath, newPath);
  if (result.rewritten === 0) return;
  for (const c of result.audit.changes) {
    const n = editor.getNode(c.nodeId) as CylNode | undefined;
    if (!n) continue;
    if (c.field === "address") {
      n.address = c.to;
      const p = n.params?.find((x) => x.name === "address");
      if (p) p.value = c.to;
    }
  }
  log(`rename ${oldPath} -> ${newPath}: rewrote ${result.rewritten} registered ref(s)`);
}

// ---------------------------------------------------------------------------
// P5b 通道引用绑定 API（写集 A：节点绑定模型）：读写节点 bindings 的薄壳。
// 数据层逻辑在 graph-model（nodeParamBindingsView / listNodeParamBindingsView /
// applyNodeBindings——纯函数，无 DOM，可直接单测）；这里绑到当前图句柄 activeGraph。
// 绑定不触发 network.run；持久化走既有 serializeGraph 快照机制（autosave / 显式保存
// 自动携带 bindings 键）。main.ts 的 Param 面板经 getNodeParamBindings 拉取绑定。
// ---------------------------------------------------------------------------

/** 单节点绑定视图：params（完整 ParamSpec）+ bindings（paramName -> 通道 absolutePath）；
 *  节点不存在或无图 → null。 */
export function getNodeParamBindings(
  id: string,
): { params: ParamSpec[]; bindings: Record<string, string> } | null {
  return activeGraph ? nodeParamBindingsView(activeGraph.editor, id) : null;
}

/** 全部节点绑定视图（id/label/params/bindings）；无图 → []。 */
export function listNodeParamBindings(): {
  id: string;
  label: string;
  params: ParamSpec[];
  bindings: Record<string, string>;
}[] {
  return activeGraph ? listNodeParamBindingsView(activeGraph.editor) : [];
}

/** 更新节点 bindings（清空 = 传 {}，内部删除空键 → 序列化无该键，字节级兼容）；
 *  不触发 network.run；序列化快照保存走既有机制（store 变化防抖 / autosave）。 */
export function setNodeBindings(id: string, bindings: Record<string, string>): void {
  if (activeGraph) applyNodeBindings(activeGraph.editor, id, bindings);
}

// ---------------------------------------------------------------------------
// 节点错误系统薄壳（数据层逻辑在 graph-model 的 applyNodeErrors/nodeErrorsOf）
// ---------------------------------------------------------------------------

/**
 * 全量覆盖节点错误；返回是否真的有变化。
 *
 * churn 门闩：applyNodeErrors 逐节点比对错误指纹，**只有**真的变了才
 * notifyNodeChanged()（NodeView 全量重渲染的唯一入口）。于是每秒一次的 cook 只要
 * 错误集合不变就是零重渲染；错误刚出现/刚修好/文案变了才刷一次。
 * 错误是运行期态：不触发 onNetworkChanged、不入快照、不入 undo。
 */
export function setNodeErrors(errors: NodeErrorMap): boolean {
  if (!activeGraph) return false;
  const changed = applyNodeErrors(activeGraph.editor, errors);
  if (changed) notifyNodeChanged();
  return changed;
}

/** 读某节点错误的只读拷贝（无图 / 节点不存在 / 无错误 → []）。 */
export function getNodeErrors(id: string): NodeError[] {
  return activeGraph ? nodeErrorsOf(activeGraph.editor, id) : [];
}

/** Connection ids on the display node's upstream in0 chain (input -> ... -> display),
 *  following null/transform/dot passthrough edges. Used by the runtime-flow
 *  animation so only the wires that actually cooked light up. */
function displayChainConnectionIds(editor: NodeEditor<Schemes>): string[] {
  const disp = editor.getNodes().find((n) => (n as CylNode).flags.display) as CylNode | undefined;
  if (!disp) return [];
  const ids: string[] = [];
  const visited = new Set<string>();
  let cur: CylNode | undefined = disp;
  while (cur && !visited.has(cur.id)) {
    const node = cur; // narrowed CylNode (stable across the closure below)
    visited.add(node.id);
    if (node.kind === "input") break; // reached the source; no further upstream
    const conn = editor.getConnections().find(
      (c) => c.target === node.id && c.targetInput === "in0",
    ) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
    if (!conn) break;
    ids.push(conn.id);
    cur = editor.getNode(conn.source) as CylNode | undefined;
  }
  return ids;
}

/** createReteGraph 的可选开关。 */
export interface CreateReteGraphOptions {
  /**
   * 建图时是否**不**创建默认 `_input_`/`_output_` 对。
   *
   * 缺省 undefined = 自动判定（`wantsEmptyRootGraph()`，读启动 URL 的 `?project=`）。
   * 显式传值可覆盖自动判定——测试与将来的多图场景需要一个不依赖全局 URL 的入口。
   */
  emptyRootGraph?: boolean;
}

/**
 * 本次启动是否是项目根（→ 空图）。判据 = 启动 URL 带 `?project=P1-…`，即 main.ts
 * 文件末尾 boot 分流用的**同一个**信号（那里：`qs` 优先 → serial 模式；否则 `qp` 命中
 * PROJECT_SERIAL_RE → enterProjectMode）。这里不 import main.ts 的常量（会成环），
 * 只做同形状的宽松校验：非空且以 `P1-` 开头即算项目根。
 *
 * 非浏览器环境（vitest 的 node 环境 / SSR）无 location → false，即保留默认对：
 * 单测与 e2e 的既有形状因此逐字不变。
 */
function wantsEmptyRootGraph(): boolean {
  try {
    if (typeof location === "undefined" || !location.search) return false;
    const p = new URLSearchParams(location.search).get("project");
    return !!p && p.startsWith("P1-");
  } catch {
    return false; // location 存在但不可读（异常沙箱）→ 保守走旧行为
  }
}

async function buildGraph(
  container: HTMLElement,
  handlers: ReteGraphHandlers,
  opts: CreateReteGraphOptions = {},
) {
  const editor = new NodeEditor<Schemes>();
  // No self-connections allowed: veto any connectioncreate whose source ===
  // target (covers drag-created / restored / inserted / healed connections in
  // one place - addConnection() returns false when the signal chain stops).
  // Topology version (viewport realtime P1): bumped on ANY connection/node
  // add/remove so the network runner can tell whether store.outputs still match
  // the LIVE graph. flush() only reuses the already-computed output buffer for a
  // displayed null/transform when outputs were cooked for the CURRENT topology
  // (otherwise it falls back to computeNodeResult - always correct, no extra cook).
  // Topology cook (P2): after a connection/node is added or removed (the rete
  // AFTER events), re-run the network so outputs always reflect the live graph.
  // `ready` guards the initial buildGraph phase (input/output + 4 default
  // connections); restoreGraph/undo replays are async loops of awaits, so the
  // setTimeout(0) fires only after the current macrotask AND all its microtasks
  // drain - the cook lands on the FINAL topology, never half a graph.
  const cookState = { ready: false, scheduled: false };
  const scheduleTopologyCook = (): void => {
    if (!cookState.ready || cookState.scheduled) return;
    cookState.scheduled = true;
    setTimeout(() => {
      cookState.scheduled = false;
      handlers.onNetworkChanged?.();
    }, 0);
  };
  let graphVersion = 0;
  (editor as unknown as {
    addPipe(
      mw: (ctx: {
        type: string;
        data?: { id?: string; source?: string; sourceOutput?: string; target?: string };
      }) => unknown,
    ): void;
  }).addPipe((ctx) => {
    if (ctx.type === "connectioncreate") {
      const data = ctx.data;
      if (data && data.source && data.source === data.target) {
        const s = (editor.getNode(data.source) as CylNode | undefined)?.label ?? data.source;
        log(`blocked self-connection on ${s} (source === target)`);
        return undefined;
      }
    }
    if (ctx.type === "connectioncreate" || ctx.type === "connectionremove" || ctx.type === "nodecreate" || ctx.type === "noderemove") {
      graphVersion += 1;
    }
    // 按数据类型着色：所有连线创建路径（拖拽 / 插入 / 重连 / restoreGraph / undo 重放）
    // 都经过这里，因此只在这一处上色。
    if (ctx.type === "connectioncreated") {
      const d = ctx.data as { id?: string; source?: string; sourceOutput?: string } | undefined;
      if (d?.id && d.source && d.sourceOutput) {
        applyConnectionTypeVisual(area, d.id, socketNameOf(editor, d.source, "output", d.sourceOutput));
      }
    }
    if (ctx.type === "connectioncreated" || ctx.type === "connectionremoved" || ctx.type === "nodecreated" || ctx.type === "noderemoved") {
      scheduleTopologyCook();
    }
    return ctx;
  });
  const area = new AreaPlugin<Schemes, AreaExtra>(container);
  // Task 1: rete's AreaPlugin installs a default Drag handler that pans the whole
  // network on ANY-pointer (incl. LMB) drag over the background. Disable it so LMB
  // blank-drag only drives rect-select. MMB pan (attachMMBPan) and wheel zoom (the
  // separate Zoom handler) are unaffected; node dragging uses each NodeView's own
  // Drag handler and keeps working.
  area.area.setDragHandler(null);
  // 同理移除 rete 的另一个默认交互：Zoom 类自带 dblclick 处理器，双击背景/节点会
  // 直接 onzoom(..., 'dblclick') 缩放视图。任务 #4 要把双击定义为「进入节点」，
  // 双击同时缩放会让视图跳一下，手感全毁。zoom 是**可取消**的 guard 管道事件，
  // 且 ZoomEventParams 带 source，于是只拦 source === "dblclick"：
  // 滚轮缩放（source === "wheel"）与程序化的 AreaExtensions.zoomAt（走
  // area.area.zoom(k, 0, 0)，不带 source）都照旧放行。
  area.addPipe((ctx) => {
    if (ctx.type === "zoom" && (ctx.data as { source?: string }).source === "dblclick") {
      return undefined;
    }
    return ctx;
  });
  const connection = new ConnectionPlugin<Schemes, AreaExtra>();
  const engine = new DataflowEngine<DataflowEngineScheme>();
  const react = new ReactPlugin<Schemes, AreaExtra>({ createRoot });

  // 类型校验连线预设（替换 ConnectionPresets.classic.setup()——那个来者不拒）。
  // rete-connection-plugin 的钩子名是 canMakeConnection(from, to)（见
  // _types/flow/builtin/classic/index.d.ts 的 ClassicParams）。默认实现只校验方向
  // （output → input，getSourceTarget），这里在其之上叠加**类型相等**校验：
  // 源输出端口类型 === 目标输入端口类型才放行，否则走既有 log 通道报明原因并拒绝。
  connection.addPreset(
    () =>
      new ClassicFlow({
        canMakeConnection: (from: SocketData, to: SocketData) => {
          // 方向：始终 output 端为源、input 端为目标（反向拖拽也支持）
          const [src, tgt] =
            from.side === "output" && to.side === "input"
              ? [from, to]
              : from.side === "input" && to.side === "output"
                ? [to, from]
                : [null, null];
          if (!src || !tgt) return false; // 同侧连线：默认预设同样拒绝
          const srcType = socketNameOf(editor, src.nodeId, "output", src.key);
          const tgtType = socketNameOf(editor, tgt.nodeId, "input", tgt.key);
          if (!canConnectSockets(srcType, tgtType)) {
            const s = (editor.getNode(src.nodeId) as CylNode | undefined)?.label ?? src.nodeId;
            const t = (editor.getNode(tgt.nodeId) as CylNode | undefined)?.label ?? tgt.nodeId;
            log(
              `blocked connection ${s}.${src.key}(${srcType || "?"}) -> ${t}.${tgt.key}(${tgtType || "?"}): socket type mismatch`,
            );
            return false;
          }
          return true;
        },
      }),
  );
  react.addPreset(
    Presets.classic.setup({
      customize: {
        node: (d) => (props) => React.createElement(NodeView, { data: d.payload, emit: props.emit }),
        // 自绘连线：只为把连接上的 waypoint（路径中点装饰件）画出来，
        // 自带 Connection 的 path 写死两点、塞不进中点。DOM 契约见 ConnectionView.tsx。
        connection: () => ConnectionView,
      },
    }),
  );
  AreaExtensions.simpleNodesOrder(area);
  const selectable = AreaExtensions.selectableNodes(area, AreaExtensions.selector(), { accumulating: AreaExtensions.accumulateOnCtrl() });

  // rete 2 plugin hierarchy: editor.use(area) + area.use(render/connection); engine on editor.
  (editor as unknown as { use(p: unknown): void }).use(area);
  (area as unknown as { use(p: unknown): void }).use(react);
  (area as unknown as { use(p: unknown): void }).use(connection);
  (editor as unknown as { use(p: unknown): void }).use(engine);

  // 默认 _input_/_output_ 对：**只在非项目根路径建**（v0.1.00119，task #6）。
  //
  // 为什么条件是"启动 URL 有没有 ?project="（见 wantsEmptyRootGraph）：`buildGraph` 跑在
  // `?project=` 被读取**之前**（main.ts 先 await createReteGraph、再在文件末尾分流 boot），
  // 所以此刻 `isProjectMode()` 必然是 false（图里还没有 project 节点、activeGraph 也没注册），
  // 拿它做判据永远只会得到"非项目"。而 main.ts 用来分流的 `?project=` 早就在 location 里了，
  // 于是直接读同一个信号——两处判据同源，不可能不一致。
  //
  // 保留默认对的路径（一个都不能少）：`?serial=` 单 serial 场景、无参启动、jsdom 单测与
  // 全部 e2e（round18-reconnect / waypoint-verify 等都走 `?serial=`）。项目根则落地成
  // 一张空图，用户自己建 geo 再进去拿 sop —— 这就是用户要的行为。
  const emptyRoot = opts.emptyRootGraph ?? wantsEmptyRootGraph();
  let input: CylNode | null = null;
  let output: CylNode | null = null;
  if (!emptyRoot) {
    // 新建图用 schema 4 单端口形态（1 端口 + address/type）；旧图恢复仍走 4 端口。
    input = makeInputNode(true);
    output = makeOutputNode(true);
    input.flags.display = true; // default Houdini display = input_ (shows source curves)
    await editor.addNode(input);
    await editor.addNode(output);
    await area.translate(input.id, { x: 24, y: 40 });
    await area.translate(output.id, { x: 420, y: 40 });

    // 单端口形态（schema 4）：默认只连 in0 -> out0。其余输出端口无连线时，
    // computeOutputs 仍按既有语义回退 passthrough input_i，4 路输出行为不变。
    await editor.addConnection(
      new ClassicPreset.Connection(input, "in0", output, "out0") as unknown as Schemes["Connection"],
    );
    void AreaExtensions.zoomAt(area, editor.getNodes());
  } else {
    log("project root graph: starting empty (create a geo node and enter it for sop)");
  }

  // --- node pick -> viewport linkage (capture phase: rete drag stops bubbling)
  container.addEventListener(
    "pointerdown",
    (ev) => {
      const target = ev.target as Element;
      const hit = nodeFromTarget(editor, area, target);
      if (hit) {
        const idx = portIndexFromTarget(target);
        handlers.onNodePick?.(hit.node.kind, idx, hit.id);
      }
      // Selection is applied asynchronously by rete (nodepicked -> selectable pipe),
      // so notify AFTER this event task (setTimeout 0) - otherwise panels read the
      // stale selection. Also fires for blank clicks (deselect) and chip/port clicks.
      // notifySelection drives the graph-level subscription (main.ts); the handlers
      // callback is kept for the alternate API.
      window.setTimeout(() => {
        handlers.onSelectionChanged?.();
        notifySelection();
      }, 0);
    },
    true,
  );

  return { editor, area, engine, input, output, react, selectable, connection, cookState, getGraphVersion: () => graphVersion };
}

/** Create the graph; returns a handle with UI helpers. */
export async function createReteGraph(
  container: HTMLElement,
  handlers: ReteGraphHandlers = {},
  opts: CreateReteGraphOptions = {},
): Promise<ReteGraph> {
  const g = await buildGraph(container, handlers, opts);
  activeGraph = { editor: g.editor, area: g.area }; // P2b：项目模式无参入口需要图句柄
  netStack = []; // 新图 = 回到顶层（obj 层）：旧图的层级栈必须清掉，否则地址栏会残留

  // Param undo/redo wiring lives in graph-undo: it applies actions through the
  // chained topology replay and fires onNetworkChanged / onSelectionChanged /
  // onParamsApplied once at the end of a params edit.
  const undoManager = createGraphUndoManager(g.editor, handlers, g.area);

  attachTabSearch(g.editor, g.area, container);
  attachCutMode(g.editor, g.area, container, handlers, undoManager);
  attachFlagMenu(g.editor, g.area, container, (n) => handlers.onFlagsChanged?.(n.kind, { ...n.flags }));
  attachMMBPan(g.area, container);
  attachDotGrid(g.area, container);
  initTooltip(container);
  attachInsertion(g.editor, g.area, container, handlers, undoManager);
  attachReconnect(g.editor, g.area, container, handlers, undoManager);
  attachRectSelect(g.editor, g.area, container, g.selectable);
  attachShakeDisconnect(g.editor, g.area, container, handlers, undoManager);
  attachConnectionSelect(g.area, container);
  // 层级导航（v0.1.00119）：双击可进入节点 -> enterNode；Tab 面板按当前层过滤。
  // attachEnterNode 只在这里挂一次，层级变化经 provider 回调读取（而非重挂监听器）。
  attachEnterNode(g.editor, g.area, container);
  setEnterNodeHandler((nodeId) => enterNode(nodeId));
  setNetKindProvider(() => getCurrentNetKind());

  // Ctrl/Cmd+Z = undo, Ctrl+Shift+Z / Ctrl+Y = redo (skip while typing).
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    if (k === "z") {
      e.preventDefault();
      if (e.shiftKey) undoManager.redo();
      else undoManager.undo();
    } else if (k === "y") {
      e.preventDefault();
      undoManager.redo();
    }
  });

  // Escape cancels in-flight graph gestures: rete connection draw (drop() is a
  // no-op when nothing is being drawn), reconnect grab / drag-insert / palette
  // (registered by graph-interact). Rename/palette inputs keep their own Esc.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
    (g.connection as unknown as { drop(): void }).drop();
    cancelGraphInteractions();
  });

  // Delete / Backspace removes every selected node + its connections (no undo in
  // v1; devlog notes it as future work). Skipped while typing in an input.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const el = document.activeElement;
    // skip while typing in a visible input (rename / palette search / params)
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.getClientRects().length > 0) return;
    }
    const selected = (g.editor.getNodes() as CylNode[]).filter((n) => (n as ClassicPreset.Node).selected);
    if (selected.length === 0) return;
    e.preventDefault();
    void (async () => {
      for (const n of selected) {
        const touching = g.editor.getConnections().filter((c) => c.source === n.id || c.target === n.id);
        for (const c of touching) {
          const s = (g.editor.getNode(c.source) as CylNode | undefined)?.label ?? c.source;
          const t = (g.editor.getNode(c.target) as CylNode | undefined)?.label ?? c.target;
          log(`delete removed connection ${c.id} (${s} -> ${t})`);
          await g.editor.removeConnection(c.id);
        }
        log(`delete removed node ${n.label} (${n.kind})`);
        await g.editor.removeNode(n.id);
      }
      handlers.onNetworkChanged?.();
      window.setTimeout(() => {
        handlers.onSelectionChanged?.();
        notifySelection();
      }, 0);
    })();
  });

  // Houdini display semantics: only ONE node per network may be displayed.
  // Clicking a node's display chip clears all others and lights this one.
  setNodeStateHandler((nodeId, key) => {
    if (key === "display") return; // display handled by setDisplayHandler (uniqueness)
    const n = g.editor.getNode(nodeId) as CylNode | undefined;
    if (!n) return;
    n.flags = { ...n.flags, [key]: !n.flags[key] };
    notifyNodeChanged();
    log(`node ${n.kind} ${key}=${n.flags[key]}`);
    handlers.onFlagsChanged?.(n.kind, { ...n.flags });
  });
  setDisplayHandler((nodeId) => {
    const n = g.editor.getNode(nodeId) as CylNode | undefined;
    if (!n) return;
    // P2b 项目模式节点：project 不可 display（白名单拒绝）；channel 走独立 display 状态机
    if (n.kind === "project") {
      log(`display rejected: project node ${n.label} has no display`);
      return;
    }
    if (n.kind === "channel") {
      const serial = n.channel?.serial ?? null;
      if (!serial) {
        log(`display rejected: channel node ${n.label} has no serial`);
        return;
      }
      // channel 之间 display 唯一：同一时刻仅一个 channel 亮（模块态 channelDisplaySerial），
      // 与旧 kinds 的 display 状态机完全隔离（不碰 flags.display，不污染旧行为）；
      // 点亮态变更时 notifyNodeChanged 让 React 层重渲染 chip，并回调激活（写集 C）。
      if (channelDisplaySerial !== serial) {
        channelDisplaySerial = serial;
        notifyNodeChanged();
        log(`channel display -> ${serial}`);
      }
      channelDisplayCb?.(serial); // 幂等激活：点击已亮 channel 再触发一次无副作用
      return;
    }
    // 旧 kinds：现有「每网络唯一 display」状态机原样——只扫旧 kinds，绝不触碰 project/channel
    let changed: CylNode[] = [];
    for (const x of g.editor.getNodes() as CylNode[]) {
      if (x.kind === "project" || x.kind === "channel") continue;
      const want = x.id === nodeId;
      if (x.flags.display !== want) {
        x.flags.display = want;
        changed.push(x);
      }
    }
    if (changed.length > 0) {
      notifyNodeChanged(); // React-state re-render (rete render signal is unreliable here)
      const lit = g.editor.getNodes().find((x) => (x as CylNode).flags.display) as CylNode | undefined;
      log(`display -> ${lit ? lit.kind : "none"}`);
      handlers.onFlagsChanged?.(lit?.kind ?? "null", lit ? { ...lit.flags } : { ...DEFAULT_FLAGS });
    }
  });

  // Ultimate suffix dedup after rename: the label must be unique across ALL nodes.
  setRenameHandler((nodeId, desired) => {
    const self = g.editor.getNode(nodeId) as CylNode | undefined;
    if (!self) return desired;
    // 只拒 project（v0.1.00119，task #7）：项目名在 overview 里改，图上改一个"项目根标签"
    // 既不会回写项目、又会让地址栏与项目名不符。
    //
    // channel **不再**在这里拒：它本来也到不了这条路——NodeView 给 project/channel 各写了
    // 一条提前 return 的渲染分支，那里的标题 span 根本没挂 onPointerDownCapture /
    // onDoubleClick（对比普通节点分支），所以 UI 上无从触发改名。留着这条拒绝只会让
    // 「改名被谁拒了」有两个答案。真正需要改名的 geo 与 sop 节点从此一律放行。
    if (self.kind === "project") {
      log(`rename rejected: project node labels are edited in the overview, not the graph`);
      return self.label;
    }
    const used = new Set(
      (g.editor.getNodes() as CylNode[]).filter((n) => n.id !== nodeId).map((n) => n.label),
    );
    let final = desired;
    for (let i = 1; used.has(final); i++) final = `${desired}${i}`;
    const oldLabel = self.label;
    self.label = final; // baseLabel keeps the original base (null nodes stay "null")
    // 改名后重写**登记过的**引用点（task #7）。放在 label 落地之后：refPathOf 读的是
    // 「当前网络路径 + 标签」，两者必须已经是新值。
    if (final !== oldLabel) rewriteRefsForRename(g.editor, oldLabel, final);
    notifyNodeChanged();
    return final;
  });

  // P2: all wiring (attach*/keydown/display/rename) is registered above; topology
  // changes from here on (drag-connect / Tab-create / restoreGraph / undo replay)
  // must trigger a deferred cook via the pipe's after events.
  g.cookState.ready = true;

  // --- connection bypass (B key) + runtime-flow animation (network timing) ---
  // Bypass is a pure visual + persisted marker (serializeGraph); it never affects
  // compute semantics. Runtime timers are keyed by connection id so a repeat
  // trigger clears the previous timer instead of stacking.
  const runtimeTimers = new Map<string, number>();
  const setConnectionBypass = (id: string, on: boolean): void => {
    const conn = g.editor.getConnection(id);
    if (!conn) return;
    setConnectionBypassFlag(conn, on);
    applyConnectionBypassVisual(g.area, id, on);
    log(`wire ${id} bypass=${on}`);
  };
  const toggleSelectedConnectionBypass = (): boolean => {
    const id = getSelectedConnectionId();
    if (!id) return false;
    const conn = g.editor.getConnection(id);
    if (!conn) {
      clearConnectionSelection(g.area); // stale selected id (wire removed)
      return false;
    }
    setConnectionBypass(id, !getConnectionBypass(conn));
    return true;
  };
  const markRuntimeActivity = (ms: number): void => {
    if (ms < 120) return; // skip fast cooks to avoid flashing
    const duration = Math.min(ms, 2000);
    for (const id of displayChainConnectionIds(g.editor)) {
      const path = g.area.connectionViews.get(id)?.element.querySelector("path");
      if (!path) continue;
      const old = runtimeTimers.get(id);
      if (old !== undefined) window.clearTimeout(old);
      path.classList.add("cyl-wire-runtime");
      const timer = window.setTimeout(() => {
        runtimeTimers.delete(id);
        path.classList.remove("cyl-wire-runtime");
      }, duration);
      runtimeTimers.set(id, timer);
    }
  };

  return {
    editor: g.editor,
    area: g.area,
    engine: g.engine,
    undo: () => undoManager.undo(),
    redo: () => undoManager.redo(),
    pushUndo: (action: UndoAction) => {
      undoManager.push(action);
    },
    pushUndoGroup: (actions: UndoAction[]) => {
      if (actions.length === 0) return;
      undoManager.push({ type: "group", actions });
    },
    destroy: () => {
      activeGraph = null; // P2b：图销毁后无参入口失效（单图场景）
      channelDisplaySerial = null;
      (g.editor as unknown as { destroy?: () => void }).destroy?.();
    },
    setStats: (kind, stats) => {
      const n = nodeByKind(g.editor, kind);
      if (!n) return;
      n.stats = stats;
      notifyNodeChanged();
    },
    getFlags: (kind) => {
      const n = nodeByKind(g.editor, kind);
      return n ? { ...n.flags } : undefined;
    },
    setFlag: (kind, key, value) => {
      const n = nodeByKind(g.editor, kind);
      if (!n) return undefined;
      n.flags = { ...n.flags, [key]: value };
      notifyNodeChanged();
      return { ...n.flags };
    },
    getDisplayNode: () => {
      const n = g.editor.getNodes().find((x) => (x as CylNode).flags.display) as CylNode | undefined;
      return n ? { kind: n.kind, flags: { ...n.flags } } : null;
    },
    getDisplayPortIndex: () => {
      const disp = g.editor.getNodes().find((x) => (x as CylNode).flags.display) as CylNode | undefined;
      if (!disp || (disp.kind !== "null" && disp.kind !== "transform")) return null;
      return resolveInputSourcePort(g.editor, disp.id);
    },
    getSelectedNode: () => {
      const sel = (g.editor.getNodes() as CylNode[]).find((n) => (n as ClassicPreset.Node).selected);
      if (!sel) return null;
      // project/channel 也要返回（v0.1.00117 修）：此前返回 null，导致在项目根里选中
      // 节点时面板拿不到选中项、只能沿用 display flag 的内容——用户看到的就是
      // 「根目录下面板跟着 display 变而不是跟着选中变」。它们确实没有 params，
      // 但「无参数」是**面板该渲染的事实**，不是「不该刷新」的理由。
      // 进入 sop 层后本就没这个问题（那里没有 project/channel 节点）。
      let port: number | null = null;
      if (sel.kind === "null" || sel.kind === "transform") port = resolveInputSourcePort(g.editor, sel.id);
      return { kind: sel.kind, id: sel.id, label: sel.label, port, params: sel.params ?? [] };
    },
    onSelectionChanged: (cb) => onSelectionChange(cb),
    frameSelection: () => {
      const all = g.editor.getNodes();
      const selected = all.filter((n) => (n as ClassicPreset.Node).selected);
      const target = selected.length > 0 ? selected : all;
      if (target.length > 0) void AreaExtensions.zoomAt(g.area, target);
      store.pushLog(`[node] frame ${selected.length > 0 ? `${selected.length} selected` : "all"} nodes`);
    },
    // 从根折叠：在子网络里保存也必须存顶层完整图（见 serializeGraphFromRoot）。
    // 顶层时它退化成 serializeGraph，旧行为逐字不变。
    serializeGraph: () => serializeGraphFromRoot(),
    restoreGraph: (data) => restoreGraph(g.editor, g.area, data),
    // P2b 项目模式（写集 C 经 ReteGraph 调用；模块级导出同实现）
    loadProjectGraph: (input, saved) => loadProjectGraph(input, saved),
    projectGraphSnapshot: () => projectGraphSnapshot(),
    setChannelDisplayHandler: (fn) => setChannelDisplayHandler(fn),
    isProjectMode: () => isProjectMode(),
    getGraphVersion: () => g.getGraphVersion(),
    getNetworkSnapshot: () => getNetworkSnapshot(g.editor),
    setNodeParams: (nodeId, params) => {
      const n = g.editor.getNode(nodeId) as CylNode | undefined;
      if (!n) return false;
      n.params = params;
      if (n.kind === "input" || n.kind === "output") {
        // address 参数 -> address 字段（序列化读字段）；type 参数 -> 端口 socket 类型。
        const addr = params.find((p) => p.name === "address")?.value;
        const address = typeof addr === "string" ? addr : "";
        if (address !== "") n.address = address;
        else delete n.address;
        // task #7：address 一被写入就登记成引用点（空 → 注销）。改名时只重写登记过的。
        registerAddressRef(n, address);
        // ------------------------------------------------------------------
        // task #8：端口类型的**唯一真源是映射系统**，手打的 type 参数只作回退。
        //
        // 为什么写回 type 参数而不是另开一条通路：`syncPortSocketType` 读的就是 type
        // 参数（nodeSocketType），而它同时也是序列化与参数面板显示的那一份。把解析
        // 结果落到同一个字段 = 一处真值，端口/快照/面板三者不可能再互相打脸；而下面
        // 那段"类型变了就拆掉非法连线"的既有逻辑也就原样复用，无需重写。
        //
        // `resolveAddressType` 返回 null 有两义（表里没有 / 缓存未加载，见 mapping-types.ts
        // 的三态诚实注释），两者都**保持当前类型不变**——绝不静默回落到 geo。地址无效
        // 的红三角由错误系统（mappingAddressErrors → setNodeErrors）负责，不是这里。
        // ------------------------------------------------------------------
        if (address !== "") {
          const resolved = resolveAddressType(address);
          if (resolved !== null) {
            const tp = n.params?.find((p) => p.name === "type");
            if (tp && tp.value !== resolved) {
              log(`port type of ${n.label} <- mapping system: ${String(tp.value)} -> ${resolved} (${address})`);
              tp.value = resolved;
            }
          }
        }
        if (syncPortSocketType(n)) {
          // 端口类型变了：既有连线可能已非法（类型不再相等）→ 拆掉并报明，避免留下
          // 校验放不过、compute 又当真的脏连线。
          void (async () => {
            const side = n.kind === "input" ? "source" : "target";
            const stale = g.editor
              .getConnections()
              .filter((c) => (side === "source" ? c.source === n.id : c.target === n.id))
              .filter(
                (c) =>
                  !canConnectSockets(
                    socketNameOf(g.editor, c.source, "output", c.sourceOutput),
                    socketNameOf(g.editor, c.target, "input", c.targetInput),
                  ),
              );
            for (const c of stale) {
              log(`removed connection ${c.id} on ${n.label}: socket type changed`);
              await g.editor.removeConnection(c.id);
            }
          })();
        }
      }
      notifyNodeChanged();
      return true;
    },
    // 节点错误系统：绑到**本图**的编辑器（不经模块态 activeGraph，多图场景也正确）。
    setNodeErrors: (errors) => {
      const changed = applyNodeErrors(g.editor, errors);
      if (changed) notifyNodeChanged();
      return changed;
    },
    getNodeErrors: (nodeId) => nodeErrorsOf(g.editor, nodeId),
    toggleSelectedConnectionBypass,
    setConnectionBypass,
    markRuntimeActivity,
  };
}