import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";

/**
 * Round 15 (color system write-set): unified color3 param + modern color picker.
 * - A transform node carrying { name: "tint", type: "color3", value: [0.2,0.4,0.8] }
 *   renders a rounded swatch button + hex text in the Params panel.
 * - Clicking the swatch opens the non-modal floating picker (hue ring + SV square,
 *   palette/recents swatches, RGB/HSL/HSV tabs, live hex input + preview).
 * - Editing the picker hex input fires onColor -> the node's color3 param value
 *   becomes [r,g,b]/255 and the panel hex string stays in sync; Esc closes.
 * - Conversion helpers + recents are exercised through the __cylColorPicker hook.
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

/** Input -> transform (with a color3 "tint" param) -> output graph. */
const TRANSFORM_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: false, bypass: false, freeze: false, reference: false }, params: [
      { name: "tx", type: "float", value: 0 }, { name: "ty", type: "float", value: 0 }, { name: "tz", type: "float", value: 0 },
      { name: "group", type: "string", value: "" }, { name: "class", type: "string", value: "autoguess" },
      { name: "tint", type: "color3", value: [0.2, 0.4, 0.8] },
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

/** Restore the input -> transform -> output graph (with tint color3) in-browser. */
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

/** Read the transform node's tint color3 param value from the graph debug hook. */
async function tintValue(page: import("@playwright/test").Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    const n = g.editor.getNodes().find((x: any) => x.kind === "transform");
    return n.params.find((q: any) => q.name === "tint")!.value as unknown[];
  });
}

test("color3 param swatch + picker: hex edit updates the param and Esc closes", async ({ page }) => {
  await openGraph(page);
  await restoreTransformGraph(page);
  await selectTransformAndOpenParams(page);

  // swatch button renders the color3 value [0.2,0.4,0.8] -> rgb(51,102,204) = #3366cc
  const swatch = page.locator(".cyl-color3-swatch");
  await expect(swatch).toBeVisible();
  const bg = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(51, 102, 204)");
  await expect(page.locator(".cyl-color3-hex")).toHaveValue("#3366cc");

  // click the swatch -> the non-modal picker pops up (hue ring + SV square + tabs + hex)
  await swatch.click();
  const picker = page.locator(".cyl-cp");
  await expect(picker).toBeVisible({ timeout: 10000 });
  await expect(picker.locator(".cyl-cp-ring")).toBeVisible();
  await expect(picker.locator(".cyl-cp-sv")).toBeVisible();
  expect(await picker.locator(".cyl-cp-tabs button").allTextContents()).toEqual(["RGB", "HSL", "HSV"]);
  await expect(picker.locator(".cyl-cp-hex")).toHaveValue("#3366cc");
  // non-modal: no backdrop blocking the page (no overlay element)
  await expect(picker.locator(".cyl-cp-overlay")).toHaveCount(0);

  // edit the picker hex input -> onColor updates the color3 param + syncs the panel hex
  await picker.locator(".cyl-cp-hex").fill("#ff8800");
  const v = await tintValue(page);
  expect(v).toHaveLength(3);
  expect(v[0]).toBeCloseTo(255 / 255, 5);
  expect(v[1]).toBeCloseTo(136 / 255, 5);
  expect(v[2]).toBeCloseTo(0 / 255, 5);
  await expect(page.locator(".cyl-color3-hex")).toHaveValue("#ff8800");

  // invalid hex is ignored while typing (no commit) and reverted on blur/Enter
  await picker.locator(".cyl-cp-hex").fill("zzz");
  expect(await tintValue(page)).toEqual(v); // param unchanged while typing
  await expect(picker.locator(".cyl-cp-hex")).toHaveValue("zzz"); // still shown until committed
  await picker.locator(".cyl-cp-hex").blur(); // commit attempt -> change event reverts invalid
  await expect(picker.locator(".cyl-cp-hex")).toHaveValue("#ff8800"); // reverted to the valid hex

  // the used color lands in recents (debounced 250ms)
  await page.waitForTimeout(400);
  const recents = await page.evaluate(() => JSON.parse(localStorage.getItem("cyl1nder.colorRecents") || "[]"));
  expect(recents[0]).toBe("#ff8800");

  // Esc closes the picker
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
});

test("color helpers: rgbToHex / hexToRgb / rgb-hsl-hsv round trips (__cylColorPicker)", async ({ page }) => {
  await openGraph(page);
  await page.evaluate(() => {
    const c: any = (window as any).__cylColorPicker;
    const src = { r: 255, g: 136, b: 0 };
    const hsl = c.rgbToHsl(src);
    const hsv = c.rgbToHsv(src);
    (window as any).__conv = {
      hex: c.rgbToHex({ r: 51, g: 102, b: 204 }),
      full: c.hexToRgb("#3366cc"),
      short: c.hexToRgb("#36c"),
      bad: c.hexToRgb("nope"),
      hsl,
      hsv,
      hslRgb: c.hslToRgb(hsl.h, hsl.s, hsl.l),
      hsvRgb: c.hsvToRgb(hsv.h, hsv.s, hsv.v),
    };
  });
  const r = await page.evaluate(() => (window as any).__conv);
  expect(r.hex).toBe("#3366cc");
  expect(r.full).toEqual({ r: 51, g: 102, b: 204 });
  expect(r.short).toEqual({ r: 51, g: 102, b: 204 });
  expect(r.bad).toBeNull();
  expect(r.hsl.h).toBeCloseTo(32, 5);
  expect(r.hsl.s).toBeCloseTo(100, 5);
  expect(r.hsl.l).toBeCloseTo(50, 5);
  expect(r.hsv.h).toBeCloseTo(32, 5);
  expect(r.hsv.s).toBeCloseTo(100, 5);
  expect(r.hsv.v).toBeCloseTo(100, 5);
  // round trips land back on the original color (channel rounding is fine)
  expect(r.hslRgb).toEqual({ r: 255, g: 136, b: 0 });
  expect(r.hsvRgb).toEqual({ r: 255, g: 136, b: 0 });
});

