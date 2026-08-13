import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";

/**
 * Round 17 (local-freshness write-set): Enter-gizmo drags apply OPTIMISTICALLY on
 * the web - the local store + viewport refresh at the full local rate, independent
 * of the bridge's Sync Max FPS forward path (the web never waits for the bridge
 * echo to show a drag; the echo only aligns revs). Stale push responses from fast
 * drag bursts are discarded via a monotonic network epoch (no backlog: only the
 * final frame of a burst logs "network ran").
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

/** Minimal input -> transform -> output graph (empty group = translate all points).
 * The TRANSFORM node is the display node so the viewport's node-result group shows
 * the translated geometry (that is what the local optimistic apply must refresh). */
const TRANSFORM_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: true, bypass: false, freeze: false, reference: false }, params: [
      { name: "tx", type: "float", value: 0 }, { name: "ty", type: "float", value: 0 }, { name: "tz", type: "float", value: 0 },
      { name: "group", type: "string", value: "" }, { name: "class", type: "string", value: "autoguess" },
    ], x: 400, y: 80 },
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
  await setSyncFps(30); // clean baseline (default rate cap)
});

test.afterAll(async () => {
  if (!serial) return;
  try {
    await setSyncFps(30);
    await client.pushInputs(serial, CANONICAL_INPUTS as never, { nodePath: "/obj/test/Cyl1nder1", label: "Cyl1nder1" });
  } catch {
    /* fixture restore best-effort */
  }
});

/** PUT the per-serial Sync Max FPS on the bridge (forward/broadcast path). */
async function setSyncFps(fps: number): Promise<void> {
  const res = await fetch(`http://127.0.0.1:8375/api/hda/${serial}/sync`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fps }),
  });
  expect(res.ok).toBe(true);
}

async function openGraph(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(`http://127.0.0.1:8376/?serial=${serial}`);
  await expect(page.locator(".cyl-graph .cyl-rp-title").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".cyl-status")).toHaveClass(/ok/, { timeout: 15000 });
}

/** Restore the input -> transform -> output graph in-browser. */
async function restoreTransformGraph(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async (g) => {
    const graph: any = (window as any).__cylGraph;
    await graph.restoreGraph(JSON.parse(JSON.stringify(g)));
  }, TRANSFORM_GRAPH);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cylGraph.editor.getConnections().length), { timeout: 15000 })
    .toBe(2);
}

/** Enter-edit the transform node via the left toolbar (gizmo bound at its params). */
async function enterTransformEdit(page: import("@playwright/test").Page): Promise<void> {
  await page.locator(".cyl-rp-title", { hasText: /^transform\d+$/ }).first().click({ timeout: 15000 });
  await page.locator(".cyl-viewport-toolbar .cyl-tool-btn").first().click();
  expect(await page.evaluate(() => (window as any).__cylViewport.isEnterActive())).toBe(true);
  const gizmo = await page.evaluate(() => (window as any).__cylViewport.scene.getObjectByName("cyl-enter-gizmo"));
  expect(gizmo).not.toBeNull();
}

/** Simulate gizmo drag frames (the same events TransformControls emits). */
async function dragGizmoTo(page: import("@playwright/test").Page, pos: [number, number, number]): Promise<void> {
  await page.evaluate(([x, y, z]) => {
    const v: any = (window as any).__cylViewport;
    const obj = v.scene.getObjectByName("cyl-enter-gizmo");
    if (!obj) throw new Error("enter gizmo object missing");
    obj.position.set(x, y, z);
    v.transform.dispatchEvent({ type: "objectChange" });
  }, pos);
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

/** First point of the displayed node-result geometry (or null when not built). */
async function nodeResultFirstPoint(page: import("@playwright/test").Page): Promise<number[] | null> {
  return page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const root = v.nodeResultGroup.getObjectByName("cyl-node-result");
    if (!root) return null;
    const line = root.children.find((c: any) => c.isLine);
    if (!line || !line.geometry || !line.geometry.attributes.position) return null;
    const arr = line.geometry.attributes.position.array;
    return [arr[0], arr[1], arr[2]];
  });
}

test("local viewport refreshes without waiting for bridge fps", async ({ page }) => {
  await openGraph(page);
  await restoreTransformGraph(page);
  // Cap the bridge forward/broadcast path at 1 fps: any update that waited for
  // the WS echo would take up to 1s; the local optimistic apply must not.
  await setSyncFps(1);
  try {
    await enterTransformEdit(page);
    await dragGizmoTo(page, [3, -2, 0.5]);

    // The local store reflects the drag on the NEXT animation frame (the pre-render
    // pump runs network + store view before render) - no bridge echo at all (let
    // alone the 1 fps one). This is the core regression proof.
    await expect
      .poll(
        () => page.evaluate(() => {
          const store: any = (window as any).__cylStore;
          const out0 = store.outputs.find((o: any) => o.index === 0);
          return out0 ? out0.points[0] : null;
        }),
        { timeout: 3000 },
      )
      .toEqual([3, -2, 0.5]);

    // The viewport node-result geometry follows within a frame or two (rAF).
    await expect.poll(() => nodeResultFirstPoint(page), { timeout: 3000 }).toEqual([3, -2, 0.5]);

    // The bridge eventually catches up too (stored workspace, not the 1 fps echo).
    await poll(
      bridgeOutputs,
      (o) => {
        const out0 = o.find((x) => x.index === 0);
        return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0] - 3) < 1e-6;
      },
      10000,
      "bridge outputs caught up",
    );
  } finally {
    await setSyncFps(30);
  }
});

test("geometry and gizmo land on the same frame (flush runs before render)", async ({ page }) => {
  await openGraph(page);
  await restoreTransformGraph(page);
  await enterTransformEdit(page);

  // The display node is the transform, so the node-result group must already be
  // built before we wrap render (otherwise the first recorded render could be a
  // stale pre-dispatch frame).
  await expect.poll(() => nodeResultFirstPoint(page), { timeout: 5000 }).not.toBeNull();

  // Wrap renderer.render to snapshot the node-result first point ACTUALLY drawn
  // each frame, then dispatch ONE objectChange synchronously in the same evaluate
  // so renders[0] is guaranteed to come from the next animation frame.
  await page.evaluate(([x, y, z]) => {
    const v: any = (window as any).__cylViewport;
    const renders: (number[] | null)[] = [];
    const orig = v.renderer.render.bind(v.renderer);
    v.renderer.render = (s: any, c: any) => {
      const root = v.nodeResultGroup.getObjectByName("cyl-node-result");
      let pt: number[] | null = null;
      if (root) {
        const line = root.children.find((cc: any) => cc.isLine);
        if (line && line.geometry && line.geometry.attributes.position) {
          const arr = line.geometry.attributes.position.array;
          pt = [arr[0], arr[1], arr[2]];
        }
      }
      renders.push(pt);
      return orig(s, c);
    };
    (window as any).__cylRenders = renders;
    const obj = v.scene.getObjectByName("cyl-enter-gizmo");
    if (!obj) throw new Error("enter gizmo object missing");
    obj.position.set(x, y, z);
    v.transform.dispatchEvent({ type: "objectChange" });
  }, [3, -2, 0.5]);

  // Wait exactly one animation frame: the viewport pump runs flush (network +
  // store view -> refresh) BEFORE renderer.render() inside that same frame, so the
  // very first render after the dispatch already draws the new geometry.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

  const renders = await page.evaluate(() => (window as any).__cylRenders as (number[] | null)[]);
  expect(renders.length).toBeGreaterThan(0);
  expect(renders[0]).toEqual([3, -2, 0.5]);
});

test("stale runs are discarded (no backlog)", async ({ page }) => {
  await openGraph(page);
  await restoreTransformGraph(page);
  await setSyncFps(30); // deterministic: default broadcast rate
  await enterTransformEdit(page);

  // Snapshot log counts before the burst.
  const before = await page.evaluate(() => {
    const store: any = (window as any).__cylStore;
    return {
      networkRan: store.logs.filter((m: string) => m.includes("network ran")).length,
      failed: store.logs.filter((m: string) => m.includes("network run failed")).length,
    };
  });

  // Fast drag burst: ~30 objectChange events in one synchronous turn, increasing
  // tx 0.1..3.0, without awaiting the network between frames.
  await page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const obj = v.scene.getObjectByName("cyl-enter-gizmo");
    if (!obj) throw new Error("enter gizmo object missing");
    for (let i = 1; i <= 30; i++) {
      obj.position.set(0.1 * i, 0, 0);
      v.transform.dispatchEvent({ type: "objectChange" });
    }
  });

  // Local state reflects the LAST dispatched value on the next frame (latest-wins
  // pump: only the final frame of the burst lands in the store).
  await expect
    .poll(
      () => page.evaluate(() => {
        const store: any = (window as any).__cylStore;
        const out0 = store.outputs.find((o: any) => o.index === 0);
        return out0 ? out0.points[0] : null;
      }),
      { timeout: 3000 },
    )
    .toEqual([3, 0, 0]); // 0.1 * 30 (gizmo rounds to 4dp)

  // Let every in-flight push resolve, then verify stale frames were discarded.
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const store: any = (window as any).__cylStore;
    return {
      networkRan: store.logs.filter((m: string) => m.includes("network ran")).length,
      failed: store.logs.filter((m: string) => m.includes("network run failed")).length,
    };
  });
  // Only the latest epoch of the burst logs - intermediate stale frames are
  // discarded entirely (well under 10 "network ran" lines for a 30-frame burst).
  expect(after.networkRan - before.networkRan).toBeLessThan(10);
  expect(after.failed - before.failed).toBe(0); // no error logs

  // Final applied tx = the LAST dispatched value (never an intermediate frame).
  await expect
    .poll(() => page.evaluate(() => {
      const store: any = (window as any).__cylStore;
      const out0 = store.outputs.find((o: any) => o.index === 0);
      return out0 ? out0.points[0][0] : null;
    }), { timeout: 5000 })
    .toBe(3);
});
