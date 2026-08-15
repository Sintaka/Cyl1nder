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
  applyConnectionBypassVisual,
  getConnectionBypass,
  makeChannelNode,
  makeInputNode,
  makeOutputNode,
  makeProjectNode,
  nodeByKind,
  nodeFromTarget,
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
import type { AreaExtra, NodeKind, ParamSpec, ProjectGraphInput, ReteGraphHandlers, ReteGraph, Schemes } from "./graph-model";
import {
  attachConnectionSelect,
  attachCutMode,
  attachDotGrid,
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
  setNodeStateHandler,
  setRenameHandler,
} from "./graph-interact";
import { cancelGraphInteractions } from "./graph-interact";
import { createGraphUndoManager } from "./graph-undo";

export type { NodeKind, NodeFlags, ParamSpec, SelectedNodeInfo, ReteGraphHandlers, ReteGraph } from "./graph-model";
export type { ProjectGraphInput } from "./graph-model";
export { DEFAULT_FLAGS, CylNode, makeNullNode, makeTransformNode } from "./graph-model";
export { setNodeStateHandler, fireNodeState, setRenameHandler, fireRename, initTooltip, showTooltip, hideTooltip } from "./graph-interact";

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

/** 项目图快照 = serializeGraph() 输出（项目模式含 project/channel → 自动 v3）。 */
export function projectGraphSnapshot(): unknown {
  return activeGraph ? serializeGraph(activeGraph.editor, activeGraph.area) : null;
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
  activeGraph = { editor: g.editor, area: g.area }; // P2b：项目模式无参入口需要图句柄

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
    // P2b：project/channel 标题 v1 禁止改名（NodeView 双击入口也禁用；这里是双保险）。
    // channel 标题与 serial 解耦——标题只镜像成员 label，改名无意义。
    if (self.kind === "project" || self.kind === "channel") {
      log(`rename rejected: ${self.kind} node labels are fixed in v1`);
      return self.label;
    }
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
      // P2b：project/channel 选中不驱动 Spreadsheet/Param 面板刷新——它们无 params，
      // 标题与 serial 解耦；返回 null（面板保持上次内容，与「选中驱动刷新」语义一致）。
      if (sel.kind === "project" || sel.kind === "channel") return null;
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
      notifyNodeChanged();
      return true;
    },
    toggleSelectedConnectionBypass,
    setConnectionBypass,
    markRuntimeActivity,
  };
}