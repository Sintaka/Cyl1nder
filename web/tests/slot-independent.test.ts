import { describe, expect, it } from "vitest";
import { slotFeederFor, type NetworkSnapshot } from "../src/nodes2/network";

/** null 的槽是**互相独立**的直通通道：out{k} 只读 in{k}（v0.1.00124）。 */
const snap = (conns: Array<[string, string, string, string]>): NetworkSnapshot =>
  ({
    nodes: [],
    connections: conns.map(([source, sourceOutput, target, targetInput]) => ({
      source,
      sourceOutput,
      target,
      targetInput,
    })),
  }) as unknown as NetworkSnapshot;

const nul = { id: "n", kind: "null" };
const xf = { id: "n", kind: "transform" };

describe("slotFeederFor", () => {
  it("out2 读 in2，不借槽 0 的数据", () => {
    const s = snap([
      ["a", "out0", "n", "in0"],
      ["b", "out0", "n", "in2"],
    ]);
    expect(slotFeederFor(s, nul, "out2")?.source).toBe("b");
    expect(slotFeederFor(s, nul, "out0")?.source).toBe("a");
  });

  it("该槽没接线 → undefined（死链），**绝不**借别的槽充数", () => {
    // 这条是「看着对、算错」的防线：槽 1 空着时 out1 必须是空通道，
    // 而不是悄悄把槽 0 的几何送出去。
    const s = snap([["a", "out0", "n", "in0"]]);
    expect(slotFeederFor(s, nul, "out1")).toBeUndefined();
  });

  it("transform 不参与按槽解析（只有一个槽，行为逐字不变）", () => {
    const s = snap([["a", "out0", "n", "in0"]]);
    expect(slotFeederFor(s, xf, "out0")?.source).toBe("a");
    // 即便问一个不存在的 out5，transform 也退回"第一个已接线的槽"
    expect(slotFeederFor(s, xf, "out5")?.source).toBe("a");
  });

  it("null 遇到非 out<n> 的怪键 → 退回第一个已接线的槽（不崩）", () => {
    const s = snap([["a", "out0", "n", "in1"]]);
    expect(slotFeederFor(s, nul, "weird")?.source).toBe("a");
  });
});
