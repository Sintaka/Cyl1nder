/**
 * Edit -> network -> viewport dataflow (3.3): owns the graph callbacks and the
 * display-focus refresh (refreshNodeFlags) so main.ts only assembles + wires
 * menus/shortcuts. graph/network/viewport/gizmo are late-bound getters because
 * the graph needs `handlers` at construction time (chicken-and-egg).
 */
import { store } from "../stores/workspace";
import { computeNodeResult, findMultiSourceErrors, type NetworkSnapshot } from "../nodes2/network";
import {
  duplicateOutputPortsToNodeErrors,
  findDuplicateOutputPorts,
  mergeNodeErrorMaps,
  multiSourceErrorsToNodeErrors,
  type NodeErrorMap,
} from "../nodes2/graph-model";
import { mappingAddressErrors } from "../nodes2/mapping-types";
import type { ReteGraph, ReteGraphHandlers } from "../nodes2/graph";
import type { ReferenceItem, Viewport } from "../viewport/renderer";
import type { ParamLike } from "./params";
import type { ActiveChains } from "./network";
import type { InputPayload, OutputBuffer } from "../protocol/types";

export interface DataflowDeps {
  getGraph(): ReteGraph;
  getNetwork(): { run(): Promise<void>; isFresh?(): boolean };
  getViewport(): Viewport;
  getGizmo(): { onParamsApplied(nodeId: string, params: ParamLike[]): void; bindToSelection(): void };
  flushParamUndo(): void;
  refreshSelectionPanels(): void;
  /** Publish the resolved active-chain set (display focus + reference flags). */
  setActiveChains(next: ActiveChains): void;
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

/**
 * 从快照里收集 _input_/_output_ 节点的逻辑名（task #8 映射类型校验的输入）。
 *
 * **address 从哪来**：`NetworkSnapshot` 没有顶层 `address` 字段（graph-model 的
 * getNetworkSnapshot 只带 id/kind/label/params），但单端口 _input_/_output_ 的 address
 * 就在 `params` 里（addressParams() 造的 `{name:"address"}`，graph.ts 的 setNodeParams
 * 会把它同步到 CylNode.address）。所以这里读 params——不需要给 network.ts 加字段
 * （那不是本写集），也不用绕去 editor 拿节点。
 *
 * 旧 4 端口图的 _input_/_output_ **没有** address 参数 → 收不到条目 → 零错误，
 * 与改造前逐字一致（旧图不会因为映射系统而突然满屏红三角）。
 */
export function collectAddressEntries(snap: NetworkSnapshot): Array<{ nodeId: string; address: string }> {
  const out: Array<{ nodeId: string; address: string }> = [];
  for (const n of snap.nodes) {
    if (n.kind !== "input" && n.kind !== "output") continue;
    const v = n.params?.find((p) => p.name === "address")?.value;
    if (typeof v !== "string" || v.trim() === "") continue; // 未填写不是错误
    out.push({ nodeId: n.id, address: v });
  }
  return out;
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

  /** Display node object (id + params) via the live editor (ReteGraph exposes editor).
   *  P2b：project/channel 不进 display 分支——它们的 display 是独立模块态（graph.ts 的
   *  channelDisplaySerial），从不设 flags.display；这里过滤后，项目模式下若整图只有项目
   *  节点 → 无 display → 走现有 inputs 回退，不改变任何组可见性，也不报错。 */
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
    const n = nodes.find(
      (x) => x.flags.display && x.kind !== "project" && x.kind !== "channel",
    );
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
    const dispInfo = getDisplayNodeInfo();
    const kind = dispInfo?.kind ?? null;
    // Lazy output: only the chains the viewport ACTUALLY displays cook this frame.
    //   display=output -> out0 only (the displayed port); the output reference
    //     flag keeps ALL 4 output chains live (Houdini shows every out with the
    //     reference overlay on).
    //   otherwise      -> no output chain cooks by default; the output reference
    //     flag still keeps all 4 live.
    //   node           -> the displayed null/transform id: its chain stays live so
    //     the node result / Enter-gizmo target keeps updating while displayed.
    const outRef = deps.getGraph().getFlags("output")?.reference ?? false;
    const outputs: boolean[] =
      kind === "output"
        ? outRef
          ? [true, true, true, true]
          : [true, false, false, false]
        : outRef
          ? [true, true, true, true]
          : [false, false, false, false];
    const node: string | null = kind === "null" || kind === "transform" ? (dispInfo?.id ?? null) : null;
    deps.setActiveChains({ outputs, node });
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
    // 结构性错误上报（v0.1.00117）：每次 cook 后把「一个输入端口被多个源连入」
    // 转成节点错误，红三角与 info 原因由 NodeView 渲染。
    // 放在 flush 里是因为它每次 cook 都跑且手里已有 snapshot；setNodeErrors 是
    // 全量覆盖 + 变化门（错误集没变则零重绘），所以每帧调用不会产生 churn。
    // 注意：不抛、不阻断计算——findFeeder 仍取第一条连接，图照常出结果，
    // 只是把冲突显式告诉用户，而不是静默挑一个。
    // task #8：映射类型错误**必须并进同一次 setNodeErrors**——它是全量覆盖，
    // 分两次调用的话后一次会把前一次的错误全抹掉（每帧互相清除）。
    try {
      const g = deps.getGraph();
      if (g.setNodeErrors) {
        const snap = g.getNetworkSnapshot();
        const structural: NodeErrorMap = multiSourceErrorsToNodeErrors(findMultiSourceErrors(snap));
        // 同步查缓存（mapping-types 的 fetch 在别处 prime），不 await、不阻塞 cook。
        const mapping: NodeErrorMap = mappingAddressErrors(collectAddressEntries(snap));
        // v0.1.00120：同一 serial 的同一个 out 端口被两个 _output_ 抢 → 两边都标红。
        // 用户要求「Cyl1nder 中同一个序列号 out 的同一个端口不可重复, 否则报错」。
        // 同样并进这一次调用：三个产生方分开调 setNodeErrors 会每帧互相擦掉。
        const dupOut: NodeErrorMap = duplicateOutputPortsToNodeErrors(
          findDuplicateOutputPorts(snap.nodes),
        );
        g.setNodeErrors(mergeNodeErrorMaps(structural, mapping, dupOut));
      }
    } catch {
      /* 错误上报本身绝不能打断 cook */
    }
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
