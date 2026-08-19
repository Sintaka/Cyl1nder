import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";
import { gotoMember } from "./fixtures";

/**
 * Round 14 (autosave write-set): the node graph is NO LONGER written automatically
 * on change (the old 1.5s debounced putSnapshot is gone - store.subscribe only marks
 * the graph dirty), explicit Ctrl+S is the save path, and a timed auto-save persists
 * graph+docking+preference while prefs.autosave_enabled (default true) every
 * prefs.autosave_interval_min minutes.
 * - graph change -> no PUT /snapshot within ~2s (dirty flag only)
 * - Ctrl+S -> exactly one PUT /snapshot carrying graph + docking + preference
 * - autosave_enabled:true + tiny interval -> an automatic PUT appears
 * - autosave_enabled:false -> no automatic PUT
 * Route-mock + __cylStore/__cylGraph debug hooks (round12/13 pattern).
 */
const client = new BridgeClient();
let serial = "";

const PREFS_KEY = "cyl1nder.prefs";

/** Minimal input -> transform -> output graph (used to make a real graph change). */
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
  serial =
    process.env.CYL1NDER_E2E_SERIAL ||
    serials.find((s) => s === "C1-e2etest0001-aaaa") ||
    serials[serials.length - 1] ||
    "";
  test.skip(!serial, "no serial registered in bridge");
});

/** Load the main app with the live serial (bridge + WS must come up). */
async function openGraph(page: import("@playwright/test").Page): Promise<void> {
  await gotoMember(page, serial);
  await expect(page.locator(".cyl-app")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".cyl-status")).toHaveClass(/ok/, { timeout: 15000 });
}

/** Mock snapshot GET/PUT so tests never touch real bridge scene files; returns a
 *  getter for the PUT /snapshot payloads observed so far. */
async function mockSnapshot(page: import("@playwright/test").Page): Promise<() => Array<Record<string, unknown>>> {
  const snapshots: Array<Record<string, unknown>> = [];
  await page.route(`**/api/hda/${serial}/snapshot`, (route) => {
    if (route.request().method() === "PUT") snapshots.push(route.request().postDataJSON() as Record<string, unknown>);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, serial }) });
  });
  return () => snapshots;
}

/** A "real" scene save carries graph (+ docking + preference). dock.ts separately
 *  persists docking-only PUTs on layout change - those are NOT graph saves. */
const isGraphSnapshot = (s: Record<string, unknown>): boolean => s && s.graph !== undefined;

/** Seed cyl1nder.prefs BEFORE the app boots (addInitScript runs on every navigation). */
async function seedPrefs(page: import("@playwright/test").Page, prefs: Record<string, unknown>): Promise<void> {
  await page.addInitScript(([key, value]) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [PREFS_KEY, prefs] as const);
}

test("graph change does NOT auto-write: no PUT /snapshot within ~2s", async ({ page }) => {
  const getSnapshots = await mockSnapshot(page);
  await openGraph(page);

  // make a real graph change in-browser: restoreGraph emits store changes which
  // used to schedule the 1.5s debounced write - that write must NOT happen now
  await page.evaluate((g) => {
    const graph: any = (window as any).__cylGraph;
    return graph.restoreGraph(JSON.parse(JSON.stringify(g)));
  }, TRANSFORM_GRAPH);

  // confirm the change landed (2 connections = the restored fixture)
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylGraph.editor.getConnections().length), { timeout: 15000 })
    .toBe(2);

  await page.waitForTimeout(2200); // past the old 1.5s debounce
  // no graph write (dock.ts's docking-only PUT on layout change is unrelated)
  expect(getSnapshots().filter(isGraphSnapshot)).toEqual([]);
});

test("Ctrl+S: exactly one PUT /snapshot carrying graph+docking+preference", async ({ page }) => {
  const getSnapshots = await mockSnapshot(page);
  await openGraph(page);

  await page.keyboard.press("Control+s");

  await expect.poll(() => getSnapshots().filter(isGraphSnapshot).length, { timeout: 5000 }).toBe(1);
  const saved = getSnapshots().filter(isGraphSnapshot)[0];
  expect(saved.graph).toBeDefined();
  expect(saved.docking).toBeDefined();
  expect(saved.preference).toMatchObject({
    sync_max_fps: expect.any(Number),
    update_mode: expect.stringMatching(/auto|mouseup/),
  });
});

test("autosave enabled: tiny interval -> automatic PUT /snapshot", async ({ page }) => {
  const getSnapshots = await mockSnapshot(page);
  await seedPrefs(page, {
    sync_max_fps: 30,
    update_mode: "auto",
    autosave_enabled: true,
    autosave_interval_min: 0.05, // 0.05min = 3s (clamped to >=0.1min = 6s by loadPreferences)
    viewport_bg: "#1a1a1a",
  });
  await openGraph(page);

  // loadPreferences clamps the interval to >=0.1min (6s), so allow up to 9s
  await expect.poll(() => getSnapshots().filter(isGraphSnapshot).length, { timeout: 9000 }).toBeGreaterThan(0);
  const auto = getSnapshots().filter(isGraphSnapshot)[0];
  expect(auto.graph).toBeDefined();
  expect(auto.docking).toBeDefined();
  expect(auto.preference).toBeDefined();
  expect(auto.preference).toMatchObject({ autosave_enabled: true });
});

test("autosave disabled: no automatic PUT /snapshot", async ({ page }) => {
  const getSnapshots = await mockSnapshot(page);
  await seedPrefs(page, {
    sync_max_fps: 30,
    update_mode: "auto",
    autosave_enabled: false,
    autosave_interval_min: 0.05,
    viewport_bg: "#1a1a1a",
  });
  await openGraph(page);

  // well past the interval that WOULD have fired when enabled
  await page.waitForTimeout(4500);
  // docking-only layout PUTs may still fire; a graph save must NOT
  expect(getSnapshots().filter(isGraphSnapshot)).toEqual([]);
});
