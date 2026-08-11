import { describe, expect, it } from "vitest";
import { MULTIPLIERS, format4, pickMultiplier, scrubValue } from "../src/app/scrub";

const rowsRect = { top: 0, bottom: 70 }; // 7 rows of 10px

describe("MULTIPLIERS", () => {
  it("has 7 rows from 100 down to 0.0001", () => {
    expect(MULTIPLIERS).toHaveLength(7);
    expect(MULTIPLIERS).toEqual([100, 10, 1, 0.1, 0.01, 0.001, 0.0001]);
  });
});

describe("pickMultiplier", () => {
  it("hits each of the 7 rows by Y position", () => {
    expect(pickMultiplier(rowsRect, 5)).toBe(100);
    expect(pickMultiplier(rowsRect, 15)).toBe(10);
    expect(pickMultiplier(rowsRect, 25)).toBe(1);
    expect(pickMultiplier(rowsRect, 35)).toBe(0.1);
    expect(pickMultiplier(rowsRect, 45)).toBe(0.01);
    expect(pickMultiplier(rowsRect, 55)).toBe(0.001);
    expect(pickMultiplier(rowsRect, 65)).toBe(0.0001);
  });
  it("switches at row boundaries", () => {
    expect(pickMultiplier(rowsRect, 10)).toBe(10);
    expect(pickMultiplier(rowsRect, 9.99)).toBe(100);
  });
  it("clamps outside the rows", () => {
    expect(pickMultiplier(rowsRect, -10)).toBe(100);
    expect(pickMultiplier(rowsRect, 999)).toBe(0.0001);
  });
  it("handles a degenerate rect", () => {
    expect(pickMultiplier({ top: 0, bottom: 0 }, 5)).toBe(100);
  });
});

describe("format4", () => {
  it("keeps at most 4 decimals", () => {
    expect(format4(12.3456)).toBe("12.3456");
    expect(format4(12.34567)).toBe("12.3457");
  });
  it("omits trailing zeros", () => {
    expect(format4(1.2)).toBe("1.2");
    expect(format4(0)).toBe("0");
    expect(format4(100)).toBe("100");
    expect(format4(-0.5)).toBe("-0.5");
  });
});

describe("scrubValue", () => {
  it("applies dx * multiplier to the value", () => {
    expect(scrubValue(1.2, 30, 0.001)).toBe(1.23);
    expect(scrubValue(0, 2, 10)).toBe(20);
    expect(scrubValue(5, -3, 0.1)).toBe(4.7);
  });
  it("combines with format4 for display", () => {
    expect(format4(scrubValue(1.2, 30, 0.001))).toBe("1.23");
  });
});
