import type { InputPayload, OutputBuffer } from "../protocol/types";
import type { ChainChange, ChainCtx, ComputeResult } from "../nodes2/chain-cache";

/** Which chains need real point-level work this frame (Houdini display-driven
 *  cook): outputs = per-output-index flags, node = displayed null/transform id. */
export interface ActiveChains {
  outputs: boolean[];
  node: string | null;
}

export interface NetworkDeps {
  getSerial(): string | null;
  getInputs(): InputPayload[];
  getNetworkSnapshot(): any;
  /** Topology version of the graph when this run() computes (freshness gate for
   *  the viewport display-buffer reuse). */
  getGraphVersion(): number;
  /** Inputs revision (store.inputRev): part of the chain-cache invalidation sig -
   *  a new Houdini push must re-trace, never delta a stale cached chain. */
  getInputsRev(): number;
  computeOutputs(inputs: InputPayload[], snap: any, ctx?: ChainCtx): ComputeResult;
  /** Active chains for this frame (display focus + reference flags). */
  getActiveChains(): ActiveChains;
  /** Node being edited in the viewport (Enter gizmo target), if any. */
  getEditedNodeId(): string | null;
  getOutputRev(): number;
  upsertOutputs(outputs: OutputBuffer[], rev: number): void;
  setOutputRev(rev: number): void;
  shouldPush(): boolean;
  pushOutputs(serial: string, outputs: OutputBuffer[]): Promise<{ rev: number }>;
  log(msg: string): void;
  /** Called with the wall-clock compute duration of run() (ms). The graph layer
   *  uses it to start the flowing-dash runtime animation on the display chain
   *  when the cook is slow enough to be visible (>=120ms). */
  onRunTiming?(ms: number): void;
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
  /** Per-run output buffers (rev-carryover source for unchanged chains). */
  let lastOutputs: OutputBuffer[] = [];

  const run = async (): Promise<void> => {
    const started = performance.now();
    const serial = deps.getSerial();
    if (!serial || deps.getInputs().length === 0) return;
    const cur = ++epoch;
    const snap = deps.getNetworkSnapshot();
    lastCookGraphVersion = deps.getGraphVersion();
    // P2: hand the version context to the chain cache so param-only edits take the
    // clone-free delta path and any input/topology change full re-traces.
    const res = deps.computeOutputs(deps.getInputs(), snap, {
      inputsRev: deps.getInputsRev(),
      graphVersion: deps.getGraphVersion(),
      activeOutputs: deps.getActiveChains().outputs,
      activeNodeId: deps.getActiveChains().node,
    });
    // Report the pure compute duration BEFORE the cheap local apply / push, so a
    // slow trace (>=120ms) can trigger the graph's runtime-flow animation.
    deps.onRunTiming?.(performance.now() - started);
    const outputs = res.outputs;
    const changes = res.changes ?? [];
    // Defensive: a shorter-than-outputs changes array treats the missing tail as
    // "data" (changed) so we never silently drop a buffer.
    const changeAt = (i: number): ChainChange => (i < changes.length ? changes[i] : "data");
    // F4: every chain unchanged -> no-op frame: skip upsert / rev bump / push.
    if (outputs.every((_, i) => changeAt(i) === "none")) return;
    // a) local optimistic apply: predicted rev so the viewport rebuilds immediately;
    //    unchanged buffers CARRY their previous rev (renderer skips them by rev).
    const predictedRev = deps.getOutputRev() + 1;
    for (let i = 0; i < outputs.length; i++) {
      outputs[i].rev = changeAt(i) !== "none" ? predictedRev : (lastOutputs[i]?.rev ?? 0);
    }
    deps.upsertOutputs(outputs, predictedRev);
    lastOutputs = outputs;
    // b) fire-and-forget bridge push of ONLY the changed buffers; stale responses
    //    (older epochs) are discarded.
    const changed = outputs.filter((_, i) => changeAt(i) !== "none");
    if (deps.shouldPush()) {
      deps
        .pushOutputs(serial, changed)
        .then((r) => {
          if (cur !== epoch || deps.getSerial() !== serial) return; // stale - discard entirely
          if (r.rev > deps.getOutputRev()) deps.setOutputRev(r.rev); // align rev, no content re-apply
          deps.log(`network ran: ${changed.length} outputs → rev=${r.rev}`);
        })
        .catch((e) => {
          if (cur !== epoch || deps.getSerial() !== serial) return;
          deps.log(`network run failed: ${String(e)}`);
        });
    } else {
      deps.log(`network ran locally (sync OFF): ${changed.length} outputs, no push`);
    }
  };

  const bumpEpoch = (): void => {
    epoch++;
  };

  const isFresh = (): boolean => lastCookGraphVersion === deps.getGraphVersion();

  return { run, bumpEpoch, isFresh };
}
