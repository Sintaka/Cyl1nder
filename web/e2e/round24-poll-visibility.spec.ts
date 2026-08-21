import { expect, test } from "@playwright/test";
import { gotoMember } from "./fixtures";

/**
 * 图外引用轮询的**可见性接线**常驻回归。
 *
 * 为什么必须有这个文件：`core/poll-loop.ts` 的 `isHidden` / `onVisibilityChange` 两个依赖
 * 在 vitest 里**只被注入的假实现跑过**（那边是 `environment: "node"`，压根没有 DOM）。
 * 于是「监听器真的挂在 `document` 上吗」「读的属性名对吗」「真实 `visibilitychange`
 * 事件能不能到达循环」三件事从未被执行验证过 —— 正是本仓反复记的那条
 * 「测试全绿不等于代码被执行过」。
 *
 * **这个 spec 能证明**：监听器确实挂在 `document` 上；`isHidden` 读的是真属性；
 * 隐藏 → 不发请求；可见 → 立刻补一次。
 * **不能证明**：Chrome 自己的 intensive throttling（那是 Chrome 的行为、不是我们的，
 * 且要几分钟才观察得到）。这里覆盖的是**我们这一侧**的接线。
 *
 * 设计上刻意用 `page.route` 拦下取值请求：桥不必真有这个逻辑名，断言也就与环境无关。
 */
const SERIAL = "C1-e2evis01-0001"; // 中段必须**恰好 8 字符**（守门正则，v0.1.00143）
const IN_PORT = "e2e_vis/tx";

const flags = { display: false, bypass: false, freeze: false, reference: false };
const P = (name: string, value: unknown) => ({ name, type: "string", value });

/** 轮询只在图里**有可达的图外引用**时才武装：`_input_` 自己的 `port` 参数就是那个
 *  图外逻辑名，而可达性从 `_output_` 沿入线往上算 —— 所以要 `_input_ → _output_`
 *  （正是 Shift+Enter 造出来的形状）。 */
const SNAPSHOT = {
  schemaVersion: 5,
  viewport: { k: 1, x: 0, y: 0 },
  nodes: [
    {
      id: "vis_in", kind: "input", label: "_input_", baseLabel: "_input_", flags, x: 40, y: 40,
      params: [P("address", SERIAL), P("type", "float"), P("port", IN_PORT)],
    },
    {
      id: "vis_out", kind: "output", label: "_output_", baseLabel: "_output_", flags, x: 320, y: 40,
      params: [P("address", SERIAL), P("type", "float"), P("port", "e2e_vis/out")],
    },
  ],
  // 端口键**按角色**命名而不是按方向：`_input_` 的输出键是 `in0`
  // （graph-model.ts:927 `addOutput("in0")`），`_output_` 的输入键是 `out0`（同文件 :938）。
  // 我第一版按方向写成 `out0 → out0`，rete 直接报「source node doesn't have output with a key out0」。
  connections: [{ source: "vis_in", sourceOutput: "in0", target: "vis_out", targetInput: "out0" }],
};

/** 拦下映射取值请求，记下每次 GET 的时刻。返回取快照的函数。 */
async function captureGets(page: import("@playwright/test").Page) {
  const gets: number[] = [];
  await page.route("**/api/projects/*/mappings/**/value", async (route) => {
    if (route.request().method() === "GET") {
      gets.push(Date.now());
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"value":1.5}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  return () => gets.slice();
}

/** `document.visibilityState` 是只读的 → 覆盖它并派发**真实** DOM 事件。
 *  这个保真度正好：走的是我们自己的监听器、我们自己的属性读、真 `document` 上的真事件。
 *  （Chrome 自己的节流没有被模拟，见文件头。） */
async function setVisibility(page: import("@playwright/test").Page, state: "hidden" | "visible") {
  await page.evaluate((v) => {
    Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

async function buildExternRefGraph(page: import("@playwright/test").Page) {
  await expect(page.locator(".cyl-graph")).toBeVisible({ timeout: 20000 });
  await page.evaluate(async (snap) => {
    await (window as never as { __cylGraph: { restoreGraph(d: unknown): Promise<void> } }).__cylGraph.restoreGraph(snap);
  }, SNAPSHOT);
  // 写回/预取挂在 flushStoreView 上 → 敲一次日志就能触发首轮。
  await page.evaluate(() => (window as never as { __cylStore: { pushLog(s: string): void } }).__cylStore.pushLog("[e2e] kick"));
}

test("前台确实在轮询，且周期回到 ~2.12s（不是漏拍后的 ~4.24s）", async ({ page }) => {
  const gets = await captureGets(page);
  await gotoMember(page, SERIAL);
  await buildExternRefGraph(page);

  await expect.poll(() => gets().length, { timeout: 15000 }).toBeGreaterThanOrEqual(2);

  const seen = gets();
  const gap = seen[1] - seen[0];
  // 模型是 TTL 2000 + 去抖 120 = 2120ms（实测 2128/2130/2131ms，吻合到 ~10ms）。
  // **上界 3500ms 是承重的**：漏拍回归会让周期变成 ~4240ms，这条断言必须抓住它。
  expect(gap).toBeLessThan(3500);
});

test("隐藏不发请求；变可见立刻补一次（两条一起断言：顺序本身就是要点）", async ({ page }) => {
  const gets = await captureGets(page);
  await gotoMember(page, SERIAL);
  await buildExternRefGraph(page);
  await expect.poll(() => gets().length, { timeout: 15000 }).toBeGreaterThanOrEqual(1);

  // --- 隐藏 → 静默 ---
  await setVisibility(page, "hidden");
  const beforeHidden = gets().length;
  await page.waitForTimeout(6000);
  // 修前：隐藏标签页仍会每 ~120s 打一次桥（实测 120.251s，n=6）。
  // 现在应当是**零请求**。变异测试（把 isHidden 改成恒 false）实测这里会变成 3 次。
  expect(gets().length - beforeHidden).toBe(0);

  // --- 变可见 → 立刻追赶 ---
  const beforeVisible = gets().length;
  const t0 = Date.now();
  await setVisibility(page, "visible");
  await expect.poll(() => gets().length, { timeout: 4000 }).toBeGreaterThan(beforeVisible);
  const latency = gets()[gets().length - 1] - t0;
  // **1200ms 这个上界是承重的，不要放宽**：轮询间隔本身是 2000ms，所以远在窗口内
  // 到达的请求**只可能**来自可见时的立即追赶，不可能是排定的那一拍。
  // 实测干净态 123/127ms；去掉追赶后实测退化到 1899ms（= 自然 TTL 节奏）→ 这条会红。
  expect(latency).toBeLessThan(1200);
});
