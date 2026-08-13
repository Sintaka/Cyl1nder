import { beforeEach, describe, expect, it } from "vitest";
import {
  computeNodeResult,
  computeOutputs,
  type NetworkNode,
  type NetworkSnapshot,
} from "../src/nodes2/network";
import { resetChainCache, type ChainCtx } from "../src/nodes2/chain-cache";
import type { InputPayload } from "../src/protocol/types";

/**
 * Chain-state cache + clone-free translate (P2): computeOutputs / computeNodeResult
 * with a ChainCtx route through the chain cache. A param-only edit (tx/ty/tz) keeps
 * the SAME cached points array and applies the delta IN PLACE (zero clone); any
 * structural change (groupExpr / inputsRev / graphVersion / nodeId) or a
 * position-dependent @P rule forces a full re-trace (fresh points array).
 */

function makeInput(index: number, points: number[][]): InputPayload {
  return {
    index,
    name: `input${index}`,
    pointCount: points.length,
    primCount: 1,
    points,
    curves: [{ pointIndices: points.map((_, i) => i), widths: null }],
    faces: [],
    attributes: { P: { type: "vector", count: points.length, values: points } },
  };
}

function n(id: string, kind: string, params: NetworkNode["params"] = []): NetworkNode {
  return { id, kind, label: id, params };
}

function c(source: string, sourceOutput: string, target: string, targetInput: string) {
  return { source, sourceOutput, target, targetInput };
}

const outNode = n("out", "output");

function transformNode(
  id: string,
  overrides: Partial<Record<"tx" | "ty" | "tz" | "group" | "class", number | string>> = {},
): NetworkNode {
  return n(id, "transform", [
    { name: "tx", type: "float", value: overrides.tx ?? 0 },
    { name: "ty", type: "float", value: overrides.ty ?? 0 },
    { name: "tz", type: "float", value: overrides.tz ?? 0 },
    { name: "group", type: "string", value: overrides.group ?? "" },
    { name: "class", type: "string", value: overrides.class ?? "autoguess" },
  ]);
}

function ctx(inputsRev = 1, graphVersion = 1): ChainCtx {
  return { inputsRev, graphVersion };
}

/** in -> t(tx/ty/tz/group) -> out (single transform feeding out0). */
function singleTransformSnap(overrides: Parameters<typeof transformNode>[1] = {}): NetworkSnapshot {
  return {
    nodes: [n("in", "input"), transformNode("t", overrides), outNode],
    connections: [c("in", "in0", "t", "in0"), c("t", "out0", "out", "out0")],
  };
}

const TWO_PTS = [[0, 0, 0], [1, 0, 0]];

beforeEach(() => {
  resetChainCache();
});

describe("computeOutputs cached - clone-free translate", () => {
  it("all-points delta: same points array mutated in place (zero clone), values correct", () => {
    const inputs = [makeInput(0, TWO_PTS)];
    const a = computeOutputs(inputs, singleTransformSnap({ tx: 5 }), ctx())[0];
    expect(a.points).toEqual([[5, 0, 0], [6, 0, 0]]);

    // param-only edit tx 5 -> 8: sig unchanged -> delta applied to the SAME array
    const b = computeOutputs(inputs, singleTransformSnap({ tx: 8 }), ctx())[0];
    expect(b.points).toEqual([[8, 0, 0], [9, 0, 0]]);
    expect(b.points).toBe(a.points); // outer array reused (no clone)
    expect(b.points[0]).toBe(a.points[0]); // inner point mutated in place (no clone)
    expect(b.points[1]).toBe(a.points[1]);
  });

  it("subset delta: group 0-1 moves only points 0/1, the rest are untouched (same refs)", () => {
    const pts = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const inputs = [makeInput(0, pts)];
    const a = computeOutputs(inputs, singleTransformSnap({ tx: 1, group: "0-1" }), ctx())[0];
    expect(a.points).toEqual([[1, 0, 0], [1, 0, 0], [0, 0, 0], [0, 0, 0]]);

    const b = computeOutputs(inputs, singleTransformSnap({ tx: 4, group: "0-1" }), ctx())[0];
    expect(b.points).toEqual([[4, 0, 0], [4, 0, 0], [0, 0, 0], [0, 0, 0]]);
    expect(b.points).toBe(a.points); // still the cached array
    expect(b.points[0]).toBe(a.points[0]); // hit point mutated in place
    expect(b.points[2]).toBe(a.points[2]); // non-hit point same ref, never touched
    expect(b.points[2]).toEqual([0, 0, 0]);
  });

  it("multi-transform chain: both deltas accumulate on the cached array", () => {
    const inputs = [makeInput(0, TWO_PTS)];
    const snap = (t1x: number, t2y: number): NetworkSnapshot => ({
      nodes: [
        n("in", "input"),
        transformNode("t1", { tx: t1x }),
        transformNode("t2", { ty: t2y }),
        outNode,
      ],
      connections: [
        c("in", "in0", "t1", "in0"),
        c("t1", "out0", "t2", "in0"),
        c("t2", "out0", "out", "out0"),
      ],
    });
    const a = computeOutputs(inputs, snap(1, 1), ctx())[0];
    expect(a.points).toEqual([[1, 1, 0], [2, 1, 0]]);

    // both transforms change at once -> one delta pass, correct accumulation
    const b = computeOutputs(inputs, snap(3, 4), ctx())[0];
    expect(b.points).toEqual([[3, 4, 0], [4, 4, 0]]);
    expect(b.points).toBe(a.points);
  });

  it("zero delta (params unchanged) returns the same array with no writes", () => {
    const inputs = [makeInput(0, TWO_PTS)];
    const a = computeOutputs(inputs, singleTransformSnap({ tx: 5 }), ctx())[0];
    const before = JSON.stringify(a.points);
    const b = computeOutputs(inputs, singleTransformSnap({ tx: 5 }), ctx())[0];
    expect(b.points).toBe(a.points);
    expect(JSON.stringify(b.points)).toBe(before);
  });

  it("sig invalidation: groupExpr change rebuilds points (full re-trace, not delta)", () => {
    const pts = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const inputs = [makeInput(0, pts)];
    const a = computeOutputs(inputs, singleTransformSnap({ tx: 1, group: "" }), ctx())[0];
    expect(a.points).toEqual([[1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0]]);

    const b = computeOutputs(inputs, singleTransformSnap({ tx: 1, group: "0-1" }), ctx())[0];
    expect(b.points).not.toBe(a.points); // rebuilt
    expect(b.points).toEqual([[1, 0, 0], [1, 0, 0], [0, 0, 0], [0, 0, 0]]);
  });

  it("sig invalidation: inputsRev change rebuilds points", () => {
    const inputs = [makeInput(0, TWO_PTS)];
    const a = computeOutputs(inputs, singleTransformSnap({ tx: 5 }), ctx(1, 1))[0];
    const b = computeOutputs(inputs, singleTransformSnap({ tx: 8 }), ctx(2, 1))[0];
    expect(b.points).not.toBe(a.points); // full re-trace (new inputs epoch)
    expect(b.points).toEqual([[8, 0, 0], [9, 0, 0]]);
  });

  it("sig invalidation: graphVersion change rebuilds points", () => {
    const inputs = [makeInput(0, TWO_PTS)];
    const a = computeOutputs(inputs, singleTransformSnap({ tx: 5 }), ctx(1, 1))[0];
    const b = computeOutputs(inputs, singleTransformSnap({ tx: 8 }), ctx(1, 2))[0];
    expect(b.points).not.toBe(a.points); // full re-trace (topology epoch)
    expect(b.points).toEqual([[8, 0, 0], [9, 0, 0]]);
  });

  it("@P.y>0 rule is position-dependent: always full re-trace, result correct", () => {
    const pts = [[0, 1, 0], [0, -1, 0], [0, 2, 0]];
    const inputs = [makeInput(0, pts)];
    const snap = (tx: number): NetworkSnapshot =>
      singleTransformSnap({ tx, group: "@P.y>0", class: "points" });

    const a = computeOutputs(inputs, snap(1), ctx())[0];
    expect(a.points).toEqual([[1, 1, 0], [0, -1, 0], [1, 2, 0]]);

    // @P rule present -> membership may change with positions -> no delta path
    const b = computeOutputs(inputs, snap(3), ctx())[0];
    expect(b.points).not.toBe(a.points); // rebuilt every time
    expect(b.points).toEqual([[3, 1, 0], [0, -1, 0], [3, 2, 0]]);
  });

  it("dead chain falls back to the passthrough input (cache path mirrors computeOutputs)", () => {
    const inputs = [makeInput(0, TWO_PTS), makeInput(1, [[9, 0, 0], [8, 0, 0]])];
    // only out0 wired -> out1..out3 fall back
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), outNode],
      connections: [c("in", "in0", "out", "out0")],
    };
    const outs = computeOutputs(inputs, snap, ctx());
    expect(outs[0].points).toEqual(TWO_PTS);
    expect(outs[1].points).toEqual(inputs[1].points);
  });
});

describe("computeNodeResult cached", () => {
  it("param-only edit reuses the cached node-result array (in-place delta)", () => {
    const inputs = [makeInput(0, TWO_PTS)];
    const snap = (tx: number): NetworkSnapshot => singleTransformSnap({ tx });
    const r1 = computeNodeResult(snap(5), inputs, "t", ctx());
    expect(r1).not.toBeNull();
    expect(r1!.points).toEqual([[5, 0, 0], [6, 0, 0]]);

    const r2 = computeNodeResult(snap(9), inputs, "t", ctx());
    expect(r2!.points).toEqual([[9, 0, 0], [10, 0, 0]]);
    expect(r2!.points).toBe(r1!.points); // cache key "node:t" hit -> in-place
  });

  it("structural change rebuilds the node-result points", () => {
    const inputs = [makeInput(0, TWO_PTS)];
    const snap = (group: string): NetworkSnapshot => singleTransformSnap({ tx: 2, group });
    const r1 = computeNodeResult(snap(""), inputs, "t", ctx());
    expect(r1!.points).toEqual([[2, 0, 0], [3, 0, 0]]);

    const r2 = computeNodeResult(snap("0-1"), inputs, "t", ctx());
    expect(r2!.points).not.toBe(r1!.points);
    expect(r2!.points).toEqual([[2, 0, 0], [3, 0, 0]]);
  });

  it("non-null/transform node and unknown id -> null (cache path mirrors computeNodeResult)", () => {
    const inputs = [makeInput(0, TWO_PTS)];
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), transformNode("t", { tx: 1 }), outNode],
      connections: [c("in", "in0", "t", "in0"), c("t", "out0", "out", "out0")],
    };
    expect(computeNodeResult(snap, inputs, "in", ctx())).toBeNull();
    expect(computeNodeResult(snap, inputs, "out", ctx())).toBeNull();
    expect(computeNodeResult(snap, inputs, "nope", ctx())).toBeNull();
  });
});
