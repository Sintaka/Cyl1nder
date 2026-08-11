import "./styles.css";
import { buildLayout } from "./app/layout";
import { DEFAULT_LAYOUT, DEFAULT_LAYOUT_NAME } from "./app/layouts";
import { applyLayout, setupDock } from "./app/dock";
import { renderSpreadsheet, type SpreadsheetFocus } from "./app/spreadsheet";
import { renderParams } from "./app/param";
import { store } from "./stores/workspace";
import { BridgeClient, connectWs } from "./bridge/client";
import { createReteGraph, type ReteGraphHandlers } from "./nodes2/graph";
import { computeNodeResult, computeOutputs } from "./nodes2/network";
import { Viewport, type ReferenceItem } from "./viewport/renderer";
import { APP_VERSION } from "./app/app-config";
import { inputsEqual } from "./protocol/compare";
import type { InputPayload, OutputBuffer } from "./protocol/types";

/** Log categories: geo data / viewport / ui / bridge(python runtime). */
let logFilter = "all";
const logCategories: [string, string][] = [
  ["all", "All"],
  ["geo", "Geo"],
  ["viewport", "Viewport"],
  ["param", "Parameter"],
  ["ui", "UI"],
  ["bridge", "Bridge"],
];
const categorize = (m: string): string => {
  if (/\[param\]/.test(m)) return "param"; // param edits + their undo/redo (before ui/geo)
  if (/\[viewport\]/.test(m)) return "viewport";
  if (/inputs rev=|outputs|\[mesh\]|\[path\]|pushed|rev=/i.test(m)) return "geo";
  if (/\[layout\]|\[node\]|\[file\]|display|visibility/i.test(m)) return "ui";
  if (/\[bridge\]|python|runtime/i.test(m)) return "bridge";
  return "ui";
};
const matchLogFilter = (m: string) => logFilter === "all" || categorize(m) === logFilter;
const renderLog = () => {
  const body = layout.logEl.querySelector(".cyl-log-body");
  if (body) body.textContent = store.logs.filter(matchLogFilter).slice(-40).join("\n");
};

const layout = buildLayout(document.getElementById("app")!);
const client = new BridgeClient();
// log filter bar (inserted above the log content inside the dock panel)
const logFilterBar = document.createElement("div");
logFilterBar.className = "cyl-log-filter";
logFilterBar.innerHTML = logCategories
  .map(([k, label]) => `<button data-filter="${k}" class="${k === "all" ? "active" : ""}">${label}</button>`)
  .join("");
logFilterBar.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest?.("button");
  if (!btn) return;
  logFilter = (btn as HTMLElement).dataset.filter ?? "all";
  logFilterBar.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
  renderLog();
});
layout.logEl.classList.add("cyl-log-panel");
layout.logEl.innerHTML = "";
const logBody = document.createElement("pre");
logBody.className = "cyl-log-body";
layout.logEl.appendChild(logFilterBar);
layout.logEl.appendChild(logBody);
const spreadsheetEl = document.createElement("div");
spreadsheetEl.id = "cyl-spreadsheet";
spreadsheetEl.className = "cyl-spreadsheet";
const paramEl = document.createElement("div");
paramEl.id = "cyl-param";
paramEl.className = "cyl-param";
(window as unknown as Record<string, unknown>).__cylDv = null; // debug hook (MCP debug access)
const dv = setupDock(layout.dockContainer, {
  graph: layout.graphContainer,
  viewport: layout.viewportContainer,
  inspector: layout.inspectorEl,
  log: layout.logEl,
  spreadsheet: spreadsheetEl,
  param: paramEl,
});
(window as unknown as Record<string, unknown>).__cylDv = dv;
// dockview lazily mounts inactive tab content: the Log panel's .cyl-log element is NOT in
// the DOM until its tab is activated. Re-render accumulated logs when it comes on screen.
(dv as unknown as { api?: { onDidActiveChange?: (fn: (e: { panel: { id: string } }) => void) => unknown } }).api
  ?.onDidActiveChange?.((e) => {
    if (e.panel.id === "log") renderLog();
  });

// ---------------- menu bar (File / Layout) ----------------
layout.root.querySelectorAll(".cyl-menu").forEach((menu) => {
  const label = menu.querySelector(".cyl-menu-label") as HTMLElement;
  const drop = menu.querySelector(".cyl-menu-drop") as HTMLElement;
  const toggle = (open?: boolean) => {
    drop.classList.toggle("open", open ?? !drop.classList.contains("open"));
  };
  label.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    toggle();
  });
  // close other menus when one opens
  document.addEventListener("pointerdown", (ev) => {
    if (!drop.contains(ev.target as Node)) toggle(false);
  }, { capture: true });
  // clicking any menu ITEM closes this menu's drop (File / Layout)
  drop.addEventListener("click", () => toggle(false));
});

// File menu markup lives in app/layout.ts: rename the old "Open Scene…" (reload)
// and add the real folder->serial "Open Scene…" + Overview entries here.
{
  const file = layout.menuFile;
  const reloadBtn = file.querySelector<HTMLButtonElement>('button[data-act="open"]');
  if (reloadBtn) reloadBtn.textContent = "Reload Scene";
  const openSceneBtn = document.createElement("button");
  openSceneBtn.type = "button";
  openSceneBtn.dataset.act = "open-scene";
  openSceneBtn.textContent = "Open Scene…";
  file.insertBefore(openSceneBtn, reloadBtn ?? file.firstElementChild);
  const overviewBtn = document.createElement("button");
  overviewBtn.type = "button";
  overviewBtn.dataset.act = "overview";
  overviewBtn.textContent = "Overview";
  file.appendChild(overviewBtn);
}

let currentLayoutName = DEFAULT_LAYOUT_NAME;
const getDockJson = () => ({
  ...(dv as unknown as { toJSON(): Record<string, unknown> }).toJSON(),
  displaySettings: viewport.getDisplaySettings(),
});
const saveCurrentLayout = (name: string) => {
  void client.saveLayout(name, getDockJson()).then((r) => {
    if (r.ok) {
      currentLayoutName = name;
      store.pushLog(`[layout] saved "${name}"`);
    }
  });
};
const refreshLayoutPresets = () => {
  void client.listLayouts().then((names) => {
    layout.layoutPresets.innerHTML = names.length
      ? names.map((n) => `<button class="cyl-layout-preset" data-name="${n}">${n}</button>`).join("")
      : `<div class="cyl-menu-empty">no saved layouts</div>`;
    layout.layoutPresets.querySelectorAll(".cyl-layout-preset").forEach((b) => {
      b.addEventListener("click", () => {
        const name = (b as HTMLElement).dataset.name ?? "";
        void client.loadLayout(name).then((r) => {
          if (r.layout) {
            applyLayout(dv, r.layout, {
              graph: layout.graphContainer,
              viewport: layout.viewportContainer,
              inspector: layout.inspectorEl,
              log: layout.logEl,
              spreadsheet: spreadsheetEl,
              param: paramEl,
            });
            applyLayoutSettings(r.layout);
            currentLayoutName = name;
            store.pushLog(`[layout] loaded "${name}"`);
          }
        });
      });
    });
  });
};
void refreshLayoutPresets();

layout.menuFile.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    const act = (b as HTMLElement).dataset.act;
    if (act === "save") {
      if (!store.serial) return;
      void client.putSnapshot(store.serial, { graph: graph.serializeGraph(), docking: getDockJson() });
      store.pushLog("[file] scene saved");
    } else if (act === "open") {
      // Reload Scene: re-read the current serial's disk snapshot.
      if (!store.serial) return;
      void loadSnapshotIntoStore(store.serial);
    } else if (act === "open-scene") {
      void openSceneFromDir();
    } else if (act === "saveas") {
      if (!store.serial) return;
      void saveSceneAs();
    } else if (act === "overview") {
      window.open("/overview.html");
    }
  });
});
layout.menuLayout.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    const act = (b as HTMLElement).dataset.act;
    if (act === "save-layout") saveCurrentLayout(currentLayoutName);
    else if (act === "save-layout-as") {
      const name = window.prompt("Layout name (same name overwrites):", currentLayoutName);
      if (name) saveCurrentLayout(name.trim());
    } else if (act === "reload-layout") {
      // re-apply the saved layout, else fall back to the bundled Default.json
      void client.loadLayout(currentLayoutName).then((r) => {
        const json = r.layout ?? DEFAULT_LAYOUT;
        applyLayout(dv, json, {
          graph: layout.graphContainer,
          viewport: layout.viewportContainer,
          inspector: layout.inspectorEl,
          log: layout.logEl,
          spreadsheet: spreadsheetEl,
          param: paramEl,
        });
        applyLayoutSettings(json);
        store.pushLog(`[layout] reloaded "${currentLayoutName}"${r.layout ? "" : " (bundled default)"}`);
      });
    }
  });
});

// ---- File System Access API scene save/open (Chromium) with prompt fallback ----
// showDirectoryPicker is Chromium-only and not in the TS DOM lib yet.
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }
}

/** Write a JSON file into a directory handle (creates parent subdirs). */
async function writeJsonToDir(dir: FileSystemDirectoryHandle, relPath: string, data: unknown): Promise<void> {
  const parts = relPath.split("/");
  let cur = dir;
  for (const part of parts.slice(0, -1)) cur = await cur.getDirectoryHandle(part, { create: true });
  const fh = await cur.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(data, null, 2));
  await w.close();
}

/** Read a JSON file from a directory handle (null when missing/unreadable). */
async function readJsonFromDir(dir: FileSystemDirectoryHandle, relPath: string): Promise<unknown | null> {
  try {
    const parts = relPath.split("/");
    let cur = dir;
    for (const part of parts.slice(0, -1)) cur = await cur.getDirectoryHandle(part);
    const fh = await cur.getFileHandle(parts[parts.length - 1]);
    return JSON.parse(await (await fh.getFile()).text());
  } catch {
    return null;
  }
}

/** Save Scene As: File System Access first (write <serial>/ under the picked dir,
 *  overwrite confirm when the serial folder exists), falls back to the bridge path. */
async function saveSceneAs(): Promise<void> {
  const serial = store.serial;
  if (!serial) return;
  try {
    await client.putSnapshot(serial, { graph: graph.serializeGraph(), docking: getDockJson() });
  } catch (e) {
    store.pushLog(`[file] scene snapshot failed: ${String(e)}`);
  }
  const picker = window.showDirectoryPicker;
  if (picker) {
    try {
      const dir = await picker({ mode: "readwrite" });
      let exists = false;
      try {
        await dir.getDirectoryHandle(serial);
        exists = true;
      } catch {
        /* not present yet */
      }
      if (exists && !window.confirm("同名文件夹已存在，覆盖？")) return;
      const nodes = (graph.serializeGraph() as { nodes?: Array<{ id: string; params?: unknown[] }> }).nodes ?? [];
      const parm: Record<string, unknown[]> = {};
      for (const n of nodes) if (n.params?.length) parm[n.id] = n.params;
      await writeJsonToDir(dir, `${serial}/io/inputs.json`, store.inputs);
      await writeJsonToDir(dir, `${serial}/io/outputs.json`, store.outputs);
      await writeJsonToDir(dir, `${serial}/scene/node-graph.json`, graph.serializeGraph());
      if (Object.keys(parm).length) await writeJsonToDir(dir, `${serial}/scene/node-parm.json`, parm);
      await writeJsonToDir(dir, `${serial}/docking-layout.json`, getDockJson());
      store.pushLog(`[file] scene saved to ${dir.name}/${serial}`);
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // user cancelled
      store.pushLog(`[file] folder save failed (${String(e)}) - falling back to server path`);
    }
  }
  // Fallback: bridge server path (prompt for a target dir).
  const targetDir = window.prompt("输入保存目标目录");
  if (!targetDir) return;
  const dir = targetDir.trim();
  try {
    let r = await client.saveSceneFolder(serial, dir);
    if (!r.ok && r.exists) {
      if (window.confirm("同名文件夹已存在，覆盖？")) r = await client.saveSceneFolder(serial, dir, true);
    }
    if (r.ok) store.pushLog(`[file] scene saved to ${r.path ?? dir}`);
    else store.pushLog(`[file] scene save failed: ${r.error ?? "unknown"}`);
  } catch (e) {
    store.pushLog(`[file] scene save error: ${String(e)}`);
  }
}

/** Open Scene: File System Access first (pick a serial-named folder, read io +
 *  graph + docking, push to the bridge), falls back to the bridge server path. */
async function openSceneFromDir(): Promise<void> {
  const picker = window.showDirectoryPicker;
  if (picker) {
    try {
      const dir = await picker({ mode: "read" });
      const serial = dir.name;
      if (!/^C1-[0-9a-z]{8,}-[0-9a-z]{4}$/.test(serial)) {
        store.pushLog(`[file] open scene failed: folder name is not a serial: ${serial}`);
        return;
      }
      const [inputs, graphJson, docking] = await Promise.all([
        readJsonFromDir(dir, "io/inputs.json"),
        readJsonFromDir(dir, "scene/node-graph.json"),
        readJsonFromDir(dir, "docking-layout.json"),
      ]);
      if (Array.isArray(inputs) && inputs.length > 0) {
        await client
          .pushInputs(serial, inputs as InputPayload[])
          .catch((e) => store.pushLog(`[file] push inputs failed: ${String(e)}`));
      }
      await client
        .putSnapshot(serial, {
          graph: graphJson && typeof graphJson === "object" ? graphJson : undefined,
          docking: docking && typeof docking === "object" ? docking : undefined,
        })
        .catch((e) => store.pushLog(`[file] push snapshot failed: ${String(e)}`));
      location.href = `?serial=${encodeURIComponent(serial)}`;
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // user cancelled
      store.pushLog(`[file] folder open failed (${String(e)}) - falling back to server path`);
    }
  }
  // Fallback: bridge server path (prompt for a folder path).
  const folderPath = window.prompt("输入场景文件夹路径（文件夹名=序列号，如 D:/scenes/C1-xxxxxxxx-xxxx）");
  if (!folderPath) return;
  void client
    .openSceneFolder(folderPath.trim())
    .then((r) => {
      if (r.ok && r.serial) location.href = `?serial=${encodeURIComponent(r.serial)}`;
      else store.pushLog(`[file] open scene failed: ${r.error ?? "no serial returned"}`);
    })
    .catch((e) => store.pushLog(`[file] open scene error: ${String(e)}`));
}

const handlers: ReteGraphHandlers = {
  onNodePick: (kind, index, _nodeId) => viewport.pickByNode(kind, index),
  onFlagsChanged: (kind, flags) => {
    store.pushLog(`node ${kind} flags -> ${JSON.stringify(flags)}`);
    refreshNodeFlags();
    // Display flag: default to showing this node's FIRST port data in the viewport
    if (flags.display) viewport.pickByNode(kind, 0);
  },
  onNetworkChanged: () => {
    void runNetwork();
    refreshNodeFlags(); // topology changed -> refresh display focus right away
  },
};
const graph = await createReteGraph(layout.graphContainer, handlers);

let wsDisconnect: (() => void) | null = null;
let autoRun = layout.autoRunCheck.checked;
let replayPending = false;  // first inputs after connect = replay, do NOT auto-run (avoids clobbering outputs/edits)

layout.autoRunCheck.addEventListener("change", () => {
  autoRun = layout.autoRunCheck.checked;
  store.pushLog(`auto-run ${autoRun ? "on" : "off"}`);
});

(window as unknown as Record<string, unknown>).__cylViewport = null; // debug hook
const viewport = await Viewport.create(layout.viewportContainer, (out: OutputBuffer) => {
  if (!store.serial) return;
  client
    .pushOutputs(store.serial, [out])
    .then((r) => store.pushLog(`edit out${out.index} pushed rev=${r.rev}`))
    .catch((e) => store.pushLog(`edit failed: ${String(e)}`));
});
(window as unknown as Record<string, unknown>).__cylViewport = viewport;
(window as unknown as Record<string, unknown>).__cylGraph = graph; // debug hook (MCP debug access)
viewport.setEnterEditHandler(toggleEnterEdit); // left toolbar Enter icon -> activation

// Default startup layout: bundled Default.json (the user's Desk1 arrangement, versioned in the
// project). Applied AFTER graph + viewport are created so dockview fromJSON moves panels that
// already own their content (fixes the load-timing / collapsed-panel cascade).
applyLayout(dv, DEFAULT_LAYOUT, {
  graph: layout.graphContainer,
  viewport: layout.viewportContainer,
  inspector: layout.inspectorEl,
  log: layout.logEl,
  spreadsheet: spreadsheetEl,
  param: paramEl,
});
applyLayoutSettings(DEFAULT_LAYOUT);
currentLayoutName = DEFAULT_LAYOUT_NAME;
store.pushLog(`[layout] default layout "${DEFAULT_LAYOUT_NAME}" applied`);

/** Apply viewport display settings persisted inside a layout JSON (if any). */
function applyLayoutSettings(json: unknown): void {
  viewport.setDisplaySettings((json as { displaySettings?: { mode?: unknown } } | null)?.displaySettings);
}

/** Read float/int params into a {name: value} record (missing / invalid -> 0). */
function readParamFloats(params: Array<{ name: string; type: string; value: unknown }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) {
    if (p.type !== "float" && p.type !== "int") continue;
    const n = typeof p.value === "number" ? p.value : Number(p.value);
    out[p.name] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

/** Session-scoped param edit undo: consecutive edits on the SAME node within
 *  600ms merge into one { type: "params" } undo entry (before = pre-session
 *  params, after = latest). Selection switch flushes it immediately. */
let pendingParamUndo: {
  nodeId: string;
  before: Array<{ name: string; type: string; value: unknown }>;
  after: Array<{ name: string; type: string; value: unknown }>;
  timer: number;
} | null = null;

/** Flush the pending param edit into the shared undo stack (debounce / selection switch). */
function flushParamUndo(): void {
  if (!pendingParamUndo) return;
  const p = pendingParamUndo;
  pendingParamUndo = null;
  if (p.timer) window.clearTimeout(p.timer);
  graph.pushUndo({ type: "params", nodeId: p.nodeId, before: p.before, after: p.after });
}

/** Spreadsheet + Params follow the SELECTED node (multi-select -> first), not the
 *  display flag. null -> its in0 source port (header "in0"); _input_ -> all inputs;
 *  _output_ -> outputs; no selection -> fall back to the display-flag behaviour. */
function refreshSelectionPanels(): void {
  const sel = graph.getSelectedNode();
  let payloads: Array<InputPayload | OutputBuffer> = store.inputs;
  let source: "inputs" | "outputs" = "inputs";
  let focus: SpreadsheetFocus = { kind: null, index: null, label: null };
  if (sel) {
    if (sel.kind === "null" || sel.kind === "transform") {
      focus =
        sel.port !== null
          ? { kind: "null", index: sel.port, label: "in0" }
          : { kind: null, index: null, label: null };
      payloads = store.inputs;
      source = "inputs";
    } else if (sel.kind === "output") {
      focus = { kind: null, index: null, label: null };
      payloads = store.outputs;
      source = "outputs";
    } else {
      focus = { kind: null, index: null, label: null }; // _input_ -> all source inputs
      payloads = store.inputs;
      source = "inputs";
    }
  } else {
    // fallback: display flag (previous behaviour)
    const disp = graph.getDisplayNode();
    const kind = disp?.kind ?? null;
    const index = kind === "null" ? graph.getDisplayPortIndex() : kind === "input" ? 0 : null;
    focus =
      kind === "null" && index !== null ? { kind, index, label: "in0" } : { kind, index, label: null };
    payloads = store.inputs;
    source = "inputs";
  }
  renderSpreadsheet(spreadsheetEl, payloads, source, focus);
  const selId = sel?.id ?? null;
  renderParams(
    paramEl,
    sel ? { label: sel.label, kind: sel.kind, params: sel.params } : null,
    selId
      ? (params) => {
          // commit only while the same node is still selected (selection may change mid-edit)
          const cur = graph.getSelectedNode();
          if (!cur || cur.id !== selId) return;
          const prevParams = cur.params ?? [];
          // session undo: the first edit on this node captures the PRE-edit params
          // as `before`; later edits update `after`; 600ms debounce merges them into
          // a single { type: "params" } undo entry (selection switch flushes early)
          if (!pendingParamUndo || pendingParamUndo.nodeId !== cur.id) {
            pendingParamUndo = { nodeId: cur.id, before: prevParams, after: params, timer: 0 };
          } else {
            pendingParamUndo.after = params;
          }
          if (pendingParamUndo.timer) window.clearTimeout(pendingParamUndo.timer);
          pendingParamUndo.timer = window.setTimeout(flushParamUndo, 600);
          graph.setNodeParams(cur.id, params);
          const prevValue = new Map(prevParams.map((q) => [q.name, q.value]));
          const changed = params.find((q) => prevValue.get(q.name) !== q.value);
          store.pushLog(`[param] ${cur.label ?? cur.id} ${changed ? `${changed.name} = ${changed.value}` : "params updated"}`);
          // pivot edits move the Enter reference marker live (the gizmo stays on tx/ty/tz)
          if (viewport.isEnterActive()) {
            const v = readParamFloats(params);
            viewport.setEnterPivot(v.px ?? 0, v.py ?? 0, v.pz ?? 0);
          }
          void runNetwork();
        }
      : undefined,
  );
}

/** Bind the translate gizmo to the FIRST SELECTED node while Enter mode is on:
 *  transform -> attach the gizmo at its current tx/ty/tz; null/input/output/none
 *  -> drop the gizmo but keep the mode active (idle until a transform is selected). */
function bindEnterGizmoToSelection(): void {
  const sel = graph.getSelectedNode();
  if (!sel || sel.kind !== "transform") {
    viewport.endTransformGizmo({ keepActive: true });
    return;
  }
  const v = readParamFloats(sel.params ?? []);
  viewport.beginTransformGizmo(sel.id, v.tx ?? 0, v.ty ?? 0, v.tz ?? 0, v.px ?? 0, v.py ?? 0, v.pz ?? 0, (x, y, z) => {
    // Enter follows the CURRENT selection: read the bound node's live params.
    const node = graph.getNetworkSnapshot().nodes.find((n) => n.id === sel.id);
    if (!node) return; // node deleted mid-edit
    graph.setNodeParams(
      sel.id,
      (node.params ?? []).map((q) =>
        q.name === "tx" ? { ...q, value: x } : q.name === "ty" ? { ...q, value: y } : q.name === "tz" ? { ...q, value: z } : q,
      ),
    );
    void runNetwork();
  });
}

/** Enter node viewport edit activation (toolbar icon + Enter key): follows the
 *  first selected node - transform -> gizmo, otherwise enter stays active idle. */
function toggleEnterEdit(): void {
  if (viewport.isEnterActive()) {
    viewport.endTransformGizmo();
    return;
  }
  const sel = graph.getSelectedNode();
  if (!sel || sel.kind !== "transform") {
    viewport.setEnterActive(true); // enter mode on, gizmo idle until a transform is selected
    store.pushLog("[viewport] enter: no transform selected - gizmo idle");
    return;
  }
  bindEnterGizmoToSelection();
}

// node selection changes -> refresh Spreadsheet + Params immediately
// (store.subscribe alone does not fire when only the graph selection changes)
graph.onSelectionChanged(() => {
  flushParamUndo(); // selection switched -> close the pending param undo session
  refreshSelectionPanels();
  // Enter mode follows the FIRST SELECTED node: transform -> rebind the gizmo to
  // it; null/input/output/none -> drop the gizmo but keep Enter mode active.
  if (viewport.isEnterActive()) bindEnterGizmoToSelection();
});

/** Display node object (id + params) via the live editor (ReteGraph exposes editor). */
function getDisplayNodeInfo(): {
  id: string;
  kind: string;
  params: Array<{ name: string; type: string; value: unknown }>;
} | null {
  const nodes = graph.editor.getNodes() as unknown as Array<{
    id: string;
    kind: string;
    params?: Array<{ name: string; type: string; value: unknown }>;
    flags: { display: boolean };
  }>;
  const n = nodes.find((x) => x.flags.display);
  return n ? { id: n.id, kind: n.kind, params: n.params ?? [] } : null;
}

/** Node flags -> viewport: display visibility + reference reference overlays. */
function refreshNodeFlags(): void {
  // Viewport follows the node-view display flag of WHATEVER node is displayed,
  // at PORT level (not just node kind):
  //   _input_  -> show ONLY the first source input (in0)
  //   null     -> passthrough: show ONLY the input segment wired through it
  //               (graph.getDisplayPortIndex() resolves in0..in3 from the graph;
  //               no in0 connection -> -1 hides every input port)
  //   _output_ -> show ONLY the first output buffer (out0); nothing when Houdini hasn't pushed
  //   no display node -> keep showing inputs (safe source view)
  const disp = graph.getDisplayNode();
  const kind = disp?.kind ?? null;
  const hasOutputs = store.outputs.length > 0;
  const showOutputs = kind === "output" && hasOutputs;
  const showInputs = kind === "input" || kind === "null" || kind === "transform" || kind === null;
  viewport.setVisibility("inputs", showInputs);
  viewport.setVisibility("outputs", showOutputs);
  if (kind === "null" || kind === "transform") {
    const idx = graph.getDisplayPortIndex();
    // a displayed null/transform shows its CURRENT chain output (transformed
    // geometry), not the untransformed source input: hide every input port and
    // render the node result instead; a disconnected display hides both
    viewport.setDisplayFocus("inputs", -1);
    const dispNode = getDisplayNodeInfo();
    if (idx !== null && dispNode) {
      const snap = graph.getNetworkSnapshot();
      viewport.showNodeResult(computeNodeResult(snap, store.inputs, dispNode.id));
    } else {
      viewport.showNodeResult(null);
    }
  } else if (kind === "input") {
    // _input_ displayed: Houdini shows ONE source - only the first port
    viewport.showNodeResult(null);
    viewport.setDisplayFocus("inputs", 0);
  } else {
    viewport.showNodeResult(null);
    viewport.setDisplayFocus("inputs", null);
  }
  if (kind === "output") {
    viewport.setDisplayFocus("outputs", 0); // only the first output buffer
  } else {
    viewport.setDisplayFocus("outputs", null);
  }

  const inFlags = graph.getFlags("input");
  const outFlags = graph.getFlags("output");
  const refs: ReferenceItem[] = [];
  if (inFlags?.reference) {
    for (const inp of store.inputs) {
      if (inp.curves.length > 0) refs.push({ points: inp.points, curves: inp.curves, color: 0x4fc3f7 });
    }
  }
  if (outFlags?.reference) {
    const outRefs = store.outputs.flatMap((o) =>
      o.curves.length > 0 ? [{ points: o.points, curves: o.curves, color: 0xff5252 }] : [],
    );
    if (outRefs.length > 0) refs.push(...outRefs);
  }
  viewport.setReference(refs.length > 0 ? refs : null);
}

function inputStatsText(): string {
  const lines: string[] = [];
  for (let i = 0; i < 4; i++) {
    const inp = store.inputs.find((x) => x.index === i);
    lines.push(`in${i}: ${inp ? `${inp.pointCount}pt ${inp.curves.length}crv` : "—"}`);
  }
  return lines.join("\n");
}

function outputStatsText(): string {
  const lines: string[] = [];
  for (let i = 0; i < 4; i++) {
    const out = store.outputs.find((x) => x.index === i);
    lines.push(`out${i}: ${out ? `${out.pointCount}pt r${out.rev}` : "—"}`);
  }
  return lines.join("\n");
}

function renderInspector(): void {
  const rows: string[] = [
    `<div class="insp-row"><b>serial</b> ${store.serial || "—"}</div>`,
    `<div class="insp-row"><b>status</b> ${store.status}</div>`,
    `<div class="insp-row"><b>inputRev</b> ${store.inputRev}</div>`,
    `<div class="insp-row"><b>outputRev</b> ${store.outputRev}</div>`,
  ];
  for (const inp of store.inputs) {
    rows.push(`<div class="insp-row inp"><b>in${inp.index}</b> ${inp.pointCount}pt / ${inp.curves.length}crv</div>`);
  }
  for (const out of store.outputs) {
    rows.push(`<div class="insp-row out"><b>out${out.index}</b> ${out.pointCount}pt / ${out.curves.length}crv r${out.rev}</div>`);
  }
  rows.push(`<div class="insp-row hint">Alt+拖拽 = Houdini 导航 · 点选曲线拖拽 = 编辑→out · Tab 搜索节点 · 按住 Y 剪切 · 右键节点=flags</div>`);
  layout.inspectorEl.innerHTML = rows.join("");
}

store.subscribe(() => {
  graph.setStats("input", inputStatsText());
  graph.setStats("output", outputStatsText());
  renderInspector();
  renderLog();
  layout.statusDot.className = `cyl-status ${store.status}`;
  viewport.refresh();
  refreshNodeFlags();
  refreshSelectionPanels(); // Spreadsheet + Params follow the selected node
  scheduleSaveGraph();
  const showHint = !store.serial || store.status === "offline";
  layout.hintEl.classList.toggle("hidden", !showHint);
  layout.hintEl.textContent = !store.serial
    ? "未连接：在 Houdini 的 Cyl1nder 节点上点 Open in Browser，或在上方输入序列号后 Connect。"
    : store.status === "offline"
      ? "桥离线（127.0.0.1:8375）——请启动 bridge。"
      : "";
});

/** v1 network: trace the graph topology (input -> null/transform -> output) into 4 output buffers. */
async function runNetwork(): Promise<void> {
  if (!store.serial || store.inputs.length === 0) return;
  const snap = graph.getNetworkSnapshot();
  const outputs: OutputBuffer[] = computeOutputs(store.inputs, snap);
  try {
    const r = await client.pushOutputs(store.serial, outputs);
    store.pushLog(`network ran: ${outputs.length} outputs → rev=${r.rev}`);
  } catch (e) {
    store.pushLog(`network run failed: ${String(e)}`);
  }
}

/** HDA heartbeat watchdog: registry.lastSeen goes stale when Houdini crashes. */
let hdaWatch: number | undefined;
let hdaWasStale = false;
function startHdaWatch(serial: string): void {
  stopHdaWatch();
  const check = async () => {
    try {
      const st = await client.getStatus(serial);
      const lastSeen = (st.registry as { lastSeen?: number } | undefined)?.lastSeen ?? 0;
      const stale = Date.now() / 1000 - lastSeen > 15;
      layout.hdaOffline.classList.toggle("hidden", !stale);
      if (stale !== hdaWasStale) {
        hdaWasStale = stale;
        store.pushLog(`HDA ${stale ? "OFFLINE (Houdini not cooking)" : "online"}`);
      }
    } catch {
      layout.hdaOffline.classList.remove("hidden");
    }
  };
  void check();
  hdaWatch = window.setInterval(check, 5000);
}
function stopHdaWatch(): void {
  if (hdaWatch !== undefined) window.clearInterval(hdaWatch);
  hdaWatch = undefined;
  hdaWasStale = false;
  layout.hdaOffline.classList.add("hidden");
}

/** Viewport display path: fall back to the unified path system (disk snapshot)
 *  when the live workspace has no geometry yet (Houdini not cooking / bridge restarted). */
async function loadSnapshotIntoStore(serial: string): Promise<void> {
  try {
    const { snapshot } = await client.getSnapshot(serial);
    if (!snapshot) return;
    const inputs = snapshot.inputs as unknown[] | undefined;
    const outputs = snapshot.outputs as unknown[] | undefined;
    if (Array.isArray(inputs) && inputs.length > 0 && store.inputs.length === 0) {
      store.setInputs(inputs as never, store.inputRev + 1); // bump rev so viewport rebuilds
      store.pushLog(`[path] restored ${inputs.length} inputs from snapshot`);
    }
    const g = snapshot.graph as { nodes?: unknown[] } | undefined;
    if (g?.nodes?.length) {
      try {
        await graph.restoreGraph(snapshot.graph);
        store.pushLog(`[path] restored node graph (${g.nodes.length} nodes)`);
      } catch (e) {
        store.pushLog(`[path] graph restore failed: ${String(e)}`);
      }
    }
    if (Array.isArray(outputs) && outputs.length > 0 && store.outputs.length === 0) {
      store.upsertOutputs(outputs as never, store.outputRev + 1);
      store.pushLog(`[path] restored ${outputs.length} outputs from snapshot`);
    }
  } catch (e) {
    store.pushLog(`[path] snapshot read failed: ${String(e)}`);
  }
}

function connect(serialRaw: string): void {
  const serial = serialRaw.trim();
  if (!serial) return;
  wsDisconnect?.();
  replayPending = true;
  store.setSerial(serial);
  startHdaWatch(serial);
  store.pushLog(`connect ${serial}`);
  void loadSnapshotIntoStore(serial);
  store.setStatus("connecting");
  wsDisconnect = connectWs(
    serial,
    (msg) => {
      if (msg.type === "hello") {
        replayPending = true;  // a replay follows on every (re)connect - never auto-run on it
        store.setStatus("ok");
        store.pushLog(`hello inputRev=${msg.inputRev} outputRev=${msg.outputRev}`);
      } else if (msg.type === "inputs") {
        const changed = !inputsEqual(store.inputs, msg.inputs);
        store.setInputs(msg.inputs, msg.rev);
        store.pushLog(`inputs rev=${msg.rev} (${msg.inputs.length})${changed ? "" : " [unchanged]"}`);
        if (replayPending) {
          replayPending = false;  // replay of current state on connect - not an update
          store.pushLog("inputs replay - network not run");
          return;
        }
        // gate auto-run on real content change: breaks the Force Cook <-> echo feedback loop
        if (autoRun && changed) void runNetwork();
      } else if (msg.type === "outputs") {
        store.upsertOutputs(msg.outputs, msg.rev);
        store.pushLog(`outputs rev=${msg.rev} (${msg.outputs.length})`);
      }
    },
    (open) => store.setStatus(open ? "ok" : "offline"),
  );
}

layout.connectBtn.addEventListener("click", () => connect(layout.serialInput.value));
layout.serialInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") connect(layout.serialInput.value);
});

const qs = new URLSearchParams(location.search).get("serial");
if (qs) {
  layout.serialInput.value = qs;
  connect(qs);
} else {
  client
    .listSerials()
    .then((serials) => {
      if (serials.length > 0 && !store.serial) {
        layout.serialInput.value = serials[serials.length - 1];
        store.pushLog(`found serials: ${serials.join(", ")}`);
      }
    })
    .catch((e) => store.pushLog(`bridge unreachable: ${String(e)}`));
}

/** F = frame, dispatched by hover area:
 *  node graph -> frame selected nodes (or all when none selected)
 *  3D viewport -> frame geometry (or default view when nothing shown) */
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "f" || e.repeat) return;
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
  e.preventDefault();
  const overGraph = layout.graphContainer.matches(":hover");
  if (overGraph) graph.frameSelection();
  else viewport.frame();
});
// B = toggle debug reference boxes (viewport capability check)
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "b" || e.repeat) return;
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
  viewport.toggleDebugBoxes();
});
// Enter = node viewport edit activation (same handler as the toolbar icon).
// Only responds while the pointer hovers the viewport (Enter toggles in/out there);
// skipped while typing in inputs or when a button is focused (Enter clicks it natively).
window.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.repeat) return;
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
  if (el instanceof HTMLButtonElement) return;
  if (!viewport.isHovered()) return;
  e.preventDefault();
  toggleEnterEdit();
});

/** Debounced persist of the node graph (nodes/positions/connections) to the path system. */
var saveGraphTimer: number | undefined; // var: subscribe callback may fire before this line (TDZ-safe)
function scheduleSaveGraph(): void {
  if (saveGraphTimer !== undefined) window.clearTimeout(saveGraphTimer);
  saveGraphTimer = window.setTimeout(() => {
    if (!store.serial) return;
    try {
      void client.putSnapshot(store.serial, { graph: graph.serializeGraph() }).catch(() => undefined);
    } catch {
      /* ignore */
    }
  }, 1500);
}

store.pushLog(`Cyl1nder web v${APP_VERSION} · Tab=搜索 Y=剪切 右键=flags F=frame`);