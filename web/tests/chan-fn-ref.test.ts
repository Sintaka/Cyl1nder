import { describe, expect, it } from "vitest";
import { parseParamRef } from "../src/nodes2/param-ref";

/**
 * 通道函数引用 `ch()/chf()/chs()/chi()`（v0.1.00130，用户提议）。
 *
 * **语义来自真 Houdini 实测**（`/obj/vexref_probe`，HScript 参数表达式）：
 *   ch("../transform1/tx")  -> 3.75   成功
 *   ch("transform1/tx")     -> 0.0    裸形式在 Houdini 里根本不解析
 *   chf("../transform1/tx") -> 0.0    chf 不是 HScript 函数（只存在于 VEX）
 *   chs("../transform1/tx") -> 3.75
 *
 * 所以：`../` 是必须的（参数挂在节点上，要先跳到节点所在那一层）；
 * 而「裸地址」是**我们自己的**历史写法，只在函数形式之外继续支持。
 */
const ok = (s: string) => {
  const r = parseParamRef(s);
  if (!r.ok) throw new Error(`expected ok for ${JSON.stringify(s)}: ${r.reason}`);
  return r;
};

describe("ch() 引用参与写回取值", () => {
  it("null 的引用框写 ch(\"../transform1/tx\") → 推 transform1 的 tx 值", async () => {
    const { collectWritebackTargets, resolveWritebackValue } = await import("../src/core/dataflow");
    const snap = {
      nodes: [
        {
          id: "o",
          kind: "output",
          label: "_output_",
          params: [
            { name: "address", type: "string", value: "C1-aaaaaaaa-bbbb" },
            { name: "type", type: "menu", value: "float" },
            { name: "port", type: "menu", value: "transform1/tx" },
          ],
        },
        { id: "n", kind: "null", label: "null1", params: [{ name: "ref_slot0", type: "string", value: 'ch("../transform1/tx")' }] },
        { id: "x", kind: "transform", label: "transform1", params: [{ name: "tx", type: "float", value: 6.5 }] },
      ],
      connections: [{ source: "n", sourceOutput: "out0", target: "o", targetInput: "out0" }],
    } as never;
    const targets = collectWritebackTargets(snap);
    expect(targets).toHaveLength(1);
    expect(resolveWritebackValue(snap, targets[0])).toBe(6.5);
  });

  it("指向图外的节点 → undefined（这次不写，**绝不兜底写 0**）", async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    const snap = {
      nodes: [
        { id: "n", kind: "null", label: "null1", params: [{ name: "ref_slot0", type: "string", value: 'ch("../nosuch/tx")' }] },
      ],
      connections: [{ source: "n", sourceOutput: "out0", target: "o", targetInput: "out0" }],
    } as never;
    const t = { nodeId: "o", address: "C1-aaaaaaaa-bbbb", port: "transform1/tx", type: "float" };
    expect(resolveWritebackValue(snap, t)).toBeUndefined();
  });
});

describe("图外引用：注入查表后能不能解析出值（隔离 resolver 与 prefetch）", () => {
  const snap = {
    nodes: [
      {
        id: "o",
        kind: "output",
        label: "_output_",
        params: [
          { name: "address", type: "string", value: "C1-aaaaaaaa-bbbb" },
          { name: "type", type: "menu", value: "float" },
          { name: "port", type: "menu", value: "faraway/ty" },
        ],
      },
      {
        id: "n",
        kind: "null",
        label: "null1",
        params: [{ name: "ref_slot0", type: "string", value: 'ch("../faraway/ty")' }],
      },
    ],
    connections: [{ source: "n", sourceOutput: "out0", target: "o", targetInput: "out0" }],
  } as never;
  const target = { nodeId: "o", address: "C1-aaaaaaaa-bbbb", port: "faraway/ty", type: "float" };

  it("查表命中 → 用图外的值（这一步通，说明 resolver 侧没问题）", async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    const extern = (addr: string) => (addr === "faraway/ty" ? 0.150023 : undefined);
    expect(resolveWritebackValue(snap, target, extern)).toBe(0.150023);
  });

  it("不注入查表 → undefined（不兜底 0）", async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    expect(resolveWritebackValue(snap, target)).toBeUndefined();
  });

  it("查表未命中 → undefined（读不到 ≠ 值是 0）", async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    expect(resolveWritebackValue(snap, target, () => undefined)).toBeUndefined();
  });
});

describe("空引用 = 透传流入值（v0.1.00138）", () => {
  // 引用的语义一直是「**覆盖**流入值」，所以空引用就该等于「不覆盖」——把上游原样送出。
  // 此前空引用 return undefined，于是 `_input_ → null → _output_` 这条最基本的链
  // 什么都不写：用户的 _input_ 在图上接得好好的，却完全不参与。
  const inputNode = (id: string, port: string) => ({
    id,
    kind: "input",
    label: `_input_${id}`,
    params: [
      { name: "address", type: "string", value: "C1-aaaaaaaa-bbbb" },
      { name: "type", type: "menu", value: "float" },
      { name: "port", type: "menu", value: port },
    ],
  });
  const outNode = {
    id: "o",
    kind: "output",
    label: "_output_",
    params: [
      { name: "address", type: "string", value: "C1-aaaaaaaa-bbbb" },
      { name: "type", type: "menu", value: "float" },
      { name: "port", type: "menu", value: "dst/tx" },
    ],
  };
  const target = { nodeId: "o", address: "C1-aaaaaaaa-bbbb", port: "dst/tx", type: "float" };
  const lookup = (a: string) => (a === "srcA/ty" ? 1.5 : a === "srcB/ty" ? 2.5 : undefined);

  it("null 的引用为空 → 透传 `_input_` 的值（而不是什么都不写）", async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    const snap = {
      nodes: [inputNode("i", "srcA/ty"), { id: "n", kind: "null", label: "null1", params: [] }, outNode],
      connections: [
        { source: "i", sourceOutput: "in0", target: "n", targetInput: "in0" },
        { source: "n", sourceOutput: "out0", target: "o", targetInput: "out0" },
      ],
    } as never;
    expect(resolveWritebackValue(snap, target, lookup)).toBe(1.5);
  });

  it("**槽号要对**：out1 透传 in1 的上游，不是 in0 的", async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    const snap = {
      nodes: [
        inputNode("iA", "srcA/ty"),
        inputNode("iB", "srcB/ty"),
        { id: "n", kind: "null", label: "null1", params: [] },
        outNode,
      ],
      connections: [
        { source: "iA", sourceOutput: "in0", target: "n", targetInput: "in0" },
        { source: "iB", sourceOutput: "in0", target: "n", targetInput: "in1" },
        { source: "n", sourceOutput: "out1", target: "o", targetInput: "out0" },
      ],
    } as never;
    // 写这段时我原本回头调 resolveWritebackValue(nodeId: null 的 id)，那会取**任意**一根
    // 入线 → 槽 1 解析出槽 0 的上游（1.5）。这条测试就是钉死它。
    expect(resolveWritebackValue(snap, target, lookup)).toBe(2.5);
  });

  it("非空引用仍然**覆盖**流入值（不是相加、不是择一）", async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    const snap = {
      nodes: [
        inputNode("i", "srcA/ty"),
        { id: "n", kind: "null", label: "null1", params: [{ name: "ref_slot0", type: "string", value: "9" }] },
        outNode,
      ],
      connections: [
        { source: "i", sourceOutput: "in0", target: "n", targetInput: "in0" },
        { source: "n", sourceOutput: "out0", target: "o", targetInput: "out0" },
      ],
    } as never;
    expect(resolveWritebackValue(snap, target, lookup)).toBe(9);
  });

  it("槽没接线 → undefined（无流入值，不是 0）", async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    const snap = {
      nodes: [{ id: "n", kind: "null", label: "null1", params: [] }, outNode],
      connections: [{ source: "n", sourceOutput: "out0", target: "o", targetInput: "out0" }],
    } as never;
    expect(resolveWritebackValue(snap, target, lookup)).toBeUndefined();
  });

  it("null 接成环不会栈溢出（图上画得出来，所以必须防）", async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    const snap = {
      nodes: [
        { id: "a", kind: "null", label: "nullA", params: [] },
        { id: "b", kind: "null", label: "nullB", params: [] },
        outNode,
      ],
      connections: [
        { source: "a", sourceOutput: "out0", target: "b", targetInput: "in0" },
        { source: "b", sourceOutput: "out0", target: "a", targetInput: "in0" },
        { source: "a", sourceOutput: "out0", target: "o", targetInput: "out0" },
      ],
    } as never;
    expect(resolveWritebackValue(snap, target, lookup)).toBeUndefined();
  });
});

describe("`_input_` 直接接 `_output_`（Shift+Enter 造出来的形状）", () => {
  // v0.1.00137：此前 resolveWritebackValue 没有 input 分支，于是这条链**什么都不写** ——
  // 而 Shift+Enter 恰恰造出这个形状（抄同一个 serial+port 再一一连线）。
  // 手势"成功"、图上线也接好，却没有任何值流动，是最难自查的那种空转。
  const snap = {
    nodes: [
      {
        id: "i",
        kind: "input",
        label: "_input_",
        params: [
          { name: "address", type: "string", value: "C1-aaaaaaaa-bbbb" },
          { name: "type", type: "menu", value: "float" },
          { name: "port", type: "menu", value: "faraway/ty" },
        ],
      },
      {
        id: "o",
        kind: "output",
        label: "_output_",
        params: [
          { name: "address", type: "string", value: "C1-aaaaaaaa-bbbb" },
          { name: "type", type: "menu", value: "float" },
          { name: "port", type: "menu", value: "other/tx" },
        ],
      },
    ],
    connections: [{ source: "i", sourceOutput: "in0", target: "o", targetInput: "out0" }],
  } as never;
  const target = { nodeId: "o", address: "C1-aaaaaaaa-bbbb", port: "other/tx", type: "float" };

  it("值取自 `_input_` 自己的 port（经注入的查表）", async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    expect(resolveWritebackValue(snap, target, (a) => (a === "faraway/ty" ? 0.5 : undefined))).toBe(0.5);
  });

  it("端口没选 → undefined（无源，不是错误）", async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    const bare = JSON.parse(JSON.stringify(snap)) as typeof snap;
    (bare as { nodes: Array<{ kind: string; params: Array<{ name: string; value: string }> }> }).nodes
      .find((n) => n.kind === "input")!
      .params.find((p) => p.name === "port")!.value = "";
    expect(resolveWritebackValue(bare, target, () => 0.5)).toBeUndefined();
  });

  it("collector 会预取 `_input_` 自己的 port（否则 input 分支永远查空缓存）", async () => {
    const { collectExternRefAddresses } = await import("../src/core/dataflow");
    expect(collectExternRefAddresses(snap)).toContain("faraway/ty");
  });
});

describe("collectExternRefAddresses：只收指向图外的引用", () => {
  // v0.1.00138：收集改成**按可达性**——只有能沿入线走到某个 `_output_` 的节点才需要取值。
  // 所以夹具必须带一个 `_output_` 并接上，否则「没人要这个值」是正确结论、什么都不该收。
  // （我这条夹具原先没有 output，收紧规则后它自己挂了，正说明规则生效。）
  const snapWith = (refExpr: string, extraLabels: string[] = []) =>
    ({
      nodes: [
        { id: "n", kind: "null", label: "null1", params: [{ name: "ref_slot0", type: "string", value: refExpr }] },
        { id: "o", kind: "output", label: "_output_", params: [] },
        ...extraLabels.map((l, i) => ({ id: `x${i}`, kind: "transform", label: l, params: [] })),
      ],
      connections: [{ source: "n", sourceOutput: "out0", target: "o", targetInput: "out0" }],
    }) as never;

  it("**没接到 `_output_` 的节点一个请求都不发**（v0.1.00138 收紧）", async () => {
    const { collectExternRefAddresses } = await import("../src/core/dataflow");
    // 一个 `_input_` 挂在那里、谁都不喂：它的值没人要。
    // v0.1.00137 我无条件收每个 input 的端口 → 几乎任何项目一打开就有图外地址
    // → 2s 轮询常驻 → 每次都打桥。全量 e2e 里这条流量把 `.cyl-status` 握手挤掉过两次。
    const lonely = {
      nodes: [
        {
          id: "i",
          kind: "input",
          label: "_input_",
          params: [{ name: "port", type: "menu", value: "faraway/ty" }],
        },
      ],
      connections: [],
    } as never;
    expect(collectExternRefAddresses(lonely)).toEqual([]);
  });

  it("接到 `_output_` 的 `_input_` 才收", async () => {
    const { collectExternRefAddresses } = await import("../src/core/dataflow");
    const wired = {
      nodes: [
        {
          id: "i",
          kind: "input",
          label: "_input_",
          params: [{ name: "port", type: "menu", value: "faraway/ty" }],
        },
        { id: "o", kind: "output", label: "_output_", params: [] },
      ],
      connections: [{ source: "i", sourceOutput: "in0", target: "o", targetInput: "out0" }],
    } as never;
    expect(collectExternRefAddresses(wired)).toEqual(["faraway/ty"]);
  });

  it("图内兄弟不收（同步就能解析，问桥是白打请求）", async () => {
    const { collectExternRefAddresses } = await import("../src/core/dataflow");
    expect(collectExternRefAddresses(snapWith('ch("../transform1/tx")', ["transform1"]))).toEqual([]);
  });

  it("图外的收，逻辑名与映射表同一套命名", async () => {
    const { collectExternRefAddresses } = await import("../src/core/dataflow");
    expect(collectExternRefAddresses(snapWith('ch("../faraway/tx")'))).toEqual(["faraway/tx"]);
  });

  it("字面量与空串不收（不需要取值）", async () => {
    const { collectExternRefAddresses } = await import("../src/core/dataflow");
    expect(collectExternRefAddresses(snapWith("2"))).toEqual([]);
    expect(collectExternRefAddresses(snapWith("  "))).toEqual([]);
  });
});

describe("vec3 组名自动展开（用户要求：t 由属性系统自动处理）", () => {
  const mk = (refExpr: string) =>
    ({
      nodes: [
        {
          id: "o",
          kind: "output",
          label: "_output_",
          params: [
            { name: "address", type: "string", value: "C1-aaaaaaaa-bbbb" },
            { name: "type", type: "menu", value: "vec3" },
            { name: "port", type: "menu", value: "transform1/t" },
          ],
        },
        { id: "n", kind: "null", label: "null1", params: [{ name: "ref_slot0", type: "string", value: refExpr }] },
        {
          id: "t1",
          kind: "transform",
          label: "transform1",
          params: [
            { name: "tx", type: "float", value: 4 },
            { name: "ty", type: "float", value: 5 },
            { name: "tz", type: "float", value: 6 },
          ],
        },
      ],
      connections: [{ source: "n", sourceOutput: "out0", target: "o", targetInput: "out0" }],
    }) as never;
  const target = { nodeId: "o", address: "C1-aaaaaaaa-bbbb", port: "transform1/t", type: "vec3" };

  it('ch("../transform1/t") → [4,5,6]（图里只有 tx/ty/tz，没有 t）', async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    expect(resolveWritebackValue(mk('ch("../transform1/t")'), target)).toEqual([4, 5, 6]);
  });

  it('分量引用 ch("../transform1/t.y") → 5（单个数，不是数组）', async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    expect(resolveWritebackValue(mk('ch("../transform1/t.y")'), target)).toBe(5);
  });

  it("缺一个分量 → undefined，**绝不补 0**（拼出的位姿是错的，比不写更坏）", async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    const snap = mk('ch("../transform1/t")') as unknown as {
      nodes: Array<{ label: string; params?: Array<{ name: string }> }>;
    };
    const t1 = snap.nodes.find((n) => n.label === "transform1")!;
    t1.params = t1.params!.filter((p) => p.name !== "tz");
    expect(resolveWritebackValue(snap as never, target)).toBeUndefined();
  });
});

describe("通道函数引用", () => {
  it("`ch(\"../transform1/tx\")` → 网络相对地址 transform1/tx", () => {
    const r = ok('ch("../transform1/tx")');
    expect(r.address).toBe("transform1/tx");
    expect(r.fn).toBe("ch");
    expect(r.fnType).toBeNull(); // ch 同时能取 float/string → 类型由目标决定
  });

  it("引号可有可无（从 Houdini 抄带引号，手打常不带）", () => {
    expect(ok("ch(../transform1/tx)").address).toBe("transform1/tx");
    expect(ok("ch('../transform1/tx')").address).toBe("transform1/tx");
  });

  it("chf/chs/chi 各自带出类型；chf 作为 float 别名被接受", () => {
    expect(ok('chf("../a/tx")').fnType).toBe("float");
    expect(ok('chs("../a/name")').fnType).toBe("string");
    expect(ok('chi("../a/n")').fnType).toBe("int");
  });

  it("大小写不敏感、允许函数名与括号间有空格", () => {
    expect(ok('CH ( "../a/tx" )').fn).toBe("ch");
  });

  it("绝对路径直接放行（不需要 ../）", () => {
    expect(ok('ch("/obj/geo1/transform1/tx")').address).toBe("/obj/geo1/transform1/tx");
  });

  it("分量后缀仍然可用，且与函数形式叠加", () => {
    const r = ok('ch("../sceneanimate1/animation.x")');
    expect(r.address).toBe("sceneanimate1/animation");
    expect(r.components).toEqual([0]);
  });

  // --- 以下都是「宁可报错也不要静默指错地方」---------------------------------
  it("函数里写裸地址 → 报错并给出正确写法（Houdini 里它求值为 0）", () => {
    const r = parseParamRef('ch("transform1/tx")');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('ch("../transform1/tx")');
  });

  it("`../../` 报错而不是当成一层（会指向错误的节点）", () => {
    const r = parseParamRef('ch("../../a/tx")');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("../../");
  });

  it("空括号报错", () => {
    expect(parseParamRef("ch()").ok).toBe(false);
  });

  it("裸地址（旧写法）继续可用，fn 为 null", () => {
    const r = ok("transform1/tx");
    expect(r.address).toBe("transform1/tx");
    expect(r.fn).toBeNull();
  });

  it("空串仍是「没有引用」而不是错误", () => {
    const r = ok("");
    expect(r.address).toBe("");
    expect(r.fn).toBeNull();
  });
});
