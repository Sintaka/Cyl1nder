/**
 * Pure color math (zero DOM / browser deps): RGB triplet + hex / HSL / HSV
 * conversions and channel clamps. Extracted from color.ts (round 1.1) so the
 * math is unit-testable without a browser. color.ts re-exports the shared API
 * (rgbToHex / hexToRgb / ... / RGB) to keep external consumers unchanged.
 */

export interface RGB {
  /** red channel 0..255 */
  r: number;
  /** green channel 0..255 */
  g: number;
  /** blue channel 0..255 */
  b: number;
}

export const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
/** Clamp a 0..100 percentage value (harmony sat/light multipliers are 0..1). */
export const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));
export const norm360 = (h: number): number => ((h % 360) + 360) % 360;

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

export function rgbToHsl(rgb: RGB): { h: number; s: number; l: number } {
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

export function hslToRgb(h: number, s: number, l: number): RGB {
  const hn = norm360(h) / 360;
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

export function rgbToHsv(rgb: RGB): { h: number; s: number; v: number } {
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

export function hsvToRgb(h: number, s: number, v: number): RGB {
  const hn = norm360(h) / 60;
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