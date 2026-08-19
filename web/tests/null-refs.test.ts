import { describe, expect, it } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import {
  ANY,
  FLOAT,
  GEO,
  VEC3,
  buildGraphSnapshot,
  canConnectIntoSlot,
  legacyRefParamName,
  makeInputNode,
  makeNullNode,
  nodeSlots,
  propagateDynamicTypes,
  slotIndexOfPort,
  slotPortViews,
  slotRefParamName,
  slotRefScope,
  slotTypeOf,
  slotTypesConsistent,
  syncDynamicInputs,
  syncPortSocketType,
  syncRefParams,
} from "../src/nodes2/graph-model";
import type { CylNode, Schemes } from "../src/nodes2/graph-model";

/**
 * 端口槽模型（v0.1.00122）——用户批评的两半：
 *
 *  1. 「in 和 out 应该是同一个对象」→ 一个槽一个类型、一个引用参数；in/out 只是视图。
 *  2. 「更不应该把那个 in 端的灵活端口看作一个可修改参数(还没接东西呢没数据进来)」
 *     → 引用参数**只属于已接线的槽**，spare 永远没有参数。
 */

/** rete addConnection 的泛型连接（同 graph.ts 的 cast 模式）。 */
function conn(a: CylNode, ao: string, b: CylNode, bi: string): Schemes["Connection"] {
  return new ClassicPreset.Connection(a, ao, b, bi) as unknown as Schemes["Connection"];
}

/** 接一根「单端口 _input_（指定类型）→ target.key」的线。 */
async function wireInto(
  editor: NodeEditor<Schemes>,
  type: string,
  target: CylNode,
  key: string,
): Promise<CylNode> {
  const src = makeInputNode(true);
  const tp = src.params?.find((p) => p.name === "type");
  if (tp) tp.value = type;
  syncPortSocketType(src);
  await editor.addNode(src);
  await editor.addConnection(conn(src, "in0", target, key));
  return src;
}

const paramNames = (n: CylNode): string[] => (n.params ?? []).map((p) => p.name);

describe("引用参数的作用域：只有已接线的槽才有参数", () => {
  it("新建 null **没有**引用参数（还没接东西呢，没有数据可覆盖）", () => {
    const n = makeNullNode();
    expect(n.params).toBeUndefined();
    expect(nodeSlots(n)).toHaveLength(1); // 只有那个 spare
    expect(nodeSlots(n)[0].wired).toBe(false);
    expect(slotRefScope(nodeSlots(n)[0])).toBe(false);
  });

  it("接上第一根线 → 槽 0 有参数，spare（槽 1）**没有**", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0"]);
    expect(Object.keys(n.inputs)).toEqual(["in0", "in1"]);
    expect(paramNames(n)).toEqual([slotRefParamName(0)]); // 只有已接线的那个
    const slots = nodeSlots(n, ["in0"]);
    expect(slots.map((s) => s.wired)).toEqual([true, false]);
  });

  it("拆线 → 参数随之消失（不留孤儿），全拆光后 params 键被删除", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0", "in1"]);
    expect(paramNames(n)).toEqual([slotRefParamName(0), slotRefParamName(1)]);
    syncDynamicInputs(n, ["in0"]);
    expect(paramNames(n)).toEqual([slotRefParamName(0)]);
    syncDynamicInputs(n, []);
    expect(n.params).toBeUndefined(); // 空数组也不留：与"没有参数"必须等价
  });

  it("端口收回时不丢用户已经填过的引用", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0", "in1"]);
    const p = n.params?.find((x) => x.name === slotRefParamName(1));
    if (p) p.value = "transform1/tx";
    syncDynamicInputs(n, ["in0", "in1"]); // 同样的接线 → 不该动
    expect(n.params?.find((x) => x.name === slotRefParamName(1))?.value).toBe("transform1/tx");
  });

  it("syncRefParams 幂等（同样接线反复调不产生变化）", () => {
    const n = makeNullNode();
    expect(syncRefParams(n, [])).toBe(false); // 未接线：本来就没有参数
    syncDynamicInputs(n, ["in0"]);
    expect(syncRefParams(n, ["in0"])).toBe(false);
  });
});

describe("一个槽一个引用：in/out 不再各存一份", () => {
  it("槽 k 的 in{k} 与 out{k} 归一到**同一个槽序号**", () => {
    const n = makeNullNode();
    expect(slotIndexOfPort(n, "in0")).toBe(0);
    expect(slotIndexOfPort(n, "out0")).toBe(0); // 输出视图 → 同一个槽
    expect(slotIndexOfPort(n, "nope")).toBe(null);
    syncDynamicInputs(n, ["in0", "in1"]);
    expect(slotIndexOfPort(n, "in2")).toBe(2);
    expect(slotIndexOfPort(n, "out2")).toBe(2); // out2 是槽 2 的输出视图，**不是**槽 0
    expect(slotIndexOfPort(n, "out9")).toBe(null); // 端口不存在
  });

  it("参数名**不带 in/out**：一个槽只有 ref_slot{k}，改一次就改了整条通道", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0"]);
    expect(paramNames(n)).toEqual(["ref_slot0"]);
    // 旧的按端口命名一个都不该再出现（那正是"分开看"的形态）
    expect(paramNames(n)).not.toContain(legacyRefParamName("in0"));
    expect(paramNames(n)).not.toContain(legacyRefParamName("out0"));
  });

  it("每个槽都是一进一出：槽 k 的视图是 in{k} + out{k}（N 条独立直通通道）", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0"]);
    const slots = nodeSlots(n, ["in0"]);
    expect(slotPortViews(slots[0])).toEqual(["in0", "out0"]);
    expect(slotPortViews(slots[1])).toEqual(["in1", "out1"]);
  });

  it("旧快照的 ref_in0 被**迁移**到 ref_slot0（填过的引用不丢）", () => {
    const n = makeNullNode();
    n.params = [{ name: legacyRefParamName("in0"), type: "string", value: "point_1.x", default: "" }];
    syncDynamicInputs(n, ["in0"]);
    expect(paramNames(n)).toEqual([slotRefParamName(0)]);
    expect(n.params?.[0].value).toBe("point_1.x"); // 值跟着迁移过来
  });

  it("类型每槽一处可读：接了线的槽报它自己的类型，spare 仍是 ANY", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    await wireInto(editor, FLOAT, nul, "in0");
    propagateDynamicTypes(editor);
    expect(slotTypeOf(nul, 0)).toBe(FLOAT);
    // 槽 1 **不跟随**槽 0（v0.1.00125）：它没接线，就该待定，于是 geo 还能接进去。
    expect(nodeSlots(nul, ["in0"]).map((s) => s.type)).toEqual([FLOAT, ANY]);
    expect(slotTypesConsistent(nul)).toBe(true); // 镜像逐槽无漂移
  });

  it("未接线的 null：槽 0 是 ANY，镜像一致", () => {
    const n = makeNullNode();
    expect(slotTypeOf(n, 0)).toBe(ANY);
    expect(slotTypeOf(n, 7)).toBe(ANY); // 越界读成 ANY，不抛
    expect(slotTypesConsistent(n)).toBe(true);
  });
});

describe("序列化：空引用不进快照（v2 字节兼容承重墙）", () => {
  const snapOf = (n: CylNode): { schemaVersion: number; nodes: Array<{ params?: unknown }> } =>
    buildGraphSnapshot(
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

  it("未接线的 null：内存里也没有参数，磁盘上自然没有 params 键", () => {
    const snap = snapOf(makeNullNode());
    expect(snap.schemaVersion).toBe(2);
    expect(snap.nodes[0]?.params).toBeUndefined();
  });

  it("接了线但引用是空的：内存里有参数（面板要用），磁盘上仍无 params 键", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0"]);
    expect(n.params?.length).toBe(1);
    expect(snapOf(n).nodes[0]?.params).toBeUndefined();
  });

  it("填了引用之后才进快照", () => {
    const n = makeNullNode();
    syncDynamicInputs(n, ["in0"]);
    const p = n.params?.find((x) => x.name === slotRefParamName(0));
    if (p) p.value = "point_1.x";
    expect(snapOf(n).nodes[0]?.params).toEqual([
      { name: slotRefParamName(0), type: "string", value: "point_1.x", default: "" },
    ]);
  });

  it("旧的 ref_in* 命名即便漏进来也照样被剔除（前缀规则未变）", () => {
    const n = makeNullNode();
    n.params = [{ name: legacyRefParamName("in0"), type: "string", value: "", default: "" }];
    expect(snapOf(n).nodes[0]?.params).toBeUndefined();
  });
});

describe("几何体槽拒绝浮点输入（用户要求）——但只拒**那一个槽**", () => {
  it("geo 定型的槽：float / vec3 都连不进它自己", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    await wireInto(editor, GEO, nul, "in0");
    propagateDynamicTypes(editor);
    const slots = nodeSlots(nul, ["in0"]);
    expect(slots[0].type).toBe(GEO);
    // 「几何体数据不是浮点」：读**该槽**的类型做校验
    expect(canConnectIntoSlot(FLOAT, slots[0].type)).toBe(false);
    expect(canConnectIntoSlot(VEC3, slots[0].type)).toBe(false);
    expect(canConnectIntoSlot(GEO, slots[0].type)).toBe(true);
  });

  it("而**另一个槽**照旧待定：float 接得进去（用户要的那件事）", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    await wireInto(editor, GEO, nul, "in0");
    propagateDynamicTypes(editor);
    const slots = nodeSlots(nul, ["in0"]);
    expect(slots[1].type).toBe(ANY);
    expect(canConnectIntoSlot(FLOAT, slots[1].type)).toBe(true);
  });

  it("两个槽定型之后互不影响：槽 0 = geo 拒 float，槽 1 = float 拒 geo", async () => {
    const editor = new NodeEditor<Schemes>();
    const nul = makeNullNode();
    await editor.addNode(nul);
    await wireInto(editor, GEO, nul, "in0");
    propagateDynamicTypes(editor);
    await wireInto(editor, FLOAT, nul, "in1");
    propagateDynamicTypes(editor);
    const slots = nodeSlots(nul, ["in0", "in1"]);
    expect(slots.map((s) => s.type)).toEqual([GEO, FLOAT, ANY]);
    expect(canConnectIntoSlot(FLOAT, slots[0].type)).toBe(false); // 几何槽拒浮点
    expect(canConnectIntoSlot(GEO, slots[1].type)).toBe(false); // 数值槽拒几何
    expect(slotTypesConsistent(nul)).toBe(true);
  });
});

