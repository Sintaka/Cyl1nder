import { describe, expect, it } from "vitest";
import { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import {
  ADDRESS_GRAPH_SCHEMA,
  FLOAT,
  GEO,
  SOCKET_TYPES,
  VEC3,
  canConnectSockets,
  detectLegacyPorts,
  makeInputNode,
  makeOutputNode,
  makeTransformNode,
  nodeSocketType,
  restoreGraph,
  restoreNodeForKind,
  sanitizeAddress,
  serializeGraph,
  socketNameOf,
  syncPortSocketType,
  toSocketType,
} from "../src/nodes2/graph-model";
import type { AreaExtra, CylNode, Schemes } from "../src/nodes2/graph-model";

/**
 * 端口类型系统（schema 4）：连线校验纯谓词 canConnectSockets 的完整兼容矩阵 +
 * 单端口 _input_/_output_ 形态（address/type）与旧 4 端口形态的兼容判定。
 * 纯逻辑（无 DOM、不驱动 rete 连线插件——插件侧只是把这个谓词接到
 * ClassicFlow 的 canMakeConnection 钩子上）。
 */

describe("canConnectSockets（连线类型校验谓词）", () => {
  it("同类型放行：geo→geo / float→float / vec3→vec3", () => {
    expect(canConnectSockets(GEO, GEO)).toBe(true);
    expect(canConnectSockets(FLOAT, FLOAT)).toBe(true);
    expect(canConnectSockets(VEC3, VEC3)).toBe(true);
  });

  it("完整矩阵：每一对不同类型都被拒绝", () => {
    const mismatched = SOCKET_TYPES.flatMap((from) =>
      SOCKET_TYPES.filter((to) => to !== from).map((to) => [from, to] as const),
    );
    expect(mismatched).toHaveLength(6); // 3 类型 × 2 错配
    for (const [from, to] of mismatched) {
      expect(canConnectSockets(from, to), `${from} -> ${to} 必须被拒绝`).toBe(false);
    }
  });

  it("未知 / 空 / 非法类型一律拒绝（含两端同为未知类型）", () => {
    expect(canConnectSockets("", "")).toBe(false);
    expect(canConnectSockets("banana", "banana")).toBe(false); // 相等但类型不合法
    expect(canConnectSockets(GEO, "")).toBe(false);
    expect(canConnectSockets("", GEO)).toBe(false);
    expect(canConnectSockets("Geo", GEO)).toBe(false); // 大小写敏感
  });
});

describe("toSocketType / nodeSocketType", () => {
  it("合法类型原样；非法 / 缺省 → geo（旧图无 type 参数时行为不变）", () => {
    expect(toSocketType(FLOAT)).toBe(FLOAT);
    expect(toSocketType(VEC3)).toBe(VEC3);
    expect(toSocketType("banana")).toBe(GEO);
    expect(toSocketType(undefined)).toBe(GEO);
    expect(toSocketType(42)).toBe(GEO);
    expect(toSocketType(null)).toBe(GEO);
  });

  it("单端口节点默认 type=geo；旧 4 端口节点无 type 参数 → geo", () => {
    expect(nodeSocketType(makeInputNode(true))).toBe(GEO);
    expect(nodeSocketType(makeInputNode())).toBe(GEO);
  });
});

describe("单端口 _input_ / _output_（schema 4 形态）", () => {
  it("singlePort=true → 1 端口 + address/type 参数", () => {
    const input = makeInputNode(true);
    expect(Object.keys(input.outputs)).toEqual(["in0"]);
    expect(input.params?.map((p) => p.name)).toEqual(["address", "type"]);
    expect(input.params?.find((p) => p.name === "address")?.value).toBe("");
    expect(input.params?.find((p) => p.name === "type")?.value).toBe(GEO);
    const output = makeOutputNode(true);
    expect(Object.keys(output.inputs)).toEqual(["out0"]);
    expect(output.params?.map((p) => p.name)).toEqual(["address", "type"]);
  });

  it("无参调用 → 旧 4 端口形态原样（承重墙：dataflow / chain-cache / e2e）", () => {
    expect(Object.keys(makeInputNode().outputs)).toEqual(["in0", "in1", "in2", "in3"]);
    expect(Object.keys(makeOutputNode().inputs)).toEqual(["out0", "out1", "out2", "out3"]);
    expect(makeInputNode().params).toBeUndefined();
    expect(makeOutputNode().params).toBeUndefined();
  });

  it("端口 socket 类型跟随 type 参数（syncPortSocketType）", () => {
    const input = makeInputNode(true);
    expect(input.outputs.in0?.socket.name).toBe(GEO);
    input.params = [
      { name: "address", type: "string", value: "point_1/tx" },
      { name: "type", type: "menu", value: FLOAT },
    ];
    expect(syncPortSocketType(input)).toBe(true);
    expect(input.outputs.in0?.socket.name).toBe(FLOAT);
    expect(syncPortSocketType(input)).toBe(false); // 类型未变 → 不重复换 socket
    const output = makeOutputNode(true);
    output.params = [{ name: "type", type: "menu", value: VEC3 }];
    expect(syncPortSocketType(output)).toBe(true);
    expect(output.inputs.out0?.socket.name).toBe(VEC3);
  });

  it("旧 4 端口节点不被 syncPortSocketType 触碰", () => {
    const legacy = makeInputNode();
    legacy.params = [{ name: "type", type: "menu", value: FLOAT }];
    expect(syncPortSocketType(legacy)).toBe(false);
    for (const key of ["in0", "in1", "in2", "in3"]) {
      expect(legacy.outputs[key]?.socket.name).toBe(GEO);
    }
  });

  it("非法 type 参数 → 回落 geo，不抛", () => {
    const input = makeInputNode(true);
    input.params = [{ name: "type", type: "menu", value: "banana" }];
    expect(syncPortSocketType(input)).toBe(false);
    expect(input.outputs.in0?.socket.name).toBe(GEO);
  });
});

describe("端口类型 × 连线校验（socketNameOf + canConnectSockets 联合）", () => {
  /** 建一张「单端口 _input_(type=A) -> 单端口 _output_(type=B)」的图，返回是否放行。 */
  async function allows(a: string, b: string): Promise<boolean> {
    const editor = new NodeEditor<Schemes>();
    const input = makeInputNode(true);
    const output = makeOutputNode(true);
    input.params = [{ name: "type", type: "menu", value: a }];
    output.params = [{ name: "type", type: "menu", value: b }];
    syncPortSocketType(input);
    syncPortSocketType(output);
    await editor.addNode(input);
    await editor.addNode(output);
    return canConnectSockets(
      socketNameOf(editor, input.id, "output", "in0"),
      socketNameOf(editor, output.id, "input", "out0"),
    );
  }

  it("同类型放行、错配拒绝（走真实节点的 socket 名）", async () => {
    for (const t of SOCKET_TYPES) expect(await allows(t, t), `${t} -> ${t}`).toBe(true);
    expect(await allows(GEO, FLOAT)).toBe(false);
    expect(await allows(GEO, VEC3)).toBe(false);
    expect(await allows(FLOAT, GEO)).toBe(false);
    expect(await allows(FLOAT, VEC3)).toBe(false);
    expect(await allows(VEC3, GEO)).toBe(false);
    expect(await allows(VEC3, FLOAT)).toBe(false);
  });

  it("socketNameOf：节点/端口不存在 → \"\"（连线被拒，不抛）", async () => {
    const editor = new NodeEditor<Schemes>();
    const input = makeInputNode(true);
    await editor.addNode(input);
    expect(socketNameOf(editor, input.id, "output", "in0")).toBe(GEO);
    expect(socketNameOf(editor, input.id, "output", "in3")).toBe(""); // 单端口无 in3
    expect(socketNameOf(editor, "nope", "output", "in0")).toBe("");
    expect(canConnectSockets(socketNameOf(editor, "nope", "output", "in0"), GEO)).toBe(false);
  });
});

describe("sanitizeAddress（防御式读入，风格同 sanitizeBindings）", () => {
  it("非空字符串通过；其余一律 undefined，绝不抛", () => {
    expect(sanitizeAddress("point_1/tx")).toBe("point_1/tx");
    expect(sanitizeAddress("")).toBeUndefined();
    expect(sanitizeAddress(undefined)).toBeUndefined();
    expect(sanitizeAddress(null)).toBeUndefined();
    expect(sanitizeAddress(42)).toBeUndefined();
    expect(sanitizeAddress(["a"])).toBeUndefined();
    expect(sanitizeAddress({ a: 1 })).toBeUndefined();
  });
});

describe("detectLegacyPorts（旧图形状兼容判定）", () => {
  it("v2 / v3 / 缺省 schemaVersion → 旧 4 端口形态", () => {
    expect(detectLegacyPorts({ schemaVersion: 2, nodes: [], connections: [] })).toBe(true);
    expect(detectLegacyPorts({ schemaVersion: 3, nodes: [], connections: [] })).toBe(true);
    expect(detectLegacyPorts({ nodes: [], connections: [] })).toBe(true);
  });

  it("schema 4 且无旧端口引用 → 单端口形态", () => {
    expect(
      detectLegacyPorts({
        schemaVersion: ADDRESS_GRAPH_SCHEMA,
        nodes: [
          { id: "in", kind: "input" },
          { id: "out", kind: "output" },
        ],
        connections: [{ source: "in", sourceOutput: "in0", target: "out", targetInput: "out0" }],
      }),
    ).toBe(false);
  });

  it("图里仍引用 in1..in3 / out1..out3 → 强制旧形态（绝不丢连接）", () => {
    const nodes = [
      { id: "in", kind: "input" as const },
      { id: "out", kind: "output" as const },
    ];
    expect(
      detectLegacyPorts({
        schemaVersion: ADDRESS_GRAPH_SCHEMA,
        nodes,
        connections: [{ source: "in", sourceOutput: "in2", target: "out", targetInput: "out0" }],
      }),
    ).toBe(true);
    expect(
      detectLegacyPorts({
        schemaVersion: ADDRESS_GRAPH_SCHEMA,
        nodes,
        connections: [{ source: "in", sourceOutput: "in0", target: "out", targetInput: "out3" }],
      }),
    ).toBe(true);
  });

  it("in1 出现在**非** _input_ 节点上时不误判（只看 input/output 节点的端口）", () => {
    expect(
      detectLegacyPorts({
        schemaVersion: ADDRESS_GRAPH_SCHEMA,
        nodes: [
          { id: "in", kind: "input" },
          { id: "t", kind: "transform" },
        ],
        // transform 的 sourceOutput 恰好叫 out1 也不算旧形态（它不是 _output_ 节点）
        connections: [{ source: "t", sourceOutput: "out1", target: "in", targetInput: "in1" }],
      }),
    ).toBe(false);
  });
});

describe("序列化兼容（v2 字节不变 / v4 稳定往返）", () => {
  /** 无 DOM 的 fake area（同 project-graph.test.ts 的写法）。 */
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

  /** 去掉 rete 每次重建都会新生成的 id（既有行为，与端口形态无关）。 */
  function nodesWithoutIds(snap: unknown): string {
    const nodes = (snap as { nodes: Array<Record<string, unknown>> }).nodes;
    return JSON.stringify(
      nodes.map((entry) => {
        const { id, ...rest } = entry;
        void id;
        return rest;
      }),
    );
  }

  it("全默认的单端口新图 → v2，且**不含** params / address 键（与旧图字节一致）", async () => {
    const editor = new NodeEditor<Schemes>();
    await editor.addNode(makeInputNode(true));
    await editor.addNode(makeOutputNode(true));
    const snap = serializeGraph(editor, fakeArea()) as {
      schemaVersion: number;
      nodes: Array<Record<string, unknown>>;
    };
    expect(snap.schemaVersion).toBe(2);
    for (const nd of snap.nodes) {
      expect(nd).not.toHaveProperty("params");
      expect(nd).not.toHaveProperty("address");
    }
  });

  it("填了 address / 非 geo type → v4，且往返回单端口形态（socket 类型保住）", async () => {
    const editor = new NodeEditor<Schemes>();
    const area = fakeArea();
    const input = makeInputNode(true);
    input.params = [
      { name: "address", type: "string", value: "point_1/tx", default: "" },
      { name: "type", type: "menu", value: FLOAT, default: GEO },
    ];
    input.address = "point_1/tx";
    syncPortSocketType(input);
    await editor.addNode(input);
    await editor.addNode(makeOutputNode(true));
    const snap = serializeGraph(editor, area) as { schemaVersion: number };
    expect(snap.schemaVersion).toBe(ADDRESS_GRAPH_SCHEMA);
    const editor2 = new NodeEditor<Schemes>();
    const area2 = fakeArea();
    await restoreGraph(editor2, area2, snap);
    const restored = (editor2.getNodes() as CylNode[]).find((x) => x.kind === "input") as CylNode;
    expect(Object.keys(restored.outputs)).toEqual(["in0"]);
    expect(restored.outputs.in0?.socket.name).toBe(FLOAT);
    expect(restored.address).toBe("point_1/tx");
    // 再序列化一次：节点载荷字节稳定（不会凭空长出 default 键）
    expect(nodesWithoutIds(serializeGraph(editor2, area2))).toBe(nodesWithoutIds(snap));
  });

  it("v2 旧图恢复 → 严格 4 端口形态，in2/out2 连线保住，无 params", async () => {
    const editor = new NodeEditor<Schemes>();
    await restoreGraph(editor, fakeArea(), {
      schemaVersion: 2,
      viewport: { k: 1, x: 0, y: 0 },
      nodes: [
        { id: "in1", kind: "input", label: "_input_", x: 0, y: 0 },
        { id: "o1", kind: "output", label: "_output_", x: 9, y: 0 },
      ],
      connections: [{ source: "in1", sourceOutput: "in2", target: "o1", targetInput: "out2" }],
    });
    const nodes = editor.getNodes() as CylNode[];
    const inp = nodes.find((x) => x.kind === "input") as CylNode;
    const outp = nodes.find((x) => x.kind === "output") as CylNode;
    expect(Object.keys(inp.outputs)).toEqual(["in0", "in1", "in2", "in3"]);
    expect(Object.keys(outp.inputs)).toEqual(["out0", "out1", "out2", "out3"]);
    expect(inp.params).toBeUndefined();
    expect(editor.getConnections().length).toBe(1); // 旧端口引用不丢
  });

  it("v2 往返（含 transform 参数）节点载荷字节不变", async () => {
    const editor = new NodeEditor<Schemes>();
    const area = fakeArea();
    await editor.addNode(makeInputNode());
    await editor.addNode(makeTransformNode());
    await editor.addNode(makeOutputNode());
    const first = serializeGraph(editor, area);
    const editor2 = new NodeEditor<Schemes>();
    const area2 = fakeArea();
    await restoreGraph(editor2, area2, JSON.parse(JSON.stringify(first)));
    expect(nodesWithoutIds(serializeGraph(editor2, area2))).toBe(nodesWithoutIds(first));
  });
});

describe("restoreNodeForKind × 端口形态", () => {
  it("默认（无第二参）→ 旧 4 端口，与改动前一致", () => {
    const input = restoreNodeForKind({ kind: "input" }) as CylNode;
    expect(Object.keys(input.outputs)).toEqual(["in0", "in1", "in2", "in3"]);
    const output = restoreNodeForKind({ kind: "output" }) as CylNode;
    expect(Object.keys(output.inputs)).toEqual(["out0", "out1", "out2", "out3"]);
  });

  it("legacyPorts=false → 单端口 + address/type，socket 类型按 params 落地", () => {
    const input = restoreNodeForKind(
      {
        kind: "input",
        params: [
          { name: "address", type: "string", value: "point_1/tx" },
          { name: "type", type: "menu", value: FLOAT },
        ],
      },
      false,
    ) as CylNode;
    expect(Object.keys(input.outputs)).toEqual(["in0"]);
    expect(input.outputs.in0?.socket.name).toBe(FLOAT);
    expect(input.address).toBe("point_1/tx");
    expect(input.params?.find((p) => p.name === "address")?.value).toBe("point_1/tx");
  });

  it("params 只剩非默认项时补全另一项（序列化剔除了默认值）", () => {
    const onlyType = restoreNodeForKind(
      { kind: "output", params: [{ name: "type", type: "menu", value: VEC3 }] },
      false,
    ) as CylNode;
    expect(onlyType.params?.map((p) => p.name)).toEqual(["address", "type"]);
    expect(onlyType.params?.find((p) => p.name === "address")?.value).toBe("");
    expect(onlyType.inputs.out0?.socket.name).toBe(VEC3);
    expect(onlyType.address).toBeUndefined(); // 空 address → 不带该键
  });

  it("address 顶层键也被读入（非法值忽略，不抛）", () => {
    const fromField = restoreNodeForKind({ kind: "input", address: "grp/a" }, false) as CylNode;
    expect(fromField.address).toBe("grp/a");
    expect(fromField.params?.find((p) => p.name === "address")?.value).toBe("grp/a");
    const bad = restoreNodeForKind({ kind: "input", address: { nope: 1 } }, false) as CylNode;
    expect(bad.address).toBeUndefined();
    expect(bad.params?.find((p) => p.name === "address")?.value).toBe("");
  });
});
