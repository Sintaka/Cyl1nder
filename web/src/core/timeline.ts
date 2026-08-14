import type { InputPayload } from "../protocol/types";

export interface TimelineDeps {
  getInputs(): InputPayload[];
  getInputRev(): number;
  setInputs(inputs: InputPayload[], rev: number): void;
  setFrame(f: number): void; // mirror 到 store（main.ts 传 store.setFrame；store 不 emit）
  scheduleNetwork(): void;
  log(msg: string): void;
  /**
   * 本地帧改动（setFrame/step）后的回调，用于 web→Houdini 提交。
   * main.ts 合并时注入 → 调 client.putTimeline(serial, frame)。
   * 门控：linkEnabled && syncFps 节流（拖动态不再抑制；频率受节流上限约束）。
   * 可选：缺省（本地模式）时无副作用，行为与旧版完全一致。
   */
  onFrameCommit?: (f: number) => void;
}

export interface TimelineController {
  readonly frame: number;
  readonly min: number;
  readonly max: number;
  readonly fps: number;
  readonly syncFps: number; // web→Houdini 提交节流上限（clamp 1..60，默认 30）
  readonly linkEnabled: boolean; // Houdini 链接（双向同步）开关；默认 false = 本地模式
  hasFrame(f: number): boolean;
  captureFrame(frame: number, inputs: InputPayload[]): void;
  setFrame(f: number): void;
  step(delta: number): void; // ±1 或 ±10，钳制到 [min,max]
  setFps(fps: number): void; // 数值校验（>0 且有限），变更后 emit
  setSyncFps(fps: number): void; // clamp 1..60；提交节流 = 1000/fps ms
  setLinkEnabled(b: boolean): void;
  setDragging(b: boolean): void; // 拖动标记：仅抑制 applyRemote 回显（不抑制提交）
  applyRemote(frame: number, fps: number): void; // H→C：应用 Houdini 上报的帧/fps
  reset(): void;
  subscribe(fn: () => void): () => void;
}

/**
 * 时间轴控制器：逐帧 INPUT 快照 + scrub 驱动器 + 双向同步（本地优先）。
 * 不 import store。默认 linkEnabled=false → 纯本地（与旧版行为完全一致）。
 */
export function createTimelineController(deps: TimelineDeps): TimelineController {
  let frame = 1;
  let min = 1;
  let max = 100;
  let fps = 30;
  let syncFps = 30;
  let linkEnabled = false;
  let dragging = false;
  // 模块内提交时间戳：以 performance.now() 为时钟，按 syncFps 节流 web→Houdini 提交。
  // -Infinity 保证首次提交必发。
  let lastCommit = -Infinity;
  const frameInputs = new Map<number, InputPayload[]>();
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const fn of listeners) fn();
  };

  /** 本地改帧：收集快照回放 / 清空几何，并按 syncFps 节流提交帧到 Houdini。 */
  const setFrame = (f: number): void => {
    frame = f;
    min = Math.min(min, f);
    max = Math.max(max, f);
    deps.setFrame(f);
    const snapshot = frameInputs.get(f);
    if (snapshot) {
      deps.setInputs(snapshot, deps.getInputRev() + 1);
    } else {
      deps.setInputs([], deps.getInputRev() + 1);
      deps.log(`timeline 帧 ${f} 未收集（无本地帧输入）`);
    }
    deps.scheduleNetwork();
    emit();
    // web→Houdini：链接时按 syncFps 节流提交（拖动态不再抑制——拖动期间也提交，
    // 但连发（含播放 step 连发）被节流到 syncFps 上限，避免每 tick 都打 Houdini）。
    if (linkEnabled) {
      const now = performance.now();
      if (now - lastCommit >= 1000 / syncFps) {
        lastCommit = now;
        deps.onFrameCommit?.(f);
      }
    }
  };

  return {
    get frame() {
      return frame;
    },
    get min() {
      return min;
    },
    get max() {
      return max;
    },
    get fps() {
      return fps;
    },
    get syncFps() {
      return syncFps;
    },
    get linkEnabled() {
      return linkEnabled;
    },

    hasFrame(f: number): boolean {
      return frameInputs.has(f);
    },

    captureFrame(f: number, inputs: InputPayload[]): void {
      frameInputs.set(f, inputs);
      min = Math.min(min, f);
      max = Math.max(max, f);
      emit();
    },

    setFrame,

    step(delta: number): void {
      setFrame(Math.min(max, Math.max(min, frame + delta)));
    },

    setFps(v: number): void {
      if (!Number.isFinite(v) || v <= 0) return;
      if (v === fps) return;
      fps = v;
      emit();
    },

    setSyncFps(v: number): void {
      if (!Number.isFinite(v)) return;
      syncFps = Math.min(60, Math.max(1, v));
      // 不 emit：syncFps 无响应式 UI 消费者，仅供节流计算与测试读取。
    },

    setLinkEnabled(b: boolean): void {
      if (b === linkEnabled) return;
      linkEnabled = b;
      emit();
    },

    setDragging(b: boolean): void {
      if (b === dragging) return;
      dragging = b;
      // 仅影响 applyRemote 回显抑制；不再抑制 onFrameCommit（提交改由 syncFps 节流）。
    },

    applyRemote(f: number, v: number): void {
      // H→C 仅当「非拖动态」且「已链接」时生效；否则忽略 Houdini 上报，保持本地。
      if (dragging || !linkEnabled) return;
      // 非法帧（NaN/±Infinity）忽略，避免污染本地帧号。
      if (!Number.isFinite(f)) return;
      // 静默更新 fps（不重复 emit，最终统一 emit 一次）。
      if (Number.isFinite(v) && v > 0) fps = v;
      frame = f;
      deps.setFrame(f);
      const snapshot = frameInputs.get(f);
      if (snapshot) {
        // 命中本地快照 → 直接回放，避免等 Houdini 的 inputs 消息。
        deps.setInputs(snapshot, deps.getInputRev() + 1);
        deps.scheduleNetwork();
      }
      // 未命中 → 不清空 inputs：等 Houdini 的 inputs 消息（带 frame）到达后填充。
      // 注意：与 setFrame 的「未命中清空几何」语义不同——远程帧的几何由 H 侧推送，不在这里清空。
      // 不触发 onFrameCommit，避免 web→Houdini 回环。
      emit();
    },

    reset(): void {
      frame = 1;
      min = 1;
      max = 100;
      frameInputs.clear();
      emit();
    },

    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
