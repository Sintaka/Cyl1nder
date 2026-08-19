/**
 * Pure network computation: trace the rete graph topology (input -> null/transform
 * -> output) and produce the 4 OutputBuffers pushed back to the bridge.
 * v1: null = passthrough; transform = translate points matching its group filter.
 * Any output port with no connected chain falls back to passthrough input_i
 * (preserves the historical 4-output behaviour).
 * DOM-free / unit-testable; graph.ts supplies the snapshot (structural match).
 *
 * P2 (chain-state cache): when an optional `ctx` (inputsRev + graphVersion) is
 * supplied, computeOutputs / computeNodeResult route through the chain cache
 * (chain-cache.ts): a structural trace (traceChainSpecs, no point touching) +
 * a cache hit applies translate DELTAS in place to the cached mutable points
 * instead of re-cloning the whole array every frame. Without ctx the pure
 * full-trace path is preserved (existing unit tests).
 */
import type { InputPayload, OutputBuffer } from "../protocol/types";
import type { GroupClass } from "./groups";
import { parseGroupExpression } from "./groups";
import { applyTranslateGrouped } from "../tools/transform";
import { computeOutputsCached, computeNodeResultCached, type ChainCtx, type ComputeResult } from "./chain-cache";
export type { ComputeResult, ChainChange, ChainCtx } from "./chain-cache";

/** ComputeResult + 可选的结构性错误（多源喂同一端口）。**纯附加**：仍可赋给
 *  ComputeResult，既有调用方（core/network.ts 的 NetworkDeps）与测试无需改动。 */
export interface ComputeResultWithErrors extends ComputeResult {
  /** 人类可读的错误行；无错误时不带该键。 */
  errors?: string[];
}

export interface NetworkNode {
  id: string;
  kind: string; // "input" | "output" | "null" | "transform"
  label: string;
  params: Array<{ name: string; type: string; value: unknown }>;
}

export interface NetworkConnection {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

export interface NetworkSnapshot {
  nodes: NetworkNode[];
  connections: NetworkConnection[];
}

/** One transform step collected during a STRUCTURAL chain trace (no points yet).
 *  Ordered input -> output (upstream first) exactly as traceChain applies them. */
export interface TransformSpec {
  nodeId: string;
  tx: number;
  ty: number;
  tz: number;
  groupExpr: string;
  cls: GroupClass;
  /** true when the group filter contains a position-dependent rule (@P with an
   *  operator, e.g. "@P.y>0"): such membership can change when points move, so
   *  the delta fast path must NOT be used for a chain containing one. */
  positionDependent: boolean;
}

/** Result of traceChainSpecs: the feeding input payload + ordered transform specs. */
export interface ChainTrace {
  base: InputPayload;
  specs: TransformSpec[];
}

const GROUP_CLASSES: readonly GroupClass[] = ["autoguess", "points", "vertices", "prim", "detail"];

/** Read a named param from a node (number for float/int, string for group/class). */
export function paramValue(
  node: NetworkNode,
  name: string,
  fallback: number | string,
): number | string {
  const p = node.params?.find((x) => x.name === name);
  const v = p?.value;
  return typeof v === "number" || typeof v === "string" ? v : fallback;
}

/** Coerce a param read to a finite number (NaN / missing -> 0). */
function asFiniteNumber(v: number | string): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce a class param to a valid GroupClass (unknown -> autoguess). */
function toGroupClass(s: string): GroupClass {
  return (GROUP_CLASSES as readonly string[]).includes(s) ? (s as GroupClass) : "autoguess";
}

/** Connection feeding `targetInput` on `nodeId`, if any. When SEVERAL connections
 *  feed the same port this still returns the first (deterministic, keeps the trace
 *  running); the conflict itself is reported separately by findMultiSourceErrors so
 *  the user can fix it by hand instead of silently getting one arbitrary source. */
export function findFeeder(
  snap: NetworkSnapshot,
  nodeId: string,
  targetInput: string,
): NetworkConnection | undefined {
  return snap.connections.find((c) => c.target === nodeId && c.targetInput === targetInput);
}

/**
 * 取该节点**第一个已接线的输入槽**的连接（按 `in<n>` 的数字序，与创建顺序无关）。
 *
 * 动态输入槽的存在意味着「哪个槽有线」是运行期的事实：用户完全可以只接 in1。
 * 按数字序取第一个已接线的，保证同一张图无论怎么重放都得到同一条链
 * （若按 connections 数组顺序取，撤销重做之后可能换一条上游 —— 那会让缓存签名抖动）。
 * 非动态 kind（transform）只有 in0，结果与直接 findFeeder(…, "in0") 完全相同。
 */
export function firstWiredFeeder(
  snap: NetworkSnapshot,
  nodeId: string,
): NetworkConnection | undefined {
  const mine = snap.connections.filter((c) => c.target === nodeId && /^in\d+$/.test(c.targetInput));
  if (mine.length === 0) return undefined;
  return mine.reduce((best, c) =>
    Number(c.targetInput.slice(2)) < Number(best.targetInput.slice(2)) ? c : best,
  );
}

/**
 * 槽 k 的上游：`out{k}` → `in{k}`（v0.1.00124）。
 *
 * null 是多条**独立**直通通道，所以「哪个输出」直接决定「读哪个输入」。
 * 解析不出槽号时（`out0` 之外的怪键、transform 的单槽情形）退回
 * `firstWiredFeeder`：那是"只接了 in1 也别把链判死"的兜底，与改造前一致。
 */
export function slotFeederFor(
  snap: NetworkSnapshot,
  node: { id: string; kind: string },
  sourceOutput: string,
): NetworkConnection | undefined {
  if (node.kind === "null") {
    const m = /^out(\d+)$/.exec(sourceOutput || "");
    if (m) {
      const k = Number(m[1]);
      const exact = findFeeder(snap, node.id, `in${k}`);
      // 该槽没接线 → 这条通道就是空的，**不要**去借别的槽的数据充数：
      // 那正是「看着对、算错」。返回 undefined 让调用方按死链回退 passthrough。
      return exact;
    }
  }
  return firstWiredFeeder(snap, node.id);
}

/** One input port fed by MORE THAN ONE output (illegal: geometry has no implicit
 *  merge). `sources` lists the competing "<label>.<sourceOutput>" strings. */
export interface MultiSourceError {
  nodeId: string;
  nodeLabel: string;
  targetInput: string;
  sources: string[];
  message: string;
}

/**
 * Detect every input port with >1 incoming connection. Returns [] for the normal
 * single-source and zero-source cases (an unconnected output port keeps falling
 * back to passthrough - existing intended behaviour). Never throws: the caller
 * surfaces these as errors and the user fixes the wiring by hand.
 */
export function findMultiSourceErrors(snap: NetworkSnapshot): MultiSourceError[] {
  const byPort = new Map<string, NetworkConnection[]>();
  for (const c of snap.connections) {
    const key = `${c.target}\u0000${c.targetInput}`;
    const list = byPort.get(key);
    if (list) list.push(c);
    else byPort.set(key, [c]);
  }
  const errors: MultiSourceError[] = [];
  for (const conns of byPort.values()) {
    if (conns.length < 2) continue;
    const target = nodeById(snap, conns[0].target);
    const nodeLabel = target?.label ?? conns[0].target;
    const sources = conns.map((c) => `${nodeById(snap, c.source)?.label ?? c.source}.${c.sourceOutput}`);
    errors.push({
      nodeId: conns[0].target,
      nodeLabel,
      targetInput: conns[0].targetInput,
      sources,
      message: `port ${nodeLabel}.${conns[0].targetInput} has ${conns.length} sources (${sources.join(", ")}): only one connection per input is allowed - remove the extras`,
    });
  }
  return errors;
}

/**
 * Socket data type of an _input_/_output_ node's single port (schema 4 form):
 * read from its `type` param. Legacy 4-port nodes have no `type` param -> "geo",
 * so their geometry behaviour is unchanged.
 */
export function portDataType(node: NetworkNode): string {
  const v = node.params?.find((p) => p.name === "type")?.value;
  return v === "float" || v === "vec3" ? v : "geo";
}

/** True when this node's port carries geometry (the only kind the geometry trace
 *  handles). float/vec3 ports flow through the mapping system by logical name. */
function isGeoPort(node: NetworkNode): boolean {
  return portDataType(node) === "geo";
}

export function nodeById(snap: NetworkSnapshot, id: string): NetworkNode | undefined {
  return snap.nodes.find((n) => n.id === id);
}

/** Parse an _input_ source socket name ("in0".."in3") into its port index. */
function parseInPort(socket: string): number | null {
  const m = /^in(\d+)$/.exec(socket);
  return m ? Number(m[1]) : null;
}

/**
 * A group filter is position-dependent when ANY rule reads point positions
 * (kind "attr", name "P", with an operator - e.g. "@P.y>0"). Bare "@P" / "@P.y"
 * (op === "") are existence rules that match every point, so they are NOT
 * position-dependent. @id/@Cd attr rules, ids rules and group rules never read
 * positions either.
 */
function isPositionDependent(groupExpr: string, cls: GroupClass): boolean {
  const filter = parseGroupExpression(groupExpr, cls);
  if (filter.all) return false;
  return filter.rules.some((r) => r.kind === "attr" && r.name === "P" && r.op !== "");
}

/**
 * STRUCTURAL chain trace (no point touching): walk backwards from `node` (fed
 * downstream via `sourceOutput`) to an _input_ source, collecting each transform
 * node's current tx/ty/tz + group expression + class + position-dependency in
 * input -> output order (upstream first). null/dot pass through. Never calls
 * applyTranslateGrouped - the cached/delta path needs only the spec list.
 * Returns null when the chain is dead (no upstream connection / missing input /
 * cycle) - callers then fall back to passthrough.
 */
export function traceChainSpecs(
  node: NetworkNode,
  sourceOutput: string,
  inputs: InputPayload[],
  snap: NetworkSnapshot,
  visited: Set<string>,
): ChainTrace | null {
  if (visited.has(node.id)) return null; // cycle defence
  visited.add(node.id);

  if (node.kind === "input") {
    // 非 geo 端口（float/vec3）不参与几何计算：按死链处理（调用方回退 passthrough）。
    // 它们的值经映射系统按逻辑名流转，不进几何 trace。
    if (!isGeoPort(node)) return null;
    const j = parseInPort(sourceOutput);
    const base = j !== null ? inputs[j] : undefined;
    return base ? { base, specs: [] } : null;
  }

  if (node.kind === "null" || node.kind === "transform") {
    // `null` = **多条互相独立的直通通道**（v0.1.00124）。槽 k 的 `out{k}` 只看槽 k 的
    // `in{k}`，槽与槽之间毫无关系 —— 所以它们各自可以是不同类型（一个 geo、一个 float）。
    //
    // 刻意**不做合并**：几何合并属于 Houdini 的 merge SOP，不该在这里重新发明
    // （用户明确说「merge 在 houdini sop 中更多是对几何体操作, 先不考虑」）。
    // 一旦 null 是"多通道直通"而不是"多入单出的 merge"，每槽独立类型就不再需要
    // 任何合并语义 —— 这正是此前把它当 merge 时解不开的那个结。
    //
    // `sourceOutput` 现在**真的被用上了**：`out2` 追槽 2。此前恒取第一个已接线的槽，
    // 于是 `out2` 会算出槽 0 的数据 —— 「看着对、算错」。
    // transform 只有一个槽，`out0`→`in0`，行为逐字不变。
    const up = slotFeederFor(snap, node, sourceOutput);
    const upNode = up ? nodeById(snap, up.source) : undefined;
    if (!up || !upNode) return null;
    const res = traceChainSpecs(upNode, up.sourceOutput, inputs, snap, visited);
    if (!res) return null;
    if (node.kind === "transform") {
      const tx = asFiniteNumber(paramValue(node, "tx", 0));
      const ty = asFiniteNumber(paramValue(node, "ty", 0));
      const tz = asFiniteNumber(paramValue(node, "tz", 0));
      const groupExpr = String(paramValue(node, "group", ""));
      const cls = toGroupClass(String(paramValue(node, "class", "autoguess")));
      return {
        base: res.base,
        specs: [
          ...res.specs,
          { nodeId: node.id, tx, ty, tz, groupExpr, cls, positionDependent: isPositionDependent(groupExpr, cls) },
        ],
      };
    }
    return res; // null = passthrough
  }

  return null; // output (or unknown kind) mid-chain -> dead chain
}

/** Empty buffer for a port with no usable input payload. */
function emptyBuffer(index: number): OutputBuffer {
  return { index, rev: 0, pointCount: 0, primCount: 0, points: [], curves: [], faces: [], attributes: {} };
}

/** Historical passthrough: output_i = input_i exactly as received. */
function fallbackBuffer(input: InputPayload | undefined, index: number): OutputBuffer {
  if (!input) return emptyBuffer(index);
  return {
    index,
    rev: 0,
    pointCount: input.pointCount,
    primCount: input.primCount,
    points: input.points,
    curves: input.curves,
    faces: input.faces ?? [],
    attributes: input.attributes,
  };
}

interface Resolved {
  base: InputPayload;
  points: number[][];
}

/**
 * Trace a chain backwards from `node` (fed downstream via `sourceOutput`) to an
 * _input_ source, applying transform nodes in order (input -> output) along the
 * way: each transform translates the CURRENT points while `base` keeps providing
 * attributes/topology for group matching. null nodes pass through.
 * Returns null when the chain is dead (no upstream connection / missing input /
 * cycle) - callers then fall back to passthrough.
 */
function traceChain(
  node: NetworkNode,
  sourceOutput: string,
  inputs: InputPayload[],
  snap: NetworkSnapshot,
  visited: Set<string>,
): Resolved | null {
  const traced = traceChainSpecs(node, sourceOutput, inputs, snap, visited);
  if (!traced) return null;
  let points = traced.base.points;
  for (const s of traced.specs) {
    points = applyTranslateGrouped(traced.base, points, s.groupExpr, s.cls, s.tx, s.ty, s.tz);
  }
  return { base: traced.base, points };
}

/** Wrap resolved chain points into an OutputBuffer for output port `index`. */
function bufferFromResolved(res: Resolved, index: number): OutputBuffer {
  return {
    index,
    rev: 0,
    pointCount: res.points.length,
    primCount: res.base.primCount,
    points: res.points,
    curves: res.base.curves,
    faces: res.base.faces ?? [],
    attributes: res.base.attributes,
  };
}

/**
 * Compute the 4 output buffers (index 0..3) from the current inputs + graph topology.
 * For each output port out0..out3, traces the _output_ node's input back through
 * null (passthrough) / transform (translate via applyTranslateGrouped) chains to
 * the feeding _input_ source port; a missing/dead chain falls back to input_i.
 * Returns [] when there are no inputs.
 * `ctx` (P2): when supplied, routes through the chain cache (clone-free delta
 * translates). Without ctx the pure full-trace path runs (existing tests).
 */
export function computeOutputsDetailed(
  inputs: InputPayload[],
  snap: NetworkSnapshot,
  ctx?: ChainCtx,
): ComputeResultWithErrors {
  if (inputs.length === 0) return { outputs: [], changes: [] };
  // 一个输入端口被多个输出喂 → 报错让用户手动改（不抛、不静默取第一条）。
  const errors = findMultiSourceErrors(snap).map((e) => e.message);
  const withErrors = (res: ComputeResult): ComputeResultWithErrors =>
    errors.length > 0 ? { ...res, errors } : res;
  if (ctx) return withErrors(computeOutputsCached(inputs, snap, ctx));
  // 非 geo 的 _output_（float/vec3）不参与几何计算：整体回退 passthrough。
  const outNode = snap.nodes.find((n) => n.kind === "output" && isGeoPort(n));
  const outputs: OutputBuffer[] = [];
  for (let i = 0; i < 4; i++) {
    const feeder = outNode ? findFeeder(snap, outNode.id, `out${i}`) : undefined;
    const src = feeder ? nodeById(snap, feeder.source) : undefined;
    const res =
      feeder && src ? traceChain(src, feeder.sourceOutput, inputs, snap, new Set()) : null;
    outputs.push(res ? bufferFromResolved(res, i) : fallbackBuffer(inputs[i], i));
  }
  return withErrors({ outputs, changes: outputs.map(() => "topology" as const) });
}

/** Compute the 4 output buffers (index 0..3); array form kept for existing tests
 *  and callers that only need the buffers (change grade lives in Detailed). */
export function computeOutputs(
  inputs: InputPayload[],
  snap: NetworkSnapshot,
  ctx?: ChainCtx,
): OutputBuffer[] {
  return computeOutputsDetailed(inputs, snap, ctx).outputs;
}

/**
 * Compute the REAL output of a single node (display viewport): trace the node's
 * in0 chain back to its _input_ source, applying transform translations along the
 * way (null = passthrough). Unlike computeOutputs this returns the transformed
 * geometry of the requested node itself, so a displayed transform/null shows the
 * current chain result instead of the untransformed source input. Broken chain /
 * missing input / non-null-transform node -> null.
 * `ctx` (P2): when supplied, routes through the chain cache (key "node:<id>").
 */
export function computeNodeResult(
  snap: NetworkSnapshot,
  inputs: InputPayload[],
  nodeId: string,
  ctx?: ChainCtx,
): OutputBuffer | null {
  if (ctx) return computeNodeResultCached(snap, inputs, nodeId, ctx);
  const node = nodeById(snap, nodeId);
  if (!node || (node.kind !== "null" && node.kind !== "transform")) return null;
  const res = traceChain(node, "out0", inputs, snap, new Set());
  return res ? bufferFromResolved(res, 0) : null;
}
