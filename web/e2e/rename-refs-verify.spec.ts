import { expect, test } from "@playwright/test";

/**
 * v0.1.00119 验证 task #7：改名 → **登记过的**引用自动重写。
 *
 * 为什么必须是 e2e：`ref-registry.test.ts`（36 例）测的是注册表**本身**，
 * 而这里测的是**接线**——改名处理器有没有真的把重写结果落回节点的 `address`
 * 字段与参数。那段接线此前只被一个用完即删的临时 spec 验证过，没有常驻回归。
 *
 * 全程走 `__cylGraph`（应用自己那份实例）：动态 import 是否同实例取决于 HMR
 * 是否给链上模块盖过 `?t=`，不可依赖（见 devlog/in-progress.md 纪律一节）。
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

/** 建一个 null 节点当"被引用目标"，返回 id + 实际落地的 label（可能被去重加后缀）。 */
async function addNull(page: Page, label: string): Promise<{ id: string; label: string }> {
  return page.evaluate(async (want) => {
    const mod = (await import("/src/nodes2/graph-model.ts")) as { makeNullNode(): { id: string; label: string } };
    const n = mod.makeNullNode();
    n.label = want;
    await (window as never as { __cylGraph: { editor: { addNode(x: unknown): Promise<unknown> } } })
      .__cylGraph.editor.addNode(n);
    return { id: n.id, label: n.label };
  }, label);
}

/** 给某个 input 节点写 address（走 setNodeParams —— 这条路径同时负责登记引用点）。 */
async function setAddress(page: Page, nodeId: string, address: string): Promise<void> {
  await page.evaluate(
    ({ id, addr }) => {
      const g = (window as never as {
        __cylGraph: {
          editor: { getNode(i: string): { params?: Array<{ name: string; type: string; value: unknown }> } | undefined };
          setNodeParams(i: string, p: Array<{ name: string; type: string; value: unknown }>): boolean;
        };
      }).__cylGraph;
      const n = g.editor.getNode(id);
      const params = (n?.params ?? []).map((p) => (p.name === "address" ? { ...p, value: addr } : p));
      g.setNodeParams(id, params);
    },
    { id: nodeId, addr: address },
  );
}

const addressOf = (page: Page, nodeId: string) =>
  page.evaluate((id) => {
    const n = (window as never as {
      __cylGraph: { editor: { getNode(i: string): { address?: string; params?: Array<{ name: string; value: unknown }> } | undefined } };
    }).__cylGraph.editor.getNode(id);
    return {
      field: n?.address ?? null,
      param: (n?.params?.find((p) => p.name === "address")?.value ?? null) as string | null,
    };
  }, nodeId);

/** 改名走 fireRename（NodeView 的 commitName 用的就是它），返回最终 label。 */
const rename = (page: Page, nodeId: string, desired: string) =>
  page.evaluate(
    async ({ id, want }) => {
      const mod = (await import("/src/nodes2/graph.ts")) as { fireRename(i: string, d: string): string };
      return mod.fireRename(id, want);
    },
    { id: nodeId, want: desired },
  );

/**
 * 建一个**单端口 + address 形态**的 input 节点（schema 4），返回其 id。
 *
 * 为什么不复用图里现成的 `_input_`：`?serial=` 打开的图是从存档恢复的**旧 4 端口
 * 形态**（实测 `outs: ["in0","in1","in2","in3"]`、`params: []`）——它根本没有
 * address 参数，写不进去，引用也就无从登记。`makeInputNode(true)` 才是单端口形态。
 */
async function addAddressInput(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const mod = (await import("/src/nodes2/graph-model.ts")) as {
      makeInputNode(singlePort?: boolean): { id: string; label: string };
    };
    const n = mod.makeInputNode(true);
    n.label = "addrInput";
    await (window as never as { __cylGraph: { editor: { addNode(x: unknown): Promise<unknown> } } })
      .__cylGraph.editor.addNode(n);
    return n.id;
  });
}

test("改名后，登记过的 address 引用自动跟随", async ({ page }) => {
  await boot(page);
  const inId = await addAddressInput(page);
  const target = await addNull(page, "refTarget1");

  // input 的 address 指向那个节点（顶层 → 引用路径是 /refTarget1）
  await setAddress(page, inId, `/${target.label}`);
  expect((await addressOf(page, inId)).field).toBe(`/${target.label}`);

  const final = await rename(page, target.id, "refTargetRenamed");
  expect(final).toBe("refTargetRenamed");

  // 字段与参数必须**同时**跟随（序列化读参数、桥侧解析读字段）
  const after = await addressOf(page, inId);
  expect(after.field).toBe("/refTargetRenamed");
  expect(after.param).toBe("/refTargetRenamed");
});

test("前缀边界：改 geo1 不碰 geo10（Houdini 从不犯的那个错）", async ({ page }) => {
  await boot(page);
  const inId = await addAddressInput(page);
  const a = await addNull(page, "bnd1");
  const b = await addNull(page, "bnd10");

  // 让 input 指向 bnd10，然后改名 bnd1 —— bnd10 绝不能被当成 bnd1 的子路径重写
  await setAddress(page, inId, `/${b.label}`);
  await rename(page, a.id, "bndRenamed");

  const after = await addressOf(page, inId);
  expect(after.field, "bnd10 不该因为 bnd1 改名而变化").toBe(`/${b.label}`);
});

test("未登记的文本不被改写（registered-only，照 Houdini 语义）", async ({ page }) => {
  await boot(page);
  const inId = await addAddressInput(page);
  const target = await addNull(page, "unreg1");

  // 先登记再清空 → 该引用点被注销（清空地址 = 这条依赖不存在了）
  await setAddress(page, inId, `/${target.label}`);
  await setAddress(page, inId, "");
  // 再把同样的文本写到一个**不参与登记**的地方：这里用 transform 的 group 参数
  const txId = await page.evaluate(async (label) => {
    const mod = (await import("/src/nodes2/graph-model.ts")) as { makeTransformNode(): { id: string } };
    const n = mod.makeTransformNode();
    const g = (window as never as {
      __cylGraph: {
        editor: { addNode(x: unknown): Promise<unknown>; getNode(i: string): { params?: Array<{ name: string; type: string; value: unknown }> } | undefined };
        setNodeParams(i: string, p: Array<{ name: string; type: string; value: unknown }>): boolean;
      };
    }).__cylGraph;
    await g.editor.addNode(n);
    const cur = g.editor.getNode(n.id)?.params ?? [];
    g.setNodeParams(n.id, cur.map((p) => (p.name === "group" ? { ...p, value: `/${label}` } : p)));
    return n.id;
  }, target.label);

  await rename(page, target.id, "unregRenamed");

  const grp = await page.evaluate((id) => {
    const n = (window as never as {
      __cylGraph: { editor: { getNode(i: string): { params?: Array<{ name: string; value: unknown }> } | undefined } };
    }).__cylGraph.editor.getNode(id);
    return n?.params?.find((p) => p.name === "group")?.value ?? null;
  }, txId);
  // 未登记 = 不重写：这正是 Houdini 的行为（VEX 字符串里的路径同样静默失效）
  expect(grp).toBe(`/${target.label}`);
});
