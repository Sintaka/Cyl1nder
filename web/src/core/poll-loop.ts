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
 *
 * ---
 *
 * 隐藏标签页优化（本轮新增）：Chrome 的 intensive throttling 会把后台标签页的
 * 定时器唤醒频率钳到约 1 次/分钟，而这个轮询是**两级串联的 setTimeout**
 * （本模块的 ~2s 轮询 + 写回去抖的 ~120ms），每级各等一次唤醒 → 2 次唤醒
 * 叠加成实测 ~120s 的刷新周期（用户真实浏览器 bridge trace 验证：
 * 121.5/120.0/120.0/120.0/120.0/120.0s，spread 仅 1.5s）。前台同一条链
 * 只要 ~2.1-2.4s，纯粹是隐藏标签页的问题。
 *
 * 修法：隐藏时干脆不排定时器（零请求，好过每 ~120s 打一次桥），可见时立刻
 * 补一次 `onTick`（好过等下一次被节流的唤醒，最多省下 120s 的过期数据）。
 * 两个新依赖都是可选注入——本模块单测跑在无 DOM 的 node 环境，绝不能直接
 * 摸 `document`；缺省时（两个依赖都不传）行为必须与改动前逐字节一致。
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
  /** 当前是否处于隐藏状态（后台标签页）。缺省视为始终可见。 */
  isHidden?: () => boolean;
  /** 订阅可见性变化，返回退订函数。缺省 = 不订阅（行为与本次改动前完全一致）。 */
  onVisibilityChange?: (cb: () => void) => () => void;
}

export interface PollLoop {
  /** 武装循环；已武装时是 no-op（绝不叠加出第二个计时器）。隐藏时只记录「想要」，不排定时器。 */
  arm(): void;
  /** 拆除循环；未武装时是 no-op。清掉「想要」状态，之后任何可见性事件都不会复活它。 */
  disarm(): void;
  /** 当前是否处于武装状态（含「已武装但隐藏中，尚未排定时器」的情况）。 */
  isArmed(): boolean;
  /** 退订可见性监听并 disarm；用于彻底销毁这个循环。 */
  dispose(): void;
}

export function createPollLoop(deps: PollLoopDeps): PollLoop {
  let timerId: number | null = null;
  // “想要武装”的意图，与 timerId 是否非空分离：隐藏标签页里 arm() 之后
  // wanted 为 true 但没有真实定时器，isArmed() 要报 true（调用方靠它判断
  // 「我 arm 过，没失败」），等可见事件来了再统一补上定时器 + 追赶 tick。
  let wanted = false;
  // 世代号：每次「排新一轮」自增。`disarm()` 也会自增它，这样即便调用方手上
  // 还攥着一个已经作废的计时器回调闭包（真实 clearTimeout 理论上会阻止它触发，
  // 但不依赖这个假设——防的是宿主计时器实现有缝、或调用方绕过 clearTimer 直接
  // 手持闭包这种极端情况），过期回调认出世代号不匹配就直接不作数，绝不复活循环。
  let generation = 0;

  const checkHidden = (): boolean => deps.isHidden?.() ?? false;

  const scheduleNext = (): number => {
    generation += 1;
    const myGeneration = generation;
    return deps.setTimer(() => fire(myGeneration), deps.intervalMs);
  };

  const fire = (myGeneration: number): void => {
    if (myGeneration !== generation) return; // 过期回调（已被 disarm 或被新一轮顶掉）
    // 关键顺序：先清空旧句柄。
    timerId = null;
    if (checkHidden()) {
      // 定时器可能是变隐藏前排的、恰好这时触发。隐藏标签页不该发请求，
      // 所以不重排真实定时器、不跑 onTick —— 但 wanted 原样保留（不算 disarm），
      // 状态退回「已武装但隐藏中」，等可见事件统一补上（与 arm() 隐藏分支对称）。
      return;
    }
    // 立刻无条件重新排下一轮，然后才跑 onTick：这样即使 onTick 提前 return 或
    // 抛异常，循环已经自己续上了。
    timerId = scheduleNext();
    try {
      deps.onTick();
    } catch {
      // 吞掉：此模块没有 logger 依赖，且循环此刻已经重新武装，无需额外处理。
    }
  };

  // 可见性事件的统一入口：hidden→visible 和 visible→hidden 共用同一个回调
  // （接口约定 cb 不带参数），每次触发都重新问 checkHidden() 判断方向。
  const onVisibilityFlip = (): void => {
    if (!wanted) return; // 反复活防护：disarm 之后任何可见性事件都必须是 no-op
    if (checkHidden()) {
      // 变隐藏：取消 pending 定时器（哪怕它还没到期），避免可见时还要等它。
      // wanted 不变 —— 可见时靠它知道「这个循环本来就该继续」。
      if (timerId !== null) {
        deps.clearTimer(timerId);
        timerId = null;
        generation += 1; // 作废这个句柄对应的世代
      }
      return;
    }
    // 变可见：先确保定时器已排（沿用「重新武装先于工作」的防异常思路），
    // 再补一次立即执行——这才是这个修复的意义所在：不用等下一次被节流的
    // 唤醒（最坏 120s），马上拿到新值。
    if (timerId === null) timerId = scheduleNext();
    try {
      deps.onTick();
    } catch {
      // 吞掉，理由同 fire()。
    }
  };

  const unsubscribeVisibility = deps.onVisibilityChange?.(onVisibilityFlip) ?? null;

  const arm = (): void => {
    if (wanted) return; // 已武装 → no-op，避免叠加计时器/重复记录意图
    wanted = true;
    if (checkHidden()) return; // 隐藏中：只记录「想要」，可见时统一补上
    timerId = scheduleNext();
  };

  const disarm = (): void => {
    if (!wanted) return;
    wanted = false;
    if (timerId !== null) {
      deps.clearTimer(timerId);
      timerId = null;
    }
    generation += 1; // 作废任何残留引用的旧回调
  };

  const isArmed = (): boolean => wanted;

  const dispose = (): void => {
    disarm();
    unsubscribeVisibility?.();
  };

  return { arm, disarm, isArmed, dispose };
}
