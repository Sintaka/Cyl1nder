import "./styles.css";
import { buildLayout } from "./app/layout";
import { store } from "./stores/workspace";
import { BridgeClient, connectWs } from "./bridge/client";
import { createGraph, registerNode, upsertHdaNode } from "./nodes/cyl1nderNode";
import { Viewport } from "./viewport/renderer";
import { APP_VERSION } from "./app/app-config";
import type { OutputBuffer } from "./protocol/types";

const layout = buildLayout(document.getElementById("app")!);
registerNode();
const graph = createGraph(layout.graphContainer);
const client = new BridgeClient();
let wsDisconnect: (() => void) | null = null;

const viewport = new Viewport(layout.viewportContainer, (out: OutputBuffer) => {
  if (!store.serial) return;
  client
    .pushOutputs(store.serial, [out])
    .then((r) => store.pushLog(`edit out${out.index} pushed rev=${r.rev}`))
    .catch((e) => store.pushLog(`edit failed: ${String(e)}`));
});

function statsText(): string {
  const lines: string[] = [];
  for (let i = 0; i < 4; i++) {
    const inp = store.inputs.find((x) => x.index === i);
    lines.push(`in${i}: ${inp ? `${inp.pointCount}pt ${inp.curves.length}crv` : "—"}`);
  }
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
  rows.push(`<div class="insp-row hint">Alt+拖拽 = Houdini 导航 · 点选曲线拖拽 = 编辑→out</div>`);
  layout.inspectorEl.innerHTML = rows.join("");
}

store.subscribe(() => {
  upsertHdaNode(graph, store.serial || "pending", statsText());
  renderInspector();
  layout.logEl.textContent = store.logs.slice(-10).join("\n");
  layout.statusDot.className = `cyl-status ${store.status}`;
  viewport.refresh();
});

function connect(serialRaw: string): void {
  const serial = serialRaw.trim();
  if (!serial) return;
  wsDisconnect?.();
  store.setSerial(serial);
  store.pushLog(`connect ${serial}`);
  store.setStatus("connecting");
  wsDisconnect = connectWs(
    serial,
    (msg) => {
      if (msg.type === "hello") {
        store.setStatus("ok");
        store.pushLog(`hello inputRev=${msg.inputRev} outputRev=${msg.outputRev}`);
      } else if (msg.type === "inputs") {
        store.setInputs(msg.inputs, msg.rev);
        store.pushLog(`inputs rev=${msg.rev} (${msg.inputs.length})`);
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

store.pushLog(`Cyl1nder web v${APP_VERSION}`);