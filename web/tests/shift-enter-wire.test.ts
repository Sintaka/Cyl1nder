/**
 * Shift+Enter：选中的 `_input_` 一键镜像到 `_output_`（同 serial、端口一一对应、
 * 摆到右边）——决策部分的单测。
 *
 * 为什么只测这两个纯函数：vitest 跑 `environment:"node"` 且没装 jsdom，凡碰
 * DOM/rete 视图/网络的都进不来。于是「配哪几对、抄什么参数、摆在哪、跳过谁为什么」
 * 全在 planShiftEnterWire / resolveShiftEnterTarget 里（无 DOM、无缓存、无 fetch），
 * DOM 那半截只剩「照计划 addConnection + translate」的接线，刻意不测。
 *
 * canConnectSockets 用**真的那一个**（从 graph-model import）而不是替身：跨族拒绝
 * 是这个特性的核心约束之一，拿假谓词测等于没测。
 */
import { describe, expect, it } from "vitest";
import { FLOAT, GEO, VEC3, canConnectSockets } from "../src/nodes2/graph-model";
import {
  SHIFT_ENTER_GAP_X,
  planShiftEnterWire,
  resolveShiftEnterTarget,
  type ShiftEnterInput,
  type ShiftEnterOutput,
  type ShiftEnterPortOption,
} from "../src/nodes2/graph-interact";

/** SOP HDA 的两侧清单：in0..in3 / out0..out3，全 geo。 */
const hdaIn: ShiftEnterPortOption[] = [
  { key: "in0", type: GEO },
  { key: "in1", type: GEO },
  { key: "in2", type: GEO },
  { key: "in3", type: GEO },
];
const hdaOut: ShiftEnterPortOption[] = [
  { key: "out0", type: GEO },
  { key: "out1", type: GEO },
  { key: "out2", type: GEO },
  { key: "out3", type: GEO },
];

/** 吊牌（tag）serial：两侧是**同一份**清单（参数天生双向读写）。 */
const tagPorts: ShiftEnterPortOption[] = [
  { key: "transform1/tx", type: FLOAT },
  { key: "transform1/scale", type: VEC3 },
];

function mkInput(over: Partial<ShiftEnterInput> = {}): ShiftEnterInput {
  return {
    id: over.id ?? "i1",
    label: over.label ?? "_input_",
    // 缺省 true = 单端口+地址形态（新建节点的常态）；旧 4 端口那一例显式传 false
    hasAddressParams: over.hasAddressParams ?? true,
    address: over.address ?? "C1-aaaa-bbbb",
    port: over.port ?? "in0",
    socketType: over.socketType ?? GEO,
    x: over.x ?? 0,
    y: over.y ?? 0,
  };
}

function mkOutput(over: Partial<ShiftEnterOutput> = {}): ShiftEnterOutput {
  return {
    id: over.id ?? "o1",
    label: over.label ?? "_output_",
    socketType: over.socketType ?? GEO,
    // 缺省 true = 单端口+地址形态（新建节点的常态）；旧 4 端口那一例显式传 false
    hasAddressParams: over.hasAddressParams ?? true,
  };
}

/** 把 HDA 清单接成 portsOf（两侧不同表）。 */
const hdaPorts = (_s: string, side: "inputs" | "outputs") => (side === "inputs" ? hdaIn : hdaOut);
/** tag：两侧同一份表。 */
const tagPortsOf = () => tagPorts;
/** 「桥还没答」：两侧都不知道。 */
const noPorts = () => null;
describe("resolveShiftEnterTarget: 按下标配对，不按名字", () => {
  it("HDA 两侧清单已知 → in2 对上 out2（名字不同，下标相同）", () => {
    expect(resolveShiftEnterTarget("in2", hdaIn, hdaOut)).toEqual({ key: "out2", type: GEO });
  });

  it("tag 两侧同一份清单 → 同下标取回**同一个**逻辑名，类型随它", () => {
    expect(resolveShiftEnterTarget("transform1/scale", tagPorts, tagPorts)).toEqual({
      key: "transform1/scale",
      type: VEC3,
    });
  });

  it("清单已知却没有这个端口 → null（不回落猜一个）", () => {
    expect(resolveShiftEnterTarget("in9", hdaIn, hdaOut)).toBeNull();
  });

  it("输出侧比输入侧短 → null（配不上就是配不上）", () => {
    expect(resolveShiftEnterTarget("in3", hdaIn, [{ key: "out0", type: GEO }])).toBeNull();
  });

  it("清单未知 → 回落命名约定 in<N> -> out<N>，且类型判为未知", () => {
    expect(resolveShiftEnterTarget("in1", null, null)).toEqual({ key: "out1", type: null });
  });

  it("清单未知且不是 in<N> 形状（tag 逻辑名）→ 原样返回", () => {
    expect(resolveShiftEnterTarget("transform1/tx", null, null)).toEqual({ key: "transform1/tx", type: null });
  });

  it("桥回空类型串 → 归成 null（= 不知道），不当成某个真类型", () => {
    expect(resolveShiftEnterTarget("in0", hdaIn, [{ key: "out0", type: "" }])).toEqual({ key: "out0", type: null });
  });
});
describe("planShiftEnterWire: 一一对应 + 抄同一个 serial", () => {
  it("3 个 input -> 3 个 output：同 serial、端口一一对应、socket key 恒为 in0/out0", () => {
    const inputs = [
      mkInput({ id: "i1", label: "_input_", port: "in0", y: 0 }),
      mkInput({ id: "i2", label: "_input_2", port: "in1", y: 100 }),
      mkInput({ id: "i3", label: "_input_3", port: "in2", y: 200 }),
    ];
    const outputs = [mkOutput({ id: "o1" }), mkOutput({ id: "o2", label: "_output_2" }), mkOutput({ id: "o3", label: "_output_3" })];
    const plan = planShiftEnterWire(inputs, outputs, hdaPorts, canConnectSockets);
    expect(plan.skipped).toEqual([]);
    expect(plan.pairs.map((p) => [p.inputId, p.outputId, p.port])).toEqual([
      ["i1", "o1", "out0"],
      ["i2", "o2", "out1"],
      ["i3", "o3", "out2"],
    ]);
    // serial 逐字相同（用户要求「在后面填入相同的序列号」）
    expect(new Set(plan.pairs.map((p) => p.address))).toEqual(new Set(["C1-aaaa-bbbb"]));
    // 图内 socket key 与 serial 逻辑端口是两件事：线永远接 in0 -> out0
    expect(plan.pairs.every((p) => p.sourceOutput === "in0" && p.targetInput === "out0")).toBe(true);
  });

  it("按视觉顺序（y 再 x）配对，而不是 getNodes() 的建节点顺序", () => {
    const inputs = [
      mkInput({ id: "low", label: "_input_low", port: "in2", y: 300 }),
      mkInput({ id: "high", label: "_input_high", port: "in0", y: 10 }),
    ];
    const outputs = [mkOutput({ id: "first" }), mkOutput({ id: "second", label: "_output_2" })];
    const plan = planShiftEnterWire(inputs, outputs, hdaPorts, canConnectSockets);
    expect(plan.pairs.map((p) => p.inputId)).toEqual(["high", "low"]);
  });

  it("位置：全部摆到「最右 input + GAP」这条竖线上，y 与各自配对的 input 对齐", () => {
    const inputs = [
      mkInput({ id: "i1", port: "in0", x: 40, y: 0 }),
      mkInput({ id: "i2", label: "_input_2", port: "in1", x: 260, y: 150 }),
    ];
    const outputs = [mkOutput({ id: "o1" }), mkOutput({ id: "o2", label: "_output_2" })];
    const plan = planShiftEnterWire(inputs, outputs, hdaPorts, canConnectSockets);
    expect(plan.pairs.map((p) => p.x)).toEqual([260 + SHIFT_ENTER_GAP_X, 260 + SHIFT_ENTER_GAP_X]);
    expect(plan.pairs.map((p) => p.y)).toEqual([0, 150]);
  });
});
describe("planShiftEnterWire: 配不上就跳过并报原因，绝不硬连", () => {
  it("跨族（geo -> float）被 canConnectSockets 拒 → 跳过该对并说明类型", () => {
    const inputs = [mkInput({ id: "i1", label: "_input_", port: "transform1/tx", socketType: GEO })];
    const plan = planShiftEnterWire(inputs, [mkOutput({ id: "o1" })], tagPortsOf, canConnectSockets);
    expect(plan.pairs).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].inputLabel).toBe("_input_");
    expect(plan.skipped[0].reason).toContain("socket types refuse");
    // 原因里列出**试过的每个候选及其类型**（这里只有一个）：只报第一个会让用户以为漏扫。
    expect(plan.skipped[0].reason).toContain(`${GEO} -> none of: _output_(${FLOAT})`);
  });

  it("「找第一个匹配的」：第一个候选类型不合 → 跳过它接上第二个，而不是让这个 input 落空", () => {
    // 这条就是用户那句「shift enter 默认会找第一个匹配的连接尝试连线」的落点。
    // 旧的下标对应写法在这里会把 input 整个跳过（它只看游标那一个候选）。
    //
    // 用 noPorts（桥还没答）才能让候选之间**有区别**：目标类型未知时按各 output 自己的
    // socket 类型校验，所以 geo 那个合不上、float 那个合得上。反之当桥答出了端口类型，
    // 那个类型是要**写进** output 的，每个候选都一样 —— 于是要么全合要么全不合，扫描
    // 退化成"第一个"，这符合语义（类型由 serial 的端口决定，不由某个 output 现状决定）。
    const plan = planShiftEnterWire(
      [mkInput({ id: "i1", label: "_input_", port: "in0", socketType: FLOAT })],
      [mkOutput({ id: "geo_out", label: "_output_geo", socketType: GEO }), mkOutput({ id: "f_out", label: "_output_f", socketType: FLOAT })],
      noPorts,
      canConnectSockets,
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.pairs.map((p) => p.outputId)).toEqual(["f_out"]);
  });

  it("扫描用掉即移除：两个 input 各自接到第一个还没被占用的匹配 output", () => {
    const inputs = [
      mkInput({ id: "i1", label: "_input_", port: "in0", socketType: FLOAT, y: 0 }),
      mkInput({ id: "i2", label: "_input_2", port: "in1", socketType: FLOAT, y: 90 }),
    ];
    const outputs = [
      mkOutput({ id: "geo_out", label: "_output_geo", socketType: GEO }),
      mkOutput({ id: "f1", label: "_output_f1", socketType: FLOAT }),
      mkOutput({ id: "f2", label: "_output_f2", socketType: FLOAT }),
    ];
    const plan = planShiftEnterWire(inputs, outputs, noPorts, canConnectSockets);
    // 两个都接上了，且没有交叉（顺序扫描 + 用掉即移除）；geo 那个始终没人要。
    expect(plan.pairs.map((p) => [p.inputId, p.outputId])).toEqual([
      ["i1", "f1"],
      ["i2", "f2"],
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("被拒的那一对**不消耗** output：它留给下一个 input", () => {
    const inputs = [
      mkInput({ id: "bad", label: "_input_bad", port: "transform1/tx", socketType: GEO, y: 0 }),
      mkInput({ id: "ok", label: "_input_ok", port: "transform1/tx", socketType: FLOAT, y: 50 }),
    ];
    const plan = planShiftEnterWire(inputs, [mkOutput({ id: "only" })], tagPortsOf, canConnectSockets);
    expect(plan.pairs).toHaveLength(1);
    expect(plan.pairs[0].inputId).toBe("ok");
    expect(plan.pairs[0].outputId).toBe("only");
    expect(plan.skipped.map((s) => s.inputLabel)).toEqual(["_input_bad"]);
  });

  it("float -> vec3 同族隐式转换：放行（与 canConnectSockets 同一条规则）", () => {
    const inputs = [mkInput({ id: "i1", port: "transform1/scale", socketType: FLOAT })];
    const plan = planShiftEnterWire(inputs, [mkOutput({ id: "o1", socketType: FLOAT })], tagPortsOf, canConnectSockets);
    expect(plan.skipped).toEqual([]);
    expect(plan.pairs[0].type).toBe(VEC3);
  });

  it("input 多于 output → 多出来的跳过（绝不新建用户没要的节点）", () => {
    const inputs = [
      mkInput({ id: "i1", label: "_input_", port: "in0", y: 0 }),
      mkInput({ id: "i2", label: "_input_2", port: "in1", y: 80 }),
    ];
    const plan = planShiftEnterWire(inputs, [mkOutput({ id: "o1" })], hdaPorts, canConnectSockets);
    expect(plan.pairs.map((p) => p.inputId)).toEqual(["i1"]);
    expect(plan.skipped).toEqual([{ inputLabel: "_input_2", reason: "no free _output_ left to mirror into" }]);
  });

  it("旧 4 端口 _input_ → 原因说的是「它没有地址栏」，而不是「你没填地址」", () => {
    // 它的 address 读出来也是空串，若不先按形态分流，原因会写成"没填地址"——那是误导：
    // 那个节点根本没有地址栏可填，用户照着提示去找会找不到。
    const plan = planShiftEnterWire(
      [mkInput({ label: "_input_legacy", hasAddressParams: false, address: "", port: "" })],
      [mkOutput()],
      hdaPorts,
      canConnectSockets,
    );
    expect(plan.pairs).toEqual([]);
    expect(plan.skipped).toEqual([
      { inputLabel: "_input_legacy", reason: "legacy 4-port _input_ (no address/port params to mirror from)" },
    ]);
  });

  it("地址没填 / 端口没选 → 各自跳过（都是正常中间态，不是错误）", () => {
    const inputs = [
      mkInput({ id: "i1", label: "_no_addr", address: "", y: 0 }),
      mkInput({ id: "i2", label: "_no_port", port: "", y: 60 }),
    ];
    const plan = planShiftEnterWire(inputs, [mkOutput(), mkOutput({ id: "o2" })], hdaPorts, canConnectSockets);
    expect(plan.pairs).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["no serial (address) filled in", "no port selected"]);
  });

  it("旧 4 端口 _output_ → 报进 ineligibleOutputs（不是 skipped），绝不连出半成品", () => {
    // 它有真的 out0 端口、线接得上，但没有地方写 serial —— 若不挡住，用户会得到一根
    // "线连好了、序列号没写进去"的线，而且一声不响。
    // 报在 ineligibleOutputs 而不是 skipped：说的是这个 **output** 没资格，与"哪个
    // input 没配上"是两件事，塞进同一个数组会让日志指错节点。
    const plan = planShiftEnterWire(
      [mkInput({ label: "_input_" })],
      [mkOutput({ label: "_output_legacy", hasAddressParams: false })],
      hdaPorts,
      canConnectSockets,
    );
    expect(plan.pairs).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.ineligibleOutputs).toEqual([
      { outputLabel: "_output_legacy", reason: "legacy 4-port _output_ (no address/port params)" },
    ]);
  });

  it("旧 4 端口 output **不挡住**它后面的合格 output（资格筛选先做，不占 cursor）", () => {
    const inputs = [
      mkInput({ id: "i1", label: "_input_", port: "in0", y: 0 }),
      mkInput({ id: "i2", label: "_input_2", port: "in1", y: 90 }),
    ];
    const outputs = [
      mkOutput({ id: "legacy", label: "_output_legacy", hasAddressParams: false }),
      mkOutput({ id: "modern", label: "_output_2" }),
    ];
    const plan = planShiftEnterWire(inputs, outputs, hdaPorts, canConnectSockets);
    // 合格的那一个照样接上第一个 input；legacy 只是被排除在候选之外。
    expect(plan.pairs.map((p) => [p.inputId, p.outputId, p.port])).toEqual([["i1", "modern", "out0"]]);
    expect(plan.ineligibleOutputs.map((o) => o.outputLabel)).toEqual(["_output_legacy"]);
    // 第二个 input 没有候选了 → 正常的"没空位"跳过（而不是"撞上旧节点"）
    expect(plan.skipped).toEqual([{ inputLabel: "_input_2", reason: "no free _output_ left to mirror into" }]);
  });

  it("端口不在该 serial 的清单里 → 跳过并点名 serial", () => {
    const plan = planShiftEnterWire([mkInput({ port: "in9" })], [mkOutput()], hdaPorts, canConnectSockets);
    expect(plan.pairs).toEqual([]);
    expect(plan.skipped[0].reason).toContain("no counterpart on C1-aaaa-bbbb");
  });
});
describe("planShiftEnterWire: 桥还没答话时的诚实行为", () => {
  it("清单未知 → 按命名约定配对，type 报 null（= 别动 output 现有类型）", () => {
    const plan = planShiftEnterWire([mkInput({ port: "in1" })], [mkOutput()], noPorts, canConnectSockets);
    expect(plan.skipped).toEqual([]);
    expect(plan.pairs[0].port).toBe("out1");
    expect(plan.pairs[0].type).toBeNull();
  });

  it("类型未知时按 output **当前** socket 类型校验：geo input 配 float 槽 → 拒", () => {
    const plan = planShiftEnterWire(
      [mkInput({ port: "in0", socketType: GEO })],
      [mkOutput({ socketType: FLOAT })],
      noPorts,
      canConnectSockets,
    );
    expect(plan.pairs).toEqual([]);
    expect(plan.skipped[0].reason).toContain(`${GEO} -> none of: _output_(${FLOAT})`);
  });

  it("两侧都空 → 空计划（没选 input 或没有 output 时什么都不做）", () => {
    const empty = { pairs: [], skipped: [], ineligibleOutputs: [] };
    expect(planShiftEnterWire([], [mkOutput()], hdaPorts, canConnectSockets)).toEqual(empty);
    expect(planShiftEnterWire([mkInput()], [], hdaPorts, canConnectSockets)).toEqual(empty);
  });
});

