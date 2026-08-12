import { expect, test } from "@playwright/test";

// Round 11: 左上角品牌 "Cyl1nder 0.1" 点击跳转 Overview（用户原话）。
// 需要在线 serial 才能进入主应用：bridge(8375) 不可用或没有 serial 时整文件跳过。
const BASE = "http://127.0.0.1:8376";
const BRIDGE = "http://127.0.0.1:8375";

let serial = "";

test.beforeAll(async () => {
  try {
    const health = await fetch(`${BRIDGE}/api/health`);
    if (!health.ok) throw new Error("bridge not ok");
    const serials: string[] = await fetch(`${BRIDGE}/api/serials`).then((r) => r.json());
    serial =
      process.env.CYL1NDER_E2E_SERIAL ||
      serials.find((s) => s === "C1-e2etest0001-aaaa") ||
      serials[serials.length - 1] ||
      "";
  } catch {
    serial = "";
  }
  test.skip(!serial, "no serial available (bridge down or empty)");
});

test("clicking .cyl-brand opens Overview in a NEW tab (v0.1.00060)", async ({ page }) => {
  await page.goto(`${BASE}/?serial=${serial}`);
  // 主应用加载（带 serial 不应被重定向到 overview）
  await expect(page.locator(".cyl-app")).toBeVisible({ timeout: 15000 });
  const brand = page.locator(".cyl-brand");
  await expect(brand).toContainText("Cyl1nder");
  await expect(brand.locator("small")).toHaveText("0.1");
  // 点击品牌 -> 新标签页打开 overview，原页保持主应用（不再是本页面跳转）
  const [popup] = await Promise.all([page.waitForEvent("popup"), brand.click()]);
  await expect(popup).toHaveURL(/\/overview\.html/, { timeout: 15000 });
  await expect(popup.locator(".ov-brand")).toContainText("Cyl1nder 总管");
  await expect(page.locator(".cyl-app")).toBeVisible({ timeout: 15000 });
});