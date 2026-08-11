import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";

/**
 * Round 5 (viewport write-set): pivot translate + disconnect display refresh.
 * - transform params carry px/py/pz (Pivot Translate). Enter mode puts the
 *   translate gizmo at (tx,ty,tz) but the reference marker at the pivot
 *   (px,py,pz); gizmo drags update tx/ty/tz only and the marker stays put.
 * - displaying a null/transform node with NO connected input hides every input
 *   port (no more overlapping geometry at the origin); reconnecting restores it.
 * Self-contained: beforeAll pushes the canonical fixture; afterAll restores it.
 */
const client = new BridgeClient();
let serial = "";

/** Canonical 4-input fixture (input0 = the 4-pt square). */
const CANONICAL_INPUTS = [
  { index: 0, name: "in0", pointCount: 4, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]], curves: [{ pointIndices: [0,1,2,3], widths: null }], faces: [[0,1,2,3]], attributes: {} },
  { index: 1, name: "in1", pointCount: 3, primCount: 1, points: [[0,0,0],[1,0,0],[0,1,0]], curves: [{ pointIndices: [0,1,2], widths: null }], faces: [], attributes: {} },
  { index: 2, name: "in2", pointCount: 5, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0.5,0.5,1]], curves: [{ pointIndices: [0,1,2,3,4], widths: null }], faces: [], attributes: {} },
  { index: 3, name: "in3", pointCount: 2, primCount: 1, points: [[0,0,0],[1,0,0]], curves: [{ pointIndices: [0,1], widths: null }], faces: [], attributes: {} },
];

/** Canonical 7-connection graph (same fixture as round2/round3) for afterAll restore. */
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

/** input -> transform (tx/ty/tz=1/2/3, px/py/pz=5/6/7) -> output. */
const PIVOT_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: false, bypass: false, freeze: false, reference: false }, params: [
      { name: "tx", type: "float", value: 1 }, { name: "ty", type: "float", value: 2 }, { name: "tz", type: "float", value: 3 },
      { name: "px", type: "float", value: 5 }, { name: "py", type: "float", value: 6 }, { name: "pz", type: "float", value: 7 },
      { name: "group", type: "string", value: "" }, { name: "class", type: "string", value: "autoguess" },
    ], x: 400, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 560, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in0", target: "tf", targetInput: "in0" },
    { source: "tf", sourceOutput: "out0", target: "out", targetInput: "out0" },
  ],
};

/** Canonical graph with null3 DISPLAYED (wired from in3). */
const N3_DISPLAY_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "i", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "n1", kind: "null", label: "null1", baseLabel: "null", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 300, y: 40 },
    { id: "n2", kind: "null", label: "null2", baseLabel: "null", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 300, y: 200 },
    { id: "n3", kind: "null", label: "null3", baseLabel: "null", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 300, y: 360 },
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

/** input -> transform1 (DISPLAYED) -> output. */
const TF_DISPLAY_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: true, bypass: false, freeze: false, reference: false }, params: [
      { name: "tx", type: "float", value: 0 }, { name: "ty", type: "float", value: 0 }, { name: "tz", type: "float", value: 0 },
      { name: "px", type: "float", value: 0 }, { name: "py", type: "float", value: 0 }, { name: "pz", type: "float", value: 0 },
      { name: "group", type: "string", value: "" }, { name: "class", type: "string", value: "autoguess" },
    ], x: 300, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 560, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in0", target: "tf", targetInput: "in0" },
    { source: "tf", sourceOutput: "out0", target: "out", targetInput: "out0" },
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

/** Restore a graph in-browser (plain JSON: no functions across evaluate). */
async function restoreGraph(page: import("@playwright/test").Page, g: unknown, conns: number): Promise<void> {
  await page.evaluate(async (graph) => {
    const g: any = (window as any).__cylGraph;
    await g.restoreGraph(JSON.parse(JSON.stringify(graph)));
  }, g);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylGraph.editor.getConnections().length), { timeout: 15000 })
    .toBe(conns);
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

/** Per-port visibility of the viewport input group (input0..input3). */
async function inputPortVisibility(page: import("@playwright/test").Page): Promise<boolean[]> {
  return page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const vis: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const g = v.scene.getObjectByName(`input${i}`);
      vis.push(!!g && g.visible);
    }
    return vis;
  });
}
/** True when the viewport is showing a displayed node's computed result geometry (Round 7). */
async function nodeResultVisible(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const g = v.scene.getObjectByName("cyl-node-result");
    return !!g && g.visible && g.children.length > 0;
  });
}


/** Zoom/pan the graph so the connections land in open canvas space (same as round3/4). */
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

/** Screen-space point on the connection whose source kind / target label match. */
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

/** Hold-Y click on the connection path -> single cut (real user gesture, fires onNetworkChanged). */
async function yCutAt(page: import("@playwright/test").Page, p: { x: number; y: number }): Promise<void> {
  await page.keyboard.down("y");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up("y");
  await page.waitForTimeout(250);
}

test("pivot translate: gizmo at tx/ty/tz, marker at pivot; drag moves tx/ty/tz only", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page, PIVOT_GRAPH, 2);

  // select the transform node, then activate with the Enter KEY
  // (Enter only responds while hovering the viewport - Round 6)
  await page.locator(".cyl-rp-title", { hasText: /^transform\d+$/ }).first().click({ timeout: 15000 });
  await page.locator(".cyl-viewport canvas").hover();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(true);

  // gizmo object sits on tx/ty/tz; reference marker sits on the pivot px/py/pz
  const pos = await page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const gizmo = v.scene.getObjectByName("cyl-enter-gizmo");
    const pivot = v.scene.getObjectByName("cyl-enter-pivot");
    return {
      gizmo: gizmo ? { x: gizmo.position.x, y: gizmo.position.y, z: gizmo.position.z } : null,
      pivot: pivot ? { x: pivot.position.x, y: pivot.position.y, z: pivot.position.z } : null,
    };
  });
  expect(pos.gizmo).toEqual({ x: 1, y: 2, z: 3 });
  expect(pos.pivot).toEqual({ x: 5, y: 6, z: 7 });

  // simulate a translate drag: move the temp gizmo object, emit objectChange
  await page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const obj = v.scene.getObjectByName("cyl-enter-gizmo");
    if (!obj) throw new Error("enter gizmo object missing");
    obj.position.set(1.5, -0.25, 0.5);
    v.transform.dispatchEvent({ type: "objectChange" });
  });

  // tx/ty/tz follow the drag; px/py/pz stay untouched
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const g: any = (window as any).__cylGraph;
          const n = g.editor.getNodes().find((x: any) => x.kind === "transform");
          const p: Record<string, unknown> = {};
          for (const q of n.params) p[q.name] = q.value;
          return { tx: p.tx, ty: p.ty, tz: p.tz, px: p.px, py: p.py, pz: p.pz };
        }),
      { timeout: 10000 },
    )
    .toEqual({ tx: 1.5, ty: -0.25, tz: 0.5, px: 5, py: 6, pz: 7 });

  // bridge outputs translated by (1.5, -0.25, 0.5)
  const outs = await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0] - 1.5) < 1e-6;
    },
    10000,
    "translated outputs",
  );
  const out0 = outs.find((x) => x.index === 0)!;
  expect(out0.points[0]).toEqual([1.5, -0.25, 0.5]);
  expect(out0.points[1]).toEqual([2.5, -0.25, 0.5]);
  expect(out0.points[2]).toEqual([2.5, 0.75, 0.5]);
  expect(out0.points[3]).toEqual([1.5, 0.75, 0.5]);

  // pivot marker did NOT move with the gizmo
  const pivotAfter = await page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const pivot = v.scene.getObjectByName("cyl-enter-pivot");
    return pivot ? { x: pivot.position.x, y: pivot.position.y, z: pivot.position.z } : null;
  });
  expect(pivotAfter).toEqual({ x: 5, y: 6, z: 7 });

  // Esc exits the mode
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(false);
});

test("disconnect refresh: displayed null/transform with no input hides every port; reconnect restores", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page, N3_DISPLAY_GRAPH, 7);
  await fitGraphForCut(page);

  // null3 displayed + wired from in3 -> source ports hidden, computed result shown
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);
  expect(await nodeResultVisible(page)).toBe(true);

  // cut i.in3 -> null3.in0 (real Y gesture, fires onNetworkChanged)
  const cut = await connectionPoint(page, { srcKind: "input", tgtLabel: "null3" }, 0.5);
  expect(cut).not.toBeNull();
  await yCutAt(page, cut!);
  await expect.poll(() => page.evaluate(() => (window as any).__cylGraph.editor.getConnections().length), { timeout: 8000 }).toBe(6);

  // display null3 now has NO input -> every input port hidden (no overlap)
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);

  // reconnect -> computed result shown again (source ports stay hidden)
  await restoreGraph(page, N3_DISPLAY_GRAPH, 7);
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);
  expect(await nodeResultVisible(page)).toBe(true);

  // same rule on a displayed TRANSFORM node. The transform row overlaps inside the
  // docked graph panel, so disconnect deterministically via graph restore (the
  // Y gesture is only reliable where the connection path sits on blank canvas).
  await restoreGraph(page, TF_DISPLAY_GRAPH, 2);
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);
  expect(await nodeResultVisible(page)).toBe(true);

  const tfDisconnected = JSON.parse(JSON.stringify(TF_DISPLAY_GRAPH)) as typeof TF_DISPLAY_GRAPH;
  tfDisconnected.connections = tfDisconnected.connections.filter(
    (c) => !(c.target === "tf" && c.targetInput === "in0"),
  );
  await restoreGraph(page, tfDisconnected, 1);
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);

  // reconnect -> computed result shown again
  await restoreGraph(page, TF_DISPLAY_GRAPH, 2);
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);
  expect(await nodeResultVisible(page)).toBe(true);
});
