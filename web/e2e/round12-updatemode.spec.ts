import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";
import { gotoMember, toggleSyncEnabled } from "./fixtures";

/**
 * Round 12 (update-mode write-set): non-docking bottom bar + 15ch "Auto Update /
 * On Mouse Up" dropdown that picks when Enter-gizmo drags refresh the geometry.
 * - UI: bottom bar exists under the dock, the dropdown is 15ch wide, defaults to
 *   Auto Update, the old "Update" gray label is removed (dropdown only), and the
 *   choice survives reload (localStorage "cyl1nder.prefs" -> update_mode; the bottom
 *   bar also gains a Sync Max FPS number input defaulting to 30).
 * - On Mouse Up: during a gizmo drag only the LATEST tx/ty/tz is buffered (no
 *   runNetwork, no bridge outputs, no param writes); releasing the mouse commits
 *   that single value once (one setNodeParams + runNetwork).
 * - Auto Update: every drag frame still setNodeParams + runNetwork (bridge outputs
 *   follow while dragging, exactly the pre-round-12 behaviour).
 * Self-contained: beforeAll pushes the canonical fixture; afterAll restores it.
 */
const client = new BridgeClient();
let serial = "";

const bottomDrop = (page: import("@playwright/test").Page) => page.locator(".cyl-bottom-bar .cyl-dd");
async function chooseBottomOption(page: import("@playwright/test").Page, label: string): Promise<void> {
  const dd = bottomDrop(page);
  await dd.locator(".cyl-menu-layout-box").click();
  await dd.locator(".cyl-dd-item", { hasText: label }).click();
}

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
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: true, bypass: false, freeze: false, reference: false }, params: [
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

/** Force a deterministic baseline: tx=0 through the params panel -> bridge origin outputs. */
async function baselineOrigin(page: import("@playwright/test").Page): Promise<void> {
  await selectTransformAndOpenParams(page);
  await page.locator('.cyl-param-table input[data-name="tx"]').fill("0");
  await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0]) < 1e-6 && Math.abs(out0.points[0][1]) < 1e-6;
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

/** Live transform node params (tx/ty/tz) + "network ran" log count. */
async function nodeAndLogs(page: import("@playwright/test").Page): Promise<{ tx: number; ty: number; tz: number; networkRuns: number }> {
  return page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    const n = g.editor.getNodes().find((x: any) => x.kind === "transform");
    const p: Record<string, unknown> = {};
    for (const q of n.params) p[q.name] = q.value;
    const store: any = (window as any).__cylStore;
    return { tx: p.tx as number, ty: p.ty as number, tz: p.tz as number, networkRuns: store.logs.filter((m: string) => m.includes("network ran")).length };
  });
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

/** First point of the displayed node-result geometry (or null when not built). */
async function nodeResultFirstPoint(page: import("@playwright/test").Page): Promise<number[] | null> {
  return page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const root = v.nodeResultGroup.getObjectByName("cyl-node-result");
    if (!root) return null;
    const line = root.children.find((c: any) => c.isLine);
    if (!line || !line.geometry || !line.geometry.attributes.position) return null;
    const arr = line.geometry.attributes.position.array;
    return [arr[0], arr[1], arr[2]];
  });
}

test("bottom bar: non-docking strip + 15ch update-mode dropdown, default Auto Update, localStorage restore", async ({ page }) => {
  await openGraph(page);

  // bottom bar sits BELOW the dock (both visible, bar is not part of the dock)
  const bar = page.locator(".cyl-bottom-bar");
  await expect(bar).toBeVisible();
  const dockBox = await page.locator(".cyl-dock").boundingBox();
  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(barBox!.y).toBeGreaterThanOrEqual(dockBox!.y + dockBox!.height - 1);

  // dropdown: options + default Auto Update (Layout-style custom dropdown)
  const dd = bottomDrop(page);
  await expect(dd).toBeVisible();
  await expect(dd.locator(".cyl-menu-layout-name")).toHaveText("Auto Update");
  await dd.locator(".cyl-menu-layout-box").click();
  await expect(dd.locator(".cyl-dd-item")).toHaveText(["Auto Update", "On Mouse Up"]);
  await dd.locator(".cyl-menu-layout-box").click(); // close

  // 15ch wide: compare to a probe div with width:15ch + the same font (both border-box)
  const widths = await page.evaluate(() => {
    const el = document.querySelector(".cyl-bottom-bar .cyl-dd .cyl-menu-layout-name") as HTMLElement;
    const cs = getComputedStyle(el);
    const probe = document.createElement("div");
    probe.style.cssText = `width:15ch;box-sizing:border-box;font:${cs.font};visibility:hidden;position:absolute`;
    document.body.appendChild(probe);
    const probeW = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);
    return { selectW: el.getBoundingClientRect().width, probeW };
  });
  expect(Math.abs(widths.selectW - widths.probeW)).toBeLessThan(1);

  // the old "Update" gray label is gone; only the dropdown + Sync Max FPS remain
  await expect(bar.locator(".cyl-bottom-label", { hasText: "Update" })).toHaveCount(0);

  // Sync Max FPS input: present in the bottom bar, defaults to 30
  const fpsInput = page.locator("#cyl-sync-fps");
  await expect(fpsInput).toBeVisible();
  await expect(fpsInput).toHaveValue("30");

  // switching persists to the prefs store (cyl1nder.prefs.update_mode)
  await chooseBottomOption(page, "On Mouse Up");
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem("cyl1nder.prefs") || "{}"));
  expect(prefs.update_mode).toBe("mouseup");

  // reload -> the stored mode is restored
  await page.reload();
  await expect(bottomDrop(page).locator(".cyl-menu-layout-name")).toHaveText("On Mouse Up", { timeout: 15000 });
});

test("On Mouse Up: drag only buffers tx/ty/tz; release commits once (zero network during drag)", async ({ page }) => {
  await openGraph(page);
  await toggleSyncEnabled(page, true); // v0.1.00101 起推桥需 sync ON
  await restoreTransformGraph(page);
  await baselineOrigin(page); // deterministic tx=0 baseline
  await chooseBottomOption(page, "On Mouse Up");
  await enterTransformEdit(page);

  // baseline geometry of the driven output (other parallel tests may push to the
  // shared serial, so compare geometry per index, never the global rev counter)
  const before = await bridgeOutputs();
  const before0 = before.find((x) => x.index === 0)!;
  expect(before0.points).toEqual(ORIGIN_OUT0);
  const beforeState = await nodeAndLogs(page);
  expect(beforeState).toMatchObject({ tx: 0, ty: 0, tz: 0 });

  // multiple drag frames: only the LATEST value may be buffered
  await dragGizmoTo(page, [1.5, -0.25, 0.5]);
  await dragGizmoTo(page, [2.5, 0.5, 0.75]);
  await page.waitForTimeout(500);

  // during the drag: out0 geometry untouched, no network run, no param writes
  const during0 = (await bridgeOutputs()).find((x) => x.index === 0)!;
  expect(during0.points).toEqual(before0.points);
  expect(await nodeAndLogs(page)).toEqual(beforeState);

  // during the drag the GEOMETRY does not move (mouseup intent: only the gizmo follows
  // the pointer; parms + geometry move on release - never by touching geometry directly)
  const dragPos = await page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    return { x: v.nodeResultGroup.position.x, y: v.nodeResultGroup.position.y, z: v.nodeResultGroup.position.z };
  });
  expect(dragPos).toEqual({ x: 0, y: 0, z: 0 });
  expect(await nodeResultFirstPoint(page)).toEqual(ORIGIN_OUT0[0]);

  // release -> exactly one commit lands the FINAL buffered value
  await releaseGizmo(page);
  await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0] - 2.5) < 1e-6;
    },
    10000,
    "mouseup translated outputs",
  );
  const outs = await bridgeOutputs();
  const out0 = outs.find((x) => x.index === 0)!;
  expect(out0.points).toEqual([[2.5, 0.5, 0.75], [3.5, 0.5, 0.75], [3.5, 1.5, 0.75], [2.5, 1.5, 0.75]]);
  expect(await nodeAndLogs(page)).toMatchObject({ tx: 2.5, ty: 0.5, tz: 0.75 });

  // release moved the geometry: the viewport first point follows the committed value
  await expect.poll(() => nodeResultFirstPoint(page), { timeout: 10000 }).toEqual([2.5, 0.5, 0.75]);

  // Esc exits Enter mode (only while the pointer hovers the viewport)
  await page.locator(".cyl-viewport canvas").hover();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(false);
});

test("Auto Update: gizmo drag pushes bridge outputs every frame (pre-round-12 behaviour)", async ({ page }) => {
  await openGraph(page);
  await toggleSyncEnabled(page, true); // v0.1.00101 起推桥需 sync ON
  await restoreTransformGraph(page);
  await baselineOrigin(page);
  await enterTransformEdit(page);

  // default dropdown is auto (fresh context); still assert it explicitly
  await expect(bottomDrop(page).locator(".cyl-menu-layout-name")).toHaveText("Auto Update");

  // one drag frame -> outputs follow WHILE still dragging (no release)
  await dragGizmoTo(page, [1.5, -0.25, 0.5]);
  await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0] - 1.5) < 1e-6;
    },
    10000,
    "auto translated outputs",
  );
  const out0 = (await bridgeOutputs()).find((x) => x.index === 0)!;
  expect(out0.points).toEqual([[1.5, -0.25, 0.5], [2.5, -0.25, 0.5], [2.5, 0.75, 0.5], [1.5, 0.75, 0.5]]);
  expect(await nodeAndLogs(page)).toMatchObject({ tx: 1.5, ty: -0.25, tz: 0.5 });

  // a second drag frame still updates live
  await dragGizmoTo(page, [0.25, 1, -0.5]);
  await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0] - 0.25) < 1e-6;
    },
    10000,
    "auto translated outputs (frame 2)",
  );

  // Esc exits Enter mode (only while the pointer hovers the viewport)
  await page.locator(".cyl-viewport canvas").hover();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(false);
});
