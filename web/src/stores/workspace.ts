import { InputPayload, OutputBuffer } from "../protocol/types";

type Listener = () => void;

/** Tiny pub-sub workspace store (per serial). No framework - matches AHS store idea. */
export class WorkspaceStore {
  serial = "";
  inputs: InputPayload[] = [];
  outputs: OutputBuffer[] = [];
  inputRev = 0;
  outputRev = 0;
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
    this.emit();
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

  setSelectedInput(index: number | null): void {
    this.selectedInputIndex = index;
    this.emit();
  }
}

export const store = new WorkspaceStore();