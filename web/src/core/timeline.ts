import type { InputPayload } from "../protocol/types";

export interface TimelineDeps {
  getInputs(): InputPayload[];
  getInputRev(): number;
  setInputs(inputs: InputPayload[], rev: number): void;
  setFrame(f: number): void; // mirror 到 store（main.ts 传 store.setFrame）
  scheduleNetwork(): void;
  log(msg: string): void;
  /**
   * 本地帧改动（setFrame/step）后的回调，用于 web→Houdini 提交。
   * main.ts 合并时注入 → 调 client.putTimeline(serial, frame)；受 linkEnabled && !dragging 门控。
   * 可选：缺省（本地模式）时无副作用，行为与旧版完全一致。
   */
  onFrameCommit?: (f: number) => void;
}

export interface TimelineController {
  readonly frame: number;
  readonly min: number;
  readonly max: number;
  readonly fps: number;
  readonly linkEnabled: boolean; // Houdini 链接（双向同步）开关；默认 false = 本地模式
  hasFrame(f: number): boolean;
  captureFrame(frame: number, inputs: InputPayload[]): void;
  setFrame(f: number): void;
  step(delta: number): void; // ±1 或 ±10，钳制到 [min,max]
  setFps(fps: number): void; // 数值校验（>0 且有限），变更后 emit
  setLinkEnabled(b: boolean): void;
  setDragging(b: boolean): void; // 拖动抑制标记：抑制 onFrameCommit 与 applyRemote
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
  let linkEnabled = false;
  let dragging = false;
  const frameInputs = new Map<number, InputPayload[]>();
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const fn of listeners) fn();
  };

  /** 本地改帧：收集快照回放 / 清空几何，并（链接时且非拖动态）提交帧到 Houdini。 */
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
    // web→Houdini：仅链接且非拖动态提交（拖动期间抑制，避免每 tick 都打 Houdini）。
    if (linkEnabled && !dragging) deps.onFrameCommit?.(f);
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

    setLinkEnabled(b: boolean): void {
      if (b === linkEnabled) return;
      linkEnabled = b;
      emit();
    },

    setDragging(b: boolean): void {
      if (b === dragging) return;
      dragging = b;
    },

    applyRemote(f: number, v: number): void {
      // H→C 仅当「非拖动态」且「已链接」时生效；否则忽略 Houdini 上报，保持本地。
      if (dragging || !linkEnabled) return;
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
