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
import type { NetworkSnapshot } from "./network";
import type { UndoAction } from "./undo";

export type Schemes = ClassicScheme;
export type AreaExtra = ReactArea2D<Schemes>;

export type NodeKind = "input" | "output" | "null" | "transform" | "dot";

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
  getNetworkSnapshot(): NetworkSnapshot;
  setNodeParams(nodeId: string, params: ParamSpec[]): boolean;
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

export function serializeGraph(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
): unknown {
  const nodes = editor.getNodes().map((n) => {
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
    };
  });
  // Defensive: only serialize connections whose endpoint nodes still exist. Rete can
  // leave orphan connections behind after node removal, and persisting those produced
  // the "4 headless segments" bug (1 node / 4 dangling conns snapshot).
  const nodeIds = new Set(editor.getNodes().map((n) => n.id));
  const connections = editor
    .getConnections()
    .filter((c) => nodeIds.has(c.source) && nodeIds.has(c.target))
    .map((c) => ({
      source: c.source,
      sourceOutput: c.sourceOutput,
      target: c.target,
      targetInput: c.targetInput,
    }));
  return { schemaVersion: 2, viewport: { ...area.area.transform }, nodes, connections };
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
    }[];
    connections?: { source: string; sourceOutput: string; target: string; targetInput: string }[];
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
    let n: CylNode;
    if (nd.kind === "input") n = makeInputNode();
    else if (nd.kind === "output") n = makeOutputNode();
    else if (nd.kind === "transform") n = makeTransformNode();
    else if (nd.kind === "dot") n = makeDotNode();
    else n = makeNullNode();
    const flags = { ...DEFAULT_FLAGS, ...(nd.flags ?? {}) };
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
    await editor.addConnection(
      new ClassicPreset.Connection(src, c.sourceOutput, tgt, c.targetInput) as unknown as Schemes["Connection"],
    );
  }
  if (d.viewport && d.viewport.k) {
    await area.area.zoom(d.viewport.k);
    await area.area.translate(d.viewport.x ?? 0, d.viewport.y ?? 0);
  }
  store.pushLog(`[node] restored graph: ${d.nodes.length} nodes / ${(d.connections ?? []).length} connections`);
  notifySelection(); // selection was reset by the rebuild
}

export function getNetworkSnapshot(editor: NodeEditor<Schemes>): NetworkSnapshot {
  const nodeIds = new Set(editor.getNodes().map((n) => n.id));
  return {
    nodes: (editor.getNodes() as CylNode[]).map((n) => ({
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
