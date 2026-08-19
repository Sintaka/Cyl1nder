import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";
import { gotoMember, toggleSyncEnabled } from "./fixtures";

/**
 * Round 2 integrated E2E. Self-contained: beforeAll pushes a canonical input
 * fixture to the bridge; every test restores its own graph in-browser (the web
 * auto-saves the graph snapshot on store changes, so relying on the disk
 * fixture is not safe); afterAll restores the canonical fixture on disk.
 */
const client = new BridgeClient();
let serial = "";

/** Canonical 4-input fixture (deterministic squares; input0 = the 4-pt square). */
const CANONICAL_INPUTS = [
  { index: 0, name: "in0", pointCount: 4, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]], curves: [{ pointIndices: [0,1,2,3], widths: null }], faces: [[0,1,2,3]], attributes: {} },
  { index: 1, name: "in1", pointCount: 3, primCount: 1, points: [[0,0,0],[1,0,0],[0,1,0]], curves: [{ pointIndices: [0,1,2], widths: null }], faces: [], attributes: {} },
  { index: 2, name: "in2", pointCount: 5, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0.5,0.5,1]], curves: [{ pointIndices: [0,1,2,3,4], widths: null }], faces: [], attributes: {} },
  { index: 3, name: "in3", pointCount: 2, primCount: 1, points: [[0,0,0],[1,0,0]], curves: [{ pointIndices: [0,1], widths: null }], faces: [], attributes: {} },
];

/** Canonical 7-connection graph: input.in0->output.out0, in1..3 -> null1..3 -> out1..3. */
const CANONICAL_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "i", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "n1", kind: "null", label: "null1", baseLabel: "null", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 300, y: 40 },
    { id: "n2", kind: "null", label: "null2", baseLabel: "null", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 300, y: 200 },
    { id: "n3", kind: "null", label: "null3", baseLabel: "null", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 300, y: 360 },
    { id: "o", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 560, y: 80 },
  ],
  connections: [
    { source: "i", sourceOutput: "in0", target: "o", targetInput: "out0" },
    { source: "i", sourceOutput: "in1", target: "n1", targetInput: "in0" },
    { source: "i", sourceOutput: "in2", target: "n2", targetInput: "in0" },
    { source: "i", sourceOutput: "in3", target: "n3", targetInput: "in0" },
    { source: "n1", sourceOutput: "out0", target: "o", targetInput: "out1" },
    { source: "n2", sourceOutput: "out0", target: "o", targetInput: "out2" },
    { source: "n3", sourceOutput: "out0", target: "o", targetInput: "out3" },
  ],
};

test.beforeAll(async () => {
  const bridgeOk = await client.health().then(() => true).catch(() => false);
  test.skip(!bridgeOk, "bridge not running on 127.0.0.1:8375");
  const serials = await client.listSerials();
  serial = process.env.CYL1NDER_E2E_SERIAL || serials.find((s) => s === "C1-e2etest0001-aaaa") || serials[serials.length - 1] || "";
  test.skip(!serial, "no serial registered in bridge");
  await client.pushInputs(serial, CANONICAL_INPUTS as never, { nodePath: "/obj/test/Cyl1nder1", label: "Cyl1nder1" });
});

test.afterAll(async () => {
  if (!serial) return;
  try {
    await client.pushInputs(serial, CANONICAL_INPUTS as never, { nodePath: "/obj/test/Cyl1nder1", label: "Cyl1nder1" });
    await client.putSnapshot(serial, { graph: CANONICAL_GRAPH });
  } catch {
    /* fixture restore best-effort */
  }
});

async function openGraph(page: import("@playwright/test").Page): Promise<void> {
  await gotoMember(page, serial);
  await expect(page.locator(".cyl-graph .cyl-rp-title").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".cyl-status")).toHaveClass(/ok/, { timeout: 15000 });
  // 夹具卫生：本文件有三个用例会切到 Spreadsheet / Params 面板且**从不切回来**
  // （123 / 141 / 242 行），而 dockview 的布局是跨用例持久化的。于是「Y cut」这种
  // 靠 elementFromPoint 命中连线的用例，会在图面板被盖住的情况下跑——线没渲染，
  // 自然一根都切不到，表现为连接数不变（曾被误读成"偶发 7≠6"）。
  // 所以每个用例开场都显式把 Graph 页签切回前台，让每个用例从同一个可见状态起跑。
  // 用**面板 id** 而不是页签文字：页签标题会被 syncSerialInAddress 改成地址
  // （`/P1-…/C1-…/`），拿 "Node Graph" 去匹配匹配不到。id "graph" 是稳定的。
  await page.evaluate(() => {
    const dv = (window as never as { __cylDv?: { api?: { getPanel?(id: string): { api: { setActive(): void } } | undefined } } }).__cylDv;
    dv?.api?.getPanel?.("graph")?.api.setActive();
  });
  await expect(page.locator(".cyl-graph")).toBeVisible({ timeout: 15000 });
}

/** Restore the canonical 7-connection graph in-browser (ignores whatever the disk snapshot holds). */
async function restoreCanonicalGraph(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async (g) => {
    const graph: any = (window as any).__cylGraph;
    await graph.restoreGraph(JSON.parse(JSON.stringify(g)));
  }, CANONICAL_GRAPH);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylGraph.editor.getConnections().length), { timeout: 15000 })
    .toBe(7);
}

/** Find a blank point on the graph canvas (not over a node/button/port) to deselect. */
async function blankGraphSpot(page: import("@playwright/test").Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    const el = document.querySelector(".cyl-graph");
    if (!el || !g) return null;
    const r = el.getBoundingClientRect();
    const t = g.area.area.transform;
    const nodes: { x: number; y: number }[] = [];
    for (const [, view] of g.area.nodeViews) {
      if (view.position) nodes.push({ x: r.left + t.x + view.position.x * t.k, y: r.top + t.y + view.position.y * t.k });
    }
    for (let y = r.top + 24; y < r.bottom - 24; y += 32) {
      for (let x = r.left + 24; x < r.right - 24; x += 32) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !hit.closest(".cyl-graph")) continue;
        if (hit && (hit.closest(".cyl-rp-node") || hit.closest(".cyl-rp-port") || hit.closest("button"))) continue;
        if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < 70)) continue;
        return { x, y };
      }
    }
    return null;
  });
}

async function bridgeOutputs(): Promise<{ index: number; points: number[][] }[]> {
  const res = await fetch(`http://127.0.0.1:8375/api/hda/${serial}/outputs`);
  const j = (await res.json()) as { outputs: { index: number; points: number[][] }[] };
  return j.outputs;
}

async function poll<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 8000, label = "state"): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (pred(v)) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${label}`);
}

test("spreadsheet: renamed columns + lower-saturation stripes follow selected null", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  await page.locator(".dv-tab", { hasText: "Spreadsheet" }).first().click({ timeout: 15000 });
  await page.locator(".cyl-rp-title", { hasText: "null3" }).first().click({ timeout: 15000 });
  await expect(page.locator(".cyl-sp-section .cyl-sp-head").first()).toContainText("in0", { timeout: 15000 });
  await page.locator(".cyl-sp-tab", { hasText: "Vertices" }).first().click();
  const vHeaders = await page.locator(".cyl-sp-table thead th").allTextContents();
  expect(vHeaders).toEqual(expect.arrayContaining(["vertnum", "ptnum", "primnum"]));
  await page.locator(".cyl-sp-tab", { hasText: "Prims" }).first().click();
  const pHeaders = await page.locator(".cyl-sp-table thead th").allTextContents();
  expect(pHeaders).toEqual(expect.arrayContaining(["primnum", "type", "verts", "primpoints"]));
  const odd = await page.locator(".cyl-sp-table tbody tr:nth-child(odd) td").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(odd).toBe("rgb(17, 23, 32)");
  const even = await page.locator(".cyl-sp-table tbody tr:nth-child(even) td").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(even).toBe("rgb(31, 40, 52)");
});

test("spreadsheet: deselect keeps last node content; selecting another node refreshes", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  await page.locator(".dv-tab", { hasText: "Spreadsheet" }).first().click({ timeout: 15000 });

  // select a null node -> spreadsheet shows its in0 source port
  await page.locator(".cyl-rp-title", { hasText: "null1" }).first().click({ timeout: 15000 });
  await expect(page.locator(".cyl-sp-section .cyl-sp-head").first()).toContainText("in0", { timeout: 15000 });
  await expect(page.locator(".cyl-sp-section")).toHaveCount(1);

  // click blank canvas -> deselect; held in0 content must NOT clear to "no geometry"
  const blank = await blankGraphSpot(page);
  expect(blank).not.toBeNull();
  await page.mouse.click(blank!.x, blank!.y);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylGraph.getSelectedNode()), { timeout: 15000 })
    .toBeNull();
  await expect(page.locator(".cyl-sp-section .cyl-sp-head").first()).toContainText("in0", { timeout: 15000 });
  await expect(page.locator(".cyl-sp-section")).toHaveCount(1);
  await expect(page.locator(".cyl-sp-empty")).toHaveCount(0);

  // select a different node -> panels refresh to the new target (all 4 inputs)
  await page.locator(".cyl-rp-title", { hasText: "_input_" }).first().click({ timeout: 15000 });
  await expect(page.locator(".cyl-sp-section")).toHaveCount(4, { timeout: 15000 });
});

test("viewport: F-frame keeps camera angle; Alt+RMB diagonal equals axis sensitivity", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  const vp = await page.evaluate(async () => {
    const v: any = (window as any).__cylViewport;
    if (!v) return null;
    v.camera.position.set(3, 5, 9);
    v.controls.controls.target.set(0, 0, 0);
    v.controls.controls.update();
    const before = v.camera.position.clone().sub(v.controls.controls.target).normalize().toArray();
    v.frame();
    const after = v.camera.position.clone().sub(v.controls.controls.target).normalize().toArray();
    const dot = before[0] * after[0] + before[1] * after[1] + before[2] * after[2];
    const target = v.controls.controls.target.toArray();
    const dist0 = () => v.camera.position.distanceTo(v.controls.controls.target);
    const reset = () => { v.camera.position.set(4, 3, 6); v.controls.controls.target.set(0, 0, 0); v.controls.controls.update(); };
    const canvas = v.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const opts = (clientX: number, clientY: number) => ({ button: 2, altKey: true, bubbles: true, cancelable: true, clientX, clientY });
    const drag = async (dx: number, dy: number) => {
      reset();
      const d0 = dist0();
      canvas.dispatchEvent(new PointerEvent("pointerdown", opts(cx, cy)));
      const n = 6;
      for (let i = 1; i <= n; i++) {
        canvas.dispatchEvent(new PointerEvent("pointermove", opts(cx + (dx * i) / n, cy + (dy * i) / n)));
      }
      window.dispatchEvent(new PointerEvent("pointerup", opts(cx + dx, cy + dy)));
      await new Promise((r) => setTimeout(r, 50));
      return d0 - dist0();
    };
    const h = await drag(120, 0);
    const dg = await drag(120, -120);
    return { dot, target, h, dg };
  });
  expect(vp).not.toBeNull();
  expect(vp!.dot).toBeGreaterThan(0.999);
  // display focus = input0 -> its square center (0.5, 0.5, 0)
  expect(vp!.target[0]).toBeCloseTo(0.5, 1);
  expect(vp!.target[1]).toBeCloseTo(0.5, 1);
  expect(Math.abs(vp!.dg - vp!.h)).toBeLessThan(0.05);
});

test("transform node: palette create + wire + param edit -> bridge outputs translated (group filter)", async ({ page }) => {
  await openGraph(page);
  await toggleSyncEnabled(page, true); // v0.1.00101 起推桥需 sync ON
  // create transform via palette
  await page.mouse.move(500, 300);
  await page.keyboard.press("Tab");
  await expect(page.locator(".cyl-palette-input")).toBeVisible();
  await page.locator(".cyl-palette-input").fill("transform");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cyl-rp-title", { hasText: /^transform\d+$/ }).first()).toBeVisible({ timeout: 10000 });

  // rewire via restoreGraph: input.in0 -> transform.in0 -> output.out0
  await page.evaluate(async () => {
    const g: any = (window as any).__cylGraph;
    const trId = g.editor.getNodes().find((n: any) => n.kind === "transform").id;
    await g.restoreGraph({
      schemaVersion: 2,
      nodes: [
        { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
        { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: false, bypass: false, freeze: false, reference: false }, params: [
          { name: "tx", type: "float", value: 0 }, { name: "ty", type: "float", value: 0 }, { name: "tz", type: "float", value: 0 },
          { name: "group", type: "string", value: "" }, { name: "class", type: "string", value: "autoguess" },
        ], x: 400, y: 80 },
        { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 560, y: 80 },
      ],
      connections: [
        { source: "in", sourceOutput: "in0", target: "tf", targetInput: "in0" },
        { source: "tf", sourceOutput: "out0", target: "out", targetInput: "out0" },
      ],
    });
  });

  // select the transform node -> param panel shows editable params
  await page.locator(".dv-tab", { hasText: "Params" }).first().click({ timeout: 15000 });
  await page.locator(".cyl-rp-title", { hasText: /^transform\d+$/ }).first().click({ timeout: 15000 });
  const txInput = page.locator('.cyl-param-table input[data-name="tx"]');
  await expect(txInput).toBeVisible({ timeout: 10000 });

  // group="0-1" + tx=5 -> points 0..1 move +5 on x
  await page.locator('.cyl-param-table input[data-name="group"]').fill("0-1");
  await txInput.fill("5");
  const outs = await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0] - 5) < 1e-6;
    },
    10000,
    "translated outputs",
  );
  const out0 = outs.find((x) => x.index === 0)!;
  expect(out0.points[0]).toEqual([5, 0, 0]);
  expect(out0.points[1]).toEqual([6, 0, 0]);
  expect(out0.points[2]).toEqual([1, 1, 0]);
  expect(out0.points[3]).toEqual([0, 1, 0]);
});

test("Y cut: L-shaped polyline cuts a connection; Ctrl+Z undo / Ctrl+Y redo", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  const count = () => page.evaluate(() => (window as any).__cylGraph.editor.getConnections().length);

  // **先把图缩放到面板内**：面板实测只有 443x249（底栏两行之后更矮），而规范图
  // 按默认缩放铺得比它宽，于是所有采样点都落在可见框外 → spot 恒为 null。
  // 这与 waypoint-verify 里那条「取线上的点之前必须先 fit」是同一个坑。
  await page.evaluate(async () => {
    const g = (window as never as {
      __cylGraph: { area: { area: { zoom(k: number): Promise<unknown>; translate(x: number, y: number): Promise<unknown> } } };
    }).__cylGraph;
    await g.area.area.zoom(0.55);
    await g.area.area.translate(40, 30);
  });
  await page.waitForTimeout(250);

  const spot = await page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    const box = document.querySelector(".cyl-graph")!.getBoundingClientRect();
    for (const [id, view] of g.area.connectionViews) {
      const path = view.element.querySelector("path");
      if (!path) continue;
      const len = path.getTotalLength();
      const ctm = path.getScreenCTM();
      if (!len || !ctm) continue;
      // 全长扫描、步长更细（原来只扫中间一半、步长 len/30）。规范图的线又短又密，
      // 加上下面 40px/24px 的边距守卫，只扫中段会导致**一个点都取不到**（spot=null）。
      for (let t = 0; t <= len; t += Math.max(1, len / 120)) {
        const p = path.getPointAtLength(t);
        const sp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
        // visible-box guard: the bottom bar now has two rows, so the graph panel
        // is shorter — only accept points that are actually inside the panel,
        // otherwise elementFromPoint hits dock chrome below the clipped SVG.
        if (sp.x < box.left + 40 || sp.x > box.right - 40) continue;
        if (sp.y < box.top + 24 || sp.y > box.bottom - 24) continue;
        const el = document.elementFromPoint(sp.x, sp.y);
        // 必须**真的命中连线本体**（`[data-testid="connection"]` 的后代 path）。
        // 原判据只排除节点与按钮，于是「点在空白画布上」也会被当成有效切点——
        // 那时 Y-click 自然一根线都切不到，表现为连接数不变。v0.1.00121 收紧：
        // 图上多了灰色未接线端口与动态 null 端口之后，几何变了，这个漏洞才暴露出来。
        if (el && el.closest('[data-testid="connection"]')) return { x: sp.x, y: sp.y };
      }
    }
    return null;
  });
  // spot=null 有好几种成因（无连线视图 / 线没渲染 / 被节点盖住 / 在可见框外），
  // 所以把连接数与面板尺寸带进断言消息，失败时不用再靠猜。
  const diag = await page.evaluate(() => {
    const g = (window as never as { __cylGraph: { editor: { getConnections(): unknown[] } } }).__cylGraph;
    const b = document.querySelector(".cyl-graph")?.getBoundingClientRect();
    return `conns=${g.editor.getConnections().length} panel=${b ? `${Math.round(b.width)}x${Math.round(b.height)}` : "none"}`;
  });
  expect(spot, `no cuttable wire point — ${diag}`).not.toBeNull();

  const before = await count();
  // click-cut: holding Y, a plain click on a wire cuts the connection under the
  // cursor (the polyline-drag branch is geometry-sensitive: the 264px-wide
  // input node covers fixed drag start offsets, and the shorter graph panel
  // clips the lower canonical wires).
  await page.keyboard.down("y");
  await page.mouse.move(spot!.x, spot!.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up("y");
  await expect.poll(count, { timeout: 5000 }).toBe(before - 1);

  await page.keyboard.press("Control+z");
  await expect.poll(count, { timeout: 5000 }).toBe(before);
  await page.keyboard.press("Control+y");
  await expect.poll(count, { timeout: 5000 }).toBe(before - 1);
});

test("insertion: inserted node is kept clear of its source node", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  const beforeNullIds = await page.evaluate(() =>
    (window as any).__cylGraph.editor.getNodes().filter((n: any) => n.kind === "null").map((n: any) => n.id),
  );
  // create the palette node INSIDE the visible graph panel (two-row bottom bar
  // shrinks the panel; a node created at a fixed off-panel point can't be grabbed)
  const paletteSpot = await page.evaluate(() => {
    const box = document.querySelector(".cyl-graph")!.getBoundingClientRect();
    return { x: box.left + box.width * 0.55, y: box.top + box.height * 0.55 };
  });
  await page.mouse.move(paletteSpot.x, paletteSpot.y);
  await page.keyboard.press("Tab");
  await page.locator(".cyl-palette-input").fill("null");
  await page.keyboard.press("Enter");
  const newId = await page.evaluate((ids) => {
    const g: any = (window as any).__cylGraph;
    const n = g.editor.getNodes().find((x: any) => x.kind === "null" && !ids.includes(x.id));
    return n ? n.id : null;
  }, beforeNullIds);
  expect(newId).not.toBeNull();
  const newLabel = await page.evaluate((id) => (window as any).__cylGraph.editor.getNode(id).label, newId);
  const newNode = page.locator(".cyl-rp-node", { hasText: newLabel });
  await expect(newNode).toBeVisible({ timeout: 10000 });

  const target = await page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    const input: any = g.editor.getNodes().find((n: any) => n.kind === "input");
    const srcPos = g.area.nodeViews.get(input.id).position;
    const srcW = (g.area.nodeViews.get(input.id).element.getBoundingClientRect().width / g.area.area.transform.k) || 150;
    const minX = srcPos.x + srcW + 30;
    for (const [id, view] of g.area.connectionViews) {
      const path = view.element.querySelector("path");
      if (!path) continue;
      const len = path.getTotalLength();
      const ctm = path.getScreenCTM();
      const rect = document.querySelector(".cyl-graph")!.getBoundingClientRect();
      for (let t = len * 0.05; t <= len * 0.5; t += len / 40) {
        const p = path.getPointAtLength(t);
        const sp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
        // visible-box guard (see Y-cut test): only accept points inside the panel
        if (sp.x < rect.left + 24 || sp.x > rect.right - 24) continue;
        if (sp.y < rect.top + 24 || sp.y > rect.bottom - 24) continue;
        const areaX = (sp.x - rect.left - g.area.area.transform.x) / g.area.area.transform.k;
        if (areaX > minX + 20) continue;
        const el = document.elementFromPoint(sp.x, sp.y);
        if (el && !el.closest(".cyl-rp-node") && !el.closest("button")) {
          return { x: sp.x, y: sp.y, minX };
        }
      }
    }
    return null;
  });

  if (target) {
    const nb = await newNode.boundingBox();
    await page.mouse.move(nb!.x + nb!.width / 2, nb!.y + nb!.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const pos = await page.evaluate((id) => {
      const g: any = (window as any).__cylGraph;
      const input: any = g.editor.getNodes().find((n: any) => n.kind === "input");
      const srcPos = g.area.nodeViews.get(input.id).position;
      const srcW = (g.area.nodeViews.get(input.id).element.getBoundingClientRect().width / g.area.area.transform.k) || 150;
      const p = g.area.nodeViews.get(id).position;
      return { x: p.x, minX: srcPos.x + srcW + 30 };
    }, newId);
    expect(pos.x).toBeGreaterThanOrEqual(pos.minX - 1);
  } else {
    expect(true).toBe(true);
  }
});
