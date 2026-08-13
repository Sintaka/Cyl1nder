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
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { DataflowEngine, type DataflowEngineScheme } from "rete-engine";
import { Presets, ReactPlugin } from "rete-react-plugin";
import { createRoot } from "react-dom/client";
import React from "react";
import { NodeView, notifyNodeChanged, setDisplayHandler } from "./NodeView";
import { store } from "../stores/workspace";
import type { UndoAction } from "./undo";
import {
  CylNode,
  DEFAULT_FLAGS,
  makeInputNode,
  makeOutputNode,
  nodeByKind,
  nodeFromTarget,
  notifySelection,
  onSelectionChange,
  portIndexFromTarget,
  resolveInputSourcePort,
  serializeGraph,
  restoreGraph,
  getNetworkSnapshot,
  log,
} from "./graph-model";
import type { AreaExtra, NodeKind, ParamSpec, ReteGraphHandlers, ReteGraph, Schemes } from "./graph-model";
import {
  attachCutMode,
  attachDotGrid,
  attachFlagMenu,
  attachInsertion,
  attachMMBPan,
  attachReconnect,
  attachRectSelect,
  attachShakeDisconnect,
  attachTabSearch,
  initTooltip,
  setNodeStateHandler,
  setRenameHandler,
} from "./graph-interact";
import { cancelGraphInteractions } from "./graph-interact";
import { createGraphUndoManager } from "./graph-undo";

export type { NodeKind, NodeFlags, ParamSpec, SelectedNodeInfo, ReteGraphHandlers, ReteGraph } from "./graph-model";
export { DEFAULT_FLAGS, CylNode, makeNullNode, makeTransformNode } from "./graph-model";
export { setNodeStateHandler, fireNodeState, setRenameHandler, fireRename, initTooltip, showTooltip, hideTooltip } from "./graph-interact";

async function buildGraph(container: HTMLElement, handlers: ReteGraphHandlers) {
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
  (editor as unknown as { addPipe(mw: (ctx: { type: string; data?: { source?: string; target?: string } }) => unknown): void }).addPipe((ctx) => {
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

  return { editor, area, engine, input, output, react, selectable, connection, cookState, getGraphVersion: () => graphVersion };
}

/** Create the graph; returns a handle with UI helpers. */
export async function createReteGraph(
  container: HTMLElement,
  handlers: ReteGraphHandlers = {},
): Promise<ReteGraph> {
  const g = await buildGraph(container, handlers);

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

  // P2: all wiring (attach*/keydown/display/rename) is registered above; topology
  // changes from here on (drag-connect / Tab-create / restoreGraph / undo replay)
  // must trigger a deferred cook via the pipe's after events.
  g.cookState.ready = true;

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
      return resolveInputSourcePort(g.editor, disp.id);
    },
    getSelectedNode: () => {
      const sel = (g.editor.getNodes() as CylNode[]).find((n) => (n as ClassicPreset.Node).selected);
      if (!sel) return null;
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
    serializeGraph: () => serializeGraph(g.editor, g.area),
    restoreGraph: (data) => restoreGraph(g.editor, g.area, data),
    getGraphVersion: () => g.getGraphVersion(),
    getNetworkSnapshot: () => getNetworkSnapshot(g.editor),
    setNodeParams: (nodeId, params) => {
      const n = g.editor.getNode(nodeId) as CylNode | undefined;
      if (!n) return false;
      n.params = params;
      notifyNodeChanged();
      return true;
    },
  };
}