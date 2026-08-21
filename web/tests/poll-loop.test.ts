import { describe, expect, it, vi } from "vitest";
import { createPollLoop, type PollLoopDeps } from "../src/core/poll-loop";

// ---- 假计时器（无 DOM / 无 vi.useFakeTimers）：手动记录 pending 回调、手动触发 ----
// 这样重排 vs 回调执行的先后顺序才能被精确断言（这正是这个 bug 的关键）。

interface FakeTimer {
  scheduleCount: number;
  pending: (() => void) | null;
  setTimer: PollLoopDeps["setTimer"];
  clearTimer: PollLoopDeps["clearTimer"];
  /** 触发当前 pending 的回调（模拟真实计时器到点）。 */
  fire(): void;
}

function makeFakeTimer(): FakeTimer {
  let nextId = 1;
  const timer: FakeTimer = {
    scheduleCount: 0,
    pending: null,
    setTimer: (fn) => {
      timer.scheduleCount += 1;
      timer.pending = fn;
      return nextId++;
    },
    clearTimer: () => {
      timer.pending = null;
    },
    fire: () => {
      const fn = timer.pending;
      timer.pending = null;
      fn?.();
    },
  };
  return timer;
}

describe("createPollLoop（自愈轮询：重新武装先于 onTick）", () => {
  it("核心回归：onTick 每次都抛异常 → 触发后仍是武装状态，再触发仍会调 onTick", () => {
    const timer = makeFakeTimer();
    const onTick = vi.fn(() => {
      throw new Error("boom");
    });
    const loop = createPollLoop({ intervalMs: 1000, onTick, setTimer: timer.setTimer, clearTimer: timer.clearTimer });
    loop.arm();

    timer.fire();
    expect(loop.isArmed()).toBe(true); // 没被异常杀死
    expect(onTick).toHaveBeenCalledTimes(1);

    timer.fire(); // 再触发一轮，链条仍然活着
    expect(loop.isArmed()).toBe(true);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it("disarm() 停止循环：清掉 pending，触发原 pending 不会重新武装", () => {
    const timer = makeFakeTimer();
    const onTick = vi.fn();
    const loop = createPollLoop({ intervalMs: 1000, onTick, setTimer: timer.setTimer, clearTimer: timer.clearTimer });
    loop.arm();
    const pendingBeforeDisarm = timer.pending;

    loop.disarm();
    expect(loop.isArmed()).toBe(false);
    expect(timer.pending).toBeNull();

    // 即使手动调用「已经拆掉」的旧回调，也不应该让循环复活
    pendingBeforeDisarm?.();
    expect(loop.isArmed()).toBe(false);
    expect(onTick).not.toHaveBeenCalled();

    // disarm 已拆的循环 → no-op，不抛错
    expect(() => loop.disarm()).not.toThrow();
  });

  it("arm() 幂等：连续两次 arm() 只产生一个 pending 计时器", () => {
    const timer = makeFakeTimer();
    const loop = createPollLoop({
      intervalMs: 1000,
      onTick: () => {},
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });
    loop.arm();
    loop.arm();
    expect(timer.scheduleCount).toBe(1);
  });

  it("顺序锚点：onTick 内部 isArmed() 已经是 true —— 重新武装必须先于工作执行", () => {
    const timer = makeFakeTimer();
    let armedDuringTick: boolean | null = null;
    const loop = createPollLoop({
      intervalMs: 1000,
      onTick: () => {
        armedDuringTick = loop.isArmed();
      },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });
    loop.arm();
    timer.fire();
    expect(armedDuringTick).toBe(true);
  });

  it("intervalMs 会原样传给 setTimer", () => {
    const timer = makeFakeTimer();
    const seenMs: number[] = [];
    const setTimer: PollLoopDeps["setTimer"] = (fn, ms) => {
      seenMs.push(ms);
      return timer.setTimer(fn, ms);
    };
    const loop = createPollLoop({ intervalMs: 4242, onTick: () => {}, setTimer, clearTimer: timer.clearTimer });
    loop.arm();
    expect(seenMs).toEqual([4242]);

    timer.fire(); // 重新武装那一轮也要用同一个 intervalMs
    expect(seenMs).toEqual([4242, 4242]);
  });
});
