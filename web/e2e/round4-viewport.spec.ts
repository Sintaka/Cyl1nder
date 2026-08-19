import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";
import { gotoMember, toggleSyncEnabled } from "./fixtures";

/**
 * Round 4 (viewport write-set): left icon toolbar + Enter node-edit activation.
 * - the toolbar renders on the viewport's left edge; its first icon is the Enter
 *   arrow that toggles "node viewport edit" mode.
 * - with a transform node selected, Enter attaches the translate gizmo at
 *   tx/ty/tz; a simulated gizmo drag updates the node params and pushes the
 *   translated outputs to the bridge; re-click / Esc exits the mode.
 * Self-contained: beforeAll pushes the canonical fixture; afterAll restores it.
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

/** Minimal input -> transform -> output graph (empty group = translate all points). */
const TRANSFORM_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: false, bypass: false, freeze: false, reference: false }, params: [
      { name: "tx", type: "float", value: 0 }, { name: "ty", type: "float", value: 0 }, { name: "tz", type: "float", value: 0 },
      { name: "group", type: "string", value: "" }, { name: "class", type: "string", value: "autoguess" },
    ], x: 400, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 560, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in0", target: "tf", targetInput: "in0" },
    { source: "tf", sourceOutput: "out0", target: "out", targetInput: "out0" },
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
  } catch {
    /* fixture restore best-effort */
  }
});

async function openGraph(page: import("@playwright/test").Page): Promise<void> {
  await gotoMember(page, serial);
  await expect(page.locator(".cyl-graph .cyl-rp-title").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".cyl-status")).toHaveClass(/ok/, { timeout: 15000 });
}

/** Restore the input -> transform -> output graph in-browser. */
async function restoreTransformGraph(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async (g) => {
    const graph: any = (window as any).__cylGraph;
    await graph.restoreGraph(JSON.parse(JSON.stringify(g)));
  }, TRANSFORM_GRAPH);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylGraph.editor.getConnections().length), { timeout: 15000 })
    .toBe(2);
}

async function bridgeOutputs(): Promise<{ index: number; points: number[][] }[]> {
  const res = await fetch(`http://127.0.0.1:8375/api/hda/${serial}/outputs`);
  const j = (await res.json()) as { outputs: { index: number; points: number[][] }[] };
  return j.outputs;
}

async function poll<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 8000, label = "state"): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (pred(v)) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${label}`);
}

test("viewport toolbar: Enter icon renders on the left edge and toggles enter-edit", async ({ page }) => {
  await openGraph(page);
  await restoreTransformGraph(page);

  // toolbar + first icon (Enter arrow)
  const toolbar = page.locator(".cyl-viewport-toolbar");
  await expect(toolbar).toBeVisible({ timeout: 15000 });
  const enterBtn = toolbar.locator(".cyl-tool-btn").first();
  await expect(enterBtn).toHaveAttribute("title", "Enter node viewport edit");
  await expect(enterBtn.locator("svg")).toBeVisible();

  // no transform selected -> enter mode activates with gizmo idle (Round 8)
  await enterBtn.click();
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(true);
  let gizmo = await page.evaluate(() => (window as any).__cylViewport.scene.getObjectByName("cyl-enter-gizmo"));
  expect(gizmo).toBeFalsy();

  // select the transform node -> gizmo rebinds (enter mode follows the selection)
  await page.locator(".cyl-rp-title", { hasText: /^transform\d+$/ }).first().click({ timeout: 15000 });
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(true);
  await expect(enterBtn).toHaveClass(/cyl-enter-on/);
  gizmo = await page.evaluate(() => (window as any).__cylViewport.scene.getObjectByName("cyl-enter-gizmo"));
  expect(gizmo).not.toBeNull();

  // re-click exits the mode
  await enterBtn.click();
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(false);
  await expect(enterBtn).not.toHaveClass(/cyl-enter-on/);
});

test("Enter edit: gizmo drag updates tx/ty/tz and pushes translated bridge outputs", async ({ page }) => {
  await openGraph(page);
  await toggleSyncEnabled(page, true); // v0.1.00101 起推桥需 sync ON
  await restoreTransformGraph(page);

  // select the transform node, then activate with the Enter KEY
  // (Enter only responds while hovering the viewport - Round 6)
  await page.locator(".cyl-rp-title", { hasText: /^transform\d+$/ }).first().click({ timeout: 15000 });
  await page.locator(".cyl-viewport canvas").hover();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(true);

  // simulate a translate drag: move the temp gizmo object, emit objectChange
  await page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const obj = v.scene.getObjectByName("cyl-enter-gizmo");
    if (!obj) throw new Error("enter gizmo object missing");
    obj.position.set(1.5, -0.25, 0.5);
    v.transform.dispatchEvent({ type: "objectChange" });
  });

  // transform node params follow the drag
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const g: any = (window as any).__cylGraph;
          const n = g.editor.getNodes().find((x: any) => x.kind === "transform");
          const p: Record<string, unknown> = {};
          for (const q of n.params) p[q.name] = q.value;
          return { tx: p.tx, ty: p.ty, tz: p.tz };
        }),
      { timeout: 10000 },
    )
    .toEqual({ tx: 1.5, ty: -0.25, tz: 0.5 });

  // bridge outputs translated by (1.5, -0.25, 0.5)
  const outs = await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0] - 1.5) < 1e-6;
    },
    10000,
    "translated outputs",
  );
  const out0 = outs.find((x) => x.index === 0)!;
  expect(out0.points[0]).toEqual([1.5, -0.25, 0.5]);
  expect(out0.points[1]).toEqual([2.5, -0.25, 0.5]);
  expect(out0.points[2]).toEqual([2.5, 0.75, 0.5]);
  expect(out0.points[3]).toEqual([1.5, 0.75, 0.5]);

  // Esc exits the mode
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(false);
});