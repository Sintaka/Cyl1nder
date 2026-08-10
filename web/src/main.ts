import "./styles.css";
import { buildLayout } from "./app/layout";
import { applyLayout, setupDock } from "./app/dock";
import { renderSpreadsheet } from "./app/spreadsheet";
import { store } from "./stores/workspace";
import { BridgeClient, connectWs } from "./bridge/client";
import { createReteGraph, type ReteGraphHandlers } from "./nodes2/graph";
import { Viewport, type ReferenceItem } from "./viewport/renderer";
import { APP_VERSION } from "./app/app-config";
import { inputsEqual } from "./protocol/compare";
import type { OutputBuffer } from "./protocol/types";

/** Log categories: geo data / viewport / ui / bridge(python runtime). */
let logFilter = "all";
const logCategories: [string, string][] = [
  ["all", "All"],
  ["geo", "Geo"],
  ["viewport", "Viewport"],
  ["ui", "UI"],
  ["bridge", "Bridge"],
];
const categorize = (m: string): string => {
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
const dv = setupDock(layout.dockContainer, {
  graph: layout.graphContainer,
  viewport: layout.viewportContainer,
  inspector: layout.inspectorEl,
  log: layout.logEl,
  spreadsheet: spreadsheetEl,
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
});

let currentLayoutName = "Desk1";
const getDockJson = () => (dv as unknown as { toJSON(): unknown }).toJSON();
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
            });
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
      if (!store.serial) return;
      void loadSnapshotIntoStore(store.serial);
    } else if (act === "saveas") {
      if (!store.serial) return;
      void client.putSnapshot(store.serial, { graph: graph.serializeGraph(), docking: getDockJson() });
      store.pushLog("[file] scene saved as current");
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
      // re-apply the saved layout, else fall back to the programmatic Desk1
      void client.loadLayout(currentLayoutName).then((r) => {
        if (r.layout) {
          applyLayout(dv, r.layout, {
            graph: layout.graphContainer,
            viewport: layout.viewportContainer,
            inspector: layout.inspectorEl,
            log: layout.logEl,
            spreadsheet: spreadsheetEl,
          });
          store.pushLog(`[layout] reloaded "${currentLayoutName}"`);
        }
      });
    }
  });
});
const handlers: ReteGraphHandlers = {
  onNodePick: (kind, index, _nodeId) => viewport.pickByNode(kind, index),
  onFlagsChanged: (kind, flags) => {
    store.pushLog(`node ${kind} flags -> ${JSON.stringify(flags)}`);
    refreshNodeFlags();
    // Display flag: default to showing this node's FIRST port data in the viewport
    if (flags.display) viewport.pickByNode(kind, 0);
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

const viewport = await Viewport.create(layout.viewportContainer, (out: OutputBuffer) => {
  if (!store.serial) return;
  client
    .pushOutputs(store.serial, [out])
    .then((r) => store.pushLog(`edit out${out.index} pushed rev=${r.rev}`))
    .catch((e) => store.pushLog(`edit failed: ${String(e)}`));
});

/** Node flags -> viewport: display visibility + reference reference overlays. */
function refreshNodeFlags(): void {
  // Viewport follows the node-view display flag of WHATEVER node is displayed,
  // at PORT level (not just node kind):
  //   _input_  -> show all 4 source inputs (in0..in3)
  //   null     -> passthrough: show ONLY the input segment wired through it
  //               (graph.getDisplayPortIndex() resolves in0..in3 from the graph)
  //   _output_ -> show result buffers (outputs); nothing when Houdini hasn't pushed
  //   no display node -> keep showing inputs (safe source view)
  const disp = graph.getDisplayNode();
  const kind = disp?.kind ?? null;
  const hasOutputs = store.outputs.length > 0;
  const showOutputs = kind === "output" && hasOutputs;
  const showInputs = kind === "input" || kind === "null" || kind === null;
  viewport.setVisibility("inputs", showInputs);
  viewport.setVisibility("outputs", showOutputs);
  if (kind === "null") {
    // display only the input segment routed through this null node
    viewport.setDisplayFocus("inputs", graph.getDisplayPortIndex());
  } else {
    viewport.setDisplayFocus("inputs", null);
  }
  viewport.setDisplayFocus("outputs", null);

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
  renderSpreadsheet(spreadsheetEl, store.inputs, "inputs");
  scheduleSaveGraph();
  const showHint = !store.serial || store.status === "offline";
  layout.hintEl.classList.toggle("hidden", !showHint);
  layout.hintEl.textContent = !store.serial
    ? "未连接：在 Houdini 的 Cyl1nder 节点上点 Open in Browser，或在上方输入序列号后 Connect。"
    : store.status === "offline"
      ? "桥离线（127.0.0.1:8375）——请启动 bridge。"
      : "";
});

/** v1 network: passthrough - output_i = input_i geometry, pushed back to the bridge. */
async function runNetwork(): Promise<void> {
  if (!store.serial || store.inputs.length === 0) return;
  const outputs: OutputBuffer[] = store.inputs.map((inp) => ({
    index: inp.index,
    rev: 0,
    pointCount: inp.pointCount,
    primCount: inp.primCount,
    points: inp.points,
    curves: inp.curves,
    faces: inp.faces ?? [],
    attributes: inp.attributes,
  }));
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