import { describe, expect, it } from "vitest";
import {
  DEFAULT_MULTIPLIER,
  MULTIPLIERS,
  SCRUB_SENSITIVITY,
  accumulatedScrub,
  createScrubState,
  format4,
  isScrubOutOfBounds,
  pickMultiplier,
  scrubPointerMove,
  scrubPopupTop,
  scrubValue,
} from "../src/app/scrub";

const rowsRect = { top: 0, bottom: 70 }; // 7 rows of 10px
const bounds = { left: 0, right: 80 }; // popup horizontal box

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

describe("defaults (initial multiplier / sensitivity)", () => {
  it("starts at the middle row 0.1 with halved sensitivity", () => {
    expect(DEFAULT_MULTIPLIER).toBe(0.1);
    expect(SCRUB_SENSITIVITY).toBe(0.5);
  });
});

describe("accumulatedScrub (灵敏度减半)", () => {
  it("applies totalDx * multiplier * 0.5", () => {
    expect(accumulatedScrub(1.2, 30, 0.001)).toBeCloseTo(1.215); // 1.2 + 30*0.001*0.5
    expect(accumulatedScrub(0, 20, 0.1)).toBe(1); // 20*0.1*0.5
    expect(accumulatedScrub(0, -20, 1)).toBe(-10);
  });
  it("sensitivity is overridable", () => {
    expect(accumulatedScrub(0, 20, 0.1, 1)).toBe(2);
    expect(accumulatedScrub(0, 20, 0.1, 0.25)).toBe(0.5);
  });
});

describe("scrubPopupTop (浮层中点=鼠标)", () => {
  it("centers the rows strip on the cursor -> middle row 0.1 under the mouse", () => {
    // popup 150px tall, rows strip 4..74 (70px = 7 rows of 10px)
    const top = scrubPopupTop(300, 150, 4, 70, 800);
    expect(top).toBe(300 - (4 + 35)); // 261
    const centeredRows = { top: top + 4, bottom: top + 4 + 70 };
    expect(pickMultiplier(centeredRows, 300)).toBe(0.1);
  });
  it("clamps to keep the popup inside the viewport", () => {
    expect(scrubPopupTop(0, 150, 4, 70, 800)).toBe(4);
    expect(scrubPopupTop(900, 150, 4, 70, 800)).toBe(800 - 150 - 4);
  });
});

describe("isScrubOutOfBounds (出框判定)", () => {
  it("detects crossing the left/right edge", () => {
    expect(isScrubOutOfBounds(0, 80, 40)).toBe(false);
    expect(isScrubOutOfBounds(0, 80, 0)).toBe(false);
    expect(isScrubOutOfBounds(0, 80, 80)).toBe(false);
    expect(isScrubOutOfBounds(0, 80, -1)).toBe(true);
    expect(isScrubOutOfBounds(0, 80, 81)).toBe(true);
  });
});

describe("scrubPointerMove (手势状态机)", () => {
  it("框内上下拖动只切换倍率, 不更改数据", () => {
    let s = createScrubState(1.2);
    expect(s.multiplier).toBe(0.1);
    expect(s.value).toBe(1.2);
    s = scrubPointerMove(s, bounds, rowsRect, 40, 5);
    expect(s.locked).toBe(false);
    expect(s.multiplier).toBe(100);
    expect(s.value).toBe(1.2); // 数据未更改
    s = scrubPointerMove(s, bounds, rowsRect, 60, 65);
    expect(s.multiplier).toBe(0.0001);
    expect(s.value).toBe(1.2);
  });
  it("出框后锁定倍率, 上下拖动不再切换", () => {
    let s = scrubPointerMove(createScrubState(0), bounds, rowsRect, 40, 35);
    expect(s.locked).toBe(false);
    expect(s.multiplier).toBe(0.1);
    s = scrubPointerMove(s, bounds, rowsRect, 90, 35); // 出框 -> 锁定
    expect(s.locked).toBe(true);
    expect(s.exitX).toBe(90);
    expect(s.value).toBe(0); // 锁定瞬间数值不变
    const afterY = scrubPointerMove(s, bounds, rowsRect, 95, 5);
    expect(afterY.locked).toBe(true);
    expect(afterY.multiplier).toBe(s.multiplier); // 上下不再切倍率
  });
  it("锁定后数值 = 起始值 + (x-exitX)*倍率*0.5 (归一化累计)", () => {
    let s = createScrubState(10);
    s = scrubPointerMove(s, bounds, rowsRect, 90, 35); // exitX=90
    s = scrubPointerMove(s, bounds, rowsRect, 110, 40); // dx=20, m=0.1 -> +1
    expect(s.value).toBe(11);
    // 归一化: 以出框点为基准, 回到出框点即回到起始值 (非逐事件增量)
    s = scrubPointerMove(s, bounds, rowsRect, 90, 50);
    expect(s.value).toBe(10);
  });
  it("出框前选中的倍率被锁定使用", () => {
    let s = createScrubState(0);
    s = scrubPointerMove(s, bounds, rowsRect, 40, 5); // 框内切到 100
    expect(s.multiplier).toBe(100);
    s = scrubPointerMove(s, bounds, rowsRect, 90, 5); // 出框锁定 100
    expect(s.locked).toBe(true);
    expect(s.multiplier).toBe(100);
    s = scrubPointerMove(s, bounds, rowsRect, 100, 30); // dx=10 * 100 * 0.5 = 500
    expect(s.value).toBe(500);
  });
});