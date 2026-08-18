import { describe, expect, it } from "vitest";
import { NodeEditor } from "rete";
import {
  applyNodeErrors,
  makeInputNode,
  makeNullNode,
  makeOutputNode,
  makeTransformNode,
  mergeNodeErrorMaps,
  multiSourceErrorsToNodeErrors,
  nodeErrorsOf,
  sameNodeErrors,
  serializeGraph,
  toNodeErrorSeverity,
  toNodeErrors,
  worstSeverity,
} from "../src/nodes2/graph-model";
import type { AreaExtra, CylNode, NodeError, Schemes } from "../src/nodes2/graph-model";
import type { AreaPlugin } from "rete-area-plugin";

/**
 * 节点错误系统（node error system）的数据层：产生方载荷 → NodeError 归一
 * （toNodeErrors / multiSourceErrorsToNodeErrors）、合并与最坏等级、以及
 * applyNodeErrors 的**全量覆盖 + churn 门闩**语义。
 * 纯逻辑（无 DOM）：NodeView 只读 node.errors，重渲染由 graph.ts 在
 * applyNodeErrors 返回 true 时触发一次。
 */

describe("toNodeErrorSeverity", () => {
  it("仅 \"warning\" 降级；其余（缺省/非法/大小写不符）一律 error", () => {
    expect(toNodeErrorSeverity("warning")).toBe("warning");
    expect(toNodeErrorSeverity("error")).toBe("error");
    expect(toNodeErrorSeverity(undefined)).toBe("error");
    expect(toNodeErrorSeverity(null)).toBe("error");
    expect(toNodeErrorSeverity("Warning")).toBe("error"); // 大小写敏感
    expect(toNodeErrorSeverity("banana")).toBe("error");
    expect(toNodeErrorSeverity(42)).toBe("error");
  });
});

describe("toNodeErrors（防御式归一，风格同 sanitizeBindings）", () => {
  it("裸字符串 → error 等级的一条", () => {
    expect(toNodeErrors("boom")).toEqual([{ severity: "error", message: "boom" }]);
  });

  it("message / error / text 三种字段名都认（按此优先级）", () => {
    expect(toNodeErrors({ message: "m" })[0].message).toBe("m");
    expect(toNodeErrors({ error: "e" })[0].message).toBe("e");
    expect(toNodeErrors({ text: "t" })[0].message).toBe("t");
    expect(toNodeErrors({ message: "m", error: "e" })[0].message).toBe("m");
  });

  it("port / source 仅接受非空字符串，否则不带该键（载荷最小）", () => {
    const full = toNodeErrors({ message: "m", severity: "warning", port: "in0", source: "compute" })[0];
    expect(full).toEqual({ severity: "warning", message: "m", port: "in0", source: "compute" });
    const bare = toNodeErrors({ message: "m", port: "", source: 42 })[0];
    expect(bare).not.toHaveProperty("port");
    expect(bare).not.toHaveProperty("source");
  });

  it("数组逐项转换，非法项跳过（不抛）", () => {
    expect(toNodeErrors(["a", "", { message: "b" }, null, 42, { nope: 1 }, "c"])).toEqual([
      { severity: "error", message: "a" },
      { severity: "error", message: "b" },
      { severity: "error", message: "c" },
    ]);
  });

  it("完全非法输入 → []（绝不抛）", () => {
    for (const bad of [null, undefined, 42, "", {}, { message: 1 }, [], [null]]) {
      expect(toNodeErrors(bad)).toEqual([]);
    }
  });
});

describe("multiSourceErrorsToNodeErrors（network.ts 结构性错误的标准转换）", () => {
  it("多源喂同一端口 → error 等级 + 归属该输入端口 + source 标签", () => {
    const map = multiSourceErrorsToNodeErrors([
      { nodeId: "n1", targetInput: "in0", message: "port null1.in0 has 2 sources" },
    ]);
    expect(map).toEqual({
      n1: [
        {
          severity: "error",
          message: "port null1.in0 has 2 sources",
          port: "in0",
          source: "multi-source",
        },
      ],
    });
  });

  it("同一节点多条错误累积在同一 key 下", () => {
    const map = multiSourceErrorsToNodeErrors([
      { nodeId: "n1", targetInput: "in0", message: "a" },
      { nodeId: "n1", targetInput: "in1", message: "b" },
      { nodeId: "n2", targetInput: "in0", message: "c" },
    ]);
    expect(map.n1).toHaveLength(2);
    expect(map.n1.map((e) => e.port)).toEqual(["in0", "in1"]);
    expect(map.n2).toHaveLength(1);
  });

  it("缺 nodeId / 空 message / 缺 targetInput 的条目：跳过或不带 port", () => {
    const map = multiSourceErrorsToNodeErrors([
      { nodeId: "", targetInput: "in0", message: "dropped" },
      { nodeId: "n1", message: "no port" },
      { nodeId: "n2", targetInput: "in0", message: "" },
    ]);
    expect(map).not.toHaveProperty("n2"); // 空 message 被丢
    expect(Object.keys(map)).toEqual(["n1"]);
    expect(map.n1[0]).not.toHaveProperty("port"); // 无 targetInput → 只在标题出角标
  });

  it("空输入 → {}", () => {
    expect(multiSourceErrorsToNodeErrors([])).toEqual({});
  });
});

describe("mergeNodeErrorMaps / worstSeverity", () => {
  it("同节点的多来源错误拼接（不覆盖）", () => {
    const merged = mergeNodeErrorMaps(
      { n1: [{ severity: "error", message: "structural" }] },
      { n1: [{ severity: "warning", message: "compute" }], n2: [{ severity: "error", message: "x" }] },
    );
    expect(merged.n1.map((e) => e.message)).toEqual(["structural", "compute"]);
    expect(merged.n2).toHaveLength(1);
  });

  it("null / undefined / 空列表来源被忽略", () => {
    expect(mergeNodeErrorMaps(null, undefined, {}, { n1: [] })).toEqual({});
  });

  it("worstSeverity：有 error 取 error；全 warning 取 warning；空 → null", () => {
    expect(worstSeverity([{ severity: "warning", message: "a" }, { severity: "error", message: "b" }])).toBe("error");
    expect(worstSeverity([{ severity: "warning", message: "a" }])).toBe("warning");
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity(undefined)).toBeNull();
  });
});

describe("sameNodeErrors（churn 判定指纹）", () => {
  const base: NodeError[] = [{ severity: "error", message: "m", port: "in0" }];

  it("同内容（含 undefined vs 空数组）视为相等", () => {
    expect(sameNodeErrors(base, [{ severity: "error", message: "m", port: "in0" }])).toBe(true);
    expect(sameNodeErrors(undefined, [])).toBe(true);
    expect(sameNodeErrors(undefined, undefined)).toBe(true);
  });

  it("message / severity / port 任一不同即不相等（文案变化也要刷新）", () => {
    expect(sameNodeErrors(base, [{ severity: "error", message: "m2", port: "in0" }])).toBe(false);
    expect(sameNodeErrors(base, [{ severity: "warning", message: "m", port: "in0" }])).toBe(false);
    expect(sameNodeErrors(base, [{ severity: "error", message: "m", port: "in1" }])).toBe(false);
    expect(sameNodeErrors(base, [{ severity: "error", message: "m" }])).toBe(false);
  });

  it("长度与顺序敏感", () => {
    expect(sameNodeErrors(base, [])).toBe(false);
    expect(
      sameNodeErrors(
        [{ severity: "error", message: "a" }, { severity: "error", message: "b" }],
        [{ severity: "error", message: "b" }, { severity: "error", message: "a" }],
      ),
    ).toBe(false);
  });

  it("source 不进指纹（仅排错标签，变化不该引起重渲染）", () => {
    expect(
      sameNodeErrors(
        [{ severity: "error", message: "m", source: "compute" }],
        [{ severity: "error", message: "m", source: "bridge" }],
      ),
    ).toBe(true);
  });
});

describe("applyNodeErrors（全量覆盖 + churn 门闩）", () => {
  /** 建一张 input -> null -> output 的图，返回编辑器与三个节点。 */
  async function graph(): Promise<{
    editor: NodeEditor<Schemes>;
    input: CylNode;
    nul: CylNode;
    output: CylNode;
  }> {
    const editor = new NodeEditor<Schemes>();
    const input = makeInputNode(true);
    const nul = makeNullNode();
    const output = makeOutputNode(true);
    await editor.addNode(input);
    await editor.addNode(nul);
    await editor.addNode(output);
    return { editor, input, nul, output };
  }

  it("首次写入 → true，错误落到对应节点", async () => {
    const { editor, nul } = await graph();
    const changed = applyNodeErrors(editor, {
      [nul.id]: [{ severity: "error", message: "boom", port: "in0" }],
    });
    expect(changed).toBe(true);
    expect(nul.errors).toEqual([{ severity: "error", message: "boom", port: "in0" }]);
  });

  it("重复写入同内容 → false（churn 门闩：调用方据此不重渲染）", async () => {
    const { editor, nul } = await graph();
    const errors = { [nul.id]: [{ severity: "error" as const, message: "boom" }] };
    expect(applyNodeErrors(editor, errors)).toBe(true);
    expect(applyNodeErrors(editor, errors)).toBe(false);
    // 等价的**新对象**同样不算变化（比的是内容指纹，不是引用）
    expect(applyNodeErrors(editor, { [nul.id]: [{ severity: "error", message: "boom" }] })).toBe(false);
  });

  it("文案变化 → true（多源从 2 个变 3 个这类必须刷新）", async () => {
    const { editor, nul } = await graph();
    applyNodeErrors(editor, { [nul.id]: [{ severity: "error", message: "2 sources" }] });
    expect(applyNodeErrors(editor, { [nul.id]: [{ severity: "error", message: "3 sources" }] })).toBe(true);
  });

  it("全量语义：表里没有的节点被清空，且 errors 键被删除（不留空数组）", async () => {
    const { editor, nul } = await graph();
    applyNodeErrors(editor, { [nul.id]: [{ severity: "error", message: "boom" }] });
    expect(nul.errors).toBeDefined();
    const changed = applyNodeErrors(editor, {}); // 修好了：产生方无需显式清除
    expect(changed).toBe(true);
    expect(nul.errors).toBeUndefined();
    expect("errors" in nul).toBe(false);
  });

  it("全空 → 全空：无变化 → false（无错误时每次 cook 零重渲染）", async () => {
    const { editor } = await graph();
    expect(applyNodeErrors(editor, {})).toBe(false);
    expect(applyNodeErrors(editor, {})).toBe(false);
  });

  it("指向不存在节点的条目被忽略（图已重建/节点已删），不抛", async () => {
    const { editor } = await graph();
    expect(applyNodeErrors(editor, { ghost: [{ severity: "error", message: "gone" }] })).toBe(false);
  });

  it("多节点同时报错；只改其中一个时仍返回 true", async () => {
    const { editor, nul, input } = await graph();
    applyNodeErrors(editor, {
      [nul.id]: [{ severity: "error", message: "a" }],
      [input.id]: [{ severity: "warning", message: "b" }],
    });
    expect(worstSeverity(nul.errors)).toBe("error");
    expect(worstSeverity(input.errors)).toBe("warning");
    const changed = applyNodeErrors(editor, {
      [nul.id]: [{ severity: "error", message: "a" }], // 未变
      [input.id]: [{ severity: "error", message: "b" }], // 等级变了
    });
    expect(changed).toBe(true);
  });

  it("写入的是拷贝：改动入参数组不影响已落地的错误", async () => {
    const { editor, nul } = await graph();
    const list: NodeError[] = [{ severity: "error", message: "orig" }];
    applyNodeErrors(editor, { [nul.id]: list });
    list[0].message = "mutated";
    expect(nul.errors?.[0].message).toBe("orig");
  });

  it("nodeErrorsOf 返回只读拷贝；未知节点 → []", async () => {
    const { editor, nul } = await graph();
    applyNodeErrors(editor, { [nul.id]: [{ severity: "error", message: "m" }] });
    const read = nodeErrorsOf(editor, nul.id);
    expect(read).toEqual([{ severity: "error", message: "m" }]);
    read[0].message = "mutated";
    expect(nul.errors?.[0].message).toBe("m"); // 拷贝，改不到节点
    expect(nodeErrorsOf(editor, "ghost")).toEqual([]);
  });
});

describe("错误是运行期瞬时态（不进序列化）", () => {
  /** 无 DOM 的 fake area（同 socket-type.test.ts / project-graph.test.ts 的写法）。 */
  function fakeArea(): AreaPlugin<Schemes, AreaExtra> {
    const positions = new Map<string, { x: number; y: number }>();
    return {
      nodeViews: { get: (id: string) => (positions.has(id) ? { position: positions.get(id) } : undefined) },
      translate: async (id: string, p: { x: number; y: number }) => {
        positions.set(id, p);
      },
      area: { transform: { k: 1, x: 0, y: 0 }, zoom: async () => undefined, translate: async () => undefined },
    } as unknown as AreaPlugin<Schemes, AreaExtra>;
  }

  it("带错误的图序列化后**不含** errors 键，且 schemaVersion 不变（旧图字节兼容）", async () => {
    const editor = new NodeEditor<Schemes>();
    const area = fakeArea();
    await editor.addNode(makeInputNode());
    await editor.addNode(makeTransformNode());
    await editor.addNode(makeOutputNode());
    const before = JSON.stringify(serializeGraph(editor, area));
    for (const n of editor.getNodes() as CylNode[]) {
      applyNodeErrors(editor, { [n.id]: [{ severity: "error", message: "boom", port: "in0" }] });
    }
    const after = serializeGraph(editor, area) as { schemaVersion: number; nodes: Array<Record<string, unknown>> };
    expect(JSON.stringify(after)).toBe(before); // 字节完全一致
    expect(after.schemaVersion).toBe(2);
    for (const nd of after.nodes) expect(nd).not.toHaveProperty("errors");
  });
});
