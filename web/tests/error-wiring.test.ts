import { describe, expect, it } from "vitest";
import { findMultiSourceErrors } from "../src/nodes2/network";
import { multiSourceErrorsToNodeErrors, worstSeverity } from "../src/nodes2/graph-model";
import type { NetworkSnapshot } from "../src/nodes2/network";

// 钉住「多个 out 连到同一输入 -> 报错而不是静默挑第一条」这条链路真的接通了：
// findMultiSourceErrors -> multiSourceErrorsToNodeErrors -> setNodeErrors（在 dataflow.flush 里调用）。
// 此前三块都存在但没人把它们串起来，错误永远不会出现在 UI 上。
describe("multi-source error reaches the node error map", () => {
  const conflict: NetworkSnapshot = {
    nodes: [
      { id: "t1", kind: "transform", label: "transform1" },
      { id: "t2", kind: "transform", label: "transform2" },
      { id: "o", kind: "output", label: "_output_" },
    ],
    connections: [
      { source: "t1", sourceOutput: "out0", target: "o", targetInput: "out0" },
      { source: "t2", sourceOutput: "out0", target: "o", targetInput: "out0" },
    ],
  } as NetworkSnapshot;

  it("两个源连同一端口 -> 该节点有 error 级错误，且带出端口名", () => {
    const errs = multiSourceErrorsToNodeErrors(findMultiSourceErrors(conflict));
    expect(Object.keys(errs)).toEqual(["o"]);
    expect(errs["o"][0].severity).toBe("error");
    expect(errs["o"][0].port).toBe("out0");
    expect(errs["o"][0].message).toContain("out0");
  });

  it("错误信息点名全部竞争源（让用户知道该删哪条）", () => {
    const msg = multiSourceErrorsToNodeErrors(findMultiSourceErrors(conflict))["o"][0].message;
    expect(msg).toContain("transform1");
    expect(msg).toContain("transform2");
  });

  it("worstSeverity 取最严重的一条（一个节点只出一枚角标）", () => {
    const errs = multiSourceErrorsToNodeErrors(findMultiSourceErrors(conflict));
    expect(worstSeverity(errs["o"])).toBe("error");
  });

  it("单源图不产生任何错误（不误报）", () => {
    const clean: NetworkSnapshot = {
      nodes: [
        { id: "t1", kind: "transform", label: "transform1" },
        { id: "o", kind: "output", label: "_output_" },
      ],
      connections: [{ source: "t1", sourceOutput: "out0", target: "o", targetInput: "out0" }],
    } as NetworkSnapshot;
    expect(multiSourceErrorsToNodeErrors(findMultiSourceErrors(clean))).toEqual({});
  });
});
