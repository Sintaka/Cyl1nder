import type { InputPayload, OutputBuffer } from "../protocol/types";

export interface NetworkDeps {
  getSerial(): string | null;
  getInputs(): InputPayload[];
  getNetworkSnapshot(): any;
  /** Topology version of the graph when this run() computes (freshness gate for
   *  the viewport display-buffer reuse). */
  getGraphVersion(): number;
  computeOutputs(inputs: InputPayload[], snap: any): OutputBuffer[];
  getOutputRev(): number;
  upsertOutputs(outputs: OutputBuffer[], rev: number): void;
  setOutputRev(rev: number): void;
  pushOutputs(serial: string, outputs: OutputBuffer[]): Promise<{ rev: number }>;
  log(msg: string): void;
}

/** v1 network runner: trace the graph into 4 output buffers. Local optimistic
 *  apply FIRST (viewport rebuilds at the full local rate), then fire-and-forget
 *  push to the bridge; stale push responses (older epochs) are discarded. */
export function createNetworkRunner(deps: NetworkDeps): {
  run(): Promise<void>;
  bumpEpoch(): void;
  /** True when the last run() cooked outputs for the CURRENT graph topology. */
  isFresh(): boolean;
} {
  let epoch = 0;
  let lastCookGraphVersion = -1;

  const run = async (): Promise<void> => {
    const serial = deps.getSerial();
    if (!serial || deps.getInputs().length === 0) return;
    const cur = ++epoch;
    const snap = deps.getNetworkSnapshot();
    lastCookGraphVersion = deps.getGraphVersion();
    const outputs = deps.computeOutputs(deps.getInputs(), snap);
    // a) local optimistic apply: predicted rev so the viewport rebuilds immediately
    const predictedRev = deps.getOutputRev() + 1;
    for (const buf of outputs) buf.rev = predictedRev;
    deps.upsertOutputs(outputs, predictedRev);
    // b) fire-and-forget bridge push; stale responses (older epochs) are discarded
    deps
      .pushOutputs(serial, outputs)
      .then((r) => {
        if (cur !== epoch || deps.getSerial() !== serial) return; // stale - discard entirely
        if (r.rev > deps.getOutputRev()) deps.setOutputRev(r.rev); // align rev, no content re-apply
        deps.log(`network ran: ${outputs.length} outputs → rev=${r.rev}`);
      })
      .catch((e) => {
        if (cur !== epoch || deps.getSerial() !== serial) return;
        deps.log(`network run failed: ${String(e)}`);
      });
  };

  const bumpEpoch = (): void => {
    epoch++;
  };

  const isFresh = (): boolean => lastCookGraphVersion === deps.getGraphVersion();

  return { run, bumpEpoch, isFresh };
}