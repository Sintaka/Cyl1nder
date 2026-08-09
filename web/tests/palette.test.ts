import { describe, expect, it } from "vitest";
import { searchPalette } from "../src/nodes/palette";

describe("palette fuzzy search (Fuse.js)", () => {
  it("returns the full palette for an empty query", () => {
    expect(searchPalette("")).toHaveLength(3);
  });

  it("finds null by label", () => {
    const r = searchPalette("null");
    expect(r.some((e) => e.label === "null")).toBe(true);
  });

  it("finds output by fuzzy/desc match", () => {
    const r = searchPalette("output");
    expect(r.some((e) => e.label === "output_")).toBe(true);
  });

  it("finds input via Chinese keyword", () => {
    const r = searchPalette("输入");
    expect(r.some((e) => e.label === "input_")).toBe(true);
  });

  it("does not return junk for gibberish", () => {
    expect(searchPalette("zzzzqqq").length).toBe(0);
  });
});
