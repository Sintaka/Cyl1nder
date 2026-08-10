/**
 * Geometry Spreadsheet (Houdini-style): inspect point / vertex / prim / detail
 * of the current geometry (per input/output port). Data comes from the store
 * (bridge payloads: points/curves/faces/attributes), vertex/detail derived.
 */
import type { InputPayload, OutputBuffer } from "../protocol/types";

export type GeoPayload = InputPayload | OutputBuffer;

/**
 * Optional display-focus filter for renderSpreadsheet. When kind is "input" or
 * "null" and index is a valid number, only that one payload section is shown.
 */
export interface SpreadsheetFocus {
  kind: string | null;
  index: number | null;
}

/** Active tab per payload index, kept across re-renders (store refreshes rebuild innerHTML). */
const activeTabs = new Map<number, string>();

function esc(s: unknown): string {
  return String(s ?? "");
}

/** Compact number formatting for coordinate cells (P / vertex components). */
function fmtNum(x: number): string {
  if (x === 0) return "0";
  const ax = Math.abs(x);
  if (ax >= 1e6 || ax < 1e-4) return x.toExponential(3);
  return String(+x.toFixed(6)); // short decimal, trailing zeros stripped
}

function attrRow(attr: string, values: unknown, idx: number): string {
  const v = Array.isArray(values) ? values[idx] : values;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "number" ? +x.toFixed(4) : esc(x))).join(", ");
  return esc(v);
}

/** Build the four tables for one payload. */
export function renderPayload(p: GeoPayload): { points: string; vertices: string; prims: string; detail: string } {
  const pts = p.points ?? [];
  const curves = p.curves ?? [];
  const faces = p.faces ?? [];
  const attrs = p.attributes ?? {};
  const attrNames = Object.keys(attrs);

  // --- points -------------------------------------------------------------
  const ptCols = 4 + attrNames.length;
  const pRows = pts
    .map((pt, i) => {
      const cells = [String(i), fmtNum(pt[0]), fmtNum(pt[1]), fmtNum(pt[2])];
      for (const a of attrNames) cells.push(attrRow(a, attrs[a].values, i));
      return `<tr><td>${cells.map(esc).join("</td><td>")}</td></tr>`;
    })
    .join("");
  const pointsTable = `
    <table class="cyl-sp-table"><colgroup><col class="cyl-sp-col-num"><col class="cyl-sp-col-num"><col class="cyl-sp-col-num"><col class="cyl-sp-col-num"></colgroup><thead><tr><th>ptnum</th><th>P.x</th><th>P.y</th><th>P.z</th>${attrNames
      .map((a) => `<th>${esc(a)}</th>`)
      .join("")}</tr></thead><tbody>${pRows || `<tr><td colspan="${ptCols}">no points</td></tr>`}</tbody></table>`;

  // --- prims --------------------------------------------------------------
  const primRows: string[] = [];
  curves.forEach((c, i) => {
    primRows.push(`<tr><td>${i}</td><td>polyline</td><td>${c.pointIndices.length}</td><td>${esc(c.pointIndices.join(", "))}</td></tr>`);
  });
  faces.forEach((f, i) => {
    primRows.push(`<tr><td>${curves.length + i}</td><td>polygon</td><td>${f.length}</td><td>${esc(f.join(", "))}</td></tr>`);
  });
  const primsTable = `<table class="cyl-sp-table"><thead><tr><th>#</th><th>type</th><th>verts</th><th>points</th></tr></thead><tbody>${
    primRows.join("") || "<tr><td colspan=4>no prims</td></tr>"
  }</tbody></table>`;

  // --- vertices (derived from curves/faces point refs) ----------------------
  const vRows: string[] = [];
  let vIdx = 0;
  const addVerts = (refs: number[], primId: number) => {
    for (const pi of refs) {
      const pt = pts[pi];
      if (!pt) continue;
      vRows.push(
        `<tr><td>${vIdx}</td><td>P${pi}</td><td>prim${primId}</td><td>${fmtNum(pt[0])}</td><td>${fmtNum(pt[1])}</td><td>${fmtNum(pt[2])}</td></tr>`,
      );
      vIdx++;
    }
  };
  curves.forEach((c, i) => addVerts(c.pointIndices, i));
  faces.forEach((f, i) => addVerts(f, curves.length + i));
  const verticesTable = `<table class="cyl-sp-table"><colgroup><col><col><col><col class="cyl-sp-col-num"><col class="cyl-sp-col-num"><col class="cyl-sp-col-num"></colgroup><thead><tr><th>#</th><th>point</th><th>prim</th><th>v.x</th><th>v.y</th><th>v.z</th></tr></thead><tbody>${
    vRows.join("") || "<tr><td colspan=6>no vertices</td></tr>"
  }</tbody></table>`;

  // --- detail --------------------------------------------------------------
  const detailRows = [
    ["pointCount", p.pointCount],
    ["primCount", p.primCount],
    ["curves", curves.length],
    ["faces", faces.length],
    ["points[]", pts.length],
    ["attributes", attrNames.join(", ") || "—"],
    ["name", (p as { name?: string }).name ?? ""],
    ["index", p.index],
  ] as const;
  const detailTable = `<table class="cyl-sp-table"><tbody>${detailRows
    .map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`)
    .join("")}</tbody></table>`;

  return { points: pointsTable, vertices: verticesTable, prims: primsTable, detail: detailTable };
}

/**
 * Render the spreadsheet for a list of payloads (one section per port).
 * Optional `focus` filters the rendered sections: kind "input" or "null" with a
 * valid index renders only `[payloads[index]]`; anything else renders all.
 * The active tab per payload is remembered in `activeTabs` so store refreshes
 * (which rebuild innerHTML) keep the user's current level instead of resetting
 * to Points.
 */
export function renderSpreadsheet(
  el: HTMLElement,
  payloads: GeoPayload[],
  source: "inputs" | "outputs",
  focus?: SpreadsheetFocus,
): void {
  const focused =
    focus &&
    (focus.kind === "input" || focus.kind === "null") &&
    typeof focus.index === "number" &&
    focus.index >= 0 &&
    focus.index < payloads.length
      ? [payloads[focus.index]]
      : payloads;

  const sections = focused
    .map((p) => {
      const t = renderPayload(p);
      const key = p.index;
      const saved = activeTabs.get(key) ?? "points";
      const tabs = (["points", "vertices", "prims", "detail"] as const)
        .map((k) => `<button class="cyl-sp-tab${k === saved ? " active" : ""}" data-sp="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`)
        .join("");
      const panes = (["points", "vertices", "prims", "detail"] as const)
        .map((k) => `<div class="cyl-sp-pane${k === saved ? "" : " hidden"}" data-pane="${k}">${t[k]}</div>`)
        .join("");
      return `<div class="cyl-sp-section" data-payload-idx="${key}">
        <div class="cyl-sp-head">${source}${key} · ${p.pointCount}pt / ${p.primCount}prim</div>
        <div class="cyl-sp-tabs">${tabs}</div>
        ${panes}
      </div>`;
    })
    .join("");
  el.innerHTML = sections || "<div class='cyl-sp-empty'>no geometry</div>";
  // tab switching (+ persist the active level across re-renders)
  el.querySelectorAll(".cyl-sp-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sec = (btn as HTMLElement).closest(".cyl-sp-section");
      if (!sec) return;
      const pane = (btn as HTMLElement).dataset.sp ?? "points";
      const idx = Number((sec as HTMLElement).dataset.payloadIdx);
      if (!Number.isNaN(idx)) activeTabs.set(idx, pane);
      sec.querySelectorAll(".cyl-sp-tab").forEach((b) => b.classList.toggle("active", b === btn));
      sec.querySelectorAll(".cyl-sp-pane").forEach((pn) => pn.classList.toggle("hidden", (pn as HTMLElement).dataset.pane !== pane));
    });
  });
}