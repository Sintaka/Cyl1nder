import { describe, expect, it } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import {
  getNetworkSnapshot,
  makeInputNode,
  makeOutputNode,
  makeTransformNode,
  setConnectionWaypoint,
  type CylNode,
  type Schemes,
} from "../src/nodes2/graph-model";
import { computeOutputs, traceChainSpecs } from "../src/nodes2/network";
import type { NetworkSnapshot } from "../src/nodes2/network";
import type { InputPayload } from "../src/protocol/types";

/**
 * waypoint 必须是**纯装饰件**：给某条连接挂上路径中点，cook 结果与拓扑签名都不许动。
 *
 * 这条性质取代了旧的 "dot 是 cook-neutral" 测试。旧 dot 是真节点，插入要
 * 「删 1 连接 + 加 1 节点 + 加 2 连接」，于是它进入拓扑、需要 passthrough 特例，
 * 只能"事后"验证它恰好没改输出。waypoint 是连接自己的一个可选字段：拓扑本就
 * 一模一样，所以这里验证的是**结构层面的不可能出错**——
 *  1. getNetworkSnapshot 逐字节相同（连接的 waypoint 键根本不进 compute 快照）；
 *  2. computeOutputs 逐字节相同；
 *  3. traceChainSpecs 的 specs 一模一样 —— chain-cache 的 buildSig 只由 specs
 *     （nodeId/groupExpr/cls/positionDependent）构成，specs 不变即缓存身份不变。
 */
const mk = (i: number, pts: number[][]): InputPayload => ({
  index: i, name: `in${i}`, pointCount: pts.length, primCount: 0,
  points: pts, curves: [], faces: [], attributes: {},
});
const inputs = [mk(0, [[1, 2, 3], [4, 5, 6]]), mk(1, []), mk(2, []), mk(3, [])];

function conn(a: CylNode, ao: string, b: CylNode, bi: string): Schemes["Connection"] {
  return new ClassicPreset.Connection(a, ao, b, bi) as unknown as Schemes["Connection"];
}

/** input -> transform1 -> output（transform 保证 specs 非空，签名才有内容可比）。 */
async function buildGraph(): Promise<{
  editor: NodeEditor<Schemes>;
  connections: Schemes["Connection"][];
}> {
  const editor = new NodeEditor<Schemes>();
  const input = makeInputNode();
  const tx = makeTransformNode();
  const output = makeOutputNode();
  for (const n of [input, tx, output]) await editor.addNode(n);
  const c1 = conn(input, "in0", tx, "in0");
  const c2 = conn(tx, "out0", output, "out0");
  await editor.addConnection(c1);
  await editor.addConnection(c2);
  return { editor, connections: [c1, c2] };
}

function specsOf(snap: NetworkSnapshot): unknown {
  const out = snap.nodes.find((n) => n.kind === "output");
  const feeder = snap.connections.find((c) => c.target === out?.id);
  const src = snap.nodes.find((n) => n.id === feeder?.source);
  if (!src || !feeder) return null;
  const traced = traceChainSpecs(src, feeder.sourceOutput, inputs, snap, new Set());
  return traced?.specs ?? null;
}

describe("waypoint 是 cook-neutral 的纯装饰件", () => {
  it("挂 waypoint 前后 getNetworkSnapshot 逐字节一致（waypoint 不进 compute 快照）", async () => {
    const { editor, connections } = await buildGraph();
    const before = JSON.stringify(getNetworkSnapshot(editor));

    setConnectionWaypoint(connections[0], { x: 123.5, y: -45.25 });
    const after = JSON.stringify(getNetworkSnapshot(editor));

    expect(after).toBe(before);
  });

  it("挂 waypoint 前后 computeOutputs 逐字节一致", async () => {
    const { editor, connections } = await buildGraph();
    const plain = JSON.stringify(computeOutputs(inputs, getNetworkSnapshot(editor)));

    setConnectionWaypoint(connections[0], { x: 7, y: 8 });
    const withWp = JSON.stringify(computeOutputs(inputs, getNetworkSnapshot(editor)));

    expect(withWp).toBe(plain);
    // 且链路本身仍然通：4 路输出、首点为 transform 默认值(0平移)下的原值
    const outs = computeOutputs(inputs, getNetworkSnapshot(editor));
    expect(outs).toHaveLength(4);
    expect(outs[0].points?.[0]).toEqual([1, 2, 3]);
  });

  it("waypoint 不贡献 transform spec —— specs 不变即 chain-cache 签名不变", async () => {
    const { editor, connections } = await buildGraph();
    const before = JSON.stringify(specsOf(getNetworkSnapshot(editor)));

    setConnectionWaypoint(connections[0], { x: -1, y: 2 });
    setConnectionWaypoint(connections[1], { x: 3, y: -4 });
    const after = JSON.stringify(specsOf(getNetworkSnapshot(editor)));

    expect(after).toBe(before);
    // specs 里只有那一个 transform 节点：waypoint 没能挤进链路
    expect(JSON.parse(after as string)).toHaveLength(1);
  });

  it("删掉 waypoint 不改拓扑（连接数恒定，不可能留半截线）", async () => {
    const { editor, connections } = await buildGraph();
    const topo = () => getNetworkSnapshot(editor).connections.length;
    expect(topo()).toBe(2);

    setConnectionWaypoint(connections[0], { x: 5, y: 5 });
    expect(topo()).toBe(2); // 加装饰件不加连接（旧 dot 会变成 3）

    setConnectionWaypoint(connections[0], null);
    expect(topo()).toBe(2); // 删装饰件不减连接（旧 dot 删掉会留两截半线）
  });

  it("compute 快照的连接对象上不存在 waypoint 键", async () => {
    const { editor, connections } = await buildGraph();
    setConnectionWaypoint(connections[0], { x: 9, y: 9 });
    const snap = getNetworkSnapshot(editor);
    for (const c of snap.connections) {
      expect("waypoint" in (c as unknown as Record<string, unknown>)).toBe(false);
    }
  });
});
