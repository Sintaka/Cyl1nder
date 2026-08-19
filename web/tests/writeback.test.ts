import { describe, expect, it } from "vitest";
import { collectWritebackTargets, resolveWritebackValue } from "../src/core/dataflow";
import type { NetworkSnapshot } from "../src/nodes2/network";

/**
 * 非 geo `_output_` 的写回通路（v0.1.00125）。
 *
 * 用户报的现象：「我 output 了一个 tx，为啥 hou 没同步」。根因是 `network.ts:379`
 * 明确跳过非 geo 的 `_output_`，float/vec3 **从来没有落地通路**。
 */
const P = (name: string, value: unknown) => ({ name, type: "string", value });

const snap = (nodes: unknown[], connections: unknown[] = []): NetworkSnapshot =>
  ({ nodes, connections }) as unknown as NetworkSnapshot;

const outNode = (type: string, address: string, port: string) => ({
  id: "o",
  kind: "output",
  label: "_output_",
  params: [P("address", address), P("type", type), P("port", port)],
});

const S = "C1-mt09nkms-bwxp";

describe("collectWritebackTargets", () => {
  it("float 的 _output_ 是写回目标（用户那张图的形状）", () => {
    const t = collectWritebackTargets(snap([outNode("float", S, "transform1/tx")]));
    expect(t).toEqual([{ nodeId: "o", address: S, port: "transform1/tx", type: "float" }]);
  });

  it("geo 的 _output_ 不收：它走既有几何通路，重复推会两条路打架", () => {
    expect(collectWritebackTargets(snap([outNode("geo", S, "transform1/tx")]))).toEqual([]);
  });

  it("address / port 没填完 → 不是目标（没填完不是错误）", () => {
    expect(collectWritebackTargets(snap([outNode("float", S, "")]))).toEqual([]);
    expect(collectWritebackTargets(snap([outNode("float", "", "transform1/tx")]))).toEqual([]);
  });

  it("旧 4 端口图（无 type 参数）→ 不是目标，老图不会突然开始写 Houdini", () => {
    expect(collectWritebackTargets(snap([{ id: "o", kind: "output", label: "_output_" }]))).toEqual([]);
  });
});

describe("resolveWritebackValue", () => {
  const target = { nodeId: "o", address: S, port: "transform1/tx", type: "float" };

  it("上游 transform：按端口序号取 tx/ty/tz", () => {
    const tf = { id: "t", kind: "transform", params: [P("tx", 1.5), P("ty", 2.5), P("tz", 3.5)] };
    const s = (out: string) =>
      snap([outNode("float", S, "transform1/tx"), tf], [{ source: "t", sourceOutput: out, target: "o", targetInput: "out0" }]);
    expect(resolveWritebackValue(s("out0"), target)).toBe(1.5);
    expect(resolveWritebackValue(s("out1"), target)).toBe(2.5);
    expect(resolveWritebackValue(s("out2"), target)).toBe(3.5);
  });

  it("上游 null 的槽引用是数字字面量 → 写那个数（用户填的 \"2\"）", () => {
    const nul = { id: "n", kind: "null", params: [P("ref_slot0", "2")] };
    const s = snap([outNode("float", S, "transform1/tx"), nul], [{ source: "n", sourceOutput: "out0", target: "o", targetInput: "out0" }]);
    expect(resolveWritebackValue(s, target)).toBe(2);
  });

  it("槽引用是**地址**而不是数字 → 不写（异步取值不在同步热路径里做）", () => {
    const nul = { id: "n", kind: "null", params: [P("ref_slot0", "transform1/tx")] };
    const s = snap([outNode("float", S, "transform1/tx"), nul], [{ source: "n", sourceOutput: "out0", target: "o", targetInput: "out0" }]);
    expect(resolveWritebackValue(s, target)).toBeUndefined();
  });

  it("没接线 / 无数值来源 → undefined，**绝不**兜底写 0", () => {
    expect(resolveWritebackValue(snap([outNode("float", S, "transform1/tx")]), target)).toBeUndefined();
    const nul = { id: "n", kind: "null", params: [P("ref_slot0", "")] };
    const s = snap([outNode("float", S, "transform1/tx"), nul], [{ source: "n", sourceOutput: "out0", target: "o", targetInput: "out0" }]);
    expect(resolveWritebackValue(s, target)).toBeUndefined();
  });
});
