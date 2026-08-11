/**
 * Cyl1nder node graph on rete.js 2 (replaces the @antv/x6 custom graph).
 * Houdini-style vertical nodes: inputs on the left, outputs on the right,
 * 4-in/4-out, engine-level caching, node flags, Tab search, Y cut mode.
 *
 * v1 dataflow note: the network itself is still driven by the bridge/WS
 * (store.inputs -> runNetwork -> pushOutputs). The rete DataflowEngine is wired
 * so node outputs are cached and only recompute when inputs/connections change -
 * the future compute engine. Nodes visualize stats and drive the 3D viewport.
 */
import { ClassicPreset, NodeEditor } from "rete";
import { AreaPlugin, AreaExtensions } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { DataflowEngine, type DataflowEngineScheme } from "rete-engine";
import { Presets, ReactPlugin, useRete } from "rete-react-plugin";
import type { ClassicScheme, ReactArea2D } from "rete-react-plugin";
import { createRoot } from "react-dom/client";
import React from "react";
import { NodeView, notifyNodeChanged, setDisplayHandler } from "./NodeView";
import Fuse from "fuse.js";
import { store } from "../stores/workspace";
import type { NetworkSnapshot } from "./network";
import { createUndoManager, type ConnectionRef, type UndoAction, type UndoManager } from "./undo";

type Schemes = ClassicScheme;
type AreaExtra = ReactArea2D<Schemes>;

export type NodeKind = "input" | "output" | "null" | "transform";

export interface NodeFlags {
  display: boolean;
  bypass: boolean;
  freeze: boolean;
  reference: boolean; // reference flag (pink chip); viewport reference overlay
}

export const DEFAULT_FLAGS: NodeFlags = { display: false, bypass: false, freeze: false, reference: false };

/** Info about the first selected node (multi-select -> first), for panels that
 *  follow the selection (Spreadsheet / Params). `port` for a null node = the
 *  _input_ source index (in0..in3) feeding its in0; null when unresolved. */
export interface SelectedNodeInfo {
  kind: NodeKind;
  id: string;
  label: string;
  port: number | null;
  params: Array<{ name: string; type: string; value: unknown }>;
}

export interface ReteGraphHandlers {
  onNodePick?: (kind: NodeKind, port: number | null, nodeId: string) => void;
  /** node flags changed (context menu) -> caller refreshes viewport visibility/reference */
  onFlagsChanged?: (kind: NodeKind, flags: NodeFlags) => void;
  /** node selection changed (pick / rect-select / restore) -> panels follow selection */
  onSelectionChanged?: () => void;
  /** network topology changed (cut / insert / shake) -> caller re-runs the network */
  onNetworkChanged?: () => void;
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
  /** For a displayed null node: the _input_ source port (in0..in3) feeding its in0. */
  getDisplayPortIndex(): number | null;
  /** First selected node (multi-select -> first), or null (panels follow selection). */
  getSelectedNode(): SelectedNodeInfo | null;
  /** Subscribe to selection changes (node pick / rect-select / restore). Returns unsub. */
  onSelectionChanged(cb: () => void): () => void;
  frameSelection(): void;
  serializeGraph(): unknown;
  restoreGraph(data: unknown): Promise<void>;
  /** Network topology snapshot for the compute side (main.ts runNetwork): flat
   *  connections + per-node kind/params, so the caller can trace input->...->output. */
  getNetworkSnapshot(): NetworkSnapshot;
  /** Replace a node's params (Param panel edits); returns false when the node is gone. */
  setNodeParams(nodeId: string, params: Array<{ name: string; type: string; value: unknown }>): boolean;
  /** Undo the last topology edit (cut / insert / shake). */
  undo(): void;
  /** Redo the last undone topology edit. */
  redo(): void;
}

const GEO = "geo";
const log = (m: string) => store.pushLog(`[node] ${m}`);

/** Selection-change listeners (panels that follow the selected node). */
const selectionListeners = new Set<() => void>();
function notifySelection(): void {
  for (const fn of selectionListeners) fn();
}

/** Cached per-kind labels so setStats can restore the base title. */
const BASE_LABEL: Record<string, string> = { _input_: "_input_", _output_: "_output_", null: "null" };

function nodeByKind(editor: NodeEditor<Schemes>, kind: NodeKind): CylNode | undefined {
  return editor.getNodes().find((x) => (x as CylNode).kind === kind) as CylNode | undefined;
}

/** Resolve a DOM target to a rete node via area.nodeViews (element containment). */
function nodeFromTarget(
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
function renderNode(
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

function portIndexFromTarget(target: Element | null): number | null {
  const el = target?.closest?.("[data-port-id]");
  if (!el) return null;
  const raw = el.getAttribute("data-port-id") ?? "";
  const idx = parseInt(raw.replace(/[a-z]/g, ""), 10);
  return Number.isNaN(idx) ? null : idx;
}

// ---------------------------------------------------------------------------
// nodes
// ---------------------------------------------------------------------------

export class CylNode extends ClassicPreset.Node {
  flags: NodeFlags = { ...DEFAULT_FLAGS };
  stats = "";
  kind: NodeKind = "null";
  /** stable base name (e.g. "null"); label may carry a unique suffix (null1, null2…). */
  baseLabel = "";
  /** per-node editable params (Param panel); empty for null/input/output in v1. */
  params?: Array<{ name: string; type: string; value: unknown }>;
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

function makeInputNode(): CylNode {
  const n = new CylNode("_input_", "input");
  for (let i = 0; i < 4; i++) n.addOutput(`in${i}`, new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  return n;
}
function makeOutputNode(): CylNode {
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
    { name: "tx", type: "float", value: 0 },
    { name: "ty", type: "float", value: 0 },
    { name: "tz", type: "float", value: 0 },
    { name: "group", type: "string", value: "" },
    { name: "class", type: "string", value: "autoguess" },
  ];
  return n;
}

// ---------------------------------------------------------------------------
// editor factory
// ---------------------------------------------------------------------------

async function buildGraph(container: HTMLElement, handlers: ReteGraphHandlers) {
  const editor = new NodeEditor<Schemes>();
  const area = new AreaPlugin<Schemes, AreaExtra>(container);
  // Task 1: rete's AreaPlugin installs a default Drag handler that pans the whole
  // network on ANY-pointer (incl. LMB) drag over the background. Disable it so LMB
  // blank-drag only drives rect-select. MMB pan (attachMMBPan) and wheel zoom (the
  // separate Zoom handler) are unaffected; node dragging uses each NodeView's own
  // Drag handler and keeps working.
  area.area.setDragHandler(null);
  const connection = new ConnectionPlugin<Schemes, AreaExtra>();
  const engine = new DataflowEngine<DataflowEngineScheme>();
  const react = new ReactPlugin<Schemes, AreaExtra>({ createRoot });

  connection.addPreset(ConnectionPresets.classic.setup());
  react.addPreset(
    Presets.classic.setup({
      customize: {
        node: (d) => (props) => React.createElement(NodeView, { data: d.payload, emit: props.emit }),
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

  const input = makeInputNode();
  const output = makeOutputNode();
  input.flags.display = true; // default Houdini display = input_ (shows source curves)
  await editor.addNode(input);
  await editor.addNode(output);
  await area.translate(input.id, { x: 24, y: 40 });
  await area.translate(output.id, { x: 420, y: 40 });

  for (let i = 0; i < 4; i++) {
    await editor.addConnection(
      new ClassicPreset.Connection(input, `in${i}`, output, `out${i}`) as unknown as Schemes["Connection"],
    );
  }
  void AreaExtensions.zoomAt(area, editor.getNodes());

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

  return { editor, area, engine, input, output, react, selectable };
}

/** Create the graph; returns a handle with UI helpers. */
export async function createReteGraph(
  container: HTMLElement,
  handlers: ReteGraphHandlers = {},
): Promise<ReteGraph> {
  const g = await buildGraph(container, handlers);

  // Undo/redo stack for topology edits (cut / insert / shake); apply is chained so
  // rapid Ctrl+Z/Y cannot interleave the async rete connection mutations.
  let undoChain: Promise<void> = Promise.resolve();
  const undoManager = createUndoManager((action, direction) => {
    undoChain = undoChain.then(() => applyUndoAction(g.editor, action, direction)).catch(() => undefined);
  }, 100);

  attachTabSearch(g.editor, g.area, container);
  attachCutMode(g.editor, g.area, container, handlers, undoManager);
  attachFlagMenu(g.editor, g.area, container, (n) => handlers.onFlagsChanged?.(n.kind, { ...n.flags }));
  attachMMBPan(g.area, container);
  attachDotGrid(g.area, container);
  initTooltip(container);
  attachInsertion(g.editor, g.area, container, handlers, undoManager);
  attachRectSelect(g.editor, g.area, container, g.selectable);
  attachShakeDisconnect(g.editor, g.area, container, handlers, undoManager);

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
    let changed: CylNode[] = [];
    for (const n of g.editor.getNodes() as CylNode[]) {
      const want = n.id === nodeId;
      if (n.flags.display !== want) {
        n.flags.display = want;
        changed.push(n);
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
    const used = new Set(
      (g.editor.getNodes() as CylNode[]).filter((n) => n.id !== nodeId).map((n) => n.label),
    );
    let final = desired;
    for (let i = 1; used.has(final); i++) final = `${desired}${i}`;
    self.label = final; // baseLabel keeps the original base (null nodes stay "null")
    notifyNodeChanged();
    return final;
  });

  return {
    editor: g.editor,
    area: g.area,
    engine: g.engine,
    undo: () => undoManager.undo(),
    redo: () => undoManager.redo(),
    destroy: () => (g.editor as unknown as { destroy?: () => void }).destroy?.(),
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
      const conn = g.editor.getConnections().find(
        (c) => c.target === disp.id && c.targetInput === "in0",
      ) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
      const m = /^in(\d)$/.exec(String(conn?.sourceOutput ?? ""));
      return m ? Number(m[1]) : null;
    },
    getSelectedNode: () => {
      const sel = (g.editor.getNodes() as CylNode[]).find((n) => (n as ClassicPreset.Node).selected);
      if (!sel) return null;
      let port: number | null = null;
      if (sel.kind === "null" || sel.kind === "transform") {
        const conn = g.editor.getConnections().find(
          (c) => c.target === sel.id && c.targetInput === "in0",
        ) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
        const m = /^in(\d)$/.exec(String(conn?.sourceOutput ?? ""));
        port = m ? Number(m[1]) : null;
      }
      return { kind: sel.kind, id: sel.id, label: sel.label, port, params: sel.params ?? [] };
    },
    onSelectionChanged: (cb) => {
      selectionListeners.add(cb);
      return () => selectionListeners.delete(cb);
    },
    frameSelection: () => {
      const all = g.editor.getNodes();
      const selected = all.filter((n) => (n as ClassicPreset.Node).selected);
      const target = selected.length > 0 ? selected : all;
      if (target.length > 0) void AreaExtensions.zoomAt(g.area, target);
      store.pushLog(`[node] frame ${selected.length > 0 ? `${selected.length} selected` : "all"} nodes`);
    },
    serializeGraph: () => {
      const nodes = g.editor.getNodes().map((n) => {
        const c = n as CylNode;
        const pos = g.area.nodeViews.get(n.id)?.position;
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
      const nodeIds = new Set(g.editor.getNodes().map((n) => n.id));
      const connections = g.editor
        .getConnections()
        .filter((c) => nodeIds.has(c.source) && nodeIds.has(c.target))
        .map((c) => ({
          source: c.source,
          sourceOutput: c.sourceOutput,
          target: c.target,
          targetInput: c.targetInput,
        }));
      return { schemaVersion: 2, viewport: { ...g.area.area.transform }, nodes, connections };
    },
    restoreGraph: async (data) => {
      const d = data as {
        nodes?: {
          id: string;
          kind: NodeKind;
          label: string;
          baseLabel?: string;
          flags?: NodeFlags;
          params?: Array<{ name: string; type: string; value: unknown }>;
          x: number;
          y: number;
        }[];
        connections?: { source: string; sourceOutput: string; target: string; targetInput: string }[];
        viewport?: { k: number; x: number; y: number };
      };
      if (!d?.nodes) return;
      // Remove every live connection FIRST: rete's removeNode does not reliably drop its
      // connections, so restoring over a stale graph left headless segments behind.
      for (const c of g.editor.getConnections()) await g.editor.removeConnection(c.id);
      for (const n of g.editor.getNodes()) await g.editor.removeNode(n.id);
      const idMap = new Map<string, string>();
      let displayAssigned = false;
      for (const nd of d.nodes) {
        let n: CylNode;
        if (nd.kind === "input") n = makeInputNode();
        else if (nd.kind === "output") n = makeOutputNode();
        else if (nd.kind === "transform") n = makeTransformNode();
        else n = makeNullNode();
        const flags = { ...DEFAULT_FLAGS, ...(nd.flags ?? {}) };
        if (flags.display && displayAssigned) {
          flags.display = false; // only ONE display per network survives a restore
        } else if (flags.display) {
          displayAssigned = true;
        }
        n.flags = flags;
        n.label = nd.label ?? n.label;
        n.baseLabel = nd.baseLabel ?? n.baseLabel;
        if (nd.params) n.params = nd.params;
        await g.editor.addNode(n);
        idMap.set(nd.id, n.id);
        await g.area.translate(n.id, { x: nd.x ?? 0, y: nd.y ?? 0 });
      }
      for (const c of d.connections ?? []) {
        const src = g.editor.getNode(idMap.get(c.source) ?? "") as CylNode | undefined;
        const tgt = g.editor.getNode(idMap.get(c.target) ?? "") as CylNode | undefined;
        if (!src || !tgt) continue;
        await g.editor.addConnection(
          new ClassicPreset.Connection(src, c.sourceOutput, tgt, c.targetInput) as unknown as Schemes["Connection"],
        );
      }
      if (d.viewport && d.viewport.k) {
        await g.area.area.zoom(d.viewport.k);
        await g.area.area.translate(d.viewport.x ?? 0, d.viewport.y ?? 0);
      }
      store.pushLog(`[node] restored graph: ${d.nodes.length} nodes / ${(d.connections ?? []).length} connections`);
      notifySelection(); // selection was reset by the rebuild
    },
    getNetworkSnapshot: () => {
      const nodeIds = new Set(g.editor.getNodes().map((n) => n.id));
      return {
        nodes: (g.editor.getNodes() as CylNode[]).map((n) => ({
          id: n.id,
          kind: n.kind,
          label: n.label,
          params: n.params ?? [],
        })),
        connections: g.editor
          .getConnections()
          .filter((c) => nodeIds.has(c.source) && nodeIds.has(c.target))
          .map((c) => ({ source: c.source, sourceOutput: c.sourceOutput, target: c.target, targetInput: c.targetInput })),
      };
    },
    setNodeParams: (nodeId, params) => {
      const n = g.editor.getNode(nodeId) as CylNode | undefined;
      if (!n) return false;
      n.params = params;
      notifyNodeChanged();
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Tab search (Fuse.js mature fuzzy search)
// ---------------------------------------------------------------------------

interface PaletteEntry {
  kind: NodeKind;
  label: string;
  desc: string;
  keywords: string;
}

const PALETTE: PaletteEntry[] = [
  { kind: "input", label: "_input_", desc: "4-output source", keywords: "source input 输入 起点" },
  { kind: "output", label: "_output_", desc: "4-input sink", keywords: "sink output 输出 终点" },
  { kind: "null", label: "null", desc: "passthrough 1+1", keywords: "null passthrough 直通" },
  { kind: "transform", label: "transform", desc: "translate by group 变换/移动", keywords: "transform translate move 变换 移动 组" },
];

const fuse = new Fuse(PALETTE, {
  keys: [
    { name: "label", weight: 0.5 },
    { name: "desc", weight: 0.25 },
    { name: "keywords", weight: 0.25 },
  ],
  threshold: 0.4,
  ignoreLocation: true,
});

let lastGraphMouse = { x: 0, y: 0 };

function attachTabSearch(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): void {
  const overlay = document.createElement("div");
  overlay.className = "cyl-palette hidden";
  overlay.innerHTML = `<input class="cyl-palette-input" placeholder="Tab: search nodes…" spellcheck="false" /><div class="cyl-palette-list"></div>`;
  const input = overlay.querySelector(".cyl-palette-input") as HTMLInputElement;
  const list = overlay.querySelector(".cyl-palette-list") as HTMLDivElement;
  container.appendChild(overlay);

  let open = false;
  let index = 0;
  let results: PaletteEntry[] = [];

  const render = () => {
    list.innerHTML = "";
    results.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "cyl-palette-row" + (i === index ? " active" : "");
      row.innerHTML = `<span class="p-label">${r.label}</span><span class="p-desc">${r.desc}</span>`;
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        index = i;
        create();
      });
      list.appendChild(row);
    });
  };

  const create = async () => {
    const entry = results[index];
    if (!entry) return;
    // place near the mouse if it is inside the graph, else a default spot
    const rect = container.getBoundingClientRect();
    const inside =
      lastGraphMouse.x >= rect.left && lastGraphMouse.x <= rect.right && lastGraphMouse.y >= rect.top && lastGraphMouse.y <= rect.bottom;
    let center = { x: 240, y: 120 };
    if (inside) {
      const t = area.area.transform; // screen -> area-local: (client - rect - translate) / zoom
      center = {
        x: (lastGraphMouse.x - rect.left - t.x) / t.k,
        y: (lastGraphMouse.y - rect.top - t.y) / t.k,
      };
    }
    if (entry.kind === "null" || entry.kind === "transform") {
      const make = entry.kind === "transform" ? makeTransformNode : makeNullNode;
      let n = make();
      while (editor.getNodes().some((x) => (x as CylNode).label === n.label)) n = make();
      await editor.addNode(n);
      await area.translate(n.id, center);
      log(`created ${entry.kind} node ${n.label}`);
    } else {
      const existing = editor.getNodes().find((x) => (x as CylNode).kind === entry.kind);
      if (existing) await area.translate(existing.id, center);
    }
    close();
  };

  const close = () => {
    open = false;
    overlay.classList.add("hidden");
    input.blur();
  };

  const update = (q: string) => {
    results = q.trim() ? fuse.search(q).map((r) => r.item) : PALETTE;
    index = 0;
    render();
  };

  input.addEventListener("input", () => update(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { index = (index + 1) % Math.max(1, results.length); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { index = (index - 1 + results.length) % Math.max(1, results.length); render(); e.preventDefault(); }
    else if (e.key === "Enter") { create(); e.preventDefault(); }
    else if (e.key === "Escape") { close(); e.preventDefault(); }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    open = !open;
    if (open) { overlay.classList.remove("hidden"); input.value = ""; update(""); input.focus(); }
    else close();
  });
}

// ---------------------------------------------------------------------------
// Y cut line: hold Y, drag a red line across connections to cut them all
// ---------------------------------------------------------------------------

/** Screen-space point-to-segment distance (px). */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Sample a connection's rendered SVG path into screen-space points (same technique as hitTestConnection). */
function sampleConnectionPath(
  area: AreaPlugin<Schemes, AreaExtra>,
  id: string,
): { x: number; y: number }[] | null {
  const view = area.connectionViews.get(id);
  if (!view) return null;
  const svg = (view.element.querySelector("path") ?? view.element) as SVGPathElement | null;
  if (!svg || typeof svg.getTotalLength !== "function") return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const len = svg.getTotalLength();
  const step = Math.max(4, len / 40);
  const pts: { x: number; y: number }[] = [];
  for (let t = 0; t <= len; t += step) {
    const p = svg.getPointAtLength(t);
    const sp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
    pts.push({ x: sp.x, y: sp.y });
  }
  return pts;
}

/** Find a live connection matching a ConnectionRef (stable across add/remove cycles). */
function findConnectionByRef(editor: NodeEditor<Schemes>, ref: ConnectionRef): { id: string } | undefined {
  return editor.getConnections().find(
    (c) =>
      c.source === ref.source &&
      c.sourceOutput === ref.sourceOutput &&
      c.target === ref.target &&
      c.targetInput === ref.targetInput,
  );
}

/** Replay/reverse a recorded topology edit for undo/redo (ref-based, id-stable). */
async function applyUndoAction(
  editor: NodeEditor<Schemes>,
  action: UndoAction,
  direction: "undo" | "redo",
): Promise<void> {
  const addConn = async (ref: ConnectionRef) => {
    const src = editor.getNode(ref.source) as CylNode | undefined;
    const tgt = editor.getNode(ref.target) as CylNode | undefined;
    if (!src || !tgt) return;
    await editor.addConnection(
      new ClassicPreset.Connection(src, ref.sourceOutput, tgt, ref.targetInput) as unknown as Schemes["Connection"],
    );
  };
  const delConn = async (ref: ConnectionRef) => {
    const c = findConnectionByRef(editor, ref);
    if (c) await editor.removeConnection(c.id);
  };
  const lbl = (ref: ConnectionRef) => {
    const s = (editor.getNode(ref.source) as CylNode | undefined)?.label ?? ref.source;
    const t = (editor.getNode(ref.target) as CylNode | undefined)?.label ?? ref.target;
    return `${s} -> ${t}`;
  };
  if (action.type === "cut") {
    if (direction === "undo") await addConn(action.connection);
    else await delConn(action.connection);
    log(`${direction} cut connection ${lbl(action.connection)}`);
  } else if (action.type === "insert") {
    const a2n: ConnectionRef = {
      source: action.connection.source,
      sourceOutput: action.connection.sourceOutput,
      target: action.nodeId,
      targetInput: "in0",
    };
    const n2b: ConnectionRef = {
      source: action.nodeId,
      sourceOutput: "out0",
      target: action.connection.target,
      targetInput: action.connection.targetInput,
    };
    if (direction === "undo") {
      await delConn(a2n);
      await delConn(n2b);
      await addConn(action.connection);
      if (action.prevConnection) await addConn(action.prevConnection);
    } else {
      await delConn(action.connection);
      if (action.prevConnection) await delConn(action.prevConnection);
      await addConn(a2n);
      await addConn(n2b);
    }
    log(`${direction} insert ${action.nodeLabel} into ${lbl(action.connection)}`);
  } else if (action.type === "cut-many") {
    if (direction === "undo") {
      for (const ref of action.connections) await addConn(ref);
    } else {
      for (const ref of action.connections) await delConn(ref);
    }
    log(`${direction} cut ${action.connections.length} connection(s) via polyline`);
  } else if (action.type === "shake") {
    if (direction === "undo") {
      for (const ref of action.added) await delConn(ref);
      for (const ref of action.cut) await addConn(ref);
    } else {
      for (const ref of action.cut) await delConn(ref);
      for (const ref of action.added) await addConn(ref);
    }
    log(`${direction} shake (${action.cut.length} cut / ${action.added.length} added)`);
  }
}

function attachCutMode(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  handlers: ReteGraphHandlers,
  undoManager: UndoManager,
): void {
  let armed = false;
  let drawing = false;
  let pts: { x: number; y: number }[] = [];

  // Full-cover, absolutely-positioned SVG for the red cut polyline. pointer-events:none
  // so it never intercepts graph input; z-index above nodes/connections/previews.
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:9;";
  svg.style.width = "100%";
  svg.style.height = "100%";
  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  poly.setAttribute("stroke", "#ff3b30");
  poly.setAttribute("stroke-width", "2");
  poly.setAttribute("stroke-linecap", "round");
  poly.setAttribute("fill", "none");
  poly.setAttribute("points", "");
  svg.appendChild(poly);
  container.appendChild(svg);

  const isTyping = () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    return el.getClientRects().length > 0;
  };

  const pathLen = (arr: { x: number; y: number }[]) => {
    let len = 0;
    for (let i = 1; i < arr.length; i++) len += Math.hypot(arr[i].x - arr[i - 1].x, arr[i].y - arr[i - 1].y);
    return len;
  };
  const setPoints = (arr: { x: number; y: number }[]) => {
    const rect = container.getBoundingClientRect();
    poly.setAttribute("points", arr.map((p) => `${p.x - rect.left},${p.y - rect.top}`).join(" "));
  };
  const clear = () => {
    pts = [];
    poly.setAttribute("points", "");
  };

  const cutConnection = (id: string) => {
    const conn = editor.getConnection(id) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
    const src = conn ? ((editor.getNode(conn.source) as CylNode | undefined)?.label ?? conn.source) : "?";
    const tgt = conn ? ((editor.getNode(conn.target) as CylNode | undefined)?.label ?? conn.target) : "?";
    if (conn) {
      undoManager.push({
        type: "cut",
        connection: { source: conn.source, sourceOutput: conn.sourceOutput, target: conn.target, targetInput: conn.targetInput },
      });
    }
    void editor.removeConnection(id);
    log(`cut connection ${id} (${src} -> ${tgt})`);
    handlers.onNetworkChanged?.();
  };

  const cutByPolyline = (arr: { x: number; y: number }[]) => {
    // One stroke = one undoable operation: collect every hit once (the same
    // connection may be crossed by several polyline segments), then remove all.
    const cutRefs: ConnectionRef[] = [];
    const seen = new Set<string>();
    const ids = Array.from(area.connectionViews.keys());
    for (const id of ids) {
      if (!area.connectionViews.has(id)) continue;
      const sampled = sampleConnectionPath(area, id);
      if (!sampled) continue;
      for (let i = 1; i < arr.length; i++) {
        const ax = arr[i - 1].x;
        const ay = arr[i - 1].y;
        const bx = arr[i].x;
        const by = arr[i].y;
        if (!sampled.some((p) => distToSegment(p.x, p.y, ax, ay, bx, by) <= 8)) continue;
        const conn = editor.getConnection(id) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
        if (conn && !seen.has(id)) {
          seen.add(id);
          cutRefs.push({
            source: conn.source,
            sourceOutput: conn.sourceOutput,
            target: conn.target,
            targetInput: conn.targetInput,
          });
        }
        break;
      }
    }
    if (cutRefs.length === 0) return;
    for (const id of seen) void editor.removeConnection(id);
    undoManager.push({ type: "cut-many", connections: cutRefs });
    log(`cut ${cutRefs.length} connection(s) via polyline`);
    handlers.onNetworkChanged?.();
  };

  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "y" || e.repeat || isTyping()) return;
    armed = true;
    e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() !== "y") return;
    armed = false;
    drawing = false;
    clear();
  });

  container.addEventListener(
    "pointerdown",
    (e) => {
      if (!armed || e.button !== 0) return;
      const target = e.target as Element;
      // only start a cut line on the blank graph surface (not nodes/ports/chips/inputs)
      if (nodeFromTarget(editor, area, target)) return;
      if (target.closest?.(".cyl-ns") || target.closest?.(".cyl-rp-port") || target.closest?.("button") || target instanceof HTMLInputElement) return;
      drawing = true;
      pts = [{ x: e.clientX, y: e.clientY }];
      setPoints(pts);
      e.preventDefault();
      e.stopImmediatePropagation(); // keep rect-select / area drag from hijacking the cut
    },
    true,
  );

  container.addEventListener(
    "pointermove",
    (e) => {
      if (!drawing) return;
      const last = pts[pts.length - 1];
      if (pts.length < 500 && Math.hypot(e.clientX - last.x, e.clientY - last.y) > 4) {
        pts.push({ x: e.clientX, y: e.clientY });
        setPoints(pts);
      }
      e.preventDefault();
    },
    true,
  );

  const up = (e: PointerEvent) => {
    if (!armed || !drawing) return;
    drawing = false;
    const arr = pts;
    clear();
    if (arr.length === 0) return;
    if (pathLen(arr) < 4) {
      // click without dragging: cut the single connection under the cursor
      const connId = hitTestConnection(area, e.clientX, e.clientY);
      if (connId) cutConnection(connId);
    } else {
      cutByPolyline(arr);
    }
  };
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

// ---------------------------------------------------------------------------
// right-click flag menu (DOM overlay)
// ---------------------------------------------------------------------------

function attachFlagMenu(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  onChanged?: (node: CylNode) => void,
): void {
  const menu = document.createElement("div");
  menu.className = "cyl-node-menu hidden";
  container.appendChild(menu);
  let currentId = "";
  const close = () => menu.classList.add("hidden");

  const show = (x: number, y: number, node: CylNode) => {
    currentId = node.id;
    menu.innerHTML = "";
    const labels: [keyof NodeFlags, string][] = [
      ["display", "Display"],
      ["bypass", "Bypass"],
      ["freeze", "Freeze"],
      ["reference", "Wireframe"],
    ];
    for (const [key, label] of labels) {
      const row = document.createElement("div");
      row.className = "cyl-node-menu-row";
      row.innerHTML = `<input type="checkbox" ${node.flags[key] ? "checked" : ""}/><span>${label}</span>`;
      // pointerdown (not click): the container closes the menu on any pointerdown
      // (bubble phase), which would otherwise swallow the row click.
      row.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        node.flags = { ...node.flags, [key]: !node.flags[key] };
        log(`node ${node.kind} ${key}=${node.flags[key]}`);
        onChanged?.(node);
        notifyNodeChanged();
        show(x, y, node);
      });
      menu.appendChild(row);
    }
    const del = document.createElement("div");
    del.className = "cyl-node-menu-row danger";
    del.innerHTML = `<span>Delete</span>`;
    del.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (node.kind === "null") void editor.removeNode(node.id);
      close();
    });
    menu.appendChild(del);
    menu.classList.remove("hidden");
    const rect = container.getBoundingClientRect();
    menu.style.left = `${Math.min(x - rect.left, rect.width - 170)}px`;
    menu.style.top = `${Math.min(y - rect.top, rect.height - 190)}px`;
  };

  container.addEventListener("contextmenu", (ev) => {
    const hit = nodeFromTarget(editor, area, ev.target as Element);
    if (hit) {
      ev.preventDefault();
      show(ev.clientX, ev.clientY, hit.node);
    } else {
      close();
    }
  });
  container.addEventListener("pointerdown", () => close());
}

/** Node state chips handler: toggles reference/bypass/freeze per node; display is unique via setDisplayHandler. */
let nodeStateHandler: ((nodeId: string, key: "display" | "reference" | "bypass" | "freeze") => void) | null = null;
export function setNodeStateHandler(fn: ((nodeId: string, key: "display" | "reference" | "bypass" | "freeze") => void) | null): void {
  nodeStateHandler = fn;
}
export function fireNodeState(nodeId: string, key: "display" | "reference" | "bypass" | "freeze"): void {
  nodeStateHandler?.(nodeId, key);
}

/** Rename handler: returns the final (deduped) label for a node rename; registered by createReteGraph. */
let renameHandler: ((nodeId: string, desired: string) => string) | null = null;
export function setRenameHandler(fn: ((nodeId: string, desired: string) => string) | null): void {
  renameHandler = fn;
}
export function fireRename(nodeId: string, desired: string): string {
  return renameHandler ? renameHandler(nodeId, desired) : desired;
}

/** Custom floating tooltip (dark rounded chip) replacing the native title tooltip. */
let tooltipEl: HTMLDivElement | null = null;
export function initTooltip(container: HTMLElement): void {
  if (tooltipEl) return;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "cyl-tooltip hidden";
  container.appendChild(tooltipEl);
}
export function showTooltip(x: number, y: number, text: string): void {
  if (!tooltipEl) return;
  tooltipEl.textContent = text;
  tooltipEl.classList.remove("hidden");
  const parent = tooltipEl.parentElement;
  const rect = parent?.getBoundingClientRect();
  if (rect) {
    const w = tooltipEl.offsetWidth;
    const h = tooltipEl.offsetHeight;
    tooltipEl.style.left = `${Math.min(x - rect.left + 12, rect.width - w - 8)}px`;
    tooltipEl.style.top = `${Math.min(y - rect.top + 16, rect.height - h - 8)}px`;
  }
}
export function hideTooltip(): void {
  tooltipEl?.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Houdini-style navigation: MMB drag pans the canvas (wheel zoom is built-in)
// ---------------------------------------------------------------------------

function attachMMBPan(area: AreaPlugin<Schemes, AreaExtra>, container: HTMLElement): void {
  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 1) return; // middle mouse
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY };
      const t0 = { ...area.area.transform };
      const onMove = (ev: PointerEvent) => {
        void area.area.translate(t0.x + (ev.clientX - start.x), t0.y + (ev.clientY - start.y));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    true,
  );
}

// ---------------------------------------------------------------------------
// Dot-grid background with zoom LOD (Houdini-ish position reference).
// Screen-space fixed dots; fade out as you zoom out, brighten when zoomed in.
// ---------------------------------------------------------------------------

function attachDotGrid(area: AreaPlugin<Schemes, AreaExtra>, container: HTMLElement): void {
  const grid = document.createElement("div");
  grid.className = "cyl-dotgrid";
  container.appendChild(grid);

  const update = () => {
    const k = area.area.transform.k;
    const t = area.area.transform;
    // LOD: bright when zoomed in, dim and finally hidden when zoomed far out
    let opacity = 0;
    if (k >= 0.9) opacity = 0.85;
    else if (k >= 0.55) opacity = 0.5;
    else if (k >= 0.3) opacity = 0.22;
    grid.style.opacity = String(opacity);
    // dots scroll with pan (screen-space grid follows the content a little)
    const size = 22;
    grid.style.backgroundPosition = `${-(t.x % size)}px ${-(t.y % size)}px`;
  };

  area.addPipe((ctx) => {
    if (ctx.type === "zoomed" || ctx.type === "translated") update();
    return ctx;
  });
  requestAnimationFrame(update);
}

// ---------------------------------------------------------------------------
// Insertion: drag a standalone null node over a connection -> highlight preview,
// release -> splice it into the edge (A->B becomes A->null->B).
// ---------------------------------------------------------------------------

function hitTestConnection(
  area: AreaPlugin<Schemes, AreaExtra>,
  x: number,
  y: number,
): string | null {
  // getScreenCTM maps SVG path-local points to screen coordinates, so the area's
  // translate/scale transform is fully accounted for (verified against DOMPoint).
  const threshold = 14;
  for (const [id, view] of area.connectionViews) {
    const svg = (view.element.querySelector("path") ?? view.element) as SVGPathElement | null;
    if (!svg || typeof svg.getTotalLength !== "function") continue;
    const ctm = svg.getScreenCTM();
    if (!ctm) continue;
    const rect = svg.getBoundingClientRect();
    if (x < rect.left - 40 || x > rect.right + 40 || y < rect.top - 40 || y > rect.bottom + 40) continue;
    const len = svg.getTotalLength();
    const step = Math.max(4, len / 40);
    for (let t = 0; t <= len; t += step) {
      const p = svg.getPointAtLength(t);
      const sp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
      const dx = sp.x - x;
      const dy = sp.y - y;
      if (dx * dx + dy * dy < threshold * threshold) return id;
    }
  }
  return null;
}

/** Bézier path matching the real connections (curvature 0.3), used by the insertion preview. */
function connectionPathD(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y1 - y2);
  const off = Math.max(dy / 2, dx) * 0.3;
  return `M ${x1} ${y1} C ${x1 + off} ${y1}, ${x2 - off} ${y2}, ${x2} ${y2}`;
}

/** Nodes that can be drag-inserted into a connection: exactly one input + one output. */
function isInsertable(n: CylNode): boolean {
  return !!n.inputs && !!n.outputs && Object.keys(n.inputs).length === 1 && Object.keys(n.outputs).length === 1;
}

function attachInsertion(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  handlers: ReteGraphHandlers,
  undoManager: UndoManager,
): void {
  let draggingNodeId: string | null = null;
  let draggingNode: CylNode | null = null;
  let hoverConn: string | null = null;

  // Insertion preview overlay: two dashed flowing curves (source -> mouse -> target).
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.setAttribute("class", "cyl-insert-preview");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:0;";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  container.appendChild(overlay);
  const previewA = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const previewB = document.createElementNS("http://www.w3.org/2000/svg", "path");
  for (const path of [previewA, previewB]) {
    path.setAttribute("class", "cyl-insert-preview-path");
    overlay.appendChild(path);
  }

  /** Container-local center of a node port (data-port-id) -> preview endpoint. */
  const portCenterLocal = (nodeId: string, portId: string, rect: DOMRect): { x: number; y: number } | null => {
    const el = area.nodeViews.get(nodeId)?.element.querySelector(`[data-port-id="${portId}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - rect.left, y: r.top + r.height / 2 - rect.top };
  };

  /**
   * Two flowing dashed curves following the dragged node while hovering a
   * connection: previewA = connection source socket -> dragged node IN port,
   * previewB = dragged node OUT port -> connection target socket. Re-drawn on
   * every pointermove so the endpoints track the moving node's ports.
   */
  // The container pointermove listener runs in the capture phase, BEFORE rete's
  // node drag handler applies the move, so DOM port positions lag one event
  // behind. Defer the redraw to the next frame so the curves follow the node.
  let previewRaf = 0;
  const refreshPreview = (mouseX: number, mouseY: number) => {
    if (previewRaf) cancelAnimationFrame(previewRaf);
    previewRaf = requestAnimationFrame(() => {
      previewRaf = 0;
      updatePreview(mouseX, mouseY);
    });
  };

  const updatePreview = (mouseX: number, mouseY: number) => {
    previewA.setAttribute("d", "");
    previewB.setAttribute("d", "");
    if (!hoverConn || !draggingNodeId) return;
    const view = area.connectionViews.get(hoverConn);
    if (!view) return;
    const svg = view.element.querySelector("path") as SVGPathElement | null;
    if (!svg || typeof svg.getTotalLength !== "function") return;
    const ctm = svg.getScreenCTM();
    const rect = container.getBoundingClientRect();
    if (!ctm) return;
    const len = svg.getTotalLength();
    const p0 = svg.getPointAtLength(0);
    const p1 = svg.getPointAtLength(len);
    const start = new DOMPoint(p0.x, p0.y).matrixTransform(ctm);
    const end = new DOMPoint(p1.x, p1.y).matrixTransform(ctm);
    const inC = portCenterLocal(draggingNodeId, "in0", rect);
    const outC = portCenterLocal(draggingNodeId, "out0", rect);
    if (!inC || !outC) return;
    previewA.setAttribute("d", connectionPathD(start.x - rect.left, start.y - rect.top, inC.x, inC.y));
    previewB.setAttribute("d", connectionPathD(outC.x, outC.y, end.x - rect.left, end.y - rect.top));
  };

  const setHover = (connId: string | null, mouseX = 0, mouseY = 0) => {
    if (hoverConn) {
      area.connectionViews.get(hoverConn)?.element.querySelector("path")?.classList.remove("drop-target");
      hoverConn = null;
    }
    if (connId) {
      const view = area.connectionViews.get(connId);
      if (view) {
        view.element.querySelector("path")?.classList.add("drop-target");
        hoverConn = connId;
      }
    }
    refreshPreview(mouseX, mouseY);
  };
  container.addEventListener(
    "pointerdown",
    (e) => {
      const hit = nodeFromTarget(editor, area, e.target as Element);
      // any single-in/single-out node (null / transform) can be drag-inserted
      if (hit && isInsertable(hit.node)) {
        draggingNodeId = hit.id;
        draggingNode = hit.node;
      }
    },
    true,
  );

  container.addEventListener(
    "pointermove",
    (e) => {
      lastGraphMouse = { x: e.clientX, y: e.clientY };
      if (!draggingNodeId) return;
      const connId = hitTestConnection(area, e.clientX, e.clientY);
      if (connId !== hoverConn) setHover(connId, e.clientX, e.clientY);
      else refreshPreview(e.clientX, e.clientY); // keep endpoints on the moving node
    },
    true,
  );

  const up = () => {
    if (!draggingNodeId) return;
    draggingNodeId = null;
    const node = draggingNode;
    draggingNode = null;
    const connId = hoverConn;
    setHover(null);
    if (!connId || !node) return;
    const conn = editor.getConnection(connId) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
    if (!conn) return;
    const srcNode = editor.getNode(conn.source as string) as CylNode | undefined;
    const tgtNode = editor.getNode(conn.target as string) as CylNode | undefined;
    if (!srcNode || !tgtNode) return;
    void (async () => {
      // one-input constraint: drop any existing connection into this node's in0 first
      const existing = editor.getConnections().find(
        (c) => c.target === node.id && c.targetInput === "in0",
      ) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
      if (existing) await editor.removeConnection(existing.id);
      await editor.removeConnection(connId);
      await editor.addConnection(
        new ClassicPreset.Connection(srcNode, conn.sourceOutput as string, node, "in0") as unknown as Schemes["Connection"],
      );
      await editor.addConnection(
        new ClassicPreset.Connection(node, "out0", tgtNode, conn.targetInput as string) as unknown as Schemes["Connection"],
      );
      store.pushLog(`[node] inserted ${node.label} into ${srcNode.label} -> ${tgtNode.label}`);
      // keep the inserted node clear of its source: minX = src edge + node width + 30
      const pos = area.nodeViews.get(node.id)?.position;
      if (pos) {
        const srcPos = area.nodeViews.get(srcNode.id)?.position;
        if (srcPos) {
          const width = (area.nodeViews.get(node.id)?.element.getBoundingClientRect().width ?? 150) / area.area.transform.k;
          const minX = srcPos.x + width + 30;
          if (pos.x < minX) {
            void area.translate(node.id, { x: minX, y: pos.y });
            pos.x = minX;
          }
        }
        // spread the layout: shift every node to the right of the inserted node
        const offset = 180;
        for (const n of editor.getNodes()) {
          if (n.id === node.id) continue;
          const nPos = area.nodeViews.get(n.id)?.position;
          if (nPos && nPos.x > pos.x + 30) void area.translate(n.id, { x: nPos.x + offset, y: nPos.y });
        }
      }
      undoManager.push({
        type: "insert",
        nodeId: node.id,
        nodeLabel: node.label,
        connection: { source: conn.source, sourceOutput: conn.sourceOutput, target: conn.target, targetInput: conn.targetInput },
        prevConnection: existing
          ? { source: existing.source, sourceOutput: existing.sourceOutput, target: existing.target, targetInput: existing.targetInput }
          : null,
      });
      handlers.onNetworkChanged?.();
    })();
  };
  window.addEventListener("pointerup", up);
}

// ---------------------------------------------------------------------------
// LMB drag on blank canvas = rectangle multi-select (rete nodes)
// ---------------------------------------------------------------------------

function attachRectSelect(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  selectable: { select: (id: string, acc: boolean) => Promise<void>; unselect: (id: string) => Promise<void> } | undefined,
): void {
  const overlay = document.createElement("div");
  overlay.className = "cyl-rect-select hidden";
  container.appendChild(overlay);
  let sel: { x0: number; y0: number } | null = null;

  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0 || e.altKey || e.metaKey || e.ctrlKey) return;
      const target = e.target as Element;
      if (target.closest(".cyl-ns") || target.closest(".cyl-rp-port") || target.closest("button") || target instanceof HTMLInputElement) return;
      if (nodeFromTarget(editor, area, target)) return; // node drag, not rect select
      sel = { x0: e.clientX, y0: e.clientY };
      overlay.classList.remove("hidden");
    },
    true,
  );
  container.addEventListener(
    "pointermove",
    (e) => {
      if (!sel) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const x0 = sel.x0 - rect.left;
      const y0 = sel.y0 - rect.top;
      overlay.style.left = `${Math.min(x0, x)}px`;
      overlay.style.top = `${Math.min(y0, y)}px`;
      overlay.style.width = `${Math.abs(x - x0)}px`;
      overlay.style.height = `${Math.abs(y - y0)}px`;
    },
    true,
  );
  const up = (e: PointerEvent) => {
    if (!sel || !selectable) return;
    const t = area.area.transform;
    const rect = container.getBoundingClientRect();
    const lx = (Math.min(sel.x0, e.clientX) - rect.left - t.x) / t.k;
    const ly = (Math.min(sel.y0, e.clientY) - rect.top - t.y) / t.k;
    const rx = (Math.max(sel.x0, e.clientX) - rect.left - t.x) / t.k;
    const ry = (Math.max(sel.y0, e.clientY) - rect.top - t.y) / t.k;
    sel = null;
    overlay.classList.add("hidden");
    for (const [id, view] of area.nodeViews) {
      const p = view.position;
      if (p && p.x >= lx && p.x <= rx && p.y >= ly && p.y <= ry) {
        void selectable.select(id, true);
      } else {
        void selectable.unselect(id);
      }
    }
    store.pushLog(`[node] rect-select complete`);
    window.setTimeout(notifySelection, 0); // select()/unselect() are async
  };
  window.addEventListener("pointerup", up);
}

// ---------------------------------------------------------------------------
// Shake a node to pop it out of the chain: all its connections are cut and each
// A -> node -> B path heals into a direct A -> B (keeping the original
// sourceOutput/targetInput) when the socket types match and B's target slot is
// free. The shaken node stays disconnected. Multi-port nodes without a
// through-path just get cut.
// Threshold: drag back-and-forth quickly (>=3 direction reversals within ~600ms
// with >6px per segment). Undo = one {type:"shake"} entry (cut + added).
// ---------------------------------------------------------------------------

function attachShakeDisconnect(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  handlers: ReteGraphHandlers,
  undoManager: UndoManager,
): void {
  let trackingId: string | null = null;
  let shakeFired = false;
  let buf: { x: number; y: number; t: number }[] = [];

  const reset = () => {
    trackingId = null;
    shakeFired = false;
    buf = [];
  };

  const shakeNode = async (id: string) => {
    const node = editor.getNode(id) as CylNode | undefined;
    if (!node) return;

    // 1. Record + cut every connection touching this node.
    const touching = editor.getConnections().filter((c) => c.source === id || c.target === id);
    const cutRefs: ConnectionRef[] = touching.map((c) => ({
      source: c.source,
      sourceOutput: c.sourceOutput,
      target: c.target,
      targetInput: c.targetInput,
    }));
    for (const c of touching) {
      const src = (editor.getNode(c.source) as CylNode | undefined)?.label ?? c.source;
      const tgt = (editor.getNode(c.target) as CylNode | undefined)?.label ?? c.target;
      await editor.removeConnection(c.id);
      log(`shake cut ${c.id} (${src} -> ${tgt})`);
    }

    // 2. Heal each A -> node -> B path into a direct A -> B (keep the original
    //    sourceOutput/targetInput, e.g. input.in1 -> null1 -> output.out1 becomes
    //    input.in1 -> output.out1). Only when A's output socket type matches B's
    //    input socket type and B's target slot is free; multi-port nodes without
    //    a through-path just get cut.
    const ins = touching.filter((c) => c.target === id);
    const outs = touching.filter((c) => c.source === id);
    const addedRefs: ConnectionRef[] = [];
    const healed: Set<string> = new Set(); // B target slot already reconnected
    for (const inc of ins) {
      const a = editor.getNode(inc.source) as CylNode | undefined;
      if (!a) continue;
      const aOut = a.outputs?.[inc.sourceOutput];
      if (!aOut) continue;
      for (const outc of outs) {
        const b = editor.getNode(outc.target) as CylNode | undefined;
        if (!b) continue;
        const bIn = b.inputs?.[outc.targetInput];
        if (!bIn || bIn.socket.name !== aOut.socket.name) continue;
        const slot = `${outc.target}:${outc.targetInput}`;
        if (healed.has(slot)) continue;
        const inFree = !editor.getConnections().some((c) => c.target === outc.target && c.targetInput === outc.targetInput);
        if (!inFree) continue;
        await editor.addConnection(
          new ClassicPreset.Connection(a, inc.sourceOutput, b, outc.targetInput) as unknown as Schemes["Connection"],
        );
        addedRefs.push({ source: inc.source, sourceOutput: inc.sourceOutput, target: outc.target, targetInput: outc.targetInput });
        healed.add(slot);
        log(`shake heal: ${a.label}.${inc.sourceOutput} -> ${b.label}.${outc.targetInput}`);
        break;
      }
    }

    if (cutRefs.length > 0 || addedRefs.length > 0) {
      undoManager.push({ type: "shake", cut: cutRefs, added: addedRefs });
      handlers.onNetworkChanged?.();
    }
  };

  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const target = e.target as Element;
      if (target.closest?.(".cyl-rp-port") || target.closest?.(".cyl-ns") || target.closest?.("button") || target instanceof HTMLInputElement) return;
      const hit = nodeFromTarget(editor, area, target);
      if (!hit) return;
      trackingId = hit.id;
      shakeFired = false;
      buf = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    },
    true,
  );

  container.addEventListener(
    "pointermove",
    (e) => {
      const id = trackingId;
      if (!id || shakeFired) return;
      const now = performance.now();
      buf.push({ x: e.clientX, y: e.clientY, t: now });
      if (buf.length > 8) buf.shift();
      // Only the last ~600ms of movement matters for the reversal pattern.
      const recent = buf.filter((p) => now - p.t <= 600);
      if (recent.length < 5) return;
      let reversals = 0;
      let prev: { dx: number; dy: number } | null = null;
      for (let i = 1; i < recent.length; i++) {
        const dx = recent[i].x - recent[i - 1].x;
        const dy = recent[i].y - recent[i - 1].y;
        if (Math.hypot(dx, dy) < 6) continue; // ignore micro-movements
        if (prev && prev.dx * dx + prev.dy * dy < 0) reversals += 1;
        prev = { dx, dy };
      }
      if (reversals < 3) return;
      shakeFired = true;
      void shakeNode(id);
    },
    true,
  );

  window.addEventListener("pointerup", reset);
  window.addEventListener("pointercancel", reset);
}
