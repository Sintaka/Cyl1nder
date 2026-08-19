import { expect, test } from "@playwright/test";

/**
 * v0.1.00119 验证：obj/sop 层级（task #4）在**真实浏览器**里的往返。
 *
 * 为什么必须有这个：上一轮的教训是「tsc 0 + vitest 全绿」不构成 UI 验证——
 * fling 手势在单测全绿的情况下完全不工作。层级涉及双击手势、图交换、地址栏，
 * 这三样都只有在浏览器里才成立。
 *
 * 与 waypoint-verify 同样刻意**只依赖 __cylGraph**（不推桥 fixture），
 * 但需要一个 serial 才能挂载图（不带 serial 时 `/` 是 Overview 页）。
 */
type Page = import("@playwright/test").Page;

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
}

/** 建一个 geo 节点。
 *
 *  **不能用 `await import("/src/...")` 驱动层级 API**：实测那样拿到的是**另一个模块
 *  实例**，函数都在但 activeGraph/netStack 是空的（探针实录
 *  `{"modHasEnter":"function","fromRootIsNull":true,"netPathLen":0,"appSerializeIsNull":false}`）。
 *  所以层级一律走 `__cylHier`（main.ts 挂出的**应用自己那份实例**）。
 *  只有构造节点这一步用动态 import——它是纯工厂，不依赖模块级状态。 */
async function addGeo(page: Page, label?: string): Promise<string> {
  return page.evaluate(async (want) => {
    const w = window as never as {
      __cylGraph: { editor: { addNode(n: unknown): Promise<unknown> } };
    };
    const mod = (await import("/src/nodes2/graph-model.ts")) as { makeGeoNode(): { id: string; label: string } };
    const n = mod.makeGeoNode();
    if (want) n.label = want;
    await w.__cylGraph.editor.addNode(n);
    return n.id;
  }, label);
}

interface Hier {
  enter(nodeId: string): Promise<boolean>;
  exitOnce(): Promise<boolean>;
  exitTo(depth?: number): Promise<void>;
  getNetPath(): string[];
  getNetKind(): "obj" | "sop";
  serializeFromRoot(): unknown;
}
const hier = (page: Page) => ({
  netPath: () => page.evaluate(() => (window as never as { __cylHier: Hier }).__cylHier.getNetPath()),
  netKind: () => page.evaluate(() => (window as never as { __cylHier: Hier }).__cylHier.getNetKind()),
});

const netPath = (page: Page) => hier(page).netPath();

const nodeLabels = (page: Page) =>
  page.evaluate(() =>
    (window as never as { __cylGraph: { editor: { getNodes(): Array<{ label: string }> } } })
      .__cylGraph.editor.getNodes().map((n) => n.label),
  );

/** 进入 / 退出：走 __cylHier 的 await 包装——它在**层级回调落地之后**才 resolve，
 *  所以测试不需要 sleep 猜时机（裸 enterNode/exitNode 同步返回、交换在内部 async IIFE 里）。 */
const enter = (page: Page, nodeId: string): Promise<boolean> =>
  page.evaluate((id) => (window as never as { __cylHier: Hier }).__cylHier.enter(id), nodeId);

const exit = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as never as { __cylHier: Hier }).__cylHier.exitOnce());

test("进入 geo 子网络 → 空图（不是默认 in/out 对），退出后父图完整回来", async ({ page }) => {
  await boot(page);
  const geoId = await addGeo(page, "geoHier1");
  expect(await netPath(page)).toEqual([]); // 顶层

  expect(await hier(page).netKind()).toBe("obj"); // 顶层是 obj 层

  expect(await enter(page, geoId)).toBe(true);
  expect(await netPath(page)).toEqual(["geoHier1"]);
  expect(await hier(page).netKind()).toBe("sop"); // 进 geo 之后才是 sop
  // 首次进入必须是**空图**：用户要求新场景下面不自动创建任何东西
  expect(await nodeLabels(page)).toEqual([]);

  expect(await exit(page)).toBe(true);
  expect(await netPath(page)).toEqual([]);
  // 父图回来了，且那个 geo 还在
  expect(await nodeLabels(page)).toContain("geoHier1");
});

test("子网络里的编辑在退出→再进入之后仍然在（children 往返）", async ({ page }) => {
  await boot(page);
  const geoId = await addGeo(page, "geoHier2");
  await enter(page, geoId);

  // 在子网络里建一个 null 作为标记
  await page.evaluate(async () => {
    const mod = (await import("/src/nodes2/graph-model.ts")) as { makeNullNode(): { id: string; label: string } };
    const n = mod.makeNullNode();
    n.label = "innerMark";
    await (window as never as { __cylGraph: { editor: { addNode(x: unknown): Promise<unknown> } } })
      .__cylGraph.editor.addNode(n);
  });
  expect(await nodeLabels(page)).toContain("innerMark");

  await exit(page);
  expect(await nodeLabels(page)).not.toContain("innerMark"); // 顶层看不到子图内容

  // 再进去：标记必须还在（exitNode 把子图写回了 children）
  const again = await page.evaluate(
    () =>
      (window as never as { __cylGraph: { editor: { getNodes(): Array<{ id: string; label: string }> } } })
        .__cylGraph.editor.getNodes().find((n) => n.label === "geoHier2")?.id ?? "",
  );
  expect(again).not.toBe("");
  await enter(page, again);
  expect(await nodeLabels(page)).toContain("innerMark");
});

test("在子网络里保存也存顶层完整图（serializeGraphFromRoot 折叠）", async ({ page }) => {
  await boot(page);
  const geoId = await addGeo(page, "geoHier3");
  await enter(page, geoId);

  // 身处子网络时取快照：必须是**父图**（含那个 geo），而不是只含子图内容
  const snap = (await page.evaluate(
    () => (window as never as { __cylHier: Hier }).__cylHier.serializeFromRoot(),
  )) as { nodes: Array<{ id: string; label: string; kind: string; children?: unknown }> };

  const host = snap.nodes.find((n) => n.label === "geoHier3");
  expect(host, "顶层快照里必须有那个 geo 节点（否则父层被子图覆盖了）").toBeDefined();
  expect(host!.kind).toBe("geo");
  // 子图挂在它的 children 上（不是把子图当成整个场景）
  expect(host!.children).toBeDefined();
});

test("不可进入的节点拒绝进入（enterNode 返回 false，图不动）", async ({ page }) => {
  await boot(page);
  const nullId = await page.evaluate(async () => {
    const mod = (await import("/src/nodes2/graph-model.ts")) as { makeNullNode(): { id: string } };
    const n = mod.makeNullNode();
    await (window as never as { __cylGraph: { editor: { addNode(x: unknown): Promise<unknown> } } })
      .__cylGraph.editor.addNode(n);
    return n.id;
  });
  const before = await nodeLabels(page);
  expect(await enter(page, nullId)).toBe(false);
  expect(await netPath(page)).toEqual([]); // 没进去
  expect(await nodeLabels(page)).toEqual(before); // 图纹丝不动
});

test("顶层 exitNode 返回 false（没有可退的父层）", async ({ page }) => {
  await boot(page);
  expect(await netPath(page)).toEqual([]);
  expect(await exit(page)).toBe(false);
  expect(await netPath(page)).toEqual([]);
});
