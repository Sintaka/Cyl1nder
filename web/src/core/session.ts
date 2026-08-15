import { connectWs, type WsHandler } from "../bridge/client";
import type { InputPayload, OutputBuffer, TimelineMsg, WsServerMessage } from "../protocol/types";

export interface SessionDeps {
  getPrefsSyncMaxFps(): number;
  putSyncFps(serial: string, fps: number): Promise<unknown>;
  getSerial(): string | null;
  setSerial(serial: string): void;
  setStatus(s: "offline" | "connecting" | "ok"): void;
  log(msg: string): void;
  getInputs(): InputPayload[];
  setInputs(inputs: InputPayload[], rev: number): void;
  captureFrame(frame: number | undefined, inputs: InputPayload[]): void;
  inputsEqual(a: InputPayload[], b: InputPayload[]): boolean;
  getOutputRev(): number;
  applyOutputs(outputs: OutputBuffer[], rev: number): void;
  isSyncEnabled(): boolean;
  putSyncEnabled(serial: string, enabled: boolean): Promise<unknown>;
  network: { run(): Promise<void>; bumpEpoch(): void };
  /** 多槽 watchdog：start 返回该 serial 的 stop 函数（closeSession 时调用）。
   *  main.ts 注入体原样（`(serial) => hdaWatchdog.start(serial)`）；返回值新增不影响。 */
  startHdaWatch(serial: string): () => void;
  kicker: { onHello(serial: string): void; onStatus(open: boolean, serial: string): void };
  loadSnapshot(serial: string): Promise<void>;
  getAutoRun(): boolean;
  /**
   * H→C 时间轴推送应用（WS {type:"timeline"} 分支）。main.ts 合并时注入
   * timeline.applyRemote；可选 dep：缺省（本地模式）为 no-op。
   */
  applyTimeline?(frame: number, fps: number): void;
  /** 可注入的 WS 建立函数，默认 client.connectWs；测试注入 fake 捕获
   *  onMessage/onStatus 并返回 disconnect 探针。 */
  connectWsFn?: (serial: string, onMessage: WsHandler, onStatus: (open: boolean) => void) => () => void;
}

type SessionMessage = WsServerMessage | TimelineMsg;

/** 单成员会话状态（后台成员只维护自身状态，不碰全局 store）。 */
interface SessionMember {
  wsDisconnect: (() => void) | null;
  stopWatch: (() => void) | null;
  replayPending: boolean; // 每次（重）连接后首个 inputs 视为 replay，不触发 network.run
  status: boolean; // 最近一次 WS open 状态（onStatus 回调写入）
  hasHello: boolean;
}

export interface SessionManager {
  /** 幂等：该成员无会话则建（推 putSyncFps/putSyncEnabled + startHdaWatch + connectWs）。
   *  不激活、不 loadSnapshot——激活属于 activateSession。 */
  ensureSession(serial: string): void;
  /** 激活为活动成员：setSerial（清视图）+ bumpEpoch + loadSnapshot + setStatus("connecting")。
   *  未 ensure 先 ensure；会话已存在时不重建 WS、不重放 replay。 */
  activateSession(serial: string): void;
  /** 拆 WS + 停该成员 watchdog + 从 Map 删；若关的是活动成员 → 活动清空（setSerial("")）。 */
  closeSession(serial: string): void;
  setAutoRun(v: boolean): void;
  isEnsured(serial: string): boolean;
}

/** 多会话控制器：单活动成员 + 后台多会话（P2b 项目模式）。
 *  全局 store 永远镜像活动成员；后台成员的 WS 消息只更新自身状态（hasHello /
 *  replayPending / status），不碰 store / network / timeline / kick。 */
export function createSessionManager(deps: SessionDeps): SessionManager {
  const members = new Map<string, SessionMember>();
  let autoRun = deps.getAutoRun();
  const wsConnect = deps.connectWsFn ?? connectWs;

  const onMessage =
    (serial: string) =>
    (msg: SessionMessage): void => {
      const member = members.get(serial);
      if (!member) return; // 会话已被 closeSession 拆除
      const active = deps.getSerial() === serial;
      if (msg.type === "hello") {
        member.hasHello = true;
        member.replayPending = true; // a replay follows on every (re)connect - never auto-run on it
        if (!active) return; // 后台成员：标记自身，不碰 store / 不 kick
        deps.setStatus("ok");
        deps.log(`hello inputRev=${msg.inputRev} outputRev=${msg.outputRev}`);
        deps.kicker.onHello(serial);
      } else if (msg.type === "inputs") {
        if (!active) {
          // 后台成员：仅消费 replay 标记（对齐现语义：replay 随每次重连到来），不碰 store。
          member.replayPending = false;
          return;
        }
        deps.captureFrame(msg.frame as number | undefined, msg.inputs);
        const changed = !deps.inputsEqual(deps.getInputs(), msg.inputs);
        deps.setInputs(msg.inputs, msg.rev);
        deps.log(`inputs rev=${msg.rev} (${msg.inputs.length})${changed ? "" : " [unchanged]"}`);
        if (member.replayPending) {
          member.replayPending = false; // replay of current state on connect - not an update
          deps.log("inputs replay - network not run");
          return;
        }
        // gate auto-run on real content change: breaks the Force Cook <-> echo feedback loop
        if (autoRun && changed) void deps.network.run();
      } else if (msg.type === "outputs") {
        if (!active) return; // 后台成员：丢弃，不碰 store
        if (deps.isSyncEnabled() && msg.rev > deps.getOutputRev()) {
          deps.applyOutputs(msg.outputs, msg.rev);
        }
        deps.log(`outputs rev=${msg.rev} (${msg.outputs.length})${deps.isSyncEnabled() ? "" : " [sync OFF ignored]"}`);
      } else if (msg.type === "timeline") {
        if (!active) return; // 后台成员：丢弃（不碰 timeline）
        // H→C 时间轴推送（bridge 广播 Houdini playhead）：应用远端帧/fps。
        // 非法帧/拖动/未链接由 applyTimeline 的注入方（timeline.applyRemote）内部忽略。
        deps.applyTimeline?.(msg.frame as number, msg.fps as number);
      }
    };

  const onStatus =
    (serial: string) =>
    (open: boolean): void => {
      const member = members.get(serial);
      if (!member) return;
      member.status = open;
      deps.kicker.onStatus(open, serial); // 后台成员也过 kicker：WS 掉线按 serial 重新武装 kick
      if (deps.getSerial() === serial) deps.setStatus(open ? "ok" : "offline");
    };

  const ensureSession = (serialRaw: string): void => {
    const serial = serialRaw.trim();
    if (!serial || members.has(serial)) return; // 幂等：已建则 no-op
    const member: SessionMember = {
      wsDisconnect: null,
      stopWatch: null,
      replayPending: true, // 对齐旧 connect()：每次（重）连接首个 inputs 视为 replay
      status: false,
      hasHello: false,
    };
    members.set(serial, member);
    // 顺序对齐旧 connect()：先推 sync 配置，再起 watchdog，最后建 WS。
    // Push the persisted Sync Max FPS on EVERY (re)connect: the bridge keeps its
    // default 30 until the web tells it otherwise (first connect + reconnect).
    void deps.putSyncFps(serial, deps.getPrefsSyncMaxFps()).catch(() => undefined);
    // Phase B: push the manual two-way sync gate on EVERY (re)connect (default OFF).
    void deps.putSyncEnabled(serial, deps.isSyncEnabled()).catch(() => undefined);
    member.stopWatch = deps.startHdaWatch(serial) ?? null;
    deps.log(`connect ${serial}`);
    member.wsDisconnect = wsConnect(serial, onMessage(serial), onStatus(serial));
  };

  const activateSession = (serialRaw: string): void => {
    const serial = serialRaw.trim();
    if (!serial) return;
    if (!members.has(serial)) ensureSession(serial);
    // 激活不重建 WS、不重放 replay：会话已存在时直接镜像到活动成员。
    deps.setSerial(serial); // 清视图（store.setSerial 置空 inputs/outputs/rev）
    deps.network.bumpEpoch(); // discard in-flight runs from the previous serial
    void deps.loadSnapshot(serial);
    deps.setStatus("connecting");
  };

  const closeSession = (serialRaw: string): void => {
    const serial = serialRaw.trim();
    const member = members.get(serial);
    if (!member) return;
    member.wsDisconnect?.();
    member.stopWatch?.();
    members.delete(serial);
    deps.log(`close ${serial}`);
    if (deps.getSerial() === serial) {
      deps.setSerial(""); // 关的是活动成员 → 活动清空（清视图）
    }
  };

  const setAutoRun = (v: boolean): void => {
    autoRun = v;
  };

  const isEnsured = (serialRaw: string): boolean => members.has(serialRaw.trim());

  return { ensureSession, activateSession, closeSession, setAutoRun, isEnsured };
}
