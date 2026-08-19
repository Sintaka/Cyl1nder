import { describe, expect, it } from "vitest";
import { firstWiredFeeder, type NetworkSnapshot } from "../src/nodes2/network";

/**
 * `null` 的计算链取**第一个已接线的输入槽**，不再死盯 `in0`（v0.1.00123）。
 *
 * 动态输入槽之后「哪个槽有线」是运行期事实：用户完全可以只接 in1、把 in0 空着。
 * 死盯 in0 会把那条链判成死链 —— 几何凭空消失，而图上明明连着线。
 */
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

describe("firstWiredFeeder", () => {
  it("只接 in1 也能找到上游（此前会被判成死链）", () => {
    const c = firstWiredFeeder(snap([["a", "out0", "n", "in1"]]), "n");
    expect(c?.targetInput).toBe("in1");
    expect(c?.source).toBe("a");
  });

  it("多槽已接线时取**序号最小**的那个（与 connections 数组顺序无关）", () => {
    // 刻意把 in2 放在前面：若按数组顺序取就会选错，撤销重做后上游还会变
    const c = firstWiredFeeder(snap([["a", "out0", "n", "in2"], ["b", "out0", "n", "in1"]]), "n");
    expect(c?.targetInput).toBe("in1");
    expect(c?.source).toBe("b");
  });

  it("in0 有线时仍取 in0（transform 等单槽节点行为逐字不变）", () => {
    const c = firstWiredFeeder(snap([["a", "out0", "n", "in0"]]), "n");
    expect(c?.targetInput).toBe("in0");
  });

  it("没有任何输入线 → undefined（死链，调用方回退 passthrough）", () => {
    expect(firstWiredFeeder(snap([]), "n")).toBeUndefined();
  });

  it("只有别人的线时不误取（按 target 过滤）", () => {
    expect(firstWiredFeeder(snap([["a", "out0", "other", "in0"]]), "n")).toBeUndefined();
  });

  it("忽略非 in<n> 的输入键（防御：将来若有别的输入端口）", () => {
    expect(firstWiredFeeder(snap([["a", "out0", "n", "weird"]]), "n")).toBeUndefined();
  });
});
