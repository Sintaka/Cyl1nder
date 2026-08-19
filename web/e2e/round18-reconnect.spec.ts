import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";

/**
 * Round 18 (nodeview reconnect + waypoint + Esc + Delete write-set):
 * 1. attachReconnect: grab an existing connection (pointerdown + drag >6px),
 *    preview re-route with dashed curves, release over another input port ->
 *    connection re-routed (bridge network recomputes via onNetworkChanged).
 * 2. Release over blank -> still grabbed (preview alive); ESC restores.
 * 3. Alt+click a connection -> a waypoint (pure decoration on the connection
 *    itself) appears; topology is untouched, so nothing is spliced.
 * 4. Dragging a new connection from a port then ESC -> no connection created.
 * 5. Delete removes selected node + its connections (no undo in v1).
 * Self-contained: beforeAll pushes the canonical fixture; afterAll restores it.
 */
const client = new BridgeClient();
let serial = "";

const CANONICAL_INPUTS = [
  { index: 0, name: "in0", pointCount: 4, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]], curves: [{ pointIndices: [0,1,2,3], widths: null }], faces: [[0,1,2,3]], attributes: {} },
  { index: 1, name: "in1", pointCount: 3, primCount: 1, points: [[0,0,0],[1,0,0],[0,1,0]], curves: [{ pointIndices: [0,1,2], widths: null }], faces: [], attributes: {} },
  { index: 2, name: "in2", pointCount: 5, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0.5,0.5,1]], curves: [{ pointIndices: [0,1,2,3,4], widths: null }], faces: [], attributes: {} },
  { index: 3, name: "in3", pointCount: 2, primCount: 1, points: [[0,0,0],[1,0,0]], curves: [{ pointIndices: [0,1], widths: null }], faces: [], attributes: {} },
];

/** Compact fixture: input -> null1 -> output + a direct in.in1 -> out.out1 edge. */
const GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    // n1 sits BELOW the in->out lane so every connection runs through blank space
    // (nodes are 264px wide; adjacent edges would otherwise cover the line).
    { id: "n1", kind: "null", label: "null1", baseLabel: "null", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 420, y: 320 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 760, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in0", target: "n1", targetInput: "in0" },
    { source: "n1", sourceOutput: "out0", target: "out", targetInput: "out0" },
    { source: "in", sourceOutput: "in1", target: "out", targetInput: "out1" },
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
    await client.putSnapshot(serial, { graph: GRAPH });
  } catch {
    /* fixture restore best-effort */
  }
});

type Page = import("@playwright/test").Page;

async function openGraph(page: Page): Promise<void> {
  await page.goto(`http://127.0.0.1:8376/?serial=${serial}`);
  await expect(page.locator(".cyl-graph .cyl-rp-title").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".cyl-status")).toHaveClass(/ok/, { timeout: 15000 });
}

async function restoreGraph(page: Page): Promise<void> {
  await page.evaluate(async (g) => {
    const graph: any = (window as any).__cylGraph;
    await graph.restoreGraph(JSON.parse(JSON.stringify(g)));
  }, GRAPH);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylGraph.editor.getConnections().length), { timeout: 15000 })
    .toBe(3);
}

/** Zoom/pan so the whole graph is visible and centered (from round4). */
async function fitGraph(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const g: any = (window as any).__cylGraph;
    const rect = document.querySelector(".cyl-graph")!.getBoundingClientRect();
    const nodes = g.editor.getNodes();
    const xs = nodes.map((n: any) => g.area.nodeViews.get(n.id).position.x);
    const ys = nodes.map((n: any) => g.area.nodeViews.get(n.id).position.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs) + 300;
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

/** A screen-space point on the connection (srcLabel.srcOut -> tgtLabel.tgtIn) that is
 *  NOT covered by a node/port div - the app grabs by geometry, but the pointer must
 *  actually land on a visible stretch of the line (nodes overlap short/adjacent edges). */
async function connectionPoint(
  page: Page,
  m: { srcLabel: string; srcOut: string; tgtLabel: string; tgtIn: string },
): Promise<{ id: string; x: number; y: number } | null> {
  return page.evaluate(({ mm }) => {
    const g: any = (window as any).__cylGraph;
    for (const [id, view] of g.area.connectionViews) {
      const c = g.editor.getConnection(id);
      const src = g.editor.getNode(c.source);
      const tgt = g.editor.getNode(c.target);
      if (src.label !== mm.srcLabel || tgt.label !== mm.tgtLabel) continue;
      if (String(c.sourceOutput) !== mm.srcOut || String(c.targetInput) !== mm.tgtIn) continue;
      const path = view.element.querySelector("path");
      if (!path || typeof path.getTotalLength !== "function") continue;
      const len = path.getTotalLength();
      const ctm = path.getScreenCTM();
      if (!ctm) continue;
      for (let f = 0.2; f <= 0.85; f += 0.05) {
        const p = path.getPointAtLength(len * f);
        const sp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
        const el = document.elementFromPoint(sp.x, sp.y);
        if (el && !el.closest?.(".cyl-rp-node") && !el.closest?.(".cyl-rp-port")) {
          return { id, x: sp.x, y: sp.y };
        }
      }
      return null;
    }
    return null;
  }, { mm: m });
}

/** Screen-space center of a node's port socket circle (RefSocket span). */
async function portCenter(page: Page, nodeLabel: string, portId: string, side: "input" | "output"): Promise<{ x: number; y: number } | null> {
  return page.evaluate(({ label, port, s }) => {
    const g: any = (window as any).__cylGraph;
    const node = g.editor.getNodes().find((n: any) => n.label === label);
    if (!node) return null;
    const el = g.area.nodeViews.get(node.id).element.querySelector(`[data-port-id="${port}"]`);
    if (!el) return null;
    const sock = el.querySelector(`:scope > span.${s}`);
    const target = (sock ?? el) as HTMLElement;
    const r = target.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { label: nodeLabel, port: portId, s: side });
}

async function snapshot(page: Page): Promise<{
  nodes: { id: string; kind: string; label: string }[];
  connections: { source: string; sourceOutput: string; target: string; targetInput: string }[];
}> {
  return page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    return g.getNetworkSnapshot();
  });
}

/** Waypoints read straight off the editor's connections, resolved to node labels.
 *  getNetworkSnapshot deliberately omits waypoint (that omission is what makes a
 *  waypoint cook-neutral), so the snapshot above cannot be used to observe one. */
async function waypoints(page: Page): Promise<
  { x: number; y: number; sourceLabel: string; sourceOutput: string; targetLabel: string; targetInput: string }[]
> {
  return page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    const labelOf = (id: string) => g.editor.getNode(id)?.label ?? id;
    return g.editor
      .getConnections()
      .filter((c: any) => c.waypoint)
      .map((c: any) => ({
        x: c.waypoint.x,
        y: c.waypoint.y,
        sourceLabel: labelOf(c.source),
        sourceOutput: String(c.sourceOutput),
        targetLabel: labelOf(c.target),
        targetInput: String(c.targetInput),
      }));
  });
}

function hasConn(
  snap: { nodes: { id: string; label: string }[]; connections: { source: string; sourceOutput: string; target: string; targetInput: string }[] },
  srcLabel: string,
  srcOut: string,
  tgtLabel: string,
  tgtIn: string,
): boolean {
  const labelOf = (id: string) => snap.nodes.find((n) => n.id === id)?.label ?? id;
  return snap.connections.some(
    (c) => labelOf(c.source) === srcLabel && String(c.sourceOutput) === srcOut && labelOf(c.target) === tgtLabel && String(c.targetInput) === tgtIn,
  );
}

/** A point on the graph surface guaranteed to be outside every node's box. */
async function blankPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    const rect = document.querySelector(".cyl-graph")!.getBoundingClientRect();
    const candidates = [
      { x: rect.left + 30, y: rect.top + 30 },
      { x: rect.left + 30, y: rect.bottom - 30 },
      { x: rect.right - 30, y: rect.top + 30 },
      { x: rect.right - 30, y: rect.bottom - 30 },
    ];
    for (const cand of candidates) {
      let inside = false;
      for (const [, view] of g.area.nodeViews) {
        const r = view.element.getBoundingClientRect();
        if (cand.x >= r.left && cand.x <= r.right && cand.y >= r.top && cand.y <= r.bottom) {
          inside = true;
          break;
        }
      }
      if (!inside) return cand;
    }
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}

const previewD = (page: Page) =>
  page.evaluate(() => document.querySelector(".cyl-reconnect-preview path")?.getAttribute("d") ?? null);

test("reconnect: drag connection to another input port and release -> re-routed", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page);
  await fitGraph(page);

  const mid = await connectionPoint(page, { srcLabel: "null1", srcOut: "out0", tgtLabel: "_output_", tgtIn: "out0" });
  expect(mid).not.toBeNull();
  const port = await portCenter(page, "_output_", "out2", "input");
  expect(port).not.toBeNull();

  await page.mouse.move(mid!.x, mid!.y);
  await page.mouse.down();
  await page.mouse.move(port!.x, port!.y, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const snap = await snapshot(page);
      return hasConn(snap, "null1", "out0", "_output_", "out2") ? "ok" : "pending";
    }, { timeout: 10000 })
    .toBe("ok");

  const snap = await snapshot(page);
  expect(hasConn(snap, "null1", "out0", "_output_", "out0")).toBe(false); // old target freed
  expect(hasConn(snap, "null1", "out0", "_output_", "out2")).toBe(true);
  expect(snap.connections.length).toBe(3);
  // preview overlay is gone after the gesture ends
  expect(await previewD(page)).toBe("");
});

test("reconnect: release over blank stays grabbed (preview live), ESC restores", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page);
  await fitGraph(page);

  const mid = await connectionPoint(page, { srcLabel: "_input_", srcOut: "in0", tgtLabel: "null1", tgtIn: "in0" });
  expect(mid).not.toBeNull();
  const blank = await blankPoint(page);

  await page.mouse.move(mid!.x, mid!.y);
  await page.mouse.down();
  await page.mouse.move(blank.x, blank.y, { steps: 12 });
  await page.mouse.up();

  // released over blank: still grabbed, preview keeps drawing
  await expect.poll(() => previewD(page), { timeout: 5000 }).not.toBe("");

  // ESC cancels: original connection untouched
  await page.keyboard.press("Escape");
  await expect.poll(() => previewD(page), { timeout: 5000 }).toBe("");

  const snap = await snapshot(page);
  expect(hasConn(snap, "_input_", "in0", "null1", "in0")).toBe(true);
  expect(snap.connections.length).toBe(3);
});

test("Alt+click on a connection produces a waypoint (topology untouched)", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page);
  await fitGraph(page);

  const mid = await connectionPoint(page, { srcLabel: "_input_", srcOut: "in1", tgtLabel: "_output_", tgtIn: "out1" });
  expect(mid).not.toBeNull();

  await page.keyboard.down("Alt");
  await page.mouse.click(mid!.x, mid!.y);
  await page.keyboard.up("Alt");

  // waypoint lives on the CONNECTION, so it is read from the editor - it is
  // deliberately absent from getNetworkSnapshot (that absence IS cook-neutrality).
  await expect
    .poll(async () => ((await waypoints(page)).length > 0 ? "ok" : "pending"), { timeout: 10000 })
    .toBe("ok");

  const wps = await waypoints(page);
  expect(wps.length).toBe(1);
  expect(Number.isFinite(wps[0].x)).toBe(true);
  expect(Number.isFinite(wps[0].y)).toBe(true);

  // the waypoint sits on the very connection that was clicked
  expect(wps[0].sourceLabel).toBe("_input_");
  expect(wps[0].sourceOutput).toBe("in1");
  expect(wps[0].targetLabel).toBe("_output_");
  expect(wps[0].targetInput).toBe("out1");

  const snap = await snapshot(page);
  // nothing was spliced: same 3 connections, original edge still end-to-end
  expect(snap.connections.length).toBe(3);
  expect(hasConn(snap, "_input_", "in1", "_output_", "out1")).toBe(true);
  expect(snap.nodes.some((n) => n.kind === "dot")).toBe(false);
});

test("drag a new connection from a port, press Esc -> nothing created", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page);
  await fitGraph(page);

  const sock = await portCenter(page, "null1", "out0", "output");
  expect(sock).not.toBeNull();

  await page.mouse.move(sock!.x, sock!.y);
  await page.mouse.down();
  await page.mouse.move(sock!.x + 120, sock!.y + 40, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();

  await page.waitForTimeout(300);
  const snap = await snapshot(page);
  expect(snap.connections.length).toBe(3); // no new connection
  expect(hasConn(snap, "null1", "out0", "_output_", "out2")).toBe(false);
  expect(hasConn(snap, "null1", "out0", "_output_", "out0")).toBe(true); // original intact
});

test("Delete removes the selected node and its connections", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page);
  await fitGraph(page);

  // select null1 by clicking its body
  await page.locator(".cyl-rp-node", { hasText: "null1" }).first().click({ timeout: 10000 });
  await expect
    .poll(() => page.evaluate(() => {
      const g: any = (window as any).__cylGraph;
      const n = g.editor.getNodes().find((x: any) => x.label === "null1");
      return n ? (n as any).selected === true : false;
    }), { timeout: 5000 })
    .toBe(true);

  await page.keyboard.press("Delete");

  await expect
    .poll(async () => {
      const snap = await snapshot(page);
      return snap.nodes.some((n) => n.label === "null1") ? "pending" : "ok";
    }, { timeout: 10000 })
    .toBe("ok");

  const snap = await snapshot(page);
  expect(snap.nodes.some((n) => n.label === "null1")).toBe(false);
  expect(hasConn(snap, "_input_", "in0", "null1", "in0")).toBe(false);
  expect(hasConn(snap, "null1", "out0", "_output_", "out0")).toBe(false);
  expect(hasConn(snap, "_input_", "in1", "_output_", "out1")).toBe(true); // untouched edge survives
  expect(snap.connections.length).toBe(1);
});
