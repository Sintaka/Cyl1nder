import { describe, expect, it } from "vitest";
import { computeOutputs } from "../src/nodes2/network";
import type { NetworkSnapshot } from "../src/nodes2/network";
import type { InputPayload } from "../src/protocol/types";

// 临时验证（验完即删）：dot 必须是纯装饰——插入前后输出逐字节一致。
const mk = (i: number, pts: number[][]): InputPayload => ({
  index: i, rev: 1, pointCount: pts.length, primCount: 0,
  points: pts, curves: [], faces: [], attributes: {},
});
const inputs = [mk(0, [[1, 2, 3], [4, 5, 6]]), mk(1, []), mk(2, []), mk(3, [])];
const io = [
  { name: "address", type: "string", value: "" },
  { name: "type", type: "menu", value: "geo" },
];

describe("dot is cook-neutral", () => {
  const direct: NetworkSnapshot = {
    nodes: [
      { id: "i", kind: "input", label: "_input_", params: [...io] },
      { id: "o", kind: "output", label: "_output_", params: [...io] },
    ],
    connections: [{ source: "i", sourceOutput: "in0", target: "o", targetInput: "out0" }],
  } as NetworkSnapshot;

  const viaDot: NetworkSnapshot = {
    nodes: [
      { id: "i", kind: "input", label: "_input_", params: [...io] },
      { id: "d", kind: "dot", label: "_dot_1" },
      { id: "o", kind: "output", label: "_output_", params: [...io] },
    ],
    connections: [
      { source: "i", sourceOutput: "in0", target: "d", targetInput: "in0" },
      { source: "d", sourceOutput: "out0", target: "o", targetInput: "out0" },
    ],
  } as NetworkSnapshot;

  it("插入 dot 后输出与直连完全一致", () => {
    expect(JSON.stringify(computeOutputs(inputs, viaDot))).toBe(
      JSON.stringify(computeOutputs(inputs, direct)),
    );
  });

  it("dot 链不破坏 passthrough（仍 4 路，首点原值）", () => {
    const outs = computeOutputs(inputs, viaDot);
    expect(outs).toHaveLength(4);
    expect(outs[0].points?.[0]).toEqual([1, 2, 3]);
  });
});
