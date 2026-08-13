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

/** Connection feeding `targetInput` on `nodeId`, if any. */
export function findFeeder(
  snap: NetworkSnapshot,
  nodeId: string,
  targetInput: string,
): NetworkConnection | undefined {
  return snap.connections.find((c) => c.target === nodeId && c.targetInput === targetInput);
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
    const j = parseInPort(sourceOutput);
    const base = j !== null ? inputs[j] : undefined;
    return base ? { base, specs: [] } : null;
  }

  if (node.kind === "null" || node.kind === "transform" || node.kind === "dot") {
    const up = findFeeder(snap, node.id, "in0");
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
): ComputeResult {
  if (inputs.length === 0) return { outputs: [], changes: [] };
  if (ctx) return computeOutputsCached(inputs, snap, ctx);
  const outNode = snap.nodes.find((n) => n.kind === "output");
  const outputs: OutputBuffer[] = [];
  for (let i = 0; i < 4; i++) {
    const feeder = outNode ? findFeeder(snap, outNode.id, `out${i}`) : undefined;
    const src = feeder ? nodeById(snap, feeder.source) : undefined;
    const res =
      feeder && src ? traceChain(src, feeder.sourceOutput, inputs, snap, new Set()) : null;
    outputs.push(res ? bufferFromResolved(res, i) : fallbackBuffer(inputs[i], i));
  }
  return { outputs, changes: outputs.map(() => "topology" as const) };
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
