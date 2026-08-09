import Fuse from "fuse.js";
import type { Graph } from "@antv/x6";
import { INPUT_NODE, OUTPUT_NODE, NULL_NODE, addNullNode } from "./cyl1nderNode";

/** Mature fuzzy search (Fuse.js) over a small node palette - Houdini Tab menu style. */
export interface PaletteEntry {
  type: string;
  label: string;
  desc: string;
  group: string;
  keywords: string;
}

const PALETTE: PaletteEntry[] = [
  { type: INPUT_NODE, label: "input_", desc: "4-input source (HDA in0..in3)", group: "Source", keywords: "source input 输入 起点" },
  { type: OUTPUT_NODE, label: "output_", desc: "4-output sink (HDA out0..out3)", group: "Sink", keywords: "sink output 输出 终点" },
  { type: NULL_NODE, label: "null", desc: "passthrough, 4 in + 4 out", group: "Utility", keywords: "null passthrough pass through 直通" },
];

export function searchPalette(query: string): PaletteEntry[] {
  return query.trim() ? fuse.search(query).map((r) => r.item) : PALETTE;
}

const fuse = new Fuse(PALETTE, {
  keys: [
    { name: "label", weight: 0.5 },
    { name: "desc", weight: 0.25 },
    { name: "keywords", weight: 0.25 },
  ],
  threshold: 0.4,
  ignoreLocation: true,
  includeScore: true,
});

export class NodePalette {
  private overlay: HTMLDivElement;
  private input: HTMLInputElement;
  private list: HTMLDivElement;
  private open = false;
  private index = 0;
  private results: PaletteEntry[] = [];

  constructor(private graph: Graph, private container: HTMLElement) {
    this.overlay = document.createElement("div");
    this.overlay.className = "cyl-palette hidden";
    this.overlay.innerHTML = `
      <input class="cyl-palette-input" placeholder="Tab: search nodes…" spellcheck="false" />
      <div class="cyl-palette-list"></div>`;
    this.input = this.overlay.querySelector(".cyl-palette-input") as HTMLInputElement;
    this.list = this.overlay.querySelector(".cyl-palette-list") as HTMLDivElement;
    container.appendChild(this.overlay);

    this.input.addEventListener("input", () => this.update(this.input.value));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { this.move(1); e.preventDefault(); }
      else if (e.key === "ArrowUp") { this.move(-1); e.preventDefault(); }
      else if (e.key === "Enter") { this.create(); e.preventDefault(); }
      else if (e.key === "Escape") { this.close(); e.preventDefault(); }
    });
    this.overlay.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus
  }

  isOpen(): boolean { return this.open; }

  toggle(): void { this.open ? this.close() : this.openPalette(); }

  private openPalette(): void {
    this.open = true;
    this.overlay.classList.remove("hidden");
    this.update("");
    this.input.focus();
  }

  close(): void {
    this.open = false;
    this.overlay.classList.add("hidden");
    this.input.blur(); // release focus so global shortcuts (Y cut) work again
  }

  private update(query: string): void {
    this.results = searchPalette(query);
    this.index = 0;
    this.render();
  }

  private render(): void {
    this.list.innerHTML = "";
    this.results.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "cyl-palette-row" + (i === this.index ? " active" : "");
      row.innerHTML = `<span class="p-label">${r.label}</span><span class="p-desc">${r.desc}</span><span class="p-group">${r.group}</span>`;
      row.addEventListener("mousedown", (e) => { e.preventDefault(); this.index = i; this.create(); });
      this.list.appendChild(row);
    });
  }

  private move(d: number): void {
    if (this.results.length === 0) return;
    this.index = (this.index + d + this.results.length) % this.results.length;
    this.render();
  }

  private create(): void {
    const entry = this.results[this.index];
    if (!entry) return;
    const pos = this.centerPoint();
    if (entry.type === NULL_NODE) {
      addNullNode(this.graph, pos.x, pos.y);
    } else {
      // input_/output_ are singletons; focus them instead of duplicating.
      const id = entry.type;
      const cell = this.graph.getCellById(id);
      if (cell) this.graph.centerCell(cell);
    }
    this.close();
  }

  /** Graph-local coordinate at the center of the visible viewport. */
  private centerPoint(): { x: number; y: number } {
    const r = this.container.getBoundingClientRect();
    return this.graph.clientToLocal(r.left + r.width / 2, r.top + r.height / 2);
  }
}

/** Tab toggles the palette; Escape/Enter/arrows handled inside. */
export function attachPalette(graph: Graph, container: HTMLElement): NodePalette {
  const palette = new NodePalette(graph, container);
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.tagName === "SELECT") return;
    e.preventDefault();
    palette.toggle();
  });
  return palette;
}
