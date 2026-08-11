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
 * Optional `label` (e.g. a null node's input port name "in0") overrides the
 * section header (default `${source}${index}`) when the focus is active.
 */
export interface SpreadsheetFocus {
  kind: string | null;
  index: number | null;
  label?: string | null;
}

/** Active tab per payload index, kept across re-renders (store refreshes rebuild innerHTML). */
const activeTabs = new Map<number, string>();

/** Minimum body rows per table so every sheet pane keeps the same visual height. */
const MIN_TABLE_ROWS = 8;
/** Trailing empty column (colgroup col) so tables stretch to the pane width. */
const FILL_COL = `<col class="cyl-sp-col-fill">`;
const EMPTY_CELL = "&nbsp;";

function esc(s: unknown): string {
  return String(s ?? "");
}

/** Escape text for safe interpolation into innerHTML (used for user-provided labels). */
function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
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

/**
 * One data row ending with an empty trailing cell for the fill column (keeps
 * the colgroup col count === per-row cell count; no content, just border/bg).
 */
function rowHtml(cells: string[]): string {
  return `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join("")}<td></td></tr>`;
}

/**
 * Pad a table body with empty rows so every sheet renders at least
 * MIN_TABLE_ROWS body rows (uniform pane height, no truncation). `colCount`
 * includes the fill column so the colgroup count always matches row cells.
 */
function bodyHtml(rows: string[], colCount: number): string {
  const emptyRow = `<tr>${Array.from({ length: colCount }, () => `<td>${EMPTY_CELL}</td>`).join("")}</tr>`;
  return rows.join("") + emptyRow.repeat(Math.max(0, MIN_TABLE_ROWS - rows.length));
}

/** Build the four tables for one payload. */
export function renderPayload(p: GeoPayload): { points: string; vertices: string; prims: string; detail: string } {
  const pts = p.points ?? [];
  const curves = p.curves ?? [];
  const faces = p.faces ?? [];
  const attrs = p.attributes ?? {};
  const attrNames = Object.keys(attrs);

  // --- points -------------------------------------------------------------
  const ptCols = 4 + attrNames.length; // data columns
  const ptCells = ptCols + 1; // + trailing fill column
  const pRows = pts.map((pt, i) => {
    const cells = [String(i), fmtNum(pt[0]), fmtNum(pt[1]), fmtNum(pt[2])];
    for (const a of attrNames) cells.push(attrRow(a, attrs[a].values, i));
    return rowHtml(cells);
  });
  const pointsTable = `
    <table class="cyl-sp-table"><colgroup><col class="cyl-sp-col-num"><col class="cyl-sp-col-num"><col class="cyl-sp-col-num"><col class="cyl-sp-col-num">${attrNames
      .map(() => "<col>")
      .join("")}${FILL_COL}</colgroup><thead><tr><th>ptnum</th><th>P.x</th><th>P.y</th><th>P.z</th>${attrNames
      .map((a) => `<th>${esc(a)}</th>`)
      .join("")}<th></th></tr></thead><tbody>${bodyHtml(
      pRows.length ? pRows : [`<tr><td colspan="${ptCells}">no points</td></tr>`],
      ptCells,
    )}</tbody></table>`;

  // --- prims --------------------------------------------------------------
  const primRows: string[] = [];
  curves.forEach((c, i) => {
    primRows.push(rowHtml([String(i), "polyline", String(c.pointIndices.length), c.pointIndices.join(", ")]));
  });
  faces.forEach((f, i) => {
    primRows.push(rowHtml([String(curves.length + i), "polygon", String(f.length), f.join(", ")]));
  });
  const primsTable = `<table class="cyl-sp-table"><colgroup><col class="cyl-sp-col-num"><col><col class="cyl-sp-col-num"><col>${FILL_COL}</colgroup><thead><tr><th>primnum</th><th>type</th><th>verts</th><th>points</th><th></th></tr></thead><tbody>${bodyHtml(
    primRows.length ? primRows : [`<tr><td colspan="5">no prims</td></tr>`],
    5,
  )}</tbody></table>`;

  // --- vertices (derived from curves/faces point refs) ----------------------
  const vRows: string[] = [];
  let vIdx = 0;
  const addVerts = (refs: number[], primId: number) => {
    for (const pi of refs) {
      const pt = pts[pi];
      if (!pt) continue;
      vRows.push(rowHtml([String(vIdx), `P${pi}`, `prim${primId}`, fmtNum(pt[0]), fmtNum(pt[1]), fmtNum(pt[2])]));
      vIdx++;
    }
  };
  curves.forEach((c, i) => addVerts(c.pointIndices, i));
  faces.forEach((f, i) => addVerts(f, curves.length + i));
  const verticesTable = `<table class="cyl-sp-table"><colgroup><col><col><col><col class="cyl-sp-col-num"><col class="cyl-sp-col-num"><col class="cyl-sp-col-num">${FILL_COL}</colgroup><thead><tr><th>vertnum</th><th>point</th><th>prim</th><th>v.x</th><th>v.y</th><th>v.z</th><th></th></tr></thead><tbody>${bodyHtml(
    vRows.length ? vRows : [`<tr><td colspan="7">no vertices</td></tr>`],
    7,
  )}</tbody></table>`;

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
  const detailTable = `<table class="cyl-sp-table"><colgroup><col><col>${FILL_COL}</colgroup><tbody>${bodyHtml(
    detailRows.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td><td></td></tr>`),
    3,
  )}</tbody></table>`;

  return { points: pointsTable, vertices: verticesTable, prims: primsTable, detail: detailTable };
}

/**
 * Render the spreadsheet for a list of payloads (one section per port).
 * Optional `focus` filters the rendered sections: kind "input" or "null" with a
 * valid index renders only `[payloads[index]]`; anything else renders all.
 * When the focus is active and `focus.label` is non-empty, the section header
 * shows that label (e.g. "in0") instead of the default `${source}${index}`.
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
  const focusedIndex =
    focus &&
    (focus.kind === "input" || focus.kind === "null") &&
    typeof focus.index === "number" &&
    focus.index >= 0 &&
    focus.index < payloads.length
      ? focus.index
      : null;
  const focused = focusedIndex !== null ? [payloads[focusedIndex]] : payloads;
  const focusLabel = focus && typeof focus.label === "string" && focus.label.trim() !== "" ? focus.label : null;

  const sections = focused
    .map((p) => {
      const t = renderPayload(p);
      const key = p.index;
      const head = focusedIndex === key && focusLabel !== null ? htmlEscape(focusLabel) : `${source}${key}`;
      const saved = activeTabs.get(key) ?? "points";
      const tabs = (["points", "vertices", "prims", "detail"] as const)
        .map((k) => `<button class="cyl-sp-tab${k === saved ? " active" : ""}" data-sp="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`)
        .join("");
      const panes = (["points", "vertices", "prims", "detail"] as const)
        .map((k) => `<div class="cyl-sp-pane${k === saved ? "" : " hidden"}" data-pane="${k}">${t[k]}</div>`)
        .join("");
      return `<div class="cyl-sp-section" data-payload-idx="${key}">
        <div class="cyl-sp-head">${head} · ${p.pointCount}pt / ${p.primCount}prim</div>
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