import { describe, expect, it } from "vitest";
import { SERIAL_RE, type InputPayload } from "../src/protocol/types";
import {
  applyTranslateToCurve,
  inputToOutput,
  translatePoint,
  translatePoints,
} from "../src/tools/transform";

describe("serial format", () => {
  it("matches C1-<base36ms>-<4rand>", () => {
    expect(SERIAL_RE.test("C1-mslxitpq-5beo")).toBe(true);
    expect(SERIAL_RE.test("C1-mslxitpq-5beoX")).toBe(false);
    expect(SERIAL_RE.test("nope")).toBe(false);
    expect(SERIAL_RE.test("")).toBe(false);
  });
});

describe("transform tool math", () => {
  it("translates a point", () => {
    expect(translatePoint([1, 2, 3], 1, -1, 0)).toEqual([2, 1, 3]);
  });

  it("translates all points", () => {
    expect(translatePoints([[0, 0, 0], [1, 1, 1]], 1, 0, 0)).toEqual([
      [1, 0, 0],
      [2, 1, 1],
    ]);
  });

  it("translates only one curve's points, leaving shared points", () => {
    const input: InputPayload = {
      index: 0,
      name: "in0",
      pointCount: 4,
      primCount: 2,
      points: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ],
      curves: [{ pointIndices: [0, 1], widths: null }],
      attributes: {},
    };
    const out = applyTranslateToCurve(input, 0, 0, 2, 0);
    expect(out[0]).toEqual([0, 2, 0]);
    expect(out[1]).toEqual([1, 2, 0]);
    expect(out[2]).toEqual([0, 1, 0]); // untouched
    expect(out[3]).toEqual([1, 1, 0]); // untouched
  });

  it("wraps an output buffer", () => {
    const input: InputPayload = {
      index: 0,
      name: "in0",
      pointCount: 2,
      primCount: 1,
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      curves: [{ pointIndices: [0, 1], widths: null }],
      attributes: {},
    };
    const buf = inputToOutput(0, input, [
      [5, 0, 0],
      [6, 0, 0],
    ]);
    expect(buf.index).toBe(0);
    expect(buf.points).toEqual([
      [5, 0, 0],
      [6, 0, 0],
    ]);
    expect(buf.curves).toBe(input.curves);
    expect(buf.pointCount).toBe(2);
  });
});