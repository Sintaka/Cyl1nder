import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoMember } from "./fixtures";

/**
 * 通道参数面板的**用户可见层**回归（v0.1.00168/00169 那批改动的验收）。
 *
 * 为什么必须有这个文件：那批改动（vec3 行三个 number 框、`dotStateFor` 逐行状态点）
 * 在 vitest 里**只有纯函数单测** —— 那边是 `environment: "node"` 且没装 jsdom，
 * `buildRow` 这类碰 `document` 的部分压根测不了。而我 grep 过：改这批之前
 * 整个 `web/e2e` 里 `cyl-channel` **零命中**，也就是说「e2e 108 条全绿」
 * 与这批改动**没有交集**（in-progress §-47）。
 *
 * **这个 spec 能证明**：vec3 行真的渲染成三个 number 框；改一格真的推出**数字数组**
 * 且未编辑的分量取自当前值；同批里别的通道失败**不会连坐**把这行点染红。
 * **不能证明**：桥侧行为（那是 pytest 的事）、CSS 观感。
 *
 * 三个端点全部用 `page.route` 拦掉：桥不必真有这些通道，断言与环境无关。
 */
const SERIAL = "C1-e2echan1-0001"; // 中段必须**恰好 8 字符**（守门正则，v0.1.00143）
const VEC_PATH = "/obj/geo1/e2e_xf/t";
const NUM_PATH = "/obj/geo1/e2e_xf/scale";

const VEC0: [number, number, number] = [1.5, 2.5, 3.5];
const NUM0 = 7.25;

/** 面板只收 `kind==="param"` 且 `serial` 匹配、且有 `absolutePath` 的条目
 *  （channel-panel.ts:388）。`type` 声明为 vec3 时首屏就出三格，不等首个值到达。 */
const CHANNELS = {
  channels: [
    { kind: "param", serial: SERIAL, absolutePath: VEC_PATH, type: "vec3" },
    { kind: "param", serial: SERIAL, absolutePath: NUM_PATH, type: "float" },
  ],
};

/** PUT 的响应由每个用例自己决定 —— 这是三条断言里唯一需要变的东西。 */
type PutReply = { status?: number; body: string };

/** 抓到的 PUT body（`values` 那一层），按到达顺序。 */
type PutCapture = Record<string, unknown>[];

/**
 * 拦掉面板依赖的三个端点，并抓下每次 PUT 的 body。
 *
 * 注意 GET channel-values 必须回**当前值**：面板 250ms 轮询会用它覆盖非编辑行，
 * 如果这里恒回初值，改完格子下一拍就被打回去，断言会变成时序赌博。
 * 所以用一个可变的 `current`，PUT 进来就更新它 —— 模拟一个真的存住了的桥。
 */
async function stubPanelEndpoints(page: Page, reply: () => PutReply): Promise<PutCapture> {
  const puts: PutCapture = [];
  const current: Record<string, unknown> = { [VEC_PATH]: [...VEC0], [NUM_PATH]: NUM0 };

  await page.route("**/api/channels", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CHANNELS) });
  });

  await page.route("**/api/hda/*/channel-values", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, values: current }),
      });
      return;
    }
    // PUT：记下 values 层，按用例给的应答回复；成功语义下同时更新 current。
    const sent = (req.postDataJSON() as { values?: Record<string, unknown> } | null)?.values ?? {};
    puts.push(sent);
    const r = reply();
    if ((r.status ?? 200) === 200) {
      let failed: Record<string, string> = {};
      try {
        failed = (JSON.parse(r.body) as { failed?: Record<string, string> }).failed ?? {};
      } catch {
        failed = {};
      }
      for (const [k, v] of Object.entries(sent)) if (!(k in failed)) current[k] = v;
    }
    await route.fulfill({ status: r.status ?? 200, contentType: "application/json", body: r.body });
  });

  return puts;
}

/** 行定位：label 的 `title` 是全量 absolutePath（channel-panel.ts:298），
 *  比按可见文本（只有尾段、两行会撞）稳。 */
function rowOf(page: Page, path: string) {
  return page.locator(".cyl-channel-row").filter({ has: page.locator(`.cyl-channel-label[title="${path}"]`) });
}

/**
 * 先激活「通道参数」tab，再等两行渲染出来。
 *
 * **这一步不能省**：Default.json 里 channel 与 inspector/param 同在一个 leaf，
 * `activeView` 是 `inspector`；dockview 会把非活动 tab 的内容元素**从 DOM 摘掉**，
 * 于是行压根不存在（我第一版漏了这步，三条全挂在 `element(s) not found`）。
 * 面板自己的 `isVisible` 也依赖 `container.isConnected`（dock.ts:214）——
 * tab 不激活时它连轮询都不武装，所以这既是「看得见」也是「跑起来」的前提。
 * 点 tab 而不是调 `__cylDv` 的原因：这正是用户的路径，顺带覆盖了 tab 激活本身。
 */
async function waitForPanel(page: Page): Promise<void> {
  // 按**面板 id** 激活，不按 tab 标题。
  // 起因：写本 spec 时同一个面板在两条路径上标题不一样 —— 程序化布局是 `通道参数`
  // （dock.ts:555），而 `layouts/Default.json` 里是 `Channels 参数`。e2e 空 localStorage
  // 起页面走 Default.json，于是按 `通道参数` 找 tab 一个也找不到（我第二版栽在这）。
  // v0.1.00179 已把 Default.json 统一成 `通道参数`，但**这里仍然按 id 找**：
  // id（`channel`）是接线契约，标题是显示字符串，随时可能为了 UI 再改一次 ——
  // 测试不该拴在显示层上。
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const dv = (window as never as {
            __cylDv?: { api?: { getPanel?(id: string): { api: { setActive(): void } } | undefined } };
          }).__cylDv;
          const p = dv?.api?.getPanel?.("channel");
          if (!p) return false;
          p.api.setActive();
          return true;
        }),
      { timeout: 20000 },
    )
    .toBe(true);
  await expect(rowOf(page, VEC_PATH)).toBeVisible({ timeout: 20000 });
  await expect(rowOf(page, NUM_PATH)).toBeVisible({ timeout: 20000 });
}

test("tab 标题两条布局路径一致（v0.1.00179 统一；曾是 Channels 参数 vs 通道参数）", async ({ page }) => {
  await stubPanelEndpoints(page, () => ({ body: '{"ok":true}' }));
  await gotoMember(page, SERIAL);
  await waitForPanel(page);

  // e2e 空 localStorage → 走 layouts/Default.json 那条路径；面板自身表头走 dock/panel 代码。
  // 两处必须同名，否则就是我写本 spec 时踩到的那个不一致（当时 Default.json 是 `Channels 参数`）。
  const tabTitles = await page.$$eval(".dv-tab", (els) => els.map((e) => (e.textContent ?? "").trim()));
  expect(tabTitles).toContain("通道参数");
  expect(tabTitles).not.toContain("Channels 参数");
  await expect(page.locator(".cyl-channel-head")).toHaveText("通道参数");
});

test("vec3 行渲染成三个 number 框，三格分别是三个分量（不是一个逗号串 text 框）", async ({ page }) => {
  await stubPanelEndpoints(page, () => ({ body: '{"ok":true}' }));
  await gotoMember(page, SERIAL);
  await waitForPanel(page);

  const vecInputs = rowOf(page, VEC_PATH).locator("input");
  await expect(vecInputs).toHaveCount(3);
  for (const [i, want] of VEC0.entries()) {
    await expect(vecInputs.nth(i)).toHaveAttribute("type", "number");
    await expect(vecInputs.nth(i)).toHaveValue(String(want));
  }

  // 对照组：float 行仍是**一个** number 框 —— 证明上面的 3 不是「所有行都三格」。
  const numInputs = rowOf(page, NUM_PATH).locator("input");
  await expect(numInputs).toHaveCount(1);
  await expect(numInputs.nth(0)).toHaveAttribute("type", "number");
  await expect(numInputs.nth(0)).toHaveValue(String(NUM0));
});

test("改 vec3 的一格 → PUT 推数字数组，未编辑的两个分量取自当前值（不是字符串、不从兄弟框反解）", async ({ page }) => {
  const puts = await stubPanelEndpoints(page, () => ({ body: '{"ok":true}' }));
  await gotoMember(page, SERIAL);
  await waitForPanel(page);

  // 只改中间那格；change 事件触发 pending，flush 由面板节流（1000/fps）自己发。
  await rowOf(page, VEC_PATH).locator("input").nth(1).fill("9.75");
  await rowOf(page, VEC_PATH).locator("input").nth(1).dispatchEvent("change");

  await expect.poll(() => puts.length, { timeout: 10000 }).toBeGreaterThan(0);

  const sent = puts[0][VEC_PATH];
  // 逐条断言而不是深比较：断言失败时要能一眼看出坏在「不是数组」还是「分量错」。
  expect(Array.isArray(sent)).toBe(true);
  const arr = sent as unknown[];
  expect(arr).toHaveLength(3);
  for (const v of arr) expect(typeof v).toBe("number");
  expect(arr[1]).toBe(9.75);
  expect(arr[0]).toBe(VEC0[0]); // 未编辑分量 = 当前值
  expect(arr[2]).toBe(VEC0[2]);
});

test("同批里别的通道失败，不能连坐把这一行的点染红（缺陷 B 的用户可见验收）", async ({ page }) => {
  // 桥的逐通道回报：只有 NUM_PATH 失败。VEC_PATH 在同一批里、且不在 failed 中 → 必须是 ok。
  const failBody = JSON.stringify({ ok: false, failed: { [NUM_PATH]: "ValueError: boom" } });
  await stubPanelEndpoints(page, () => ({ body: failBody }));
  await gotoMember(page, SERIAL);
  await waitForPanel(page);

  // 同一个 flush 窗口里改两行，凑出「混批」。
  await rowOf(page, VEC_PATH).locator("input").nth(0).fill("4.5");
  await rowOf(page, VEC_PATH).locator("input").nth(0).dispatchEvent("change");
  await rowOf(page, NUM_PATH).locator("input").nth(0).fill("8.5");
  await rowOf(page, NUM_PATH).locator("input").nth(0).dispatchEvent("change");

  const numDot = rowOf(page, NUM_PATH).locator(".cyl-channel-dot");
  const vecDot = rowOf(page, VEC_PATH).locator(".cyl-channel-dot");

  // 失败那行确实变红（先等它，说明这一批已经结算过了，再看另一行才有意义）。
  await expect(numDot).toHaveClass(/error/, { timeout: 10000 });
  // 成功那行**不带 error**。这条就是缺陷 B：整批共用一个 r.ok 时它会跟着红。
  await expect(vecDot).not.toHaveClass(/error/);
});
