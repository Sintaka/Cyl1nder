import { describe, expect, it, vi } from "vitest";
import type { InputPayload } from "../src/protocol/types";
import { createTimelineController, type TimelineDeps } from "../src/core/timeline";

const inp = (index: number): InputPayload => ({
  index,
  name: `in${index}`,
  pointCount: 1,
  primCount: 1,
  points: [[0, 0, 0]],
  curves: [],
  attributes: {},
});

function makeDeps(inputRev = 5): TimelineDeps {
  return {
    getInputs: vi.fn(() => [] as InputPayload[]),
    getInputRev: vi.fn(() => inputRev),
    setInputs: vi.fn(),
    setFrame: vi.fn(),
    scheduleNetwork: vi.fn(),
    log: vi.fn(),
  };
}

describe("TimelineController", () => {
  it("has default range and fps", () => {
    const c = createTimelineController(makeDeps());
    expect(c.frame).toBe(1);
    expect(c.min).toBe(1);
    expect(c.max).toBe(100);
    expect(c.fps).toBe(30);
    expect(c.hasFrame(1)).toBe(false);
  });

  it("captureFrame stores snapshots and extends min/max", () => {
    const c = createTimelineController(makeDeps());
    const a = [inp(0)];
    const b = [inp(1)];
    c.captureFrame(3, a);
    expect(c.min).toBe(1);
    expect(c.max).toBe(100);
    expect(c.hasFrame(3)).toBe(true);
    c.captureFrame(150, b);
    expect(c.max).toBe(150);
    c.captureFrame(-2, [inp(2)]);
    expect(c.min).toBe(-2);
    expect(c.max).toBe(150);
  });

  it("setFrame hit replays collected inputs with rev+1 and schedules network", () => {
    const deps = makeDeps(4);
    const c = createTimelineController(deps);
    const snap = [inp(1)];
    c.captureFrame(7, snap);
    c.setFrame(7);
    expect(deps.setFrame).toHaveBeenCalledWith(7);
    expect(deps.setInputs).toHaveBeenCalledWith(snap, 5);
    expect(deps.scheduleNetwork).toHaveBeenCalledTimes(1);
    expect(deps.log).not.toHaveBeenCalled();
  });

  it("setFrame miss clears inputs with rev+1 and logs a hint", () => {
    const deps = makeDeps(2);
    const c = createTimelineController(deps);
    c.setFrame(9);
    expect(deps.setInputs).toHaveBeenCalledWith([], 3);
    expect(deps.scheduleNetwork).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith("timeline 帧 9 未收集（无本地帧输入）");
  });

  it("step clamps to [min,max] without extending it", () => {
    const c = createTimelineController(makeDeps());
    c.captureFrame(-5, [inp(0)]);
    c.captureFrame(110, [inp(1)]);
    c.step(-1000);
    expect(c.frame).toBe(-5);
    expect(c.min).toBe(-5);
    expect(c.max).toBe(110);
    c.step(1000);
    expect(c.frame).toBe(110);
    expect(c.min).toBe(-5);
    expect(c.max).toBe(110);
  });

  it("reset clears snapshots and restores default range", () => {
    const c = createTimelineController(makeDeps());
    c.captureFrame(7, [inp(0)]);
    c.setFrame(7);
    c.reset();
    expect(c.frame).toBe(1);
    expect(c.min).toBe(1);
    expect(c.max).toBe(100);
    expect(c.hasFrame(7)).toBe(false);
  });

  it("subscribe fires on captureFrame and setFrame", () => {
    const c = createTimelineController(makeDeps());
    const fn = vi.fn();
    c.subscribe(fn);
    c.captureFrame(3, [inp(0)]);
    expect(fn).toHaveBeenCalledTimes(1);
    c.setFrame(3);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});