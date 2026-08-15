import { describe, expect, it } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import {
  PROJECT_GRAPH_SCHEMA,
  buildGraphSnapshot,
  getNetworkSnapshot,
  makeChannelNode,
  makeInputNode,
  makeNullNode,
  makeOutputNode,
  makeProjectNode,
  makeTransformNode,
  planProjectGraph,
  restoreGraph,
  restoreNodeForKind,
  serializeGraph,
  type ProjectGraphInput,
} from "../src/nodes2/graph-model";
import type { AreaExtra, CylNode, Schemes } from "../src/nodes2/graph-model";
import type { ChannelRef } from "../src/protocol/types";

/**
 * P2b 项目模式图序列化（schemaVersion 3）：纯逻辑测试（node 环境，无 DOM）。
 * - serializeGraph / buildGraphSnapshot：含 project/channel → v3 + channel 字段；
 *   纯旧 kinds → v2 且绝不含新字段。
 * - restoreGraph：v3 恢复节点/连接/位置；v2 老数据原样；未知 kind 跳过不崩。
 * - getNetworkSnapshot：project/channel 过滤（不进 compute 快照）。
 * - makeProjectNode / makeChannelNode 端口数（0 / 1+1）。
 * - planProjectGraph：成员建节点数（param 跳过）、saved 位置恢复、缺失成员跳过。
 * rete 的 NodeEditor 是纯 JS（无 DOM）；area 用内存 fake（只实现 serializeGraph /
 * restoreGraph 用到的 nodeViews.get / translate / area.zoom/translate/transform）。
 */

function channelRef(serial: string, kind: "tag" | "hda" = "tag", label = ""): ChannelRef {
  return {
    kind,
    serial,
    nodePath: null,
    absolutePath: null,
    hip: "test.hip",
    label,
    registeredAt: 0,
    lastSeen: 0,
  };
}

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

function kindsOf(editor: NodeEditor<Schemes>): string[] {
  return (editor.getNodes() as CylNode[]).map((n) => n.kind);
}

/** rete addConnection 的泛型连接（同 graph.ts 的 cast 模式）。 */
function conn(a: CylNode, ao: string, b: CylNode, bi: string): Schemes["Connection"] {
  return new ClassicPreset.Connection(a, ao, b, bi) as unknown as Schemes["Connection"];
}

describe("makeProjectNode / makeChannelNode", () => {
  it("project: 无端口（0 in / 0 out），id = 项目 serial", () => {
    const p = makeProjectNode("P1-aaaa-0000", "My Project");
    expect(Object.keys(p.inputs).length).toBe(0);
    expect(Object.keys(p.outputs).length).toBe(0);
    expect(p.id).toBe("P1-aaaa-0000");
    expect(p.kind).toBe("project");
    expect(p.label).toBe("My Project");
  });

  it("channel: 1 in / 1 out（视觉关联线用），携带 ChannelRef，id = 成员 serial", () => {
    const c = makeChannelNode("C1-aaaa-0000-0000", channelRef("C1-aaaa-0000-0000", "tag", "A"), "A");
    expect(Object.keys(c.inputs)).toEqual(["in0"]);
    expect(Object.keys(c.outputs)).toEqual(["out0"]);
    expect(c.kind).toBe("channel");
    expect(c.channel?.serial).toBe("C1-aaaa-0000-0000");
    expect(c.label).toBe("A");
  });
});

describe("serializeGraph v2/v3", () => {
  it("纯旧 kinds → schemaVersion 2 且绝不含新字段（round14-autosave / round16-undo 兼容）", async () => {
    const editor = new NodeEditor<Schemes>();
    const { area } = fakeArea();
    const input = makeInputNode();
    const transform = makeTransformNode();
    const output = makeOutputNode();
    await editor.addNode(input);
    await editor.addNode(transform);
    await editor.addNode(output);
    await editor.addConnection(conn(input, "in0", transform, "in0"));
    await editor.addConnection(conn(transform, "out0", output, "out0"));
    const snap = serializeGraph(editor, area) as {
      schemaVersion: number;
      nodes: Array<Record<string, unknown>>;
    };
    expect(snap.schemaVersion).toBe(2);
    expect(snap.nodes.length).toBe(3);
    for (const n of snap.nodes) expect(n).not.toHaveProperty("channel");
    // JSON 序列化后仍无新字段（undefined params 键被 stringify 丢弃，与旧版一致）
    const parsed = JSON.parse(JSON.stringify(snap)) as { nodes: Array<Record<string, unknown>> };
    for (const n of parsed.nodes) expect(n).not.toHaveProperty("channel");
  });

  it("含 project/channel → schemaVersion 3，channel 节点带 channel 字段，project 不带", async () => {
    const editor = new NodeEditor<Schemes>();
    const { area } = fakeArea();
    const proj = makeProjectNode("P1-aaaa-0000", "Proj");
    const chA = makeChannelNode("C1-aaaa-0000-0000", channelRef("C1-aaaa-0000-0000", "tag", "A"), "A");
    const chB = makeChannelNode("C1-bbbb-0000-0000", channelRef("C1-bbbb-0000-0000", "hda", "B"), "B");
    await editor.addNode(proj);
    await editor.addNode(chA);
    await editor.addNode(chB);
    await editor.addConnection(conn(chA, "out0", chB, "in0"));
    const snap = serializeGraph(editor, area) as {
      schemaVersion: number;
      nodes: Array<Record<string, unknown>>;
    };
    expect(snap.schemaVersion).toBe(PROJECT_GRAPH_SCHEMA);
    const chNode = snap.nodes.find((n) => n.kind === "channel") as Record<string, unknown>;
    expect((chNode.channel as ChannelRef | undefined)?.serial).toBe("C1-aaaa-0000-0000");
    const projNode = snap.nodes.find((n) => n.kind === "project") as Record<string, unknown>;
    expect(projNode).not.toHaveProperty("channel"); // null 省略
  });

  it("buildGraphSnapshot 纯函数：v3 仅在有新 kinds 时输出，v2 输出无新字段", () => {
    const oldNode: Parameters<typeof buildGraphSnapshot>[0][number] = {
      id: "n1",
      kind: "null",
      label: "null1",
      baseLabel: "null",
      flags: { display: false, bypass: false, freeze: false, reference: false },
      x: 0,
      y: 0,
    };
    const v2 = buildGraphSnapshot([oldNode], [], { k: 1, x: 0, y: 0 }) as {
      schemaVersion: number;
      nodes: Array<Record<string, unknown>>;
    };
    expect(v2.schemaVersion).toBe(2);
    expect(v2.nodes[0]).not.toHaveProperty("channel");
    const chNode = { ...oldNode, id: "c1", kind: "channel" as const, label: "A", channel: channelRef("C1") };
    const v3 = buildGraphSnapshot([oldNode, chNode], [], { k: 1, x: 0, y: 0 }) as {
      schemaVersion: number;
      nodes: Array<Record<string, unknown>>;
    };
    expect(v3.schemaVersion).toBe(3);
    expect(v3.nodes.find((n) => n.kind === "channel")).toHaveProperty("channel");
    expect(v3.nodes.find((n) => n.kind === "null")).not.toHaveProperty("channel");
  });
});

describe("restoreGraph", () => {
  it("v3：恢复节点/连接/位置；project/channel 的 display 强制熄灭", async () => {
    // 1) 建项目图并序列化
    const editor = new NodeEditor<Schemes>();
    const { area } = fakeArea();
    const proj = makeProjectNode("P1-aaaa-0000", "Proj");
    const chA = makeChannelNode("C1-aaaa-0000-0000", channelRef("C1-aaaa-0000-0000", "tag", "A"), "A");
    const chB = makeChannelNode("C1-bbbb-0000-0000", channelRef("C1-bbbb-0000-0000", "hda", "B"), "B");
    await editor.addNode(proj);
    await editor.addNode(chA);
    await editor.addNode(chB);
    await editor.addConnection(conn(chA, "out0", chB, "in0"));
    await area.translate(proj.id, { x: 100, y: 200 });
    await area.translate(chA.id, { x: 340, y: 40 });
    const snap = serializeGraph(editor, area);
    // 2) 恢复进全新 editor
    const editor2 = new NodeEditor<Schemes>();
    const area2 = fakeArea();
    await restoreGraph(editor2, area2.area, snap);
    expect(kindsOf(editor2).sort()).toEqual(["channel", "channel", "project"]);
    const nodes2 = editor2.getNodes() as CylNode[];
    expect(nodes2.find((n) => n.kind === "channel")?.channel?.serial).toBe("C1-aaaa-0000-0000");
    expect(nodes2.every((n) => n.flags.display === false)).toBe(true);
    expect(editor2.getConnections().length).toBe(1);
    // 位置按快照恢复（fake area.translate 记录）
    const pos = area2.positions.get("P1-aaaa-0000");
    expect(pos).toEqual({ x: 100, y: 200 });
  });

  it("v2 老数据原样（旧 kinds 分支不变）", async () => {
    const editor = new NodeEditor<Schemes>();
    const { area } = fakeArea();
    await restoreGraph(editor, area, {
      schemaVersion: 2,
      viewport: { k: 1, x: 0, y: 0 },
      nodes: [
        { id: "in1", kind: "input", label: "_input_", x: 0, y: 0 },
        { id: "tr1", kind: "transform", label: "transform1", x: 200, y: 0, flags: { display: true } },
        { id: "out1", kind: "output", label: "_output_", x: 400, y: 0 },
      ],
      connections: [{ source: "in1", sourceOutput: "in0", target: "tr1", targetInput: "in0" }],
    });
    expect(kindsOf(editor).sort()).toEqual(["input", "output", "transform"]);
    const disp = editor.getNodes().find((n) => (n as CylNode).kind === "transform") as CylNode;
    expect(disp.flags.display).toBe(true);
    expect(editor.getConnections().length).toBe(1);
  });

  it("未知 kind → 跳过该节点不崩；channel 缺 channel 引用 → 跳过", async () => {
    const editor = new NodeEditor<Schemes>();
    const { area } = fakeArea();
    await restoreGraph(editor, area, {
      schemaVersion: 3,
      viewport: { k: 1, x: 0, y: 0 },
      nodes: [
        { id: "banana", kind: "banana", label: "x", x: 0, y: 0 },
        { id: "orphan", kind: "channel", label: "orphan", x: 0, y: 0 }, // 无 channel 引用
        { id: "n1", kind: "null", label: "null1", x: 10, y: 10 },
      ],
      connections: [{ source: "banana", sourceOutput: "out0", target: "n1", targetInput: "in0" }],
    } as never);
    expect(kindsOf(editor)).toEqual(["null"]);
    expect(editor.getConnections().length).toBe(0); // 未知端点连接被防御性过滤
  });
});

describe("restoreNodeForKind（纯恢复决策）", () => {
  it("未知 kind → null；channel 缺 channel → null", () => {
    expect(restoreNodeForKind({ kind: "banana", id: "x" } as never)).toBeNull();
    expect(restoreNodeForKind({ kind: "channel", id: "C1" })).toBeNull();
  });
  it("project → 无端口；channel → 1+1", () => {
    const p = restoreNodeForKind({ kind: "project", id: "P1", label: "P" });
    expect(Object.keys(p!.inputs).length).toBe(0);
    const c = restoreNodeForKind({ kind: "channel", id: "C1", channel: channelRef("C1") });
    expect(Object.keys(c!.inputs).length).toBe(1);
    expect(Object.keys(c!.outputs).length).toBe(1);
  });
});

describe("getNetworkSnapshot：project/channel 过滤", () => {
  it("project/channel 不进 compute 快照（nodes/connections 均过滤）", async () => {
    const editor = new NodeEditor<Schemes>();
    const input = makeInputNode();
    const output = makeOutputNode();
    const proj = makeProjectNode("P1-aaaa-0000", "Proj");
    const ch = makeChannelNode("C1-aaaa-0000-0000", channelRef("C1-aaaa-0000-0000"), "A");
    await editor.addNode(input);
    await editor.addNode(output);
    await editor.addNode(proj);
    await editor.addNode(ch);
    await editor.addConnection(conn(input, "in0", output, "out0"));
    await editor.addConnection(conn(ch, "out0", output, "out1"));
    const snap = getNetworkSnapshot(editor);
    expect(snap.nodes.map((n) => n.kind).sort()).toEqual(["input", "output"]);
    expect(snap.connections.length).toBe(1); // 触碰 channel 的连接被过滤
  });
});

describe("planProjectGraph（loadProjectGraph 纯规划）", () => {
  const input: ProjectGraphInput = {
    projectSerial: "P1-aaaa-0000",
    label: "Proj",
    members: [
      channelRef("C1-aaaa-0000-0000", "tag", "A"),
      channelRef("C1-bbbb-0000-0000", "hda", "B"),
      // param 成员：v1 跳过（不建 channel 节点）
      {
        kind: "param",
        serial: null,
        nodePath: null,
        absolutePath: "/obj/geo1/tx",
        hip: "x.hip",
        label: "P",
        registeredAt: 0,
        lastSeen: 0,
      },
    ],
  };

  it("project 根 + tag/hda 成员各一 channel；param 成员跳过；label 回退 serial", () => {
    const plan = planProjectGraph(input);
    expect(plan.nodes.length).toBe(3); // project + 2 channel
    expect(plan.nodes[0]).toMatchObject({ id: "P1-aaaa-0000", kind: "project", label: "Proj", channel: null });
    const chans = plan.nodes.filter((n) => n.kind === "channel");
    expect(chans.map((n) => n.id).sort()).toEqual(["C1-aaaa-0000-0000", "C1-bbbb-0000-0000"]);
    expect(plan.connections).toEqual([]);
    expect(plan.viewport).toBeNull();
  });

  it("label 为空 → 回退 projectSerial / serial", () => {
    const plan = planProjectGraph({ projectSerial: "P1-aaaa-0000", label: "", members: [channelRef("C1-aaaa-0000-0000")] });
    expect(plan.nodes[0].label).toBe("P1-aaaa-0000");
    expect(plan.nodes[1].label).toBe("C1-aaaa-0000-0000");
  });

  it("saved 恢复位置/连接/viewport；缺失成员跳过；连接防御性过滤", () => {
    const saved = {
      schemaVersion: 3,
      viewport: { k: 2, x: 10, y: 20 },
      nodes: [
        { id: "P1-aaaa-0000", kind: "project", x: 100, y: 200 },
        { id: "C1-aaaa-0000-0000", kind: "channel", x: 500, y: 300 },
        { id: "C1-zzzz-0000-0000", kind: "channel", x: 999, y: 999 }, // 缺失成员（不在 members）→ 跳过
      ],
      connections: [
        { source: "C1-aaaa-0000-0000", sourceOutput: "out0", target: "C1-bbbb-0000-0000", targetInput: "in0" },
        { source: "C1-zzzz-0000-0000", sourceOutput: "out0", target: "C1-aaaa-0000-0000", targetInput: "in0" }, // 端点缺失 → 过滤
      ],
    };
    const plan = planProjectGraph(input, saved);
    expect(plan.nodes.find((n) => n.id === "P1-aaaa-0000")).toMatchObject({ x: 100, y: 200 });
    expect(plan.nodes.find((n) => n.id === "C1-aaaa-0000-0000")).toMatchObject({ x: 500, y: 300 });
    expect(plan.nodes.some((n) => n.id === "C1-zzzz-0000-0000")).toBe(false);
    expect(plan.connections).toEqual([
      { source: "C1-aaaa-0000-0000", sourceOutput: "out0", target: "C1-bbbb-0000-0000", targetInput: "in0" },
    ]);
    expect(plan.viewport).toEqual({ k: 2, x: 10, y: 20 });
  });
});
