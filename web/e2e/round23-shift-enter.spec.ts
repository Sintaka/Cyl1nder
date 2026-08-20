import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";
import { gotoMember } from "./fixtures";

/** 4 路几何输入：让这个 serial 在桥里**真有能力清单**（in0..in3 / out0..out3）。
 *  不推的话 `cachedPorts` 拿到空清单，规划器会**如实拒绝**（"port in0 has no counterpart"）——
 *  那是正确行为，但会让本 spec 测了个空（我第一版就是这样，靠 wired>0 那条断言才发现）。 */
const CANONICAL_INPUTS = [
  { index: 0, name: "in0", pointCount: 2, primCount: 1, points: [[0, 0, 0], [1, 0, 0]], curves: [{ pointIndices: [0, 1], widths: null }], faces: [], attributes: {} },
  { index: 1, name: "in1", pointCount: 2, primCount: 1, points: [[0, 0, 0], [0, 1, 0]], curves: [{ pointIndices: [0, 1], widths: null }], faces: [], attributes: {} },
];

/**
 * Shift+Enter 的**破坏性**回归：镜像时绝不移动用户已摆好的节点（v0.1.00144）。
 *
 * 为什么必须常驻：这条危险来自 rete 的 selectableNodes 管道 ——
 * `area.translate(id)` 会发 `nodetranslated`，若该 id 是**被 pick 的**节点，
 * 选择器会把**其余所有选中节点**按同一位移一起搬走
 * （rete-area-plugin：translate 发事件 → selectableNodes 捕获 → selector.translate）。
 * 而 `accumulateOnCtrl()`（graph.ts:689）意味着 Ctrl+click **既 pick 又累加** ——
 * 于是"窗口路径"下用户 Ctrl 点中的那个 `_output_` 正是被 pick 的那个，
 * 一次镜像就能把他排好的全部 `_input_` 拖散。
 *
 * 修法是 `layout` 显式分流：palette 路径 true（节点刚 addNode、位置还没人选过，
 * 本就该摆），窗口路径 false（位置是用户选的，我们无权动）。
 * 子智能体是**读 rete 源码**得出这个结论的，没有执行过 —— 所以这里用真实浏览器钉住它。
 */
const SERIAL = "C1-e2eshent-001a";

/** 读所有节点的画布坐标（rete 把它存在 area.nodeViews 上）。 */
async function positions(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const w = window as never as {
      __cylGraph: {
        editor: { getNodes(): Array<{ id: string; label: string }> };
        area: { nodeViews: Map<string, { position: { x: number; y: number } }> };
      };
    };
    const out: Record<string, { x: number; y: number }> = {};
    for (const n of w.__cylGraph.editor.getNodes()) {
      const v = w.__cylGraph.area.nodeViews.get(n.id);
      if (v) out[n.label] = { x: Math.round(v.position.x), y: Math.round(v.position.y) };
    }
    return out;
  });
}

/** 建两个 `_input_` + 两个 `_output_`，都填好 serial/port，位置由夹具指定。 */
async function buildTwoByTwo(page: import("@playwright/test").Page) {
  const flags = { display: false, bypass: false, freeze: false, reference: false };
  const P = (name: string, value: unknown) => ({ name, type: "string", value });
  const io = (id: string, kind: "input" | "output", label: string, x: number, y: number, port: string) => ({
    id,
    kind,
    label,
    baseLabel: kind === "input" ? "_input_" : "_output_",
    flags,
    x,
    y,
    // `geo` 而不是 `float`：我推的是**几何**端口（in0..in1），端口类型由 serial 的真实
    // 能力清单派生，不由这个参数决定。第一版写 float，于是 input 侧是 float、output 侧
    // 被派生成 geo，`canConnectSockets` 正确地拒了跨族连线 —— 夹具自相矛盾，不是功能有错。
    params: [P("address", SERIAL), P("type", "geo"), P("port", port)],
  });
  await page.evaluate(
    async (snapshot) => {
      const w = window as never as { __cylGraph: { restoreGraph(d: unknown): Promise<void> } };
      await w.__cylGraph.restoreGraph(snapshot);
    },
    {
      schemaVersion: 5,
      viewport: { k: 1, x: 0, y: 0 },
      nodes: [
        io("se_i1", "input", "_input_", 40, 40, "in0"),
        io("se_i2", "input", "_input_2", 40, 200, "in1"),
        io("se_o1", "output", "_output_", 600, 400, "out0"),
        io("se_o2", "output", "_output_2", 600, 560, "out1"),
      ],
      connections: [],
    },
  );
}

test.beforeAll(async () => {
  const client = new BridgeClient();
  const ok = await client.health().then(() => true).catch(() => false);
  test.skip(!ok, "bridge not running on 127.0.0.1:8375");
  // 推一次输入 -> 该 serial 有了真实端口清单，Shift+Enter 才有东西可配对。
  await client.pushInputs(SERIAL, CANONICAL_INPUTS as never, {
    nodePath: "/obj/test/Cyl1nder1",
    label: "Cyl1nder1",
  });
});

test("窗口路径：Shift+Enter 镜像时**不移动**任何已摆好的节点", async ({ page }) => {
  await gotoMember(page, SERIAL);
  await expect(page.locator(".cyl-graph")).toBeVisible({ timeout: 20000 });
  await buildTwoByTwo(page);
  await page.waitForTimeout(400);

  const before = await positions(page);
  expect(Object.keys(before).sort()).toEqual(["_input_", "_input_2", "_output_", "_output_2"]);

  // 选中两个 input + 两个 output，并**显式 pick 一个 output**（Ctrl+click 的真实效果：
  // 既 pick 又累加）。pick 是那条危险的触发条件，不模拟它就测不到东西。
  await page.evaluate(() => {
    const w = window as never as {
      __cylGraph: {
        editor: { getNodes(): Array<{ id: string; kind: string; selected?: boolean }> };
        selectable?: { select(id: string, accumulate: boolean): void };
      };
    };
    const ns = w.__cylGraph.editor.getNodes();
    for (const n of ns) n.selected = n.kind === "input" || n.kind === "output";
    // selectable 若暴露就走它（真实 pick 路径）；否则退回 selected 标记。
    const sel = w.__cylGraph.selectable;
    if (sel) {
      for (const n of ns.filter((x) => x.kind === "input")) sel.select(n.id, true);
      for (const n of ns.filter((x) => x.kind === "output")) sel.select(n.id, true);
    }
  });
  await page.waitForTimeout(200);

  await page.locator(".cyl-graph").click({ position: { x: 6, y: 6 }, force: true });
  await page.keyboard.press("Shift+Enter");
  await page.waitForTimeout(1200);

  const after = await positions(page);
  // **一个坐标都不许变**：layout=false 意味着窗口路径根本不调 area.translate。
  expect(after).toEqual(before);

  const res = await page.evaluate(() => {
    const w = window as never as {
      __cylGraph: { editor: { getConnections(): unknown[] } };
      __cylStore?: { logs?: string[] };
    };
    return {
      wired: w.__cylGraph.editor.getConnections().length,
      logs: (w.__cylStore?.logs ?? []).filter((l) => /shift\+enter/i.test(l)).slice(-4),
    };
  });
  console.log("SE-LOGS " + JSON.stringify(res.logs));
  // 而且它确实干了活（否则"没移动"是因为什么都没做，等于测了个空）
  expect(res.wired).toBeGreaterThan(0);
});
