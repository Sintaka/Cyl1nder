import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";

/**
 * Round 19 (chain-state cache + clone-free translate, P2): Enter-drag a transform
 * whose group filter is "0-1" (only points 0/1 are translated). The chain cache
 * keeps ONE mutable points array and applies translate DELTAS in place, so:
 * - during the drag the displayed node-result geometry's first TWO points follow
 *   the gizmo while the other points stay put;
 * - the store output buffer still references the SAME points array across frames
 *   (zero clone - the array is mutated, never re-allocated);
 * - after release the bridge outputs carry the final grouped translate.
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

/** Origin output of the canonical square (no translate). */
const ORIGIN_OUT0 = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];

/** Grouped transform graph: group "0-1" -> only points 0/1 translate. */
const GROUP_TRANSFORM_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: true, bypass: false, freeze: false, reference: false }, params: [
      { name: "tx", type: "float", value: 0 }, { name: "ty", type: "float", value: 0 }, { name: "tz", type: "float", value: 0 },
      { name: "group", type: "string", value: "0-1" }, { name: "class", type: "string", value: "autoguess" },
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
  await page.goto(`http://127.0.0.1:8376/?serial=${serial}`);
  await expect(page.locator(".cyl-graph .cyl-rp-title").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".cyl-status")).toHaveClass(/ok/, { timeout: 15000 });
}

/** Restore the input -> transform("0-1") -> output graph in-browser. */
async function restoreGroupTransformGraph(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async (g) => {
    const graph: any = (window as any).__cylGraph;
    await graph.restoreGraph(JSON.parse(JSON.stringify(g)));
  }, GROUP_TRANSFORM_GRAPH);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylGraph.editor.getConnections().length), { timeout: 15000 })
    .toBe(2);
}

/** Select the transform node + open the Params tab (real user path to setNodeParams). */
async function selectTransformAndOpenParams(page: import("@playwright/test").Page): Promise<void> {
  await page.locator(".cyl-rp-title", { hasText: /^transform\d+$/ }).first().click({ timeout: 15000 });
  await page.locator(".dv-tab", { hasText: "Params" }).first().click({ timeout: 15000 });
  await expect(page.locator('.cyl-param-table input[data-name="tx"]')).toBeVisible({ timeout: 10000 });
}

/** Enter-edit the transform node via the left toolbar (gizmo bound at its params). */
async function enterTransformEdit(page: import("@playwright/test").Page): Promise<void> {
  await page.locator(".cyl-rp-title", { hasText: /^transform\d+$/ }).first().click({ timeout: 15000 });
  await page.locator(".cyl-viewport-toolbar .cyl-tool-btn").first().click();
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(true);
  const gizmo = await page.evaluate(() => (window as any).__cylViewport.scene.getObjectByName("cyl-enter-gizmo"));
  expect(gizmo).not.toBeNull();
}

/** Force a deterministic baseline: tx=0 through the params panel -> origin outputs. */
async function baselineOrigin(page: import("@playwright/test").Page): Promise<void> {
  await selectTransformAndOpenParams(page);
  await page.locator('.cyl-param-table input[data-name="tx"]').fill("0");
  await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0]) < 1e-6;
    },
    10000,
    "origin bridge outputs",
  );
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

/** All points of the displayed node-result line geometry (or null when not built). */
async function nodeResultPoints(page: import("@playwright/test").Page): Promise<number[][] | null> {
  return page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const root = v.nodeResultGroup.getObjectByName("cyl-node-result");
    if (!root) return null;
    const line = root.children.find((c: any) => c.isLine);
    if (!line || !line.geometry || !line.geometry.attributes.position) return null;
    const arr = line.geometry.attributes.position.array;
    const pts: number[][] = [];
    for (let i = 0; i + 2 < arr.length; i += 3) pts.push([arr[i], arr[i + 1], arr[i + 2]]);
    return pts;
  });
}


test("grouped (0-1) Enter drag: viewport first two points follow, rest stay; bridge outputs correct after release; zero clone", async ({ page }) => {
  await openGraph(page);
  await restoreGroupTransformGraph(page);
  await baselineOrigin(page); // deterministic tx=0 baseline

  // baseline: viewport shows the origin square
  await expect.poll(() => nodeResultPoints(page), { timeout: 10000 }).toEqual(ORIGIN_OUT0);

  // zero-clone proof: capture the SAME output points array the cache keeps; a
  // clone-free translate must keep that exact reference while mutating values.
  const refBefore = await page.evaluate(() => {
    const s: any = (window as any).__cylStore;
    const o = s.outputs.find((x: any) => x.index === 0);
    (window as any).__p2PointsRef = o ? o.points : null;
    return o ? o.points.length : 0;
  });
  expect(refBefore).toBe(4);

  await enterTransformEdit(page);
  await dragGizmoTo(page, [1.5, 0, 0]);

  // viewport nodeResult: points 0/1 follow (+x), points 2/3 untouched
  await expect
    .poll(
      async () => {
        const pts = await nodeResultPoints(page);
        return pts && Math.abs(pts[0][0] - 1.5) < 1e-6 ? pts : null;
      },
      { timeout: 10000 },
    )
    .toEqual([
      [1.5, 0, 0],
      [2.5, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]);

  // the store output buffer still points at the SAME array (mutated in place)
  const sameRef = await page.evaluate(() => {
    const s: any = (window as any).__cylStore;
    const o = s.outputs.find((x: any) => x.index === 0);
    return o ? o.points === (window as any).__p2PointsRef : false;
  });
  expect(sameRef).toBe(true);

  // release ends the drag session; the bridge receives the final grouped translate
  await releaseGizmo(page);
  await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return (
        !!out0 &&
        out0.points.length === 4 &&
        Math.abs(out0.points[0][0] - 1.5) < 1e-6 &&
        Math.abs(out0.points[1][0] - 2.5) < 1e-6
      );
    },
    10000,
    "grouped translated bridge outputs",
  );
  const out0 = (await bridgeOutputs()).find((x) => x.index === 0)!;
  expect(out0.points).toEqual([
    [1.5, 0, 0],
    [2.5, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ]);

  // Esc exits Enter mode (only while the pointer hovers the viewport)
  await page.locator(".cyl-viewport canvas").hover();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(false);
});
