/**
 * Chain-state cache + clone-free translate (viewport realtime P2).
 *
 * Problem: traceChain translated every frame by re-cloning the whole point array
 * (points.map(p => [...p])) for every transform. Houdini evaluates a group once
 * on the node input and only writes P in place for the HIT points; a full (empty)
 * group shifts the whole block in place. This module caches each chain's output
 * state { base, specs, points, memberships, fastPath } keyed by output index
 * ("out:<i>") / display node id ("node:<id>") so that:
 *   - sig unchanged + only tx/ty/tz changed -> apply the translate DELTAS in place
 *     to the cached points (all-points: O(P) zero-allocation; grouped: only the
 *     hit points move) and reuse the SAME array every frame;
 *   - sig changed (inputsRev / graphVersion / nodeId / groupExpr / cls) -> full
 *     re-trace and rebuild the entry;
 *   - any chain containing a position-dependent group rule (@P with an operator,
 *     e.g. "@P.y>0") NEVER takes the delta path: its membership can change when
 *     points move, so it always full re-traces.
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

/** Version context that invalidates cached chain state: any change forces a full
 *  re-trace (the delta fast path is only valid for translate-only param edits). */
export interface ChainCtx {
  inputsRev: number;
  graphVersion: number;
}

/** Minimal cached chain output handed to the OutputBuffer wrapper. */
export interface CachedChainResult {
  points: number[][];
  base: InputPayload;
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
}

/** Module-level singleton cache (single-graph scene is enough). */
const cache = new Map<string, CacheEntry>();

/** Clear the whole cache (tests / serial switch). */
export function resetChainCache(): void {
  cache.clear();
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
 * Returns null for a dead chain (caller falls back to passthrough).
 */
function computeChainCached(
  node: NetworkNode,
  sourceOutput: string,
  inputs: InputPayload[],
  snap: NetworkSnapshot,
  ctx: ChainCtx,
  key: string,
): CachedChainResult | null {
  const traced = traceChainSpecs(node, sourceOutput, inputs, snap, new Set());
  if (!traced) return null; // dead chain

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
    if (!anyDelta) return { points: entry.points, base: entry.base }; // zero work
    if (entry.fastPath) {
      for (let i = 0; i < traced.specs.length; i++) {
        const d = deltas[i];
        if (d.dx === 0 && d.dy === 0 && d.dz === 0) continue;
        applyTranslateDeltaInPlace(entry.points, entry.memberships[i], d.dx, d.dy, d.dz);
        entry.specs[i].tx = traced.specs[i].tx;
        entry.specs[i].ty = traced.specs[i].ty;
        entry.specs[i].tz = traced.specs[i].tz;
      }
      return { points: entry.points, base: entry.base };
    }
    // delta but a @P rule exists: membership may have changed -> full re-trace.
  }

  // Miss / sig changed / non-fastPath with deltas -> full re-trace + rebuild entry.
  const { points, memberships, fastPath } = fullReTrace(traced);
  const newEntry: CacheEntry = {
    key,
    sig,
    base: traced.base,
    specs: traced.specs.map((s) => ({ ...s })), // own the mutable tx/ty/tz fields
    points,
    memberships,
    fastPath,
  };
  cache.set(key, newEntry);
  return { points, base: traced.base };
}

/**
 * Cached equivalent of computeOutputs: 4 output buffers + dead-chain fallback,
 * per-output-index cache entries ("out:<i>"), clone-free translate on param edits.
 */
export function computeOutputsCached(
  inputs: InputPayload[],
  snap: NetworkSnapshot,
  ctx: ChainCtx,
): OutputBuffer[] {
  if (inputs.length === 0) return [];
  const outNode = snap.nodes.find((n) => n.kind === "output");
  const outputs: OutputBuffer[] = [];
  for (let i = 0; i < 4; i++) {
    const feeder = outNode ? findFeeder(snap, outNode.id, `out${i}`) : undefined;
    const src = feeder ? nodeById(snap, feeder.source) : undefined;
    const res =
      feeder && src ? computeChainCached(src, feeder.sourceOutput, inputs, snap, ctx, `out:${i}`) : null;
    outputs.push(res ? wrapBuffer(res, i) : fallbackBuffer(inputs[i], i));
  }
  return outputs;
}

/**
 * Cached equivalent of computeNodeResult: the REAL output of a displayed
 * null/transform node (cache key "node:<id>"), clone-free translate on param edits.
 * Broken chain / missing input / non-null-transform node -> null.
 */
export function computeNodeResultCached(
  snap: NetworkSnapshot,
  inputs: InputPayload[],
  nodeId: string,
  ctx: ChainCtx,
): OutputBuffer | null {
  const node = nodeById(snap, nodeId);
  if (!node || (node.kind !== "null" && node.kind !== "transform")) return null;
  const res = computeChainCached(node, "out0", inputs, snap, ctx, `node:${nodeId}`);
  return res ? wrapBuffer(res, 0) : null;
}
