/**
 * Unified color system (contract devlog/autosave-color-prefs-ui.md §2.2).
 * Pure TS, zero new deps. Dark floating (non-modal) color picker with a modern
 * hue RING + Adobe-style SV triangle (toggleable to a square), palette + recents
 * swatches, RGB / HSL / HSV numeric modes and a live uppercase "#RRGGBB" hex
 * input. rgbToHex / hexToRgb are shared by the Viewport background pref (Agent B)
 * and the color3 param controls (param.ts).
 */
import "../styles/colorpicker.css";

export interface RGB {
  /** red channel 0..255 */
  r: number;
  /** green channel 0..255 */
  g: number;
  /** blue channel 0..255 */
  b: number;
}

export interface ColorPickerOptions {
  initial: RGB;
  /** Live callback on every change (drag / input / swatch pick). */
  onColor: (rgb: RGB, hex: string) => void;
  title?: string;
  /** Optional fixed position (screen px); defaults to top-right of the viewport. */
  position?: { left: number; top: number };
}

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** "#RRGGBB" (uppercase) from an RGB triplet; channels are rounded + clamped. */
export function rgbToHex(rgb: RGB): string {
  const hex = (n: number): string => clamp255(n).toString(16).padStart(2, "0").toUpperCase();
  return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`;
}

/** Parse "#rgb" / "#rrggbb" (case-insensitive, optional whitespace); null when invalid. */
export function hexToRgb(hex: string): RGB | null {
  const s = hex.trim();
  const full = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (full) {
    const n = parseInt(full[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const short = /^#([0-9a-fA-F]{3})$/.exec(s);
  if (short) {
    const [a, b, c] = short[1].split("");
    return {
      r: parseInt(a + a, 16),
      g: parseInt(b + b, 16),
      b: parseInt(c + c, 16),
    };
  }
  return null;
}

// ---------------- rgb <-> hsl / rgb <-> hsv (internal; exposed via __cylColorPicker) ----------------

function rgbToHsl(rgb: RGB): { h: number; s: number; l: number } {
  const r = clamp01(rgb.r / 255);
  const g = clamp01(rgb.g / 255);
  const b = clamp01(rgb.b / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const hn = (((h % 360) + 360) % 360) / 360;
  const s2 = clamp01(s / 100);
  const l2 = clamp01(l / 100);
  if (s2 === 0) {
    const v = clamp255(l2 * 255);
    return { r: v, g: v, b: v };
  }
  const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2;
  const p = 2 * l2 - q;
  const hue2rgb = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: clamp255(hue2rgb(hn + 1 / 3) * 255),
    g: clamp255(hue2rgb(hn) * 255),
    b: clamp255(hue2rgb(hn - 1 / 3) * 255),
  };
}

function rgbToHsv(rgb: RGB): { h: number; s: number; v: number } {
  const r = clamp01(rgb.r / 255);
  const g = clamp01(rgb.g / 255);
  const b = clamp01(rgb.b / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s: s * 100, v: max * 100 };
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  const hn = (((h % 360) + 360) % 360) / 60;
  const s2 = clamp01(s / 100);
  const v2 = clamp01(v / 100);
  const c = v2 * s2;
  const x = c * (1 - Math.abs((hn % 2) - 1));
  const m = v2 - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hn < 1) {
    rp = c;
    gp = x;
  } else if (hn < 2) {
    rp = x;
    gp = c;
  } else if (hn < 3) {
    gp = c;
    bp = x;
  } else if (hn < 4) {
    gp = x;
    bp = c;
  } else if (hn < 5) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return {
    r: clamp255((rp + m) * 255),
    g: clamp255((gp + m) * 255),
    b: clamp255((bp + m) * 255),
  };
}

// ---------------- recents (localStorage, last 8) ----------------

const RECENTS_KEY = "cyl1nder.colorRecents";
const RECENTS_MAX = 8;

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is string => typeof x === "string" && hexToRgb(x) !== null)
      .slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

function recordRecent(hex: string): string[] {
  const recents = [hex, ...loadRecents().filter((x) => x !== hex)].slice(0, RECENTS_MAX);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch {
    /* storage full / private mode -> recents are best-effort */
  }
  return recents;
}

/** Preset palette shown above the recents row. */
const PALETTE: string[] = [
  "#f8f9fa", "#dee2e6", "#adb5bd", "#6c757d", "#212529",
  "#f03e3e", "#e8590c", "#f59f00", "#37b24d", "#0ca678",
  "#1098ad", "#1c7ed6", "#4263eb", "#7048e8", "#ae3ec9",
  "#ff8787", "#ffa94d", "#ffd43b", "#69db7c", "#3bc9db",
];

// ---------------- picker ----------------

type Mode = "rgb" | "hsl" | "hsv";
/** SV panel shape: "tri" = Adobe-style hue/black/white triangle; "sq" = square. */
type SvShape = "tri" | "sq";

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

/** Hue ring geometry (must match .cyl-cp-ring CSS: 132px, inner hole inset 28px). */
const RING_SIZE = 132;
const RING_INNER = 28;
const RING_CX = RING_SIZE / 2;
const RING_CY = RING_SIZE / 2;
const RING_R = (RING_SIZE / 2 + (RING_SIZE - 2 * RING_INNER) / 2) / 2;

interface PickerState {
  rgb: RGB;
  mode: Mode;
  shape: SvShape;
}

interface ActivePicker {
  root: HTMLElement;
  close: () => void;
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
 * behind it). Esc / ✕ / clicking outside closes it. Returns the close function.
 * Only one picker is open at a time: opening a new one closes the previous.
 */
export function openColorPicker(opts: ColorPickerOptions): () => void {
  if (activePicker) activePicker.close();

  const state: PickerState = { rgb: { ...opts.initial }, mode: "rgb", shape: "tri" };

  const root = document.createElement("div");
  root.className = "cyl-cp";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", opts.title ?? "Pick color");
  root.innerHTML = `
    <div class="cyl-cp-head">
      <span class="cyl-cp-title">${esc(opts.title ?? "Pick color")}</span>
      <button type="button" class="cyl-cp-close" aria-label="Close">✕</button>
    </div>
    <div class="cyl-cp-body">
      <div class="cyl-cp-areas">
        <div class="cyl-cp-ring" data-part="ring"><div class="cyl-cp-ring-thumb"></div></div>
        <div class="cyl-cp-sv-wrap">
          <div class="cyl-cp-sv-toggle" role="group" aria-label="SV panel shape">
            <button type="button" data-shape="tri" class="active" aria-pressed="true" title="Triangle (Adobe style)">△</button>
            <button type="button" data-shape="sq" aria-pressed="false" title="Square">□</button>
          </div>
          <div class="cyl-cp-sv tri" data-part="sv"><div class="cyl-cp-sv-thumb"></div></div>
        </div>
      </div>
      <div class="cyl-cp-hex-row">
        <label for="cyl-cp-hex">hex</label>
        <input type="text" id="cyl-cp-hex" class="cyl-cp-hex" spellcheck="false" maxlength="7" autocomplete="off" aria-label="hex color" />
        <span class="cyl-cp-preview"></span>
      </div>
      <div class="cyl-cp-tabs">
        <button type="button" data-mode="rgb" class="active">RGB</button>
        <button type="button" data-mode="hsl">HSL</button>
        <button type="button" data-mode="hsv">HSV</button>
      </div>
      <div class="cyl-cp-fields" data-part="fields"></div>
      <div class="cyl-cp-block">
        <div class="cyl-cp-block-label">Palette</div>
        <div class="cyl-cp-swatches" data-part="palette"></div>
      </div>
      <div class="cyl-cp-block">
        <div class="cyl-cp-block-label">Recent</div>
        <div class="cyl-cp-swatches" data-part="recents"></div>
      </div>
    </div>`;

  const head = root.querySelector<HTMLElement>(".cyl-cp-head")!;
  const closeBtn = root.querySelector<HTMLButtonElement>(".cyl-cp-close")!;
  const ringEl = root.querySelector<HTMLElement>(".cyl-cp-ring")!;
  const ringThumb = root.querySelector<HTMLElement>(".cyl-cp-ring-thumb")!;
  const svEl = root.querySelector<HTMLElement>(".cyl-cp-sv")!;
  const svThumb = root.querySelector<HTMLElement>(".cyl-cp-sv-thumb")!;
  const svToggleEl = root.querySelector<HTMLElement>(".cyl-cp-sv-toggle")!;
  const svToggleBtns = Array.from(svToggleEl.querySelectorAll<HTMLButtonElement>("button"));
  const hexInput = root.querySelector<HTMLInputElement>(".cyl-cp-hex")!;
  const preview = root.querySelector<HTMLElement>(".cyl-cp-preview")!;
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>(".cyl-cp-tabs button"));
  const fieldsEl = root.querySelector<HTMLElement>(".cyl-cp-fields")!;
  const paletteEl = root.querySelector<HTMLElement>('[data-part="palette"]')!;
  const recentsEl = root.querySelector<HTMLElement>('[data-part="recents"]')!;

  // ---- recents (debounced write + render; flushed on close) ----
  let pendingRecentHex: string | null = null;
  let recentTimer: number | undefined;
  const renderRecents = (list?: string[]): void => {
    const items = list ?? loadRecents();
    recentsEl.innerHTML = items
      .map((h) => `<button type="button" class="cyl-cp-swatch" style="background:${h}" data-hex="${h}" aria-label="${h}"></button>`)
      .join("");
    recentsEl.querySelectorAll<HTMLButtonElement>(".cyl-cp-swatch").forEach((b) => {
      b.addEventListener("click", () => {
        const rgb = hexToRgb(b.dataset.hex ?? "");
        if (rgb) setColor(rgb);
      });
    });
  };
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

  // ---- palette ----
  paletteEl.innerHTML = PALETTE.map(
    (h) => `<button type="button" class="cyl-cp-swatch" style="background:${h}" data-hex="${h}" aria-label="${h}"></button>`,
  ).join("");
  paletteEl.querySelectorAll<HTMLButtonElement>(".cyl-cp-swatch").forEach((b) => {
    b.addEventListener("click", () => {
      const rgb = hexToRgb(b.dataset.hex ?? "");
      if (rgb) setColor(rgb);
    });
  });

  // ---- numeric fields per mode ----
  const renderFields = (): void => {
    const defs = FIELD_DEFS[state.mode];
    fieldsEl.innerHTML = defs
      .map(
        (d, i) =>
          `<label class="cyl-cp-fld"><span>${d.label}</span><input type="number" min="${d.min}" max="${d.max}" step="1" data-i="${i}" /></label>`,
      )
      .join("");
    fieldsEl.querySelectorAll<HTMLInputElement>("input[type=number]").forEach((input) => {
      const i = Number(input.dataset.i);
      input.addEventListener("input", () => {
        const n = parseFloat(input.value);
        if (Number.isNaN(n)) return;
        const vals = valuesForMode(state.mode, state.rgb);
        const def = FIELD_DEFS[state.mode][i];
        vals[i] = Math.max(def.min, Math.min(def.max, n));
        setColor(colorFromMode(state.mode, vals));
      });
      input.addEventListener("change", () => {
        if (Number.isNaN(parseFloat(input.value))) syncFields(); // revert invalid on blur/Enter
      });
    });
    syncFields();
  };

  const syncFields = (): void => {
    const vals = valuesForMode(state.mode, state.rgb);
    fieldsEl.querySelectorAll<HTMLInputElement>("input[type=number]").forEach((input) => {
      const s = String(Math.round(vals[Number(input.dataset.i)]));
      if (input.value !== s) input.value = s;
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.mode = (tab.dataset.mode as Mode) ?? "rgb";
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      renderFields();
    });
  });

  // ---- SV panel shape toggle (Adobe triangle <-> square) ----
  const syncSvThumb = (hsv: { h: number; s: number; v: number }): void => {
    if (state.shape === "tri") {
      // barycentric thumb: T(hue)=(0.5,0), L(black)=(0,1), R(white)=(1,1)
      svThumb.style.left = `${hsv.v * (1 - hsv.s / 200)}%`;
      svThumb.style.top = `${100 - (hsv.v * hsv.s) / 100}%`;
    } else {
      svThumb.style.left = `${hsv.s}%`;
      svThumb.style.top = `${100 - hsv.v}%`;
    }
  };
  const applyShape = (shape: SvShape): void => {
    state.shape = shape;
    svEl.classList.toggle("tri", shape === "tri");
    svEl.classList.toggle("sq", shape === "sq");
    svToggleBtns.forEach((b) => {
      const active = b.dataset.shape === shape;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    syncSvThumb(rgbToHsv(state.rgb));
  };
  svToggleBtns.forEach((b) => {
    b.addEventListener("click", () => applyShape((b.dataset.shape as SvShape) ?? "tri"));
  });

  // ---- main state update: syncs hex/preview/ring/SV/fields + fires onColor ----
  const setColor = (rgb: RGB, emit = true, trackRecent = true): void => {
    state.rgb = { r: clamp255(rgb.r), g: clamp255(rgb.g), b: clamp255(rgb.b) };
    const hex = rgbToHex(state.rgb);
    if (hexInput.value !== hex) hexInput.value = hex;
    preview.style.background = hex;
    const hsv = rgbToHsv(state.rgb);
    const rad = (hsv.h * Math.PI) / 180;
    ringThumb.style.left = `${RING_CX + RING_R * Math.cos(rad)}px`;
    ringThumb.style.top = `${RING_CY + RING_R * Math.sin(rad)}px`;
    svEl.style.background = `hsl(${hsv.h}, 100%, 50%)`;
    syncSvThumb(hsv);
    syncFields();
    if (emit) opts.onColor(state.rgb, hex);
    if (trackRecent) scheduleRecent(hex);
  };

  // ---- ring (hue) drag ----
  const applyRing = (e: PointerEvent): void => {
    const rect = ringEl.getBoundingClientRect();
    const dx = e.clientX - rect.left - RING_CX;
    const dy = e.clientY - rect.top - RING_CY;
    const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const hsv = rgbToHsv(state.rgb);
    setColor(hsvToRgb(h, hsv.s, hsv.v));
  };
  ringEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ringEl.setPointerCapture(e.pointerId);
    applyRing(e);
    const move = (ev: PointerEvent): void => applyRing(ev);
    const up = (ev: PointerEvent): void => {
      ringEl.releasePointerCapture(ev.pointerId);
      ringEl.removeEventListener("pointermove", move);
      ringEl.removeEventListener("pointerup", up);
    };
    ringEl.addEventListener("pointermove", move);
    ringEl.addEventListener("pointerup", up);
  });

  // ---- SV panel (Adobe triangle / square) drag ----
  const applySv = (e: PointerEvent): void => {
    const rect = svEl.getBoundingClientRect();
    const px = clamp01((e.clientX - rect.left) / rect.width);
    const py = clamp01((e.clientY - rect.top) / rect.height);
    const hsv = rgbToHsv(state.rgb);
    if (state.shape === "tri") {
      // barycentric weights vs vertices T(hue)=(0.5,0), L(black)=(0,1), R(white)=(1,1)
      const ax = 0.5;
      const ay = 0;
      const bx = 0;
      const by = 1;
      const cx = 1;
      const cy = 1;
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      let wA = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det; // hue weight
      let wB = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det; // black weight
      let wC = 1 - wA - wB; // white weight
      if (wA < 0 || wB < 0 || wC < 0) {
        // pointer outside the triangle: clamp weights onto the nearest edge/corner
        wA = Math.max(0, wA);
        wB = Math.max(0, wB);
        wC = Math.max(0, wC);
        const sum = wA + wB + wC;
        if (sum > 0) {
          wA /= sum;
          wB /= sum;
          wC /= sum;
        }
      }
      const v = wA + wC;
      const s = v > 0 ? wA / v : 0;
      setColor(hsvToRgb(hsv.h, s * 100, v * 100));
    } else {
      const s = px * 100;
      const v = (1 - py) * 100;
      setColor(hsvToRgb(hsv.h, s, v));
    }
  };
  svEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    svEl.setPointerCapture(e.pointerId);
    applySv(e);
    const move = (ev: PointerEvent): void => applySv(ev);
    const up = (ev: PointerEvent): void => {
      svEl.releasePointerCapture(ev.pointerId);
      svEl.removeEventListener("pointermove", move);
      svEl.removeEventListener("pointerup", up);
    };
    svEl.addEventListener("pointermove", move);
    svEl.addEventListener("pointerup", up);
  });

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

  // ---- close: ✕ / Esc / click outside ----
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  const onOutside = (e: PointerEvent): void => {
    if (!root.contains(e.target as Node)) close();
  };
  const close = (): void => {
    if (recentTimer !== undefined) window.clearTimeout(recentTimer);
    flushRecent();
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onOutside, true);
    root.remove();
    if (activePicker?.root === root) activePicker = null;
  };
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onOutside, true);

  // position (fixed): explicit anchor or top-right default
  if (opts.position) {
    root.style.left = `${opts.position.left}px`;
    root.style.top = `${opts.position.top}px`;
  }

  document.body.appendChild(root);
  activePicker = { root, close };

  // initial paint (no onColor / no recents write)
  setColor(state.rgb, false, false);
  renderRecents();
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
  };
}
