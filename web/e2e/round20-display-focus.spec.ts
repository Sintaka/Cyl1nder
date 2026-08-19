import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";
import { gotoMember } from "./fixtures";

/**
 * Round 20 (display-focus regression): a group rebuild inside viewport.refresh()
 * must NOT wipe the port-level display focus. Bug: dataflow.flush() runs
 * refreshNodeFlags() (which calls setDisplayFocus) BEFORE viewport.refresh(); when
 * refresh() rebuilds the input/output group (inputRev/outputRev bump), the rebuilt
 * port sub-groups default to visible=true and STAY visible (the pending flush is
 * already drained, so no later refreshNodeFlags re-applies the focus until the
 * next interaction). This is what the user sees as "拖动 transform gizmo 时输
 * 入/输出节点的四个口一起显示（有概率）" - a Houdini recook/input echo lands
 * during the drag, bumps inputRev, the rebuild wipes the focus.
 * - Test A (input group): display=transform wired to input0 -> all input ports
 *   hidden; pushing shifted inputs (same topology) bumps inputRev -> input group
 *   rebuilds; NO sampled frame may show input0..3.
 * - Test B (output group): display=_output_ (output0 visible only); pushing
 *   inputs where input0 gains a 5th point (topology change) rebuilds the output
 *   group; NO sampled frame may show output1..3.
 * - Test C (user's exact scenario): Enter-drag the transform while a shifted
 *   input push lands mid-drag; NO sampled frame may show input0..3.
 * Frame probe: a page.evaluate rAF loop samples per-port visibility EVERY frame
 * for ~240 frames into window.__focusProbe ({ frames, bad: boolean[][] }) started
 * BEFORE the trigger; bad rows are only the frames where a must-stay-hidden port
 * was visible, so `bad` must stay empty. Self-contained (round7/round19 helpers
 * copied, nothing imported from other spec files).
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

/** Same topology as canonical but input0 shifted +100 on x (bumps inputRev only). */
const SHIFTED_INPUTS = [
  { index: 0, name: "in0", pointCount: 4, primCount: 1, points: [[100,0,0],[101,0,0],[101,1,0],[100,1,0]], curves: [{ pointIndices: [0,1,2,3], widths: null }], faces: [[0,1,2,3]], attributes: {} },
  { index: 1, name: "in1", pointCount: 3, primCount: 1, points: [[0,0,0],[1,0,0],[0,1,0]], curves: [{ pointIndices: [0,1,2], widths: null }], faces: [], attributes: {} },
  { index: 2, name: "in2", pointCount: 5, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0.5,0.5,1]], curves: [{ pointIndices: [0,1,2,3,4], widths: null }], faces: [], attributes: {} },
  { index: 3, name: "in3", pointCount: 2, primCount: 1, points: [[0,0,0],[1,0,0]], curves: [{ pointIndices: [0,1], widths: null }], faces: [], attributes: {} },
];

/** Same topology change for the output group: input0 gains a 5th point. */
const TOPOLOGY_CHANGE_INPUTS = [
  { index: 0, name: "in0", pointCount: 5, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0.5,0.5,1]], curves: [{ pointIndices: [0,1,2,3,4], widths: null }], faces: [], attributes: {} },
  { index: 1, name: "in1", pointCount: 3, primCount: 1, points: [[0,0,0],[1,0,0],[0,1,0]], curves: [{ pointIndices: [0,1,2], widths: null }], faces: [], attributes: {} },
  { index: 2, name: "in2", pointCount: 5, primCount: 1, points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0.5,0.5,1]], curves: [{ pointIndices: [0,1,2,3,4], widths: null }], faces: [], attributes: {} },
  { index: 3, name: "in3", pointCount: 2, primCount: 1, points: [[0,0,0],[1,0,0]], curves: [{ pointIndices: [0,1], widths: null }], faces: [], attributes: {} },
];

const baseFlags = (display: boolean) => ({ display, bypass: false, freeze: false, reference: false });

/** input.in0 -> transform(tx=5, DISPLAYED) -> output.out0: display=transform hides
 *  all 4 input ports (the node-result group shows the translated geometry). */
const TF_DISPLAY_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: baseFlags(false), x: 60, y: 80 },
    { id: "tf", kind: "transform", label: "transform1", baseLabel: "transform", flags: baseFlags(true), params: [
      { name: "tx", type: "float", value: 5 }, { name: "ty", type: "float", value: 0 }, { name: "tz", type: "float", value: 0 },
      { name: "group", type: "string", value: "" }, { name: "class", type: "string", value: "autoguess" },
    ], x: 400, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: baseFlags(false), x: 560, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in0", target: "tf", targetInput: "in0" },
    { source: "tf", sourceOutput: "out0", target: "out", targetInput: "out0" },
  ],
};

/** input.in0 -> output.out0 with the OUTPUT node displayed: output0 visible only. */
const OUTPUT_DISPLAY_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: baseFlags(false), x: 60, y: 80 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: baseFlags(true), x: 400, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in0", target: "out", targetInput: "out0" },
  ],
};

/** Canonical 7-connection graph (same fixture as round5/round7) for afterAll restore. */
const CANONICAL_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "i", kind: "input", label: "_input_", baseLabel: "_input_", flags: baseFlags(true), x: 60, y: 80 },
    { id: "n1", kind: "null", label: "null1", baseLabel: "null", flags: baseFlags(false), x: 300, y: 40 },
    { id: "n2", kind: "null", label: "null2", baseLabel: "null", flags: baseFlags(false), x: 300, y: 200 },
    { id: "n3", kind: "null", label: "null3", baseLabel: "null", flags: baseFlags(false), x: 300, y: 360 },
    { id: "o", kind: "output", label: "_output_", baseLabel: "_output_", flags: baseFlags(false), x: 560, y: 80 },
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

/** Per-port visibility of the viewport output group (output0..output3). */
async function outputPortVisibility(page: import("@playwright/test").Page): Promise<boolean[]> {
  return page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const vis: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const g = v.scene.getObjectByName(`output${i}`);
      vis.push(!!g && g.visible);
    }
    return vis;
  });
}

/**
 * Start a per-frame visibility probe: a rAF loop samples the given ports
 * (prefix + hiddenPorts = the indices that must STAY hidden) EVERY animation
 * frame for ~`frames` frames. Only frames where a must-stay-hidden port is
 * visible are recorded into window.__focusProbe.bad (boolean[][] rows), so a
 * buggy frame (e.g. a rebuild that wipes the focus) is caught. Started BEFORE
 * the trigger, then awaitFocusProbe() collects the result.
 */
async function startFocusProbe(
  page: import("@playwright/test").Page,
  prefix: string,
  hiddenPorts: number[],
  frames = 240,
): Promise<void> {
  await page.evaluate(({ prefix, hiddenPorts, frames }) => {
    const v: any = (window as any).__cylViewport;
    (window as any).__focusProbe = null;
    const bad: boolean[][] = [];
    let n = 0;
    const sample = (): void => {
      const row: boolean[] = [];
      let anyVisible = false;
      for (const i of hiddenPorts) {
        const vis = !!v.scene.getObjectByName(`${prefix}${i}`)?.visible;
        row.push(vis);
        if (vis) anyVisible = true;
      }
      if (anyVisible) bad.push(row);
    };
    const loop = (): void => {
      n++;
      if (n > frames) {
        (window as any).__focusProbe = { frames, bad };
        return;
      }
      sample();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, { prefix, hiddenPorts, frames });
}

/** Await the probe loop completion and return { frames, bad }. */
async function awaitFocusProbe(page: import("@playwright/test").Page): Promise<{ frames: number; bad: boolean[][] }> {
  return page.evaluate(async () => {
    const t0 = Date.now();
    while (!(window as any).__focusProbe && Date.now() - t0 < 15000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return (window as any).__focusProbe as { frames: number; bad: boolean[][] };
  });
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

async function releaseGizmo(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    v.transform.dispatchEvent({ type: "dragging-changed", value: false });
  });
}

test("input group rebuild keeps display focus (transform display hides all input ports)", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page, TF_DISPLAY_GRAPH, 2);

  // transform displayed -> all 4 input ports hidden
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);

  // Start the per-frame probe BEFORE the trigger, then bump inputRev (same
  // topology, shifted positions) -> the input group rebuilds inside refresh().
  await startFocusProbe(page, "input", [0, 1, 2, 3]);
  await client.pushInputs(serial, SHIFTED_INPUTS as never, { nodePath: "/obj/test/Cyl1nder1", label: "Cyl1nder1" });
  const probe = await awaitFocusProbe(page);

  expect(probe.frames).toBeGreaterThan(100); // probe actually sampled
  expect(probe.bad).toEqual([]); // no frame may show any of input0..3
});

test("output group rebuild keeps display focus (output display shows out0 only)", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page, OUTPUT_DISPLAY_GRAPH, 1);

  // output displayed -> output0 visible, output1..3 hidden
  await expect.poll(() => outputPortVisibility(page), { timeout: 10000 }).toEqual([true, false, false, false]);

  // Start the probe BEFORE the trigger, then push a topology change (input0 gains
  // a 5th point) -> the output group rebuilds inside refresh().
  await startFocusProbe(page, "output", [1, 2, 3]);
  await client.pushInputs(serial, TOPOLOGY_CHANGE_INPUTS as never, { nodePath: "/obj/test/Cyl1nder1", label: "Cyl1nder1" });
  const probe = await awaitFocusProbe(page);

  expect(probe.frames).toBeGreaterThan(100);
  expect(probe.bad).toEqual([]); // no frame may show output1..3
});

test("Enter-drag + mid-drag input echo keeps input focus (user's exact scenario)", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page, TF_DISPLAY_GRAPH, 2);
  await expect.poll(() => inputPortVisibility(page), { timeout: 10000 }).toEqual([false, false, false, false]);

  // Enter mode + gizmo bound, exactly like the user dragging the transform.
  await enterTransformEdit(page);
  await startFocusProbe(page, "input", [0, 1, 2, 3]);

  // First drag frame, then land a shifted-input echo (Houdini recook echo) MID-drag.
  await dragGizmoTo(page, [0.5, 0, 0]);
  await client.pushInputs(serial, SHIFTED_INPUTS as never, { nodePath: "/obj/test/Cyl1nder1", label: "Cyl1nder1" });
  for (let i = 1; i <= 10; i++) {
    await dragGizmoTo(page, [0.5 + i * 0.25, 0, 0]);
    await page.waitForTimeout(25);
  }
  await releaseGizmo(page);
  const probe = await awaitFocusProbe(page);

  expect(probe.frames).toBeGreaterThan(100);
  expect(probe.bad).toEqual([]); // no frame may show any of input0..3
});
