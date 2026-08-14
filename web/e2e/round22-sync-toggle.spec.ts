import { expect, test } from "@playwright/test";

/**
 * Round 22 (Phase B 手动双向同步开关 web UI 骨架): 底部栏出现
 * `#cyl-sync-enabled`；默认 OFF（本地模式，零 /stream、零 push、无回显）。
 * 点击开关后 localStorage `cyl1nder.prefs` 的 `sync_enabled` 翻为 true，
 * `window.__cylSync.isEnabled()` 同步为 true；再关回 false。
 * 本轮只连已在跑的 8376 dev server，不另起 vite；不依赖 live
 * Houdini / bridge 栈，仅验证开关 UI 与 main.ts 接线。
 */

async function gotoApp(page: import("@playwright/test").Page): Promise<void> {
  // index.html 在无 ?serial= 时重定向 Overview；带稳定 e2e serial 才进入主应用
  await page.goto("http://127.0.0.1:8376/?serial=C1-e2etest0001-aaaa");
}

async function readPrefsSyncEnabled(page: import("@playwright/test").Page): Promise<boolean | undefined> {
  return page.evaluate(() => {
    const raw = (window as any).localStorage.getItem("cyl1nder.prefs") || "{}";
    return JSON.parse(raw).sync_enabled;
  });
}

test("sync toggle defaults OFF; click persists prefs and __cylSync state", async ({ page }) => {
  await gotoApp(page);

  const toggle = page.locator("#cyl-sync-enabled");
  await expect(toggle).toBeVisible({ timeout: 15000 });
  await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(() => (window as any).__cylSync?.isEnabled?.() ?? false)).toBe(false);

  // 点击 checkbox 打开双向同步
  await toggle.check();
  await expect
    .poll(() => readPrefsSyncEnabled(page), { timeout: 5000 })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylSync?.isEnabled?.() ?? false), { timeout: 5000 })
    .toBe(true);

  // 再关回 OFF
  await toggle.uncheck();
  await expect
    .poll(() => readPrefsSyncEnabled(page), { timeout: 5000 })
    .toBe(false);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylSync?.isEnabled?.() ?? false), { timeout: 5000 })
    .toBe(false);
});
