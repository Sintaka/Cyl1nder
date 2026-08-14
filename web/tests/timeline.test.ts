import { afterEach, describe, expect, it, vi } from "vitest";
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
    onFrameCommit: vi.fn(),
  };
}

describe("TimelineController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("setFps validates (>0 finite) and emits on change", () => {
    const c = createTimelineController(makeDeps());
    const fn = vi.fn();
    c.subscribe(fn);
    c.setFps(60);
    expect(c.fps).toBe(60);
    expect(fn).toHaveBeenCalledTimes(1);
    c.setFps(0);
    c.setFps(-5);
    c.setFps(NaN);
    expect(c.fps).toBe(60);
    expect(fn).toHaveBeenCalledTimes(1);
    c.setFps(60); // no change -> no emit
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("linkEnabled defaults false and setter emits", () => {
    const c = createTimelineController(makeDeps());
    expect(c.linkEnabled).toBe(false);
    const fn = vi.fn();
    c.subscribe(fn);
    c.setLinkEnabled(true);
    expect(c.linkEnabled).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    c.setLinkEnabled(true); // no change -> no emit
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("applyRemote is a no-op when not linked", () => {
    const deps = makeDeps();
    const c = createTimelineController(deps);
    c.applyRemote(50, 24);
    expect(c.frame).toBe(1);
    expect(deps.setFrame).not.toHaveBeenCalled();
  });

  it("applyRemote applies frame/fps and replays snapshot when linked", () => {
    const deps = makeDeps(4);
    const c = createTimelineController(deps);
    const snap = [inp(1)];
    c.captureFrame(7, snap);
    c.setLinkEnabled(true);
    c.applyRemote(7, 24);
    expect(c.frame).toBe(7);
    expect(c.fps).toBe(24);
    expect(deps.setFrame).toHaveBeenCalledWith(7);
    expect(deps.setInputs).toHaveBeenCalledWith(snap, 5);
    expect(deps.scheduleNetwork).toHaveBeenCalledTimes(1);
  });

  it("applyRemote miss does not clear inputs and does not commit", () => {
    const deps = makeDeps(3);
    const c = createTimelineController(deps);
    c.setLinkEnabled(true);
    c.applyRemote(9, 30);
    expect(c.frame).toBe(9);
    expect(deps.setFrame).toHaveBeenCalledWith(9);
    expect(deps.setInputs).not.toHaveBeenCalled();
    expect(deps.scheduleNetwork).not.toHaveBeenCalled();
    expect(deps.onFrameCommit).not.toHaveBeenCalled();
  });

  it("applyRemote is suppressed while dragging", () => {
    const deps = makeDeps();
    const c = createTimelineController(deps);
    c.setLinkEnabled(true);
    c.setDragging(true);
    c.applyRemote(20, 24);
    expect(c.frame).toBe(1);
    expect(deps.setFrame).not.toHaveBeenCalled();
  });

  it("onFrameCommit fires only when linked, throttled to syncFps, not suppressed by dragging", () => {
    const deps = makeDeps();
    const c = createTimelineController(deps);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    c.setFrame(5); // not linked -> no commit
    expect(deps.onFrameCommit).not.toHaveBeenCalled();

    c.setLinkEnabled(true);
    c.setFrame(6); // first commit always fires (lastCommit = -Infinity)
    expect(deps.onFrameCommit).toHaveBeenCalledTimes(1);
    expect(deps.onFrameCommit).toHaveBeenLastCalledWith(6);

    c.setFrame(7); // within throttle window (0 < 1000/30 ≈ 33.33ms) -> no commit
    expect(deps.onFrameCommit).toHaveBeenCalledTimes(1);

    c.setDragging(true);
    c.setFrame(8); // dragging no longer suppresses, but still inside window -> throttled
    expect(deps.onFrameCommit).toHaveBeenCalledTimes(1);
    c.setDragging(false);

    now = 40; // advance past the 30fps throttle window
    c.setFrame(9);
    expect(deps.onFrameCommit).toHaveBeenCalledTimes(2);
    expect(deps.onFrameCommit).toHaveBeenLastCalledWith(9);

    now = 80;
    c.step(1); // 9 -> 10; step path also commits when past window
    expect(deps.onFrameCommit).toHaveBeenCalledTimes(3);
    expect(deps.onFrameCommit).toHaveBeenLastCalledWith(10);

    // dragging does NOT suppress commit: past window during drag still commits.
    now = 120;
    c.setDragging(true);
    c.step(1); // 10 -> 11
    expect(deps.onFrameCommit).toHaveBeenCalledTimes(4);
    expect(deps.onFrameCommit).toHaveBeenLastCalledWith(11);
    c.setDragging(false);
  });

  it("setSyncFps clamps to [1,60] and ignores non-finite", () => {
    const c = createTimelineController(makeDeps());
    expect(c.syncFps).toBe(30);
    c.setSyncFps(60);
    expect(c.syncFps).toBe(60);
    c.setSyncFps(1000);
    expect(c.syncFps).toBe(60);
    c.setSyncFps(0);
    expect(c.syncFps).toBe(1);
    c.setSyncFps(-5);
    expect(c.syncFps).toBe(1);
    c.setSyncFps(NaN); // ignored -> stays 1
    expect(c.syncFps).toBe(1);
    c.setSyncFps(Infinity); // ignored -> stays 1
    expect(c.syncFps).toBe(1);
  });

  it("setSyncFps adjusts the commit throttle window", () => {
    const deps = makeDeps();
    const c = createTimelineController(deps);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    c.setLinkEnabled(true);
    c.setSyncFps(60); // throttle = ~16.67ms
    c.setFrame(1);
    expect(deps.onFrameCommit).toHaveBeenCalledTimes(1);

    now = 10; // < 16.67ms -> throttled
    c.setFrame(2);
    expect(deps.onFrameCommit).toHaveBeenCalledTimes(1);

    now = 20; // >= 16.67ms -> commit
    c.setFrame(3);
    expect(deps.onFrameCommit).toHaveBeenCalledTimes(2);
  });

  it("applyRemote ignores non-finite frame", () => {
    const deps = makeDeps();
    const c = createTimelineController(deps);
    c.setLinkEnabled(true);
    c.applyRemote(NaN, 24);
    expect(c.frame).toBe(1);
    expect(deps.setFrame).not.toHaveBeenCalled();
    c.applyRemote(Infinity, 24);
    expect(c.frame).toBe(1);
    expect(deps.setFrame).not.toHaveBeenCalled();
    // a finite frame still applies
    c.applyRemote(12, 24);
    expect(c.frame).toBe(12);
    expect(deps.setFrame).toHaveBeenCalledWith(12);
  });
});