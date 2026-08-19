/**
 * Chain-state cache + clone-free translate (viewport realtime P2).
 *
 * Problem: traceChain translated every frame by re-cloning the whole point array
 * (points.map(p => [...p])) for every transform. Houdini evaluates a group once
 * on the node input and only writes P in place for the HIT points; a full (empty)
 * group shifts the whole block in place. This module caches each chain's output
 * state { base, specs, points, memberships, fastPath, change } keyed by output
 * index ("out:<i>") / display node id ("node:<id>") so that:
 *   - sig unchanged + only tx/ty/tz changed -> apply the translate DELTAS in place
 *     to the cached points (all-points: O(P) zero-allocation; grouped: only the
 *     hit points move) and reuse the SAME array every frame;
 *   - sig changed (inputsRev / graphVersion / nodeId / groupExpr / cls) -> full
 *     re-trace and rebuild the entry;
 *   - any chain containing a position-dependent group rule (@P with an operator,
 *     e.g. "@P.y>0") NEVER takes the delta path: its membership can change when
 *     points move, so it always full re-traces.
 *
 * Lazy output (F1, Houdini display-driven cook): each chain is computed with an
 * `active` flag (caller decides from ChainCtx.activeOutputs). An inactive chain
 * with a param-only edit SKIPS the delta entirely (change "none", zero work) and
 * keeps the last-applied specs: entry.specs still holds the params that were
 * actually applied to `points`, so a later active delta (or full re-trace)
 * self-heals by applying the accumulated delta in one pass. Structural changes
 * (miss / sig changed) still re-trace even for inactive chains - they are
 * discrete events that must keep the cache valid.
 *
 * Correctness: translations over a FIXED index set commute, so as long as every
 * spec is @P-free (memberships depend only on indices/attributes, never on
 * positions) adding each spec's delta to the already-composited final output
 * yields exactly the new output.
 *
 * The cached `points` array is shared with the OutputBuffers handed to the store:
 * store.upsertOutputs always replaces + emits (no content dedup) and the viewport
 * position-only update reads the latest values, so sharing one mutable array is
 * safe; client.pushOutputs JSON.stringifies synchronously at call time so later
 * in-place edits never pollute an already-emitted body.
 */
import type { InputPayload, OutputBuffer } from "../protocol/types";
import type { GroupClass } from "./groups";
import { parseGroupExpression, computeSelection } from "./groups";
import { applyTranslateGrouped, applyTranslateDeltaInPlace } from "../tools/transform";
import {
  traceChainSpecs,
  findFeeder,
  nodeById,
  type ChainTrace,
  type NetworkNode,
  type NetworkSnapshot,
  type TransformSpec,
} from "./network";

/** Change grade for one chain (Zeno-stamp style, simplified to three levels):
 *  none = zero work, data = position-only in-place delta, topology = full
 *  re-trace / rebuild. */
export type ChainChange = "none" | "data" | "topology";

/** Output buffers + per-chain change grade (runner hot path uses it to skip
 *  no-op frames and push only what actually changed). */
export interface ComputeResult {
  outputs: OutputBuffer[];
  changes: ChainChange[];
}

/** Version context that invalidates cached chain state: any change forces a full
 *  re-trace (the delta fast path is only valid for translate-only param edits). */
export interface ChainCtx {
  inputsRev: number;
  graphVersion: number;
  /** Per-output-index active flags (out0..out3): false = skip point-level work
   *  (lazy output / Houdini display-driven cook). Defaults to all-active. */
  activeOutputs?: boolean[] | null;
  /** Displayed null/transform node id: any chain whose specs CONTAIN this node
   *  is always active (its result is the displayed data AND feeds the bridge -
   *  Houdini display-driven cook). Keeps a directly-fed output chain live when
   *  the display is the transform itself (round7 param-edit regression). */
  activeNodeId?: string | null;
}

/** Minimal cached chain output handed to the OutputBuffer wrapper. */
export interface CachedChainResult {
  points: number[][];
  base: InputPayload;
  /** Change grade for this chain this run (runner pushes only non-"none"). */
  change: ChainChange;
}

/** One cached chain: the mutable output points + everything needed to (a) detect a
 *  pure-param edit via sig and (b) apply per-spec deltas in place. */
interface CacheEntry {
  key: string;
  sig: string;
  base: InputPayload;
  /** Ordered transform specs (input -> output) with the params LAST APPLIED to points. */
  specs: TransformSpec[];
  /** Cache-owned MUTABLE output points (the chain's current result). */
  points: number[][];
  /** Aligned with specs: null = all points; a Set<number> of hit point indices.
   *  Only meaningful when the entry is fastPath (all specs @P-free). */
  memberships: (Set<number> | null)[];
  /** true when every spec is position-independent -> delta path allowed. */
  fastPath: boolean;
  /** Zeno-stamp grade of the last computation that WROTE this entry: "data" after
   *  an in-place delta, "topology" after a rebuild. "none" runs never touch the
   *  entry (zero work), so they leave the last write grade in place. */
  change: ChainChange;
}

/** Module-level singleton cache (single-graph scene is enough). */
const cache = new Map<string, CacheEntry>();

/** Dead-chain fallback memo (F1 lazy output): "fb:<i>" -> the passthrough buffer
 *  built for output port i + the inputsRev it was built with. Reusing the SAME
 *  buffer object across runs with an unchanged inputsRev (stable object identity)
 *  lets the runner skip unchanged pushes; a new inputsRev rebuilds the buffer. */
const fallbackMemo = new Map<string, { inputsRev: number; buffer: OutputBuffer }>();

/** Clear the whole cache (tests / serial switch). */
export function resetChainCache(): void {
  cache.clear();
}

/** Clear the dead-chain fallback memo (tests / serial switch). The memo holds
 *  per-output passthrough buffers keyed by inputsRev; it must be reset alongside
 *  the chain cache so a fresh context never serves a stale passthrough buffer. */
export function resetFallbackMemo(): void {
  fallbackMemo.clear();
}

/** Change grade for a cached chain key (tests): undefined when no entry exists. */
export function getCacheChange(key: string): ChainChange | undefined {
  return cache.get(key)?.change;
}

/** Test-only: last-APPLIED transform params for a cached key (undefined when no
 *  entry). Lazy-skip runs must NOT move these (they still describe the params that
 *  were applied to `points`), so tests assert this directly. Returns a shallow copy
 *  so callers cannot mutate the live entry. */
export function getCacheEntrySpecs(key: string): TransformSpec[] | undefined {
  return cache.get(key)?.specs.map((s) => ({ ...s }));
}

/** Structural signature: unchanged when only tx/ty/tz moved (param edits). */
function buildSig(ctx: ChainCtx, specs: TransformSpec[]): string {
  return `${ctx.inputsRev}|${ctx.graphVersion}|${specs
    .map((s) => [s.nodeId, s.groupExpr, s.cls, String(s.positionDependent)].join("|"))
    .join(";")}`;
}

/** Full re-trace (existing traceChain + applyTranslateGrouped semantics): apply each
 *  spec in input -> output order to the base points, then derive the fast-path
 *  memberships (filter.all -> null; @P-free rules only need base - they never read
 *  positions). Position-dependent specs store null (never used on the delta path). */
function fullReTrace(traced: ChainTrace): {
  points: number[][];
  memberships: (Set<number> | null)[];
  fastPath: boolean;
} {
  let points = traced.base.points;
  for (const s of traced.specs) {
    points = applyTranslateGrouped(traced.base, points, s.groupExpr, s.cls, s.tx, s.ty, s.tz);
  }
  const memberships = traced.specs.map((s) => {
    if (s.positionDependent) return null; // @P rule: membership may move - never delta
    const filter = parseGroupExpression(s.groupExpr, s.cls);
    if (filter.all) return null; // full-point group -> delta applies to every point
    return computeSelection(filter, {
      points: traced.base.points,
      attributes: traced.base.attributes,
      curves: traced.base.curves,
      faces: traced.base.faces ?? [],
    });
  });
  return { points, memberships, fastPath: traced.specs.every((s) => !s.positionDependent) };
}

/** Empty buffer for a port with no usable input payload (mirrors network.ts). */
function emptyBuffer(index: number): OutputBuffer {
  return { index, rev: 0, pointCount: 0, primCount: 0, points: [], curves: [], faces: [], attributes: {} };
}

/** Historical passthrough: output_i = input_i exactly as received (mirrors network.ts). */
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

/** Wrap a cached chain result into an OutputBuffer (points SHARED with the cache). */
function wrapBuffer(res: CachedChainResult, index: number): OutputBuffer {
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
 * Per-chain cached computation (single chain): structural trace -> sig lookup ->
 * delta fast path (in-place, zero clone) or full re-trace + entry rebuild.
 * `active` = caller decision (ChainCtx.activeOutputs[i] for output chains, always
 * true for the displayed node chain): an inactive chain with a param-only edit
 * lazily skips the delta (change "none", zero work, specs/points untouched), so a
 * non-displayed branch never pays point-level work. A miss / sig change always
 * re-traces + rebuilds (change "topology") - even for inactive chains - to keep the
 * cache valid for discrete input/topology events.
 * Returns null for a dead chain (caller falls back to passthrough).
 */
function computeChainCached(
  node: NetworkNode,
  sourceOutput: string,
  inputs: InputPayload[],
  snap: NetworkSnapshot,
  ctx: ChainCtx,
  key: string,
  active: boolean,
): CachedChainResult | null {
  // P2b：project/channel 节点**不做 trace**（v1 关联线纯视觉，不参与几何计算）——
  // 即便快照直接含这类节点（正常路径 getNetworkSnapshot 已过滤），也按死链处理：
  // 返回 null 走 passthrough 兜底，不崩。
  if (node.kind === "project" || node.kind === "channel") return null;
  const traced = traceChainSpecs(node, sourceOutput, inputs, snap, new Set());
  if (!traced) return null; // dead chain

  // A chain containing the DISPLAYED node is always active: its result is what
  // the viewport shows AND what the bridge/Houdini recooks, so a param edit on
  // the displayed transform must never be lazily skipped.
  const isActive =
    active || (ctx.activeNodeId != null && traced.specs.some((s) => s.nodeId === ctx.activeNodeId));

  const sig = buildSig(ctx, traced.specs);
  const entry = cache.get(key);

  if (entry && entry.sig === sig) {
    // Param-only edit: same structure -> try the delta fast path.
    const deltas = traced.specs.map((s, i) => ({
      dx: s.tx - entry.specs[i].tx,
      dy: s.ty - entry.specs[i].ty,
      dz: s.tz - entry.specs[i].tz,
    }));
    const anyDelta = deltas.some((d) => d.dx !== 0 || d.dy !== 0 || d.dz !== 0);
    if (!anyDelta) return { points: entry.points, base: entry.base, change: "none" }; // zero work
    if (entry.fastPath) {
      if (!isActive) {
        // Lazy skip (non-displayed branch): reuse cached points unchanged and do
        // NOT move entry.specs - they still hold the params LAST APPLIED to points,
        // so a later active delta (or full re-trace) self-heals.
        return { points: entry.points, base: entry.base, change: "none" };
      }
      for (let i = 0; i < traced.specs.length; i++) {
        const d = deltas[i];
        if (d.dx === 0 && d.dy === 0 && d.dz === 0) continue;
        applyTranslateDeltaInPlace(entry.points, entry.memberships[i], d.dx, d.dy, d.dz);
        entry.specs[i].tx = traced.specs[i].tx;
        entry.specs[i].ty = traced.specs[i].ty;
        entry.specs[i].tz = traced.specs[i].tz;
      }
      entry.change = "data";
      return { points: entry.points, base: entry.base, change: "data" };
    }
    // delta but a @P rule exists: membership may have changed. Active -> full
    // re-trace below; inactive -> lazy skip (same zero-work rule as fastPath).
    if (!isActive) return { points: entry.points, base: entry.base, change: "none" };
  }

  // Miss / sig changed / non-fastPath-with-delta (active) -> full re-trace + rebuild.
  const { points, memberships, fastPath } = fullReTrace(traced);
  const newEntry: CacheEntry = {
    key,
    sig,
    base: traced.base,
    specs: traced.specs.map((s) => ({ ...s })), // own the mutable tx/ty/tz fields
    points,
    memberships,
    fastPath,
    change: "topology",
  };
  cache.set(key, newEntry);
  return { points, base: traced.base, change: "topology" };
}

/**
 * Cached equivalent of computeOutputs: 4 output buffers + dead-chain fallback,
 * per-output-index cache entries ("out:<i>"), clone-free translate on param edits.
 * F1 lazy output: an output index is only `active` when ctx.activeOutputs[i] !==
 * false; inactive live chains skip param-edit deltas (change "none", zero work).
 * Dead chains fall back through the fallbackMemo (stable buffer object per
 * inputsRev) so the runner can skip unchanged pushes.
 */
export function computeOutputsCached(
  inputs: InputPayload[],
  snap: NetworkSnapshot,
  ctx: ChainCtx,
): ComputeResult {
  if (inputs.length === 0) return { outputs: [], changes: [] };
  // 注意与 network.ts:324 的**不对称**（v0.1.00119 记录，刻意不动行为）：
  // 那边选 outNode 时带 `&& isGeoPort(n)`，这里没有。当前**结果等价**——两条路径
  // 追链都经 traceChainSpecs，它在 `_input_` 叶子处 `if (!isGeoPort(node)) return null`
  // （network.ts:208）就把非 geo 端口当死链断掉了，所以这里少一道过滤不产生差异。
  // 但这是**巧合而非设计**：若将来放宽那个叶子检查（例如让 float/vec3 真的流过几何
  // 追链），两条路径会立刻分叉——带 ctx 的缓存路径会把一个非 geo 的 _output_ 选成
  // 追链目标，而无 ctx 路径不会。届时要么两边都加过滤，要么两边都去掉，别只改一边。
  const outNode = snap.nodes.find((n) => n.kind === "output");
  const outputs: OutputBuffer[] = [];
  const changes: ChainChange[] = [];
  for (let i = 0; i < 4; i++) {
    const feeder = outNode ? findFeeder(snap, outNode.id, `out${i}`) : undefined;
    const src = feeder ? nodeById(snap, feeder.source) : undefined;
    const active = ctx.activeOutputs?.[i] ?? true;
    if (feeder && src) {
      const res = computeChainCached(src, feeder.sourceOutput, inputs, snap, ctx, `out:${i}`, active);
      if (res) {
        outputs.push(wrapBuffer(res, i));
        changes.push(res.change);
        continue;
      }
    }
    // Dead chain: passthrough fallback, memoized per output index by inputsRev so
    // the SAME buffer object is reused while the inputs are unchanged.
    const memoKey = `fb:${i}`;
    const memo = fallbackMemo.get(memoKey);
    if (memo && memo.inputsRev === ctx.inputsRev) {
      outputs.push(memo.buffer);
      changes.push("none");
    } else {
      const buffer = fallbackBuffer(inputs[i], i);
      fallbackMemo.set(memoKey, { inputsRev: ctx.inputsRev, buffer });
      outputs.push(buffer);
      changes.push("data");
    }
  }
  return { outputs, changes };
}

/**
 * Cached equivalent of computeNodeResult: the REAL output of a displayed
 * null/transform node (cache key "node:<id>"), clone-free translate on param edits.
 * Broken chain / missing input / non-null-transform node -> null.
 * The displayed node is active by definition, so it always applies deltas.
 */
export function computeNodeResultCached(
  snap: NetworkSnapshot,
  inputs: InputPayload[],
  nodeId: string,
  ctx: ChainCtx,
): OutputBuffer | null {
  const node = nodeById(snap, nodeId);
  if (!node || (node.kind !== "null" && node.kind !== "transform")) return null;
  const res = computeChainCached(node, "out0", inputs, snap, ctx, `node:${nodeId}`, true);
  return res ? wrapBuffer(res, 0) : null;
}
