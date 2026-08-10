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

type Schemes = ClassicScheme;
type AreaExtra = ReactArea2D<Schemes>;

export type NodeKind = "input" | "output" | "null";

export interface NodeFlags {
  display: boolean;
  bypass: boolean;
  freeze: boolean;
  wireframe: boolean;
}

export const DEFAULT_FLAGS: NodeFlags = { display: false, bypass: false, freeze: false, wireframe: false };

export interface ReteGraphHandlers {
  onNodePick?: (kind: NodeKind, port: number | null, nodeId: string) => void;
  /** node flags changed (context menu) -> caller refreshes viewport visibility/reference */
  onFlagsChanged?: (kind: NodeKind, flags: NodeFlags) => void;
}

export interface ReteGraph {
  editor: NodeEditor<Schemes>;
  area: AreaPlugin<Schemes, AreaExtra>;
  engine: DataflowEngine<DataflowEngineScheme>;
  destroy(): void;
  setStats(kind: NodeKind, stats: string): void;
  getFlags(kind: NodeKind): NodeFlags | undefined;
  setFlag(kind: NodeKind, key: keyof NodeFlags, value: boolean): NodeFlags | undefined;
  frameSelection(): void;
}

const GEO = "geo";
const log = (m: string) => store.pushLog(`[node] ${m}`);

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
      (f.wireframe ? "⛶" : "")
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
/** Houdini-style unique naming: null, null1, null2… (never reuse a deleted suffix). */
let nullSeq = 0;
export function makeNullNode(): CylNode {
  const name = nullSeq === 0 ? "null" : `null${nullSeq}`;
  nullSeq += 1;
  const n = new CylNode(name, "null");
  n.baseLabel = "null";
  n.addInput("in0", new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
  n.addOutput("out0", new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  return n;
}

// ---------------------------------------------------------------------------
// editor factory
// ---------------------------------------------------------------------------

async function buildGraph(container: HTMLElement, handlers: ReteGraphHandlers) {
  const editor = new NodeEditor<Schemes>();
  const area = new AreaPlugin<Schemes, AreaExtra>(container);
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
  AreaExtensions.selectableNodes(area, AreaExtensions.selector(), { accumulating: AreaExtensions.accumulateOnCtrl() });

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
    },
    true,
  );

  return { editor, area, engine, input, output, react };
}

/** Create the graph; returns a handle with UI helpers. */
export async function createReteGraph(
  container: HTMLElement,
  handlers: ReteGraphHandlers = {},
): Promise<ReteGraph> {
  const g = await buildGraph(container, handlers);

  attachTabSearch(g.editor, g.area, container);
  attachCutMode(g.editor, g.area, container);
  attachFlagMenu(g.editor, g.area, container, (n) => handlers.onFlagsChanged?.(n.kind, { ...n.flags }));
  attachMMBPan(g.area, container);
  attachDotGrid(g.area, container);
  initTooltip(container);
  attachInsertion(g.editor, g.area, container);

  // Houdini display semantics: only ONE node per network may be displayed.
  // Clicking a node's display chip clears all others and lights this one.
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

  return {
    editor: g.editor,
    area: g.area,
    engine: g.engine,
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
    frameSelection: () => {
      const all = g.editor.getNodes();
      const selected = all.filter((n) => (n as ClassicPreset.Node).selected);
      const target = selected.length > 0 ? selected : all;
      if (target.length > 0) void AreaExtensions.zoomAt(g.area, target);
      store.pushLog(`[node] frame ${selected.length > 0 ? `${selected.length} selected` : "all"} nodes`);
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
    const center = { x: 240, y: 120 };
    if (entry.kind === "null") {
      const n = makeNullNode();
      await editor.addNode(n);
      await area.translate(n.id, center);
      log(`created null node ${n.id}`);
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
// Y cut mode: hold Y, click an edge/node to remove
// ---------------------------------------------------------------------------

function attachCutMode(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): void {
  let active = false;
  const isTyping = () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    return el.getClientRects().length > 0;
  };
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "y" || e.repeat || isTyping()) return;
    active = true;
    container.classList.add("cut-mode");
    e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() !== "y") return;
    active = false;
    container.classList.remove("cut-mode");
  });
  area.addPipe((context) => {
    if (!active) return context;
    if (context.type === "pointerdown" && context.data?.event?.target) {
      const target = context.data.event.target as Element;
      const edge = target.closest?.("[data-testid=connection]") ?? target.closest?.("path");
      if (edge) {
        // rete-connection-plugin renders svg paths; find the connection id from DOM
        const connId = edge.closest?.("span")?.querySelector?.("svg")?.getAttribute?.("data-connection-id")
          ?? (edge as SVGElement).getAttribute?.("data-connection-id");
        if (connId) {
          void editor.removeConnection(connId as never);
          log(`cut connection ${connId}`);
          return context;
        }
      }
      const hit = nodeFromTarget(editor, area, target);
      if (hit && hit.node.kind === "null") {
        void editor.removeNode(hit.id);
        log(`removed null node ${hit.id}`);
      }
    }
    return context;
  });
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
      ["wireframe", "Wireframe"],
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

function attachInsertion(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): void {
  let draggingNullId: string | null = null;
  let draggingNullNode: CylNode | null = null;
  let hoverConn: string | null = null;

  // Insertion preview overlay: two dashed lines showing A->mouse->B before release.
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.setAttribute("class", "cyl-insert-preview");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:6;";
  container.appendChild(overlay);
  const dashA = document.createElementNS("http://www.w3.org/2000/svg", "line");
  const dashB = document.createElementNS("http://www.w3.org/2000/svg", "line");
  for (const l of [dashA, dashB]) {
    l.setAttribute("stroke", "#ffd166");
    l.setAttribute("stroke-width", "2");
    l.setAttribute("stroke-dasharray", "7 5");
    overlay.appendChild(l);
  }

  const setHover = (connId: string | null, mouseX = 0, mouseY = 0) => {
    if (hoverConn) {
      area.connectionViews.get(hoverConn)?.element.querySelector("path")?.classList.remove("drop-target");
      hoverConn = null;
    }
    dashA.setAttribute("x1", "0");
    dashA.setAttribute("y1", "0");
    dashA.setAttribute("x2", "0");
    dashA.setAttribute("y2", "0");
    dashB.setAttribute("x1", "0");
    dashB.setAttribute("y1", "0");
    dashB.setAttribute("x2", "0");
    dashB.setAttribute("y2", "0");
    if (!connId) return;
    const view = area.connectionViews.get(connId);
    if (!view) return;
    view.element.querySelector("path")?.classList.add("drop-target");
    hoverConn = connId;
    // dashed preview from source socket -> mouse -> target socket
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
    dashA.setAttribute("x1", String(start.x - rect.left));
    dashA.setAttribute("y1", String(start.y - rect.top));
    dashA.setAttribute("x2", String(mouseX - rect.left));
    dashA.setAttribute("y2", String(mouseY - rect.top));
    dashB.setAttribute("x1", String(mouseX - rect.left));
    dashB.setAttribute("y1", String(mouseY - rect.top));
    dashB.setAttribute("x2", String(end.x - rect.left));
    dashB.setAttribute("y2", String(end.y - rect.top));
  };

  container.addEventListener(
    "pointerdown",
    (e) => {
      const hit = nodeFromTarget(editor, area, e.target as Element);
      if (hit && hit.node.kind === "null") {
        draggingNullId = hit.id;
        draggingNullNode = hit.node;
      }
    },
    true,
  );

  container.addEventListener(
    "pointermove",
    (e) => {
      if (!draggingNullId) return;
      const connId = hitTestConnection(area, e.clientX, e.clientY);
      if (connId !== hoverConn) setHover(connId, e.clientX, e.clientY);
    },
    true,
  );

  const up = () => {
    if (!draggingNullId) return;
    draggingNullId = null;
    const nullNode = draggingNullNode;
    draggingNullNode = null;
    const connId = hoverConn;
    setHover(null);
    if (!connId || !nullNode) return;
    const conn = editor.getConnection(connId) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
    if (!conn) return;
    const srcNode = editor.getNode(conn.source as string) as CylNode | undefined;
    const tgtNode = editor.getNode(conn.target as string) as CylNode | undefined;
    if (!srcNode || !tgtNode) return;
    void (async () => {
      // one-input constraint: drop any existing connection into this null's in0 first
      const existing = editor.getConnections().find(
        (c) => c.target === nullNode.id && c.targetInput === "in0",
      ) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
      if (existing) await editor.removeConnection(existing.id);
      await editor.removeConnection(connId);
      await editor.addConnection(
        new ClassicPreset.Connection(srcNode, conn.sourceOutput as string, nullNode, "in0") as unknown as Schemes["Connection"],
      );
      await editor.addConnection(
        new ClassicPreset.Connection(nullNode, "out0", tgtNode, conn.targetInput as string) as unknown as Schemes["Connection"],
      );
      store.pushLog(`[node] inserted ${nullNode.label} into ${srcNode.label} -> ${tgtNode.label}`);
      // spread the layout: shift every node to the right of the inserted null
      const nullPos = area.nodeViews.get(nullNode.id)?.position;
      if (nullPos) {
        const offset = 180;
        for (const n of editor.getNodes()) {
          if (n.id === nullNode.id) continue;
          const pos = area.nodeViews.get(n.id)?.position;
          if (pos && pos.x > nullPos.x + 30) void area.translate(n.id, { x: pos.x + offset, y: pos.y });
        }
      }
    })();
  };
  window.addEventListener("pointerup", up);
}
