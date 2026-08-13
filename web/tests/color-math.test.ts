import { describe, expect, it } from "vitest";
import {
  clamp01,
  clamp100,
  clamp255,
  hexToRgb,
  hslToRgb,
  hsvToRgb,
  norm360,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  type RGB,
} from "../src/color/color-math";

const RGB_CASES: [RGB][] = [
  [{ r: 255, g: 0, b: 0 }], // red
  [{ r: 0, g: 255, b: 0 }], // green
  [{ r: 0, g: 0, b: 255 }], // blue
  [{ r: 255, g: 255, b: 255 }], // white
  [{ r: 0, g: 0, b: 0 }], // black
  [{ r: 128, g: 128, b: 128 }], // gray
];

describe("rgbToHex", () => {
  it("emits uppercase #RRGGBB with rounded + clamped channels", () => {
    expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe("#FF8000");
    // clamps: 300 -> 255, -5 -> 0, 12.6 -> round 13
    expect(rgbToHex({ r: 300, g: -5, b: 12.6 })).toBe("#FF000D");
    expect(rgbToHex({ r: 12.4, g: 170, b: 204 })).toBe("#0CAACC");
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#FFFFFF");
  });
});

describe("hexToRgb", () => {
  it("parses #rrggbb (case-insensitive, whitespace tolerated)", () => {
    expect(hexToRgb("#AABBCC")).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb("#aabbcc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb(" #FF8000 ")).toEqual({ r: 255, g: 128, b: 0 });
  });

  it("parses the #rgb short form", () => {
    expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb("#f80")).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb("#000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("returns null for invalid input", () => {
    expect(hexToRgb("nope")).toBeNull();
    expect(hexToRgb("#12345")).toBeNull();
    expect(hexToRgb("123456")).toBeNull();
    expect(hexToRgb("")).toBeNull();
  });
});

describe("RGB <-> HSL round-trip", () => {
  it.each(RGB_CASES)("hslToRgb(rgbToHsl(%j)) is within 1 per channel", (rgb) => {
    const { h, s, l } = rgbToHsl(rgb);
    const back = hslToRgb(h, s, l);
    expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1);
  });
});

describe("RGB <-> HSV round-trip", () => {
  it.each(RGB_CASES)("hsvToRgb(rgbToHsv(%j)) is within 1 per channel", (rgb) => {
    const { h, s, v } = rgbToHsv(rgb);
    const back = hsvToRgb(h, s, v);
    expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1);
  });
});

describe("norm360", () => {
  it("normalizes negatives and out-of-range angles into [0, 360)", () => {
    expect(norm360(0)).toBe(0);
    expect(norm360(360)).toBe(0);
    expect(norm360(720)).toBe(0);
    expect(norm360(-360)).toBe(0);
    expect(norm360(370)).toBe(10);
    expect(norm360(-30)).toBe(330);
    expect(norm360(-720)).toBe(0);
  });
});

describe("clamp255", () => {
  it("clamps to 0..255 and rounds", () => {
    expect(clamp255(-1)).toBe(0);
    expect(clamp255(0)).toBe(0);
    expect(clamp255(255)).toBe(255);
    expect(clamp255(256)).toBe(255);
    expect(clamp255(12.4)).toBe(12);
    expect(clamp255(12.6)).toBe(13);
  });
});

describe("clamp01 / clamp100", () => {
  it("clamp to their own ranges", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp100(-10)).toBe(0);
    expect(clamp100(50)).toBe(50);
    expect(clamp100(150)).toBe(100);
  });
});
