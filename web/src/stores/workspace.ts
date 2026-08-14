import { InputPayload, OutputBuffer } from "../protocol/types";

/** Deep content equality for JSON-serializable data (arrays, objects, primitives). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
    }
    return true;
  }
  return false;
}

/** Content equality for output buffers (mirror bridge workspace._same_content:
 *  pointCount / primCount / points / curves / attributes; rev + index ignored). */
export function outputsEqual(a: OutputBuffer, b: OutputBuffer): boolean {
  return (
    a.pointCount === b.pointCount &&
    a.primCount === b.primCount &&
    deepEqual(a.points, b.points) &&
    deepEqual(a.curves, b.curves) &&
    deepEqual(a.attributes, b.attributes)
  );
}

type Listener = () => void;

/** Tiny pub-sub workspace store (per serial). No framework - matches AHS store idea. */
export class WorkspaceStore {
  serial = "";
  inputs: InputPayload[] = [];
  outputs: OutputBuffer[] = [];
  inputRev = 0;
  outputRev = 0;
  frame = 1;
  status: "offline" | "connecting" | "ok" = "connecting";
  lastError = "";
  logs: string[] = [];
  selectedInputIndex: number | null = null;

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  setSerial(serial: string): void {
    this.serial = serial;
    this.inputs = [];
    this.outputs = [];
    this.inputRev = 0;
    this.outputRev = 0;
    this.frame = 1;
    this.emit();
  }

  setFrame(f: number): void {
    // frame 是「镜像」而非响应式状态：时间轴 UI 直接读 controller（timeline.frame），
    // store.frame 无任何读取/订阅依赖（store.subscribe 的全店 flush 消费者只置 pendingFlush，
    // 不读 frame）。因此不 emit()，避免 H→C 远端帧每次推进都触发一次全店刷新。
    this.frame = f;
  }

  setInputs(inputs: InputPayload[], rev: number): void {
    this.inputs = inputs;
    this.inputRev = rev;
    this.emit();
  }

  upsertOutputs(outputs: OutputBuffer[], rev: number): void {
    for (const buf of outputs) {
      const i = this.outputs.findIndex((o) => o.index === buf.index);
      if (i >= 0) this.outputs[i] = buf;
      else this.outputs.push(buf);
    }
    this.outputRev = rev;
    this.emit();
  }

  /** Align the local outputRev with the bridge without re-applying content
   *  (used when a push response confirms a rev we already applied optimistically). */
  setOutputRev(rev: number): void {
    if (rev === this.outputRev) return;
    this.outputRev = rev;
    this.emit();
  }

  /** Bridge WS echo path: content-dedup + monotonic rev. Buffers with IDENTICAL
   *  content to the stored one are skipped (no replace, no change count) so
   *  fps-coalesced echoes of local optimistic applies are no-ops; rev advances
   *  monotonically. Emits once when anything changed OR the rev advanced. */
  applyOutputs(outputs: OutputBuffer[], rev: number): void {
    let changed = false;
    for (const buf of outputs) {
      const i = this.outputs.findIndex((o) => o.index === buf.index);
      const existing = i >= 0 ? this.outputs[i] : undefined;
      if (existing && outputsEqual(existing, buf)) continue;
      if (i >= 0) this.outputs[i] = buf;
      else this.outputs.push(buf);
      changed = true;
    }
    const revAdvanced = rev > this.outputRev;
    if (revAdvanced) this.outputRev = rev;
    if (changed || revAdvanced) this.emit();
  }

  clearOutputs(): void {
    this.outputs = [];
    this.outputRev = 0;
    this.emit();
  }

  setStatus(s: "offline" | "connecting" | "ok", error = ""): void {
    this.status = s;
    this.lastError = error;
    this.emit();
  }

  pushLog(msg: string): void {
    this.logs.push(msg);
    if (this.logs.length > 300) this.logs.shift();
    this.emit();
  }

  /** Write to the log WITHOUT notifying subscribers - safe inside viewport refresh paths. */
  pushLogSilent(msg: string): void {
    this.logs.push(msg);
    if (this.logs.length > 300) this.logs.shift();
  }

  setSelectedInput(index: number | null): void {
    this.selectedInputIndex = index;
    this.emit();
  }
}

export const store = new WorkspaceStore();