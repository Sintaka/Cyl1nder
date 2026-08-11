import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";

/**
 * Round 5 integrated E2E (nodeview core write-set).
 * - insertion preview endpoints snap to the socket CIRCLE centers (span.input /
 *   span.output inside the port row), not the whole port row, and stay below
 *   the dragged node (overlay z-index 0 < node z-index 1).
 * - shake triggers on a slow "real-feel" shake (4 round trips ~800ms, 40px
 *   segments) and pops null1 out of the chain (input.in1 -> output.out1 heals);
 *   a slow one-way drag does NOT trigger shake.
 * - self-connections are blocked everywhere: port drag (connection plugin) and
 *   restoreGraph both skip source === target.
 * - dragging from a port (not the node body) never starts the insertion preview.
 * - the graph surface is not text-selectable (user-select: none).
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

/** Canonical 7-connection graph (same fixture as round2/round3/round4). */
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
  await page.goto(`http://127.0.0.1:8376/?serial=${serial}`);
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

/** Zoom/pan the view so the graph lands in open canvas space (same as round3/4). */
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

/** Screen-space center of a node's RefSocket circle span (input/output). */
async function socketCenter(
  page: import("@playwright/test").Page,
  label: string,
  portId: string,
): Promise<{ x: number; y: number } | null> {
  return page.evaluate(({ lbl, pid }) => {
    const nodeEl = Array.from(document.querySelectorAll(".cyl-rp-node")).find((e) => e.textContent?.includes(lbl));
    const el = nodeEl?.querySelector(`[data-port-id="${pid}"] > span.input, [data-port-id="${pid}"] > span.output`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { lbl: label, pid: portId });
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

/** Slow "real-feel" shake: 4 round trips (~800ms total, 40px segments) on the node body. */
async function slowShake(page: import("@playwright/test").Page, label: string): Promise<void> {
  const nb = await page.locator(".cyl-rp-node", { hasText: label }).boundingBox();
  expect(nb).not.toBeNull();
  const cx = nb!.x + nb!.width / 2;
  const cy = nb!.y + nb!.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(cx + (i % 2 === 0 ? 40 : -40), cy, { steps: 1 });
    await page.waitForTimeout(100);
  }
  await page.mouse.up();
}

test("insertion preview endpoints align to the socket circle centers and stay below the node", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  const tf = await createTransform(page);
  const tfNode = page.locator(".cyl-rp-node", { hasText: tf.label });
  await expect(tfNode).toBeVisible({ timeout: 10000 });
  await fitGraphForCut(page);

  const target = await connectionPoint(page, { srcKind: "input", tgtLabel: "null3" }, 0.5);
  expect(target).not.toBeNull();
  await dragNodeTo(page, tf.label, target!.x, target!.y);
  await page.waitForTimeout(200); // let the preview settle after the final move

  const st = await page.evaluate((label) => {
    const rect = document.querySelector(".cyl-graph")!.getBoundingClientRect();
    const nodeEl = Array.from(document.querySelectorAll(".cyl-rp-node")).find((e) => e.textContent?.includes(label));
    const circle = (portId: string) => {
      const el = nodeEl?.querySelector(`[data-port-id="${portId}"] > span.input, [data-port-id="${portId}"] > span.output`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - rect.left, y: r.top + r.height / 2 - rect.top };
    };
    const paths = Array.from(document.querySelectorAll("svg.cyl-insert-preview path.cyl-insert-preview-path"));
    const numsA = (paths[0]?.getAttribute("d") ?? "").match(/-?[\d.]+/g)?.map(Number) ?? [];
    const numsB = (paths[1]?.getAttribute("d") ?? "").match(/-?[\d.]+/g)?.map(Number) ?? [];
    return {
      aEnd: numsA.length >= 2 ? { x: numsA[numsA.length - 2], y: numsA[numsA.length - 1] } : null,
      bStart: numsB.length >= 2 ? { x: numsB[0], y: numsB[1] } : null,
      inC: circle("in0"),
      outC: circle("out0"),
    };
  }, tf.label);
  expect(st.aEnd).not.toBeNull();
  expect(st.bStart).not.toBeNull();
  expect(st.inC).not.toBeNull();
  expect(st.outC).not.toBeNull();
  // previewA ends at the dragged node IN socket circle center
  expect(Math.abs(st.aEnd!.x - st.inC!.x)).toBeLessThanOrEqual(4);
  expect(Math.abs(st.aEnd!.y - st.inC!.y)).toBeLessThanOrEqual(4);
  // previewB starts at the dragged node OUT socket circle center
  expect(Math.abs(st.bStart!.x - st.outC!.x)).toBeLessThanOrEqual(4);
  expect(Math.abs(st.bStart!.y - st.outC!.y)).toBeLessThanOrEqual(4);

  // overlay stays below the dragged node (behind it, not covering it)
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

test("shake: slow real-feel shaking pops null1 and heals; slow one-way drag does not", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  await fitGraphForCut(page); // keep null1 away from the container edges
  const n1Id = await page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    return g.editor.getNodes().find((n: any) => n.label === "null1").id;
  });
  expect(n1Id).not.toBeUndefined();

  await slowShake(page, "null1");
  await expect.poll(() => connCount(page), { timeout: 8000 }).toBe(6); // 7 - 2 cut + 1 heal

  let t = await topology(page, n1Id);
  expect(t.touching.length).toBe(0); // null1 fully disconnected
  expect(hasDirect(t.conns, "input", "in1", "output", "out1")).toBe(true); // input.in1 -> output.out1 direct

  // slow one-way drag (no reversals) must NOT trigger shake
  await restoreCanonicalGraph(page);
  await fitGraphForCut(page);
  const n2Id = await page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    return g.editor.getNodes().find((n: any) => n.label === "null2").id;
  });
  expect(n2Id).not.toBeUndefined();
  const nb = await page.locator(".cyl-rp-node", { hasText: "null2" }).boundingBox();
  expect(nb).not.toBeNull();
  const blank = await findBlankSpot(page);
  await page.mouse.move(nb!.x + nb!.width / 2, nb!.y + nb!.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(nb!.x + nb!.width / 2 + i * 30, nb!.y + nb!.height / 2, { steps: 1 });
    await page.waitForTimeout(130);
  }
  if (blank) await page.mouse.move(blank.x, blank.y, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await connCount(page)).toBe(7); // no shake, no insertion
  const t2 = await topology(page, n2Id);
  expect(t2.touching.length).toBe(2); // null2 still connected
});

test("self-connection blocked: port drag and restoreGraph both skip", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  await fitGraphForCut(page);
  const tf = await createTransform(page);
  await expect(page.locator(".cyl-rp-node", { hasText: tf.label })).toBeVisible({ timeout: 10000 });

  // drag from the transform's OUT socket to its own IN socket
  const out = await socketCenter(page, tf.label, "out0");
  const inn = await socketCenter(page, tf.label, "in0");
  expect(out).not.toBeNull();
  expect(inn).not.toBeNull();
  await page.mouse.move(out!.x, out!.y);
  await page.mouse.down();
  await page.mouse.move(inn!.x, inn!.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await connCount(page)).toBe(7); // transform still has 0 connections

  // restoreGraph with a same-node self-connection is skipped
  await page.evaluate(async () => {
    const graph: any = (window as any).__cylGraph;
    await graph.restoreGraph({
      schemaVersion: 2,
      nodes: [
        { id: "i", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
        { id: "tf", kind: "transform", label: "transformX", baseLabel: "transform", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 300, y: 80 },
        { id: "o", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 560, y: 80 },
      ],
      connections: [{ source: "tf", sourceOutput: "out0", target: "tf", targetInput: "in0" }],
    });
  });
  await page.waitForTimeout(300);
  expect(await connCount(page)).toBe(0); // self-connection skipped
});

test("port drag does not trigger insertion preview", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  await fitGraphForCut(page);
  const tf = await createTransform(page);
  await expect(page.locator(".cyl-rp-node", { hasText: tf.label })).toBeVisible({ timeout: 10000 });

  // start dragging from the transform's IN port (input socket), not the node body
  const inn = await socketCenter(page, tf.label, "in0");
  expect(inn).not.toBeNull();
  const over = await connectionPoint(page, { srcKind: "input", tgtLabel: "null3" }, 0.5);
  expect(over).not.toBeNull();

  await page.mouse.move(inn!.x, inn!.y);
  await page.mouse.down();
  await page.mouse.move(over!.x, over!.y, { steps: 6 });
  await page.waitForTimeout(200);

  const preview = await page.evaluate(() => {
    const paths = Array.from(document.querySelectorAll("svg.cyl-insert-preview path.cyl-insert-preview-path"));
    return paths.map((p) => p.getAttribute("d") ?? "");
  });
  expect(preview.length).toBe(2);
  for (const d of preview) expect(d).toBe(""); // no insertion preview started

  const blank = await findBlankSpot(page);
  if (blank) await page.mouse.move(blank.x, blank.y, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(await connCount(page)).toBe(7); // nothing changed
});

test("graph surface is not text-selectable", async ({ page }) => {
  await openGraph(page);
  const u = await page.evaluate(() => {
    const g = document.querySelector(".cyl-graph");
    return g ? getComputedStyle(g).userSelect : null;
  });
  expect(u).toBe("none");
});