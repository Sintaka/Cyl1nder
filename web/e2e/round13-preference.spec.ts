import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";

/**
 * Round 13 (preferences write-set): Edit -> Preference floating (non-modal)
 * panel with General/Viewport tabs, Apply (applies without closing) / Save
 * (closes), bottom-bar Sync Max FPS rate cap, update_mode rename (localStorage
 * "cyl1nder.prefs"), Ctrl+S / Ctrl+Alt+S quick save (both preventDefault so
 * Chrome never saves the page).
 * - Edit -> Preference: floating panel opens (no blocking overlay; the header
 *   serial input stays clickable behind it, ✕ present); General/Viewport/UI tabs
 *   exist and switch panes; re-opening the menu keeps a single panel (P6);
 *   UI tab picks the font (body .cyl-font-code/.cyl-font-system + ui_font);
 *   Apply persists to localStorage + pushes PUT /api/hda/{serial}/sync while
 *   the panel stays open; Save closes; Escape closes without saving.
 * - Round 62: Ctrl+middle-click on the Viewport background color row resets
 *   the swatch/hex to the default #1A1A1A (P8).
 * - Bottom-bar Sync Max FPS input: change -> localStorage + PUT /sync.
 * - Ctrl+S: putSnapshot({graph, docking, preference}) + defaultPrevented.
 * - Ctrl+Alt+S: save-as path (prompt dialog accepted + scene/save mock).
 */
const client = new BridgeClient();
let serial = "";

async function choosePrefOption(page: import("@playwright/test").Page, panel: import("@playwright/test").Locator, trigger: string, label: string): Promise<void> {
  await panel.getByRole("button", { name: trigger }).click();
  await panel.getByRole("button", { name: label }).click();
}

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
  await page.goto(`http://127.0.0.1:8376/?serial=${serial}`);
  await expect(page.locator(".cyl-app")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".cyl-status")).toHaveClass(/ok/, { timeout: 15000 });
}

/** Mock snapshot GET/PUT so tests never touch real bridge scene files. */
async function mockSnapshot(page: import("@playwright/test").Page): Promise<void> {
  await page.route(`**/api/hda/${serial}/snapshot`, (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, serial }) });
  });
}

test("Edit -> Preference: floating panel; tabs; Apply keeps open, Save closes", async ({ page }) => {
  const syncFps: number[] = [];
  await page.route(`**/api/hda/${serial}/sync`, (route) => {
    const body = route.request().postDataJSON() as { fps?: number };
    if (typeof body.fps === "number") syncFps.push(body.fps);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, fps: body.fps }) });
  });
  await mockSnapshot(page);
  await openGraph(page);

  // open the Edit menu and click Preference…
  await page.locator('.cyl-menu[data-menu="edit"] .cyl-menu-label').click();
  await page.locator('#cyl-menu-edit button[data-act="preference"]').click();
  const panel = page.locator(".cyl-pref-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".cyl-pref-title")).toHaveText("Preference");

  // floating non-modal: ✕ present and the header serial input stays clickable behind the panel
  await expect(panel.locator(".cyl-pref-close")).toBeVisible();
  await page.locator("#cyl-serial").click();
  await page.locator("#cyl-serial").fill("C1-e2etest0001-aaaa");
  await expect(panel).toBeVisible();

  // single instance (P6): re-opening Edit -> Preference closes the old panel first
  await page.locator('.cyl-menu[data-menu="edit"] .cyl-menu-label').click();
  await page.locator('#cyl-menu-edit button[data-act="preference"]').click();
  await expect(page.locator(".cyl-pref-panel")).toHaveCount(1);
  await expect(panel).toBeVisible();

  // tabs: General active by default; UI + Viewport switch panes and back
  await expect(panel.locator('.cyl-pref-tab[data-pref-tab="general"]')).toHaveClass(/is-active/);
  await expect(panel.locator('.cyl-pref-tab[data-pref-tab="ui"]')).toBeVisible();
  await panel.locator('.cyl-pref-tab[data-pref-tab="ui"]').click();
  await expect(panel.locator('[data-pref-pane="ui"]')).toBeVisible();
  // round 62: UI Font dropdown, default "code" -> body .cyl-font-code
  await expect(panel.getByRole("button", { name: "UI font" }).locator(".cyl-menu-layout-name")).toHaveText("Fira Code (code)");
  await expect(page.locator("body")).toHaveClass(/cyl-font-code/);
  await choosePrefOption(page, panel, "UI font", "System");
  await panel.locator(".cyl-pref-apply").click();
  await expect(page.locator("body")).toHaveClass(/cyl-font-system/);
  const fontPrefs = await page.evaluate(() => JSON.parse(localStorage.getItem("cyl1nder.prefs") || "{}"));
  expect(fontPrefs.ui_font).toBe("system");
  await choosePrefOption(page, panel, "UI font", "Fira Code (code)");
  await panel.locator(".cyl-pref-apply").click();
  await expect(page.locator("body")).toHaveClass(/cyl-font-code/);
  await panel.locator('.cyl-pref-tab[data-pref-tab="viewport"]').click();
  await expect(panel.locator('[data-pref-pane="viewport"]')).toBeVisible();
  // v0.1.00061: clicking the swatch opens the shared picker directly (no Change button)
  await expect(panel.locator('#cyl-pref-bg-change')).toHaveCount(0);
  await panel.locator('#cyl-pref-bg-swatch').click();
  await expect(page.locator('.cyl-cp')).toBeVisible();
  await page.keyboard.press('Escape');
  await panel.locator('.cyl-pref-tab[data-pref-tab="general"]').click();
  await expect(panel.locator('[data-pref-pane="general"]')).toBeVisible();

  // change Sync Max FPS + Update Mode, then Apply -> persists + PUT /sync, panel stays open
  await panel.locator("#cyl-pref-fps").fill("45");
  await choosePrefOption(page, panel, "Update mode", "On Mouse Up");
  await panel.locator(".cyl-pref-apply").click();
  await expect(panel).toBeVisible();
  await expect.poll(() => syncFps, { timeout: 5000 }).toContain(45);
  let prefs = await page.evaluate(() => JSON.parse(localStorage.getItem("cyl1nder.prefs") || "{}"));
  expect(prefs.sync_max_fps).toBe(45);
  expect(prefs.update_mode).toBe("mouseup");

  // bottom-bar controls are synced to the applied values
  await expect(page.locator("#cyl-sync-fps")).toHaveValue("45");
  await expect(page.locator(".cyl-bottom-bar .cyl-dd .cyl-menu-layout-name")).toHaveText("On Mouse Up");

  // Save -> persists + closes the panel
  await panel.locator("#cyl-pref-fps").fill("50");
  await panel.locator(".cyl-pref-save").click();
  await expect(panel).toHaveCount(0);
  prefs = await page.evaluate(() => JSON.parse(localStorage.getItem("cyl1nder.prefs") || "{}"));
  expect(prefs.sync_max_fps).toBe(50);
  await expect(page.locator("#cyl-sync-fps")).toHaveValue("50");

  // Escape path: reopen + Escape closes without saving
  await page.locator('.cyl-menu[data-menu="edit"] .cyl-menu-label').click();
  await page.locator('#cyl-menu-edit button[data-act="preference"]').click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("bottom-bar Sync Max FPS: change persists to localStorage and triggers PUT /sync", async ({ page }) => {
  const syncFps: number[] = [];
  await page.route(`**/api/hda/${serial}/sync`, (route) => {
    const body = route.request().postDataJSON() as { fps?: number };
    if (typeof body.fps === "number") syncFps.push(body.fps);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, fps: body.fps }) });
  });
  await mockSnapshot(page);
  await openGraph(page);

  const fpsInput = page.locator("#cyl-sync-fps");
  await expect(fpsInput).toHaveValue("30");
  await fpsInput.fill("60");
  await fpsInput.evaluate((el) => (el as HTMLInputElement).blur()); // number inputs fire change on blur

  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem("cyl1nder.prefs") || "{}"));
  expect(prefs.sync_max_fps).toBe(60);
  await expect.poll(() => syncFps, { timeout: 5000 }).toContain(60);
});

test("Ctrl+S: quick-save snapshot (graph+docking+preference) and prevents browser save", async ({ page }) => {
  const snapshots: Array<Record<string, unknown>> = [];
  await page.route(`**/api/hda/${serial}/snapshot`, (route) => {
    if (route.request().method() === "PUT") snapshots.push(route.request().postDataJSON() as Record<string, unknown>);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, serial }) });
  });
  await openGraph(page);

  // registered AFTER main.ts's handler -> sees the already-prevented event
  await page.evaluate(() => {
    (window as any).__sPrevented = null;
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "s" && (e.ctrlKey || e.metaKey)) (window as any).__sPrevented = e.defaultPrevented;
    });
  });

  await page.keyboard.press("Control+s");

  // the Ctrl+S save carries graph + docking + preference (scheduleSaveGraph only sends graph)
  await expect
    .poll(() => snapshots.filter((s) => s && s.docking && s.preference).length, { timeout: 5000 })
    .toBeGreaterThan(0);
  const saved = snapshots.find((s) => s && s.docking && s.preference)!;
  expect(saved.graph).toBeDefined();
  expect(saved.preference).toMatchObject({
    sync_max_fps: expect.any(Number),
    update_mode: expect.stringMatching(/auto|mouseup/),
  });
  // Chrome's "save webpage" is suppressed
  expect(await page.evaluate(() => (window as any).__sPrevented)).toBe(true);
});

test("Ctrl+Alt+S: triggers Save Scene As (prompt + scene/save mock) and prevents browser save", async ({ page }) => {
  let saveSceneCalls = 0;
  await page.route(`**/api/hda/${serial}/scene/save`, (route) => {
    saveSceneCalls += 1;
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, path: "D:/scenes/" + serial }),
    });
  });
  await mockSnapshot(page);
  await openGraph(page);
  // headless Edge exposes showDirectoryPicker -> saveSceneAs would hang on the native
  // directory chooser. Disable it so save-as falls through to the prompt fallback path.
  await page.evaluate(() => {
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: undefined });
  });
  page.on("dialog", (d) => d.accept("D:/scenes/" + serial));

  await page.evaluate(() => {
    (window as any).__sPrevented = null;
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "s" && (e.ctrlKey || e.metaKey)) (window as any).__sPrevented = e.defaultPrevented;
    });
  });

  await page.keyboard.press("Control+Alt+s");
  await expect.poll(() => saveSceneCalls, { timeout: 5000 }).toBe(1);
  expect(await page.evaluate(() => (window as any).__sPrevented)).toBe(true);
});

test("Viewport background: Ctrl+middle-click on the color row resets to default #1A1A1A", async ({ page }) => {
  // seed a non-default background before load so the reset is observable (P8)
  await page.addInitScript(() => {
    const p = JSON.parse(localStorage.getItem("cyl1nder.prefs") || "{}");
    p.viewport_bg = "#336699";
    localStorage.setItem("cyl1nder.prefs", JSON.stringify(p));
  });
  await mockSnapshot(page);
  await openGraph(page);

  await page.locator('.cyl-menu[data-menu="edit"] .cyl-menu-label').click();
  await page.locator('#cyl-menu-edit button[data-act="preference"]').click();
  const panel = page.locator(".cyl-pref-panel");
  await expect(panel).toBeVisible();
  await panel.locator('.cyl-pref-tab[data-pref-tab="viewport"]').click();
  await expect(panel.locator('[data-pref-pane="viewport"]')).toBeVisible();
  await expect(panel.locator("#cyl-pref-bg-hex")).toHaveText("#336699");

  // Ctrl + middle-click (button===1) on the color row -> reset to default #1A1A1A
  // (hold Control via keyboard: page.mouse modifiers don't set ctrlKey in this driver)
  const box = await panel.locator(".cyl-pref-color").boundingBox();
  if (!box) throw new Error("color row not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.down({ button: "middle" });
  await page.mouse.up({ button: "middle" });
  await page.keyboard.up("Control");

  await expect(panel.locator("#cyl-pref-bg-hex")).toHaveText("#1A1A1A");
  await expect(panel.locator("#cyl-pref-bg-swatch")).toHaveCSS("background-color", "rgb(26, 26, 26)");
});
