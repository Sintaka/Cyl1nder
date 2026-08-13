/** Adobe harmony definitions (3.2 split): preset points + point-color math. Pure. */
import { clamp100, hslToRgb, type RGB } from "./color-math";

export interface HslBase {
  h: number;
  s: number;
  l: number;
}

export type HarmonyId = "monochrome" | "complementary" | "analogous" | "triadic" | "compound" | "shades";

interface HarmonyPoint {
  hue: number;
  sat: number;
  light: number;
}

interface HarmonyDef {
  id: HarmonyId;
  label: string;
  points: HarmonyPoint[];
}

export const HARMONIES: HarmonyDef[] = [
  {
    id: "monochrome",
    label: "Monochrome",
    points: [
      { hue: 0, sat: 1, light: 1 },
      { hue: 0, sat: 0.75, light: 1 },
      { hue: 0, sat: 1, light: 1.25 },
      { hue: 0, sat: 1.25, light: 1 },
      { hue: 0, sat: 0.6, light: 0.8 },
    ],
  },
  {
    id: "complementary",
    label: "Complementary",
    points: [
      { hue: 0, sat: 1, light: 1 },
      { hue: 180, sat: 1, light: 1 },
      { hue: 0, sat: 1, light: 0.8 },
      { hue: 180, sat: 1, light: 1.2 },
      { hue: 180, sat: 0.75, light: 1 },
    ],
  },
  {
    id: "analogous",
    label: "Analogous",
    points: [
      { hue: 0, sat: 1, light: 1 },
      { hue: -30, sat: 1, light: 1 },
      { hue: 30, sat: 1, light: 1 },
      { hue: -15, sat: 0.9, light: 0.85 },
      { hue: 15, sat: 0.9, light: 1.15 },
    ],
  },
  {
    id: "triadic",
    label: "Triadic",
    points: [
      { hue: 0, sat: 1, light: 1 },
      { hue: 120, sat: 1, light: 1 },
      { hue: 240, sat: 1, light: 1 },
      { hue: 120, sat: 0.85, light: 0.8 },
      { hue: 240, sat: 0.85, light: 1.2 },
    ],
  },
  {
    id: "compound",
    label: "Compound",
    points: [
      { hue: 0, sat: 1, light: 1 },
      { hue: 150, sat: 1, light: 1 },
      { hue: 210, sat: 1, light: 1 },
      { hue: 150, sat: 0.85, light: 0.8 },
      { hue: 210, sat: 0.85, light: 1.2 },
    ],
  },
  {
    id: "shades",
    label: "Shades",
    points: [
      { hue: 0, sat: 1, light: 1 },
      { hue: 0, sat: 1, light: 0.8 },
      { hue: 0, sat: 1, light: 0.6 },
      { hue: 0, sat: 1, light: 0.4 },
      { hue: 0, sat: 1, light: 0.2 },
    ],
  },
];

export function harmonyDef(id: HarmonyId): HarmonyDef {
  return HARMONIES.find((d) => d.id === id) ?? HARMONIES[0];
}

export function harmonyColor(base: HslBase, def: HarmonyDef, i: number): RGB {
  const p = def.points[i] ?? def.points[0];
  return hslToRgb(
    base.h + p.hue,
    clamp100(base.s * p.sat),
    clamp100(base.l * p.light),
  );
}