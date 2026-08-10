/**
 * Geometry Spreadsheet (Houdini-style): inspect point / vertex / prim / detail
 * of the current geometry (per input/output port). Data comes from the store
 * (bridge payloads: points/curves/faces/attributes), vertex/detail derived.
 */
import type { InputPayload, OutputBuffer } from "../protocol/types";

export type GeoPayload = InputPayload | OutputBuffer;

function esc(s: unknown): string {
  return String(s ?? "");
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
  const pRows = pts
    .map((pt, i) => {
      const cells = [`P${i}`, +pt[0].toFixed(4), +pt[1].toFixed(4), +pt[2].toFixed(4)];
      for (const a of attrNames) cells.push(attrRow(a, attrs[a].values, i));
      return `<tr><td>${cells.map(esc).join("</td><td>")}</td></tr>`;
    })
    .join("");
  const pointsTable = `
    <table class="cyl-sp-table"><thead><tr><th>#</th><th>P.x</th><th>P.y</th><th>P.z</th>${attrNames
      .map((a) => `<th>${esc(a)}</th>`)
      .join("")}</tr></thead><tbody>${pRows || "<tr><td colspan=4>no points</td></tr>"}</tbody></table>`;

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
        `<tr><td>${vIdx}</td><td>P${pi}</td><td>prim${primId}</td><td>${+pt[0].toFixed(4)}</td><td>${+pt[1].toFixed(4)}</td><td>${+pt[2].toFixed(4)}</td></tr>`,
      );
      vIdx++;
    }
  };
  curves.forEach((c, i) => addVerts(c.pointIndices, i));
  faces.forEach((f, i) => addVerts(f, curves.length + i));
  const verticesTable = `<table class="cyl-sp-table"><thead><tr><th>#</th><th>point</th><th>prim</th><th>v.x</th><th>v.y</th><th>v.z</th></tr></thead><tbody>${
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

/** Render the spreadsheet for a list of payloads (one section per port). */
export function renderSpreadsheet(el: HTMLElement, payloads: GeoPayload[], source: "inputs" | "outputs"): void {
  const sections = payloads
    .map((p) => {
      const t = renderPayload(p);
      const tabs = (["points", "vertices", "prims", "detail"] as const)
        .map((k) => `<button class="cyl-sp-tab" data-sp="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`)
        .join("");
      return `<div class="cyl-sp-section" data-payload-idx="${p.index}">
        <div class="cyl-sp-head">${source}${p.index} · ${p.pointCount}pt / ${p.primCount}prim</div>
        <div class="cyl-sp-tabs">${tabs}</div>
        <div class="cyl-sp-pane" data-pane="points">${t.points}</div>
        <div class="cyl-sp-pane hidden" data-pane="vertices">${t.vertices}</div>
        <div class="cyl-sp-pane hidden" data-pane="prims">${t.prims}</div>
        <div class="cyl-sp-pane hidden" data-pane="detail">${t.detail}</div>
      </div>`;
    })
    .join("");
  el.innerHTML = sections || "<div class='cyl-sp-empty'>no geometry</div>";
  // tab switching
  el.querySelectorAll(".cyl-sp-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sec = (btn as HTMLElement).closest(".cyl-sp-section");
      if (!sec) return;
      const pane = (btn as HTMLElement).dataset.sp ?? "points";
      sec.querySelectorAll(".cyl-sp-tab").forEach((b) => b.classList.toggle("active", b === btn));
      sec.querySelectorAll(".cyl-sp-pane").forEach((pn) => pn.classList.toggle("hidden", (pn as HTMLElement).dataset.pane !== pane));
    });
  });
  el.querySelector(".cyl-sp-tab")?.classList.add("active");
}