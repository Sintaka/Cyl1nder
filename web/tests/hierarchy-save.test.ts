import { describe, expect, it } from "vitest";
import {
  HIER_GRAPH_SCHEMA,
  buildGraphSnapshot,
  isEnterableKind,
  makeGeoNode,
  netKindOfCreatable,
  restoreNodeForKind,
} from "../src/nodes2/graph-model";

/**
 * obj/sop 层级的**数据契约**（v0.1.00119）。
 *
 * 这里钉住的不是 UI 手势，而是「在子网络里保存不能丢父层」这条性质——它是
 * `graph.ts` 的 `serializeGraphFromRoot()` 存在的全部理由：`serializeGraph` 只认当前
 * 那一层，而 `exitNode` 只在用户真的往上走时才把 children 写回父图。两者相加的后果是
 * 在子网络里按 Ctrl+S 会把**子图当成整个场景**存下去。本项目此前已经因为
 * 「成员图写进项目槽位」丢过一次真实数据，所以这条性质必须有测试，而不是靠
 * 「记得先退到顶层再保存」这种要求用户配合的约定。
 *
 * 无 DOM、无 rete 编辑器：折叠是纯数据操作，这里复刻 serializeGraphFromRoot 的折叠
 * 算法并断言其不变量（graph.ts 需要 jsdom 才能整体驱动，web/ 里没装）。
 */

interface NodeEntry {
  id: string;
  children?: unknown;
}
interface GraphSnap {
  schemaVersion: number;
  nodes: NodeEntry[];
}
interface Frame {
  nodeId: string;
  parentGraph: unknown;
}

/** 与 graph.ts serializeGraphFromRoot 同一套折叠：从最深处往外写回 children。
 *  **不修改栈**（保存不该改变用户所处层级），故对每帧做浅克隆。 */
function foldFromRoot(current: unknown, stack: Frame[]): unknown {
  let folded = current;
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    const parent = frame.parentGraph as { nodes?: NodeEntry[] } | null;
    if (!parent || !Array.isArray(parent.nodes)) return folded;
    const nodes = parent.nodes.map((n) => (n.id === frame.nodeId ? { ...n, children: folded } : n));
    folded = { ...parent, nodes };
  }
  return folded;
}

const snapWith = (ids: string[]): GraphSnap =>
  buildGraphSnapshot(
    ids.map((id) => ({
      id,
      kind: "geo" as const,
      label: id,
      baseLabel: "geo",
      flags: { display: false, bypass: false, freeze: false, reference: false },
      x: 0,
      y: 0,
      netKind: "obj" as const,
    })),
    [],
    { k: 1, x: 0, y: 0 },
  ) as GraphSnap;

describe("层级保存：从根折叠，绝不丢父层", () => {
  it("顶层（空栈）时折叠是恒等——旧行为逐字不变", () => {
    const cur = snapWith(["geo1"]);
    expect(foldFromRoot(cur, [])).toBe(cur); // 同一引用：没有任何多余拷贝
  });

  it("深度 1：保存产出的是**父图**，且子图挂在对应节点的 children 上", () => {
    const parent = snapWith(["geo1", "geo2"]);
    const child = { schemaVersion: HIER_GRAPH_SCHEMA, viewport: { k: 1, x: 0, y: 0 }, nodes: [{ id: "inner" }], connections: [] };
    const out = foldFromRoot(child, [{ nodeId: "geo1", parentGraph: parent }]) as GraphSnap;
    // 关键断言：存下去的是父图（两个节点都在），不是那张只有 inner 的子图
    expect(out.nodes.map((n) => n.id)).toEqual(["geo1", "geo2"]);
    expect((out.nodes.find((n) => n.id === "geo1")!.children as typeof child).nodes[0].id).toBe("inner");
    // 兄弟节点不该被牵连
    expect(out.nodes.find((n) => n.id === "geo2")!.children).toBeUndefined();
  });

  it("深度 2（套娃）：一路折到最顶层", () => {
    const root = snapWith(["geo1"]);
    const mid = snapWith(["geo2"]);
    const leaf = { schemaVersion: HIER_GRAPH_SCHEMA, viewport: { k: 1, x: 0, y: 0 }, nodes: [{ id: "leafNode" }], connections: [] };
    const out = foldFromRoot(leaf, [
      { nodeId: "geo1", parentGraph: root },
      { nodeId: "geo2", parentGraph: mid },
    ]) as GraphSnap;
    expect(out.nodes.map((n) => n.id)).toEqual(["geo1"]); // 顶层
    const midOut = out.nodes[0].children as GraphSnap;
    expect(midOut.nodes.map((n) => n.id)).toEqual(["geo2"]);
    expect((midOut.nodes[0].children as typeof leaf).nodes[0].id).toBe("leafNode");
  });

  it("折叠**不修改**入栈的父图快照（保存不改变用户所处层级/状态）", () => {
    const parent = snapWith(["geo1"]);
    const before = JSON.stringify(parent);
    foldFromRoot({ nodes: [] }, [{ nodeId: "geo1", parentGraph: parent }]);
    expect(JSON.stringify(parent)).toBe(before); // 原快照逐字不变
  });

  it("父图形状意外（缺 nodes）时给出已折叠的部分而不是抛", () => {
    const cur = { nodes: [] };
    expect(foldFromRoot(cur, [{ nodeId: "geo1", parentGraph: null }])).toBe(cur);
    expect(foldFromRoot(cur, [{ nodeId: "geo1", parentGraph: { noNodes: true } }])).toBe(cur);
  });
});

describe("层级规则", () => {
  it("geo 只在 obj 层建、可进入；sop 类不可进入", () => {
    expect(netKindOfCreatable("geo")).toBe("obj");
    expect(isEnterableKind("geo")).toBe(true);
    for (const k of ["input", "output", "null", "transform"] as const) {
      expect(netKindOfCreatable(k)).toBe("sop");
      expect(isEnterableKind(k)).toBe(false);
    }
    // project/channel 不由用户创建 → 不出现在任何层的面板里
    expect(netKindOfCreatable("project")).toBeNull();
    expect(netKindOfCreatable("channel")).toBeNull();
  });

  it("geo 节点带 children 往返：restore 后 netKind 与子图都在", () => {
    const geo = makeGeoNode();
    expect(geo.netKind).toBe("obj");
    const child = { schemaVersion: HIER_GRAPH_SCHEMA, nodes: [{ id: "x" }], connections: [] };
    const back = restoreNodeForKind({ kind: "geo", label: geo.label, netKind: "obj", children: child });
    expect(back?.kind).toBe("geo");
    expect(back?.netKind).toBe("obj");
    expect((back?.children as typeof child).nodes[0].id).toBe("x");
  });

  it("含层级的图输出 schemaVersion 5；纯 sop 旧图不受影响", () => {
    expect(snapWith(["geo1"]).schemaVersion).toBe(HIER_GRAPH_SCHEMA);
    const plain = buildGraphSnapshot(
      [{ id: "n", kind: "null", label: "null1", baseLabel: "null", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 0, y: 0 }],
      [],
      { k: 1, x: 0, y: 0 },
    ) as GraphSnap;
    expect(plain.schemaVersion).toBe(2); // 旧图字节兼容：不因层级改造而 bump
  });
});
