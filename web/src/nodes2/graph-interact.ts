/**
 * Graph interaction layer (2.2 split): Tab search, Y cut mode, flag menu,
 * MMB pan, dot grid, insertion, rect select, shake disconnect, tooltip, and the
 * node state / rename handlers. All DOM/listener wiring lives here.
 */
import { ClassicPreset, NodeEditor } from "rete";
import { AreaPlugin } from "rete-area-plugin";
import Fuse from "fuse.js";
import { store } from "../stores/workspace";
import { notifyNodeChanged } from "./NodeView";
import type { ConnectionRef, UndoManager } from "./undo";
import type { CylNode, NodeFlags } from "./graph-model";
import {
  log,
  makeDotNode,
  makeNullNode,
  makeTransformNode,
  nodeFromTarget,
  notifySelection,
} from "./graph-model";
import type { AreaExtra, NodeKind, ReteGraphHandlers, Schemes } from "./graph-model";

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
  { kind: "dot", label: "_dot_", desc: "junction dot passthrough 连接点", keywords: "dot junction 连接点 _dot_" },
];
// P2b：project/channel 刻意不出现在 Tab 面板（它们只能由 loadProjectGraph 建立——项目根
// 与成员通道不是可自由创建的图元）；create() 与既有交互对这两种 kind 无特殊逻辑。

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

// ---------------------------------------------------------------------------
// Cross-mode interaction coordination: a connection reconnect gesture claims the
// pointer, so rect-select / shake / insertion must not start while it is busy.
// Window-level Escape (graph.ts) cancels every in-flight gesture via the registry.
// ---------------------------------------------------------------------------
let reconnectPointerActive = false; // pointerdown started on a connection
let reconnectGrabbed = false;       // connection drag is live (preview follows mouse)

/** True while a connection reconnect gesture owns the pointer. */
export function isReconnectBusy(): boolean {
  return reconnectPointerActive || reconnectGrabbed;
}

type InteractionCanceller = () => void;
let interactionCancellers: InteractionCanceller[] = [];

export function registerInteractionCanceller(fn: InteractionCanceller): void {
  if (!interactionCancellers.includes(fn)) interactionCancellers.push(fn);
}

/** Runs every registered Escape-canceller (reconnect / insertion / palette). */
export function cancelGraphInteractions(): void {
  for (const fn of [...interactionCancellers]) fn();
}

export function attachTabSearch(
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
    if (entry.kind === "null" || entry.kind === "transform" || entry.kind === "dot") {
      const make = entry.kind === "transform" ? makeTransformNode : entry.kind === "dot" ? makeDotNode : makeNullNode;
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
  // Window-level Escape (graph.ts) closes the palette too.
  registerInteractionCanceller(close);

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

export function attachCutMode(
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

export function attachFlagMenu(
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
export function setNodeStateHandler(
  fn: ((nodeId: string, key: "display" | "reference" | "bypass" | "freeze") => void) | null,
): void {
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

export function attachMMBPan(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): void {
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

export function attachDotGrid(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): void {
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

export function attachInsertion(
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

  /** Container-local center of a node port socket circle (RefSocket span) -> preview endpoint. */
  const portCenterLocal = (nodeId: string, portId: string, rect: DOMRect): { x: number; y: number } | null => {
    const el = area.nodeViews.get(nodeId)?.element.querySelector(`[data-port-id="${portId}"]`);
    if (!el) return null;
    // [data-port-id] is the whole port row (socket circle + label, ~39px wide);
    // its center is NOT the circle center. Use the RefSocket span (input at the
    // left end, output at the right end) - it hugs the circle.
    const sock = el.querySelector(":scope > span.input, :scope > span.output");
    const target = (sock ?? el) as Element;
    const r = target.getBoundingClientRect();
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
      if (e.button !== 0) return;
      if (isReconnectBusy()) return; // reconnect grab owns the pointer
      const target = e.target as Element;
      // Only dragging the node BODY (title/head/stats) starts insertion
      // tracking - ports/sockets, chips, buttons and the rename input must not.
      if (
        target.closest?.(".cyl-rp-port") ||
        target.closest?.(".cyl-ns") ||
        target.closest?.("button") ||
        target.closest?.(".cyl-rp-rename") ||
        target instanceof HTMLInputElement
      ) return;
      const hit = nodeFromTarget(editor, area, target);
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
    if (srcNode.id === node.id || tgtNode.id === node.id) {
      log(`insert skipped: dragged node ${node.label} is an endpoint of the hovered connection`);
      return;
    }
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

  // Window-level Escape (graph.ts) cancels an in-progress drag-insert gesture.
  registerInteractionCanceller(() => {
    if (!draggingNodeId) return;
    draggingNodeId = null;
    draggingNode = null;
    setHover(null);
  });
}

// ---------------------------------------------------------------------------
// LMB drag on blank canvas = rectangle multi-select (rete nodes)
// ---------------------------------------------------------------------------

export function attachRectSelect(
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
      if (target.closest('[data-testid="connection"]')) return; // connection click/reconnect, not rect select
      if (isReconnectBusy()) return; // reconnect grab owns the pointer
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
// Threshold: drag back-and-forth (>=3 direction reversals within ~1000ms with
// >4px per segment; a slower real-mouse shake keeps enough points in the buffer).
// Undo = one {type:"shake"} entry (cut + added).
// ---------------------------------------------------------------------------

export function attachShakeDisconnect(
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
        if (a.id === b.id) continue; // never heal into a self-loop
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
      if (isReconnectBusy()) return; // reconnect grab owns the pointer
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
      if (buf.length > 24) buf.shift();
      // Only the last ~1000ms of movement matters for the reversal pattern.
      const recent = buf.filter((p) => now - p.t <= 1000);
      if (recent.length < 4) return;
      let reversals = 0;
      let prev: { dx: number; dy: number } | null = null;
      for (let i = 1; i < recent.length; i++) {
        const dx = recent[i].x - recent[i - 1].x;
        const dy = recent[i].y - recent[i - 1].y;
        if (Math.hypot(dx, dy) < 4) continue; // ignore micro-movements
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
// ---------------------------------------------------------------------------
// Connection selection: a plain click (no drag, no modifiers) on a wire selects
// it with a bright highlight. B-key toggles bypass on the selected wire (see
// graph.toggleSelectedConnectionBypass). Clicking blank/node/port or Esc clears
// the selection. Selection is independent of node selection (never touches
// `node.selected`).
// ---------------------------------------------------------------------------
let selectedConnId: string | null = null;

export function getSelectedConnectionId(): string | null {
  return selectedConnId;
}

function connectionPathEl(area: AreaPlugin<Schemes, AreaExtra>, id: string): Element | null {
  return area.connectionViews.get(id)?.element.querySelector("path") ?? null;
}

function selectConnection(area: AreaPlugin<Schemes, AreaExtra>, id: string): void {
  if (selectedConnId === id) return;
  if (selectedConnId) connectionPathEl(area, selectedConnId)?.classList.remove("cyl-wire-selected");
  selectedConnId = id;
  connectionPathEl(area, id)?.classList.add("cyl-wire-selected");
}

export function clearConnectionSelection(area: AreaPlugin<Schemes, AreaExtra>): void {
  if (!selectedConnId) return;
  connectionPathEl(area, selectedConnId)?.classList.remove("cyl-wire-selected");
  selectedConnId = null;
}

/** Wire-selection plumbing: a pointerdown on anything that is NOT a connection
 *  (node body / port / blank) clears the selection. The actual select happens in
 *  attachReconnect's plain-click up; Esc clears via the interaction canceller. */
export function attachConnectionSelect(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): void {
  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const target = e.target as Element;
      if (target.closest?.('[data-testid="connection"]')) return; // connection click -> handled by reconnect select
      clearConnectionSelection(area);
    },
    true,
  );
  registerInteractionCanceller(() => clearConnectionSelection(area));
}

// ---------------------------------------------------------------------------
// Connection reconnect: grab an existing connection (pointerdown + drag >6px),
// preview a re-route through the mouse with flowing dashed curves, then confirm
// on release-over-a-port (while holding) or on a follow-up click (after release).
// ESC / click-on-blank cancels; Ctrl+click on a connection splices a _dot_ node.
// ---------------------------------------------------------------------------

interface PortHit {
  nodeId: string;
  key: string;
  side: "input" | "output";
}

/** Nearest port socket circle center to (mouseX, mouseY) within threshold px
 *  (screen space), or null. Uses the RefSocket span like the insertion preview. */
function hitTestPort(
  area: AreaPlugin<Schemes, AreaExtra>,
  mouseX: number,
  mouseY: number,
  threshold = 20,
): { hit: PortHit; x: number; y: number } | null {
  let best: { hit: PortHit; x: number; y: number } | null = null;
  let bestDist = threshold;
  for (const [nodeId, view] of area.nodeViews) {
    const els = view.element.querySelectorAll<HTMLElement>("[data-port-id]");
    for (const el of els) {
      const key = el.getAttribute("data-port-id") ?? "";
      if (!key) continue;
      const sock = el.querySelector(":scope > span.input, :scope > span.output");
      const target = (sock ?? el) as HTMLElement;
      const r = target.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = Math.hypot(cx - mouseX, cy - mouseY);
      if (dist <= bestDist) {
        bestDist = dist;
        best = {
          hit: {
            nodeId,
            key,
            side: sock ? (sock.classList.contains("output") ? "output" : "input") : "input",
          },
          x: cx,
          y: cy,
        };
      }
    }
  }
  return best;
}

export function attachReconnect(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  handlers: ReteGraphHandlers,
  undoManager: UndoManager,
): void {
  let grabbed = false;
  let holding = false;
  let trackedConnId: string | null = null;
  let grabbedConnId: string | null = null;
  let grabStart = { x: 0, y: 0 };

  // Reconnect preview overlay: two flowing dashed curves (same look as the
  // insert preview; .cyl-reconnect-preview carries the full dash style in CSS so
  // the insertion overlay selector svg.cyl-insert-preview stays unambiguous).
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.setAttribute("class", "cyl-reconnect-preview");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:3;";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  container.appendChild(overlay);
  const previewA = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const previewB = document.createElementNS("http://www.w3.org/2000/svg", "path");
  for (const path of [previewA, previewB]) {
    path.setAttribute("class", "cyl-insert-preview-path");
    overlay.appendChild(path);
  }

  const toLocal = (clientX: number, clientY: number) => {
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  /** Original connection path endpoints in screen space (exact line touch points). */
  const connEndpoints = (connId: string): { start: { x: number; y: number }; end: { x: number; y: number } } | null => {
    const view = area.connectionViews.get(connId);
    const svg = view?.element.querySelector("path") as SVGPathElement | null;
    if (!svg || typeof svg.getTotalLength !== "function") return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const len = svg.getTotalLength();
    const p0 = svg.getPointAtLength(0);
    const p1 = svg.getPointAtLength(len);
    const start = new DOMPoint(p0.x, p0.y).matrixTransform(ctm);
    const end = new DOMPoint(p1.x, p1.y).matrixTransform(ctm);
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
  };

  let hoverPortEl: Element | null = null;
  const setPortHighlight = (port: PortHit | null) => {
    if (hoverPortEl) {
      hoverPortEl.classList.remove("reconnect-hover");
      hoverPortEl = null;
    }
    if (port) {
      const el = area.nodeViews.get(port.nodeId)?.element.querySelector(`[data-port-id="${port.key}"]`);
      if (el) {
        el.classList.add("reconnect-hover");
        hoverPortEl = el;
      }
    }
  };

  const markGrabbedPath = (targeted: boolean) => {
    const view = grabbedConnId ? area.connectionViews.get(grabbedConnId) : undefined;
    const path = view?.element.querySelector("path");
    path?.classList.add("reconnect-grabbed");
    if (targeted) path?.classList.add("reconnect-target");
    else path?.classList.remove("reconnect-target");
  };

  /** Dash preview: near a port -> one segment; else the whole line through the mouse. */
  const updatePreview = (clientX: number, clientY: number) => {
    previewA.setAttribute("d", "");
    previewB.setAttribute("d", "");
    if (!grabbed || !grabbedConnId) return;
    const eps = connEndpoints(grabbedConnId);
    if (!eps) return;
    const rect = container.getBoundingClientRect();
    const mouse = toLocal(clientX, clientY);
    const near = hitTestPort(area, clientX, clientY);
    setPortHighlight(near ? near.hit : null);
    markGrabbedPath(!!near);
    const s = { x: eps.start.x - rect.left, y: eps.start.y - rect.top };
    const e = { x: eps.end.x - rect.left, y: eps.end.y - rect.top };
    if (near) {
      const p = toLocal(near.x, near.y);
      if (near.hit.side === "input") {
        // re-target: original source socket -> hovered input port
        previewA.setAttribute("d", connectionPathD(s.x, s.y, p.x, p.y));
      } else {
        // re-source: hovered output port -> original target socket
        previewA.setAttribute("d", connectionPathD(p.x, p.y, e.x, e.y));
      }
    } else {
      // whole line "passes through" the mouse
      previewA.setAttribute("d", connectionPathD(s.x, s.y, mouse.x, mouse.y));
      previewB.setAttribute("d", connectionPathD(mouse.x, mouse.y, e.x, e.y));
    }
  };

  const clearReconnect = () => {
    if (grabbedConnId) {
      const view = area.connectionViews.get(grabbedConnId);
      view?.element.querySelector("path")?.classList.remove("reconnect-grabbed", "reconnect-target");
    }
    setPortHighlight(null);
    grabbed = false;
    holding = false;
    trackedConnId = null;
    grabbedConnId = null;
    reconnectPointerActive = false;
    reconnectGrabbed = false;
    previewA.setAttribute("d", "");
    previewB.setAttribute("d", "");
  };

  const labelOf = (id: string) => (editor.getNode(id) as CylNode | undefined)?.label ?? id;

  /** Re-route the grabbed connection to the hovered port (with undo + replace). */
  const applyReconnect = async (port: PortHit) => {
    const connId = grabbedConnId;
    if (!connId) {
      clearReconnect();
      return;
    }
    const conn = editor.getConnection(connId) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
    if (!conn) {
      clearReconnect();
      return;
    }
    const before: ConnectionRef = {
      source: conn.source,
      sourceOutput: conn.sourceOutput,
      target: conn.target,
      targetInput: conn.targetInput,
    };
    let after: ConnectionRef;
    if (port.side === "input") {
      if (port.nodeId === conn.source) {
        log(`reconnect blocked: self-connection on ${labelOf(port.nodeId)}`);
        clearReconnect();
        return;
      }
      after = { source: conn.source, sourceOutput: conn.sourceOutput, target: port.nodeId, targetInput: port.key };
    } else {
      if (port.nodeId === conn.target) {
        log(`reconnect blocked: self-connection on ${labelOf(port.nodeId)}`);
        clearReconnect();
        return;
      }
      after = { source: port.nodeId, sourceOutput: port.key, target: conn.target, targetInput: conn.targetInput };
    }
    if (
      after.source === before.source &&
      after.sourceOutput === before.sourceOutput &&
      after.target === before.target &&
      after.targetInput === before.targetInput
    ) {
      log("reconnect no-op: same port");
      clearReconnect();
      return;
    }
    // rete Input is single-connection: replacing an occupied target input drops
    // the old feeder first and records it (undo restores both).
    let prevConnection: ConnectionRef | null = null;
    if (port.side === "input") {
      const existing = editor.getConnections().find(
        (c) => c.target === after.target && c.targetInput === after.targetInput && c.id !== connId,
      ) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
      if (existing) {
        prevConnection = {
          source: existing.source,
          sourceOutput: existing.sourceOutput,
          target: existing.target,
          targetInput: existing.targetInput,
        };
        await editor.removeConnection(existing.id);
        log(
          `reconnect replaced ${labelOf(existing.source)}.${existing.sourceOutput} -> ${labelOf(existing.target)}.${existing.targetInput}`,
        );
      }
    }
    const srcNode = editor.getNode(after.source) as CylNode | undefined;
    const tgtNode = editor.getNode(after.target) as CylNode | undefined;
    if (!srcNode || !tgtNode) {
      clearReconnect();
      return;
    }
    await editor.removeConnection(connId);
    await editor.addConnection(
      new ClassicPreset.Connection(srcNode, after.sourceOutput as string, tgtNode, after.targetInput as string) as unknown as Schemes["Connection"],
    );
    undoManager.push({ type: "reconnect", before, after, prevConnection });
    handlers.onNetworkChanged?.();
    log(
      `reconnect ${labelOf(before.source)}.${before.sourceOutput} -> ${labelOf(before.target)}.${before.targetInput} => ${labelOf(after.source)}.${after.sourceOutput} -> ${labelOf(after.target)}.${after.targetInput}`,
    );
    clearReconnect();
  };

  /** Ctrl+click on a connection: splice a _dot_ junction node into it. */
  const insertDotAt = async (connId: string, clientX: number, clientY: number) => {
    const conn = editor.getConnection(connId) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
    if (!conn) return;
    const srcNode = editor.getNode(conn.source) as CylNode | undefined;
    const tgtNode = editor.getNode(conn.target) as CylNode | undefined;
    if (!srcNode || !tgtNode) return;
    const before: ConnectionRef = {
      source: conn.source,
      sourceOutput: conn.sourceOutput,
      target: conn.target,
      targetInput: conn.targetInput,
    };
    const dot = makeDotNode();
    const rect = container.getBoundingClientRect();
    const t = area.area.transform;
    const pos = { x: (clientX - rect.left - t.x) / t.k, y: (clientY - rect.top - t.y) / t.k };
    await editor.removeConnection(connId);
    await editor.addNode(dot);
    await area.translate(dot.id, pos);
    await editor.addConnection(
      new ClassicPreset.Connection(srcNode, conn.sourceOutput as string, dot, "in0") as unknown as Schemes["Connection"],
    );
    await editor.addConnection(
      new ClassicPreset.Connection(dot, "out0", tgtNode, conn.targetInput as string) as unknown as Schemes["Connection"],
    );
    undoManager.push({ type: "dot-add", nodeId: dot.id, nodeLabel: dot.label, connection: before, x: pos.x, y: pos.y });
    handlers.onNetworkChanged?.();
    log(`dot-add ${dot.label} spliced into ${srcNode.label} -> ${tgtNode.label}`);
  };

  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const target = e.target as Element;
      // Confirm a previously-released grab: near a port = apply, blank = cancel.
      if (grabbed && !holding) {
        e.preventDefault();
        e.stopPropagation();
        const port = hitTestPort(area, e.clientX, e.clientY);
        if (port) void applyReconnect(port.hit);
        else clearReconnect();
        return;
      }
      // Ports/sockets belong to the ConnectionPlugin and node bodies to node drag
      // (both can sit within 14px of a connection line), so a pointerdown on them
      // must never start a reconnect grab or dot-splice.
      if (target.closest?.(".cyl-rp-port")) return;
      if (nodeFromTarget(editor, area, target)) return;
      // Ctrl+click on a connection -> splice a _dot_ junction node right there.
      if (e.ctrlKey) {
        const connId = hitTestConnection(area, e.clientX, e.clientY);
        if (connId) {
          e.preventDefault();
          e.stopPropagation();
          void insertDotAt(connId, e.clientX, e.clientY);
        }
        return;
      }
      // Start tracking a grab: pointerdown on an existing connection (left button).
      const connId = hitTestConnection(area, e.clientX, e.clientY);
      if (connId) {
        e.preventDefault();
        e.stopPropagation();
        trackedConnId = connId;
        holding = true;
        grabStart = { x: e.clientX, y: e.clientY };
        reconnectPointerActive = true;
      }
    },
    true,
  );

  container.addEventListener(
    "pointermove",
    (e) => {
      lastGraphMouse = { x: e.clientX, y: e.clientY };
      if (grabbed && grabbedConnId) {
        updatePreview(e.clientX, e.clientY);
      } else if (trackedConnId && !grabbed) {
        const dx = e.clientX - grabStart.x;
        const dy = e.clientY - grabStart.y;
        if (dx * dx + dy * dy > 36) {
          // crossed the >6px threshold: enter grabbed (button may be released now)
          grabbed = true;
          grabbedConnId = trackedConnId;
          reconnectGrabbed = true;
          markGrabbedPath(false);
          updatePreview(e.clientX, e.clientY);
        }
      }
    },
    true,
  );

  const up = (e: PointerEvent) => {
    if (!trackedConnId && !grabbed) return;
    if (grabbed && holding) {
      holding = false;
      const port = hitTestPort(area, e.clientX, e.clientY);
      if (port) {
        void applyReconnect(port.hit);
      }
      // released over blank: stay grabbed, the preview keeps following the mouse
      return;
    }
    // plain click on a connection (never dragged past the threshold): with no
    // modifier keys this SELECTS the wire (B-key bypass target); anything else
    // just releases the grab.
    if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && trackedConnId) {
      selectConnection(area, trackedConnId);
    }
    clearReconnect();
  };
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", () => {
    if (grabbed || trackedConnId) clearReconnect();
  });

  // Window-level Escape (graph.ts) cancels the reconnect grab.
  registerInteractionCanceller(() => {
    if (grabbed || trackedConnId || reconnectGrabbed || reconnectPointerActive) clearReconnect();
  });
}
