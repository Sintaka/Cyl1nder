/**
 * Unified color system (contract devlog/autosave-color-prefs-ui.md §2.2 +
 * optimize-round-00062.md §C2). Pure TS, zero new deps.
 *
 * Dark floating (non-modal) color picker, fully reworked for round 0.1.00062:
 * - P2  Full Adobe-style wheel: center saturation 0, edge pure hue. The wheel
 *      sets hue + saturation; the SV triangle/square panel keeps the same
 *      bounding box in both shapes (no jump when toggling).
 * - P3  RGB / HSL / HSV modes each get a draggable channel slider next to the
 *      numeric input. Simple/Advanced mode pill (PALETTE presets = Simple;
 *      hue-segmented categories + Adobe harmony wheel = Advanced). The △/□
 *      shape toggle sits on the same toolbar row as the mode pill.
 * - P4  Native browser eyedropper (window.EyeDropper, Chrome/Edge only): the
 *      button is hidden when unsupported and the open() rejection (user
 *      cancel) is swallowed.
 * - P5  Adobe harmony wheel (Advanced): 4-5 linked points derived from one
 *      base color (fixed hue offsets / sat / light multipliers per preset),
 *      dragging one point rotates the whole group, Color harmonies preset
 *      dropdown, linked swatches (click to pick -> re-anchor the base), and a
 *      base-lightness slider tied to HSL L that re-tints every point.
 * - P1  Recents: right-click deletes a single swatch, "Clear all" empties the
 *      list (localStorage "cyl1nder.colorRecents").
 * - P7  The whole panel drags by its title bar (same gesture as the
 *      Preference panel).
 * - Close: Esc / ✕ only — clicking outside does NOT close; opening another
 *      picker (e.g. another color3 swatch) reuses the open picker and retargets.
 *
 * rgbToHex / hexToRgb are shared by the Viewport background pref (Agent B/C1)
 * and the color3 param controls (param.ts).
 */
import "../styles/colorpicker.css";
import { createDropdown } from "../app/widgets";

import { clamp01, clamp100, clamp255, norm360, hexToRgb, hslToRgb, hsvToRgb, rgbToHex, rgbToHsl, rgbToHsv, type RGB } from "./color-math";
export { rgbToHex, hexToRgb, rgbToHsl, hslToRgb, rgbToHsv, hsvToRgb, type RGB } from "./color-math";
import { HARMONIES, harmonyDef, harmonyColor, type HarmonyId, type HslBase } from "./harmony";
import { PALETTE, clearRecents, loadRecents, recordRecent, removeRecent } from "./palette";
import { createWheelSv, WHEEL_CX, WHEEL_CY, WHEEL_R, type SetColorOptions, type SvShape } from "./wheel-sv";

export interface ColorPickerOptions {
  initial: RGB;
  /** Live callback on every change (drag / input / swatch pick). */
  onColor: (rgb: RGB, hex: string) => void;
  title?: string;
  /** Optional fixed position (screen px); defaults to top-right of the viewport. */
  position?: { left: number; top: number };
}

// Native eyedropper (Chrome/Edge only, ~Chromium 95+). Firefox/Safari ship
// neither the constructor nor the API, so the button is hidden there.
// https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper_API
declare global {
  interface Window {
    EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> };
  }
}

/**
 * Clamp a fixed-position floating panel so it stays inside the current viewport.
 * Keeps at least `margin` px visible on every edge; if the panel is larger than
 * the viewport, its top-left is pinned to the margin so the header stays reachable.
 * Only meaningful once the element is in the DOM (reads getBoundingClientRect).
 */
export function fitInViewport(el: HTMLElement, margin = 8): void {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxLeft = Math.max(margin, vw - rect.width - margin);
  const maxTop = Math.max(margin, vh - rect.height - margin);
  const left = Math.max(margin, Math.min(rect.left, maxLeft));
  const top = Math.max(margin, Math.min(rect.top, maxTop));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.right = "auto";
}

// ---------------- picker ----------------

type Mode = "rgb" | "hsl" | "hsv";

const FIELD_DEFS: Record<Mode, { label: string; min: number; max: number }[]> = {
  rgb: [
    { label: "R", min: 0, max: 255 },
    { label: "G", min: 0, max: 255 },
    { label: "B", min: 0, max: 255 },
  ],
  hsl: [
    { label: "H", min: 0, max: 360 },
    { label: "S", min: 0, max: 100 },
    { label: "L", min: 0, max: 100 },
  ],
  hsv: [
    { label: "H", min: 0, max: 360 },
    { label: "S", min: 0, max: 100 },
    { label: "V", min: 0, max: 100 },
  ],
};

interface PickerState {
  rgb: RGB;
  mode: Mode;
  shape: SvShape;
  advanced: boolean;
  harmony: HarmonyId;
  base: HslBase;
  hsl: HslBase;
}

interface ActivePicker {
  root: HTMLElement;
  close: () => void;
  retarget: (opts: ColorPickerOptions) => void;
}

let activePicker: ActivePicker | null = null;

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
    );
}

function valuesForMode(mode: Mode, rgb: RGB): [number, number, number] {
  if (mode === "rgb") return [rgb.r, rgb.g, rgb.b];
  if (mode === "hsl") {
    const { h, s, l } = rgbToHsl(rgb);
    return [h, s, l];
  }
  const { h, s, v } = rgbToHsv(rgb);
  return [h, s, v];
}

function colorFromMode(mode: Mode, vals: [number, number, number]): RGB {
  if (mode === "rgb") return { r: vals[0], g: vals[1], b: vals[2] };
  if (mode === "hsl") return hslToRgb(vals[0], vals[1], vals[2]);
  return hsvToRgb(vals[0], vals[1], vals[2]);
}

/**
 * Open a non-modal floating color picker (no backdrop; the page stays usable
 * behind it). Esc / ✕ close it; clicking outside does NOT close — opening
 * another picker (e.g. another color3 swatch) closes the old one and
 * retargets to the new. The title bar drags the whole panel. Returns the
 * close function. Only one picker is open at a time: opening a new one
 * retargets the previous in place (keeping its position).
 */
export function openColorPicker(opts: ColorPickerOptions): () => void {
  if (activePicker) {
    activePicker.retarget(opts);
    return activePicker.close;
  }

  let target: ColorPickerOptions = opts;

  const initHsl = rgbToHsl(opts.initial);
  const state: PickerState = {
    rgb: { ...opts.initial },
    mode: "rgb",
    shape: "tri",
    advanced: false,
    harmony: "analogous",
    base: { h: initHsl.h, s: initHsl.s, l: initHsl.l },
    hsl: { h: initHsl.h, s: initHsl.s, l: initHsl.l },
  };

  /** Current channel values for the active mode (HSL reads the preserved state.hsl). */
  const displayVals = (): [number, number, number] =>
    state.mode === "hsl" ? [state.hsl.h, state.hsl.s, state.hsl.l] : valuesForMode(state.mode, state.rgb);

  // ---- Ctrl+Z undo (E): per-gesture snapshot stack; cleared on retarget ----
  const undoStack: string[] = [];
  const pushUndo = (): void => {
    const hex = rgbToHex(state.rgb);
    if (undoStack.length === 0 || undoStack[undoStack.length - 1] !== hex) undoStack.push(hex);
    if (undoStack.length > 50) undoStack.shift();
  };
  const undo = (): void => {
    if (undoStack.length === 0) return;
    const prevHex = undoStack.pop()!;
    const undoneHex = rgbToHex(state.rgb);
    const prev = hexToRgb(prevHex);
    if (!prev) return;
    setColor(prev, { emit: true, trackRecent: false });
    removeRecent(undoneHex);
    renderRecents();
  };

  const root = document.createElement("div");
  root.className = "cyl-cp";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", target.title ?? "Pick color");
  root.innerHTML = `
    <div class="cyl-cp-head">
      <span class="cyl-cp-title">${esc(target.title ?? "Pick color")}</span>
      <button type="button" class="cyl-cp-close" aria-label="Close">✕</button>
    </div>
    <div class="cyl-cp-body">
      <div class="cyl-cp-toolbar">
        <div class="cyl-cp-pill" role="group" aria-label="Picker mode">
          <button type="button" data-pickermode="simple" class="active" aria-pressed="true">Simple</button>
          <button type="button" data-pickermode="advanced" aria-pressed="false">Advanced</button>
        </div>
        <div class="cyl-cp-sv-toggle" role="group" aria-label="SV panel shape">
          <button type="button" data-shape="tri" class="active" aria-pressed="true" title="Triangle (Adobe style)">△</button>
          <button type="button" data-shape="sq" aria-pressed="false" title="Square">□</button>
        </div>
      </div>
      <div class="cyl-cp-areas">
        <div class="cyl-cp-wheel" data-part="wheel">
          <div class="cyl-cp-wheel-thumb" data-part="wheel-thumb"></div>
        </div>
        <div class="cyl-cp-sv tri" data-part="sv"><div class="cyl-cp-sv-thumb"></div></div>
      </div>
      <div class="cyl-cp-harmony" data-part="harmony" hidden>
        <div class="cyl-cp-harmony-head">
          <div data-part="harmony-preset"></div>
          <span class="cyl-cp-harmony-hint" data-part="harmony-hint" aria-hidden="true"></span>
          <label class="cyl-cp-light" title="Base lightness (HSL L) drives every harmony point">
            <span>L</span>
            <input type="range" min="0" max="100" step="1" data-part="harmony-light" aria-label="Base lightness" />
          </label>
        </div>
        <div class="cyl-cp-harmony-swatches" data-part="harmony-swatches"></div>
      </div>
      <div class="cyl-cp-hex-row">
        <label for="cyl-cp-hex">hex</label>
        <input type="text" id="cyl-cp-hex" class="cyl-cp-hex" spellcheck="false" maxlength="7" autocomplete="off" aria-label="hex color" />
        <button type="button" class="cyl-cp-eye" data-part="eye" title="Pick color from screen (native EyeDropper)" aria-label="Pick color from screen">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>
        </button>
        <span class="cyl-cp-preview"></span>
      </div>
      <div class="cyl-cp-tabs">
        <button type="button" data-mode="rgb" class="active">RGB</button>
        <button type="button" data-mode="hsl">HSL</button>
        <button type="button" data-mode="hsv">HSV</button>
      </div>
      <div class="cyl-cp-fields" data-part="fields"></div>
      <div class="cyl-cp-block">
        <div class="cyl-cp-block-label"><span>Palette</span></div>
        <div class="cyl-cp-swatches" data-part="palette"></div>
      </div>
      <div class="cyl-cp-block">
        <div class="cyl-cp-block-label">
          <span>Recent</span>
          <button type="button" class="cyl-cp-clear" data-part="recents-clear">Clear all</button>
        </div>
        <div class="cyl-cp-swatches" data-part="recents"></div>
      </div>
    </div>`;

  const head = root.querySelector<HTMLElement>(".cyl-cp-head")!;
  const closeBtn = root.querySelector<HTMLButtonElement>(".cyl-cp-close")!;
  const wheelEl = root.querySelector<HTMLElement>('[data-part="wheel"]')!;
  const wheelThumb = root.querySelector<HTMLElement>('[data-part="wheel-thumb"]')!;
  const svEl = root.querySelector<HTMLElement>('[data-part="sv"]')!;
  const svThumb = root.querySelector<HTMLElement>(".cyl-cp-sv-thumb")!;
  const svToggleBtns = Array.from(root.querySelectorAll<HTMLButtonElement>(".cyl-cp-sv-toggle button"));
  const modeBtns = Array.from(root.querySelectorAll<HTMLButtonElement>(".cyl-cp-pill button"));
  const harmonyEl = root.querySelector<HTMLElement>('[data-part="harmony"]')!;
  const harmonyHost = root.querySelector<HTMLElement>('[data-part="harmony-preset"]')!;
  const harmonyHintEl = root.querySelector<HTMLElement>('[data-part="harmony-hint"]')!;
  const lightSlider = root.querySelector<HTMLInputElement>('[data-part="harmony-light"]')!;
  const harmonySwatchesEl = root.querySelector<HTMLElement>('[data-part="harmony-swatches"]')!;
  const hexInput = root.querySelector<HTMLInputElement>(".cyl-cp-hex")!;
  const eyeBtn = root.querySelector<HTMLButtonElement>('[data-part="eye"]')!;
  const preview = root.querySelector<HTMLElement>(".cyl-cp-preview")!;
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>(".cyl-cp-tabs button"));
  const fieldsEl = root.querySelector<HTMLElement>('[data-part="fields"]')!;
  const paletteEl = root.querySelector<HTMLElement>('[data-part="palette"]')!;
  const recentsEl = root.querySelector<HTMLElement>('[data-part="recents"]')!;
  const clearRecentsBtn = root.querySelector<HTMLButtonElement>('[data-part="recents-clear"]')!;

  const setColorRef: { fn: ((rgb: RGB, o?: SetColorOptions) => void) | null } = { fn: null };
  const pickHarmonyRef: { fn: ((i: number) => void) | null } = { fn: null };
  const wheelSv = createWheelSv({
    state,
    root,
    wheelEl,
    wheelThumb,
    svEl,
    svThumb,
    svToggleBtns,
    setColor: (rgb, o) => setColorRef.fn?.(rgb, o),
    pickHarmony: (i) => pickHarmonyRef.fn?.(i),
    pushUndo,
  });

  // ---- recents (P1: right-click delete, Clear all, debounced write) ----
  let pendingRecentHex: string | null = null;
  let recentTimer: number | undefined;
  const renderRecents = (list?: string[]): void => {
    const items = list ?? loadRecents();
    recentsEl.innerHTML = items
      .map((h) => `<button type="button" class="cyl-cp-swatch" style="background:${h}" data-hex="${h}" aria-label="${h}"></button>`)
      .join("");
    clearRecentsBtn.disabled = items.length === 0;
    recentsEl.querySelectorAll<HTMLButtonElement>(".cyl-cp-swatch").forEach((b) => {
      b.addEventListener("click", () => {
        const rgb = hexToRgb(b.dataset.hex ?? "");
        if (rgb) {
          pushUndo();
          setColor(rgb);
        }
      });
      // P1: right-click removes a single recent swatch
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        renderRecents(removeRecent(b.dataset.hex ?? ""));
      });
    });
  };
  clearRecentsBtn.addEventListener("click", () => {
    clearRecents();
    renderRecents([]);
  });
  const flushRecent = (): void => {
    if (recentTimer !== undefined) {
      window.clearTimeout(recentTimer);
      recentTimer = undefined;
    }
    if (pendingRecentHex) {
      const hex = pendingRecentHex;
      pendingRecentHex = null;
      renderRecents(recordRecent(hex));
    }
  };
  const scheduleRecent = (hex: string): void => {
    pendingRecentHex = hex;
    if (recentTimer !== undefined) window.clearTimeout(recentTimer);
    recentTimer = window.setTimeout(flushRecent, 250);
  };

  // ---- palette (one flat 10-column grid of the 20 presets, both modes) ----
  const wireSwatchClicks = (container: HTMLElement): void => {
    container.querySelectorAll<HTMLButtonElement>(".cyl-cp-swatch").forEach((b) => {
      b.addEventListener("click", () => {
        const rgb = hexToRgb(b.dataset.hex ?? "");
        if (rgb) {
          pushUndo();
          setColor(rgb);
        }
      });
    });
  };
  const renderPalette = (): void => {
    paletteEl.innerHTML = PALETTE.map(
      (h) => `<button type="button" class="cyl-cp-swatch" style="background:${h}" data-hex="${h}" aria-label="${h}"></button>`,
    ).join("");
    wireSwatchClicks(paletteEl);
  };

  // ---- numeric fields per mode (P3: each channel gets a draggable slider) ----
  const renderFields = (): void => {
    const defs = FIELD_DEFS[state.mode];
    fieldsEl.innerHTML = defs
      .map(
        (d, i) =>
          `<label class="cyl-cp-fld"><span>${d.label}</span><input type="range" min="${d.min}" max="${d.max}" step="1" data-i="${i}" data-part="field-slider" aria-label="${d.label} slider" /><input type="number" min="${d.min}" max="${d.max}" step="1" data-i="${i}" aria-label="${d.label}" /></label>`,
      )
      .join("");
    fieldsEl.querySelectorAll<HTMLInputElement>("input[type=number]").forEach((input) => {
      const i = Number(input.dataset.i);
      input.addEventListener("input", () => {
        const n = parseFloat(input.value);
        if (Number.isNaN(n)) return;
        const vals = displayVals();
        const def = FIELD_DEFS[state.mode][i];
        vals[i] = Math.max(def.min, Math.min(def.max, n));
        if (state.mode === "hsl") {
          state.hsl = { h: vals[0], s: vals[1], l: vals[2] };
          setColor(colorFromMode("hsl", vals), { preserveHsl: true });
        } else {
          setColor(colorFromMode(state.mode, vals));
        }
      });
      input.addEventListener("focus", pushUndo);
      input.addEventListener("change", () => {
        if (Number.isNaN(parseFloat(input.value))) syncFields(); // revert invalid on blur/Enter
      });
    });
    // P3: dragging a channel slider updates the color live
    fieldsEl.querySelectorAll<HTMLInputElement>('input[type=range][data-part="field-slider"]').forEach((slider) => {
      const i = Number(slider.dataset.i);
      slider.addEventListener("input", () => {
        const n = parseFloat(slider.value);
        if (Number.isNaN(n)) return;
        const vals = displayVals();
        vals[i] = n;
        if (state.mode === "hsl") {
          state.hsl = { h: vals[0], s: vals[1], l: vals[2] };
          setColor(colorFromMode("hsl", vals), { preserveHsl: true });
        } else {
          setColor(colorFromMode(state.mode, vals));
        }
      });
      slider.addEventListener("pointerdown", pushUndo);
    });
    syncFields();
  };

  const syncFields = (): void => {
    const vals = displayVals();
    fieldsEl.querySelectorAll<HTMLInputElement>("input[type=number]").forEach((input) => {
      const s = String(Math.round(vals[Number(input.dataset.i)]));
      if (input.value !== s) input.value = s;
    });
    fieldsEl.querySelectorAll<HTMLInputElement>('input[type=range][data-part="field-slider"]').forEach((slider) => {
      const s = String(Math.round(vals[Number(slider.dataset.i)]));
      if (slider.value !== s) slider.value = s;
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.mode = (tab.dataset.mode as Mode) ?? "rgb";
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      if (state.mode === "hsl") state.hsl = rgbToHsl(state.rgb);
      renderFields();
    });
  });

  // ---- Simple / Advanced mode (P3 + P5) ----
  const applyMode = (advanced: boolean): void => {
    state.advanced = advanced;
    modeBtns.forEach((b) => {
      const active = b.dataset.pickermode === (advanced ? "advanced" : "simple");
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    harmonyEl.hidden = !advanced;
    if (advanced) {
      // re-anchor the harmony base to the current color
      const { h, s, l } = rgbToHsl(state.rgb);
      state.base = { h, s, l };
    }
    renderPalette();
    wheelSv.syncWheel();
    syncHarmony();
    syncLight();
  };
  modeBtns.forEach((b) => {
    b.addEventListener("click", () => applyMode(b.dataset.pickermode === "advanced"));
  });

  // ---- Adobe harmony (P5): preset dropdown + linked points + swatches + L ----
  const harmonyDropdown = createDropdown({
    value: state.harmony,
    options: HARMONIES.map((d) => ({ value: d.id, label: d.label })),
    onChange: (v) => {
      state.harmony = (v as HarmonyId) || "analogous";
      syncHarmony();
    },
    ariaLabel: "Color harmony preset",
  });
  harmonyHost.replaceWith(harmonyDropdown.element);

  /** Pick harmony point i: re-anchor the base so point 0 == that color. */
  const pickHarmony = (i: number): void => {
    const def = harmonyDef(state.harmony);
    const p = def.points[i] ?? def.points[0];
    state.base = {
      h: norm360(state.base.h + p.hue),
      s: clamp100(state.base.s * p.sat),
      l: clamp100(state.base.l * p.light),
    };
    setColor(hslToRgb(state.base.h, state.base.s, state.base.l), { keepBase: true });
  };

  /** P5b: mini harmony "association dots" beside the preset dropdown. */
  const renderHarmonyHint = (): void => {
    if (!state.advanced) {
      harmonyHintEl.innerHTML = "";
      return;
    }
    const def = harmonyDef(state.harmony);
    const dots = def.points
      .map((p, i) => {
        const rgb = harmonyColor(state.base, def, i);
        const rad = ((p.hue - 90) * Math.PI) / 180; // 0° points straight up
        const r = clamp01(p.sat) * 10; // center -> dot radius
        const x = 14 + r * Math.cos(rad);
        const y = 14 + r * Math.sin(rad);
        const dotR = i === 0 ? 2.4 : 1.8; // base point slightly larger
        return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${dotR}" fill="${rgbToHex(rgb)}" stroke="#ffffff" stroke-width="0.6"/>`;
      })
      .join("");
    harmonyHintEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="11" fill="none" stroke="#5a6068" stroke-width="0.8"/>${dots}</svg>`;
  };

  const syncHarmony = (): void => {
    if (!state.advanced) return;
    const def = harmonyDef(state.harmony);
    // point markers 1..N (point 0 == base == the wheel thumb)
    const markers = def.points
      .map((p, i) => {
        if (i === 0) return null;
        const hue = norm360(state.base.h + p.hue);
        const sat = clamp100(state.base.s * p.sat) / 100; // 0..1 radius factor
        const rad = (hue * Math.PI) / 180;
        const x = WHEEL_CX + sat * WHEEL_R * Math.sin(rad);
        const y = WHEEL_CY - sat * WHEEL_R * Math.cos(rad);
        return `<button type="button" class="cyl-cp-harmony-point" data-harmony-i="${i}" style="left:${x}px;top:${y}px" aria-label="Harmony point ${i}"></button>`;
      })
      .join("");
    wheelEl.querySelectorAll(".cyl-cp-harmony-point").forEach((n) => n.remove());
    wheelEl.insertAdjacentHTML("beforeend", markers);

    harmonySwatchesEl.innerHTML = def.points
      .map((p, i) => {
        const rgb = harmonyColor(state.base, def, i);
        const hex = rgbToHex(rgb);
        return `<button type="button" class="cyl-cp-swatch" style="background:${hex}" data-hex="${hex}" data-harmony-i="${i}" aria-label="Harmony ${i} ${hex}"></button>`;
      })
      .join("");
    harmonySwatchesEl.querySelectorAll<HTMLButtonElement>(".cyl-cp-swatch").forEach((b) => {
      b.addEventListener("click", () => {
        pushUndo();
        pickHarmony(Number(b.dataset.harmonyI));
      });
    });
    renderHarmonyHint();
  };

  const syncLight = (): void => {
    if (!state.advanced) return;
    const s = String(Math.round(state.base.l));
    if (lightSlider.value !== s) lightSlider.value = s;
  };

  // P5: base lightness (HSL L) drives the lightness of every harmony point
  lightSlider.addEventListener("input", () => {
    const v = parseFloat(lightSlider.value);
    if (Number.isNaN(v)) return;
    state.base.l = v;
    setColor(hslToRgb(state.base.h, state.base.s, v), { keepBase: true });
  });

  // ---- main state update: syncs hex/preview/wheel/SV/fields/harmony + fires onColor ----
  const setColor = (rgb: RGB, o: { emit?: boolean; trackRecent?: boolean; keepBase?: boolean; preserveHsl?: boolean } = {}): void => {
    const { emit = true, trackRecent = true, keepBase = false, preserveHsl = false } = o;
    state.rgb = { r: clamp255(rgb.r), g: clamp255(rgb.g), b: clamp255(rgb.b) };
    if (!preserveHsl) state.hsl = rgbToHsl(state.rgb);
    if (state.advanced && !keepBase) {
      const { h, s, l } = rgbToHsl(state.rgb);
      state.base = { h, s, l };
    }
    const hex = rgbToHex(state.rgb);
    if (hexInput.value !== hex) hexInput.value = hex;
    preview.style.background = hex;
    const hsv = rgbToHsv(state.rgb);
    svEl.style.background = `hsl(${hsv.h}, 100%, 50%)`;
    wheelSv.syncWheel();
    wheelSv.syncSvThumb(hsv);
    syncFields();
    syncHarmony();
    syncLight();
    if (emit) target.onColor(state.rgb, hex);
    if (trackRecent) scheduleRecent(hex);
  };

  setColorRef.fn = setColor;
  pickHarmonyRef.fn = pickHarmony;
  wheelSv.wire();

  // ---- hex string input ----
  hexInput.addEventListener("input", () => {
    const value = hexInput.value.toUpperCase(); // lowercase hex -> uppercase as you type
    if (hexInput.value !== value) hexInput.value = value;
    const rgb = hexToRgb(value);
    if (rgb) setColor(rgb);
  });
  hexInput.addEventListener("change", () => {
    if (!hexToRgb(hexInput.value)) hexInput.value = rgbToHex(state.rgb); // revert invalid
  });
  hexInput.addEventListener("focus", pushUndo);

  // ---- P4: native eyedropper (Chrome/Edge). Hidden when unsupported. ----
  const supportsEyeDropper = typeof window !== "undefined" && !!window.EyeDropper;
  if (!supportsEyeDropper) eyeBtn.hidden = true;
  eyeBtn.addEventListener("click", async () => {
    if (!window.EyeDropper) return;
    try {
      // new EyeDropper().open() shows the OS full-screen picker; the returned
      // promise resolves with { sRGBHex } or rejects (DOMException) when the
      // user presses Escape / cancels -> swallowed below.
      const dropper = new window.EyeDropper();
      const result = await dropper.open();
      const rgb = hexToRgb(result.sRGBHex);
      if (rgb) {
        pushUndo();
        setColor(rgb);
      }
    } catch {
      /* user cancelled the picker -> keep the current color */
    }
  });

  // ---- close: ✕ / Esc only. Clicking outside does NOT close; opening another
  // picker (e.g. another color3 swatch) retargets via the activePicker guard
  // at the top of openColorPicker (the open picker is retargeted in place). ----
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      e.preventDefault();
      undo();
    }
  };
  const close = (): void => {
    if (recentTimer !== undefined) window.clearTimeout(recentTimer);
    flushRecent();
    document.removeEventListener("keydown", onKey);
    harmonyDropdown.destroy();
    root.remove();
    if (activePicker?.root === root) activePicker = null;
  };
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKey);

  /** Retarget the open picker to a new color (keeps position/state, no re-open). */
  const retarget = (next: ColorPickerOptions): void => {
    undoStack.length = 0; // new target -> new undo history (avoid cross-param undo)
    const rect = root.getBoundingClientRect();
    const off =
      rect.right < 8 || rect.bottom < 8 || rect.left > window.innerWidth - 8 || rect.top > window.innerHeight - 8;
    if (off) {
      if (next.position) {
        root.style.left = `${next.position.left}px`;
        root.style.top = `${next.position.top}px`;
        root.style.right = "auto";
        fitInViewport(root);
      } else {
        root.style.left = "";
        root.style.top = "";
        root.style.right = "";
      }
    }
    target = next;
    root.querySelector<HTMLElement>(".cyl-cp-title")!.textContent = next.title ?? "Pick color";
    root.setAttribute("aria-label", next.title ?? "Pick color");
    state.rgb = { ...next.initial };
    const { h, s, l } = rgbToHsl(next.initial);
    state.base = { h, s, l };
    setColor(next.initial, { emit: false, trackRecent: false, keepBase: true });
  };

  // ---- P7: drag the whole panel by its title bar (same as Preference) ----
  head.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".cyl-cp-close")) return;
    e.preventDefault(); // stop text-selection / native drag while moving
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = root.getBoundingClientRect();
    const offX = startX - rect.left;
    const offY = startY - rect.top;
    const onMove = (ev: PointerEvent): void => {
      root.style.left = `${ev.clientX - offX}px`;
      root.style.top = `${ev.clientY - offY}px`;
      root.style.right = "auto";
      fitInViewport(root);
    };
    const onUp = (): void => {
      root.ownerDocument.removeEventListener("pointermove", onMove);
      root.ownerDocument.removeEventListener("pointerup", onUp);
      (root.ownerDocument.body as HTMLElement).style.userSelect = "";
    };
    (root.ownerDocument.body as HTMLElement).style.userSelect = "none";
    root.ownerDocument.addEventListener("pointermove", onMove);
    root.ownerDocument.addEventListener("pointerup", onUp);
  });

  // position (fixed): explicit anchor or top-right default
  if (opts.position) {
    root.style.left = `${opts.position.left}px`;
    root.style.top = `${opts.position.top}px`;
  }

  document.body.appendChild(root);
  if (opts.position) fitInViewport(root);
  activePicker = { root, close, retarget };

  // initial paint (no onColor / no recents write)
  renderPalette();
  renderFields();
  setColor(state.rgb, { emit: false, trackRecent: false, keepBase: true });
  renderRecents();
  wheelSv.syncWheel();
  hexInput.focus();
  hexInput.select();

  return close;
}

// Debug/test hook: conversion helpers + open state (used by round15 e2e).
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__cylColorPicker = {
    rgbToHex,
    hexToRgb,
    rgbToHsl,
    hslToRgb,
    rgbToHsv,
    hsvToRgb,
    openColorPicker,
    close: () => activePicker?.close(),
    isOpen: () => activePicker !== null,
    getRecents: loadRecents,
    removeRecent,
    clearRecents,
  };
}
