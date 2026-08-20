import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";
import { gotoMember } from "./fixtures";

/**
 * Round 4 integrated E2E (nodeview core write-set).
 * - insertion preview endpoints: source socket -> dragged node IN port / dragged
 *   node OUT port -> target socket, following the node's ports while dragging,
 *   refreshed on every pointermove (not only when the hovered connection changes).
 * - preview overlay z-index below the dragged node (behind it, not covering it).
 * - shake pops a node out of the chain and heals each A -> node -> B path into
 *   a direct A -> B (null + transform), single Ctrl+Z restores the original.
 * Self-contained: beforeAll pushes the canonical fixture; every test restores its
 * own graph in-browser; afterAll restores the canonical fixture on disk.
 */
const client = new BridgeClient();
let serial = "";

const CANONICAL_INPUTS = [
  { index: 0, name: "in0", pointCount: 4, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]], curves: [{ pointIndices: [0,1,2,3], widths: null }], faces: [[0,1,2,3]], attributes: {} },
  { index: 1, name: "in1", pointCount: 3, primCount: 1, points: [[0,0,0],[1,0,0],[0,1,0]], curves: [{ pointIndices: [0,1,2], widths: null }], faces: [], attributes: {} },
  { index: 2, name: "in2", pointCount: 5, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0.5,0.5,1]], curves: [{ pointIndices: [0,1,2,3,4], widths: null }], faces: [], attributes: {} },
  { index: 3, name: "in3", pointCount: 2, primCount: 1, points: [[0,0,0],[1,0,0]], curves: [{ pointIndices: [0,1], widths: null }], faces: [], attributes: {} },
];

/** Canonical 7-connection graph (same fixture as round2/round3). */
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
  serial = process.env.CYL1NDER_E2E_SERIAL || "C1-e2etest0001-aaaa";
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
}

async function restoreCanonicalGraph(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async (g) => {
    const graph: any = (window as any).__cylGraph;
    await graph.restoreGraph(JSON.parse(JSON.stringify(g)));
  }, CANONICAL_GRAPH);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylGraph.editor.getConnections().length), { timeout: 15000 })
    .toBe(7);
}

const connCount = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as any).__cylGraph.editor.getConnections().length);

/** Zoom/pan the view so the graph lands in open canvas space (same as round3). */
async function fitGraphForCut(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    const g: any = (window as any).__cylGraph;
    const rect = document.querySelector(".cyl-graph")!.getBoundingClientRect();
    const nodes = g.editor.getNodes();
    const xs = nodes.map((n: any) => g.area.nodeViews.get(n.id).position.x);
    const ys = nodes.map((n: any) => g.area.nodeViews.get(n.id).position.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs) + 300; // node width
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + 100;
    const k = Math.min((rect.width - 60) / (maxX - minX), (rect.height - 100) / (maxY - minY), 0.9);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    await g.area.area.zoom(k);
    await g.area.area.translate(rect.width * 0.8 - cx * k, rect.height * 0.6 - cy * k);
    await new Promise((r) => setTimeout(r, 150));
  });
}

/** Screen-space point at length-fraction `frac` of the connection whose source kind / target label match. */
async function connectionPoint(
  page: import("@playwright/test").Page,
  sel: { srcKind?: string; tgtLabel?: string },
  frac = 0.5,
): Promise<{ id: string; x: number; y: number } | null> {
  return page.evaluate(({ s, f }) => {
    const g: any = (window as any).__cylGraph;
    for (const [id, view] of g.area.connectionViews) {
      const c = g.editor.getConnection(id);
      const src = g.editor.getNode(c.source);
      const tgt = g.editor.getNode(c.target);
      if (s.srcKind && src.kind !== s.srcKind) continue;
      if (s.tgtLabel && tgt.label !== s.tgtLabel) continue;
      const path = view.element.querySelector("path");
      if (!path) continue;
      const len = path.getTotalLength();
      const ctm = path.getScreenCTM();
      if (!ctm) continue;
      const p = path.getPointAtLength(len * f);
      const sp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
      return { id, x: sp.x, y: sp.y };
    }
    return null;
  }, { s: sel, f: frac });
}

async function createTransform(page: import("@playwright/test").Page): Promise<{ id: string; label: string }> {
  await page.mouse.move(500, 300);
  await page.keyboard.press("Tab");
  await expect(page.locator(".cyl-palette-input")).toBeVisible();
  await page.locator(".cyl-palette-input").fill("transform");
  await page.keyboard.press("Enter");
  const tf = await page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    const n = g.editor.getNodes().find((x: any) => x.kind === "transform");
    return n ? { id: n.id, label: n.label } : null;
  });
  expect(tf).not.toBeNull();
  return tf!;
}

/** Drag `label` node from its center to (x, y) via real pointer events. */
async function dragNodeTo(page: import("@playwright/test").Page, label: string, x: number, y: number): Promise<void> {
  const nb = await page.locator(".cyl-rp-node", { hasText: label }).boundingBox();
  expect(nb).not.toBeNull();
  await page.mouse.move(nb!.x + nb!.width / 2, nb!.y + nb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 10 });
  await page.waitForTimeout(150);
}

/** Preview overlay state while dragging: d attributes + container-local reference points. */
async function previewState(
  page: import("@playwright/test").Page,
  connId: string | null,
  nodeLabel: string,
): Promise<{
  dA: string;
  dB: string;
  nums: number[][];
  connStart: { x: number; y: number } | null;
  connEnd: { x: number; y: number } | null;
  inPort: { x: number; y: number } | null;
  outPort: { x: number; y: number } | null;
  dropTarget: boolean | null;
}> {
  return page.evaluate(({ cid, label }) => {
    const g: any = (window as any).__cylGraph;
    const rect = document.querySelector(".cyl-graph")!.getBoundingClientRect();
    const overlay = document.querySelector("svg.cyl-insert-preview") as SVGSVGElement;
    const paths = Array.from(overlay.querySelectorAll("path.cyl-insert-preview-path"));
    const nums = paths.map((p) => (p.getAttribute("d") ?? "").match(/-?[\d.]+/g)?.map(Number) ?? []);
    const nodeEl = Array.from(document.querySelectorAll(".cyl-rp-node")).find((e) => e.textContent?.includes(label));
    const portCenter = (portId: string) => {
      const el = nodeEl?.querySelector(`[data-port-id="${portId}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - rect.left, y: r.top + r.height / 2 - rect.top };
    };
    let connStart: { x: number; y: number } | null = null;
    let connEnd: { x: number; y: number } | null = null;
    if (cid) {
      const view = g.area.connectionViews.get(cid);
      const svg = view?.element.querySelector("path");
      if (svg) {
        const ctm = svg.getScreenCTM();
        const len = svg.getTotalLength();
        const p0 = svg.getPointAtLength(0);
        const p1 = svg.getPointAtLength(len);
        const s = new DOMPoint(p0.x, p0.y).matrixTransform(ctm);
        const e = new DOMPoint(p1.x, p1.y).matrixTransform(ctm);
        connStart = { x: s.x - rect.left, y: s.y - rect.top };
        connEnd = { x: e.x - rect.left, y: e.y - rect.top };
      }
    }
    return {
      dA: paths[0]?.getAttribute("d") ?? "",
      dB: paths[1]?.getAttribute("d") ?? "",
      nums,
      connStart,
      connEnd,
      inPort: portCenter("in0"),
      outPort: portCenter("out0"),
      dropTarget: cid ? !!g.area.connectionViews.get(cid)?.element.querySelector("path.drop-target") : null,
    };
  }, { cid: connId, label: nodeLabel });
}

/** A screen point far from every node and connection (safe release spot). */
async function findBlankSpot(page: import("@playwright/test").Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    for (let y = 60; y < window.innerHeight - 30; y += 40) {
      for (let x = 40; x < window.innerWidth - 40; x += 40) {
        const el = document.elementFromPoint(x, y);
        if (el && (el.closest(".cyl-rp-node") || el.closest("button"))) continue;
        let near = false;
        for (const [, view] of g.area.connectionViews) {
          const path = view.element.querySelector("path");
          if (!path) continue;
          const ctm = path.getScreenCTM();
          const len = path.getTotalLength();
          for (let t = 0; t <= len; t += len / 20) {
            const p = path.getPointAtLength(t);
            const sp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
            if (Math.hypot(sp.x - x, sp.y - y) < 80) {
              near = true;
              break;
            }
          }
          if (near) break;
        }
        if (!near) return { x, y };
      }
    }
    return null;
  });
}

test("insertion preview: endpoints track the dragged node's ports and refresh while dragging", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  const tf = await createTransform(page);
  const tfNode = page.locator(".cyl-rp-node", { hasText: tf.label });
  await expect(tfNode).toBeVisible({ timeout: 10000 });
  await fitGraphForCut(page);

  const target = await connectionPoint(page, { srcKind: "input", tgtLabel: "null3" }, 0.5);
  expect(target).not.toBeNull();
  const target2 = await connectionPoint(page, { srcKind: "input", tgtLabel: "null3" }, 0.8);
  expect(target2).not.toBeNull();

  await dragNodeTo(page, tf.label, target!.x, target!.y);
  const st = await previewState(page, target!.id, tf.label);
  expect(st.dA).toMatch(/^M /);
  expect(st.dB).toMatch(/^M /);
  expect(st.nums.length).toBe(2);
  expect(st.inPort).not.toBeNull();
  expect(st.outPort).not.toBeNull();
  expect(st.connStart).not.toBeNull();
  expect(st.connEnd).not.toBeNull();
  // previewA: source socket -> dragged node IN port; previewB: dragged node OUT port -> target socket
  const aStart = { x: st.nums[0][0], y: st.nums[0][1] };
  const aEnd = { x: st.nums[0][6], y: st.nums[0][7] };
  const bStart = { x: st.nums[1][0], y: st.nums[1][1] };
  const bEnd = { x: st.nums[1][6], y: st.nums[1][7] };
  expect(Math.hypot(aEnd.x - st.inPort!.x, aEnd.y - st.inPort!.y)).toBeLessThan(8);
  expect(Math.hypot(bStart.x - st.outPort!.x, bStart.y - st.outPort!.y)).toBeLessThan(8);
  expect(Math.hypot(aStart.x - st.connStart!.x, aStart.y - st.connStart!.y)).toBeLessThan(8);
  expect(Math.hypot(bEnd.x - st.connEnd!.x, bEnd.y - st.connEnd!.y)).toBeLessThan(8);
  expect(st.dropTarget).toBe(true);

  // move further along the SAME connection: d must refresh (no leave/re-enter needed)
  await page.mouse.move(target2!.x, target2!.y, { steps: 6 });
  await page.waitForTimeout(150);
  const st2 = await previewState(page, target!.id, tf.label);
  expect(st2.dA).not.toBe(st.dA);
  expect(st2.dB).not.toBe(st.dB);
  expect(st2.dropTarget).toBe(true);
  const aEnd2 = { x: st2.nums[0][6], y: st2.nums[0][7] };
  expect(Math.hypot(aEnd2.x - st2.inPort!.x, aEnd2.y - st2.inPort!.y)).toBeLessThan(8);

  // release on blank space (no accidental insert)
  const blank = await findBlankSpot(page);
  if (blank) {
    await page.mouse.move(blank.x, blank.y, { steps: 4 });
    await page.mouse.up();
  } else {
    await page.mouse.up();
  }
  const after = await connCount(page);
  expect(after).toBe(7); // nothing inserted
});

test("insertion preview: overlay z-index below the dragged node", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  const tf = await createTransform(page);
  const tfNode = page.locator(".cyl-rp-node", { hasText: tf.label });
  await expect(tfNode).toBeVisible({ timeout: 10000 });
  await fitGraphForCut(page);

  const target = await connectionPoint(page, { srcKind: "input", tgtLabel: "null3" }, 0.5);
  expect(target).not.toBeNull();
  await dragNodeTo(page, tf.label, target!.x, target!.y);

  const z = await page.evaluate((label) => {
    const overlay = document.querySelector("svg.cyl-insert-preview") as HTMLElement;
    const nodeEl = Array.from(document.querySelectorAll(".cyl-rp-node")).find((e) => e.textContent?.includes(label)) as HTMLElement;
    return {
      overlay: overlay ? parseInt(getComputedStyle(overlay).zIndex, 10) : NaN,
      node: nodeEl ? parseInt(getComputedStyle(nodeEl).zIndex, 10) : NaN,
    };
  }, tf.label);
  expect(Number.isNaN(z.overlay)).toBe(false);
  expect(Number.isNaN(z.node)).toBe(false);
  expect(z.overlay).toBeLessThan(z.node);

  const blank = await findBlankSpot(page);
  if (blank) {
    await page.mouse.move(blank.x, blank.y, { steps: 4 });
    await page.mouse.up();
  } else {
    await page.mouse.up();
  }
});

/** Topology snapshot used by the shake tests (plain JSON: no functions across evaluate). */
async function topology(page: import("@playwright/test").Page, nodeId: string | null) {
  return page.evaluate((nid) => {
    const g: any = (window as any).__cylGraph;
    const ref = (c: any) => {
      const s = g.editor.getNode(c.source);
      const t = g.editor.getNode(c.target);
      return {
        source: c.source,
        sourceOutput: c.sourceOutput,
        target: c.target,
        targetInput: c.targetInput,
        sourceKind: s?.kind,
        targetKind: t?.kind,
      };
    };
    const conns = g.editor.getConnections().map(ref);
    return {
      total: conns.length,
      touching: nid ? conns.filter((c: any) => c.source === nid || c.target === nid) : [],
      conns,
    };
  }, nodeId);
}

/** True when a direct sourceKind.sourceOutput -> targetKind.targetInput connection exists. */
function hasDirect(
  conns: { sourceKind: string; sourceOutput: string; targetKind: string; targetInput: string }[],
  sourceKind: string,
  sourceOutput: string,
  targetKind: string,
  targetInput: string,
): boolean {
  return conns.some(
    (c) => c.sourceKind === sourceKind && c.sourceOutput === sourceOutput && c.targetKind === targetKind && c.targetInput === targetInput,
  );
}

/** Rapid back-and-forth drag on the node (>=3 reversals, >6px segments, <600ms) to trigger shake. */
async function shakeNode(page: import("@playwright/test").Page, label: string): Promise<void> {
  const nb = await page.locator(".cyl-rp-node", { hasText: label }).boundingBox();
  expect(nb).not.toBeNull();
  const cx = nb!.x + nb!.width / 2;
  const cy = nb!.y + nb!.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // 6 alternating moves with small gaps; amplitude kept modest so the cursor
  // never leaves the graph container (outside it the capture listener does not
  // fire), while the shake detector needs >=5 points + >=3 reversals in 600ms.
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(cx + (i % 2 === 0 ? 30 : -30), cy, { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
}

test("shake: null1 pops out of the chain and input.in1 -> output.out1 heals; Ctrl+Z restores", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);

  await fitGraphForCut(page); // keep null1 away from the container edges
  const n1Id = await page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    return g.editor.getNodes().find((n: any) => n.label === "null1").id;
  });
  expect(n1Id).not.toBeUndefined();

  await shakeNode(page, "null1");
  await expect.poll(() => connCount(page), { timeout: 8000 }).toBe(6); // 7 - 2 cut + 1 heal

  let t = await topology(page, n1Id);
  expect(t.touching.length).toBe(0); // null1 fully disconnected
  expect(hasDirect(t.conns, "input", "in1", "output", "out1")).toBe(true); // input.in1 -> output.out1 direct

  // one Ctrl+Z restores input.in1 -> null1.in0 and null1.out0 -> output.out1
  await page.keyboard.press("Control+z");
  await expect.poll(() => connCount(page), { timeout: 8000 }).toBe(7);
  t = await topology(page, n1Id);
  expect(t.touching.length).toBe(2);
  expect(hasDirect(t.conns, "input", "in1", "output", "out1")).toBe(false); // no longer direct
  expect(
    t.touching.some((c: any) => c.sourceOutput === "in1" && c.targetInput === "in0") &&
      t.touching.some((c: any) => c.sourceOutput === "out0" && c.targetInput === "out1"),
  ).toBe(true);
});

test("shake: transform pops out of the chain and heals; Ctrl+Z restores", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  // rewire canonical -> input.in0 -> transform1.in0 -> output.out0
  await page.evaluate(async () => {
    const g: any = (window as any).__cylGraph;
    await g.restoreGraph({
      schemaVersion: 2,
      nodes: [
        { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
        { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 300, y: 80 },
        { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 560, y: 80 },
      ],
      connections: [
        { source: "in", sourceOutput: "in0", target: "tf", targetInput: "in0" },
        { source: "tf", sourceOutput: "out0", target: "out", targetInput: "out0" },
      ],
    });
  });
  await expect.poll(() => connCount(page), { timeout: 8000 }).toBe(2);

  await fitGraphForCut(page); // keep transform1 away from the container edges
  const tfId = await page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    return g.editor.getNodes().find((n: any) => n.kind === "transform").id;
  });
  expect(tfId).not.toBeUndefined();

  await shakeNode(page, "transform1");
  await expect.poll(() => connCount(page), { timeout: 8000 }).toBe(1); // 2 - 2 cut + 1 heal

  let t = await topology(page, tfId);
  expect(t.touching.length).toBe(0); // transform fully disconnected
  expect(hasDirect(t.conns, "input", "in0", "output", "out0")).toBe(true); // input.in0 -> output.out0 direct

  await page.keyboard.press("Control+z");
  await expect.poll(() => connCount(page), { timeout: 8000 }).toBe(2);
  t = await topology(page, tfId);
  expect(t.touching.length).toBe(2);
  expect(hasDirect(t.conns, "input", "in0", "output", "out0")).toBe(false);
  expect(
    t.touching.some((c: any) => c.sourceOutput === "in0" && c.targetInput === "in0") &&
      t.touching.some((c: any) => c.sourceOutput === "out0" && c.targetInput === "out0"),
  ).toBe(true);
});
