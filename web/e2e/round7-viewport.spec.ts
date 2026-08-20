import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";
import { gotoMember, toggleSyncEnabled } from "./fixtures";

/**
 * Round 7 (viewport write-set): the viewport truly reads node GEO.
 * - Case 1: displaying a transform shows its CURRENT chain output (translated
 *   geometry, group "cyl-node-result"), not the untransformed source input;
 *   disconnecting hides the result; editing tx moves the result live.
 * - Case 2: displaying a null DOWNSTREAM of a transform shows the translated
 *   geometry; a null UPSTREAM of the transform still shows the source.
 * - Case 3: param panel edits are undoable (session-merged {type:"params"} undo);
 *   Ctrl+Z restores the params + bridge outputs, Ctrl+Y re-applies.
 * Self-contained: beforeAll pushes the canonical fixture; afterAll restores it.
 */
const client = new BridgeClient();
let serial = "";

/** Canonical 4-input fixture (input0 = the 4-pt square, input1 = 3-pt triangle). */
const CANONICAL_INPUTS = [
  { index: 0, name: "in0", pointCount: 4, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]], curves: [{ pointIndices: [0,1,2,3], widths: null }], faces: [[0,1,2,3]], attributes: {} },
  { index: 1, name: "in1", pointCount: 3, primCount: 1, points: [[0,0,0],[1,0,0],[0,1,0]], curves: [{ pointIndices: [0,1,2], widths: null }], faces: [], attributes: {} },
  { index: 2, name: "in2", pointCount: 5, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0.5,0.5,1]], curves: [{ pointIndices: [0,1,2,3,4], widths: null }], faces: [], attributes: {} },
  { index: 3, name: "in3", pointCount: 2, primCount: 1, points: [[0,0,0],[1,0,0]], curves: [{ pointIndices: [0,1], widths: null }], faces: [], attributes: {} },
];

/** Canonical 7-connection graph (same fixture as round5) for afterAll restore. */
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

/** transform params helper (px/py/pz defaults 0). */
function transformParams(over: Record<string, number | string> = {}): Array<{ name: string; type: string; value: number | string }> {
  return [
    { name: "tx", type: "float", value: over.tx ?? 0 },
    { name: "ty", type: "float", value: over.ty ?? 0 },
    { name: "tz", type: "float", value: over.tz ?? 0 },
    { name: "px", type: "float", value: over.px ?? 0 },
    { name: "py", type: "float", value: over.py ?? 0 },
    { name: "pz", type: "float", value: over.pz ?? 0 },
    { name: "group", type: "string", value: String(over.group ?? "") },
    { name: "class", type: "string", value: String(over.class ?? "autoguess") },
  ];
}

const baseFlags = (display: boolean) => ({ display, bypass: false, freeze: false, reference: false });

/** input.in0 -> transform(tx=5, DISPLAYED) -> output.out0. */
const TF_DISPLAY_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: baseFlags(false), x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: baseFlags(true), params: transformParams({ tx: 5 }), x: 400, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: baseFlags(false), x: 560, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in0", target: "tf", targetInput: "in0" },
    { source: "tf", sourceOutput: "out0", target: "out", targetInput: "out0" },
  ],
};

/** Same display graph but tx=0 (the param-undo test edits 0 -> 5 -> back). */
const TF_ZERO_DISPLAY_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: baseFlags(false), x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: baseFlags(true), params: transformParams({ tx: 0 }), x: 400, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: baseFlags(false), x: 560, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in0", target: "tf", targetInput: "in0" },
    { source: "tf", sourceOutput: "out0", target: "out", targetInput: "out0" },
  ],
};

/** Same graph but the input->transform connection is cut (display has no input). */
const TF_DISCONNECTED_GRAPH = {
  schemaVersion: 2,
  nodes: JSON.parse(JSON.stringify(TF_DISPLAY_GRAPH)).nodes as typeof TF_DISPLAY_GRAPH.nodes,
  connections: [{ source: "tf", sourceOutput: "out0", target: "out", targetInput: "out0" }],
};

/** input.in1 -> transform(tx=5) -> nullB (DISPLAYED) -> output.out0: nullB result = translated. */
const NULL_AFTER_TF_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: baseFlags(false), x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: baseFlags(false), params: transformParams({ tx: 5 }), x: 260, y: 80 },
    { id: "nb", kind: "null", label: "nullB", baseLabel: "null", flags: baseFlags(true), x: 400, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: baseFlags(false), x: 560, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in1", target: "tf", targetInput: "in0" },
    { source: "tf", sourceOutput: "out0", target: "nb", targetInput: "in0" },
    { source: "nb", sourceOutput: "out0", target: "out", targetInput: "out0" },
  ],
};

/** input.in1 -> nullA (DISPLAYED) -> transform(tx=5) -> output.out0: nullA result = source. */
const NULL_BEFORE_TF_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: baseFlags(false), x: 60, y: 80 },
    { id: "na", kind: "null", label: "nullA", baseLabel: "null", flags: baseFlags(true), x: 240, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: baseFlags(false), params: transformParams({ tx: 5 }), x: 400, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: baseFlags(false), x: 560, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in1", target: "na", targetInput: "in0" },
    { source: "na", sourceOutput: "out0", target: "tf", targetInput: "in0" },
    { source: "tf", sourceOutput: "out0", target: "out", targetInput: "out0" },
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

/** Curve-line positions inside the displayed node-result group (null = hidden/missing). */
async function nodeResultPoints(page: import("@playwright/test").Page): Promise<number[][] | null> {
  return page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const grp = v.scene.getObjectByName("cyl-node-result");
    if (!grp || !grp.visible) return null;
    const out: number[][] = [];
    grp.traverse((o: any) => {
      if (!o.isLine || o.isLineSegments) return; // curves only (exclude wire/points/mesh)
      const a = o.geometry?.getAttribute?.("position");
      if (!a) return;
      for (let i = 0; i < a.count; i++) out.push([a.getX(i), a.getY(i), a.getZ(i)]);
    });
    return out;
  });
}

/** Per-port visibility of the viewport input group (input0..input3) - the source
 *  geometry must stay hidden while a null/transform node result is displayed. */
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

/** Select a node by kind + click the Params tab (shows its editable params). */
async function selectNodeAndOpenParams(page: import("@playwright/test").Page, kind: string, label: RegExp): Promise<void> {
  await page.locator(".cyl-rp-title", { hasText: label }).first().click({ timeout: 15000 });
  await page.locator(".dv-tab", { hasText: "Params" }).first().click({ timeout: 15000 });
  await expect(page.locator(".cyl-param-table input[data-name=\"tx\"]")).toBeVisible({ timeout: 10000 });
}

test("display transform: viewport shows the translated chain output; disconnect hides; tx edit moves it live", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page, TF_DISPLAY_GRAPH, 2);

  // displayed transform -> node-result group with the SQUARE translated +5 on x,
  // and the source input ports stay hidden (no lingering origin geometry)
  await expect
    .poll(() => nodeResultPoints(page), { timeout: 10000 })
    .toEqual([[5, 0, 0], [6, 0, 0], [6, 1, 0], [5, 1, 0]]);
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);

  // disconnect the display's input -> result group hidden (no stale origin geometry)
  await restoreGraph(page, TF_DISCONNECTED_GRAPH, 1);
  await expect.poll(() => page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    return !!v.scene.getObjectByName("cyl-node-result");
  }), { timeout: 10000 }).toBe(false);

  // reconnect -> result back at +5, source ports still hidden
  await restoreGraph(page, TF_DISPLAY_GRAPH, 2);
  await expect
    .poll(() => nodeResultPoints(page), { timeout: 10000 })
    .toEqual([[5, 0, 0], [6, 0, 0], [6, 1, 0], [5, 1, 0]]);
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);

  // change tx via the params panel (real user path: setNodeParams + runNetwork) ->
  // the displayed geometry follows to +10
  await selectNodeAndOpenParams(page, "transform", /^transform\d+$/);
  await page.locator('.cyl-param-table input[data-name="tx"]').fill("10");
  await expect
    .poll(() => nodeResultPoints(page), { timeout: 10000 })
    .toEqual([[10, 0, 0], [11, 0, 0], [11, 1, 0], [10, 1, 0]]);
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);
});

test("display null downstream of transform shows translated geometry; upstream shows source", async ({ page }) => {
  await openGraph(page);

  // nullB sits AFTER the transform -> its result is the translated triangle,
  // and the source input ports stay hidden (no lingering origin geometry)
  await restoreGraph(page, NULL_AFTER_TF_GRAPH, 3);
  await expect
    .poll(() => nodeResultPoints(page), { timeout: 10000 })
    .toEqual([[5, 0, 0], [6, 0, 0], [5, 1, 0]]);
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);

  // nullA sits BEFORE the transform -> its result is the untouched source triangle
  await restoreGraph(page, NULL_BEFORE_TF_GRAPH, 3);
  await expect
    .poll(() => nodeResultPoints(page), { timeout: 10000 })
    .toEqual([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);
});

test("param undo: params panel tx edit -> Ctrl+Z restores value + bridge outputs, Ctrl+Y re-applies", async ({ page }) => {
  await openGraph(page);
  await toggleSyncEnabled(page, true); // v0.1.00101 起推桥需 sync ON
  await restoreGraph(page, TF_ZERO_DISPLAY_GRAPH, 2);

  // select transform + open Params; tx starts at 0
  await selectNodeAndOpenParams(page, "transform", /^transform\d+$/);
  const txInput = page.locator('.cyl-param-table input[data-name="tx"]');
  expect(await txInput.inputValue()).toBe("0");

  // edit tx=5 -> set + pushed to bridge; session undo lands after the 600ms debounce
  await txInput.fill("5");
  await expect.poll(() => page.evaluate(() => {
    const g: any = (window as any).__cylGraph;
    const n = g.editor.getNodes().find((x: any) => x.kind === "transform");
    return n.params.find((q: any) => q.name === "tx").value;
  }), { timeout: 10000 }).toBe(5);
  await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0] - 5) < 1e-6;
    },
    10000,
    "tx=5 bridge outputs",
  );
  await page.waitForTimeout(900); // let the 600ms debounce push the undo entry

  // Ctrl+Z -> params panel tx restores to 0, node result back at origin, bridge outputs restored
  await page.locator(".cyl-rp-title", { hasText: /^transform\d+$/ }).first().click({ timeout: 15000 });
  await page.keyboard.press("Control+z");
  await expect.poll(() => txInput.inputValue(), { timeout: 10000 }).toBe("0");
  await expect
    .poll(() => nodeResultPoints(page), { timeout: 10000 })
    .toEqual([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
  await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0]) < 1e-6;
    },
    10000,
    "tx=0 bridge outputs after undo",
  );

  // Ctrl+Y -> tx=5 re-applied everywhere
  await page.keyboard.press("Control+y");
  await expect.poll(() => txInput.inputValue(), { timeout: 10000 }).toBe("5");
  await poll(
    bridgeOutputs,
    (o) => {
      const out0 = o.find((x) => x.index === 0);
      return !!out0 && out0.points.length === 4 && Math.abs(out0.points[0][0] - 5) < 1e-6;
    },
    10000,
    "tx=5 bridge outputs after redo",
  );
  await expect
    .poll(() => nodeResultPoints(page), { timeout: 10000 })
    .toEqual([[5, 0, 0], [6, 0, 0], [6, 1, 0], [5, 1, 0]]);
});
