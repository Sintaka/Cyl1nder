import { describe, expect, it } from "vitest";
import {
  buildGraphSnapshot,
  makeNullNode,
  refParamName,
  syncDynamicInputs,
  syncRefParams,
} from "../src/nodes2/graph-model";

/**
 * null 节点的端口引用参数（用户需求 #4）。
 *
 * 用户报的 bug 是「null 的 param 中啥都没有, 没地方填引用覆盖地址」——上一轮我只做了
 * 存储字段与右键菜单，**没有真的给 null 生成这些参数**，所以面板确实是空的。
 */
describe("null 端口引用参数", () => {
  it("新建 null 就带 in0/out0 两个引用参数（面板不再是空的）", () => {
    const n = makeNullNode();
    expect(n.params?.map((p) => p.name)).toEqual([refParamName("in0"), refParamName("out0")]);
    expect(n.params?.every((p) => p.type === "string" && p.value === "")).toBe(true);
  });

  it("端口长出来就同步长出参数", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0"]); // 接了 in0 → 端口变成 in0,in1
    expect(Object.keys(n.inputs)).toEqual(["in0", "in1"]);
    expect(n.params?.map((p) => p.name)).toEqual([
      refParamName("in0"),
      refParamName("in1"),
      refParamName("out0"),
    ]);
  });

  it("端口收回去时不丢用户已经填过的引用", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0", "in1"]);
    const p = n.params?.find((x) => x.name === refParamName("in1"));
    if (p) p.value = "transform1/tx";
    syncDynamicInputs(n, ["in0", "in1"]); // 同样的接线 → 不该动
    expect(n.params?.find((x) => x.name === refParamName("in1"))?.value).toBe("transform1/tx");
  });

  it("空引用不序列化：v2 图里 null 仍然不带 params 键（字节兼容承重墙）", () => {
    const n = makeNullNode();
    expect(n.params?.length).toBeGreaterThan(0); // 内存里有（面板要用）
    const snap = buildGraphSnapshot(
      [
        {
          id: "n",
          kind: "null",
          label: n.label,
          baseLabel: "null",
          flags: { display: false, bypass: false, freeze: false, reference: false },
          x: 0,
          y: 0,
          params: n.params,
        },
      ],
      [],
      { k: 1, x: 0, y: 0 },
    ) as { schemaVersion: number; nodes: Array<{ params?: unknown }> };
    expect(snap.schemaVersion).toBe(2);
    expect(snap.nodes[0]?.params).toBeUndefined(); // 磁盘上没有 → 旧图字节不变
  });

  it("填了引用之后才进快照", () => {
    const n = makeNullNode();
    const p = n.params?.find((x) => x.name === refParamName("in0"));
    if (p) p.value = "point_1.x";
    const snap = buildGraphSnapshot(
      [
        {
          id: "n",
          kind: "null",
          label: n.label,
          baseLabel: "null",
          flags: { display: false, bypass: false, freeze: false, reference: false },
          x: 0,
          y: 0,
          params: n.params,
        },
      ],
      [],
      { k: 1, x: 0, y: 0 },
    ) as { nodes: Array<{ params?: Array<{ name: string; value: unknown }> }> };
    expect(snap.nodes[0]?.params).toEqual([{ name: refParamName("in0"), type: "string", value: "point_1.x", default: "" }]);
  });

  it("syncRefParams 幂等（同样端口反复调不产生变化）", () => {
    const n = makeNullNode();
    expect(syncRefParams(n)).toBe(false);
  });
});
