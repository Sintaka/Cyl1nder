import { beforeEach, describe, expect, it } from "vitest";
import {
  computeNodeResult,
  computeOutputs,
  computeOutputsDetailed,
  type NetworkNode,
  type NetworkSnapshot,
} from "../src/nodes2/network";
import {
  getCacheChange,
  getCacheEntrySpecs,
  resetChainCache,
  resetFallbackMemo,
  type ChainCtx,
} from "../src/nodes2/chain-cache";
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

function ctx(inputsRev = 1, graphVersion = 1, activeOutputs?: boolean[]): ChainCtx {
  return activeOutputs ? { inputsRev, graphVersion, activeOutputs } : { inputsRev, graphVersion };
}

/** ChainCtx with explicit active flags + displayed-node id (lazy output tests). */
function ctxActive(activeOutputs: boolean[] | null, activeNodeId: string | null, inputsRev = 1, graphVersion = 1): ChainCtx {
  return { inputsRev, graphVersion, activeOutputs, activeNodeId };
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
  resetFallbackMemo();
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

  it("displayed transform's directly-fed output chain stays active (activeNodeId overrides lazy skip)", () => {
    const inputs = [makeInput(0, TWO_PTS)];
    const snap = (tx: number): NetworkSnapshot => singleTransformSnap({ tx });
    // activeOutputs all-false, but the display node "t" feeds out0 -> chain stays live.
    // first call builds the entry (topology); the activeNodeId makes it live even
    // though every activeOutputs flag is false.
    const a = computeOutputsDetailed(inputs, snap(1), ctxActive([false, false, false, false], "t"));
    expect(a.changes[0]).toBe("topology");
    expect(a.outputs[0].points).toEqual([[1, 0, 0], [2, 0, 0]]);

    const b = computeOutputsDetailed(inputs, snap(3), ctxActive([false, false, false, false], "t"));
    expect(b.changes[0]).toBe("data");
    expect(b.outputs[0].points).toBe(a.outputs[0].points); // in-place, no clone
    expect(b.outputs[0].points).toEqual([[3, 0, 0], [4, 0, 0]]);

    // without activeNodeId the same chain is lazily skipped (not pushed).
    const c = computeOutputsDetailed(inputs, snap(5), ctxActive([false, false, false, false], null));
    expect(c.changes[0]).toBe("none");
    expect(c.outputs[0].points).toBe(b.outputs[0].points);
    expect(c.outputs[0].points).toEqual([[3, 0, 0], [4, 0, 0]]);
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


describe("computeOutputsDetailed cached - change grades + lazy output (F1/F2)", () => {
  it("active chain delta -> change data + points moved in place", () => {
    const inputs = [makeInput(0, TWO_PTS)];
    const act = () => ctx(1, 1, [true, false, false, false]); // out0 active
    const a = computeOutputsDetailed(inputs, singleTransformSnap({ tx: 5 }), act());
    expect(a.changes[0]).toBe("topology"); // initial build

    const b = computeOutputsDetailed(inputs, singleTransformSnap({ tx: 8 }), act());
    expect(b.changes[0]).toBe("data"); // in-place delta on the active chain
    expect(b.outputs[0].points).toBe(a.outputs[0].points); // moved in place
    expect(b.outputs[0].points).toEqual([[8, 0, 0], [9, 0, 0]]);
  });

  it("inactive chain param edit -> change none, same array, delta skipped, specs not moved", () => {
    // out0 active, out1 INACTIVE (activeOutputs[1] === false) - both live chains.
    const inputs = [makeInput(0, TWO_PTS), makeInput(1, TWO_PTS)];
    const snap = (t0x: number, t1y: number): NetworkSnapshot => ({
      nodes: [
        n("in0", "input"),
        n("in1", "input"),
        transformNode("t0", { tx: t0x }),
        transformNode("t1", { ty: t1y }),
        outNode,
      ],
      connections: [
        c("in0", "in0", "t0", "in0"),
        c("t0", "out0", "out", "out0"),
        c("in1", "in0", "t1", "in0"),
        c("t1", "out0", "out", "out1"),
      ],
    });
    const act = () => ctx(1, 1, [true, false, false, false]);

    const a = computeOutputsDetailed(inputs, snap(5, 5), act());
    expect(a.outputs[1].points).toEqual([[0, 5, 0], [1, 5, 0]]);

    // param edit on the INACTIVE chain ty 5 -> 9: lazy skip (zero work)
    const b = computeOutputsDetailed(inputs, snap(5, 9), act());
    expect(b.changes[1]).toBe("none");
    expect(b.outputs[1].points).toBe(a.outputs[1].points); // same array identity
    expect(b.outputs[1].points).toEqual([[0, 5, 0], [1, 5, 0]]); // delta NOT applied
    expect(getCacheEntrySpecs("out:1")![0].ty).toBe(5); // specs NOT moved

    // re-activate (all outputs active) with ty=9: accumulated delta applied -> self-heal
    const r = computeOutputsDetailed(inputs, snap(5, 9), ctx(1, 1, [true, true, true, true]));
    expect(r.changes[1]).toBe("data");
    expect(r.outputs[1].points).toBe(a.outputs[1].points);
    expect(r.outputs[1].points).toEqual([[0, 9, 0], [1, 9, 0]]);
    expect(getCacheEntrySpecs("out:1")![0].ty).toBe(9);
  });

  it("inactive @P-rule chain param edit -> change none (lazy skip); active -> topology re-trace", () => {
    // @P.y>0 chain on out0, INACTIVE: the delta exists but the lazy skip wins
    // (no re-trace). Re-activating forces the full re-trace (change "topology").
    const pts = [[0, 1, 0], [0, -1, 0], [0, 2, 0]];
    const inputs = [makeInput(0, pts)];
    const snap = (ty: number): NetworkSnapshot =>
      singleTransformSnap({ ty, group: "@P.y>0", class: "points" });
    const inactive = () => ctx(1, 1, [false, false, false, false]);

    const a = computeOutputsDetailed(inputs, snap(1), inactive());
    expect(a.outputs[0].points).toEqual([[0, 2, 0], [0, -1, 0], [0, 3, 0]]);

    const b = computeOutputsDetailed(inputs, snap(3), inactive());
    expect(b.changes[0]).toBe("none"); // lazy skip, cached points reused
    expect(b.outputs[0].points).toBe(a.outputs[0].points);
    expect(b.outputs[0].points).toEqual([[0, 2, 0], [0, -1, 0], [0, 3, 0]]); // NOT re-traced

    const r = computeOutputsDetailed(inputs, snap(3), ctx()); // active again
    expect(r.changes[0]).toBe("topology"); // @P rule -> full re-trace, fresh array
    expect(r.outputs[0].points).not.toBe(a.outputs[0].points);
    expect(r.outputs[0].points).toEqual([[0, 4, 0], [0, -1, 0], [0, 5, 0]]);
  });

  it("zero delta -> change none, same array", () => {
    const inputs = [makeInput(0, TWO_PTS)];
    const snap = singleTransformSnap({ tx: 5 });
    const a = computeOutputsDetailed(inputs, snap, ctx());
    expect(a.changes[0]).toBe("topology");
    const b = computeOutputsDetailed(inputs, snap, ctx());
    expect(b.changes[0]).toBe("none");
    expect(b.outputs[0].points).toBe(a.outputs[0].points);
  });

  it("sig miss -> change topology + new points array", () => {
    const inputs = [makeInput(0, TWO_PTS)];
    const a = computeOutputsDetailed(inputs, singleTransformSnap({ tx: 1 }), ctx(1, 1));
    expect(a.changes[0]).toBe("topology");
    const b = computeOutputsDetailed(inputs, singleTransformSnap({ tx: 1 }), ctx(2, 1)); // inputsRev sig miss
    expect(b.changes[0]).toBe("topology");
    expect(b.outputs[0].points).not.toBe(a.outputs[0].points); // fresh array
    expect(b.outputs[0].points).toEqual([[1, 0, 0], [2, 0, 0]]);
  });

  it("dead-chain fallback memo: same buffer + change none across runs with same inputsRev; new buffer + data after", () => {
    const inputs = [makeInput(0, TWO_PTS), makeInput(1, [[9, 0, 0], [8, 0, 0]])];
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), outNode],
      connections: [c("in", "in0", "out", "out0")],
    };
    // only out0 wired -> out1..3 dead; unique inputsRev so this test owns the memo
    const a = computeOutputsDetailed(inputs, snap, ctx(50));
    expect(a.changes[1]).toBe("data"); // first build for this inputsRev
    const bufA = a.outputs[1];
    expect(bufA.points).toBe(inputs[1].points); // passthrough shares the input points

    const b = computeOutputsDetailed(inputs, snap, ctx(50));
    expect(b.outputs[1]).toBe(bufA); // SAME buffer object (stable identity)
    expect(b.changes[1]).toBe("none");

    const cc = computeOutputsDetailed(inputs, snap, ctx(51));
    expect(cc.outputs[1]).not.toBe(bufA); // inputsRev changed -> rebuilt
    expect(cc.changes[1]).toBe("data");
  });

  it("getCacheChange returns the entry's change grade", () => {
    const inputs = [makeInput(0, TWO_PTS)];
    expect(getCacheChange("out:0")).toBeUndefined(); // no entry yet
    computeOutputsDetailed(inputs, singleTransformSnap({ tx: 5 }), ctx());
    expect(getCacheChange("out:0")).toBe("topology"); // initial build
    computeOutputsDetailed(inputs, singleTransformSnap({ tx: 7 }), ctx());
    expect(getCacheChange("out:0")).toBe("data"); // in-place delta
    computeOutputsDetailed(inputs, singleTransformSnap({ tx: 7, group: "0-1" }), ctx());
    expect(getCacheChange("out:0")).toBe("topology"); // sig changed -> rebuild
  });
});