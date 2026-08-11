/**
 * Pure network computation: trace the rete graph topology (input -> null/transform
 * -> output) and produce the 4 OutputBuffers pushed back to the bridge.
 * v1: null = passthrough; transform = translate points matching its group filter.
 * Any output port with no connected chain falls back to passthrough input_i
 * (preserves the historical 4-output behaviour).
 * DOM-free / unit-testable; graph.ts supplies the snapshot (structural match).
 */
import type { InputPayload, OutputBuffer } from "../protocol/types";
import type { GroupClass } from "./groups";
import { applyTranslateGrouped } from "../tools/transform";

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
function findFeeder(
  snap: NetworkSnapshot,
  nodeId: string,
  targetInput: string,
): NetworkConnection | undefined {
  return snap.connections.find((c) => c.target === nodeId && c.targetInput === targetInput);
}

function nodeById(snap: NetworkSnapshot, id: string): NetworkNode | undefined {
  return snap.nodes.find((n) => n.id === id);
}

/** Parse an _input_ source socket name ("in0".."in3") into its port index. */
function parseInPort(socket: string): number | null {
  const m = /^in(\d+)$/.exec(socket);
  return m ? Number(m[1]) : null;
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
  if (visited.has(node.id)) return null; // cycle defence
  visited.add(node.id);

  if (node.kind === "input") {
    const j = parseInPort(sourceOutput);
    const base = j !== null ? inputs[j] : undefined;
    return base ? { base, points: base.points } : null;
  }

  if (node.kind === "null" || node.kind === "transform") {
    const up = findFeeder(snap, node.id, "in0");
    const upNode = up ? nodeById(snap, up.source) : undefined;
    if (!up || !upNode) return null;
    const res = traceChain(upNode, up.sourceOutput, inputs, snap, visited);
    if (!res) return null;
    if (node.kind === "transform") {
      const dx = asFiniteNumber(paramValue(node, "tx", 0));
      const dy = asFiniteNumber(paramValue(node, "ty", 0));
      const dz = asFiniteNumber(paramValue(node, "tz", 0));
      const group = String(paramValue(node, "group", ""));
      const cls = toGroupClass(String(paramValue(node, "class", "autoguess")));
      return {
        base: res.base,
        points: applyTranslateGrouped(res.base, res.points, group, cls, dx, dy, dz),
      };
    }
    return res; // null = passthrough
  }

  return null; // output (or unknown kind) mid-chain -> dead chain
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
 */
export function computeOutputs(inputs: InputPayload[], snap: NetworkSnapshot): OutputBuffer[] {
  if (inputs.length === 0) return [];
  const outNode = snap.nodes.find((n) => n.kind === "output");
  const outputs: OutputBuffer[] = [];
  for (let i = 0; i < 4; i++) {
    const feeder = outNode ? findFeeder(snap, outNode.id, `out${i}`) : undefined;
    const src = feeder ? nodeById(snap, feeder.source) : undefined;
    const res =
      feeder && src ? traceChain(src, feeder.sourceOutput, inputs, snap, new Set()) : null;
    outputs.push(res ? bufferFromResolved(res, i) : fallbackBuffer(inputs[i], i));
  }
  return outputs;
}


/**
 * Compute the REAL output of a single node (display viewport): trace the node's
 * in0 chain back to its _input_ source, applying transform translations along the
 * way (null = passthrough). Unlike computeOutputs this returns the transformed
 * geometry of the requested node itself, so a displayed transform/null shows the
 * current chain result instead of the untransformed source input. Broken chain /
 * missing input / non-null-transform node -> null.
 */
export function computeNodeResult(
  snap: NetworkSnapshot,
  inputs: InputPayload[],
  nodeId: string,
): OutputBuffer | null {
  const node = nodeById(snap, nodeId);
  if (!node || (node.kind !== "null" && node.kind !== "transform")) return null;
  const res = traceChain(node, "out0", inputs, snap, new Set());
  return res ? bufferFromResolved(res, 0) : null;
}