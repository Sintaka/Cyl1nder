/**
 * Edit -> network -> viewport dataflow (3.3): owns the graph callbacks and the
 * display-focus refresh (refreshNodeFlags) so main.ts only assembles + wires
 * menus/shortcuts. graph/network/viewport/gizmo are late-bound getters because
 * the graph needs `handlers` at construction time (chicken-and-egg).
 */
import { store } from "../stores/workspace";
import { computeNodeResult } from "../nodes2/network";
import type { ReteGraph, ReteGraphHandlers } from "../nodes2/graph";
import type { ReferenceItem, Viewport } from "../viewport/renderer";
import type { ParamLike } from "./params";

export interface DataflowDeps {
  getGraph(): ReteGraph;
  getNetwork(): { run(): Promise<void> };
  getViewport(): Viewport;
  getGizmo(): { onParamsApplied(nodeId: string, params: ParamLike[]): void; bindToSelection(): void };
  flushParamUndo(): void;
  refreshSelectionPanels(): void;
}

export interface Dataflow {
  handlers: ReteGraphHandlers;
  refreshNodeFlags(): void;
  flush(): void;
  wireSelection(): void;
}

export function createDataflow(deps: DataflowDeps): Dataflow {
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

  /** Node flags -> viewport: display visibility + reference reference overlays. */
  function refreshNodeFlags(): void {
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
        deps.getViewport().showNodeResult(computeNodeResult(snap, store.inputs, dispNode.id));
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
    onNodePick: (kind, index, _nodeId) => deps.getViewport().pickByNode(kind, index),
    onFlagsChanged: (kind, flags) => {
      store.pushLog(`node ${kind} flags -> ${JSON.stringify(flags)}`);
      refreshNodeFlags();
      // Display flag: default to showing this node's FIRST port data in the viewport
      if (flags.display) deps.getViewport().pickByNode(kind, 0);
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
    deps.getViewport().refresh();
    refreshNodeFlags();
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
