import type { InputPayload } from "../protocol/types";

export interface TimelineDeps {
  getInputs(): InputPayload[];
  getInputRev(): number;
  setInputs(inputs: InputPayload[], rev: number): void;
  setFrame(f: number): void; // mirror 到 store（main.ts 传 store.setFrame）
  scheduleNetwork(): void;
  log(msg: string): void;
}

export interface TimelineController {
  readonly frame: number;
  readonly min: number;
  readonly max: number;
  readonly fps: number; // 本地只读 30
  hasFrame(f: number): boolean;
  captureFrame(frame: number, inputs: InputPayload[]): void;
  setFrame(f: number): void;
  step(delta: number): void; // ±1 或 ±10，钳制到 [min,max]
  reset(): void;
  subscribe(fn: () => void): () => void;
}

/** 纯本地时间轴：逐帧 INPUT 快照 + scrub 驱动器。不 import store。 */
export function createTimelineController(deps: TimelineDeps): TimelineController {
  let frame = 1;
  let min = 1;
  let max = 100;
  const fps = 30;
  const frameInputs = new Map<number, InputPayload[]>();
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const fn of listeners) fn();
  };

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