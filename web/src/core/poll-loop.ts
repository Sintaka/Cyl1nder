/**
 * 自愈轮询循环：定时器触发时**先无条件重新武装、再执行 onTick**。
 *
 * 为什么顺序必须是这样：旧写法（`externRefPollTimer` 内联在 main.ts）里，
 * 重新武装只是下游工作（`prefetchExternRefs`）跑完后的**副作用**——而下游有
 * 两处提前 return（无项目 / 图未就绪）和潜在异常，都发生在重新武装之前。
 * 一旦某一帧撞上这些分支，计时器已经被清空、又没人重新排它，这条链就
 * **永久死掉**，之后再也不会自己恢复。实测：桥重启后页面本身活着（1s
 * 时间线轮询仍在推进、4 个 WS 客户端在线），但某图外引用连续 388 秒以上
 * 零读取——远超 Chrome 120s 的后台节流阈值，说明不是节流，是链死了。
 *
 * 这里把「重新武装」挪到 `onTick` **之前**，且用 try/catch 吞掉 `onTick`
 * 的异常：无论下游做什么、抛不抛，循环本身已经排好下一轮，永远不会停。
 */
export interface PollLoopDeps {
  /** 每轮之间的间隔（毫秒）。 */
  intervalMs: number;
  /** 每次触发要做的工作；可以抛错，循环不受影响。 */
  onTick: () => void;
  /** 计时器注入点，方便单测用假计时器而不依赖真实时钟/DOM。 */
  setTimer: (fn: () => void, ms: number) => number;
  /** 与 `setTimer` 成对的清除函数。 */
  clearTimer: (id: number) => void;
}

export interface PollLoop {
  /** 武装循环；已武装时是 no-op（绝不叠加出第二个计时器）。 */
  arm(): void;
  /** 拆除循环；未武装时是 no-op。 */
  disarm(): void;
  /** 当前是否处于武装状态。 */
  isArmed(): boolean;
}

export function createPollLoop(deps: PollLoopDeps): PollLoop {
  let timerId: number | null = null;
  // 世代号：每次「排新一轮」自增。`disarm()` 也会自增它，这样即便调用方手上
  // 还攥着一个已经作废的计时器回调闭包（真实 clearTimeout 理论上会阻止它触发，
  // 但不依赖这个假设——防的是宿主计时器实现有缝、或调用方绕过 clearTimer 直接
  // 手持闭包这种极端情况），过期回调认出世代号不匹配就直接不作数，绝不复活循环。
  let generation = 0;

  const scheduleNext = (): number => {
    generation += 1;
    const myGeneration = generation;
    return deps.setTimer(() => fire(myGeneration), deps.intervalMs);
  };

  const fire = (myGeneration: number): void => {
    if (myGeneration !== generation) return; // 过期回调（已被 disarm 或被新一轮顶掉）
    // 关键顺序：先清空旧句柄、立刻无条件重新排下一轮，然后才跑 onTick。
    // 这样即使 onTick 提前 return 或抛异常，循环已经自己续上了。
    timerId = null;
    timerId = scheduleNext();
    try {
      deps.onTick();
    } catch {
      // 吞掉：此模块没有 logger 依赖，且循环此刻已经重新武装，无需额外处理。
    }
  };

  const arm = (): void => {
    if (timerId !== null) return; // 已武装 → no-op，避免叠加计时器
    timerId = scheduleNext();
  };

  const disarm = (): void => {
    if (timerId === null) return;
    deps.clearTimer(timerId);
    timerId = null;
    generation += 1; // 作废任何残留引用的旧回调
  };

  const isArmed = (): boolean => timerId !== null;

  return { arm, disarm, isArmed };
}
