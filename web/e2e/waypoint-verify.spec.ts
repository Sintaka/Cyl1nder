import { expect, test } from "@playwright/test";

/**
 * v0.1.00118 验证：waypoint（连线路径中点装饰件）与双击缩放拦截。
 *
 * 刻意**不依赖桥**：其余 e2e 需要 8375 上的活桥推 fixture，桥没起就整体 skip，
 * 于是「dot 不显示」这类纯前端渲染问题永远验不到。这里直接用 __cylGraph
 * 在浏览器里建图，只测渲染与手势。
 */
type Page = import("@playwright/test").Page;

const GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 760, y: 420 },
  ],
  connections: [{ source: "in", sourceOutput: "in0", target: "out", targetInput: "out0" }],
};

/** 必须带 serial：不带的话 `/` 是 Overview 页（没有 .cyl-graph），图根本不挂载。 */
let serial = "";

test.beforeAll(async () => {
  const r = await fetch("http://127.0.0.1:8375/api/serials").catch(() => null);
  const list = r ? ((await r.json()) as string[]) : [];
  serial = process.env.CYL1NDER_E2E_SERIAL || list[list.length - 1] || "";
  test.skip(!serial, "bridge offline or no serial registered");
});

async function boot(page: Page): Promise<void> {
  await page.goto(`http://127.0.0.1:8376/?serial=${serial}`);
  await expect(page.locator(".cyl-graph .cyl-rp-title").first()).toBeVisible({ timeout: 20000 });
  await page.evaluate(async (g) => {
    await (window as never as { __cylGraph: { restoreGraph(x: unknown): Promise<void> } })
      .__cylGraph.restoreGraph(JSON.parse(JSON.stringify(g)));
  }, GRAPH);
  await expect
    .poll(() => page.evaluate(() => (window as never as { __cylGraph: { editor: { getConnections(): unknown[] } } }).__cylGraph.editor.getConnections().length), { timeout: 15000 })
    .toBe(1);
  await fitGraph(page);
}

/** 缩放/平移到整图可见并居中（照 round18/round4）。不 fit 的话节点会盖住整条线，
 *  wirePoint 取不到任何裸露点。 */
async function fitGraph(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const g = (window as never as {
      __cylGraph: {
        editor: { getNodes(): { id: string }[] };
        area: { nodeViews: Map<string, { position: { x: number; y: number } }>; area: { zoom(k: number): Promise<unknown>; translate(x: number, y: number): Promise<unknown> } };
      };
    }).__cylGraph;
    const rect = document.querySelector(".cyl-graph")!.getBoundingClientRect();
    const nodes = g.editor.getNodes();
    const xs = nodes.map((n) => g.area.nodeViews.get(n.id)!.position.x);
    const ys = nodes.map((n) => g.area.nodeViews.get(n.id)!.position.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs) + 300;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + 100;
    const k = Math.min((rect.width - 60) / (maxX - minX), (rect.height - 100) / (maxY - minY), 0.9);
    await g.area.area.zoom(k);
    await g.area.area.translate(rect.width * 0.8 - ((minX + maxX) / 2) * k, rect.height * 0.6 - ((minY + maxY) / 2) * k);
    await new Promise((r) => setTimeout(r, 200));
  });
}

/** 连线上一个未被节点/端口遮挡的屏幕点（照 round18 的取点法）。 */
async function wirePoint(page: Page): Promise<{ id: string; x: number; y: number } | null> {
  return page.evaluate(() => {
    const g = (window as never as { __cylGraph: { area: { connectionViews: Map<string, { element: Element }> } } }).__cylGraph;
    for (const [id, view] of g.area.connectionViews) {
      const path = view.element.querySelector("path") as SVGPathElement | null;
      if (!path || typeof path.getTotalLength !== "function") continue;
      const len = path.getTotalLength();
      const ctm = path.getScreenCTM();
      if (!ctm) continue;
      for (let f = 0.35; f <= 0.65; f += 0.05) {
        const p = path.getPointAtLength(len * f);
        const sp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
        const el = document.elementFromPoint(sp.x, sp.y);
        if (el && !el.closest?.(".cyl-rp-node") && !el.closest?.(".cyl-rp-port")) return { id, x: sp.x, y: sp.y };
      }
    }
    return null;
  });
}

const dotCount = (page: Page) => page.locator('.cyl-graph [data-testid="connection"] circle.cyl-wp-dot').count();
const connCount = (page: Page) =>
  page.evaluate(() => (window as never as { __cylGraph: { editor: { getConnections(): unknown[] } } }).__cylGraph.editor.getConnections().length);
const zoomK = (page: Page) =>
  page.evaluate(() => (window as never as { __cylGraph: { area: { area: { transform: { k: number } } } } }).__cylGraph.area.area.transform.k);

test("bug A: 双击不缩放，滚轮仍缩放", async ({ page }) => {
  await boot(page);
  const before = await zoomK(page);

  // 双击画布空白处
  await page.mouse.dblclick(180, 520);
  await page.waitForTimeout(200);
  expect(await zoomK(page)).toBeCloseTo(before, 6);

  // 双击节点标题。用裸鼠标坐标而不是 locator.dblclick()：dockview 的
  // .dv-void-container 覆盖层会让 Playwright 的 actionability 检查一直判定被遮挡，
  // 而我们要测的恰恰是 rete 的 dblclick 监听器收到事件后有没有缩放。
  const box = await page.locator(".cyl-graph .cyl-rp-title").first().boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForTimeout(200);
  expect(await zoomK(page)).toBeCloseTo(before, 6);

  // 滚轮缩放必须仍然有效（只挡 dblclick，不是关掉 zoom）。
  // 注意：必须在**图元素内**移动鼠标再滚轮，且用相对变化判定——一格滚轮只改约 0.05，
  // 拿固定精度和 fit 之前的 k 比会误判成"没变"。
  const graphBox = await page.locator(".cyl-graph").boundingBox();
  await page.mouse.move(graphBox!.x + graphBox!.width / 2, graphBox!.y + graphBox!.height / 2);
  const beforeWheel = await zoomK(page);
  await page.mouse.wheel(0, -240);
  await expect
    .poll(async () => Math.abs((await zoomK(page)) - beforeWheel) > 1e-4, { timeout: 5000 })
    .toBe(true);
});

test("bug B: Alt+点线生成白点，连接数不变且线不进选中态", async ({ page }) => {
  await boot(page);
  expect(await dotCount(page)).toBe(0);

  const pt = await wirePoint(page);
  expect(pt).not.toBeNull();

  await page.keyboard.down("Alt");
  await page.mouse.click(pt!.x, pt!.y);
  await page.keyboard.up("Alt");

  // 圆点真的渲染出来了（这正是「dot 不显示」的回归点）
  await expect.poll(() => dotCount(page), { timeout: 8000 }).toBe(1);
  // 拓扑不变：仍是一条连接，不是两条半截
  expect(await connCount(page)).toBe(1);
  // 线没有进入选中态（Alt 分支必须在 trackedConnId 之前拦截）
  expect(await page.locator('.cyl-graph [data-testid="connection"] path.cyl-wire-selected').count()).toBe(0);

  // 未接类型的线 -> 圆点是白色
  const fill = await page.locator("circle.cyl-wp-dot").first().evaluate((el) => getComputedStyle(el).fill);
  expect(fill.replace(/\s/g, "")).toBe("rgb(255,255,255)");
});

test("bug B: Alt+拖动点跟手，甩远则删除且连接仍完整", async ({ page }) => {
  await boot(page);
  const pt = await wirePoint(page);
  expect(pt).not.toBeNull();

  // Alt+按下 -> 小幅拖动：点应跟随（waypoint 坐标改变）
  await page.keyboard.down("Alt");
  await page.mouse.move(pt!.x, pt!.y);
  await page.mouse.down();
  await page.mouse.move(pt!.x + 30, pt!.y + 30, { steps: 6 });
  await expect.poll(() => dotCount(page), { timeout: 8000 }).toBe(1);
  const cx1 = await page.locator("circle.cyl-wp-dot").first().getAttribute("cx");
  await page.mouse.move(pt!.x + 60, pt!.y + 55, { steps: 6 });
  await page.waitForTimeout(150);
  const cx2 = await page.locator("circle.cyl-wp-dot").first().getAttribute("cx");
  expect(cx2).not.toBe(cx1);

  // 甩远（> 112px 判定半径）-> 点消失
  await page.mouse.move(pt!.x + 420, pt!.y + 360, { steps: 20 });
  await expect.poll(() => dotCount(page), { timeout: 8000 }).toBe(0);
  await page.mouse.up();
  await page.keyboard.up("Alt");

  // 连接始终完整：一条，且线本体仍在
  expect(await connCount(page)).toBe(1);
  expect(await page.locator('.cyl-graph [data-testid="connection"] path').count()).toBe(1);
});

test("回归：连线本体仍是第一个 path，且命中测试几何可用", async ({ page }) => {
  await boot(page);
  // 自绘连线接管后，这两条是十几处 querySelector("path") 调用点的前提
  const ok = await page.evaluate(() => {
    const g = (window as never as { __cylGraph: { area: { connectionViews: Map<string, { element: Element }> } } }).__cylGraph;
    for (const [, view] of g.area.connectionViews) {
      const first = view.element.querySelector("path") as SVGPathElement | null;
      if (!first) return "no path";
      if (typeof first.getTotalLength !== "function" || first.getTotalLength() <= 0) return "no geometry";
      if (getComputedStyle(first).pointerEvents !== "auto") return "path not hittable";
      if (getComputedStyle(first).fill !== "none") return "fill not none";
    }
    return "ok";
  });
  expect(ok).toBe("ok");
});
