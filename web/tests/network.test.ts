import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeNodeResult,
  computeOutputs,
  computeOutputsDetailed,
  findMultiSourceErrors,
  portDataType,
  type NetworkNode,
  type NetworkSnapshot,
} from "../src/nodes2/network";
import type { ChainChange } from "../src/nodes2/chain-cache";
import { createNetworkRunner, type NetworkDeps } from "../src/core/network";
import type { InputPayload, OutputBuffer } from "../src/protocol/types";

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
describe("computeOutputsDetailed", () => {
  it("returns 4 output buffers with aligned changes (no ctx -> full-trace topology)", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), outNode],
      connections: [c("in", "in0", "out", "out0")],
    };
    const res = computeOutputsDetailed(inputs4, snap);
    expect(res.outputs).toHaveLength(4);
    expect(res.changes).toHaveLength(4);
    expect(res.outputs.map((o) => o.index)).toEqual([0, 1, 2, 3]);
    expect(res.changes).toEqual(["topology", "topology", "topology", "topology"]);
    // same buffer content as the array form
    expect(res.outputs[0].points).toEqual(inputs4[0].points);
    expect(res.outputs[1].points).toEqual(inputs4[1].points);
  });
});

/** Minimal OutputBuffer fixture for the runner (F4) tests. */
function makeOut(index: number, points: number[][]): OutputBuffer {
  return {
    index,
    rev: 0,
    pointCount: points.length,
    primCount: 1,
    points,
    curves: [{ pointIndices: points.map((_, i) => i), widths: null }],
    faces: [],
    attributes: {},
  };
}

interface RunnerHarness {
  deps: NetworkDeps;
  runner: ReturnType<typeof createNetworkRunner>;
  upserted: { outputs: OutputBuffer[]; rev: number }[];
  pushed: { serial: string; outputs: OutputBuffer[] }[];
  rev: () => number;
}

/** Fake runner deps: computeOutputs returns caller-controlled outputs + changes. */
function makeRunner(
  opts: { changes?: ChainChange[]; outputs?: OutputBuffer[]; rev?: number; pushRev?: number; shouldPush?: boolean } = {},
): RunnerHarness {
  const changes = opts.changes ?? ["topology", "topology", "topology", "topology"];
  const outputs = opts.outputs ?? [
    makeOut(0, [[0, 0, 0]]),
    makeOut(1, [[1, 0, 0]]),
    makeOut(2, [[2, 0, 0]]),
    makeOut(3, [[3, 0, 0]]),
  ];
  let outputRev = opts.rev ?? 0;
  const pushRev = opts.pushRev ?? 5;
  const upserted: RunnerHarness["upserted"] = [];
  const pushed: RunnerHarness["pushed"] = [];
  const deps: NetworkDeps = {
    getSerial: () => "C1-test",
    getInputs: () => [makeInput(0, [[0, 0, 0]])],
    getNetworkSnapshot: () => ({ nodes: [], connections: [] }),
    getGraphVersion: () => 1,
    getInputsRev: () => 0,
    computeOutputs: () => ({ outputs, changes }),
    getActiveChains: () => ({ outputs: [true, true, true, true], node: null }),
    getEditedNodeId: () => null,
    getOutputRev: () => outputRev,
    upsertOutputs: (outs, rev) => {
      upserted.push({ outputs: outs, rev });
      outputRev = rev;
    },
    setOutputRev: (rev) => {
      outputRev = rev;
    },
    shouldPush: vi.fn(() => opts.shouldPush ?? true),
    pushOutputs: async (serial, outs) => {
      pushed.push({ serial, outputs: outs });
      return { rev: pushRev };
    },
    log: vi.fn(),
  };
  const runner = createNetworkRunner(deps);
  return { deps, runner, upserted, pushed, rev: () => outputRev };
}

describe("createNetworkRunner lazy output (F4)", () => {
  it("no-op frame: all changes 'none' -> no upsert, no rev bump, no push", async () => {
    const h = makeRunner({ changes: ["none", "none", "none", "none"] });
    await h.runner.run();
    expect(h.upserted).toHaveLength(0);
    expect(h.pushed).toHaveLength(0);
    expect(h.rev()).toBe(0);
  });

  it("sync OFF: shouldPush false -> no bridge push, but local upsert still applies", async () => {
    const h = makeRunner({ changes: ["data", "none", "none", "none"], shouldPush: false });
    await h.runner.run();
    expect(h.upserted).toHaveLength(1);
    expect(h.upserted[0].rev).toBe(1);
    expect(h.pushed).toHaveLength(0);
  });

  it("sync ON: shouldPush true -> bridge push is called", async () => {
    const h = makeRunner({ changes: ["data", "none", "none", "none"], shouldPush: true });
    await h.runner.run();
    expect(h.upserted).toHaveLength(1);
    expect(h.pushed).toHaveLength(1);
    expect(h.pushed[0].outputs.map((o) => o.index)).toEqual([0]);
  });

  it("pushes ONLY changed buffers; unchanged buffers carry their previous rev", async () => {
    const h = makeRunner({ changes: ["data", "none", "topology", "none"] });
    await h.runner.run();
    expect(h.upserted).toHaveLength(1);
    expect(h.upserted[0].rev).toBe(1); // predicted rev = outputRev + 1
    // changed indices 0 + 2 get the predicted rev; unchanged 1 + 3 carry 0
    expect(h.upserted[0].outputs.map((o) => o.rev)).toEqual([1, 0, 1, 0]);
    expect(h.pushed).toHaveLength(1);
    expect(h.pushed[0].outputs.map((o) => o.index)).toEqual([0, 2]);
    expect(h.pushed[0].outputs.every((o) => o.rev === 1)).toBe(true);
  });

  it("second run bumps only changed revs; unchanged keep the previous run's rev", async () => {
    // pushRev 0: the bridge response never aligns outputRev up, so the second
    // predicted rev stays deterministic (getOutputRev()+1 = 2).
    const h = makeRunner({ changes: ["data", "none", "none", "none"], pushRev: 0 });
    await h.runner.run();
    expect(h.upserted[0].rev).toBe(1);
    await h.runner.run();
    expect(h.upserted).toHaveLength(2);
    expect(h.upserted[1].rev).toBe(2);
    expect(h.upserted[1].outputs.map((o) => o.rev)).toEqual([2, 0, 0, 0]);
  });

  it("short changes array: missing tail treated defensively as 'data' (changed)", async () => {
    const h = makeRunner({ changes: ["none"] });
    await h.runner.run();
    expect(h.upserted).toHaveLength(1);
    expect(h.upserted[0].outputs.map((o) => o.rev)).toEqual([0, 1, 1, 1]);
    expect(h.pushed[0].outputs.map((o) => o.index)).toEqual([1, 2, 3]);
  });

  it("stale-epoch discard + rev-align response logic preserved", async () => {
    const h = makeRunner({ changes: ["data", "none", "none", "none"], pushRev: 7 });
    await h.runner.run();
    expect(h.upserted[0].rev).toBe(1); // optimistic local rev applied first
    await new Promise((r) => setTimeout(r, 0)); // flush the push-response .then
    expect(h.rev()).toBe(7); // aligned up to the bridge rev
  });
});

/** _input_ / _output_ node carrying the schema-4 single-port `type` param. */
function typedPortNode(id: string, kind: "input" | "output", type: string): NetworkNode {
  return n(id, kind, [
    { name: "address", type: "string", value: "point_1/tx" },
    { name: "type", type: "menu", value: type },
  ]);
}

describe("多源喂同一端口 → 报错（不静默取第一条、不抛）", () => {
  it("单源 / 零源：无错误（零源仍回退 passthrough，既有行为不变）", () => {
    const single: NetworkSnapshot = {
      nodes: [n("in", "input"), transformNode("t", { tx: 1 }), outNode],
      connections: [c("in", "in0", "t", "in0"), c("t", "out0", "out", "out0")],
    };
    expect(findMultiSourceErrors(single)).toEqual([]);
    expect(computeOutputsDetailed(inputs4, single).errors).toBeUndefined();
    // 零源：out1..out3 无连线 → 回退 inputs[i]，且不报错
    const outs = computeOutputs(inputs4, single);
    expect(outs[1].points).toEqual(inputs4[1].points);
    const zero: NetworkSnapshot = { nodes: [n("in", "input"), outNode], connections: [] };
    expect(findMultiSourceErrors(zero)).toEqual([]);
  });

  it("两个 transform 喂同一个 out0：报错并点名端口与竞争源", () => {
    const snap: NetworkSnapshot = {
      nodes: [
        n("in", "input"),
        transformNode("t1", { tx: 1 }),
        transformNode("t2", { ty: 2 }),
        outNode,
      ],
      connections: [
        c("in", "in0", "t1", "in0"),
        c("in", "in0", "t2", "in0"),
        c("t1", "out0", "out", "out0"),
        c("t2", "out0", "out", "out0"), // 第二个源：非法
      ],
    };
    const errs = findMultiSourceErrors(snap);
    expect(errs).toHaveLength(1);
    expect(errs[0].nodeId).toBe("out");
    expect(errs[0].targetInput).toBe("out0"); // 端口被点名
    expect(errs[0].sources).toEqual(["t1.out0", "t2.out0"]); // 竞争源被点名
    expect(errs[0].message).toContain("out.out0");
    expect(errs[0].message).toContain("t1.out0");
    expect(errs[0].message).toContain("t2.out0");
    // computeOutputsDetailed 附带 errors（结构化、纯附加），且**不抛**
    const res = computeOutputsDetailed(inputs4, snap);
    expect(res.errors).toHaveLength(1);
    expect(res.errors?.[0]).toContain("out.out0");
    expect(res.outputs).toHaveLength(4); // 计算照常完成
  });

  it("transform 的 in0 被两个源喂：同样报错（不止 _output_ 端口）", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), n("null1", "null"), transformNode("t", { tx: 1 }), outNode],
      connections: [
        c("in", "in0", "t", "in0"),
        c("null1", "out0", "t", "in0"), // 第二个源
        c("t", "out0", "out", "out0"),
      ],
    };
    const errs = findMultiSourceErrors(snap);
    expect(errs).toHaveLength(1);
    expect(errs[0].nodeLabel).toBe("t");
    expect(errs[0].targetInput).toBe("in0");
    expect(errs[0].sources.sort()).toEqual(["in.in0", "null1.out0"]);
  });

  it("三源与多端口冲突：每个冲突端口各一条错误", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), n("n1", "null"), n("n2", "null"), n("n3", "null"), outNode],
      connections: [
        c("n1", "out0", "out", "out0"),
        c("n2", "out0", "out", "out0"),
        c("n3", "out0", "out", "out0"), // out0 三源
        c("in", "in1", "out", "out1"),
        c("n1", "out0", "out", "out1"), // out1 双源
      ],
    };
    const errs = findMultiSourceErrors(snap);
    expect(errs).toHaveLength(2);
    const byPort = new Map(errs.map((e) => [e.targetInput, e]));
    expect(byPort.get("out0")?.sources).toHaveLength(3);
    expect(byPort.get("out1")?.sources).toHaveLength(2);
    expect(byPort.get("out0")?.message).toContain("3 sources");
  });

  it("同源同端口的重复连线也算多源（rete 允许的脏拓扑）", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), outNode],
      connections: [c("in", "in0", "out", "out0"), c("in", "in0", "out", "out0")],
    };
    expect(findMultiSourceErrors(snap)).toHaveLength(1);
  });
});

describe("非 geo 端口不参与几何计算", () => {
  it("portDataType：读 type 参数；旧 4 端口节点无该参数 → geo", () => {
    expect(portDataType(typedPortNode("in", "input", "float"))).toBe("float");
    expect(portDataType(typedPortNode("in", "input", "vec3"))).toBe("vec3");
    expect(portDataType(typedPortNode("in", "input", "geo"))).toBe("geo");
    expect(portDataType(n("in", "input"))).toBe("geo"); // 无参数（旧图）
    expect(portDataType(typedPortNode("in", "input", "banana"))).toBe("geo"); // 非法 → geo
  });

  it("float 的 _input_ 被排除在几何 trace 之外 → 回退 passthrough", () => {
    const snap: NetworkSnapshot = {
      nodes: [typedPortNode("in", "input", "float"), transformNode("t", { tx: 1 }), outNode],
      connections: [c("in", "in0", "t", "in0"), c("t", "out0", "out", "out0")],
    };
    const outs = computeOutputs(inputs4, snap);
    // 链被视为死链 → out0 回退 inputs[0]（未经 transform）
    expect(outs[0].points).toEqual(inputs4[0].points);
    expect(mocks.applyTranslateGrouped).not.toHaveBeenCalled();
    // computeNodeResult 同样不产出几何
    expect(computeNodeResult(snap, inputs4, "t")).toBeNull();
  });

  it("vec3 的 _input_ 同样被排除", () => {
    const snap: NetworkSnapshot = {
      nodes: [typedPortNode("in", "input", "vec3"), n("null1", "null"), outNode],
      connections: [c("in", "in0", "null1", "in0"), c("null1", "out0", "out", "out0")],
    };
    expect(computeOutputs(inputs4, snap)[0].points).toEqual(inputs4[0].points);
    expect(computeNodeResult(snap, inputs4, "null1")).toBeNull();
  });

  it("float 的 _output_ 被排除 → 4 路全回退 passthrough", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), transformNode("t", { tx: 1 }), typedPortNode("out", "output", "float")],
      connections: [c("in", "in0", "t", "in0"), c("t", "out0", "out", "out0")],
    };
    const outs = computeOutputs(inputs4, snap);
    for (let i = 0; i < 4; i++) expect(outs[i].points).toEqual(inputs4[i].points);
    expect(mocks.applyTranslateGrouped).not.toHaveBeenCalled();
  });

  it("显式 type=geo 的单端口节点几何照常计算（不被误排除）", () => {
    const snap: NetworkSnapshot = {
      nodes: [typedPortNode("in", "input", "geo"), transformNode("t", { tx: 1 }), typedPortNode("out", "output", "geo")],
      connections: [c("in", "in0", "t", "in0"), c("t", "out0", "out", "out0")],
    };
    expect(computeOutputs(inputs4, snap)[0].points).toEqual([[1, 0, 0], [2, 0, 0]]);
    expect(mocks.applyTranslateGrouped).toHaveBeenCalledTimes(1);
  });

  it("非 geo 端口既不破坏 trace 也不妨碍多源检测", () => {
    const snap: NetworkSnapshot = {
      nodes: [typedPortNode("in", "input", "float"), n("n1", "null"), outNode],
      connections: [c("in", "in0", "out", "out0"), c("n1", "out0", "out", "out0")],
    };
    const res = computeOutputsDetailed(inputs4, snap);
    expect(res.outputs).toHaveLength(4); // 不抛、不缺输出
    expect(res.errors).toHaveLength(1);
    expect(res.errors?.[0]).toContain("out.out0");
  });
});
