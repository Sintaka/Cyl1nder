import { describe, expect, it } from "vitest";
import { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import {
  applyNodeBindings,
  buildGraphSnapshot,
  listNodeParamBindingsView,
  makeTransformNode,
  nodeParamBindingsView,
  restoreGraph,
  restoreNodeForKind,
  sanitizeBindings,
  serializeGraph,
  type AreaExtra,
  type CylNode,
  type Schemes,
} from "../src/nodes2/graph-model";

/**
 * P5b 通道引用绑定（写集 A：节点绑定模型）：纯逻辑测试（node 环境，无 DOM）。
 * - CylNode.bindings 序列化：非空 → 输出 bindings 键；空 {} / 缺省 → 无该键（旧图字节级兼容）。
 * - restoreGraph / restoreNodeForKind：读回 bindings；非法（数组/字符串）忽略。
 * - sanitizeBindings：仅接受「普通对象 + 字符串值」。
 * - 数据层（graph.ts 薄壳的纯函数核心）：nodeParamBindingsView /
 *   listNodeParamBindingsView / applyNodeBindings（清空 = 传 {} → 删除键；拷贝语义）。
 * 说明：graph.ts 的 getNodeParamBindings / listNodeParamBindings / setNodeBindings 只是
 * 把这里的纯函数绑到模块级 activeGraph（createReteGraph 才注册，需要 DOM），因此数据层
 * 逻辑在 graph-model 内测试（rete NodeEditor 纯 JS 无 DOM；area 用内存 fake）。
 */

/** 无 DOM 的 fake area：记录位置 + 接受 translate/zoom（graph-model 只用这些）。 */
function fakeArea(): { area: AreaPlugin<Schemes, AreaExtra>; positions: Map<string, { x: number; y: number }> } {
  const positions = new Map<string, { x: number; y: number }>();
  const area = {
    nodeViews: {
      get: (id: string): { position: { x: number; y: number } } | undefined =>
        positions.has(id) ? { position: positions.get(id) as { x: number; y: number } } : undefined,
    },
    translate: async (id: string, pos: { x: number; y: number }) => {
      positions.set(id, pos);
    },
    area: {
      transform: { k: 1, x: 0, y: 0 },
      zoom: async () => undefined,
      translate: async () => undefined,
    },
  };
  return { area: area as unknown as AreaPlugin<Schemes, AreaExtra>, positions };
}

describe("sanitizeBindings（restore 校验）", () => {
  it("普通对象 + 字符串值 → 原样保留", () => {
    expect(sanitizeBindings({ tx: "/obj/geo1/transform1/tx", ty: "/obj/geo1/transform1/ty" })).toEqual({
      tx: "/obj/geo1/transform1/tx",
      ty: "/obj/geo1/transform1/ty",
    });
  });

  it("非法输入（数组 / 字符串 / null / number）→ undefined", () => {
    expect(sanitizeBindings([])).toBeUndefined();
    expect(sanitizeBindings("junk")).toBeUndefined();
    expect(sanitizeBindings(null)).toBeUndefined();
    expect(sanitizeBindings(42)).toBeUndefined();
    expect(sanitizeBindings(undefined)).toBeUndefined();
  });

  it("值非字符串的键被忽略；全部非法 → undefined", () => {
    expect(sanitizeBindings({ a: "ok", b: 1, c: null, d: ["x"] })).toEqual({ a: "ok" });
    expect(sanitizeBindings({ a: 1 })).toBeUndefined();
    expect(sanitizeBindings({})).toBeUndefined();
  });
});

describe("serializeGraph：bindings 键条件输出（字节级兼容）", () => {
  it("bindings 非空 → 节点 dict 输出 bindings 键；JSON 往返后仍在", async () => {
    const editor = new NodeEditor<Schemes>();
    const { area } = fakeArea();
    const t = makeTransformNode();
    t.bindings = { tx: "/obj/geo1/transform1/tx" };
    await editor.addNode(t);
    const snap = serializeGraph(editor, area) as { nodes: Array<Record<string, unknown>> };
    expect(snap.nodes[0]).toHaveProperty("bindings");
    expect((snap.nodes[0].bindings as Record<string, string>).tx).toBe("/obj/geo1/transform1/tx");
    // JSON 序列化后键仍在（字节级兼容：非空才输出）
    const parsed = JSON.parse(JSON.stringify(snap)) as { nodes: Array<Record<string, unknown>> };
    expect(parsed.nodes[0]).toHaveProperty("bindings");
  });

  it("bindings 空 {} / 缺省 → 节点 dict 不含 bindings 键（旧图字节级兼容）", async () => {
    const editor = new NodeEditor<Schemes>();
    const { area } = fakeArea();
    const empty = makeTransformNode();
    empty.bindings = {};
    const none = makeTransformNode();
    await editor.addNode(empty);
    await editor.addNode(none);
    const snap = serializeGraph(editor, area) as { nodes: Array<Record<string, unknown>> };
    for (const n of snap.nodes) expect(n).not.toHaveProperty("bindings");
    // JSON 序列化后仍无该键（undefined 被 stringify 丢弃）
    const parsed = JSON.parse(JSON.stringify(snap)) as { nodes: Array<Record<string, unknown>> };
    for (const n of parsed.nodes) expect(n).not.toHaveProperty("bindings");
  });
});

describe("buildGraphSnapshot（纯函数）：bindings 条件输出", () => {
  it("非空 → 输出键；空 {} / 缺省 → 无该键", () => {
    const base: Parameters<typeof buildGraphSnapshot>[0][number] = {
      id: "n1",
      kind: "transform",
      label: "transform1",
      baseLabel: "transform",
      flags: { display: false, bypass: false, freeze: false, reference: false },
      x: 0,
      y: 0,
    };
    const v = buildGraphSnapshot([base, { ...base, id: "n2", bindings: { tx: "/a/b/tx" } }], [], { k: 1, x: 0, y: 0 }) as {
      nodes: Array<Record<string, unknown>>;
    };
    expect(v.nodes[0]).not.toHaveProperty("bindings"); // 缺省 → 无键
    expect((v.nodes[1].bindings as Record<string, string>).tx).toBe("/a/b/tx"); // 非空 → 有键
    const empty = buildGraphSnapshot([{ ...base, id: "n3", bindings: {} }], [], { k: 1, x: 0, y: 0 }) as {
      nodes: Array<Record<string, unknown>>;
    };
    expect(empty.nodes[0]).not.toHaveProperty("bindings"); // 空 {} → 无键
  });
});

describe("restoreGraph：bindings 读回 / 非法忽略", () => {
  it("快照含 bindings → 恢复节点带 bindings；JSON 往返后仍正确", async () => {
    const editor = new NodeEditor<Schemes>();
    const { area } = fakeArea();
    const t = makeTransformNode();
    t.bindings = { tx: "/obj/geo1/transform1/tx" };
    await editor.addNode(t);
    const snap = JSON.parse(JSON.stringify(serializeGraph(editor, area))); // 模拟落盘/读盘
    const editor2 = new NodeEditor<Schemes>();
    const area2 = fakeArea();
    await restoreGraph(editor2, area2.area, snap);
    const restored = editor2.getNodes()[0] as CylNode;
    expect(restored.kind).toBe("transform");
    expect(restored.bindings).toEqual({ tx: "/obj/geo1/transform1/tx" });
  });

  it("非法 bindings（数组 / 字符串）→ 忽略，节点无 bindings 键", async () => {
    const editor = new NodeEditor<Schemes>();
    const { area } = fakeArea();
    await restoreGraph(editor, area, {
      schemaVersion: 2,
      viewport: { k: 1, x: 0, y: 0 },
      nodes: [
        { id: "t1", kind: "transform", label: "transform1", x: 0, y: 0, bindings: ["junk"] },
        { id: "t2", kind: "transform", label: "transform2", x: 200, y: 0, bindings: "junk" },
        { id: "t3", kind: "transform", label: "transform3", x: 400, y: 0, bindings: { tx: "/ok/tx" } },
      ],
      connections: [],
    });
    const nodes = editor.getNodes() as CylNode[];
    expect(nodes[0].bindings).toBeUndefined();
    expect(nodes[1].bindings).toBeUndefined();
    expect(nodes[2].bindings).toEqual({ tx: "/ok/tx" });
  });
});

describe("restoreNodeForKind：bindings 可选读入", () => {
  it("transform + 合法 bindings → 节点带绑定；非法 → 无绑定", () => {
    const ok = restoreNodeForKind({
      kind: "transform",
      id: "t1",
      bindings: { tx: "/obj/geo1/transform1/tx" },
    });
    expect(ok?.bindings).toEqual({ tx: "/obj/geo1/transform1/tx" });
    const bad = restoreNodeForKind({ kind: "transform", id: "t2", bindings: [1, 2] as never });
    expect(bad?.bindings).toBeUndefined();
    const none = restoreNodeForKind({ kind: "transform", id: "t3" });
    expect(none?.bindings).toBeUndefined();
  });
});

describe("数据层：nodeParamBindingsView / listNodeParamBindingsView / applyNodeBindings", () => {
  it("nodeParamBindingsView：params 名/值 + bindings 拷贝；节点不存在 → null", async () => {
    const editor = new NodeEditor<Schemes>();
    const t = makeTransformNode();
    t.bindings = { tx: "/obj/geo1/transform1/tx" };
    await editor.addNode(t);
    const view = nodeParamBindingsView(editor, t.id);
    expect(view).not.toBeNull();
    expect(view!.params.length).toBe(8); // makeTransformNode 固定 8 个 params
    expect(view!.params[0]).toEqual({ name: "px", type: "float", value: 0 }); // P5b 视图带完整 ParamSpec
    expect(view!.bindings).toEqual({ tx: "/obj/geo1/transform1/tx" });
    // 拷贝语义：改返回的 bindings 不影响节点
    view!.bindings.tx = "mutated";
    expect((editor.getNode(t.id) as CylNode).bindings?.tx).toBe("/obj/geo1/transform1/tx");
    expect(nodeParamBindingsView(editor, "missing")).toBeNull();
  });

  it("listNodeParamBindingsView：全部节点（无绑定 → bindings = {}）", async () => {
    const editor = new NodeEditor<Schemes>();
    const a = makeTransformNode();
    a.bindings = { tx: "/a/tx" };
    const b = makeTransformNode();
    await editor.addNode(a);
    await editor.addNode(b);
    const list = listNodeParamBindingsView(editor);
    expect(list.length).toBe(2);
    const va = list.find((x) => x.id === a.id)!;
    expect(va.label).toBe(a.label); // transformSeq 模块级共享（跨测试文件递增）→ 用节点自身 label 断言
    expect(va.bindings).toEqual({ tx: "/a/tx" });
    expect(list.find((x) => x.id === b.id)!.bindings).toEqual({});
  });

  it("applyNodeBindings：写入拷贝；清空 = 传 {} → 删除键；节点不存在 → false", async () => {
    const editor = new NodeEditor<Schemes>();
    const t = makeTransformNode();
    await editor.addNode(t);
    expect(applyNodeBindings(editor, "missing", { tx: "x" })).toBe(false);
    // 写入（拷贝语义：后续改入参不影响节点）
    const input = { tx: "/obj/geo1/transform1/tx" };
    expect(applyNodeBindings(editor, t.id, input)).toBe(true);
    input.tx = "mutated-after-apply";
    expect((editor.getNode(t.id) as CylNode).bindings?.tx).toBe("/obj/geo1/transform1/tx");
    // 清空：bindings 键被删除（序列化无该键）
    expect(applyNodeBindings(editor, t.id, {})).toBe(true);
    const n = editor.getNode(t.id) as CylNode;
    expect(n.bindings).toBeUndefined();
  });
});
