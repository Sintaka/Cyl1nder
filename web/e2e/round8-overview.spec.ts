import { expect, test } from "@playwright/test";

// Round 8: Overview 总管页面（/overview.html）。
// bridge 的 /api/scenes 由并行 agent 实现中：端点未就绪时跳过场景相关断言。
const BASE = "http://127.0.0.1:8376";
const BRIDGE = "http://127.0.0.1:8375";

async function scenesAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE}/api/scenes`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitLoaded(page: import("@playwright/test").Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.getElementById("active-hint")?.textContent ?? ""), { timeout: 15000 })
    .not.toBe("加载中…");
}

test("overview page loads with title, refresh and main-app link", async ({ page }) => {
  await page.goto(`${BASE}/overview.html`);
  await expect(page.locator(".ov-brand")).toContainText("Cyl1nder 总管");
  await expect(page.locator("a.ov-link[href='/']")).toBeVisible();
  await expect(page.locator("button.ov-refresh")).toBeVisible();
  await expect(page.locator("input.ov-new-input")).toBeVisible();
  await expect(page.locator("button.ov-new-button")).toBeVisible();
});

test("overview renders scene lists and creates a new scene", async ({ page }) => {
  test.skip(!(await scenesAvailable()), "bridge /api/scenes not ready");
  await page.goto(`${BASE}/overview.html`);
  await expect(page.locator(".ov-section-heading", { hasText: "活跃场景" })).toBeVisible();
  await expect(page.locator(".ov-section-heading", { hasText: "历史场景" })).toBeVisible();
  await waitLoaded(page);
  // 桥在线且列表可用 -> 无离线/错误横幅
  await expect(page.locator("#ov-banner")).toHaveClass(/hidden/, { timeout: 15000 });
  // 新建场景 -> 跳转主应用 /?serial=...
  await page.locator("input.ov-new-input").fill(`e2e-overview-${Date.now()}`);
  await page.locator("button.ov-new-button").click();
  await expect(page).toHaveURL(/\/\?serial=C1-/, { timeout: 15000 });
});

test("overview open buttons navigate to the main app", async ({ page }) => {
  test.skip(!(await scenesAvailable()), "bridge /api/scenes not ready");
  await page.goto(`${BASE}/overview.html`);
  await waitLoaded(page);
  const openBtn = page.locator("#active-list .ov-open, #history-list .ov-open").first();
  test.skip((await openBtn.count()) === 0, "no scenes listed");
  await openBtn.click();
  await expect(page).toHaveURL(/\/\?serial=C1-/, { timeout: 15000 });
});

test("overview shows a banner when /api/scenes is unavailable", async ({ page }) => {
  test.skip(await scenesAvailable(), "bridge /api/scenes available; unavailable-banner not testable");
  await page.goto(`${BASE}/overview.html`);
  // 桥离线 -> .offline；桥在线但接口 404 -> .error
  await expect(page.locator("#ov-banner.offline, #ov-banner.error")).toBeVisible({ timeout: 15000 });
});
