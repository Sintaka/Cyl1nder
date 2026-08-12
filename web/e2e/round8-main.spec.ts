import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";

/**
 * Round 8 (main write-set): Enter mode follows the FIRST SELECTED node (not the
 * display flag), File/Layout menus close after clicking an item, and the scene
 * File menu is reworked (Reload Scene rename, FSA-based Open/Save Scene As).
 * - Case 1: Enter with a transform -> gizmo bound to it; switching selection to
 *   another transform rebinds; selecting null/input/output keeps Enter active and
 *   the gizmo STAYS attached to the last transform (v0.1.00058: deselect no longer
 *   drops the gizmo); dragging the gizmo updates the bound node; Esc exits.
 * - Case 2: File menu has Reload Scene / Open Scene / Save Scene As / Overview;
 *   clicking any File/Layout item closes the drop.
 * - Case 3: Save Scene As uses showDirectoryPicker (mocked) to write the whole
 *   <serial>/ folder (io + scene + docking); a second save prompts overwrite.
 * - Case 4: Open Scene reads a serial-named folder via showDirectoryPicker
 *   (mocked) and navigates to ?serial=.
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

/** Canonical 7-connection graph for afterAll restore. */
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

/** transform params (px/py/pz defaults 0). */
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

/** Two chained transforms (tf1 tx=2, tf2 tx=5): Enter must follow whichever is
 *  first selected, and a drag must update THAT node only. */
const TWO_TF_GRAPH = {
  schemaVersion: 2,
  nodes: [
    { id: "in", kind: "input", label: "_input_", baseLabel: "_input_", flags: { display: true, bypass: false, freeze: false, reference: false }, x: 60, y: 80 },
    { id: "tf1", kind: "transform", label: "transform1", baseLabel: "transform", flags: { display: false, bypass: false, freeze: false, reference: false }, params: transformParams({ tx: 2 }), x: 300, y: 40 },
    { id: "tf2", kind: "transform", label: "transform2", baseLabel: "transform", flags: { display: false, bypass: false, freeze: false, reference: false }, params: transformParams({ tx: 5 }), x: 300, y: 200 },
    { id: "out", kind: "output", label: "_output_", baseLabel: "_output_", flags: { display: false, bypass: false, freeze: false, reference: false }, x: 560, y: 80 },
  ],
  connections: [
    { source: "in", sourceOutput: "in0", target: "tf1", targetInput: "in0" },
    { source: "tf1", sourceOutput: "out0", target: "tf2", targetInput: "in0" },
    { source: "tf2", sourceOutput: "out0", target: "out", targetInput: "out0" },
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

/** Inject an in-memory fake showDirectoryPicker + fake FS (Chromium's real picker
 *  needs a native dialog which is unavailable headless). */
async function installFakePicker(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const root: any = { kind: "dir", name: "picked", children: new Map() };
    const fileHandle = (node: any) => ({
      name: node.name,
      async createWritable() {
        let data = "";
        return {
          async write(d: unknown) { data = typeof d === "string" ? d : String(d); },
          async close() { node.content = data; },
        };
      },
      async getFile() { return { async text() { return node.content; } }; },
    });
    const dirHandle = (node: any): any => ({
      name: node.name,
      async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
        const child = node.children.get(name);
        if (child && child.kind === "dir") return dirHandle(child);
        if (opts?.create) {
          const d = { kind: "dir", name, children: new Map() };
          node.children.set(name, d);
          return dirHandle(d);
        }
        throw new DOMException("not found", "NotFoundError");
      },
      async getFileHandle(name: string, opts?: { create?: boolean }) {
        const child = node.children.get(name);
        if (child && child.kind === "file") return fileHandle(child);
        if (opts?.create) {
          const f = { kind: "file", name, content: "" };
          node.children.set(name, f);
          return fileHandle(f);
        }
        throw new DOMException("not found", "NotFoundError");
      },
    });
    (window as any).__cylFsTree = root;
    (window as any).__cylFsRead = (p: string) => {
      const parts = p.split("/");
      let node: any = root;
      for (const part of parts) {
        node = node.children.get(part);
        if (!node) return null;
      }
      return node.content ?? null;
    };
    (window as any).showDirectoryPicker = async () => dirHandle(root);
  });
}

/** Seed the fake FS with a pre-existing serial-named scene folder (Open Scene). */
async function seedOpenPicker(
  page: import("@playwright/test").Page,
  data: { serial: string; inputs: unknown[]; graph: unknown; docking: unknown },
): Promise<void> {
  await page.evaluate(({ serial, inputs, graph, docking }) => {
    const root: any = { kind: "dir", name: serial, children: new Map() };
    const fileHandle = (node: any) => ({
      name: node.name,
      async createWritable() {
        let d = "";
        return {
          async write(v: unknown) { d = typeof v === "string" ? v : String(v); },
          async close() { node.content = d; },
        };
      },
      async getFile() { return { async text() { return node.content; } }; },
    });
    const dirHandle = (node: any): any => ({
      name: node.name,
      async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
        const child = node.children.get(name);
        if (child && child.kind === "dir") return dirHandle(child);
        if (opts?.create) {
          const d = { kind: "dir", name, children: new Map() };
          node.children.set(name, d);
          return dirHandle(d);
        }
        throw new DOMException("not found", "NotFoundError");
      },
      async getFileHandle(name: string, opts?: { create?: boolean }) {
        const child = node.children.get(name);
        if (child && child.kind === "file") return fileHandle(child);
        if (opts?.create) {
          const f = { kind: "file", name, content: "" };
          node.children.set(name, f);
          return fileHandle(f);
        }
        throw new DOMException("not found", "NotFoundError");
      },
    });
    const seed = (relPath: string, data: unknown): void => {
      const parts = relPath.split("/");
      let node: any = root;
      for (let i = 0; i < parts.length; i++) {
        const last = i === parts.length - 1;
        let child = node.children.get(parts[i]);
        if (!child) {
          child = last ? { kind: "file", name: parts[i], content: "" } : { kind: "dir", name: parts[i], children: new Map() };
          node.children.set(parts[i], child);
        }
        node = child;
      }
      node.content = JSON.stringify(data);
    };
    seed("io/inputs.json", inputs);
    seed("scene/node-graph.json", graph);
    seed("docking-layout.json", docking);
    (window as any).showDirectoryPicker = async () => dirHandle(root);
  }, data);
}

test("Enter mode follows the first selected node: rebinds to new transform, idle on non-transform, Esc exits", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page, TWO_TF_GRAPH, 3);

  const gizmoState = () =>
    page.evaluate(() => {
      const v: any = (window as any).__cylViewport;
      const o = v.scene.getObjectByName("cyl-enter-gizmo");
      return { active: v.isEnterActive(), x: o ? o.position.x : null };
    });

  // select transform1 (tx=2) + Enter -> gizmo at (2,0,0)
  await page.locator(".cyl-rp-title", { hasText: /^transform1$/ }).first().click({ timeout: 15000 });
  await page.locator(".cyl-viewport-toolbar .cyl-tool-btn").first().click();
  await expect.poll(gizmoState, { timeout: 10000 }).toEqual({ active: true, x: 2 });

  // select transform2 (tx=5) -> gizmo REBINDS to it
  await page.locator(".cyl-rp-title", { hasText: /^transform2$/ }).first().click({ timeout: 15000 });
  await expect.poll(gizmoState, { timeout: 10000 }).toEqual({ active: true, x: 5 });

  // simulate a drag -> updates transform2 (NOT transform1)
  await page.evaluate(() => {
    const v: any = (window as any).__cylViewport;
    const obj = v.scene.getObjectByName("cyl-enter-gizmo");
    if (!obj) throw new Error("enter gizmo object missing");
    obj.position.set(7, -1, 0.5);
    v.transform.dispatchEvent({ type: "objectChange" });
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const g: any = (window as any).__cylGraph;
          const nodes = g.editor.getNodes();
          const read = (label: string) => {
            const n = nodes.find((x: any) => x.label === label);
            if (!n) return { tx: null, ty: null, tz: null };
            const p: Record<string, unknown> = {};
            for (const q of n.params) p[q.name] = q.value;
            return { tx: p.tx, ty: p.ty, tz: p.tz };
          };
          return { tf1: read("transform1"), tf2: read("transform2") };
        }),
      { timeout: 10000 },
    )
    .toEqual({ tf1: { tx: 2, ty: 0, tz: 0 }, tf2: { tx: 7, ty: -1, tz: 0.5 } });

  // select _input_ (no Enter target) -> mode STAYS active, gizmo STAYS on the
  // LAST transform (transform2, x=7) - deselect no longer drops it (v0.1.00058)
  await page.locator(".cyl-rp-title", { hasText: "_input_" }).first().click({ timeout: 15000 });
  await expect.poll(gizmoState, { timeout: 10000 }).toEqual({ active: true, x: 7 });

  // re-select transform2 -> gizmo reappears at its CURRENT tx (7 after the drag)
  await page.locator(".cyl-rp-title", { hasText: /^transform2$/ }).first().click({ timeout: 15000 });
  await expect.poll(gizmoState, { timeout: 10000 }).toEqual({ active: true, x: 7 });

  // Esc exits the mode
  await page.keyboard.press("Escape");
  await expect.poll(gizmoState, { timeout: 10000 }).toEqual({ active: false, x: null });
});

test("File/Layout menus close after clicking an item; File menu has Reload Scene/Open Scene/Overview", async ({ page }) => {
  await openGraph(page);
  const fileMenu = page.locator(".cyl-menu[data-menu='file']");
  const fileDrop = page.locator("#cyl-menu-file");
  const layoutMenu = page.locator(".cyl-menu[data-menu='layout']");
  const layoutDrop = page.locator("#cyl-menu-layout");

  // File menu items exist (Reload Scene renamed, Open Scene + Overview added)
  await fileMenu.locator(".cyl-menu-label").click();
  await expect(fileDrop).toHaveClass(/open/);
  await expect(fileDrop.locator("button", { hasText: "Reload Scene" })).toBeVisible();
  await expect(fileDrop.locator("button", { hasText: "Open Scene" })).toBeVisible();
  await expect(fileDrop.locator("button", { hasText: "Save Scene As" })).toBeVisible();
  await expect(fileDrop.locator("button", { hasText: "Overview" })).toBeVisible();
  // clicking a File item closes the drop
  await fileDrop.locator("button", { hasText: "Reload Scene" }).click();
  await expect(fileDrop).not.toHaveClass(/open/);

  // Layout menu: opening + clicking an item closes the drop too
  await layoutMenu.locator(".cyl-menu-label").click();
  await expect(layoutDrop).toHaveClass(/open/);
  await layoutDrop.locator("button", { hasText: /^Save current layout$/ }).click();
  await expect(layoutDrop).not.toHaveClass(/open/);
});

test("Save Scene As writes the whole <serial>/ folder via showDirectoryPicker; second save prompts overwrite", async ({ page }) => {
  await openGraph(page);
  await restoreGraph(page, TWO_TF_GRAPH, 3);
  await installFakePicker(page);

  // File > Save Scene As… (FSA path - no prompt dialogs on first save)
  await page.locator(".cyl-menu[data-menu='file'] .cyl-menu-label").click();
  await page.locator("#cyl-menu-file button", { hasText: "Save Scene As" }).click();

  // io/inputs.json written (canonical 4 inputs)
  await expect
    .poll(() => page.evaluate((s) => (window as any).__cylFsRead(`${s}/io/inputs.json`), serial), { timeout: 10000 })
    .not.toBeNull();
  const inputsJson = await page.evaluate((s) => JSON.parse((window as any).__cylFsRead(`${s}/io/inputs.json`)), serial);
  expect(Array.isArray(inputsJson)).toBe(true);
  expect((inputsJson as unknown[]).length).toBe(4);

  // scene/node-graph.json = the restored 4-node graph
  await expect
    .poll(() => page.evaluate((s) => {
      const raw = (window as any).__cylFsRead(`${s}/scene/node-graph.json`);
      return raw ? (JSON.parse(raw) as any).nodes?.length : 0;
    }, serial), { timeout: 10000 })
    .toBe(4);

  // scene/node-parm.json present (transforms carry params) + docking-layout.json
  expect(
    await page.evaluate((s) => (window as any).__cylFsRead(`${s}/scene/node-parm.json`) !== null, serial),
  ).toBe(true);
  expect(
    await page.evaluate((s) => (window as any).__cylFsRead(`${s}/docking-layout.json`) !== null, serial),
  ).toBe(true);

  // second save: the <serial> folder now exists -> overwrite confirm appears
  const dialogs: Array<{ type: string; message: string }> = [];
  page.on("dialog", (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    void d.accept();
  });
  await page.locator(".cyl-menu[data-menu='file'] .cyl-menu-label").click();
  await page.locator("#cyl-menu-file button", { hasText: "Save Scene As" }).click();
  await expect.poll(() => dialogs.length, { timeout: 10000 }).toBe(1);
  expect(dialogs[0].type).toBe("confirm");
  expect(dialogs[0].message).toContain("同名文件夹已存在");
});

test("Open Scene reads a serial-named folder via showDirectoryPicker and navigates to ?serial=", async ({ page }) => {
  await openGraph(page);
  await seedOpenPicker(page, { serial, inputs: CANONICAL_INPUTS, graph: TWO_TF_GRAPH, docking: {} });

  await page.locator(".cyl-menu[data-menu='file'] .cyl-menu-label").click();
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get("serial") === serial),
    page.locator("#cyl-menu-file button", { hasText: "Open Scene" }).click(),
  ]);
});
