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
  findPortTypeConflicts,
  mergeNodeErrorMaps,
  multiSourceErrorsToNodeErrors,
  portTypeConflictsToNodeErrors,
  type NodeErrorMap,
} from "../nodes2/graph-model";
import { mappingAddressErrors } from "../nodes2/mapping-types";
import { parseParamRef } from "../nodes2/param-ref";
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

/** 一个待写回的 `_output_`：`<address>` + `<port>` 定位映射条目，`type` 决定值形状。 */
export interface WritebackTarget {
  nodeId: string;
  address: string;
  port: string;
  type: string;
}

/**
 * 收集**需要写回**的 `_output_` 节点（v0.1.00125）。
 *
 * 只收非 geo 的：geo 的 `_output_` 走既有几何计算（`computeOutputs` → 桥的 outputs 推送），
 * 那条路本来就通；**float/vec3 此前没有任何落地通路** —— `network.ts:379` 明确跳过非 geo
 * 的 `_output_`，于是用户 output 一个 tx 之后什么也不会发生（这正是他报的现象）。
 *
 * `address`/`port` 任一为空 → 不算目标（没填完不是错误，与 collectAddressEntries 同口径）。
 */
export function collectWritebackTargets(snap: NetworkSnapshot): WritebackTarget[] {
  const out: WritebackTarget[] = [];
  for (const n of snap.nodes) {
    if (n.kind !== "output") continue;
    const get = (name: string): string => {
      const v = n.params?.find((p) => p.name === name)?.value;
      return typeof v === "string" ? v.trim() : "";
    };
    const type = get("type");
    if (type === "" || type === "geo") continue; // geo 走既有几何通路
    const address = get("address");
    const port = get("port");
    if (address === "" || port === "") continue; // 没填完
    out.push({ nodeId: n.id, address, port, type });
  }
  return out;
}

/**
 * 求出一个写回目标该送什么值：沿 `out{k}` 往上找**第一个能给出数值的来源**。
 *
 * 当前只认两种来源，其余返回 `undefined`（= 这次不写，而不是写个 0）：
 * 1. `null` 槽上的引用参数（`ref_slot{k}`）填了**纯数字字面量** → 就写这个数；
 * 2. `transform` 的 `tx/ty/tz` → 按端口序号取对应分量。
 *
 * 为什么不写 0 兜底：`_output_` 没算出值和「值就是 0」是两件事，混同会把用户 Houdini
 * 里的参数悄悄清零 —— 那是不可逆的破坏，比不写坏得多。
 *
 * **不解析相对地址引用**（`transform1/tx` 这种）：那需要向桥读值、是异步的，
 * 而 flush 是同步热路径。地址引用的落地要单独做（`ref` 的取值通路），
 * 此处只覆盖"图里已经有数"的情形。
 */
/**
 * 在**本图内**解析一条通道函数引用（v0.1.00130）。
 *
 * 只处理 `ch("../<节点标签>/<参数名>")` 这一种能同步答出来的情形：`../` 之后的第一段
 * 是同网络里的兄弟节点标签，其余是参数名。节点就在这份 snapshot 里，所以不必打桥。
 *
 * 返回 undefined 的情形一律等于「这次不写」，而**不是**写 0：
 * - 解析失败（写法非法）；
 * - 找不到那个节点（可能指向桥侧的 Houdini 参数，那条路要异步，单独做）；
 * - 找到了但那个参数不是有限数值。
 */
function resolveRefInGraph(
  snap: NetworkSnapshot,
  expr: string,
  /** 图外引用的**同步**查表（v0.1.00133）。由调用方预取好后注入 —— flush 是同步热路径，
   *  这里不能 await。查不到就返回 undefined（= 这次不写），绝不兜底。 */
  externValue?: (address: string) => number | number[] | undefined,
): number | number[] | undefined {
  const parsed = parseParamRef(expr);
  if (!parsed.ok || parsed.address === "") return undefined;
  const seg = parsed.address.split("/").filter((s: string) => s !== "");
  if (seg.length < 2) return undefined; // 需要「节点/参数」两段
  const parmName = seg[seg.length - 1];
  const nodeLabel = seg[seg.length - 2];
  const node = snap.nodes.find((n) => n.label === nodeLabel);
  if (!node) {
    // **不在本图 → 问桥**（v0.1.00133）。web 图里只有用户手搭的那几个节点，
    // Houdini 场景里的节点绝大多数没有对应物，所以「找不到」是常态而不是错误。
    // 逻辑名就是 `parsed.address` 本身（`transform1/tx`），与映射表同一套命名。
    return externValue?.(parsed.address);
  }
  const num = (x: unknown): number | undefined =>
    typeof x === "number" && Number.isFinite(x) ? x : undefined;
  const readParm = (nm: string): unknown => node.params?.find((p) => p.name === nm)?.value;

  const direct = readParm(parmName);
  // 分量引用（`animation.x` / `t.y`）优先：它明确只要一个数
  if (parsed.components.length === 1) {
    const i = parsed.components[0];
    if (Array.isArray(direct)) return num(direct[i]);
    const comp = num(readParm(`${parmName}${"xyz"[i] ?? "x"}`));
    if (comp !== undefined) return comp;
  }
  if (num(direct) !== undefined) return num(direct);
  if (Array.isArray(direct)) {
    const arr = direct.map(num);
    return arr.every((x) => x !== undefined) ? (arr as number[]) : undefined;
  }
  // **vec3 组名自动展开**（v0.1.00131，用户要求「t 需要通过属性系统自动处理 vec3 关系」）。
  //
  // Houdini 里 `t` 是一个 3 元组；我们的图**没有** `t` 这个参数，只有 `tx/ty/tz`
  // （见 param.ts 的 planVecGroups：vec3 只是显示层分组，数据仍是三个 float）。
  // 所以 `ch("../transform1/t")` 必须由这里把三个分量拼起来 —— 这就是「属性系统
  // 自动处理」那一层，写在取值侧而不是让用户改写成三条引用。
  //
  // 缺任一分量 → undefined 而不是补 0：拿两个分量拼出的位姿是**错的**，比不写更坏。
  const xyz = ["x", "y", "z"].map((a) => num(readParm(`${parmName}${a}`)));
  if (xyz.every((x) => x !== undefined)) return xyz as number[];
  return undefined;
}

/**
 * 收集**指向图外**的引用逻辑名（v0.1.00133）。
 *
 * 调用方（main.ts）拿这份清单去桥预取值、填进缓存，下一帧 `resolveWritebackValue`
 * 就能同步查到。**只收真的不在本图的**：图内的兄弟节点已经能同步解析，
 * 把它们也算进来会白打一堆桥请求。
 */
/**
 * 从每个 `_output_` 沿入线往上走，收集**可达**的节点 id（v0.1.00138）。
 *
 * 「需要向桥取值」的判据只有一个：这个值最终要被写回。没接到任何 `_output_` 的
 * `_input_`/`null`，它的值没人要 —— 一次请求都不该发。
 */
function nodesFeedingOutputs(snap: NetworkSnapshot): Set<string> {
  const reached = new Set<string>();
  const queue = snap.nodes.filter((n) => n.kind === "output").map((n) => n.id);
  while (queue.length > 0) {
    const id = queue.pop() as string;
    if (reached.has(id)) continue; // 也是防环（null 接成环在图上画得出来）
    reached.add(id);
    for (const c of snap.connections) {
      if (c.target === id && !reached.has(c.source)) queue.push(c.source);
    }
  }
  return reached;
}

export function collectExternRefAddresses(snap: NetworkSnapshot): string[] {
  const out = new Set<string>();
  const labels = new Set(snap.nodes.map((n) => n.label));
  // **只收「真的被需要」的地址**（v0.1.00138 收紧）。
  //
  // v0.1.00137 我无条件收每个 `_input_` 的端口 —— 包括**谁都不喂**的 input。
  // 后果：几乎任何项目一打开就有图外地址 → 2s 轮询常驻 → 每次都打桥。
  // 全量 e2e 里这条流量把 `.cyl-status` 的握手挤掉过两次（round12 连挂两回）。
  //
  // 判据改成**可达性**：从每个 `_output_` 沿入线往上走，只有走到的节点才需要取值。
  // 没接到任何 `_output_` 的 input，它的值没人要，一次请求都不该发。
  const needed = nodesFeedingOutputs(snap);
  for (const n of snap.nodes) {
    if (!needed.has(n.id)) continue;
    if (n.kind === "input") {
      const port = n.params?.find((p) => p.name === "port")?.value;
      const name = typeof port === "string" ? port.trim() : "";
      if (name !== "") out.add(name);
      continue;
    }
    if (n.kind !== "null") continue;
    for (const p of n.params ?? []) {
      if (!p.name.startsWith("ref_slot")) continue;
      const raw = typeof p.value === "string" ? p.value.trim() : "";
      if (raw === "" || /^-?\d+(\.\d+)?$/.test(raw)) continue; // 空或字面量：不需要取
      const parsed = parseParamRef(raw);
      if (!parsed.ok || parsed.address === "") continue;
      const seg = parsed.address.split("/").filter((s: string) => s !== "");
      if (seg.length < 2) continue;
      if (labels.has(seg[seg.length - 2])) continue; // 图内 → 同步解析，不必问桥
      out.add(parsed.address);
    }
  }
  return [...out];
}

/**
 * 取某个 null 槽的**流入值**（v0.1.00138）：沿该槽的入线往上一层，递归解析。
 *
 * 防环用 `seen`：null 接成环（A.out0 → B.in0，B.out0 → A.in0）在图上是可画的，
 * 没有它会栈溢出。命中环 → undefined = 这次不写，与「解析不到」同一个归宿。
 */
function valueFromSlotFeeder(
  snap: NetworkSnapshot,
  nullNode: { id: string },
  slot: number,
  externValue: ((address: string) => number | number[] | undefined) | undefined,
  seen: Set<string> | undefined,
): number | number[] | undefined {
  const visited = seen ?? new Set<string>();
  if (visited.has(nullNode.id)) return undefined; // 环
  visited.add(nullNode.id);
  const up = snap.connections.find(
    (c) => c.target === nullNode.id && c.targetInput === `in${slot}`,
  );
  if (!up) return undefined; // 该槽没接线 → 无流入值
  // **按这根线**解析，不能回头调 `resolveWritebackValue(nodeId: null 的 id)`：
  // 那个入口是 `find(c => c.target === nodeId)` —— 取的是**任意**一根入线，
  // 于是槽 1 会解析出槽 0 的上游（「看着对、算错」）。
  return valueFromConnection(snap, up, externValue, visited);
}

export function resolveWritebackValue(
  snap: NetworkSnapshot,
  target: WritebackTarget,
  /** 图外引用的同步查表（v0.1.00133）：由 main.ts 预取好后注入，见 resolveRefInGraph。 */
  externValue?: (address: string) => number | number[] | undefined,
  /** 已访问过的节点 id（v0.1.00138 透传时防环）。调用方**不必**传。 */
  seen?: Set<string>,
): number | number[] | undefined {
  const conn = snap.connections.find((c) => c.target === target.nodeId);
  if (!conn) return undefined; // _output_ 没接线 → 无源
  return valueFromConnection(snap, conn, externValue, seen);
}

/** 沿**一根具体的线**往上取值。`resolveWritebackValue` 与槽透传共用它，
 *  所以「谁能当源」的分支只有这一处，两条路径不可能各自漂移。 */
function valueFromConnection(
  snap: NetworkSnapshot,
  conn: { source: string; sourceOutput: string },
  externValue: ((address: string) => number | number[] | undefined) | undefined,
  seen: Set<string> | undefined,
): number | number[] | undefined {
  const src = snap.nodes.find((n) => n.id === conn.source);
  if (!src) return undefined;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const paramNum = (name: string): number | undefined =>
    num(src.params?.find((p) => p.name === name)?.value);

  if (src.kind === "input") {
    // **`_input_` 作为源**（v0.1.00137）：值从桥来（它的逻辑名就是自己的 `port` 参数）。
    //
    // 此前这里没有 input 分支，于是「`_input_` 直接接 `_output_`」这条链**什么都不写** ——
    // 而那正是 Shift+Enter 造出来的形状（抄同一个 serial+port 再一一连线）。
    // 手势"成功"了、图上线也接好了，却没有任何值流动，是最难自查的那种空转。
    const port = src.params?.find((p) => p.name === "port")?.value;
    const name = typeof port === "string" ? port.trim() : "";
    if (name === "") return undefined; // 端口没选 → 无源（不是错误）
    return externValue?.(name);
  }

  if (src.kind === "transform") {
    const axis = /^out(\d+)$/.exec(conn.sourceOutput || "");
    const i = axis ? Number(axis[1]) : 0;
    return paramNum(["tx", "ty", "tz"][Math.min(i, 2)] ?? "tx");
  }
  if (src.kind === "null") {
    const m = /^out(\d+)$/.exec(conn.sourceOutput || "");
    const slot = m ? Number(m[1]) : 0;
    const raw = src.params?.find((p) => p.name === `ref_slot${slot}`)?.value;
    const t = typeof raw === "string" ? raw.trim() : "";
    if (t === "") {
      // **引用为空 → 透传流入值**（v0.1.00138）。
      //
      // 引用的语义一直是「**覆盖**流入值」（devlog 记过：所以只有已接线的槽才有引用框）。
      // 那么空引用就该等于「不覆盖」——把上游的值原样送出去。此前这里 `return undefined`，
      // 于是 `_input_ → null → _output_` 这条**最基本**的链什么都不写：用户的 `_input_`
      // 在图上接得好好的，却完全不参与。
      return valueFromSlotFeeder(snap, src, slot, externValue, seen);
    }
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t); // 字面量：就写这个数
    // 通道函数引用（v0.1.00130）：`ch("../transform1/tx")` —— 在**本图内**解析。
    //
    // 为什么能同步做：`../名字/参数` 指的是同一网络里的兄弟节点，而那些节点就在
    // 这份 snapshot 里。所以不必向桥读值、不必 await —— flush 是同步热路径。
    // 解析不到（指向图外/桥侧的东西）→ undefined = 这次不写，**绝不兜底写 0**。
    return resolveRefInGraph(snap, t, externValue);
  }
  return undefined;
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
        // v0.1.00121：动态输入端口（null 节点）上的类型冲突。
        //
        // 正常连线时冲突进不来——`canConnectSockets` 在插件层就拒了，用户看到的是
        // 「连不上」（Houdini 本身也是这个行为）。但有两条路**绕过插件**：
        // restoreGraph（读档直接 addConnection）与 undo 重放。那两条路上一条冲突的线
        // 会真的存在，所以这里补一个**只报告、不删线**的检测：删线等于替用户丢数据，
        // 而红三角 + 原因让他自己决定。
        //
        // 它要 editor（不是快照）：类型冲突是 socket 层的事实，快照只带 params。
        const typeConflicts: NodeErrorMap = portTypeConflictsToNodeErrors(
          findPortTypeConflicts(g.editor),
        );
        g.setNodeErrors(mergeNodeErrorMaps(structural, mapping, dupOut, typeConflicts));
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
