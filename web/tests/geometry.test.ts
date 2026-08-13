import { describe, expect, it } from "vitest";
import { sameTopology } from "../src/viewport/geometry";
import type { OutputBuffer } from "../src/protocol/types";

/** Small OutputBuffer fixture; every call builds fresh points/curves/faces
 *  arrays so tests control reference identity explicitly. */
function makeBuffer(overrides: Partial<OutputBuffer> = {}): OutputBuffer {
  return {
    index: 0,
    rev: 1,
    pointCount: 4,
    primCount: 1,
    points: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    curves: [{ pointIndices: [0, 1, 2], widths: null }],
    faces: [[0, 1, 2, 3]],
    attributes: {},
    ...overrides,
  };
}

describe("sameTopology", () => {
  it("fast path: same references => true", () => {
    const a = makeBuffer();
    expect(sameTopology(a, a)).toBe(true);
  });

  it("fast path: param-only edit keeps base curves/faces references => true", () => {
    const base = makeBuffer();
    const edited = makeBuffer();
    // The hot drag case: the translate delta path reuses the base curves/faces
    // arrays and only swaps the points array (point VALUES are not topology).
    edited.pointCount = base.pointCount;
    edited.curves = base.curves;
    edited.faces = base.faces;
    edited.points = [
      [9, 9, 9],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    expect(sameTopology(base, edited)).toBe(true);
  });

  it("deep fallback: different references, same content => true", () => {
    const a = makeBuffer();
    const b = makeBuffer();
    expect(a.curves).not.toBe(b.curves);
    expect(a.faces).not.toBe(b.faces);
    expect(sameTopology(a, b)).toBe(true);
  });

  it("different pointCount => false", () => {
    expect(sameTopology(makeBuffer(), makeBuffer({ pointCount: 5 }))).toBe(false);
  });

  it("different curve structure => false", () => {
    const a = makeBuffer();
    const b = makeBuffer({ curves: [{ pointIndices: [0, 1], widths: null }] });
    expect(sameTopology(a, b)).toBe(false);
  });

  it("different face structure => false", () => {
    expect(sameTopology(makeBuffer(), makeBuffer({ faces: [[0, 1, 2]] }))).toBe(false);
  });
});