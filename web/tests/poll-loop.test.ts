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

// ---- 假可见性源（同样不依赖 DOM / document）：手动控制 hidden 状态、手动触发订阅回调 ----

interface FakeVisibility {
  isHidden: () => boolean;
  onVisibilityChange: (cb: () => void) => () => void;
  /** 直接改状态，不通知订阅者——用来模拟"状态已经变了，但事件还没送到"的时序缝隙。 */
  setHidden(next: boolean): void;
  /** 改状态并通知所有订阅者，对应真实的 `visibilitychange` 事件。 */
  flip(next: boolean): void;
}

function makeFakeVisibility(): FakeVisibility {
  let hidden = false;
  const listeners = new Set<() => void>();
  return {
    isHidden: () => hidden,
    onVisibilityChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setHidden: (next) => {
      hidden = next;
    },
    flip: (next) => {
      hidden = next;
      for (const cb of listeners) cb();
    },
  };
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

  it("缺省两个可见性依赖时行为不变：不传 isHidden/onVisibilityChange，定时器正常触发、正常调用 onTick（钉住向后兼容）", () => {
    const timer = makeFakeTimer();
    const onTick = vi.fn();
    const loop = createPollLoop({ intervalMs: 1000, onTick, setTimer: timer.setTimer, clearTimer: timer.clearTimer });
    loop.arm();
    expect(loop.isArmed()).toBe(true);
    timer.fire();
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(loop.isArmed()).toBe(true);
  });
});

describe("createPollLoop（隐藏标签页：停止轮询 + 可见时立即追赶）", () => {
  it("arm() 时已隐藏：不排定时器，但 isArmed() 报 true（调用方不该以为 arm 失败）", () => {
    const timer = makeFakeTimer();
    const vis = makeFakeVisibility();
    vis.setHidden(true);
    const onTick = vi.fn();
    const loop = createPollLoop({
      intervalMs: 1000,
      onTick,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      isHidden: vis.isHidden,
      onVisibilityChange: vis.onVisibilityChange,
    });

    loop.arm();
    expect(timer.scheduleCount).toBe(0); // 没排定时器
    expect(timer.pending).toBeNull();
    expect(loop.isArmed()).toBe(true); // 但仍算「已武装」
    expect(onTick).not.toHaveBeenCalled();
  });

  it("已武装（隐藏时 arm 的）→ 变可见：立刻调用一次 onTick（追赶），且没有任何定时器触发过；随后留下一个 pending 定时器", () => {
    const timer = makeFakeTimer();
    const vis = makeFakeVisibility();
    vis.setHidden(true);
    const onTick = vi.fn();
    const loop = createPollLoop({
      intervalMs: 1000,
      onTick,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      isHidden: vis.isHidden,
      onVisibilityChange: vis.onVisibilityChange,
    });
    loop.arm();
    expect(onTick).toHaveBeenCalledTimes(0);

    vis.flip(false); // 变可见
    expect(onTick).toHaveBeenCalledTimes(1); // 0 -> 1，靠可见事件触发，不是定时器
    expect(timer.pending).not.toBeNull(); // 变可见时也补上了下一轮定时器
    expect(loop.isArmed()).toBe(true);
  });

  it("反复活防护：disarm() 之后再变可见，绝不调用 onTick、绝不排定时器——空图场景不能被可见性事件复活", () => {
    const timer = makeFakeTimer();
    const vis = makeFakeVisibility();
    vis.setHidden(true);
    const onTick = vi.fn();
    const loop = createPollLoop({
      intervalMs: 1000,
      onTick,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      isHidden: vis.isHidden,
      onVisibilityChange: vis.onVisibilityChange,
    });
    loop.arm();
    loop.disarm();
    expect(loop.isArmed()).toBe(false);

    vis.flip(false); // 变可见——但已经 disarm 过，必须是彻底的 no-op
    expect(onTick).not.toHaveBeenCalled();
    expect(timer.scheduleCount).toBe(0);
    expect(timer.pending).toBeNull();
    expect(loop.isArmed()).toBe(false);
  });

  it("定时器在隐藏期间触发（排定时器之后才变隐藏的时序缝隙）：不调用 onTick，但循环仍保持武装（重新武装先于 onTick 的原则延续到隐藏分支）", () => {
    const timer = makeFakeTimer();
    const vis = makeFakeVisibility();
    const onTick = vi.fn();
    const loop = createPollLoop({
      intervalMs: 1000,
      onTick,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      isHidden: vis.isHidden,
      onVisibilityChange: vis.onVisibilityChange,
    });
    loop.arm(); // 此刻可见，正常排了一个定时器
    vis.setHidden(true); // 直接改状态，不触发 flip：模拟事件还没送到就先到点的缝隙
    expect(timer.pending).not.toBeNull();

    timer.fire();
    expect(onTick).not.toHaveBeenCalled(); // 隐藏中不该发请求
    expect(loop.isArmed()).toBe(true); // 但循环没死——退回「已武装但隐藏中」
    expect(timer.pending).toBeNull(); // 也没有偷偷重排真实定时器
  });

  it("变隐藏取消 pending 定时器但保持武装；随后变可见恢复（先取消、再追赶、再重排）", () => {
    const timer = makeFakeTimer();
    const vis = makeFakeVisibility();
    const onTick = vi.fn();
    const loop = createPollLoop({
      intervalMs: 1000,
      onTick,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      isHidden: vis.isHidden,
      onVisibilityChange: vis.onVisibilityChange,
    });
    loop.arm();
    expect(timer.pending).not.toBeNull();

    vis.flip(true); // 变隐藏
    expect(timer.pending).toBeNull(); // pending 定时器被取消
    expect(loop.isArmed()).toBe(true); // 意图仍在
    expect(onTick).not.toHaveBeenCalled();

    vis.flip(false); // 变可见，恢复
    expect(onTick).toHaveBeenCalledTimes(1); // 立即追赶
    expect(timer.pending).not.toBeNull(); // 且恢复了轮询
    expect(loop.isArmed()).toBe(true);
  });

  it("dispose() 退订可见性监听并 disarm：之后再 flip 可见性不会有任何反应", () => {
    const timer = makeFakeTimer();
    const vis = makeFakeVisibility();
    const onTick = vi.fn();
    const loop = createPollLoop({
      intervalMs: 1000,
      onTick,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      isHidden: vis.isHidden,
      onVisibilityChange: vis.onVisibilityChange,
    });
    loop.arm();
    loop.dispose();
    expect(loop.isArmed()).toBe(false);
    expect(timer.pending).toBeNull();

    vis.flip(true);
    vis.flip(false);
    expect(onTick).not.toHaveBeenCalled();
    expect(timer.scheduleCount).toBe(1); // 只有最初 arm() 那一次
  });
});
