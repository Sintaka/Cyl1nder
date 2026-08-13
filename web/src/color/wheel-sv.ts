/**
 * Color wheel + SV panel domain (3.2 split): thumb positioning + drag math.
 * The picker shell owns `state` and passes it by reference via deps; the
 * wheel/SV drag handlers commit through `deps.setColor` / `deps.pickHarmony`.
 */
import { clamp01, hslToRgb, hsvToRgb, norm360, rgbToHsl, rgbToHsv, type RGB } from "./color-math";
import { harmonyDef, type HarmonyId, type HslBase } from "./harmony";

export type SvShape = "tri" | "sq";

export const WHEEL_SIZE = 132;
export const WHEEL_CX = WHEEL_SIZE / 2;
export const WHEEL_CY = WHEEL_SIZE / 2;
export const WHEEL_R = 58;

export interface SetColorOptions {
  emit?: boolean;
  trackRecent?: boolean;
  keepBase?: boolean;
  preserveHsl?: boolean;
}

export interface WheelSvState {
  rgb: RGB;
  shape: SvShape;
  advanced: boolean;
  harmony: HarmonyId;
  base: HslBase;
}

export interface WheelSvDeps {
  state: WheelSvState;
  root: HTMLElement;
  wheelEl: HTMLElement;
  wheelThumb: HTMLElement;
  svEl: HTMLElement;
  svThumb: HTMLElement;
  svToggleBtns: HTMLButtonElement[];
  setColor(rgb: RGB, o?: SetColorOptions): void;
  pickHarmony(i: number): void;
  pushUndo(): void;
}

export interface WheelSv {
  syncWheel(): void;
  syncSvThumb(hsv: { h: number; s: number; v: number }): void;
  applyShape(shape: SvShape): void;
  wire(): void;
}

export function createWheelSv(deps: WheelSvDeps): WheelSv {
  // ---- SV panel thumb positioning (Adobe triangle / square, same size) ----
  const syncSvThumb = (hsv: { h: number; s: number; v: number }): void => {
    if (deps.state.shape === "tri") {
      // barycentric thumb: T(hue)=(0.5,0), L(black)=(0,1), R(white)=(1,1)
      deps.svThumb.style.left = `${hsv.v * (1 - hsv.s / 200)}%`;
      deps.svThumb.style.top = `${100 - (hsv.v * hsv.s) / 100}%`;
    } else {
      deps.svThumb.style.left = `${hsv.s}%`;
      deps.svThumb.style.top = `${100 - hsv.v}%`;
    }
  };
  const applyShape = (shape: SvShape): void => {
    deps.state.shape = shape;
    deps.svEl.classList.toggle("tri", shape === "tri");
    deps.svEl.classList.toggle("sq", shape === "sq");
    deps.svToggleBtns.forEach((b) => {
      const active = b.dataset.shape === shape;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    syncSvThumb(rgbToHsv(deps.state.rgb));
  };

  // ---- wheel (P2 full disc: angle = hue, radius = saturation) ----
  const syncWheel = (): void => {
    const { h, s } = rgbToHsl(deps.state.rgb);
    const rad = (h * Math.PI) / 180;
    const r = (s / 100) * WHEEL_R;
    deps.wheelThumb.style.left = `${WHEEL_CX + r * Math.sin(rad)}px`;
    deps.wheelThumb.style.top = `${WHEEL_CY - r * Math.cos(rad)}px`;
  };

  const applyWheel = (e: PointerEvent, pointIndex: number): void => {
    const rect = deps.wheelEl.getBoundingClientRect();
    const dx = e.clientX - rect.left - WHEEL_CX;
    const dy = e.clientY - rect.top - WHEEL_CY;
    const h = norm360((Math.atan2(dx, -dy) * 180) / Math.PI);
    const radius = clamp01(Math.sqrt(dx * dx + dy * dy) / WHEEL_R);
    if (deps.state.advanced) {
      if (pointIndex >= 0) {
        // dragging a linked point rotates/scales the whole group (offsets kept)
        const def = harmonyDef(deps.state.harmony);
        const p = def.points[pointIndex] ?? def.points[0];
        deps.state.base.h = norm360(h - p.hue);
        deps.state.base.s = clamp01(radius / Math.max(0.05, p.sat)) * 100;
      } else {
        // dragging the wheel background moves the base point (hue + saturation)
        deps.state.base.h = h;
        deps.state.base.s = radius * 100;
      }
      deps.setColor(hslToRgb(deps.state.base.h, deps.state.base.s, deps.state.base.l), { keepBase: true });
    } else {
      const hsl = rgbToHsl(deps.state.rgb);
      deps.setColor(hslToRgb(h, radius * 100, hsl.l));
    }
  };

  const startWheelDrag = (e: PointerEvent, pointIndex: number): void => {
    deps.pushUndo();
    e.preventDefault();
    e.stopPropagation();
    // Document-level listeners (like the header drag): the harmony point
    // markers are re-created on every setColor, so pointer capture on the
    // marker would be released mid-drag; a document listener survives that.
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    applyWheel(e, pointIndex);
    const move = (ev: PointerEvent): void => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) moved = true;
      applyWheel(ev, pointIndex);
    };
    const up = (): void => {
      deps.root.ownerDocument.removeEventListener("pointermove", move);
      deps.root.ownerDocument.removeEventListener("pointerup", up);
      deps.root.ownerDocument.removeEventListener("pointercancel", up);
      // a click (no drag) on a harmony point picks that color
      if (!moved && deps.state.advanced && pointIndex >= 0) deps.pickHarmony(pointIndex);
    };
    deps.root.ownerDocument.addEventListener("pointermove", move);
    deps.root.ownerDocument.addEventListener("pointerup", up);
    deps.root.ownerDocument.addEventListener("pointercancel", up);
  };

  // ---- SV panel (Adobe triangle / square) drag ----
  const applySv = (e: PointerEvent): void => {
    const rect = deps.svEl.getBoundingClientRect();
    const px = clamp01((e.clientX - rect.left) / rect.width);
    const py = clamp01((e.clientY - rect.top) / rect.height);
    const hsv = rgbToHsv(deps.state.rgb);
    if (deps.state.shape === "tri") {
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
      deps.setColor(hsvToRgb(hsv.h, s * 100, v * 100));
    } else {
      const s = px * 100;
      const v = (1 - py) * 100;
      deps.setColor(hsvToRgb(hsv.h, s, v));
    }
  };

  const wire = (): void => {
    deps.svToggleBtns.forEach((b) => b.addEventListener("click", () => applyShape((b.dataset.shape as SvShape) ?? "tri")));
    deps.wheelEl.addEventListener("pointerdown", (e) => {
      const pt = (e.target as HTMLElement).closest<HTMLElement>("[data-harmony-i]");
      startWheelDrag(e, pt ? Number(pt.dataset.harmonyI) : -1);
    });
    deps.svEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      deps.svEl.setPointerCapture(e.pointerId);
      deps.pushUndo();
      applySv(e);
      const move = (ev: PointerEvent): void => applySv(ev);
      const up = (ev: PointerEvent): void => {
        deps.svEl.releasePointerCapture(ev.pointerId);
        deps.svEl.removeEventListener("pointermove", move);
        deps.svEl.removeEventListener("pointerup", up);
      };
      deps.svEl.addEventListener("pointermove", move);
      deps.svEl.addEventListener("pointerup", up);
    });
  };

  return { syncWheel, syncSvThumb, applyShape, wire };
}
