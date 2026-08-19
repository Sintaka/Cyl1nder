import { describe, expect, it } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import {
  ANY,
  FLOAT,
  GEO,
  VEC3,
  applyDerivedPortType,
  applyDynamicTypes,
  canConnectIntoSlot,
  canConnectSockets,
  derivePortType,
  slotTypeOf,
  slotTypesConsistent,
  socketNameOf,
  dynamicInputIndex,
  dynamicInputKey,
  dynamicOutputIndex,
  dynamicOutputKey,
  planDynamicOutputs,
  planDynamicSlotCount,
  resolveSlotTypes,
  findPortTypeConflicts,
  hasDynamicInputs,
  isConnectableSocket,
  isDerivedParam,
  makeInputNode,
  makeNullNode,
  makeOutputNode,
  makeTransformNode,
  planDynamicInputs,
  portTypeConflictsToNodeErrors,
  propagateDynamicTypes,
  restoreGraph,
  serializeGraph,
  socketFamily,
  socketTypeClass,
  syncDynamicInputs,
  syncPortSocketType,
} from "../src/nodes2/graph-model";
import type { AreaExtra, CylNode, Schemes } from "../src/nodes2/graph-model";

/**
 * 动态输入端口 + 类型自动推导（v0.1.00121）。
 *
 * 两条用户要求在这里被钉住：
 *   #2 「in/out 的 type 应该直接根据所选端口的类型生成，不用用户再手动指定一遍」
 *      → derivePortType / applyDerivedPortType / isDerivedParam
 *   动态端口「接满了长一个、拆掉收回去，永远留一个空位」
 *      → planDynamicInputs / syncDynamicInputs / propagateDynamicTypes
 *
 * 纯数据层（无 DOM）：area 用内存 fake，连线插件不参与——类型校验测的是
 * canConnectSockets 这个谓词本身（插件只是把它接到 canMakeConnection 上）。
 */

/** 无 DOM 的 fake area（同 project-graph.test.ts 的那一份）。 */
function fakeArea(): AreaPlugin<Schemes, AreaExtra> {
  const positions = new Map<string, { x: number; y: number }>();
  const area = {
    nodeViews: {
      get: (id: string): { position: { x: number; y: number } } | undefined =>
        positions.has(id) ? { position: positions.get(id) as { x: number; y: number } } : undefined,
    },
    translate: async (id: string, pos: { x: number; y: number }) => {
      positions.set(id, pos);
    },
    area: { transform: { k: 1, x: 0, y: 0 }, zoom: async () => undefined, translate: async () => undefined },
  };
  return area as unknown as AreaPlugin<Schemes, AreaExtra>;
}

/** rete addConnection 的泛型连接（同 graph.ts 的 cast 模式）。 */
function conn(a: CylNode, ao: string, b: CylNode, bi: string): Schemes["Connection"] {
  return new ClassicPreset.Connection(a, ao, b, bi) as unknown as Schemes["Connection"];
}

const inKeys = (n: CylNode): string[] => Object.keys(n.inputs);
const socketOf = (n: CylNode, key: string): string | undefined => n.inputs[key]?.socket.name;

describe("ANY（类型待定哨兵）", () => {
  it("ANY 与任何合法类型互通（含自身）——动态端口的推导起点", () => {
    for (const t of [GEO, FLOAT, VEC3, ANY]) {
      expect(canConnectSockets(ANY, t), `any -> ${t}`).toBe(true);
      expect(canConnectSockets(t, ANY), `${t} -> any`).toBe(true);
    }
  });

  it("ANY 不放行非法类型（空串 / 拼错的类型仍被拒）", () => {
    expect(canConnectSockets(ANY, "")).toBe(false);
    expect(canConnectSockets("banana", ANY)).toBe(false);
    expect(isConnectableSocket(ANY)).toBe(true);
    expect(isConnectableSocket("")).toBe(false);
    expect(isConnectableSocket(undefined)).toBe(false);
  });

  it("ANY 着色不出类 = 中性灰白（与「未知类型灰白 / geo 朱红」一致）", () => {
    expect(socketTypeClass(ANY)).toBe("");
    expect(socketTypeClass(GEO)).toBe("cyl-port-geo");
  });

  it("socketFamily：geo 一族、float/vec3 同族、ANY 无族", () => {
    expect(socketFamily(GEO)).toBe("geo");
    expect(socketFamily(FLOAT)).toBe("num");
    expect(socketFamily(VEC3)).toBe("num");
    expect(socketFamily(ANY)).toBe(null);
    expect(socketFamily("banana")).toBe(null);
  });
});

describe("planDynamicInputs（grow/shrink 规则单源）", () => {
  it("一根线都没接 → 只有 in0（永远留一个空位）", () => {
    expect(planDynamicInputs([])).toEqual(["in0"]);
  });

  it("接了 in0 → in0/in1（最后一个已接之后正好一个空位）", () => {
    expect(planDynamicInputs(["in0"])).toEqual(["in0", "in1"]);
  });

  it("接了 in0..in2 → 4 个（3 已接 + 1 spare）", () => {
    expect(planDynamicInputs(["in0", "in1", "in2"])).toEqual(["in0", "in1", "in2", "in3"]);
  });

  it("**中间空洞必须保留**：只接了 in2 → in0..in3（删 in1 会迫使 in2 改名而断线）", () => {
    expect(planDynamicInputs(["in2"])).toEqual(["in0", "in1", "in2", "in3"]);
  });

  it("顺序无关 + 重复无害（同一 key 多次出现按一次算）", () => {
    expect(planDynamicInputs(["in2", "in0", "in2"])).toEqual(planDynamicInputs(["in0", "in2"]));
  });

  it("非 in\\d+ 的 key 一律忽略（out0 / inx / 空串不参与计数）", () => {
    expect(planDynamicInputs(["out0", "inx", "", "in-1"])).toEqual(["in0"]);
  });

  it("dynamicInputKey / dynamicInputIndex 互逆；非该形状 → null", () => {
    expect(dynamicInputKey(3)).toBe("in3");
    expect(dynamicInputIndex("in3")).toBe(3);
    expect(dynamicInputIndex("out0")).toBe(null);
    expect(dynamicInputIndex("inx")).toBe(null);
  });
});

describe("hasDynamicInputs / 新建 null 的起手形状", () => {
  it("只有 null 是动态节点（transform/geo/_input_/_output_ 端口固定）", () => {
    expect(hasDynamicInputs("null")).toBe(true);
    expect(hasDynamicInputs("transform")).toBe(false);
    expect(hasDynamicInputs("geo")).toBe(false);
    expect(hasDynamicInputs("input")).toBe(false);
    expect(hasDynamicInputs("output")).toBe(false);
  });

  it("新建 null：1 in / 1 out，两端**类型待定**（ANY，不是 geo）", () => {
    const n = makeNullNode();
    expect(inKeys(n)).toEqual(["in0"]);
    expect(Object.keys(n.outputs)).toEqual(["out0"]);
    expect(socketOf(n, "in0")).toBe(ANY);
    expect(n.outputs.out0?.socket.name).toBe(ANY);
  });

  it("非动态 kind 调 syncDynamicInputs → false，端口一个都不动", () => {
    const t = makeTransformNode();
    expect(syncDynamicInputs(t, ["in0", "in1"])).toBe(false);
    expect(inKeys(t)).toEqual(["in0"]);
    const legacy = makeOutputNode(); // 旧 4 端口形态
    expect(syncDynamicInputs(legacy, ["out0"])).toBe(false);
    expect(inKeys(legacy)).toEqual(["out0", "out1", "out2", "out3"]);
  });
});

describe("syncDynamicInputs（长出来 / 收回去）", () => {
  it("接满就长一个：in0 接上 → in0/in1", () => {
    const n = makeNullNode();
    expect(syncDynamicInputs(n, ["in0"])).toBe(true);
    expect(inKeys(n)).toEqual(["in0", "in1"]);
  });

  it("拆掉就收回去，但**永远留一个**空位", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0", "in1", "in2"]);
    expect(inKeys(n)).toEqual(["in0", "in1", "in2", "in3"]);
    expect(syncDynamicInputs(n, ["in0"])).toBe(true);
    expect(inKeys(n)).toEqual(["in0", "in1"]);
    expect(syncDynamicInputs(n, [])).toBe(true);
    expect(inKeys(n)).toEqual(["in0"]); // 空图也留一个可接的口
  });

  it("已到位 → false（幂等，不做无谓的端口重建）", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0"]);
    expect(syncDynamicInputs(n, ["in0"])).toBe(false);
  });

  it("新端口一律 ANY（待定）：没接线的槽**不许**被预先定型", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0"]);
    expect(socketOf(n, "in1")).toBe(ANY); // 新长出来的 spare 留在待定
    expect(socketOf(n, "in0")).toBe(ANY); // 既有的原样（类型是 applyDynamicTypes 的职责）
  });

  it("**输出侧逐槽成对长出来**：in{k} 有几个，out{k} 就有几个（槽 0 恒 out0）", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0", "in1"]);
    expect(inKeys(n)).toEqual(["in0", "in1", "in2"]);
    expect(Object.keys(n.outputs)).toEqual(["out0", "out1", "out2"]);
  });

  it("下游还接着的 out{k} **不会被回收**（端口 key 就是连接身份）", () => {
    const n = makeNullNode();
    // 上游一根线都没接，但下游接走了 out2 → 槽数被输出侧撑到 4
    syncDynamicInputs(n, [], ["out2"]);
    expect(Object.keys(n.outputs)).toEqual(["out0", "out1", "out2", "out3"]);
    expect(inKeys(n)).toEqual(["in0", "in1", "in2", "in3"]); // 两侧成对，不许瘸腿
  });

  it("planDynamicSlotCount / planDynamicOutputs：两侧取 max 后 +1 个 spare", () => {
    expect(planDynamicSlotCount([], [])).toBe(1);
    expect(planDynamicSlotCount(["in0"], [])).toBe(2);
    expect(planDynamicSlotCount([], ["out3"])).toBe(5); // 输出侧也参与计数
    expect(planDynamicSlotCount(["in1"], ["out0"])).toBe(3); // 取两侧最大
    expect(planDynamicOutputs(["in0"])).toEqual(["out0", "out1"]);
    expect(planDynamicOutputs([], ["out1"])).toEqual(["out0", "out1", "out2"]);
  });

  it("dynamicOutputKey / dynamicOutputIndex 互逆；非该形状 → null", () => {
    expect(dynamicOutputKey(0)).toBe("out0"); // 槽 0 逐字仍是 out0（冻结契约）
    expect(dynamicOutputKey(2)).toBe("out2");
    expect(dynamicOutputIndex("out2")).toBe(2);
    expect(dynamicOutputIndex("in0")).toBe(null);
    expect(dynamicOutputIndex("outx")).toBe(null);
  });
});

/** 建一个「单端口 _input_（指定类型）→ null」的小图，返回两个节点。 */
async function wireInto(
  editor: NodeEditor<Schemes>,
  type: string,
  target: CylNode,
  key: string,
): Promise<CylNode> {
  const src = makeInputNode(true);
  const tp = src.params?.find((p) => p.name === "type");
  if (tp) tp.value = type;
  // 换 socket 走 syncPortSocketType（rete 把 outputs 对象冻住了，不能直接赋值）
  syncPortSocketType(src);
  await editor.addNode(src);
  await editor.addConnection(conn(src, "in0", target, key));
  return src;
}

describe("propagateDynamicTypes（类型从上游流下来）", () => {
  it("喂 float 进 in0 → 槽 0 变 float（in0 + out0），**spare 留在 ANY**", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    await wireInto(editor, FLOAT, nul, "in0");
    propagateDynamicTypes(editor);
    expect(socketOf(nul, "in0")).toBe(FLOAT);
    expect(nul.outputs.out0?.socket.name).toBe(FLOAT); // 同槽输出跟随 → 下游继续推导
    expect(inKeys(nul)).toEqual(["in0", "in1"]); // 接满长一个
    // **槽 1 不被槽 0 定型**（v0.1.00125 的核心）：这就是用户要的"连了 float 之后
    // 还能连 geo 进同一个 null"。改造前这里是 FLOAT，于是 geo 永远接不进来。
    expect(socketOf(nul, "in1")).toBe(ANY);
    expect(nul.outputs.out1?.socket.name).toBe(ANY);
  });

  it("**用户的原案**：geo 进槽 0、float 进槽 1，同一个 null，两者互不干扰", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    await wireInto(editor, GEO, nul, "in0");
    propagateDynamicTypes(editor); // 长出 in1/out1
    await wireInto(editor, FLOAT, nul, "in1");
    propagateDynamicTypes(editor);
    expect(slotTypeOf(nul, 0)).toBe(GEO);
    expect(slotTypeOf(nul, 1)).toBe(FLOAT);
    expect(socketOf(nul, "in0")).toBe(GEO);
    expect(socketOf(nul, "in1")).toBe(FLOAT);
    expect(nul.outputs.out0?.socket.name).toBe(GEO); // 槽 0 的输出是几何
    expect(nul.outputs.out1?.socket.name).toBe(FLOAT); // 槽 1 的输出是浮点
    expect(slotTypesConsistent(nul)).toBe(true); // 镜像逐槽无漂移
    expect(findPortTypeConflicts(editor)).toEqual([]); // 这**不是**冲突
  });

  it("**同一个槽内仍然严格**：槽 0 已是 geo → float 接不进 in0，但可接空的 in1", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    await wireInto(editor, GEO, nul, "in0");
    propagateDynamicTypes(editor);
    // 用户：「null 的几何体端口应该拒绝浮点输入」——读的是**那个槽**的类型。
    expect(canConnectIntoSlot(FLOAT, socketNameOf(editor, nul.id, "input", "in0"))).toBe(false);
    expect(canConnectIntoSlot(VEC3, socketNameOf(editor, nul.id, "input", "in0"))).toBe(false);
    // 而另一个（还空着的）槽照旧待定 → 数值可以进去。
    expect(canConnectIntoSlot(FLOAT, socketNameOf(editor, nul.id, "input", "in1"))).toBe(true);
  });

  it("类型沿链传递（float → null1 → null2，迭代到不动点）", async () => {
    const editor = new NodeEditor<Schemes>();
    const n1 = makeNullNode();
    const n2 = makeNullNode();
    await editor.addNode(n1);
    await editor.addNode(n2);
    await editor.addConnection(conn(n1, "out0", n2, "in0"));
    await wireInto(editor, VEC3, n1, "in0");
    propagateDynamicTypes(editor);
    expect(n1.outputs.out0?.socket.name).toBe(VEC3);
    expect(socketOf(n2, "in0")).toBe(VEC3); // 隔一层也推到了
    expect(n2.outputs.out0?.socket.name).toBe(VEC3);
  });

  it("拆掉唯一的线 → 回到全 ANY（待定），端口收回一个", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    await wireInto(editor, FLOAT, nul, "in0");
    propagateDynamicTypes(editor);
    for (const c of editor.getConnections()) await editor.removeConnection(c.id);
    propagateDynamicTypes(editor);
    expect(inKeys(nul)).toEqual(["in0"]);
    expect(Object.keys(nul.outputs)).toEqual(["out0"]); // 输出侧一并收回
    expect(socketOf(nul, "in0")).toBe(ANY);
    expect(nul.outputs.out0?.socket.name).toBe(ANY);
  });

  it("resolveSlotTypes：**逐槽**给类型，与连线创建顺序无关", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    syncDynamicInputs(nul, ["in0", "in1"]); // 先把端口备好，才能往 in1 接
    await wireInto(editor, VEC3, nul, "in1"); // 后建的先接进 in1
    await wireInto(editor, FLOAT, nul, "in0");
    const conns = editor.getConnections();
    const types = resolveSlotTypes(nul, conns, (id: string, key: string) => {
      const src = editor.getNode(id) as CylNode | undefined;
      return src?.outputs[key]?.socket.name ?? "";
    });
    // 槽 0 拿槽 0 的线、槽 1 拿槽 1 的线——**绝不跨槽借类型**
    expect(types[0]).toBe(FLOAT);
    expect(types[1]).toBe(VEC3);
  });

  it("图里没有动态节点 → 空集合（零开销，不碰任何端口）", async () => {
    const editor = new NodeEditor<Schemes>();
    await editor.addNode(makeTransformNode());
    expect(propagateDynamicTypes(editor).size).toBe(0);
  });
});

describe("findPortTypeConflicts（绕过校验的那两条路：只报不删）", () => {
  it("**不同槽的跨族类型不再是冲突**：geo 进 in0、float 进 in1 完全合法", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    syncDynamicInputs(nul, ["in0", "in1"]);
    await wireInto(editor, GEO, nul, "in0");
    await wireInto(editor, FLOAT, nul, "in1");
    // v0.1.00125 起这是用户明确要的形态（N 条独立通道），不是错误。
    expect(findPortTypeConflicts(editor)).toEqual([]);
    expect(editor.getConnections()).toHaveLength(2);
  });

  it("**同一个槽**被跨族多源喂 → 仍然报错，且**线不被删**", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    // 直接 addConnection = 恢复旧图 / undo 重放那条路（绕过连线插件的类型校验）：
    // 两根线都落在 in0 上（非法拓扑），类型还跨族 → 冲突归属那**一个**槽。
    await wireInto(editor, GEO, nul, "in0");
    await wireInto(editor, FLOAT, nul, "in0");
    const conflicts = findPortTypeConflicts(editor);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].port).toBe("in0");
    expect(conflicts[0].message).toContain("slot 0");
    expect(editor.getConnections()).toHaveLength(2); // **一根都没被删**
  });

  it("同族（float + vec3）不算冲突——隐式转换是既有语义", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    syncDynamicInputs(nul, ["in0", "in1"]);
    await wireInto(editor, FLOAT, nul, "in0");
    await wireInto(editor, VEC3, nul, "in1");
    expect(findPortTypeConflicts(editor)).toEqual([]);
  });

  it("全待定 / 只有一根线 → 无冲突", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    expect(findPortTypeConflicts(editor)).toEqual([]);
    await wireInto(editor, GEO, nul, "in0");
    expect(findPortTypeConflicts(editor)).toEqual([]);
  });

  it("转 NodeErrorMap：severity=error、归属出错的那个端口、带 source 标签", () => {
    const map = portTypeConflictsToNodeErrors([
      { nodeId: "n1", nodeType: GEO, port: "in1", incomingType: FLOAT, message: "boom" },
    ]);
    expect(map.n1).toHaveLength(1);
    expect(map.n1[0]).toEqual({
      severity: "error",
      message: "boom",
      port: "in1",
      source: "port-type-conflict",
    });
  });

  it("非法条目被忽略（无 nodeId / 无 message），绝不抛", () => {
    const map = portTypeConflictsToNodeErrors([
      { nodeId: "", nodeType: GEO, port: "in0", incomingType: FLOAT, message: "x" },
      { nodeId: "n1", nodeType: GEO, port: "in0", incomingType: FLOAT, message: "" },
    ]);
    expect(map).toEqual({});
  });
});

describe("restoreGraph 与动态端口", () => {
  it("3 根已接输入的 null 恢复后**正好 4 个端口**，线落在原 key 上", async () => {
    const editor = new NodeEditor<Schemes>();
    const area = fakeArea();
    await restoreGraph(editor, area, {
      schemaVersion: 2,
      nodes: [
        { id: "a", kind: "input", label: "_input_", x: 0, y: 0 },
        { id: "b", kind: "input", label: "_input_2", x: 0, y: 40 },
        { id: "c", kind: "input", label: "_input_3", x: 0, y: 80 },
        { id: "n", kind: "null", label: "null1", x: 200, y: 0 },
      ],
      connections: [
        { source: "a", sourceOutput: "in0", target: "n", targetInput: "in0" },
        { source: "b", sourceOutput: "in0", target: "n", targetInput: "in1" },
        { source: "c", sourceOutput: "in0", target: "n", targetInput: "in2" },
      ],
    });
    const nul = (editor.getNodes() as CylNode[]).find((n) => n.kind === "null") as CylNode;
    expect(inKeys(nul)).toEqual(["in0", "in1", "in2", "in3"]); // 3 已接 + 1 spare
    const landed = editor.getConnections().filter((c) => c.target === nul.id).map((c) => c.targetInput).sort();
    expect(landed).toEqual(["in0", "in1", "in2"]); // 逐字落在原 key 上
    expect(editor.getConnections()).toHaveLength(3); // 一根都没丢
  });

  it("端口在加连接**之前**就被预建（否则线会指向不存在的 key）", async () => {
    const editor = new NodeEditor<Schemes>();
    await restoreGraph(editor, fakeArea(), {
      schemaVersion: 2,
      nodes: [
        { id: "a", kind: "input", label: "_input_", x: 0, y: 0 },
        { id: "n", kind: "null", label: "null1", x: 200, y: 0 },
      ],
      // 只接 in2（中间留洞）：in0/in1 必须一并存在，否则这根线无处可落
      connections: [{ source: "a", sourceOutput: "in0", target: "n", targetInput: "in2" }],
    });
    const nul = (editor.getNodes() as CylNode[]).find((n) => n.kind === "null") as CylNode;
    expect(inKeys(nul)).toEqual(["in0", "in1", "in2", "in3"]);
    expect(editor.getConnections()[0]?.targetInput).toBe("in2");
  });

  it("v2 旧图（null 只接 in0）：往返**字节不变**、拓扑不变、类型被推回 geo", async () => {
    const editor = new NodeEditor<Schemes>();
    const area = fakeArea();
    const saved = {
      schemaVersion: 2,
      viewport: { k: 1, x: 0, y: 0 },
      nodes: [
        { id: "a", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 0, y: 0 },
        { id: "n", kind: "null", label: "null1", baseLabel: "null", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 200, y: 0 },
      ],
      connections: [{ source: "a", sourceOutput: "in0", target: "n", targetInput: "in0" }],
    };
    await restoreGraph(editor, area, saved);
    const nul = (editor.getNodes() as CylNode[]).find((n) => n.kind === "null") as CylNode;
    // 接着 geo 线 → 推回 GEO：端口颜色与改造前一致（朱红），不是灰白
    expect(socketOf(nul, "in0")).toBe(GEO);
    expect(nul.outputs.out0?.socket.name).toBe(GEO);
    // 拓扑不变；**唯一的外观差异是多出的那个 spare 空端口**（in1），这正是本次特性
    expect(editor.getConnections()).toHaveLength(1);
    expect(inKeys(nul)).toEqual(["in0", "in1"]);
    // 往返稳定：端口不进快照，所以那个 spare 不会写进存档。
    // 只比**端口 key**（不比节点 id）：restoreGraph 一律发新 id，id 相等从来不是
    // 往返契约的一部分；"线还落在同一个端口上"才是。
    const round = serializeGraph(editor, area) as {
      schemaVersion: number;
      connections: Array<{ sourceOutput: string; targetInput: string }>;
      nodes: Array<{ params?: unknown }>;
    };
    expect(round.schemaVersion).toBe(2); // 仍是 v2，没被悄悄升版
    expect(round.connections.map((c) => [c.sourceOutput, c.targetInput])).toEqual([["in0", "in0"]]);
    // v2 兼容承重墙：null 节点仍然不带 params 键（动态端口没有引入任何新参数）
    expect(round.nodes.every((n) => n.params === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 用户要求 #2：`type` 由所选端口**自动派生**，用户不再手填
// ---------------------------------------------------------------------------

/** 造一个填好 address/port 的单端口 _input_（或 _output_）。 */
function ioNode(kind: "input" | "output", address: string, port: string): CylNode {
  const n = kind === "input" ? makeInputNode(true) : makeOutputNode(true);
  const set = (name: string, v: string): void => {
    const p = n.params?.find((x) => x.name === name);
    if (p) p.value = v;
  };
  set("address", address);
  set("port", port);
  return n;
}

describe("derivePortType（类型来自 capabilities，不来自用户）", () => {
  const SER = "S1-abcd-0001";

  it("选了端口 → 取该端口在 capabilities 里的类型（用户在下拉里看见的那一个）", () => {
    const n = ioNode("input", SER, "transform1/tx");
    const got = derivePortType(n, {
      portType: (s, side, key) => (s === SER && side === "inputs" && key === "transform1/tx" ? FLOAT : null),
      addressType: () => null,
    });
    expect(got).toBe(FLOAT);
  });

  it("_output_ 查的是 outputs 侧（读/写两侧不可混）", () => {
    const n = ioNode("output", SER, "out1");
    const sides: string[] = [];
    derivePortType(n, {
      portType: (_s, side) => {
        sides.push(side);
        return null;
      },
      addressType: () => null,
    });
    expect(sides).toEqual(["outputs"]);
  });

  it("端口还没选 → 回退到地址的映射表类型", () => {
    const n = ioNode("input", SER, "");
    expect(derivePortType(n, { portType: () => FLOAT, addressType: () => VEC3 })).toBe(VEC3);
  });

  it("**两级都答不出 → null（还不知道）**，绝不回落 geo", () => {
    const n = ioNode("input", SER, "out0");
    expect(derivePortType(n, { portType: () => null, addressType: () => null })).toBe(null);
  });

  it("地址为空 → null（没填地址不猜类型）", () => {
    const n = ioNode("input", "", "out0");
    expect(derivePortType(n, { portType: () => FLOAT, addressType: () => FLOAT })).toBe(null);
  });

  it("非法类型（桥返回脏值）→ 不采信，继续回退", () => {
    const n = ioNode("input", SER, "out0");
    expect(derivePortType(n, { portType: () => "banana", addressType: () => VEC3 })).toBe(VEC3);
    expect(derivePortType(n, { portType: () => "banana", addressType: () => "melon" })).toBe(null);
  });

  it("非 _input_/_output_ 的 kind → null（它们没有端口地址可解析）", () => {
    expect(derivePortType(makeNullNode(), { portType: () => FLOAT, addressType: () => FLOAT })).toBe(null);
    expect(derivePortType(makeTransformNode(), { portType: () => FLOAT, addressType: () => FLOAT })).toBe(null);
  });
});

describe("applyDerivedPortType / isDerivedParam（type 对用户只读）", () => {
  it("派生值被写回 type 参数并可被 socket 同步读到", () => {
    const n = ioNode("input", "S1-abcd-0001", "tx");
    expect(applyDerivedPortType(n, FLOAT)).toBe(true);
    expect(n.params?.find((p) => p.name === "type")?.value).toBe(FLOAT);
    syncPortSocketType(n);
    expect(n.outputs.in0?.socket.name).toBe(FLOAT);
  });

  it("null（还不知道）→ **什么都不做**，保持当前类型", () => {
    const n = ioNode("input", "S1-abcd-0001", "tx");
    applyDerivedPortType(n, VEC3);
    expect(applyDerivedPortType(n, null)).toBe(false);
    expect(n.params?.find((p) => p.name === "type")?.value).toBe(VEC3); // 没被抹回 geo
  });

  it("值未变 → false（幂等，不触发无谓重渲染）", () => {
    const n = ioNode("input", "S1-abcd-0001", "tx");
    applyDerivedPortType(n, FLOAT);
    expect(applyDerivedPortType(n, FLOAT)).toBe(false);
  });

  it("isDerivedParam：只有 _input_/_output_ 的 type 是只读派生参数", () => {
    expect(isDerivedParam("input", "type")).toBe(true);
    expect(isDerivedParam("output", "type")).toBe(true);
    expect(isDerivedParam("input", "address")).toBe(false);
    expect(isDerivedParam("input", "port")).toBe(false);
    // 判据带 kind：不让「叫 type 的参数一律只读」这种过宽规则溜进来
    expect(isDerivedParam("transform", "type")).toBe(false);
    expect(isDerivedParam("null", "type")).toBe(false);
  });

  it("`type` 仍是一个**可写字段**（对机器）：序列化剔除默认值那条路依赖它有值", () => {
    const n = ioNode("input", "S1-abcd-0001", "tx");
    const tp = n.params?.find((p) => p.name === "type");
    expect(tp).toBeDefined();
    expect(tp?.value).toBe(GEO); // 默认 geo → isDefaultAddressParam 会把它剔掉
  });
});

// ---------------------------------------------------------------------------
// 用户要求：「null 的几何体端口应该拒绝浮点输入, 毕竟几何体数据不是浮点」
// ---------------------------------------------------------------------------

describe("canConnectIntoSlot（几何 vs 数值：跨族永不互通）", () => {
  it("geo 槽拒绝 float 与 vec3", () => {
    expect(canConnectIntoSlot(FLOAT, GEO)).toBe(false);
    expect(canConnectIntoSlot(VEC3, GEO)).toBe(false);
    expect(canConnectIntoSlot(GEO, GEO)).toBe(true);
  });

  it("数值槽拒绝 geo；float ↔ vec3 同族放行（隐式转换是既有语义）", () => {
    expect(canConnectIntoSlot(GEO, FLOAT)).toBe(false);
    expect(canConnectIntoSlot(GEO, VEC3)).toBe(false);
    expect(canConnectIntoSlot(FLOAT, VEC3)).toBe(true);
    expect(canConnectIntoSlot(VEC3, FLOAT)).toBe(true);
  });

  it("待定槽放行（由第一根线定型）；非法/未知类型一律拒", () => {
    expect(canConnectIntoSlot(GEO, ANY)).toBe(true);
    expect(canConnectIntoSlot(ANY, GEO)).toBe(true);
    expect(canConnectIntoSlot("banana", GEO)).toBe(false);
    expect(canConnectIntoSlot(GEO, "")).toBe(false);
  });
});

describe("canConnectIntoSlot 与 canConnectSockets 不得漂移", () => {
  it("全类型矩阵上两者答案逐一相同（连线插件走后者，槽模型走前者）", () => {
    // graph.ts 的 ClassicFlow 用的是 canConnectSockets；本文件的槽校验用 canConnectIntoSlot。
    // 两条路必须给同一个答案，否则"拖不动的线"与"报冲突的线"会是两批不同的线。
    const all = [GEO, FLOAT, VEC3, ANY, "banana", ""];
    for (const from of all) {
      for (const to of all) {
        expect(canConnectIntoSlot(from, to), `${from || "<empty>"} -> ${to || "<empty>"}`).toBe(
          canConnectSockets(from, to),
        );
      }
    }
  });
});

describe("类型单源：socketNameOf 读所属槽，不读 socket 镜像", () => {
  it("**同一个槽**的 in/out 从校验通路读到同一个值；别的槽各读各的", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    await wireInto(editor, FLOAT, nul, "in0");
    propagateDynamicTypes(editor);
    expect(socketNameOf(editor, nul.id, "input", "in0")).toBe(FLOAT);
    expect(socketNameOf(editor, nul.id, "output", "out0")).toBe(FLOAT); // 同一个槽
    // spare（槽 1）**不跟随**槽 0：它还没接线，就该是待定。
    expect(socketNameOf(editor, nul.id, "input", "in1")).toBe(ANY);
    expect(socketNameOf(editor, nul.id, "output", "out1")).toBe(ANY);
  });

  it("key → 槽的解析：`in2`/`out2` 都归到槽 2，读到槽 2 自己的类型", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    syncDynamicInputs(nul, ["in0", "in2"]); // 中间留洞：in1 空着
    await wireInto(editor, GEO, nul, "in0");
    await wireInto(editor, VEC3, nul, "in2");
    propagateDynamicTypes(editor);
    expect(socketNameOf(editor, nul.id, "input", "in2")).toBe(VEC3);
    expect(socketNameOf(editor, nul.id, "output", "out2")).toBe(VEC3);
    expect(socketNameOf(editor, nul.id, "input", "in1")).toBe(ANY); // 空洞仍待定
    expect(socketNameOf(editor, nul.id, "output", "out0")).toBe(GEO);
  });

  it("端口不存在仍返回 \"\"（不可回落到槽类型，否则连不存在的端口都能连）", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    expect(socketNameOf(editor, nul.id, "input", "in9")).toBe("");
    expect(socketNameOf(editor, nul.id, "output", "out1")).toBe(""); // 起手只有 out0
  });

  it("镜像漂移时校验仍读单源（socket 被外力改坏也不放行错配的线）", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    applyDynamicTypes(nul, [GEO]);
    expect(slotTypesConsistent(nul)).toBe(true);
    // 人为把一个 socket 镜像改成 float（模拟漂移）
    nul.inputs.in0!.socket = new ClassicPreset.Socket(FLOAT);
    expect(slotTypesConsistent(nul)).toBe(false); // 不变式抓到了
    expect(socketNameOf(editor, nul.id, "input", "in0")).toBe(GEO); // 校验仍认槽
    expect(canConnectIntoSlot(FLOAT, socketNameOf(editor, nul.id, "input", "in0"))).toBe(false);
  });

  it("applyDynamicTypes 同时写单源与镜像（非动态 kind 一个字节都不动）", () => {
    const nul = makeNullNode();
    expect(applyDynamicTypes(nul, [VEC3])).toBe(true);
    expect(slotTypeOf(nul, 0)).toBe(VEC3);
    expect(slotTypesConsistent(nul)).toBe(true);
    expect(applyDynamicTypes(nul, [VEC3])).toBe(false); // 幂等
    const t = makeTransformNode();
    expect(applyDynamicTypes(t, [FLOAT])).toBe(false);
    expect(t.inputs.in0?.socket.name).toBe(GEO);
  });

  it("applyDynamicTypes：数组里没有的槽落 ANY（不许替下一根线预先决定）", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0"]);
    expect(applyDynamicTypes(n, [FLOAT])).toBe(true); // 只给槽 0
    expect(slotTypeOf(n, 0)).toBe(FLOAT);
    expect(slotTypeOf(n, 1)).toBe(ANY); // 槽 1 没给 → 待定
    expect(slotTypesConsistent(n)).toBe(true);
  });

  it("脏值（非法类型）落 ANY 而不是被采信", () => {
    const n = makeNullNode();
    applyDynamicTypes(n, ["banana"]);
    expect(slotTypeOf(n, 0)).toBe(ANY);
  });
});
