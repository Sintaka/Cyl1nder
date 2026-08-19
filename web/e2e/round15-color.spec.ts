import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";
import { gotoMember } from "./fixtures";

/**
 * Round 15 (color system write-set, round 0.1.00062): unified color3 param +
 * modern color picker (full Adobe wheel, channel sliders, Simple/Advanced
 * modes, Adobe harmony wheel with linked points, native EyeDropper, draggable
 * panel, recents right-click delete / clear-all) + unified param reset (P8).
 *
 * - A transform node carrying { name: "tint", type: "color3", value: [0.2,0.4,0.8] }
 *   renders a rounded swatch button + hex text in the Params panel.
 * - Clicking the swatch opens the non-modal floating picker (full wheel + SV
 *   panel, palette/recents swatches, RGB/HSL/HSV tabs with sliders, live hex
 *   input + preview). Editing the picker hex input fires onColor -> the node's
 *   color3 param becomes [r,g,b]/255 and the panel hex stays in sync; Esc closes.
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

/** Input -> transform (color3 "tint" + vector "scale" + string "label" params) -> output graph. */
const TRANSFORM_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: false, bypass: false, freeze: false, reference: false }, params: [
      { name: "tx", type: "float", value: 0 }, { name: "ty", type: "float", value: 0 }, { name: "tz", type: "float", value: 0 },
      { name: "group", type: "string", value: "" }, { name: "class", type: "string", value: "autoguess" },
      { name: "tint", type: "color3", value: [0.2, 0.4, 0.8] },
      { name: "scale", type: "vector", value: [1, 2, 3], default: [2, 2, 2] },
      { name: "label", type: "string", value: "hello", default: "world" },
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

/** Open the floating picker directly through the debug hook (no graph needed). */
async function openPicker(
  page: import("@playwright/test").Page,
  rgb = { r: 128, g: 128, b: 128 },
): Promise<import("@playwright/test").Locator> {
  await page.evaluate((init) => {
    (window as any).__cylColorPicker.openColorPicker({ initial: init, onColor: () => {} });
  }, rgb);
  const picker = page.locator(".cyl-cp");
  await expect(picker).toBeVisible({ timeout: 10000 });
  return picker;
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

/** Read a param value from the graph debug hook. */
async function paramValue(page: import("@playwright/test").Page, name: string): Promise<unknown> {
  return page.evaluate((n) => {
    const g: any = (window as any).__cylGraph;
    const node = g.editor.getNodes().find((x: any) => x.kind === "transform");
    return node.params.find((q: any) => q.name === n)!.value;
  }, name);
}

/** Convert "#RRGGBB" to the computed-style "rgb(r, g, b)" string. */
function rgbString(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Compute an expected hex through the picker's own conversion helpers. */
async function expectedHex(page: import("@playwright/test").Page, fn: string): Promise<string> {
  return page.evaluate((f) => {
    const c: any = (window as any).__cylColorPicker;
    // eslint-disable-next-line no-new-func
    return new Function("c", `return c.rgbToHex(${f})`)(c);
  }, fn);
}

/** Ctrl + middle-click a control (unified param reset, P8). */
async function ctrlMmb(page: import("@playwright/test").Page, locator: import("@playwright/test").Locator): Promise<void> {
  // The params table is re-rendered on every commit, so the element can be
  // detached between two reads - retry the whole gesture a few times.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await locator.waitFor({ state: "visible", timeout: 3000 });
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      if (!box) throw new Error("control not visible for Ctrl+MMB");
      await page.keyboard.down("Control");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down({ button: "middle" });
      await page.mouse.up({ button: "middle" });
      await page.keyboard.up("Control");
      return;
    } catch (err) {
      await page.keyboard.up("Control").catch(() => {});
      if (attempt === 5) throw err;
      await page.waitForTimeout(150);
    }
  }
}

test("color3 param swatch + picker: hex edit updates the param and Esc closes", async ({ page }) => {
  await openGraph(page);
  await restoreTransformGraph(page);
  await selectTransformAndOpenParams(page);

  // swatch button renders the color3 value [0.2,0.4,0.8] -> rgb(51,102,204) = #3366CC
  const swatch = page.locator(".cyl-color3-swatch");
  await expect(swatch).toBeVisible();
  const bg = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(51, 102, 204)");
  await expect(page.locator(".cyl-color3-hex")).toHaveValue("#3366CC");

  // click the swatch -> the non-modal picker pops up (full wheel + SV panel + tabs + hex)
  await swatch.click();
  const picker = page.locator(".cyl-cp");
  await expect(picker).toBeVisible({ timeout: 10000 });
  await expect(picker.locator(".cyl-cp-wheel")).toBeVisible(); // full wheel (P2)
  await expect(picker.locator(".cyl-cp-sv")).toBeVisible();
  expect(await picker.locator(".cyl-cp-tabs button").allTextContents()).toEqual(["RGB", "HSL", "HSV"]);
  await expect(picker.locator(".cyl-cp-hex")).toHaveValue("#3366CC");
  // non-modal: no backdrop blocking the page (no overlay element)
  await expect(picker.locator(".cyl-cp-overlay")).toHaveCount(0);

  // edit the picker hex input -> onColor updates the color3 param + syncs the panel hex
  await picker.locator(".cyl-cp-hex").fill("#ff8800");
  const v = (await paramValue(page, "tint")) as number[];
  expect(v).toHaveLength(3);
  expect(v[0]).toBeCloseTo(255 / 255, 5);
  expect(v[1]).toBeCloseTo(136 / 255, 5);
  expect(v[2]).toBeCloseTo(0 / 255, 5);
  await expect(page.locator(".cyl-color3-hex")).toHaveValue("#FF8800");

  // invalid hex is ignored while typing (no commit) and reverted on blur/Enter
  await picker.locator(".cyl-cp-hex").fill("zzz");
  expect(await paramValue(page, "tint")).toEqual(v); // param unchanged while typing
  await expect(picker.locator(".cyl-cp-hex")).toHaveValue("ZZZ"); // still shown until committed (input auto-uppercases to ZZZ)
  await picker.locator(".cyl-cp-hex").blur(); // commit attempt -> change event reverts invalid
  await expect(picker.locator(".cyl-cp-hex")).toHaveValue("#FF8800"); // reverted to the valid hex

  // the used color lands in recents (debounced 250ms)
  await page.waitForTimeout(400);
  const recents = await page.evaluate(() => JSON.parse(localStorage.getItem("cyl1nder.colorRecents") || "[]"));
  expect(recents[0]).toBe("#FF8800");

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
      full: c.hexToRgb("#3366CC"),
      short: c.hexToRgb("#36c"),
      bad: c.hexToRgb("nope"),
      hsl,
      hsv,
      hslRgb: c.hslToRgb(hsl.h, hsl.s, hsl.l),
      hsvRgb: c.hsvToRgb(hsv.h, hsv.s, hsv.v),
    };
  });
  const r = await page.evaluate(() => (window as any).__conv);
  expect(r.hex).toBe("#3366CC");
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

test("P3 channel sliders: RGB/HSL/HSV sliders update the color live", async ({ page }) => {
  await openGraph(page);
  const picker = await openPicker(page);

  // RGB mode: 3 channels, each with a draggable slider + number input
  await expect(picker.locator(".cyl-cp-fld")).toHaveCount(3);
  await expect(picker.locator('.cyl-cp-fld [data-part="field-slider"]')).toHaveCount(3);
  await expect(picker.locator(".cyl-cp-hex")).toHaveValue("#808080");

  // drag R slider to 255 -> hex #FF8080 (G/B stay 128)
  await page.evaluate(() => {
    const slider = document.querySelectorAll('.cyl-cp-fld [data-part="field-slider"]')[0] as HTMLInputElement;
    slider.value = "255";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(picker.locator(".cyl-cp-hex")).toHaveValue("#FF8080");

  // HSL tab: L slider to 0 -> black
  await picker.locator('.cyl-cp-tabs button[data-mode="hsl"]').click();
  await page.evaluate(() => {
    const sliders = document.querySelectorAll('.cyl-cp-fld [data-part="field-slider"]');
    (sliders[2] as HTMLInputElement).value = "0";
    (sliders[2] as HTMLInputElement).dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(picker.locator(".cyl-cp-hex")).toHaveValue("#000000");

  // HSV tab: V slider to 100 -> white
  await picker.locator('.cyl-cp-tabs button[data-mode="hsv"]').click();
  await page.evaluate(() => {
    const sliders = document.querySelectorAll('.cyl-cp-fld [data-part="field-slider"]');
    (sliders[2] as HTMLInputElement).value = "100";
    (sliders[2] as HTMLInputElement).dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(picker.locator(".cyl-cp-hex")).toHaveValue("#FFFFFF");
});

test("P3/P5 Simple/Advanced mode + Adobe harmony wheel (presets, linked points, swatches, L)", async ({ page }) => {
  await openGraph(page);
  const picker = await openPicker(page, { r: 255, g: 0, b: 0 });

  // mode pill: Simple active by default; Advanced reveals the harmony bar
  await expect(picker.locator('.cyl-cp-pill button[data-pickermode="simple"]')).toHaveClass(/active/);
  await expect(picker.locator('[data-part="harmony"]')).toBeHidden();
  await picker.locator('.cyl-cp-pill button[data-pickermode="advanced"]').click();
  await expect(picker.locator('[data-part="harmony"]')).toBeVisible();
  await expect(picker.locator(".cyl-cp-harmony-swatches .cyl-cp-swatch")).toHaveCount(5);
  await expect(picker.locator(".cyl-cp-harmony-point")).toHaveCount(4); // point 0 == wheel thumb

  // preset dropdown: 6 Color harmonies (Layout-style custom dropdown)
  const preset = picker.getByRole("button", { name: "Color harmony preset" });
  await preset.click();
  await expect(picker.locator(".cyl-menu-drop.open .cyl-dd-item")).toHaveText([
    "Monochrome", "Complementary", "Analogous", "Triadic", "Compound", "Shades",
  ]);
  await preset.click(); // close
  // swatch 0 == the current color (base); analogous point 1 is a different hue
  expect(await picker.locator('.cyl-cp-harmony-swatches .cyl-cp-swatch').nth(0).evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe(rgbString(await expectedHex(page, "c.hslToRgb(0, 100, 50)")));
  const beforeAnalog = await picker.locator('.cyl-cp-harmony-swatches .cyl-cp-swatch').nth(1).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(beforeAnalog).not.toBe(rgbString(await expectedHex(page, "c.hslToRgb(0, 100, 50)")));

  // preset -> Complementary: point 1 becomes the complementary hue (180°)
  await preset.click();
  await picker.locator(".cyl-menu-drop.open .cyl-dd-item", { hasText: "Complementary" }).click();
  await expect
    .poll(() => picker.locator('.cyl-cp-harmony-swatches .cyl-cp-swatch').nth(1).evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe(rgbString(await expectedHex(page, "c.hslToRgb(180, 100, 50)")));

  // click a linked swatch -> picks that color (re-anchors the base)
  await picker.locator('.cyl-cp-harmony-swatches .cyl-cp-swatch').nth(2).click(); // hsl(0,100,40)
  await expect(picker.locator(".cyl-cp-hex")).toHaveValue(await expectedHex(page, "c.hslToRgb(0, 100, 40)"));

  // base-L slider (P5): adjusting HSL L re-tints every harmony point
  await picker.locator('[data-part="harmony-light"]').evaluate((el) => {
    (el as HTMLInputElement).value = "80";
    (el as HTMLInputElement).dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(picker.locator(".cyl-cp-hex")).toHaveValue(await expectedHex(page, "c.hslToRgb(0, 100, 80)"));

  // drag a linked point -> the whole group rotates (swatches + base hex change)
  const beforeDrag = await picker
    .locator('.cyl-cp-harmony-swatches .cyl-cp-swatch')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el as HTMLElement).backgroundColor));
  const hexBefore = await picker.locator(".cyl-cp-hex").inputValue();
  const wheelBox = (await picker.locator(".cyl-cp-wheel").boundingBox())!;
  const cx = wheelBox.x + wheelBox.width / 2;
  const cy = wheelBox.y + wheelBox.height / 2;
  const ptBox = (await picker.locator(".cyl-cp-harmony-point").first().boundingBox())!;
  await page.mouse.move(ptBox.x + ptBox.width / 2, ptBox.y + ptBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx + 46, cy, { steps: 6 }); // rotate the group towards 0°
  await page.mouse.up();
  await expect
    .poll(() => picker.locator(".cyl-cp-hex").inputValue())
    .not.toBe(hexBefore);
  const afterDrag = await picker
    .locator('.cyl-cp-harmony-swatches .cyl-cp-swatch')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el as HTMLElement).backgroundColor));
  expect(afterDrag).not.toEqual(beforeDrag);

  // advanced palette: same flat 10-column preset grid as Simple (no category labels)
  await expect(picker.locator(".cyl-cp-pal-group")).toHaveCount(0);
  await expect(picker.locator('[data-part="palette"] .cyl-cp-swatch')).toHaveCount(20);
  await expect(picker.locator('[data-part="palette"] [data-hex="#f03e3e"]')).toBeVisible();
  // harmony preset dropdown shows the visual hint icon in Advanced mode
  await expect(picker.locator('[data-part="harmony-hint"] svg')).toBeVisible();
});

test("P4 native EyeDropper: button applies the picked color; hidden when unsupported", async ({ page }) => {
  await openGraph(page);

  // unsupported: EyeDropper undefined -> button hidden
  await page.evaluate(() => {
    Object.defineProperty(window, "EyeDropper", { configurable: true, value: undefined });
  });
  const picker1 = await openPicker(page, { r: 1, g: 2, b: 3 });
  await expect(picker1.locator(".cyl-cp-eye")).toBeHidden();
  await page.keyboard.press("Escape");

  // supported (mocked): clicking the button applies the returned sRGBHex
  await page.evaluate(() => {
    (window as any).EyeDropper = class {
      open(): Promise<{ sRGBHex: string }> {
        return Promise.resolve({ sRGBHex: "#00ff88" });
      }
    };
  });
  const picker = await openPicker(page, { r: 0, g: 0, b: 0 });
  const eye = picker.locator(".cyl-cp-eye");
  await expect(eye).toBeVisible();
  await eye.click();
  await expect(picker.locator(".cyl-cp-hex")).toHaveValue("#00FF88");
});

test("P1 recents: right-click deletes one, Clear all empties (persisted)", async ({ page }) => {
  await openGraph(page);
  await page.evaluate(() => {
    localStorage.setItem("cyl1nder.colorRecents", JSON.stringify(["#112233", "#445566"]));
  });
  const picker = await openPicker(page, { r: 0, g: 0, b: 0 });
  const recents = picker.locator('[data-part="recents"] .cyl-cp-swatch');
  await expect(recents).toHaveCount(2);

  // right-click the first recent -> deletes just that swatch
  await recents.first().click({ button: "right" });
  await expect(recents).toHaveCount(1);
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cyl1nder.colorRecents") || "[]"));
  expect(stored).toEqual(["#445566"]);

  // Clear all -> empties the list + storage
  await picker.locator('[data-part="recents-clear"]').click();
  await expect(recents).toHaveCount(0);
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cyl1nder.colorRecents") || "[]"));
  expect(stored).toEqual([]);
  await expect(picker.locator('[data-part="recents-clear"]')).toBeDisabled();
});

test("P7 the picker drags by its title bar", async ({ page }) => {
  await openGraph(page);
  const picker = await openPicker(page, { r: 40, g: 80, b: 120 });
  const before = (await picker.boundingBox())!;
  await page.mouse.move(before.x + 40, before.y + 10); // inside the header
  await page.mouse.down();
  // drag left + down (away from the top-right default so fitInViewport clamp
  // does not stop the movement at the viewport edge)
  await page.mouse.move(before.x - 130, before.y + 70, { steps: 6 });
  await page.mouse.up();
  const after = (await picker.boundingBox())!;
  expect(after.x).toBeLessThan(before.x - 70);
  expect(after.y).toBeGreaterThan(before.y + 40);
  await expect(picker.locator(".cyl-cp-title")).toHaveText("Pick color"); // still open after the drag
});

test("P8 unified param reset: Ctrl+MMB restores vector / color3 / string defaults", async ({ page }) => {
  await openGraph(page);
  await restoreTransformGraph(page);
  await selectTransformAndOpenParams(page);

  // vector: "1,2,3" -> Ctrl+MMB -> default [2,2,2] -> "2,2,2" (and node param array)
  const vectorInput = page.locator('.cyl-param-table input[data-name="scale"]');
  await expect(vectorInput).toHaveValue("1,2,3");
  await ctrlMmb(page, vectorInput);
  await expect(vectorInput).toHaveValue("2,2,2");
  expect(await paramValue(page, "scale")).toEqual([2, 2, 2]);

  // string: "hello" -> Ctrl+MMB -> explicit default "world"
  const labelInput = page.locator('.cyl-param-table input[data-name="label"]');
  await expect(labelInput).toHaveValue("hello");
  await ctrlMmb(page, labelInput);
  await expect(labelInput).toHaveValue("world");
  expect(await paramValue(page, "label")).toBe("world");

  // color3: #3366CC -> Ctrl+MMB on the hex input -> type default [0.5,0.5,0.5] -> #808080
  const colorHex = page.locator(".cyl-color3-hex");
  await expect(colorHex).toHaveValue("#3366CC");
  await ctrlMmb(page, colorHex);
  await expect(colorHex).toHaveValue("#808080");
  const tint = (await paramValue(page, "tint")) as number[];
  expect(tint[0]).toBeCloseTo(0.5, 5);
  expect(tint[1]).toBeCloseTo(0.5, 5);
  expect(tint[2]).toBeCloseTo(0.5, 5);
});
