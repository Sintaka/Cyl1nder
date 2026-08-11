import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeNodeResult, computeOutputs, type NetworkNode, type NetworkSnapshot } from "../src/nodes2/network";
import type { InputPayload } from "../src/protocol/types";

/**
 * Deterministic fake for ../src/tools/transform#applyTranslateGrouped: the real
 * implementation routes through nodes2/groups (parseGroupExpression / matchingPoints),
 * which a parallel agent is implementing right now. Mocking that dependency keeps
 * this unit test focused on computeOutputs' chain-tracing + param-forwarding logic.
 * The fake mirrors the documented contract: translate the CURRENT `points` array
 * for the points matching `groupExpr` (base supplies attributes/topology).
 */
const mocks = vi.hoisted(() => {
  const matchesGroup = (base: { points: number[][] }, pointIndex: number, expr: string): boolean => {
    const e = expr.trim();
    if (e === "" || e === "*") return true;
    const range = /^(\d+)-(\d+)$/.exec(e);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      return pointIndex >= lo && pointIndex <= hi;
    }
    const single = /^(\d+)$/.exec(e);
    if (single) return pointIndex === Number(single[1]);
    // "@P.<comp><op><value>" attribute comparison, e.g. "@P.y>0"
    const cmp = /^@P\.([xyz])(>=|<=|==|=|!=|>|<)(-?\d+(?:\.\d+)?)$/.exec(e);
    if (cmp) {
      const idx = cmp[1] === "x" ? 0 : cmp[1] === "y" ? 1 : 2;
      const op = cmp[2] === "=" ? "==" : cmp[2];
      const val = Number(cmp[3]);
      const pt = base.points[pointIndex];
      if (!pt) return false;
      const v = pt[idx];
      if (op === ">") return v > val;
      if (op === "<") return v < val;
      if (op === ">=") return v >= val;
      if (op === "<=") return v <= val;
      if (op === "==") return v === val;
      if (op === "!=") return v !== val;
      return false;
    }
    return false;
  };
  return {
    applyTranslateGrouped: vi.fn(
      (
        base: { points: number[][] },
        points: number[][],
        groupExpr: string,
        cls: string,
        dx: number,
        dy: number,
        dz: number,
      ): number[][] => {
        void cls;
        const next = points.map((p) => [...p]);
        for (let i = 0; i < next.length; i++) {
          if (matchesGroup(base, i, groupExpr)) {
            next[i] = [next[i][0] + dx, next[i][1] + dy, next[i][2] + dz];
          }
        }
        return next;
      },
    ),
  };
});

vi.mock("../src/tools/transform", () => ({ applyTranslateGrouped: mocks.applyTranslateGrouped }));

/** Minimal InputPayload fixture (points / curves / faces / attributes). */
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

const inputs4 = [
  makeInput(0, [[0, 0, 0], [1, 0, 0]]),
  makeInput(1, [[2, 0, 0], [3, 0, 0]]),
  makeInput(2, [[4, 0, 0], [5, 0, 0]]),
  makeInput(3, [[6, 0, 0], [7, 0, 0]]),
];

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
  const tx = overrides.tx ?? 0;
  const ty = overrides.ty ?? 0;
  const tz = overrides.tz ?? 0;
  const group = overrides.group ?? "";
  const cls = overrides.class ?? "autoguess";
  return n(id, "transform", [
    { name: "tx", type: "float", value: tx },
    { name: "ty", type: "float", value: ty },
    { name: "tz", type: "float", value: tz },
    { name: "group", type: "string", value: group },
    { name: "class", type: "string", value: cls },
  ]);
}

beforeEach(() => {
  mocks.applyTranslateGrouped.mockClear();
});

describe("computeOutputs", () => {
  it("returns [] when there are no inputs", () => {
    const snap: NetworkSnapshot = { nodes: [n("in", "input"), outNode], connections: [] };
    expect(computeOutputs([], snap)).toEqual([]);
  });

  it("pure passthrough: each output port equals its input (4 outputs)", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), outNode],
      connections: [
        c("in", "in0", "out", "out0"),
        c("in", "in1", "out", "out1"),
        c("in", "in2", "out", "out2"),
        c("in", "in3", "out", "out3"),
      ],
    };
    const outs = computeOutputs(inputs4, snap);
    expect(outs).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(outs[i].index).toBe(i);
      expect(outs[i].rev).toBe(0);
      expect(outs[i].points).toEqual(inputs4[i].points);
      expect(outs[i].pointCount).toBe(inputs4[i].pointCount);
      expect(outs[i].primCount).toBe(inputs4[i].primCount);
      expect(outs[i].curves).toEqual(inputs4[i].curves);
      expect(outs[i].faces).toEqual(inputs4[i].faces ?? []);
      expect(outs[i].attributes).toEqual(inputs4[i].attributes);
    }
    expect(mocks.applyTranslateGrouped).not.toHaveBeenCalled();
  });

  it("single transform tx=1 shifts every point +x and forwards params", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), transformNode("t", { tx: 1 }), outNode],
      connections: [c("in", "in0", "t", "in0"), c("t", "out0", "out", "out0")],
    };
    const outs = computeOutputs(inputs4, snap);
    expect(outs[0].points).toEqual([[1, 0, 0], [2, 0, 0]]);
    expect(outs[0].pointCount).toBe(2);
    expect(outs[0].curves).toEqual(inputs4[0].curves);
    // untouched ports fall back to their inputs
    expect(outs[1].points).toEqual(inputs4[1].points);
    expect(mocks.applyTranslateGrouped).toHaveBeenCalledTimes(1);
    expect(mocks.applyTranslateGrouped).toHaveBeenCalledWith(inputs4[0], inputs4[0].points, "", "autoguess", 1, 0, 0);
  });

  it("group subset: group=0-1 translates only the first 2 points", () => {
    const pts = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), transformNode("t", { tx: 1, group: "0-1" }), outNode],
      connections: [c("in", "in0", "t", "in0"), c("t", "out0", "out", "out0")],
    };
    const outs = computeOutputs([makeInput(0, pts)], snap);
    expect(outs[0].points).toEqual([[1, 0, 0], [1, 0, 0], [0, 0, 0], [0, 0, 0]]);
    expect(mocks.applyTranslateGrouped).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0 }),
      pts,
      "0-1",
      "autoguess",
      1,
      0,
      0,
    );
  });

  it("chained transforms apply in order: +x then +y", () => {
    const snap: NetworkSnapshot = {
      nodes: [
        n("in", "input"),
        transformNode("t1", { tx: 1 }),
        transformNode("t2", { ty: 1 }),
        outNode,
      ],
      connections: [
        c("in", "in0", "t1", "in0"),
        c("t1", "out0", "t2", "in0"),
        c("t2", "out0", "out", "out0"),
      ],
    };
    const outs = computeOutputs(inputs4, snap);
    expect(outs[0].points).toEqual([[1, 1, 0], [2, 1, 0]]);
    const calls = mocks.applyTranslateGrouped.mock.calls;
    expect(calls).toHaveLength(2);
    // first transform receives the untouched base points, +x
    expect(calls[0][1]).toEqual(inputs4[0].points);
    expect(calls[0][4]).toBe(1);
    expect(calls[0][5]).toBe(0);
    // second transform receives the +x result, +y
    expect(calls[1][1]).toEqual([[1, 0, 0], [2, 0, 0]]);
    expect(calls[1][4]).toBe(0);
    expect(calls[1][5]).toBe(1);
  });

  it("null node passes geometry through unchanged", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), n("null1", "null"), outNode],
      connections: [c("in", "in0", "null1", "in0"), c("null1", "out0", "out", "out0")],
    };
    const outs = computeOutputs(inputs4, snap);
    expect(outs[0].points).toEqual(inputs4[0].points);
    expect(mocks.applyTranslateGrouped).not.toHaveBeenCalled();
  });

  it("unconnected output port falls back to inputs[i] unchanged", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), outNode],
      connections: [c("in", "in0", "out", "out0")],
    };
    const outs = computeOutputs(inputs4, snap);
    expect(outs[0].points).toEqual(inputs4[0].points);
    for (let i = 1; i < 4; i++) {
      expect(outs[i].index).toBe(i);
      expect(outs[i].points).toEqual(inputs4[i].points);
    }
  });

  it("@P.y>0 class filter translates only points with y > 0", () => {
    const pts = [[0, 1, 0], [0, -1, 0], [0, 2, 0]];
    const snap: NetworkSnapshot = {
      nodes: [
        n("in", "input"),
        transformNode("t", { tx: 1, group: "@P.y>0", class: "points" }),
        outNode,
      ],
      connections: [c("in", "in0", "t", "in0"), c("t", "out0", "out", "out0")],
    };
    const outs = computeOutputs([makeInput(0, pts)], snap);
    expect(outs[0].points).toEqual([[1, 1, 0], [0, -1, 0], [1, 2, 0]]);
    expect(mocks.applyTranslateGrouped).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0 }),
      pts,
      "@P.y>0",
      "points",
      1,
      0,
      0,
    );
  });

  it("a cyclic transform chain is guarded and falls back to inputs[i]", () => {
    const snap: NetworkSnapshot = {
      nodes: [transformNode("t", { tx: 1 }), outNode],
      connections: [c("t", "out0", "t", "in0"), c("t", "out0", "out", "out0")],
    };
    const outs = computeOutputs(inputs4, snap);
    expect(outs[0].points).toEqual(inputs4[0].points); // no infinite recursion
    expect(mocks.applyTranslateGrouped).not.toHaveBeenCalled();
  });
});

describe("computeNodeResult", () => {
  it("transform node result: points are translated (tx=5), topology from base", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), transformNode("t", { tx: 5 }), outNode],
      connections: [c("in", "in0", "t", "in0"), c("t", "out0", "out", "out0")],
    };
    const res = computeNodeResult(snap, inputs4, "t");
    expect(res).not.toBeNull();
    expect(res!.index).toBe(0);
    expect(res!.points).toEqual([[5, 0, 0], [6, 0, 0]]);
    expect(res!.pointCount).toBe(2);
    expect(res!.primCount).toBe(1);
    expect(res!.curves).toEqual(inputs4[0].curves);
    expect(res!.faces).toEqual([]);
    expect(res!.attributes).toEqual(inputs4[0].attributes);
  });

  it("null node result: passthrough of the feeding input, no translation", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), n("null1", "null"), outNode],
      connections: [c("in", "in1", "null1", "in0"), c("null1", "out0", "out", "out0")],
    };
    const res = computeNodeResult(snap, inputs4, "null1");
    expect(res).not.toBeNull();
    expect(res!.points).toEqual(inputs4[1].points);
    expect(mocks.applyTranslateGrouped).not.toHaveBeenCalled();
  });

  it("chain input -> transform -> null: null result carries the translated points", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), transformNode("t", { tx: 5 }), n("nullB", "null"), outNode],
      connections: [c("in", "in0", "t", "in0"), c("t", "out0", "nullB", "in0"), c("nullB", "out0", "out", "out0")],
    };
    const res = computeNodeResult(snap, inputs4, "nullB");
    expect(res).not.toBeNull();
    expect(res!.points).toEqual([[5, 0, 0], [6, 0, 0]]);
    // the transform result, not the untransformed source
    expect(res!.points).not.toEqual(inputs4[0].points);
  });

  it("disconnected / broken chain -> null", () => {
    // no in0 feeder at all
    const empty: NetworkSnapshot = {
      nodes: [n("in", "input"), transformNode("t", { tx: 5 }), outNode],
      connections: [c("in", "in0", "out", "out0")],
    };
    expect(computeNodeResult(empty, inputs4, "t")).toBeNull();
    // feeder exists but its own chain is dead (transform feeding from nothing)
    const dead: NetworkSnapshot = {
      nodes: [n("in", "input"), transformNode("t1", { tx: 5 }), transformNode("t2", { ty: 1 }), outNode],
      connections: [c("t1", "out0", "t2", "in0"), c("t2", "out0", "out", "out0")],
    };
    expect(computeNodeResult(dead, inputs4, "t2")).toBeNull();
    // unknown node id / non-null-transform kind -> null
    expect(computeNodeResult(empty, inputs4, "nope")).toBeNull();
    expect(computeNodeResult(empty, inputs4, "out")).toBeNull();
  });
});