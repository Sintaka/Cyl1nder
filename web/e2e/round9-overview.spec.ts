import { expect, test } from "@playwright/test";
import { projectForSerial } from "./fixtures";

// Round 9: Overview 总管页迭代 —— 默认入口重定向 / 新建区块置顶 / 三态状态 / 清理无效场景 / 主应用链接。
// bridge 的 lastActivity 字段与 POST /api/scenes/cleanup 由并行 agent 实现中：
// 端点未就绪（404）时相关用例跳过；就绪时用 page.route 注入固定数据做确定性断言。
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

/** POST-only 路由用 GET 探测：404=未实现；405/200=已实现（无副作用）。 */
async function cleanupEndpointAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE}/api/scenes/cleanup`);
    return res.status !== 404;
  } catch {
    return false;
  }
}

async function waitLoaded(page: import("@playwright/test").Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.getElementById("active-hint")?.textContent ?? ""), { timeout: 15000 })
    .not.toBe("加载中…");
}

test("bare / redirects to /overview.html (default entry)", async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page).toHaveURL(/\/overview\.html/, { timeout: 15000 });
  await expect(page.locator(".ov-brand")).toContainText("Cyl1nder 总管");
  // 重定向路径上不应加载主应用
  await expect(page.locator(".cyl-app")).toHaveCount(0);
});

test("/?serial=C1-... IS redirected to Overview (serial is no longer a page address)", async ({ page }) => {
  // v0.1.00120 的核心断言：基于 serial 的页面入口已删除。老书签落到入口守卫上被送回
  // Overview（那里能查出它属于哪个项目再进），**不会**再加载主应用。
  await page.goto(`${BASE}/?serial=C1-e2eround9-0001`);
  await expect(page).toHaveURL(/\/overview\.html/, { timeout: 15000 });
  await expect(page.locator(".ov-brand")).toContainText("Cyl1nder 总管");
  await expect(page.locator(".cyl-app")).toHaveCount(0);
});

test("/?project=P1-…&member=C1-… loads the member workspace (the replacement entry)", async ({ page }) => {
  const serial = "C1-e2eround9-0001";
  const pid = await projectForSerial(serial);
  await page.goto(`${BASE}/?project=${pid}&member=${serial}`);
  await expect(page).toHaveURL(new RegExp(`[?&]member=${serial}`), { timeout: 15000 });
  await expect(page.locator(".cyl-app")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#cyl-serial")).toHaveValue(serial);
  await expect(page.locator(".ov-brand")).toHaveCount(0);
  // 地址栏两段 /P1-…/C1-…/：成员只作为「项目的成员」可达，这正是替代 serial 页面入口的形态
  await expect(page.locator(".cyl-graph-addr")).toContainText(`${pid}/${serial}`, { timeout: 15000 });
});

test("projects block is on top; mappings second; scenes demoted to a collapsed diag section", async ({ page }) => {
  await page.goto(`${BASE}/overview.html`);
  // v0.1.00114 项目优先：项目 -> 映射 -> 场景（诊断，<details> 默认折叠）
  const panels = page.locator(".ov-main > section, .ov-main > details");
  await expect(panels.nth(0)).toHaveId("projects-panel");
  await expect(panels.nth(1)).toHaveId("mappings-panel");
  await expect(panels.nth(2)).toHaveId("scenes-panel");
  // 场景诊断区默认折叠 -> 里面的清理按钮初始不可见，但仍在 DOM 上
  await expect(page.locator("#scenes-panel")).not.toHaveAttribute("open", /.*/);
  await expect(page.locator("button#ov-cleanup")).toBeAttached();
  await expect(page.locator("span#ov-cleanup-result")).toBeAttached();
  // 项目区自己的清理入口（独立类名，避免与场景区 .ov-cleanup 撞 strict locator）
  await expect(page.locator("button#projects-cleanup")).toBeVisible();
  await expect(page.locator("a.ov-link")).toBeVisible();
});

test("scenes diag section expands to reveal the scene controls", async ({ page }) => {
  await page.goto(`${BASE}/overview.html`);
  await page.locator("#scenes-panel > summary").click();
  await expect(page.locator("#scenes-panel")).toHaveAttribute("open", /.*/);
  await expect(page.locator("button#ov-cleanup")).toBeVisible();
  await expect(page.locator("input.ov-new-input")).toBeVisible();
});

test("main-app link opens the app without bouncing back to overview", async ({ page }) => {
  await page.goto(`${BASE}/overview.html`);
  await page.locator("a.ov-link").click();
  // 有项目 -> /?project=P1-…；完全没有项目 -> 留在 Overview（主应用现在只能按项目打开，
  // 而「新建项目」就在本页，停在这里正是用户下一步该在的地方）。
  await expect(page).toHaveURL(/(\/\?project=P1-|\/overview\.html)/, { timeout: 15000 });
  await expect(page.locator(".cyl-app")).toBeVisible({ timeout: 15000 });
});

test("active rows render three states: offline / uncooked / online", async ({ page }) => {
  test.skip(!(await scenesAvailable()), "bridge /api/scenes not ready");
  const now = Math.floor(Date.now() / 1000);
  await page.route("**/api/scenes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        active: [
          // lastSeen 过期 -> 离线（150s 阈值下 now-300 仍判离线）
          { serial: "C1-e2eround9-0001", label: "offline-scene", nodePath: "/obj/off", lastSeen: now - 300, lastActivity: now - 60, inputRev: 1, outputRev: 1 },
          // lastSeen 新鲜但 lastActivity 陈旧 -> 未cook
          { serial: "C1-e2eround9-0002", label: "stale-activity", nodePath: "/obj/stale", lastSeen: now - 2, lastActivity: now - 10, inputRev: 1, outputRev: 0 },
          // lastSeen 新鲜、lastActivity 缺失/0、rev 全 0 -> 未cook
          { serial: "C1-e2eround9-0003", label: "never-cooked", nodePath: "/obj/never", lastSeen: now - 2, lastActivity: 0, inputRev: 0, outputRev: 0 },
          // 都新鲜 -> 在线
          { serial: "C1-e2eround9-0004", label: "online-scene", nodePath: "/obj/on", lastSeen: now - 2, lastActivity: now - 2, inputRev: 3, outputRev: 2 },
        ],
        history: [],
      }),
    }),
  );
  await page.goto(`${BASE}/overview.html`);
  await page.locator("#scenes-panel > summary").click(); // 场景区默认折叠
  await waitLoaded(page);
  await expect(page.locator("#active-list .ov-row")).toHaveCount(4);
  await expect(page.locator("#active-list .ov-seen.offline .ov-state")).toHaveText("离线");
  await expect(page.locator("#active-list .ov-seen.uncooked .ov-state")).toHaveText(["未cook", "未cook"]);
  await expect(page.locator("#active-list .ov-seen.online .ov-state")).toHaveText("在线");
});

test("cleanup button calls POST /api/scenes/cleanup and re-renders with result", async ({ page }) => {
  test.skip(!(await cleanupEndpointAvailable()), "bridge /api/scenes/cleanup not ready");
  let scenesGets = 0;
  await page.route("**/api/scenes", (route) => {
    if (route.request().method() === "GET") scenesGets += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ active: [], history: [] }),
    });
  });
  await page.route("**/api/scenes/cleanup", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, removed: ["C1-e2eround9-aaaa", "C1-e2eround9-bbbb"] }),
    }),
  );
  await page.goto(`${BASE}/overview.html`);
  await page.locator("#scenes-panel > summary").click(); // 场景区默认折叠
  await waitLoaded(page);
  await page.locator("#ov-cleanup").click();
  await expect(page.locator("#ov-cleanup-result")).toHaveText(/已清理 2 个无效场景/);
  await expect(page.locator("#ov-cleanup-result")).toContainText("C1-e2eround9-aaaa");
  // 成功后重新拉取渲染：/api/scenes 至少请求 2 次（初始 + 清理后）
  await expect.poll(() => scenesGets, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#ov-cleanup")).toBeEnabled();
  await expect(page.locator("#ov-cleanup")).toHaveText("清理无效场景");
});
