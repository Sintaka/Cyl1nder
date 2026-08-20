import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";
import { gotoMember, toggleSyncEnabled } from "./fixtures";

/**
 * Round 16 (viewport undo write-set): gizmo drags of transform params are ONE
 * undo step (not three float steps). main.ts captures the node's full params at
 * gizmo-bind time (dragBefore), updates dragAfter per frame, and on drag end
 * pushes a single { type: "params" } undo entry - identical for Auto Update and
 * On Mouse Up. Ctrl+Z under the viewport (non-input) reverts the whole drag in
 * one step; a second Ctrl+Z is a no-op (proves exactly one stack entry).
 * Also covers the new group undo (pushUndoGroup): a batch of param edits on one
 * node reverts to the pre-batch state with a single Ctrl+Z.
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
const ORIGIN_OUT0 = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];

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
  serial = process.env.CYL1NDER_E2E_SERIAL || "C1-e2etest0001-aaaa";
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

/** Restore the input -> transform -> output graph in-browser (undo stack is fresh). */
async function restoreTransformGraph(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async (g) => {
    const graph: any = (window as any).__cylGraph;
    await graph.restoreGraph(JSON.parse(JSON.stringify(g)));
  }, TRANSFORM_GRAPH);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylGraph.editor.getConnections().length), { timeout: 15000 })
    .toBe(2);
}

/** Enter-edit the transform node via the left toolbar (gizmo bound at its params). */
async function enterTransformEdit(page: import("@playwright/test").Page): Promise<void> {
  await page.locator(".cyl-rp-title", { hasText: /^transform\d+$/ }).first().click({ timeout: 15000 });
  await page.locator(".cyl-viewport-toolbar .cyl-tool-btn").first().click();
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(true);
  const gizmo = await page.evaluate(() => (window as any).__cylViewport.scene.getObjectByName("cyl-enter-gizmo"));
  expect(gizmo).not.toBeNull();
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

/** Live transform node tx/ty/tz. */
async function nodeParams(page: import("@playwright/test").Page): Promise<{ tx: number; ty: number; tz: number }> {
  return page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    const n = g.editor.getNodes().find((x: any) => x.kind === "transform");
    const p: Record<string, unknown> = {};
    for (const q of n.params) p[q.name] = q.value;
    return { tx: p.tx as number, ty: p.ty as number, tz: p.tz as number };
  });
}

/** Count undo/redo param applications observed in the shared log store: each
 *  { type: "params" } entry logs "[node] <direction> params on <label>" exactly
 *  once per stack entry (a single gizmo drag = exactly one such entry). */
async function undoLogCount(page: import("@playwright/test").Page, direction: "undo" | "redo"): Promise<number> {
  return page.evaluate((dir) => {
    const store: any = (window as any).__cylStore;
    return store.logs.filter((m: string) => m.includes(`[node] ${dir} params on`)).length;
  }, direction);
}

/** Simulate gizmo drag frames + release (the same events TransformControls emits). */
async function dragGizmoTo(page: import("@playwright/test").Page, pos: [number, number, number]): Promise<void> {
  await page.evaluate(([x, y, z]) => {
    const v: any = (window as any).__cylViewport;
    const obj = v.scene.getObjectByName("cyl-enter-gizmo");
    if (!obj) throw new Error("enter gizmo object missing");
    obj.position.set(x, y, z);
    v.transform.dispatchEvent({ type: "objectChange" });
  }, pos);
}

async function releaseGizmo(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    v.transform.dispatchEvent({ type: "dragging-changed", value: false });
  });
}

test("Auto Update: multi-frame gizmo drag = ONE undo entry; Ctrl+Z reverts the whole drag", async ({ page }) => {
  await openGraph(page);
  await toggleSyncEnabled(page, true); // v0.1.00101 起推桥需 sync ON
  await restoreTransformGraph(page);
  await expect(page.locator(".cyl-bottom-bar .cyl-dd .cyl-menu-layout-name")).toHaveText("Auto Update");
  await enterTransformEdit(page);

  // multi-frame drag: several objectChange events -> live params + bridge outputs
  await dragGizmoTo(page, [1.5, -0.25, 0.5]);
  await dragGizmoTo(page, [2.5, 0.5, 0.75]);
  await expect.poll(() => nodeParams(page), { timeout: 10000 }).toMatchObject({ tx: 2.5, ty: 0.5, tz: 0.75 });
  await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0] - 2.5) < 1e-6;
    },
    10000,
    "auto translated outputs",
  );
  // still no undo entry while dragging (nothing released yet)
  expect(await undoLogCount(page, "undo")).toBe(0);

  // release -> the drag session commits as exactly ONE undo entry
  await releaseGizmo(page);

  // Ctrl+Z under the viewport (non-input) -> one step back to the pre-drag pose
  await page.locator(".cyl-viewport canvas").hover();
  await page.keyboard.press("Control+z");
  await expect.poll(() => nodeParams(page), { timeout: 10000 }).toMatchObject({ tx: 0, ty: 0, tz: 0 });
  await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0]) < 1e-6 && Math.abs(out0.points[0][1]) < 1e-6;
    },
    10000,
    "undo reverted outputs",
  );
  expect(await undoLogCount(page, "undo")).toBe(1); // exactly ONE undo entry

  // Enter gizmo temp object snaps back to the reverted params (undo)
  const gizmoPos = await page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const obj = v.scene.getObjectByName("cyl-enter-gizmo");
    return obj ? [obj.position.x, obj.position.y, obj.position.z] : null;
  });
  expect(gizmoPos).toEqual([0, 0, 0]);

  // a second Ctrl+Z is a no-op: no second entry exists
  await page.keyboard.press("Control+z");
  expect(await undoLogCount(page, "undo")).toBe(1);
  expect(await nodeParams(page)).toMatchObject({ tx: 0, ty: 0, tz: 0 });

  // redo restores the whole drag in one step too
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => nodeParams(page), { timeout: 10000 }).toMatchObject({ tx: 2.5, ty: 0.5, tz: 0.75 });
  expect(await undoLogCount(page, "redo")).toBe(1);

  // Enter gizmo temp object follows the re-applied params (redo)
  const gizmoPosRedo = await page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const obj = v.scene.getObjectByName("cyl-enter-gizmo");
    return obj ? [obj.position.x, obj.position.y, obj.position.z] : null;
  });
  expect(gizmoPosRedo).toEqual([2.5, 0.5, 0.75]);

  // Esc exits Enter mode
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(false);
});

test("On Mouse Up: buffered multi-frame drag commits once = ONE undo entry", async ({ page }) => {
  await openGraph(page);
  await restoreTransformGraph(page);
  await page.locator(".cyl-bottom-bar .cyl-dd .cyl-menu-layout-box").click();
  await page.locator(".cyl-bottom-bar .cyl-dd .cyl-dd-item", { hasText: "On Mouse Up" }).click();
  await enterTransformEdit(page);

  // multi-frame drag: nothing committed until release (params untouched)
  await dragGizmoTo(page, [1.5, -0.25, 0.5]);
  await dragGizmoTo(page, [2.5, 0.5, 0.75]);
  await page.waitForTimeout(300);
  expect(await nodeParams(page)).toMatchObject({ tx: 0, ty: 0, tz: 0 });
  expect(await undoLogCount(page, "undo")).toBe(0);

  // release commits the FINAL buffered value once -> drag session = one undo entry
  await releaseGizmo(page);
  await expect.poll(() => nodeParams(page), { timeout: 10000 }).toMatchObject({ tx: 2.5, ty: 0.5, tz: 0.75 });

  // one Ctrl+Z reverts the whole drag back to the pre-drag pose
  await page.locator(".cyl-viewport canvas").hover();
  await page.keyboard.press("Control+z");
  await expect.poll(() => nodeParams(page), { timeout: 10000 }).toMatchObject({ tx: 0, ty: 0, tz: 0 });
  expect(await undoLogCount(page, "undo")).toBe(1);

  // no second entry -> second Ctrl+Z is a no-op
  await page.keyboard.press("Control+z");
  expect(await undoLogCount(page, "undo")).toBe(1);
  expect(await nodeParams(page)).toMatchObject({ tx: 0, ty: 0, tz: 0 });
});

test("group undo: pushUndoGroup batches param edits into ONE undo entry", async ({ page }) => {
  await openGraph(page);
  await restoreTransformGraph(page);

  // simulate a batch script: apply two param edits and record them as ONE group
  await page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    const n = g.editor.getNodes().find((x: any) => x.kind === "transform");
    if (!n) throw new Error("transform node missing");
    const before = JSON.parse(JSON.stringify(n.params));
    const mid = before.map((q: any) => (q.name === "tx" ? { ...q, value: 1 } : q));
    const after = mid.map((q: any) => (q.name === "ty" ? { ...q, value: 0.5 } : q));
    g.setNodeParams(n.id, after);
    g.pushUndoGroup([
      { type: "params", nodeId: n.id, before, after: mid },
      { type: "params", nodeId: n.id, before: mid, after },
    ]);
  });
  await expect.poll(() => nodeParams(page), { timeout: 10000 }).toMatchObject({ tx: 1, ty: 0.5, tz: 0 });

  // ONE Ctrl+Z reverts the whole batch (undo runs children in reverse order)
  await page.locator(".cyl-viewport canvas").hover();
  await page.keyboard.press("Control+z");
  await expect.poll(() => nodeParams(page), { timeout: 10000 }).toMatchObject({ tx: 0, ty: 0, tz: 0 });

  // no second entry -> second Ctrl+Z is a no-op
  await page.keyboard.press("Control+z");
  expect(await nodeParams(page)).toMatchObject({ tx: 0, ty: 0, tz: 0 });

  // redo replays the batch forward (one step)
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => nodeParams(page), { timeout: 10000 }).toMatchObject({ tx: 1, ty: 0.5, tz: 0 });
});