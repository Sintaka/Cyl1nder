import "./styles.css";
import { attachSplitters, buildLayout } from "./app/layout";
import { store } from "./stores/workspace";
import { BridgeClient, connectWs } from "./bridge/client";
import {
  createGraph,
  registerNodes,
  upsertFlowGraph,
  INPUT_NODE,
  OUTPUT_NODE,
  getFlags,
  type GraphHandlers,
} from "./nodes/cyl1nderNode";
import { attachPalette } from "./nodes/palette";
import { attachCutMode } from "./nodes/cutMode";
import { attachContextMenu } from "./nodes/contextMenu";
import { Viewport, type ReferenceItem } from "./viewport/renderer";
import { APP_VERSION } from "./app/app-config";
import { inputsEqual } from "./protocol/compare";
import type { OutputBuffer } from "./protocol/types";

const layout = buildLayout(document.getElementById("app")!);
attachSplitters(layout.root);
registerNodes();
const client = new BridgeClient();

const handlers: GraphHandlers = {
  onNodePick: (kind, index, _nodeId) => viewport.pickByNode(kind, index),
  onEdgeCut: (edgeId) => store.pushLog(`cut edge ${edgeId}`),
  onNodeRemoved: (nodeId) => store.pushLog(`removed node ${nodeId}`),
};
const graph = createGraph(layout.graphContainer, handlers);

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

// Tab search palette + Y cut mode + right-click flag menu.
const palette = attachPalette(graph, layout.graphContainer);
const detachCut = attachCutMode(graph, layout.graphContainer, (what, id) => {
  store.pushLog(`cut ${what} ${id}`);
});
const closeMenu = attachContextMenu(
  graph,
  layout.graphContainer,
  (nodeId, _flags) => {
    store.pushLog(`node ${nodeId} flags changed`);
    refreshNodeFlags();
  },
  (nodeId) => handlers.onNodeRemoved?.(nodeId),
);

/** Node flags -> viewport: display visibility + wireframe reference overlays. */
function refreshNodeFlags(): void {
  const inputNode = graph.getCellById(INPUT_NODE) as Parameters<typeof getFlags>[0] | undefined;
  const outputNode = graph.getCellById(OUTPUT_NODE) as Parameters<typeof getFlags>[0] | undefined;
  const showInputs = inputNode ? getFlags(inputNode).display : true;
  const showOutputs = outputNode ? getFlags(outputNode).display : true;
  viewport.setVisibility("inputs", showInputs);
  viewport.setVisibility("outputs", showOutputs);

  const refs: ReferenceItem[] = [];
  if (inputNode && getFlags(inputNode).wireframe) {
    for (const inp of store.inputs) {
      if (inp.curves.length > 0) refs.push({ points: inp.points, curves: inp.curves, color: 0x4fc3f7 });
    }
  }
  if (outputNode) {
    const outRefs = store.outputs.flatMap((o) =>
      o.curves.length > 0 ? [{ points: o.points, curves: o.curves, color: 0xff5252 }] : [],
    );
    if (getFlags(outputNode).wireframe && outRefs.length > 0) refs.push(...outRefs);
  }
  // Null nodes: reference = passthrough inputs (same as source).
  const nullNodes = graph.getNodes().filter((n) => n.shape !== INPUT_NODE && n.shape !== OUTPUT_NODE);
  for (const n of nullNodes) {
    const f = getFlags(n);
    if (!f.wireframe) continue;
    for (const inp of store.inputs) {
      if (inp.curves.length > 0) refs.push({ points: inp.points, curves: inp.curves, color: 0xffd166 });
    }
    break; // one reference set is enough for the passthrough view
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
  upsertFlowGraph(graph, store.serial || "—", inputStatsText(), outputStatsText());
  renderInspector();
  layout.logEl.textContent = store.logs.slice(-10).join("\n");
  layout.statusDot.className = `cyl-status ${store.status}`;
  viewport.refresh();
  refreshNodeFlags();
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
    attributes: inp.attributes,
  }));
  try {
    const r = await client.pushOutputs(store.serial, outputs);
    store.pushLog(`network ran: ${outputs.length} outputs → rev=${r.rev}`);
  } catch (e) {
    store.pushLog(`network run failed: ${String(e)}`);
  }
}

function connect(serialRaw: string): void {
  const serial = serialRaw.trim();
  if (!serial) return;
  wsDisconnect?.();
  replayPending = true;
  store.setSerial(serial);
  store.pushLog(`connect ${serial}`);
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

store.pushLog(`Cyl1nder web v${APP_VERSION} · Tab=搜索 Y=剪切 右键=flags`);
// Keep palette/cut/menu refs alive (no unused-var warnings in strict builds).
void palette; void detachCut; void closeMenu;
