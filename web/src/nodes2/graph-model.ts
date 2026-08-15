/**
 * Graph domain model (2.2 split): node/connection/selection data structures,
 * node factories, read-only queries, graph (de)serialization and network snapshot.
 * Pure data + area transform; the shell (graph.ts) owns mutations that notify the
 * React NodeView layer (e.g. setNodeParams -> notifyNodeChanged).
 */
import { ClassicPreset, NodeEditor } from "rete";
import { AreaPlugin } from "rete-area-plugin";
import { DataflowEngine, type DataflowEngineScheme } from "rete-engine";
import type { ClassicScheme, ReactArea2D } from "rete-react-plugin";
import { store } from "../stores/workspace";
import type { ChannelRef } from "../protocol/types";
import type { NetworkSnapshot } from "./network";
import type { UndoAction } from "./undo";

export type Schemes = ClassicScheme;
export type AreaExtra = ReactArea2D<Schemes>;

// P2b 项目模式：project（项目根，无端口）+ channel（成员通道，1 in/1 out，compute 忽略——
// v1 关联线纯视觉）。两者只在项目图（schemaVersion 3）中出现；?serial= 单 serial 场景保持旧 kinds。
export type NodeKind = "input" | "output" | "null" | "transform" | "dot" | "project" | "channel";

export interface NodeFlags {
  display: boolean;
  bypass: boolean;
  freeze: boolean;
  reference: boolean;
}

export const DEFAULT_FLAGS: NodeFlags = { display: false, bypass: false, freeze: false, reference: false };

export interface ParamSpec {
  name: string;
  type: string;
  value: unknown;
  default?: unknown;
}

export interface SelectedNodeInfo {
  kind: NodeKind;
  id: string;
  label: string;
  port: number | null;
  params: ParamSpec[];
}

/** P2b 项目模式输入：项目根 serial（P1-…）+ label + 成员通道引用快照。
 *  （graph.ts 的 loadProjectGraph 使用；planProjectGraph 是其纯规划核心。） */
export interface ProjectGraphInput {
  projectSerial: string;
  label: string;
  members: ChannelRef[];
}

export interface ReteGraphHandlers {
  onNodePick?: (kind: NodeKind, port: number | null, nodeId: string) => void;
  onFlagsChanged?: (kind: NodeKind, flags: NodeFlags) => void;
  onSelectionChanged?: () => void;
  onNetworkChanged?: () => void;
  onParamsApplied?: (nodeId: string, params: Array<{ name: string; type: string; value: unknown }>) => void;
}

export interface ReteGraph {
  editor: NodeEditor<Schemes>;
  area: AreaPlugin<Schemes, AreaExtra>;
  engine: DataflowEngine<DataflowEngineScheme>;
  destroy(): void;
  setStats(kind: NodeKind, stats: string): void;
  getFlags(kind: NodeKind): NodeFlags | undefined;
  setFlag(kind: NodeKind, key: keyof NodeFlags, value: boolean): NodeFlags | undefined;
  getDisplayNode(): { kind: NodeKind; flags: NodeFlags } | null;
  getDisplayPortIndex(): number | null;
  getSelectedNode(): SelectedNodeInfo | null;
  onSelectionChanged(cb: () => void): () => void;
  frameSelection(): void;
  serializeGraph(): unknown;
  restoreGraph(data: unknown): Promise<void>;
  /** Bumped on every connection/node add/remove; lets the network runner detect
   *  whether store.outputs were cooked for the CURRENT graph topology. */
  getGraphVersion(): number;
  getNetworkSnapshot(): NetworkSnapshot;
  setNodeParams(nodeId: string, params: ParamSpec[]): boolean;
  /** P2b 项目模式：以项目根 + 成员 channel 节点重建图（saved = 项目图快照 v3）。 */
  loadProjectGraph(input: ProjectGraphInput, saved: unknown): void;
  /** 项目图快照（serializeGraph 的 v3 输出；项目模式下供保存）。 */
  projectGraphSnapshot(): unknown;
  /** channel 节点点 display chip 时回调 fn(serial)（写集 C：激活成员）；null 解除注册。 */
  setChannelDisplayHandler(fn: ((serial: string) => void) | null): void;
  /** 当前图是否为项目根（存在 project 节点）。 */
  isProjectMode(): boolean;
  /** Toggle the bypass visual flag on the currently-selected connection; returns
   *  false when no (live) connection is selected. Pure visual + persisted. */
  toggleSelectedConnectionBypass(): boolean;
  setConnectionBypass(id: string, on: boolean): void;
  /** Start the flowing-dash runtime animation on the display node's upstream chain
   *  for min(ms, 2000) ms (no-op when ms < 120). */
  markRuntimeActivity(ms: number): void;
  undo(): void;
  redo(): void;
  pushUndo(action: UndoAction): void;
  pushUndoGroup(actions: UndoAction[]): void;
}

export const GEO = "geo";

export const log = (m: string): void => {
  store.pushLog(`[node] ${m}`);
};

export const BASE_LABEL: Record<string, string> = { _input_: "_input_", _output_: "_output_", null: "null" };

/** Selection-change listeners (panels that follow the selected node). */
const selectionListeners = new Set<() => void>();
export function notifySelection(): void {
  for (const fn of selectionListeners) fn();
}

export function onSelectionChange(cb: () => void): () => void {
  selectionListeners.add(cb);
  return () => selectionListeners.delete(cb);
}

export function nodeByKind(editor: NodeEditor<Schemes>, kind: NodeKind): CylNode | undefined {
  return editor.getNodes().find((x) => (x as CylNode).kind === kind) as CylNode | undefined;
}

/**
 * Resolve the _input_ source port (in0..in3) feeding a null/transform node's in0,
 * following passthrough chains (null/transform out0 -> next in0). _input_ source
 * -> its in\d port; null/transform source -> recurse into its in0 (visited-set
 * guards cycles); output/unknown/no connection -> null. Shared by display focus
 * and selection panels so null and transform resolve identically.
 */
export function resolveInputSourcePort(
  editor: NodeEditor<Schemes>,
  nodeId: string,
  visited: Set<string> = new Set(),
): number | null {
  if (visited.has(nodeId)) return null;
  visited.add(nodeId);
  const conn = editor.getConnections().find(
    (c) => c.target === nodeId && c.targetInput === "in0",
  ) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
  if (!conn) return null;
  const src = editor.getNode(conn.source) as CylNode | undefined;
  const out = String(conn.sourceOutput ?? "");
  if (src?.kind === "input") {
    const m = /^in(\d)$/.exec(out);
    return m ? Number(m[1]) : null;
  }
  if ((src?.kind === "null" || src?.kind === "transform" || src?.kind === "dot") && out === "out0") {
    return resolveInputSourcePort(editor, src.id, visited);
  }
  return null;
}

/** Resolve a DOM target to a rete node via area.nodeViews (element containment). */
export function nodeFromTarget(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  target: Element | null,
): { id: string; node: CylNode } | null {
  if (!target) return null;
  for (const [id, view] of area.nodeViews) {
    if (view.element.contains(target)) {
      const n = editor.getNode(id) as CylNode | undefined;
      if (n) return { id, node: n };
    }
  }
  return null;
}

/** Re-render one node: emit render WITH its element (ElementsHolder needs it as WeakMap key). */
export function renderNode(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  nodeId: string,
): void {
  const view = area.nodeViews.get(nodeId);
  const node = editor.getNode(nodeId);
  if (view && node) {
    (editor as unknown as { emit(s: unknown): void }).emit({
      type: "render",
      data: { type: "node", payload: node, element: view.element },
    });
  }
}

export function portIndexFromTarget(target: Element | null): number | null {
  const el = target?.closest?.("[data-port-id]");
  if (!el) return null;
  const raw = el.getAttribute("data-port-id") ?? "";
  const idx = parseInt(raw.replace(/[a-z]/g, ""), 10);
  return Number.isNaN(idx) ? null : idx;
}

export class CylNode extends ClassicPreset.Node {
  flags: NodeFlags = { ...DEFAULT_FLAGS };
  stats = "";
  kind: NodeKind = "null";
  baseLabel = "";
  params?: ParamSpec[];
  /** P2b：仅 kind==="channel" 使用——成员通道引用（tag/hda 的 serial 即节点 id）。
   *  project/channel 都不参与几何计算，关联线 v1 纯视觉。 */
  channel?: ChannelRef | null;
  /** 工厂位置提示（makeProjectNode/makeChannelNode 的 x/y 参数）；视图位置仍由
   *  area.translate 落地（serializeGraph 读 area.nodeViews 的位置，不读本字段）。 */
  pos?: { x: number; y: number };
  constructor(label: string, kind: NodeKind) {
    super(label);
    this.kind = kind;
    this.baseLabel = label;
    BASE_LABEL[label] = label;
  }
  /** Rete dataflow: v1 just passes placeholder markers (stats view only). */
  data(inputs: Record<string, unknown[]>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(this.outputs)) out[key] = { port: key, src: this.label };
    for (const key of Object.keys(inputs)) out[key] = inputs[key]?.[0] ?? { empty: true };
    return out;
  }
  flagText(): string {
    const f = this.flags;
    return (
      (f.bypass ? "⏭" : "") +
      (f.freeze ? "🔒" : "") +
      (f.reference ? "⛶" : "")
    );
  }
}

export function makeInputNode(): CylNode {
  const n = new CylNode("_input_", "input");
  for (let i = 0; i < 4; i++) n.addOutput(`in${i}`, new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  return n;
}
export function makeOutputNode(): CylNode {
  const n = new CylNode("_output_", "output");
  for (let i = 0; i < 4; i++) n.addInput(`out${i}`, new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
  return n;
}
/** Houdini-style unique naming: null1, null2… (first node already carries a suffix). */
let nullSeq = 1;
export function makeNullNode(): CylNode {
  const name = `null${nullSeq}`;
  nullSeq += 1;
  const n = new CylNode(name, "null");
  n.baseLabel = "null";
  n.addInput("in0", new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
  n.addOutput("out0", new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  return n;
}
/** Houdini-style unique naming: _dot_1, _dot_2… (independent seq). */
let dotSeq = 1;
export function makeDotNode(): CylNode {
  const name = `_dot_${dotSeq}`;
  dotSeq += 1;
  const n = new CylNode(name, "dot");
  n.baseLabel = "_dot_";
  n.addInput("in0", new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
  n.addOutput("out0", new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  return n;
}
/** Reserve the dot sequence counter past a restored label so undo-redo rebuilds
 *  never collide with an existing _dot_ label. */
export function claimDotLabel(label: string): void {
  const m = /^_dot_(\d+)$/.exec(label);
  if (m) {
    const n = Number(m[1]);
    if (dotSeq <= n) dotSeq = n + 1;
  }
}
/** Houdini-style unique naming: transform1, transform2… (independent seq). */
let transformSeq = 1;
export function makeTransformNode(): CylNode {
  const name = `transform${transformSeq}`;
  transformSeq += 1;
  const n = new CylNode(name, "transform");
  n.baseLabel = "transform";
  n.addInput("in0", new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
  n.addOutput("out0", new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  n.params = [
    { name: "px", type: "float", value: 0, default: 0 },
    { name: "py", type: "float", value: 0, default: 0 },
    { name: "pz", type: "float", value: 0, default: 0 },
    { name: "tx", type: "float", value: 0, default: 0 },
    { name: "ty", type: "float", value: 0, default: 0 },
    { name: "tz", type: "float", value: 0, default: 0 },
    { name: "group", type: "string", value: "", default: "" },
    { name: "class", type: "string", value: "autoguess", default: "autoguess" },
  ];
  return n;
}

// ---------------------------------------------------------------------------
// P2b 项目模式节点工厂（project 根 / channel 成员通道）
// ---------------------------------------------------------------------------

/** 项目图序列化版本（P2b）：v3 只在图内含 project/channel 节点时输出（buildGraphSnapshot
 *  自动判定）；否则保持 v2，绝不含新字段（round14-autosave / round16-undo 兼容）。 */
export const PROJECT_GRAPH_SCHEMA = 3;

/** 项目根节点：**无端口**（不参与任何连线/几何计算；id = 项目 serial P1-…，标签即项目名）。
 *  x/y 仅作位置提示（loadProjectGraph/restoreGraph 仍以 area.translate 落地视图位置）。 */
export function makeProjectNode(id: string, label: string, x = 24, y = 40): CylNode {
  const n = new CylNode(label, "project");
  n.id = id;
  n.pos = { x, y };
  return n;
}

/** 成员通道节点：**1 in / 1 out**（视觉关联线用，v1 不参与几何计算/旧 display 状态机）。
 *  id = 成员 serial（tag/hda）；channel 携带完整 ChannelRef（label = member.label || serial）。 */
export function makeChannelNode(id: string, channel: ChannelRef, label: string, x = 340, y = 40): CylNode {
  const n = new CylNode(label, "channel");
  n.id = id;
  n.channel = channel;
  n.pos = { x, y };
  n.addInput("in0", new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
  n.addOutput("out0", new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  return n;
}

/** rete connection augmented with the wire-bypass visual flag. B-key toggles it
 *  on the selected connection; it is persisted (serializeGraph) but NEVER read by
 *  the compute path (getNetworkSnapshot / network.ts ignore it). */
interface BypassConnection {
  bypass?: boolean;
}

export function getConnectionBypass(conn: unknown): boolean {
  return (conn as BypassConnection).bypass === true;
}

export function setConnectionBypassFlag(conn: unknown, on: boolean): void {
  const c = conn as BypassConnection;
  if (on) c.bypass = true;
  else delete c.bypass;
}

/** Apply (or remove) the bypass visual class on a connection's rendered path.
 *  Right after addConnection the view may not be rendered yet, so retry once on
 *  the next animation frame before giving up. */
export function applyConnectionBypassVisual(
  area: AreaPlugin<Schemes, AreaExtra>,
  id: string,
  on: boolean,
): void {
  const apply = (): boolean => {
    const path = area.connectionViews.get(id)?.element.querySelector("path");
    if (!path) return false;
    path.classList.toggle("cyl-wire-bypass", on);
    return true;
  };
  if (!apply()) {
    requestAnimationFrame(() => {
      apply();
    });
  }
}

/** 序列化用的纯节点描述（serializeGraph 从 editor/area 采集后交给 buildGraphSnapshot）。 */
export interface GraphNodeSnapshotData {
  id: string;
  kind: NodeKind;
  label: string;
  baseLabel: string;
  flags: NodeFlags;
  params?: ParamSpec[];
  x: number;
  y: number;
  channel?: ChannelRef | null;
}

/** 序列化用的纯连接描述（serializeGraph 采集后交给 buildGraphSnapshot）。 */
export interface GraphConnectionSnapshotData {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
  bypass?: boolean;
}

/**
 * 纯序列化（可单测）：图内含任一 project/channel 节点 → 输出 schemaVersion 3
 * （channel 字段仅 channel 节点携带，null 省略——project/旧 kinds 不带该键）；
 * 否则输出 schemaVersion 2 且**绝不含新字段**（保持 round14-autosave / round16-undo
 * 字节兼容）。自动判定（最简实现）：无需调用方传 includeChannels。
 */
export function buildGraphSnapshot(
  nodes: GraphNodeSnapshotData[],
  connections: GraphConnectionSnapshotData[],
  viewport: { k: number; x: number; y: number },
): unknown {
  const isProjectGraph = nodes.some((n) => n.kind === "project" || n.kind === "channel");
  const serializedNodes = nodes.map((n) => {
    const entry: Record<string, unknown> = {
      id: n.id,
      kind: n.kind,
      label: n.label,
      baseLabel: n.baseLabel,
      flags: n.flags,
      x: n.x,
      y: n.y,
    };
    if (n.params && n.params.length > 0) entry.params = n.params;
    if (isProjectGraph && n.channel) entry.channel = n.channel; // v2 绝不含新字段；v3 也省略 null
    return entry;
  });
  return { schemaVersion: isProjectGraph ? PROJECT_GRAPH_SCHEMA : 2, viewport, nodes: serializedNodes, connections };
}

export function serializeGraph(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
): unknown {
  const nodes: GraphNodeSnapshotData[] = editor.getNodes().map((n) => {
    const c = n as CylNode;
    const pos = area.nodeViews.get(n.id)?.position;
    return {
      id: n.id,
      kind: c.kind,
      label: c.label,
      baseLabel: c.baseLabel,
      flags: c.flags,
      params: c.params && c.params.length > 0 ? c.params : undefined,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      channel: c.channel ?? undefined,
    };
  });
  // Defensive: only serialize connections whose endpoint nodes still exist. Rete can
  // leave orphan connections behind after node removal, and persisting those produced
  // the "4 headless segments" bug (1 node / 4 dangling conns snapshot).
  const nodeIds = new Set(editor.getNodes().map((n) => n.id));
  const connections: GraphConnectionSnapshotData[] = editor
    .getConnections()
    .filter((c) => nodeIds.has(c.source) && nodeIds.has(c.target))
    .map((c) => {
      const entry: GraphConnectionSnapshotData = {
        source: c.source,
        sourceOutput: c.sourceOutput,
        target: c.target,
        targetInput: c.targetInput,
      };
      // only emit the flag when true, so older snapshots stay byte-compatible
      if (getConnectionBypass(c)) entry.bypass = true;
      return entry;
    });
  return buildGraphSnapshot(nodes, connections, { ...area.area.transform });
}

/**
 * 纯恢复决策（可单测）：按 kind 构造节点；project → 项目根（无端口），channel →
 * 成员通道（需 channel 引用）；**未知 kind → null（跳过该节点不崩）**；channel 缺
 * channel 引用 → null（跳过）。restoreGraph 对 null 直接 continue。
 */
export function restoreNodeForKind(nd: {
  kind: NodeKind;
  id?: string;
  label?: string;
  channel?: ChannelRef | null;
}): CylNode | null {
  switch (nd.kind) {
    case "input":
      return makeInputNode();
    case "output":
      return makeOutputNode();
    case "null":
      return makeNullNode();
    case "transform":
      return makeTransformNode();
    case "dot":
      return makeDotNode();
    case "project":
      return makeProjectNode(nd.id ?? "", nd.label ?? "project");
    case "channel":
      return nd.channel ? makeChannelNode(nd.id ?? "", nd.channel, nd.label ?? nd.channel.serial ?? "channel") : null;
    default:
      return null; // 未知 kind：跳过，不崩
  }
}

export async function restoreGraph(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  data: unknown,
): Promise<void> {
  const d = data as {
    nodes?: {
      id: string;
      kind: NodeKind;
      label: string;
      baseLabel?: string;
      flags?: NodeFlags;
      params?: ParamSpec[];
      x: number;
      y: number;
      channel?: ChannelRef | null; // v3：channel 节点携带的成员引用
    }[];
    connections?: { source: string; sourceOutput: string; target: string; targetInput: string; bypass?: boolean }[];
    viewport?: { k: number; x: number; y: number };
  };
  if (!d?.nodes) return;
  // Remove every live connection FIRST: rete's removeNode does not reliably drop its
  // connections, so restoring over a stale graph left headless segments behind.
  for (const c of editor.getConnections()) await editor.removeConnection(c.id);
  for (const n of editor.getNodes()) await editor.removeNode(n.id);
  const idMap = new Map<string, string>();
  let displayAssigned = false;
  for (const nd of d.nodes) {
    // v3 项目分支 + 未知 kind 跳过（restoreNodeForKind 返回 null 时 continue）
    const n = restoreNodeForKind(nd);
    if (!n) {
      log(`restore skipped node id=${nd.id} kind=${String(nd.kind)} (unknown kind or missing channel ref)`);
      continue;
    }
    const flags = { ...DEFAULT_FLAGS, ...(nd.flags ?? {}) };
    // P2b：project/channel 的 display 不进持久化状态机（channel display 是独立模块态，
    // 由 graph.ts setDisplayHandler 路由；这里强制熄灭，避免污染旧 kinds 唯一 display）
    if (n.kind === "project" || n.kind === "channel") flags.display = false;
    if (flags.display && displayAssigned) {
      flags.display = false; // only ONE display per network survives a restore
    } else if (flags.display) {
      displayAssigned = true;
    }
    n.flags = flags;
    n.label = nd.label ?? n.label;
    if (n.kind === "dot") claimDotLabel(n.label); // restore advances the seq so Ctrl+add never collides
    n.baseLabel = nd.baseLabel ?? n.baseLabel;
    if (nd.params) n.params = nd.params;
    await editor.addNode(n);
    idMap.set(nd.id, n.id);
    await area.translate(n.id, { x: nd.x ?? 0, y: nd.y ?? 0 });
  }
  for (const c of d.connections ?? []) {
    const src = editor.getNode(idMap.get(c.source) ?? "") as CylNode | undefined;
    const tgt = editor.getNode(idMap.get(c.target) ?? "") as CylNode | undefined;
    if (!src || !tgt) continue;
    if (src.id === tgt.id) {
      log(`restore skipped self-connection on ${src.label}`);
      continue;
    }
    const conn = new ClassicPreset.Connection(src, c.sourceOutput, tgt, c.targetInput) as unknown as Schemes["Connection"];
    await editor.addConnection(conn);
    if (c.bypass) {
      // persist + re-style the bypass flag on the rebuilt connection
      setConnectionBypassFlag(conn, true);
      applyConnectionBypassVisual(area, conn.id, true);
    }
  }
  if (d.viewport && d.viewport.k) {
    await area.area.zoom(d.viewport.k);
    await area.area.translate(d.viewport.x ?? 0, d.viewport.y ?? 0);
  }
  store.pushLog(`[node] restored graph: ${d.nodes.length} nodes / ${(d.connections ?? []).length} connections`);
  notifySelection(); // selection was reset by the rebuild
}

export function getNetworkSnapshot(editor: NodeEditor<Schemes>): NetworkSnapshot {
  // P2b：project/channel **不进 compute 快照**——channel 的关联线 v1 纯视觉，不参与
  // 几何计算/race；compute（traceChainSpecs / chain-cache）只应看到旧 kinds。过滤掉
  // 这类节点及其连接后，输出链自然回退 passthrough（与「channel 即便有连接也不参与
  // 几何计算」一致），且无需改 nodes2/network.ts。
  const computeNodes = (editor.getNodes() as CylNode[]).filter(
    (n) => n.kind !== "project" && n.kind !== "channel",
  );
  const nodeIds = new Set(computeNodes.map((n) => n.id));
  return {
    nodes: computeNodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      params: n.params ?? [],
    })),
    connections: editor
      .getConnections()
      .filter((c) => nodeIds.has(c.source) && nodeIds.has(c.target))
      .map((c) => ({ source: c.source, sourceOutput: c.sourceOutput, target: c.target, targetInput: c.targetInput })),
  };
}

// ---------------------------------------------------------------------------
// P2b 项目图规划（纯函数，graph.ts 的 loadProjectGraph 执行该计划）
// ---------------------------------------------------------------------------

/** loadProjectGraph 的纯规划结果：graph.ts 只负责把 plan 落到编辑器/画布。 */
export interface ProjectGraphPlanNode {
  id: string;
  kind: "project" | "channel";
  label: string;
  channel: ChannelRef | null;
  x: number;
  y: number;
}
export interface ProjectGraphPlan {
  nodes: ProjectGraphPlanNode[];
  connections: GraphConnectionSnapshotData[];
  viewport: { k: number; x: number; y: number } | null;
}

/**
 * 纯规划（可单测）：project 根（label = input.label || input.projectSerial）+ 每个
 * tag/hda 成员一个 channel 节点（id = serial，label = member.label || serial）；**param
 * 成员跳过（v1）**。saved（项目图快照 v3）提供按 id 匹配的位置/连接/viewport；saved 里
 * 存在但当前 members 没有的成员（缺失成员）→ 不在 plan 中，自然跳过。连接仅保留两端点
 * 都在 plan 里的（防御性过滤，与 restoreGraph 一致）。
 */
export function planProjectGraph(input: ProjectGraphInput, saved?: unknown): ProjectGraphPlan {
  const s = (saved ?? null) as {
    nodes?: Array<{ id: string; x?: number; y?: number }>;
    connections?: GraphConnectionSnapshotData[];
    viewport?: { k: number; x: number; y: number };
  } | null;
  const posOf = (id: string): { x: number; y: number } | null => {
    const hit = s?.nodes?.find((n) => n.id === id);
    return hit && typeof hit.x === "number" ? { x: hit.x, y: hit.y ?? 0 } : null;
  };
  const nodes: ProjectGraphPlanNode[] = [];
  nodes.push({
    id: input.projectSerial,
    kind: "project",
    label: input.label || input.projectSerial,
    channel: null,
    ...(posOf(input.projectSerial) ?? { x: 24, y: 40 }),
  });
  let channelIndex = 0;
  for (const m of input.members) {
    if (m.kind !== "tag" && m.kind !== "hda") continue; // param 成员跳过（v1）
    const id = m.serial ?? "";
    if (!id) continue; // tag/hda 必有 serial；缺则防御性跳过
    nodes.push({
      id,
      kind: "channel",
      label: m.label || id,
      channel: m,
      ...(posOf(id) ?? { x: 340, y: 40 + channelIndex * 80 }), // 默认：项目根右侧纵向排列
    });
    channelIndex += 1;
  }
  const ids = new Set(nodes.map((n) => n.id));
  const connections = (s?.connections ?? []).filter((c) => ids.has(c.source) && ids.has(c.target));
  const viewport = s?.viewport && s.viewport.k ? s.viewport : null;
  return { nodes, connections, viewport };
}
