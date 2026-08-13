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

  it("true when curves and faces deep content matches (fast-deep-equal path)", () => {
    const a = mk(0, [[0, 0, 0], [1, 0, 0]]);
    a.curves = [{ pointIndices: [0, 1], widths: [1, 2] }];
    a.faces = [[0, 1, 2]];
    const b = mk(0, [[0, 0, 0], [1, 0, 0]]);
    b.curves = [{ pointIndices: [0, 1], widths: [1, 2] }];
    b.faces = [[0, 1, 2]];
    expect(inputsEqual([a], [b])).toBe(true);
  });

  it("false when curve widths differ", () => {
    const a = mk(0, [[0, 0, 0]]);
    a.curves = [{ pointIndices: [0], widths: [1] }];
    const b = mk(0, [[0, 0, 0]]);
    b.curves = [{ pointIndices: [0], widths: [2] }];
    expect(inputsEqual([a], [b])).toBe(false);
  });

  it("false when faces differ", () => {
    const a = mk(0, [[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    a.faces = [[0, 1, 2]];
    const b = mk(0, [[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    b.faces = [[0, 2, 1]];
    expect(inputsEqual([a], [b])).toBe(false);
  });

  it("true when faces are absent on both sides", () => {
    const a = mk(0, [[0, 0, 0]]);
    const b = mk(0, [[0, 0, 0]]);
    expect(inputsEqual([a], [b])).toBe(true);
  });
});