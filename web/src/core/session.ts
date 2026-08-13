import { connectWs } from "../bridge/client";
import type { InputPayload, OutputBuffer } from "../protocol/types";

export interface SessionDeps {
  getPrefsSyncMaxFps(): number;
  putSyncFps(serial: string, fps: number): Promise<unknown>;
  getSerial(): string | null;
  setSerial(serial: string): void;
  setStatus(s: "offline" | "connecting" | "ok"): void;
  log(msg: string): void;
  getInputs(): InputPayload[];
  setInputs(inputs: InputPayload[], rev: number): void;
  inputsEqual(a: InputPayload[], b: InputPayload[]): boolean;
  getOutputRev(): number;
  applyOutputs(outputs: OutputBuffer[], rev: number): void;
  network: { run(): Promise<void>; bumpEpoch(): void };
  startHdaWatch(serial: string): void;
  kicker: { onHello(serial: string): void; onStatus(open: boolean, serial: string): void };
  loadSnapshot(serial: string): Promise<void>;
  getAutoRun(): boolean;
}

/** Session controller: connect + WS message handling + auto-run / replay state.
 *  main.ts keeps the rest (prefs mutation, snapshot loading) and injects it. */
export function createSessionController(deps: SessionDeps): {
  connect(serialRaw: string): void;
  setAutoRun(v: boolean): void;
} {
  let wsDisconnect: (() => void) | null = null;
  let replayPending = false;
  let autoRun = deps.getAutoRun();

  const connect = (serialRaw: string): void => {
    const serial = serialRaw.trim();
    if (!serial) return;
    wsDisconnect?.();
    replayPending = true;
    deps.setSerial(serial);
    deps.network.bumpEpoch(); // discard in-flight runs from the previous serial
    // Push the persisted Sync Max FPS on EVERY (re)connect: the bridge keeps its
    // default 30 until the web tells it otherwise (first connect + reconnect).
    void deps.putSyncFps(serial, deps.getPrefsSyncMaxFps()).catch(() => undefined);
    deps.startHdaWatch(serial);
    deps.log(`connect ${serial}`);
    void deps.loadSnapshot(serial);
    deps.setStatus("connecting");
    wsDisconnect = connectWs(
      serial,
      (msg) => {
        if (msg.type === "hello") {
          replayPending = true; // a replay follows on every (re)connect - never auto-run on it
          deps.setStatus("ok");
          deps.log(`hello inputRev=${msg.inputRev} outputRev=${msg.outputRev}`);
          deps.kicker.onHello(serial);
        } else if (msg.type === "inputs") {
          const changed = !deps.inputsEqual(deps.getInputs(), msg.inputs);
          deps.setInputs(msg.inputs, msg.rev);
          deps.log(`inputs rev=${msg.rev} (${msg.inputs.length})${changed ? "" : " [unchanged]"}`);
          if (replayPending) {
            replayPending = false; // replay of current state on connect - not an update
            deps.log("inputs replay - network not run");
            return;
          }
          // gate auto-run on real content change: breaks the Force Cook <-> echo feedback loop
          if (autoRun && changed) void deps.network.run();
        } else if (msg.type === "outputs") {
          // content-dedup + monotonic rev guard drops intermediate coalesced frames.
          if (msg.rev > deps.getOutputRev()) {
            deps.applyOutputs(msg.outputs, msg.rev);
          }
          deps.log(`outputs rev=${msg.rev} (${msg.outputs.length})`);
        }
      },
      (open) => {
        deps.kicker.onStatus(open, serial);
        deps.setStatus(open ? "ok" : "offline");
      },
    );
  };

  const setAutoRun = (v: boolean): void => {
    autoRun = v;
  };

  return { connect, setAutoRun };
}