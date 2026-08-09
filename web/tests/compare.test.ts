import { describe, expect, it } from "vitest";
import { inputsEqual } from "../src/protocol/compare";
import type { InputPayload } from "../src/protocol/types";

const mk = (idx: number, pts: number[][]): InputPayload => ({
  index: idx,
  name: `in${idx}`,
  pointCount: pts.length,
  primCount: 1,
  points: pts,
  curves: [{ pointIndices: pts.map((_, i) => i), widths: null }],
  attributes: {},
});

describe("inputsEqual", () => {
  it("true for identical content regardless of order", () => {
    const a = [mk(0, [[0, 0, 0], [1, 0, 0]]), mk(1, [[2, 0, 0]])];
    expect(inputsEqual(a, [mk(1, [[2, 0, 0]]), mk(0, [[0, 0, 0], [1, 0, 0]])])).toBe(true);
  });
  it("false when points differ", () => {
    expect(inputsEqual([mk(0, [[0, 0, 0]])], [mk(0, [[1, 0, 0]])])).toBe(false);
  });
  it("false when count differs", () => {
    expect(inputsEqual([mk(0, [[0, 0, 0]])], [])).toBe(false);
  });
  it("false on missing index", () => {
    expect(inputsEqual([mk(0, [[0, 0, 0]])], [mk(1, [[0, 0, 0]])])).toBe(false);
  });
});