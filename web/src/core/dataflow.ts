/**
 * Edit -> network -> viewport dataflow (3.3): owns the graph callbacks and the
 * display-focus refresh (refreshNodeFlags) so main.ts only assembles + wires
 * menus/shortcuts. graph/network/viewport/gizmo are late-bound getters because
 * the graph needs `handlers` at construction time (chicken-and-egg).
 */
import { store } from "../stores/workspace";
import { computeNodeResult, type NetworkSnapshot } from "../nodes2/network";
import type { ReteGraph, ReteGraphHandlers } from "../nodes2/graph";
import type { ReferenceItem, Viewport } from "../viewport/renderer";
import type { ParamLike } from "./params";
import type { InputPayload, OutputBuffer } from "../protocol/types";

export interface DataflowDeps {
  getGraph(): ReteGraph;
  getNetwork(): { run(): Promise<void>; isFresh?(): boolean };
  getViewport(): Viewport;
  getGizmo(): { onParamsApplied(nodeId: string, params: ParamLike[]): void; bindToSelection(): void };
  flushParamUndo(): void;
  refreshSelectionPanels(): void;
}

export interface Dataflow {
  handlers: ReteGraphHandlers;
  refreshNodeFlags(displayBuffer?: OutputBuffer | null): void;
  flush(): void;
  wireSelection(): void;
}

/**
 * If `displayNodeId`'s out0 connects DIRECTLY into an _output_ node's input
 * socket (out0..out3), return that output index; otherwise null. Lets flush()
 * reuse the already-computed store.outputs[i] buffer for a displayed
 * null/transform (its result is byte-identical to the output buffer) instead of
 * re-tracing + re-cloning the same chain every frame (viewport realtime P1).
 * Callers only use this for null/transform display nodes.
 */
export function displayNodeOutputIndex(snap: NetworkSnapshot, displayNodeId: string): number | null {
  for (const conn of snap.connections) {
    if (conn.source !== displayNodeId || conn.sourceOutput !== "out0") continue;
    const target = snap.nodes.find((n) => n.id === conn.target);
    if (!target || target.kind !== "output") continue;
    const m = /^out([0-3])$/.exec(conn.targetInput);
    if (m) return Number(m[1]);
  }
  return null;
}

export function createDataflow(deps: DataflowDeps): Dataflow {
  /** computeNodeResult through the chain cache (P2): pass the version context
   *  { inputsRev, graphVersion } so a displayed node reuses its cached mutable
   *  points (clone-free translate). Minimal fakes without getGraphVersion (unit
   *  tests) fall back to the bare 3-arg pure call. */
  const computeNodeResultCtx = (
    snap: NetworkSnapshot,
    inputs: InputPayload[],
    nodeId: string,
  ): OutputBuffer | null => {
    const graph = deps.getGraph() as { getGraphVersion?: () => number };
    const gv = typeof graph.getGraphVersion === "function" ? graph.getGraphVersion() : undefined;
    return gv === undefined
      ? computeNodeResult(snap, inputs, nodeId)
      : computeNodeResult(snap, inputs, nodeId, { inputsRev: store.inputRev, graphVersion: gv });
  };

  /** Display node object (id + params) via the live editor (ReteGraph exposes editor). */
  function getDisplayNodeInfo(): {
    id: string;
    kind: string;
    params: ParamLike[];
  } | null {
    const nodes = deps.getGraph().editor.getNodes() as unknown as Array<{
      id: string;
      kind: string;
      params?: ParamLike[];
      flags: { display: boolean };
    }>;
    const n = nodes.find((x) => x.flags.display);
    return n ? { id: n.id, kind: n.kind, params: n.params ?? [] } : null;
  }

  /** Node flags -> viewport: display visibility + reference reference overlays.
   *  flush() passes a PRE-computed `displayBuffer` (reusing store.outputs[i] when
   *  the displayed null/transform is the last node feeding an output port) so the
   *  per-flush chain is traced/cloned exactly once; direct callers (flag change /
   *  network change) omit it and fall back to computing the node result here. */
  function refreshNodeFlags(displayBuffer?: OutputBuffer | null): void {
    // Viewport follows the node-view display flag of WHATEVER node is displayed,
    // at PORT level (not just node kind):
    //   _input_  -> show ONLY the first source input (in0)
    //   null     -> passthrough: show ONLY the input segment wired through it
    //               (graph.getDisplayPortIndex() resolves in0..in3 from the graph;
    //               no in0 connection -> -1 hides every input port)
    //   _output_ -> show ONLY the first output buffer (out0); nothing when Houdini hasn't pushed
    //   no display node -> keep showing inputs (safe source view)
    const disp = deps.getGraph().getDisplayNode();
    const kind = disp?.kind ?? null;
    const hasOutputs = store.outputs.length > 0;
    const showOutputs = kind === "output" && hasOutputs;
    const showInputs = kind === "input" || kind === "null" || kind === "transform" || kind === null;
    deps.getViewport().setVisibility("inputs", showInputs);
    deps.getViewport().setVisibility("outputs", showOutputs);
    if (kind === "null" || kind === "transform") {
      const idx = deps.getGraph().getDisplayPortIndex();
      // a displayed null/transform shows its CURRENT chain output (transformed
      // geometry), not the untransformed source input: hide every input port and
      // render the node result instead; a disconnected display hides both
      deps.getViewport().setDisplayFocus("inputs", -1);
      const dispNode = getDisplayNodeInfo();
      if (idx !== null && dispNode) {
        const snap = deps.getGraph().getNetworkSnapshot();
        // Precomputed by flush() -> reuse without re-tracing; undefined (direct
        // callers) -> compute here as before.
        const result =
          displayBuffer !== undefined
            ? displayBuffer
            : computeNodeResultCtx(snap, store.inputs, dispNode.id);
        deps.getViewport().showNodeResult(result);
      } else {
        deps.getViewport().showNodeResult(null);
      }
    } else if (kind === "input") {
      // _input_ displayed: Houdini shows ONE source - only the first port
      deps.getViewport().showNodeResult(null);
      deps.getViewport().setDisplayFocus("inputs", 0);
    } else {
      deps.getViewport().showNodeResult(null);
      deps.getViewport().setDisplayFocus("inputs", null);
    }
    if (kind === "output") {
      deps.getViewport().setDisplayFocus("outputs", 0); // only the first output buffer
    } else {
      deps.getViewport().setDisplayFocus("outputs", null);
    }

    const inFlags = deps.getGraph().getFlags("input");
    const outFlags = deps.getGraph().getFlags("output");
    const refs: ReferenceItem[] = [];
    if (inFlags?.reference) {
      for (const inp of store.inputs) {
        if (inp.curves.length > 0) refs.push({ points: inp.points, curves: inp.curves, color: 0x4fc3f7 });
      }
    }
    if (outFlags?.reference) {
      const outRefs = store.outputs.flatMap((o) =>
        o.curves.length > 0 ? [{ points: o.points, curves: o.curves, color: 0xff5252 }] : [],
      );
      if (outRefs.length > 0) refs.push(...outRefs);
    }
    deps.getViewport().setReference(refs.length > 0 ? refs : null);
  }

  const handlers: ReteGraphHandlers = {
    onNodePick: (kind, index, _nodeId) => deps.getViewport().pickByNode(kind as "input" | "output" | "null" | "transform", index),
    onFlagsChanged: (kind, flags) => {
      store.pushLog(`node ${kind} flags -> ${JSON.stringify(flags)}`);
      refreshNodeFlags();
      // Display flag: default to showing this node's FIRST port data in the viewport
      if (flags.display) deps.getViewport().pickByNode(kind as "input" | "output" | "null" | "transform", 0);
    },
    onNetworkChanged: () => {
      void deps.getNetwork().run();
      refreshNodeFlags(); // topology changed -> refresh display focus right away
    },
    /** param undo/redo applied -> snap the Enter gizmo back to the reverted node
     *  params (when it is the one being edited) + refresh the selection panels.
     *  params are the affected node's values AFTER the undo/redo mutation. */
    onParamsApplied: (nodeId, params) => {
      deps.getGizmo().onParamsApplied(nodeId, params);
      deps.refreshSelectionPanels();
    },
  };

  function flush(): void {
    // P1 dedup: resolve the displayed null/transform buffer ONCE per flush. When
    // the display's out0 feeds an _output_ port directly, the node result is
    // byte-identical to the already-computed store.outputs[i] -> reuse it (zero
    // extra trace/clone). Otherwise compute the node result here (still once) and
    // hand it down so refreshNodeFlags never re-traces the same chain.
    const dispNode = getDisplayNodeInfo();
    let displayBuffer: OutputBuffer | null | undefined;
    if (
      dispNode &&
      (dispNode.kind === "null" || dispNode.kind === "transform") &&
      deps.getGraph().getDisplayPortIndex() !== null
    ) {
      const snap = deps.getGraph().getNetworkSnapshot();
      const outIdx = displayNodeOutputIndex(snap, dispNode.id);
      // Reuse the cooked output buffer ONLY when it was computed for the CURRENT
      // topology (network.isFresh). After a topology change without a cook (e.g.
      // restoreGraph / drag-connect), outputs are stale -> fall back to computing
      // the node result here (always correct). The Enter-drag hot path always cooks
      // first (pre-render pump), so reuse still avoids the duplicate trace there.
      const net = deps.getNetwork();
      const fresh = !net.isFresh || net.isFresh();
      const matched = outIdx !== null && fresh ? store.outputs.find((o) => o.index === outIdx) : undefined;
      displayBuffer = matched ?? computeNodeResultCtx(snap, store.inputs, dispNode.id);
    }
    // refreshNodeFlags FIRST so the renderer knows the final input/outputGroup
    // visibility before refresh() rebuilds (or safely skips) them; the two are
    // independent (refresh rebuilds groups, refreshNodeFlags sets visibility +
    // node result), and Agent A's renderer.refresh() needs the final visibility
    // to skip hidden outputGroup updates.
    refreshNodeFlags(displayBuffer);
    deps.getViewport().refresh();
    deps.refreshSelectionPanels();
  }

  function wireSelection(): void {
    deps.getGraph().onSelectionChanged(() => {
      deps.flushParamUndo();
      deps.refreshSelectionPanels();
      if (deps.getViewport().isEnterActive()) deps.getGizmo().bindToSelection();
    });
  }

  return { handlers, refreshNodeFlags, flush, wireSelection };
}
