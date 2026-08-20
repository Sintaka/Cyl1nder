import { expect, test } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { BridgeClient } from "../src/bridge/client";
import { gotoMember } from "./fixtures";

/**
 * Round 3 integrated E2E (nodeview core write-set).
 * - Y-cut overlay: trajectory stays visible anywhere on the canvas (svg viewport fix).
 * - One stroke across several connections = a single undoable cut-many operation.
 * - transform drag-insert (attachInsertion generalized to 1-in/1-out nodes).
 * - insertion preview renders two flowing Bézier curves while hovering a connection.
 * Self-contained: beforeAll pushes the canonical fixture; every test restores its own
 * graph in-browser; afterAll restores the canonical fixture on disk.
 */
const client = new BridgeClient();
let serial = "";

const CANONICAL_INPUTS = [
  { index: 0, name: "in0", pointCount: 4, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]], curves: [{ pointIndices: [0,1,2,3], widths: null }], faces: [[0,1,2,3]], attributes: {} },
  { index: 1, name: "in1", pointCount: 3, primCount: 1, points: [[0,0,0],[1,0,0],[0,1,0]], curves: [{ pointIndices: [0,1,2], widths: null }], faces: [], attributes: {} },
  { index: 2, name: "in2", pointCount: 5, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0.5,0.5,1]], curves: [{ pointIndices: [0,1,2,3,4], widths: null }], faces: [], attributes: {} },
  { index: 3, name: "in3", pointCount: 2, primCount: 1, points: [[0,0,0],[1,0,0]], curves: [{ pointIndices: [0,1], widths: null }], faces: [], attributes: {} },
];

/** Canonical 7-connection graph (same fixture as round2). */
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

/**
 * Zoom/pan the view so the graph's middle lands in the lower-middle of the canvas
 * (container-relative x/y well beyond the old 300x150 svg viewport).
 */
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
    // Deterministic zoom (independent of the panel size / persisted dock layout):
    // the persisted ui-layout.json drifts across suite runs, and a size-driven k
    // compresses connections enough for the 8px cut tolerance to hit neighbours.
    const k = 0.55;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    await g.area.area.zoom(k);
    await g.area.area.translate(rect.width / 2 - cx * k, rect.height / 2 - cy * k);
    await new Promise((r) => setTimeout(r, 150));
  });
}

/** Screen-space midpoint of the connection whose source kind / target label match. */
async function connectionMid(
  page: import("@playwright/test").Page,
  sel: { srcKind?: string; tgtLabel?: string },
): Promise<{ id: string; x: number; y: number } | null> {
  return page.evaluate((s) => {
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
      const p = path.getPointAtLength(len * 0.5);
      const sp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
      return { id, x: sp.x, y: sp.y };
    }
    return null;
  }, sel);
}

/** Cut-trajectory state: polyline points + bbox vs the svg viewport. */
async function trajectoryState(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const poly = document.querySelector(".cyl-graph polyline") as SVGPolylineElement | null;
    const svg = poly?.ownerSVGElement as SVGSVGElement | null;
    if (!poly || !svg) return null;
    const pts = (poly.getAttribute("points") ?? "").trim().split(/\s+/).filter(Boolean).length;
    const bb = poly.getBBox();
    return {
      points: pts,
      bbox: { x: bb.x, y: bb.y, width: bb.width, height: bb.height },
      view: { width: svg.clientWidth, height: svg.clientHeight },
      inView: bb.x >= 0 && bb.y >= 0 && bb.x + bb.width <= svg.clientWidth && bb.y + bb.height <= svg.clientHeight,
    };
  });
}

/** Minimal PNG decode (8-bit RGB/RGBA, non-interlaced) -> flat RGBA pixels. */
function decodePng(buf: Buffer): { width: number; height: number; rgba: Uint8Array } {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported color type ${colorType}`);
  let pos = 8;
  const idat: Buffer[] = [];
  for (;;) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    if (type === "IDAT") idat.push(buf.subarray(pos + 8, pos + 8 + len));
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pred) & 0xff;
      }
      out[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const r = out[x * channels];
      const g = out[x * channels + 1];
      const b = out[x * channels + 2];
      rgba[(y * width + x) * 4] = r;
      rgba[(y * width + x) * 4 + 1] = g;
      rgba[(y * width + x) * 4 + 2] = b;
      rgba[(y * width + x) * 4 + 3] = channels === 4 ? out[x * channels + 3] : 255;
    }
    prev = out;
  }
  return { width, height, rgba };
}

/** True when the image contains the cut-line red (#ff3b30, with tolerance). */
function hasCutRed(buf: Buffer): boolean {
  const { width, height, rgba } = decodePng(buf);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    if (r > 200 && g < 120 && b < 120) return true;
  }
  return false;
}

/** Y-drag a horizontal line through a screen-space point; checks trajectory + red pixels. */
async function horizontalCut(page: import("@playwright/test").Page, p: { x: number; y: number }): Promise<void> {
  await page.keyboard.down("y");
  await page.mouse.move(p.x - 40, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y, { steps: 4 });
  const t = await trajectoryState(page);
  expect(t).not.toBeNull();
  expect(t!.points).toBeGreaterThan(1);
  expect(t!.inView).toBe(true);
  // pixel check: a clipped screenshot around the visible polyline contains red
  const clip = await page.evaluate(() => {
    const poly = document.querySelector(".cyl-graph polyline") as SVGPolylineElement | null;
    if (!poly) return null;
    const bb = poly.getBoundingClientRect();
    const x = Math.max(0, bb.left + window.scrollX - 24);
    const y = Math.max(0, bb.top + window.scrollY - 24);
    return {
      x,
      y,
      width: Math.min(window.innerWidth - x, bb.width + 48),
      height: Math.min(window.innerHeight - y, bb.height + 48),
    };
  });
  expect(clip).not.toBeNull();
  const png = await page.screenshot({ clip: clip! });
  expect(hasCutRed(png)).toBe(true);
  await page.mouse.move(p.x + 40, p.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("y");
}

test("Y cut: trajectory stays visible on a second stroke in the lower-middle of the canvas", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  const before = await connCount(page);
  await fitGraphForCut(page);

  // input -> output (i->o): its midpoint sits at container-relative x beyond 300
  const io = await connectionMid(page, { srcKind: "input", tgtLabel: "_output_" });
  expect(io).not.toBeNull();
  // input -> null3 (i->n3): midpoint sits at container-relative y beyond 150
  const in3 = await connectionMid(page, { srcKind: "input", tgtLabel: "null3" });
  expect(in3).not.toBeNull();

  await horizontalCut(page, io!);
  await expect.poll(() => connCount(page), { timeout: 5000 }).toBe(before - 1);

  // second stroke on a different connection: trajectory still visible
  await horizontalCut(page, in3!);
  await expect.poll(() => connCount(page), { timeout: 5000 }).toBe(before - 2);
});

test("Y cut: one stroke across two connections is a single undo operation", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  const before = await connCount(page);
  expect(before).toBe(7);
  await fitGraphForCut(page);

  const io = await connectionMid(page, { srcKind: "input", tgtLabel: "_output_" });
  const in3 = await connectionMid(page, { srcKind: "input", tgtLabel: "null3" });
  expect(io).not.toBeNull();
  expect(in3).not.toBeNull();

  // one L-shaped stroke through both connection midpoints
  await page.keyboard.down("y");
  await page.mouse.move(io!.x, io!.y);
  await page.mouse.down();
  await page.mouse.move(io!.x, in3!.y, { steps: 6 });
  await page.mouse.move(in3!.x, in3!.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("y");
  await expect.poll(() => connCount(page), { timeout: 5000 }).toBe(before - 2);

  // one Ctrl+Z restores BOTH connections (cut-many = a single undo entry)
  await page.keyboard.press("Control+z");
  await expect.poll(() => connCount(page), { timeout: 5000 }).toBe(before);
  await page.keyboard.press("Control+y");
  await expect.poll(() => connCount(page), { timeout: 5000 }).toBe(before - 2);
});

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

test("transform drag-insert: dragging transform onto a connection splits it", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  const tf = await createTransform(page);
  const tfNode = page.locator(".cyl-rp-node", { hasText: tf.label });
  await expect(tfNode).toBeVisible({ timeout: 10000 });
  // fit the graph so the target connection sits in open space (the new node would
  // otherwise cover the only open connection in the default view)
  await fitGraphForCut(page);
  const nb = await tfNode.boundingBox();
  expect(nb).not.toBeNull();

  const target = await connectionMid(page, { srcKind: "input", tgtLabel: "null3" });
  expect(target).not.toBeNull();
  const before = await connCount(page);
  await page.mouse.move(nb!.x + nb!.width / 2, nb!.y + nb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x, target!.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => connCount(page), { timeout: 5000 }).toBe(before + 1); // A->B split into A->tf + tf->B

  const split = await page.evaluate((tfId) => {
    const g: any = (window as any).__cylGraph;
    const conns = g.editor.getConnections();
    const inC = conns.find((c: any) => c.target === tfId && c.targetInput === "in0");
    const outC = conns.find((c: any) => c.source === tfId && c.sourceOutput === "out0");
    return {
      inC: inC ? { source: inC.source, sourceOutput: inC.sourceOutput, target: inC.target, targetInput: inC.targetInput } : null,
      outC: outC ? { source: outC.source, sourceOutput: outC.sourceOutput, target: outC.target, targetInput: outC.targetInput } : null,
    };
  }, tf.id);
  expect(split.inC).not.toBeNull();
  expect(split.outC).not.toBeNull();
});

test("insertion preview: dragging a node over a connection shows two curved paths", async ({ page }) => {
  await openGraph(page);
  await restoreCanonicalGraph(page);
  const tf = await createTransform(page);
  const tfNode = page.locator(".cyl-rp-node", { hasText: tf.label });
  await expect(tfNode).toBeVisible({ timeout: 10000 });
  await fitGraphForCut(page);
  const nb = await tfNode.boundingBox();
  expect(nb).not.toBeNull();

  const target = await connectionMid(page, { srcKind: "input", tgtLabel: "null3" });
  expect(target).not.toBeNull();
  await page.mouse.move(nb!.x + nb!.width / 2, nb!.y + nb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x, target!.y, { steps: 10 });
  await page.waitForTimeout(120);

  const dAttrs = await page.evaluate(() => {
    const paths = Array.from(document.querySelectorAll(".cyl-graph svg.cyl-insert-preview path.cyl-insert-preview-path"));
    return paths.map((p) => p.getAttribute("d") ?? "");
  });
  expect(dAttrs.length).toBe(2);
  for (const d of dAttrs) {
    expect(d.startsWith("M ")).toBe(true);
    expect(d.includes(" C ")).toBe(true);
  }
  await page.mouse.up();
});
