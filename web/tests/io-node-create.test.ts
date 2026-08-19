/**
 * v0.1.00120：`_input_` / `_output_` 从「每图唯一」变成「可多建」+ 端口选择参数
 * （`port`）+ 输出端口重复占用检测。
 *
 * 覆盖四件事（各自的**根因**见 graph-model.ts 对应注释）：
 *  1. 序号命名：首个仍是冻结字面量 `_input_`，之后 `_input_2`…；恢复时序号被推进。
 *  2. 单端口形态：1 端口 + address/type/port 三参数。
 *  3. 序列化字节兼容：`port` 为默认（""）时**不出现在快照里**——v2/v3/v4/v5 逐字不变。
 *  4. 重复输出端口检测：纯谓词，冲突组内每个节点都被标记。
 */
import { describe, expect, it } from "vitest";
import { NodeEditor } from "rete";
import {
  GEO,
  PORT_PARAM,
  buildGraphSnapshot,
  findDuplicateOutputPorts,
  duplicateOutputPortsToNodeErrors,
  makeInputNode,
  makeOutputNode,
  makePaletteNode,
  restoreNodeForKind,
  sanitizePort,
  type CylNode,
  type GraphNodeSnapshotData,
  type NodeKind,
  type ParamSpec,
  type Schemes,
} from "../src/nodes2/graph-model";

/** 参数名列表（顺序敏感：addressParams 与 syncAddressParams 必须同序）。 */
function paramNames(n: CylNode): string[] {
  return (n.params ?? []).map((p) => p.name);
}

function paramValue(n: CylNode, name: string): unknown {
  return n.params?.find((p) => p.name === name)?.value;
}

/** 最小 snapshot 节点（buildGraphSnapshot 的入参形状）。 */
function snapNode(over: Partial<GraphNodeSnapshotData> & { kind: NodeKind }): GraphNodeSnapshotData {
  return {
    id: over.id ?? "n1",
    kind: over.kind,
    label: over.label ?? "_output_",
    baseLabel: over.baseLabel ?? "_output_",
    flags: over.flags ?? { display: false, bypass: false, freeze: false, reference: false },
    x: over.x ?? 0,
    y: over.y ?? 0,
    params: over.params,
    address: over.address,
  };
}

/** 快照里第 0 个节点的键集合（字节兼容断言用）。 */
function firstNodeEntry(snap: unknown): Record<string, unknown> {
  return (snap as { nodes: Record<string, unknown>[] }).nodes[0];
}

// 模块加载期**先于任何 describe** 抓下第一次调用的标签：序号是模块级单调的，只有在这里
// 才能观察到"进程内第一个"。这是冻结契约的守门测试——`buildGraph` 建的默认对必须仍叫
// `_input_` / `_output_`，13 个 e2e spec 的 fixture 与 bridge/tests/test_mcp.py 都依赖它。
const FIRST_INPUT_LABEL = makeInputNode(true).label;
const FIRST_OUTPUT_LABEL = makeOutputNode(true).label;

describe("首个标签是冻结字面量（e2e / bridge 测试契约）", () => {
  it("进程内第一次调用 → 恰好 _input_ / _output_（无序号后缀）", () => {
    expect(FIRST_INPUT_LABEL).toBe("_input_");
    expect(FIRST_OUTPUT_LABEL).toBe("_output_");
  });
});

describe("_input_ / _output_ 序号命名（可多建）", () => {
  it("连续新建 → 标签唯一；首个是冻结字面量 _input_ / _output_", () => {
    // 序号是模块级、跨用例累积的（同 nullSeq/geoSeq），所以只断言「唯一 + 首个规则」，
    // 不断言具体数字——那样写会让用例互相依赖执行顺序。
    const made = [makeInputNode(true), makeInputNode(true), makeInputNode(true)];
    const labels = made.map((n) => n.label);
    expect(new Set(labels).size).toBe(3);
    // 第一个曾经（本进程内第一次调用）是无后缀形态；之后一律带数字后缀。
    for (const l of labels) expect(l === "_input_" || /^_input_\d+$/.test(l)).toBe(true);
    // baseLabel 恒为族名，不带序号（面板/改名读它）。
    for (const n of made) expect(n.baseLabel).toBe("_input_");
  });

  it("_output_ 独立序号，且与 _input_ 互不干扰", () => {
    const outs = [makeOutputNode(true), makeOutputNode(true)];
    expect(new Set(outs.map((n) => n.label)).size).toBe(2);
    for (const n of outs) {
      expect(n.label === "_output_" || /^_output_\d+$/.test(n.label)).toBe(true);
      expect(n.baseLabel).toBe("_output_");
    }
  });

  it("恢复带 _input_7 的图之后新建不撞名（claimInputLabel 推进序号）", () => {
    const restored = restoreNodeForKind({ kind: "input", label: "_input_7" }, false) as CylNode;
    expect(restored).not.toBeNull();
    // restoreGraph 之后会用快照标签覆盖 label；这里模拟那一步。
    restored.label = "_input_7";
    const next = makeInputNode(true);
    expect(next.label).not.toBe("_input_7");
    // 序号已被推到 8 以上，所以新名字的数字部分必然 > 7。
    const m = /^_input_(\d+)$/.exec(next.label);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThan(7);
  });

  it("用户改过的名字（myInput）不占本序列的号，也不抛", () => {
    const before = makeInputNode(true).label;
    restoreNodeForKind({ kind: "input", label: "myInput" }, false);
    const after = makeInputNode(true).label;
    expect(after).not.toBe(before);
  });
});

describe("单端口形态：1 端口 + address/type/port", () => {
  it("makeInputNode(true) → 1 个 in0，三参数按 address/type/port 定序", () => {
    const n = makeInputNode(true);
    expect(Object.keys(n.outputs)).toEqual(["in0"]);
    expect(paramNames(n)).toEqual(["address", "type", PORT_PARAM]);
    expect(paramValue(n, "address")).toBe("");
    expect(paramValue(n, "type")).toBe(GEO);
    expect(paramValue(n, PORT_PARAM)).toBe("");
  });

  it("makeOutputNode(true) → 1 个 out0，同三参数", () => {
    const n = makeOutputNode(true);
    expect(Object.keys(n.inputs)).toEqual(["out0"]);
    expect(paramNames(n)).toEqual(["address", "type", PORT_PARAM]);
    expect(paramValue(n, PORT_PARAM)).toBe("");
  });

  it("默认 false 仍是旧 4 端口形态、无参数（冻结契约）", () => {
    expect(Object.keys(makeInputNode().outputs)).toEqual(["in0", "in1", "in2", "in3"]);
    expect(Object.keys(makeOutputNode().inputs)).toEqual(["out0", "out1", "out2", "out3"]);
    expect(makeInputNode().params).toBeUndefined();
    expect(makeOutputNode().params).toBeUndefined();
  });

  it("sanitizePort：字符串原样（含空串），其余 → \"\"，绝不抛", () => {
    expect(sanitizePort("out1")).toBe("out1");
    expect(sanitizePort("")).toBe("");
    expect(sanitizePort(undefined)).toBe("");
    expect(sanitizePort(null)).toBe("");
    expect(sanitizePort(42)).toBe("");
    expect(sanitizePort({ nope: 1 })).toBe("");
    expect(sanitizePort(["out1"])).toBe("");
  });
});

describe("序列化字节兼容：port 默认时不出现在快照里", () => {
  /** 全默认的单端口 _output_ → 无 params 键、schemaVersion 2（与旧 4 端口图字节一致）。 */
  it("port=\"\" 时快照无 params 键，schemaVersion 仍是 2", () => {
    const params: ParamSpec[] = [
      { name: "address", type: "string", value: "", default: "" },
      { name: "type", type: "menu", value: GEO, default: GEO },
      { name: PORT_PARAM, type: "menu", value: "", default: "" },
    ];
    const snap = buildGraphSnapshot([snapNode({ kind: "output", params })], [], { k: 1, x: 0, y: 0 });
    expect((snap as { schemaVersion: number }).schemaVersion).toBe(2);
    expect(Object.keys(firstNodeEntry(snap))).toEqual(["id", "kind", "label", "baseLabel", "flags", "x", "y"]);
  });

  it("只填了 port（address 仍空）→ port 被输出，schemaVersion 升到 4", () => {
    const params: ParamSpec[] = [
      { name: "address", type: "string", value: "", default: "" },
      { name: "type", type: "menu", value: GEO, default: GEO },
      { name: PORT_PARAM, type: "menu", value: "out2", default: "" },
    ];
    const snap = buildGraphSnapshot([snapNode({ kind: "output", params })], [], { k: 1, x: 0, y: 0 });
    expect((snap as { schemaVersion: number }).schemaVersion).toBe(4);
    const kept = firstNodeEntry(snap).params as ParamSpec[];
    expect(kept.map((p) => p.name)).toEqual([PORT_PARAM]);
    expect(kept[0].value).toBe("out2");
  });

  it("address + port 都填 → 两项都输出，type=geo 仍被剔除", () => {
    const params: ParamSpec[] = [
      { name: "address", type: "string", value: "C1-abc-1234", default: "" },
      { name: "type", type: "menu", value: GEO, default: GEO },
      { name: PORT_PARAM, type: "menu", value: "out0", default: "" },
    ];
    const snap = buildGraphSnapshot(
      [snapNode({ kind: "output", params, address: "C1-abc-1234" })],
      [],
      { k: 1, x: 0, y: 0 },
    );
    const kept = firstNodeEntry(snap).params as ParamSpec[];
    expect(kept.map((p) => p.name)).toEqual(["address", PORT_PARAM]);
    expect(firstNodeEntry(snap).address).toBe("C1-abc-1234");
  });

  it("非 input/output 的参数不受影响（transform 名叫 port 的参数照常输出）", () => {
    const params: ParamSpec[] = [{ name: PORT_PARAM, type: "menu", value: "", default: "" }];
    const snap = buildGraphSnapshot(
      [snapNode({ kind: "transform", label: "transform1", baseLabel: "transform", params })],
      [],
      { k: 1, x: 0, y: 0 },
    );
    expect((firstNodeEntry(snap).params as ParamSpec[]).map((p) => p.name)).toEqual([PORT_PARAM]);
  });
});

describe("恢复路径补全 port（老 schema-4 图没有这个参数）", () => {
  it("params 只有 address/type 的老图 → 补出 port=\"\"", () => {
    const n = restoreNodeForKind(
      {
        kind: "output",
        params: [
          { name: "address", type: "string", value: "C1-old-0001" },
          { name: "type", type: "menu", value: GEO },
        ],
      },
      false,
    ) as CylNode;
    expect(paramNames(n)).toEqual(["address", "type", PORT_PARAM]);
    expect(paramValue(n, PORT_PARAM)).toBe("");
    expect(paramValue(n, "address")).toBe("C1-old-0001");
  });

  it("完全没有 params 的老图 → 三参数全默认补齐", () => {
    const n = restoreNodeForKind({ kind: "input" }, false) as CylNode;
    expect(paramNames(n)).toEqual(["address", "type", PORT_PARAM]);
    expect(paramValue(n, PORT_PARAM)).toBe("");
  });

  it("快照里带 port → 原样读回；非法值（数字）→ 落回 \"\"，不抛", () => {
    const ok = restoreNodeForKind(
      { kind: "output", params: [{ name: PORT_PARAM, type: "menu", value: "transform1/tx" }] },
      false,
    ) as CylNode;
    expect(paramValue(ok, PORT_PARAM)).toBe("transform1/tx");
    const bad = restoreNodeForKind(
      { kind: "output", params: [{ name: PORT_PARAM, type: "menu", value: 7 }] },
      false,
    ) as CylNode;
    expect(paramValue(bad, PORT_PARAM)).toBe("");
  });

  it("旧 4 端口形态（legacyPorts 默认）不被补参数", () => {
    const legacy = restoreNodeForKind({ kind: "output" }) as CylNode;
    expect(legacy.params).toBeUndefined();
    expect(Object.keys(legacy.inputs)).toEqual(["out0", "out1", "out2", "out3"]);
  });

  it("补全 → 序列化往返字节稳定（补回来的默认值又被剔掉）", () => {
    const n = restoreNodeForKind(
      { kind: "output", params: [{ name: "address", type: "string", value: "C1-x-1" }] },
      false,
    ) as CylNode;
    const snap = buildGraphSnapshot(
      [snapNode({ kind: "output", params: n.params, address: n.address })],
      [],
      { k: 1, x: 0, y: 0 },
    );
    expect((firstNodeEntry(snap).params as ParamSpec[]).map((p) => p.name)).toEqual(["address"]);
  });
});

// ---------------------------------------------------------------------------
// 重复输出端口检测（用户：「同一个序列号 out 的同一个端口不可重复, 否则报错」）
// ---------------------------------------------------------------------------

/** 造一个 output-like 节点字面量（findDuplicateOutputPorts 是结构化接收）。 */
function out(id: string, address: string, port: string, label = id) {
  return {
    id,
    kind: "output" as NodeKind,
    label,
    params: [
      { name: "address", value: address },
      { name: PORT_PARAM, value: port },
    ],
  };
}

describe("findDuplicateOutputPorts（纯谓词）", () => {
  it("同 serial 同 port → 冲突，**两个节点都被列出**", () => {
    const errs = findDuplicateOutputPorts([
      out("a", "C1-aaa-1111", "out0", "_output_"),
      out("b", "C1-aaa-1111", "out0", "_output_2"),
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0].nodeIds.sort()).toEqual(["a", "b"]);
    expect(errs[0].serial).toBe("C1-aaa-1111");
    expect(errs[0].port).toBe("out0");
    // 消息里必须点名两个节点，用户才知道是哪两个撞了。
    expect(errs[0].message).toContain("_output_");
    expect(errs[0].message).toContain("_output_2");
  });

  it("三个撞同一个端口 → 一条错误，三个 id 全在里面", () => {
    const errs = findDuplicateOutputPorts([
      out("a", "S1", "out1"),
      out("b", "S1", "out1"),
      out("c", "S1", "out1"),
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0].nodeIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("serial 不同 → 无冲突", () => {
    expect(findDuplicateOutputPorts([out("a", "S1", "out0"), out("b", "S2", "out0")])).toEqual([]);
  });

  it("port 不同 → 无冲突", () => {
    expect(findDuplicateOutputPorts([out("a", "S1", "out0"), out("b", "S1", "out1")])).toEqual([]);
  });

  it("address 为空 → 跳过（填写中间态不是错误）", () => {
    expect(findDuplicateOutputPorts([out("a", "", "out0"), out("b", "", "out0")])).toEqual([]);
  });

  it("port 为空 → 跳过（地址填了还没选端口，正常）", () => {
    expect(findDuplicateOutputPorts([out("a", "S1", ""), out("b", "S1", "")])).toEqual([]);
  });

  it("input 侧同 serial 同 port 不报错（读没有写冲突）", () => {
    const ins = [
      { ...out("a", "S1", "in0"), kind: "input" as NodeKind },
      { ...out("b", "S1", "in0"), kind: "input" as NodeKind },
    ];
    expect(findDuplicateOutputPorts(ins)).toEqual([]);
  });

  it("旧 4 端口 _output_（无 params）不参与判定，也不抛", () => {
    const legacy = { id: "L", kind: "output" as NodeKind, label: "_output_" };
    expect(findDuplicateOutputPorts([legacy, legacy, out("a", "S1", "out0")])).toEqual([]);
  });

  it("非字符串 params 值 → 视为空 → 跳过（防御式，不抛）", () => {
    const weird = {
      id: "w",
      kind: "output" as NodeKind,
      params: [{ name: "address", value: 42 }, { name: PORT_PARAM, value: null }],
    };
    expect(findDuplicateOutputPorts([weird, weird])).toEqual([]);
  });

  it("空数组 / 无 output 节点 → []", () => {
    expect(findDuplicateOutputPorts([])).toEqual([]);
    expect(findDuplicateOutputPorts([{ id: "t", kind: "transform" as NodeKind }])).toEqual([]);
  });

  it("真实节点（makeOutputNode）也能直接喂进去", () => {
    const a = makeOutputNode(true);
    const b = makeOutputNode(true);
    for (const n of [a, b]) {
      n.params = [
        { name: "address", type: "string", value: "C1-real-9" },
        { name: "type", type: "menu", value: GEO },
        { name: PORT_PARAM, type: "menu", value: "out3" },
      ];
    }
    const errs = findDuplicateOutputPorts([a, b]);
    expect(errs).toHaveLength(1);
    expect(errs[0].nodeIds.sort()).toEqual([a.id, b.id].sort());
  });
});

describe("duplicateOutputPortsToNodeErrors（→ NodeErrorMap）", () => {
  it("冲突组内每个 id 都拿到一条 error，port 标在图内 socket out0 上", () => {
    const errs = findDuplicateOutputPorts([out("a", "S1", "out2"), out("b", "S1", "out2")]);
    const map = duplicateOutputPortsToNodeErrors(errs);
    expect(Object.keys(map).sort()).toEqual(["a", "b"]);
    for (const id of ["a", "b"]) {
      expect(map[id]).toHaveLength(1);
      expect(map[id][0].severity).toBe("error");
      // 图内单端口 _output_ 的 socket 恒为 out0；冲突的 capabilities key 在 message 里。
      expect(map[id][0].port).toBe("out0");
      expect(map[id][0].source).toBe("duplicate-output-port");
      expect(map[id][0].message).toContain("out2");
    }
  });

  it("空输入 → 空表（无错误时不产生任何键）", () => {
    expect(duplicateOutputPortsToNodeErrors([])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Tab 面板建节点（makePaletteNode = 面板 create() 的决策单源）
//
// 为什么不直接驱动 attachTabSearch：它要 DOM（overlay/input/listener），而 web 的 vitest
// environment 是 "node"（vite.config.ts），且 graph-interact 经 NodeView 传递依赖到
// graph.ts/three。决策已被抽到 graph-model，这里测的就是面板真正调用的那一个函数。
// ---------------------------------------------------------------------------

describe("makePaletteNode（Tab 面板新建）", () => {
  it("input/output 可创建，且是**单端口 + 三参数**形态（修复用户报的 bug）", () => {
    const i = makePaletteNode("input");
    const o = makePaletteNode("output");
    expect(i).not.toBeNull();
    expect(o).not.toBeNull();
    expect(Object.keys(i!.outputs)).toEqual(["in0"]);
    expect(Object.keys(o!.inputs)).toEqual(["out0"]);
    expect(paramNames(i!)).toEqual(["address", "type", PORT_PARAM]);
    expect(paramNames(o!)).toEqual(["address", "type", PORT_PARAM]);
  });

  it("连续建 3 个 input + 3 个 output → 6 个标签互不相同", async () => {
    const editor = new NodeEditor<Schemes>();
    for (let k = 0; k < 3; k += 1) {
      for (const kind of ["input", "output"] as NodeKind[]) {
        const taken = new Set(editor.getNodes().map((x) => (x as CylNode).label));
        const n = makePaletteNode(kind, taken);
        expect(n).not.toBeNull();
        await editor.addNode(n!);
      }
    }
    const labels = (editor.getNodes() as CylNode[]).map((n) => n.label);
    expect(labels).toHaveLength(6);
    expect(new Set(labels).size).toBe(6);
    expect((editor.getNodes() as CylNode[]).filter((n) => n.kind === "input")).toHaveLength(3);
    expect((editor.getNodes() as CylNode[]).filter((n) => n.kind === "output")).toHaveLength(3);
  });

  it("taken 里已有该标签 → 重取直到不撞（dedup-by-label 行为保留）", () => {
    const first = makePaletteNode("input")!;
    const second = makePaletteNode("input", new Set([first.label]))!;
    expect(second.label).not.toBe(first.label);
  });

  it("null/transform/geo 仍照旧可建（未回归）", () => {
    expect(makePaletteNode("null")?.kind).toBe("null");
    expect(makePaletteNode("transform")?.kind).toBe("transform");
    const geo = makePaletteNode("geo");
    expect(geo?.kind).toBe("geo");
    expect(geo?.netKind).toBe("obj"); // geo 活在 obj 层
  });

  it("project/channel 不可建 → null（面板本就不列它们）", () => {
    expect(makePaletteNode("project")).toBeNull();
    expect(makePaletteNode("channel")).toBeNull();
  });
});
