import { expect, test } from "@playwright/test";
import { gotoMember } from "./fixtures";

/**
 * 写回链路的**常驻**回归（v0.1.00140）。
 *
 * 为什么必须有这个文件：v0.1.00133→00139 是七个版本的写回改动，浏览器侧证据**全是
 * 用完即删的探针** —— 纯函数有单测，但「收集 → 解析 → 透传 → 形状校验 → 单飞 → PUT」
 * 这条链没有任何常驻保护。下一次改动没有东西会拦住回归。
 *
 * 设计上刻意**不依赖桥里的真实映射**：
 * - 源用**图内** `transform`（`resolveWritebackValue` 直接读它的 tx，无需向桥取值），
 *   所以没有 1.1s 的图外读、没有 TTL 轮询，断言是确定性的；
 * - 用 `page.route` 拦下 PUT 断言 body —— 桥不必真有这个逻辑名。
 *
 * 覆盖不到的：图外 `ch()` 引用（那需要一条真实映射，环境相关、不可移植）。如实标注。
 */
const PORT_NAME = "e2e_wb/tx";

/** 拦下映射写值 PUT，记下每次的 body。返回一个取快照的函数。 */
async function captureWritebacks(page: import("@playwright/test").Page, putDelayMs = 0) {
  const seen: Array<{ name: string; value: unknown }> = [];
  await page.route("**/api/projects/*/mappings/**/value", async (route) => {
    const req = route.request();
    if (req.method() === "PUT") {
      // **写回要慢**才有竞态可言（v0.1.00140 变异测试发现）：真实 vec3 写回 ~1s
      // （桥逐分量打 3 次 MCP），单飞 bug 正是在那段 await 里被第二轮撞出来的。
      // 拦截默认瞬时 fulfill → 窗口根本不开 → 把单飞守卫注释掉测试照样绿。
      // 一个抓不到 bug 的测试不是保护，是错觉。
      if (putDelayMs > 0) await new Promise((r) => setTimeout(r, putDelayMs));
      const body = req.postDataJSON() as { value?: unknown } | null;
      const m = /\/mappings\/(.+)\/value$/.exec(new URL(req.url()).pathname);
      seen.push({ name: m ? decodeURIComponent(m[1]) : "", value: body?.value });
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"value":0}' });
  });
  return () => seen.slice();
}

/**
 * 建 `transform1 → null1 → _output_`，null 的引用留空（= 透传），output 指向 PORT_NAME。
 *
 * 用 `restoreGraph` 一次建好节点**与连线** —— 浏览器里 `import("rete")` 解析不了裸标识符，
 * 而这条路正是 app 自己加载存档图走的路，端口形状与真实存档一致（用户真图即此形状）。
 */
async function buildPassthroughChain(page: import("@playwright/test").Page, tx: number) {
  const flags = { display: false, bypass: false, freeze: false, reference: false };
  const P = (name: string, value: unknown) => ({ name, type: "string", value });
  return page.evaluate(
    async (args) => {
      const w = window as never as {
        __cylGraph: {
          restoreGraph(data: unknown): Promise<void>;
          editor: { getNodes(): Array<{ id: string; kind: string }> };
        };
      };
      await w.__cylGraph.restoreGraph(args.snapshot);
      const ns = w.__cylGraph.editor.getNodes();
      return {
        xf: ns.find((n) => n.kind === "transform")?.id ?? "",
        nul: ns.find((n) => n.kind === "null")?.id ?? "",
        out: ns.find((n) => n.kind === "output")?.id ?? "",
      };
    },
    {
      snapshot: {
        schemaVersion: 5,
        viewport: { k: 1, x: 0, y: 0 },
        nodes: [
          {
            id: "wb_xf",
            kind: "transform",
            label: "transform1",
            baseLabel: "transform",
            flags,
            x: 40,
            y: 40,
            params: [
              { name: "tx", type: "float", value: tx },
              { name: "ty", type: "float", value: 0 },
              { name: "tz", type: "float", value: 0 },
            ],
          },
          { id: "wb_nul", kind: "null", label: "null1", baseLabel: "null", flags, x: 260, y: 40, params: [] },
          {
            id: "wb_out",
            kind: "output",
            label: "_output_",
            baseLabel: "_output_",
            flags,
            x: 480,
            y: 40,
            params: [P("address", "C1-e2ewback-0001"), P("type", "float"), P("port", PORT_NAME)],
          },
        ],
        connections: [
          { source: "wb_xf", sourceOutput: "out0", target: "wb_nul", targetInput: "in0" },
          { source: "wb_nul", sourceOutput: "out0", target: "wb_out", targetInput: "out0" },
        ],
      },
    },
  );
}

test("空引用透传：transform 的 tx 经 null 到 _output_，PUT 带的是那个值", async ({ page }) => {
  const seen = await captureWritebacks(page);
  await gotoMember(page, "C1-e2ewback-0001");
  await expect(page.locator(".cyl-graph")).toBeVisible({ timeout: 20000 });
  await buildPassthroughChain(page, 4.25);

  // 触发一次 flush（写回挂在 flushStoreView 上）
  await page.evaluate(() => (window as never as { __cylStore: { pushLog(s: string): void } }).__cylStore.pushLog("[e2e] kick"));
  await expect.poll(() => seen().filter((s) => s.name === PORT_NAME).length, { timeout: 15000 }).toBeGreaterThan(0);

  const hit = seen().find((s) => s.name === PORT_NAME);
  // 值来自 transform.tx —— 证明「空引用 = 透传流入值」（v0.1.00138）确实生效。
  expect(hit?.value).toBe(4.25);
});

test("单飞：同一个值不会被并发推两次（v0.1.00139）", async ({ page }) => {
  // 800ms 的 PUT 延迟模拟真实 vec3 写回（~1s，桥逐分量打 3 次 MCP）——
  // 竞态窗口必须真的开着，否则这条测试测不到任何东西（已用变异测试确认）。
  const seen = await captureWritebacks(page, 800);
  await gotoMember(page, "C1-e2ewback-0001");
  await expect(page.locator(".cyl-graph")).toBeVisible({ timeout: 20000 });
  await buildPassthroughChain(page, 7.5);

  // 连着敲很多次 flush：去抖 + 单飞应当把它们合成**一次** PUT。
  // 此前竞态下会出现两条同值 PUT（实测日志里连着两行 `= [7,8,9]`）。
  await page.evaluate(() => {
    const s = (window as never as { __cylStore: { pushLog(t: string): void } }).__cylStore;
    for (let i = 0; i < 12; i++) s.pushLog(`[e2e] kick ${i}`);
  });
  await expect.poll(() => seen().filter((s) => s.name === PORT_NAME).length, { timeout: 15000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2500); // 给潜在的第二轮足够时间冒出来

  const puts = seen().filter((s) => s.name === PORT_NAME);
  expect(puts.map((p) => p.value)).toEqual([7.5]);
});

test("形状不符先拦下：float 源不会写进 vec3 端口", async ({ page }) => {
  const seen = await captureWritebacks(page);
  await gotoMember(page, "C1-e2ewback-0001");
  await expect(page.locator(".cyl-graph")).toBeVisible({ timeout: 20000 });
  const ids = await buildPassthroughChain(page, 1.5);

  // 把 output 端口类型改成 vec3，而源仍是单个 float → 必须一个字节都不发。
  await page.evaluate((outId) => {
    const w = window as never as {
      __cylGraph: { editor: { getNodes(): Array<{ id: string; params?: Array<{ name: string; value: unknown }> }> } };
    };
    const n = w.__cylGraph.editor.getNodes().find((x) => x.id === outId);
    const p = n?.params?.find((q) => q.name === "type");
    if (p) p.value = "vec3";
  }, ids.out);
  await page.evaluate(() => (window as never as { __cylStore: { pushLog(s: string): void } }).__cylStore.pushLog("[e2e] kick"));
  await page.waitForTimeout(2500);

  expect(seen().filter((s) => s.name === PORT_NAME)).toEqual([]);

  // **差分断言**：把类型改回 float，同一条链必须立刻写得出去。
  //
  // 为什么必须有这半段：只断言「没有 PUT」的测试在**整条链坏掉**时也会通过 ——
  // 变异测试实测到了这一点（还原 v0.1.00138 的透传后，测 1/测 2 挂了，这条照样绿）。
  // 加上这半段之后，它只在"vec3 拦下、float 放行"同时成立时才通过。
  await page.evaluate((outId) => {
    const w = window as never as {
      __cylGraph: { editor: { getNodes(): Array<{ id: string; params?: Array<{ name: string; value: unknown }> }> } };
    };
    const n = w.__cylGraph.editor.getNodes().find((x) => x.id === outId);
    const p = n?.params?.find((q) => q.name === "type");
    if (p) p.value = "float";
  }, ids.out);
  await page.evaluate(() => (window as never as { __cylStore: { pushLog(s: string): void } }).__cylStore.pushLog("[e2e] kick2"));
  await expect.poll(() => seen().filter((s) => s.name === PORT_NAME).length, { timeout: 15000 }).toBe(1);
  expect(seen().find((s) => s.name === PORT_NAME)?.value).toBe(1.5);
});
