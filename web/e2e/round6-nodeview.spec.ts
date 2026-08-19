import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";
import { gotoMember } from "./fixtures";

/**
 * Round 6 integrated E2E (nodeview core write-set).
 * - transform display resolves its routed _input_ source THROUGH passthrough
 *   chains (resolveInputSourcePort): direct in0 feed shows input0; a chain
 *   input.in1 -> nullA -> transform.in0 shows input1; a display transform with
 *   no in0 connection hides every input port; _input_ display keeps showing
 *   input0. getSelectedNode() resolves the same chain (spreadsheet focus).
 * - rename: double-click hit zone shrinks to the title span (flex no longer
 *   stretches across the header) and names > 20 chars ellipsize in the title
 *   while the rename input still edits the full name.
 * Self-contained: beforeAll pushes the canonical fixture; every test restores
 * its own graph in-browser; afterAll restores the canonical fixture on disk.
 */
const client = new BridgeClient();
let serial = "";

/** Canonical 4-input fixture (input0 = the 4-pt square). */
const CANONICAL_INPUTS = [
  { index: 0, name: "in0", pointCount: 4, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]], curves: [{ pointIndices: [0,1,2,3], widths: null }], faces: [[0,1,2,3]], attributes: {} },
  { index: 1, name: "in1", pointCount: 3, primCount: 1, points: [[0,0,0],[1,0,0],[0,1,0]], curves: [{ pointIndices: [0,1,2], widths: null }], faces: [], attributes: {} },
  { index: 2, name: "in2", pointCount: 5, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0.5,0.5,1]], curves: [{ pointIndices: [0,1,2,3,4], widths: null }], faces: [], attributes: {} },
  { index: 3, name: "in3", pointCount: 2, primCount: 1, points: [[0,0,0],[1,0,0]], curves: [{ pointIndices: [0,1], widths: null }], faces: [], attributes: {} },
];

/** Canonical 7-connection graph (same fixture as round2/round3/round4/round5). */
const CANONICAL_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "i", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "n1", kind: "null", label: "null1", baseLabel: "null", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 300, y: 40 },
    { id: "n2", kind: "null", label: "null2", baseLabel: "null", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 300, y: 200 },
    { id: "n3", kind: "null", label: "null3", baseLabel: "null", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 300, y: 360 },
    { id: "o", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 560, y: 80 },
  ],
  connections: [
    { source: "i", sourceOutput: "in0", target: "o", targetInput: "out0" },
    { source: "i", sourceOutput: "in1", target: "n1", targetInput: "in0" },
    { source: "i", sourceOutput: "in2", target: "n2", targetInput: "in0" },
    { source: "i", sourceOutput: "in3", target: "n3", targetInput: "in0" },
    { source: "n1", sourceOutput: "out0", target: "o", targetInput: "out1" },
    { source: "n2", sourceOutput: "out0", target: "o", targetInput: "out2" },
    { source: "n3", sourceOutput: "out0", target: "o", targetInput: "out3" },
  ],
};

/** input -> transform1 (DISPLAYED, fed directly from input.in0) -> output. */
const DIRECT_TF_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: true, bypass: false, freeze: false, reference: false }, params: [
      { name: "tx", type: "float", value: 0 }, { name: "ty", type: "float", value: 0 }, { name: "tz", type: "float", value: 0 },
      { name: "px", type: "float", value: 0 }, { name: "py", type: "float", value: 0 }, { name: "pz", type: "float", value: 0 },
      { name: "group", type: "string", value: "" }, { name: "class", type: "string", value: "autoguess" },
    ], x: 300, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 560, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in0", target: "tf", targetInput: "in0" },
    { source: "tf", sourceOutput: "out0", target: "out", targetInput: "out0" },
  ],
};

/** input.in1 -> nullA -> transform1 (DISPLAYED) -> output: chain resolution. */
const CHAIN_TF_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "nA", kind: "null", label: "nullA", baseLabel: "null", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 300, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: true, bypass: false, freeze: false, reference: false }, params: [
      { name: "tx", type: "float", value: 0 }, { name: "ty", type: "float", value: 0 }, { name: "tz", type: "float", value: 0 },
      { name: "px", type: "float", value: 0 }, { name: "py", type: "float", value: 0 }, { name: "pz", type: "float", value: 0 },
      { name: "group", type: "string", value: "" }, { name: "class", type: "string", value: "autoguess" },
    ], x: 480, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 640, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in1", target: "nA", targetInput: "in0" },
    { source: "nA", sourceOutput: "out0", target: "tf", targetInput: "in0" },
    { source: "tf", sourceOutput: "out0", target: "out", targetInput: "out0" },
  ],
};

/** transform1 (DISPLAYED) with NO in0 connection: nothing routed -> hide all. */
const DISCONNECTED_TF_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: true, bypass: false, freeze: false, reference: false }, params: [
      { name: "tx", type: "float", value: 0 }, { name: "ty", type: "float", value: 0 }, { name: "tz", type: "float", value: 0 },
      { name: "px", type: "float", value: 0 }, { name: "py", type: "float", value: 0 }, { name: "pz", type: "float", value: 0 },
      { name: "group", type: "string", value: "" }, { name: "class", type: "string", value: "autoguess" },
    ], x: 300, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 560, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in0", target: "out", targetInput: "out0" },
  ],
};

/** _input_ (DISPLAYED) directly -> output: source display shows input0. */
const INPUT_DISPLAY_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 560, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in0", target: "out", targetInput: "out0" },
  ],
};

test.beforeAll(async () => {
  const bridgeOk = await client.health().then(() => true).catch(() => false);
  test.skip(!bridgeOk, "bridge not running on 127.0.0.1:8375");
  const serials = await client.listSerials();
  serial = process.env.CYL1NDER_E2E_SERIAL || serials.find((s) => s === "C1-e2etest0001-aaaa") || serials[serials.length - 1] || "";
  test.skip(!serial, "no serial registered in bridge");
  await client.pushInputs(serial, CANONICAL_INPUTS as never, { nodePath: "/obj/test/Cyl1nder1", label: "Cyl1nder1" });
});

test.afterAll(async () => {
  if (!serial) return;
  try {
    await client.pushInputs(serial, CANONICAL_INPUTS as never, { nodePath: "/obj/test/Cyl1nder1", label: "Cyl1nder1" });
    await client.putSnapshot(serial, { graph: CANONICAL_GRAPH });
  } catch {
    /* fixture restore best-effort */
  }
});

async function openGraph(page: import("@playwright/test").Page): Promise<void> {
  await gotoMember(page, serial);
  await expect(page.locator(".cyl-graph .cyl-rp-title").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".cyl-status")).toHaveClass(/ok/, { timeout: 15000 });
}

/** Restore a graph in-browser (plain JSON: no functions across evaluate). */
async function restoreGraph(page: import("@playwright/test").Page, g: unknown, conns: number): Promise<void> {
  await page.evaluate(async (graph) => {
    const g: any = (window as any).__cylGraph;
    await g.restoreGraph(JSON.parse(JSON.stringify(graph)));
  }, g);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylGraph.editor.getConnections().length), { timeout: 15000 })
    .toBe(conns);
}

/** Per-port visibility of the viewport input group (input0..input3). */
async function inputPortVisibility(page: import("@playwright/test").Page): Promise<boolean[]> {
  return page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const vis: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const g = v.scene.getObjectByName("input" + i);
      vis.push(!!g && g.visible);
    }
    return vis;
  });
}

/** Display port index resolved by the graph (null when unresolved). */
function displayPortIndex(page: import("@playwright/test").Page): Promise<number | null> {
  return page.evaluate(() => (window as any).__cylGraph.getDisplayPortIndex());
}
/** True when the viewport is showing a displayed node's computed result geometry (Round 7). */
async function nodeResultVisible(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const g = v.scene.getObjectByName("cyl-node-result");
    return !!g && g.visible && g.children.length > 0;
  });
}


test("transform display: direct input.in0 feed shows input0 (box visible)", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page, DIRECT_TF_GRAPH, 2);
  // source ports hidden; the computed node result geometry is shown instead (Round 7)
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);
  expect(await nodeResultVisible(page)).toBe(true);
  expect(await displayPortIndex(page)).toBe(0);

  // getSelectedNode() resolves the same direct port (spreadsheet focus)
  const port = await page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    const tf = g.editor.getNodes().find((n: any) => n.kind === "transform");
    tf.selected = true;
    return g.getSelectedNode().port;
  });
  expect(port).toBe(0);
});

test("transform display: input.in1 -> nullA -> transform chain resolves to input1", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page, CHAIN_TF_GRAPH, 3);
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);
  expect(await nodeResultVisible(page)).toBe(true);
  expect(await displayPortIndex(page)).toBe(1);

  // getSelectedNode() follows the chain too (was null before resolveInputSourcePort)
  const port = await page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    const tf = g.editor.getNodes().find((n: any) => n.kind === "transform");
    tf.selected = true;
    return g.getSelectedNode().port;
  });
  expect(port).toBe(1);
});

test("transform display: no in0 connection hides every input port", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page, DISCONNECTED_TF_GRAPH, 1);
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);
  expect(await displayPortIndex(page)).toBeNull();
});

test("input node display: still shows input0 (regression)", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page, INPUT_DISPLAY_GRAPH, 1);
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([true, false, false, false]);
});

test("rename: double-click hit zone shrinks to the title; long names ellipsize", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page, CANONICAL_GRAPH, 7);

  const node = page.locator(".cyl-rp-node", { hasText: "_input_" }).first();
  const title = node.locator(".cyl-rp-title").first();
  await expect(title).toBeVisible({ timeout: 15000 });

  // title span flex no longer stretches across the header
  const before = await title.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { flexGrow: cs.flexGrow, textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace, width: el.getBoundingClientRect().width, nodeWidth: el.closest(".cyl-rp-node")!.getBoundingClientRect().width };
  });
  expect(before.flexGrow).toBe("0");
  expect(before.textOverflow).toBe("ellipsis");
  expect(before.width).toBeLessThan(before.nodeWidth * 0.6); // not撑满 the top

  // double-click on the TITLE opens the rename input
  await title.dblclick({ timeout: 10000 });
  const rename = page.locator(".cyl-rp-rename");
  await expect(rename).toBeVisible({ timeout: 10000 });

  // rename input still edits the FULL name (no max-width ellipsis on input)
  const longName = "very_long_node_name_that_exceeds_20_chars";
  await rename.fill(longName);
  await expect(rename).toHaveValue(longName);
  await rename.press("Enter");
  await expect(rename).not.toBeVisible({ timeout: 10000 });

  // rendered title ellipsizes: scrollWidth > clientWidth + overflow hidden
  const longTitle = page.locator(".cyl-rp-title", { hasText: longName }).first();
  await expect(longTitle).toBeVisible({ timeout: 10000 });
  const after = await longTitle.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      flexGrow: cs.flexGrow,
      textOverflow: cs.textOverflow,
      overflowX: cs.overflowX,
      whiteSpace: cs.whiteSpace,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      width: el.getBoundingClientRect().width,
      nodeWidth: el.closest(".cyl-rp-node")!.getBoundingClientRect().width,
    };
  });
  expect(after.flexGrow).toBe("0");
  expect(after.textOverflow).toBe("ellipsis");
  expect(after.overflowX).toBe("hidden");
  expect(after.whiteSpace).toBe("nowrap");
  expect(after.scrollWidth).toBeGreaterThan(after.clientWidth);
  expect(after.width).toBeLessThan(after.nodeWidth * 0.9);

  // double-click on the header's EMPTY area (not the title) must NOT rename
  const blank = await page.evaluate((lbl) => {
    const nodeEl = Array.from(document.querySelectorAll(".cyl-rp-node")).find((e) => e.textContent?.includes(lbl));
    if (!nodeEl) return null;
    const head = nodeEl.querySelector(".cyl-rp-head");
    if (!head) return null;
    const hr = head.getBoundingClientRect();
    const kids = Array.from(head.children).map((c) => c.getBoundingClientRect());
    for (let y = hr.top + 3; y < hr.bottom - 3; y += 2) {
      for (let x = hr.left + 3; x < hr.right - 3; x += 2) {
        if (kids.some((k) => x >= k.left && x <= k.right && y >= k.top && y <= k.bottom)) continue;
        return { x, y };
      }
    }
    return null;
  }, longName);
  expect(blank).not.toBeNull();
  await page.mouse.dblclick(blank!.x, blank!.y);
  await page.waitForTimeout(300);
  expect(await page.locator(".cyl-rp-rename").count()).toBe(0);
});
