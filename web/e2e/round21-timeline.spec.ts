import { expect, test } from "@playwright/test";

/**
 * Round 21 (Phase A 本地时间轴 web UI 骨架): 页面加载后底部栏出现
 * `.cyl-timeline`；通过 `window.__cylTimeline` 注入 captureFrame(1, 假
 * InputPayload) + setFrame(1) 后，store.inputs 长度变化；再 step(1) 后
 * frame 变化。本轮只连已在跑的 8376 dev server，不另起 vite；不依赖 live
 * Houdini / bridge 栈，仅验证 web UI 与 timeline 控制器接线。
 */

const FAKE_INPUT = {
  index: 0,
  name: "in0",
  pointCount: 1,
  primCount: 1,
  points: [[0, 0, 0]],
  curves: [],
  attributes: {},
};

async function gotoApp(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("http://127.0.0.1:8376/");
}

test("bottom bar timeline renders; captureFrame + setFrame updates store inputs; step advances frame", async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator(".cyl-timeline")).toBeVisible({ timeout: 15000 });

  const initialInputCount = await page.evaluate(() => (window as any).__cylStore.inputs.length);
  await page.evaluate((inp) => {
    const tl: any = (window as any).__cylTimeline;
    tl.captureFrame(1, [inp]);
    tl.setFrame(1);
  }, FAKE_INPUT);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylStore.inputs.length), { timeout: 5000 })
    .toBe(initialInputCount + 1);

  const frameBefore = Number(await page.evaluate(() => (window as any).__cylTimeline.frame));
  await page.evaluate(() => (window as any).__cylTimeline.step(1));
  const frameAfter = Number(await page.evaluate(() => (window as any).__cylTimeline.frame));
  expect(frameAfter).toBe(frameBefore + 1);
});
