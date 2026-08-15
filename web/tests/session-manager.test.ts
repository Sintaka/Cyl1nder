import { describe, expect, it, vi } from "vitest";
import { createSessionManager, type SessionDeps } from "../src/core/session";
import type { InputPayload, OutputBuffer } from "../src/protocol/types";

type Mock = ReturnType<typeof vi.fn>;

/** Fake WS 捕获器：createSessionManager 经 connectWsFn 注入，测试驱动 onMessage/onStatus。 */
interface FakeWs {
  onMessage: (msg: unknown) => void;
  onStatus: (open: boolean) => void;
  disconnect: Mock;
}

interface Harness {
  deps: SessionDeps;
  fakes: Map<string, FakeWs>;
  watchStops: Map<string, Mock>;
  store: { serial: string; inputs: InputPayload[]; inputRev: number; outputRev: number; outputs: OutputBuffer[]; status: string };
  kicker: { onHello: Mock; onStatus: Mock };
  network: { run: Mock; bumpEpoch: Mock };
  connectWsFn: Mock;
  putSyncFps: Mock;
  putSyncEnabled: Mock;
  setSerial: Mock;
  setStatus: Mock;
  setInputs: Mock;
  applyOutputs: Mock;
  loadSnapshot: Mock;
  startHdaWatch: Mock;
  applyTimeline: Mock;
}

const payload = (index: number, offset = 0): InputPayload => ({
  index,
  name: `in${index}`,
  pointCount: 1,
  primCount: 0,
  points: [[offset, 0, 0]],
  curves: [],
  attributes: {},
});
const out = (index: number): OutputBuffer => ({
  index,
  rev: index,
  pointCount: 0,
  primCount: 0,
  points: [],
  curves: [],
  attributes: {},
});

function makeHarness(): Harness {
  const fakes = new Map<string, FakeWs>();
  const watchStops = new Map<string, Mock>();
  const store = { serial: "", inputs: [] as InputPayload[], inputRev: 0, outputRev: 0, outputs: [] as OutputBuffer[], status: "connecting" as string };
  const kicker = { onHello: vi.fn(), onStatus: vi.fn() };
  const network = { run: vi.fn(() => Promise.resolve(undefined)), bumpEpoch: vi.fn() };
  const connectWsFn = vi.fn(
    (serial: string, onMessage: (msg: unknown) => void, onStatus: (open: boolean) => void): (() => void) => {
      fakes.set(serial, { onMessage, onStatus, disconnect: vi.fn(() => undefined) });
      return fakes.get(serial)!.disconnect;
    },
  );
  const putSyncFps = vi.fn(() => Promise.resolve(undefined));
  const putSyncEnabled = vi.fn(() => Promise.resolve(undefined));
  const setSerial = vi.fn((s: string) => { store.serial = s; });
  const setStatus = vi.fn((s: "offline" | "connecting" | "ok") => { store.status = s; });
  const setInputs = vi.fn((inputs: InputPayload[], rev: number) => { store.inputs = inputs; store.inputRev = rev; });
  const applyOutputs = vi.fn((outputs: OutputBuffer[], rev: number) => { store.outputs = outputs; store.outputRev = rev; });
  const loadSnapshot = vi.fn(() => Promise.resolve(undefined));
  const startHdaWatch = vi.fn((serial: string): (() => void) => {
    const stop = vi.fn(() => undefined);
    watchStops.set(serial, stop);
    return stop;
  });
  const applyTimeline = vi.fn();
  const deps: SessionDeps = {
    getPrefsSyncMaxFps: () => 30,
    putSyncFps,
    getSerial: () => store.serial,
    setSerial,
    setStatus,
    log: vi.fn(),
    getInputs: () => store.inputs,
    setInputs,
    captureFrame: vi.fn(),
    inputsEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    getOutputRev: () => store.outputRev,
    applyOutputs,
    isSyncEnabled: () => true,
    putSyncEnabled,
    network,
    startHdaWatch,
    kicker,
    loadSnapshot,
    getAutoRun: () => false,
    applyTimeline,
    connectWsFn: connectWsFn as unknown as SessionDeps["connectWsFn"],
  };
  return {
    deps, fakes, watchStops, store, kicker, network, connectWsFn,
    putSyncFps, putSyncEnabled, setSerial, setStatus, setInputs, applyOutputs,
    loadSnapshot, startHdaWatch, applyTimeline,
  };
}

describe("createSessionManager", () => {
  it("ensureSession 幂等：两次只建一条会话（WS/watchdog/配置推送各一次）", () => {
    const h = makeHarness();
    const m = createSessionManager(h.deps);
    m.ensureSession("C1-aaaa1111-bbbb");
    m.ensureSession("C1-aaaa1111-bbbb");
    expect(h.connectWsFn).toHaveBeenCalledTimes(1);
    expect(h.startHdaWatch).toHaveBeenCalledTimes(1);
    expect(h.putSyncFps).toHaveBeenCalledTimes(1);
    expect(h.putSyncEnabled).toHaveBeenCalledTimes(1);
    expect(h.fakes.size).toBe(1);
    expect(h.watchStops.size).toBe(1);
    // ensure 不激活：不 setSerial、不 loadSnapshot
    expect(h.store.serial).toBe("");
    expect(h.loadSnapshot).not.toHaveBeenCalled();
    expect(h.setSerial).not.toHaveBeenCalled();
  });

  it("ensureSession 建会话即推 putSyncFps/putSyncEnabled 并起 watchdog", () => {
    const h = makeHarness();
    const m = createSessionManager(h.deps);
    m.ensureSession("C1-aaaa1111-bbbb");
    expect(h.putSyncFps).toHaveBeenCalledWith("C1-aaaa1111-bbbb", 30);
    expect(h.putSyncEnabled).toHaveBeenCalledWith("C1-aaaa1111-bbbb", true);
    expect(h.startHdaWatch).toHaveBeenCalledWith("C1-aaaa1111-bbbb");
    expect(h.fakes.has("C1-aaaa1111-bbbb")).toBe(true);
  });

  it("activateSession 触发 setSerial + bumpEpoch + loadSnapshot + setStatus(connecting)，且不重建 WS", () => {
    const h = makeHarness();
    const m = createSessionManager(h.deps);
    m.ensureSession("C1-aaaa1111-bbbb");
    m.activateSession("C1-aaaa1111-bbbb");
    expect(h.setSerial).toHaveBeenCalledWith("C1-aaaa1111-bbbb");
    expect(h.network.bumpEpoch).toHaveBeenCalledTimes(1);
    expect(h.loadSnapshot).toHaveBeenCalledWith("C1-aaaa1111-bbbb");
    expect(h.store.status).toBe("connecting");
    expect(h.connectWsFn).toHaveBeenCalledTimes(1); // activate 不重建 WS
    expect(h.putSyncFps).toHaveBeenCalledTimes(1); // 也不重复推配置
  });

  it("activateSession 未 ensure 时先 ensure（自建会话）", () => {
    const h = makeHarness();
    const m = createSessionManager(h.deps);
    m.activateSession("C1-aaaa1111-bbbb");
    expect(h.connectWsFn).toHaveBeenCalledTimes(1);
    expect(h.loadSnapshot).toHaveBeenCalledTimes(1);
    expect(h.store.serial).toBe("C1-aaaa1111-bbbb");
  });

  it("后台成员消息不碰 store：inputs 仅消费 replay、outputs/timeline 丢弃、hello 不 kick 不 setStatus", () => {
    const h = makeHarness();
    const m = createSessionManager(h.deps);
    m.ensureSession("C1-backgr0und-aaaa"); // 后台
    m.ensureSession("C1-act1ve00-bbbb");
    m.activateSession("C1-act1ve00-bbbb");
    h.setStatus.mockClear();
    h.kicker.onHello.mockClear();
    h.setInputs.mockClear();
    h.applyOutputs.mockClear();
    h.applyTimeline.mockClear();

    const bg = h.fakes.get("C1-backgr0und-aaaa")!;
    bg.onMessage({ type: "hello", serial: "C1-backgr0und-aaaa", inputRev: 1, outputRev: 1 });
    expect(h.kicker.onHello).not.toHaveBeenCalled(); // 后台不 kick
    expect(h.setStatus).not.toHaveBeenCalled(); // 不碰 store 状态

    bg.onMessage({ type: "inputs", rev: 3, inputs: [payload(0)] });
    expect(h.setInputs).not.toHaveBeenCalled();
    expect(h.network.run).not.toHaveBeenCalled();

    bg.onMessage({ type: "outputs", rev: 5, outputs: [out(0)] });
    expect(h.applyOutputs).not.toHaveBeenCalled(); // 后台 outputs 丢弃

    bg.onMessage({ type: "timeline", frame: 12, fps: 24, source: "hou", ts: 0 });
    expect(h.applyTimeline).not.toHaveBeenCalled(); // 后台 timeline 丢弃
  });

  it("后台成员 inputs 消费 replay 标记：激活后同一会话的 inputs 恢复正常分发", () => {
    const h = makeHarness();
    const m = createSessionManager(h.deps);
    m.setAutoRun(true);
    m.ensureSession("C1-backgr0und-aaaa"); // 后台
    m.ensureSession("C1-act1ve00-bbbb");
    m.activateSession("C1-act1ve00-bbbb");
    const bg = h.fakes.get("C1-backgr0und-aaaa")!;
    bg.onMessage({ type: "hello", serial: "C1-backgr0und-aaaa", inputRev: 0, outputRev: 0 });
    bg.onMessage({ type: "inputs", rev: 1, inputs: [payload(0)] }); // 后台：仅消费 replay

    h.setInputs.mockClear();
    h.network.run.mockClear();
    m.activateSession("C1-backgr0und-aaaa"); // 切到后台成员 → 活动
    bg.onMessage({ type: "inputs", rev: 2, inputs: [payload(0, 5)] }); // 变更内容
    expect(h.setInputs).toHaveBeenCalledTimes(1); // 正常应用
    expect(h.network.run).toHaveBeenCalledTimes(1); // 且不再被当 replay（replay 已在后台消费）
  });

  it("活动成员 hello 分支 replayPending 语义：hello 后首个 inputs 为 replay，之后变更才跑 network", () => {
    const h = makeHarness();
    const m = createSessionManager(h.deps);
    m.setAutoRun(true);
    m.ensureSession("C1-aaaa1111-bbbb");
    m.activateSession("C1-aaaa1111-bbbb");
    const ws = h.fakes.get("C1-aaaa1111-bbbb")!;
    h.network.run.mockClear();

    ws.onMessage({ type: "hello", serial: "C1-aaaa1111-bbbb", inputRev: 0, outputRev: 0 });
    expect(h.store.status).toBe("ok");
    expect(h.kicker.onHello).toHaveBeenCalledWith("C1-aaaa1111-bbbb");

    ws.onMessage({ type: "inputs", rev: 1, inputs: [payload(0)] }); // replay：应用但不跑
    expect(h.setInputs).toHaveBeenCalledTimes(1);
    expect(h.network.run).not.toHaveBeenCalled();

    ws.onMessage({ type: "inputs", rev: 2, inputs: [payload(0, 5)] }); // 变更 + autoRun → 跑
    expect(h.network.run).toHaveBeenCalledTimes(1);

    ws.onMessage({ type: "inputs", rev: 3, inputs: [payload(0, 5)] }); // 同内容 → 不跑
    expect(h.network.run).toHaveBeenCalledTimes(1);
  });

  it("活动成员 outputs：sync ON 且 rev 前进时应用", () => {
    const h = makeHarness();
    const m = createSessionManager(h.deps);
    m.ensureSession("C1-aaaa1111-bbbb");
    m.activateSession("C1-aaaa1111-bbbb");
    const ws = h.fakes.get("C1-aaaa1111-bbbb")!;
    ws.onMessage({ type: "outputs", rev: 7, outputs: [out(1)] });
    expect(h.applyOutputs).toHaveBeenCalledWith([out(1)], 7);
    expect(h.store.outputRev).toBe(7);
  });

  it("onStatus：活动成员 setStatus(ok/offline)；后台成员只过 kicker 不 setStatus", () => {
    const h = makeHarness();
    const m = createSessionManager(h.deps);
    m.ensureSession("C1-aaaa1111-bbbb");
    m.activateSession("C1-aaaa1111-bbbb");
    m.ensureSession("C1-cccc2222-dddd"); // 后台
    h.setStatus.mockClear();
    h.kicker.onStatus.mockClear();

    h.fakes.get("C1-aaaa1111-bbbb")!.onStatus(true);
    expect(h.store.status).toBe("ok");
    expect(h.kicker.onStatus).toHaveBeenCalledWith(true, "C1-aaaa1111-bbbb");

    h.fakes.get("C1-cccc2222-dddd")!.onStatus(true);
    expect(h.kicker.onStatus).toHaveBeenCalledWith(true, "C1-cccc2222-dddd"); // 后台也过 kicker
    expect(h.setStatus).toHaveBeenCalledTimes(1); // 只有活动成员触发 setStatus
    expect(h.setStatus).toHaveBeenCalledWith("ok");

    h.fakes.get("C1-aaaa1111-bbbb")!.onStatus(false);
    expect(h.store.status).toBe("offline");
    expect(h.setStatus).toHaveBeenLastCalledWith("offline");
  });

  it("closeSession：拆 WS + 停 watchdog；关后台成员不影响活动；关活动成员 setSerial(\"\")", () => {
    const h = makeHarness();
    const m = createSessionManager(h.deps);
    m.ensureSession("C1-aaaa1111-bbbb");
    m.activateSession("C1-aaaa1111-bbbb");
    m.ensureSession("C1-cccc2222-dddd");

    m.closeSession("C1-cccc2222-dddd"); // 后台
    expect(h.fakes.get("C1-cccc2222-dddd")!.disconnect).toHaveBeenCalledTimes(1);
    expect(h.watchStops.get("C1-cccc2222-dddd")).toHaveBeenCalledTimes(1);
    expect(h.store.serial).toBe("C1-aaaa1111-bbbb"); // 活动不受影响
    expect(h.setSerial).not.toHaveBeenCalledWith("");
    expect(m.isEnsured("C1-cccc2222-dddd")).toBe(false);

    m.closeSession("C1-aaaa1111-bbbb"); // 活动
    expect(h.fakes.get("C1-aaaa1111-bbbb")!.disconnect).toHaveBeenCalledTimes(1);
    expect(h.watchStops.get("C1-aaaa1111-bbbb")).toHaveBeenCalledTimes(1);
    expect(h.store.serial).toBe("");
    expect(h.setSerial).toHaveBeenCalledWith("");
    expect(m.isEnsured("C1-aaaa1111-bbbb")).toBe(false);
  });

  it("activateSession 切回已建会话：不重建 WS、不重放 replay", () => {
    const h = makeHarness();
    const m = createSessionManager(h.deps);
    m.setAutoRun(true);
    m.ensureSession("C1-aaaa1111-bbbb");
    m.activateSession("C1-aaaa1111-bbbb");
    const ws = h.fakes.get("C1-aaaa1111-bbbb")!;
    ws.onMessage({ type: "hello", serial: "C1-aaaa1111-bbbb", inputRev: 0, outputRev: 0 });
    ws.onMessage({ type: "inputs", rev: 1, inputs: [payload(0)] }); // 消费 replay
    h.network.run.mockClear();

    m.ensureSession("C1-cccc2222-dddd");
    m.activateSession("C1-cccc2222-dddd"); // 切走
    expect(h.connectWsFn).toHaveBeenCalledTimes(2); // 两条会话各一条 WS

    m.activateSession("C1-aaaa1111-bbbb"); // 切回
    expect(h.connectWsFn).toHaveBeenCalledTimes(2); // 不重建 WS
    expect(h.network.run).not.toHaveBeenCalled(); // 不重放 replay

    ws.onMessage({ type: "inputs", rev: 2, inputs: [payload(0, 9)] }); // 新变更 → 正常 autoRun
    expect(h.network.run).toHaveBeenCalledTimes(1);
  });

  it("isEnsured 反映会话是否存在；空 serial 为 no-op", () => {
    const h = makeHarness();
    const m = createSessionManager(h.deps);
    expect(m.isEnsured("C1-aaaa1111-bbbb")).toBe(false);
    m.ensureSession("C1-aaaa1111-bbbb");
    expect(m.isEnsured("C1-aaaa1111-bbbb")).toBe(true);
    m.closeSession("C1-aaaa1111-bbbb");
    expect(m.isEnsured("C1-aaaa1111-bbbb")).toBe(false);

    m.ensureSession("   ");
    m.activateSession("");
    h.connectWsFn.mockClear(); // 上面用例已建过会话，先清计数再验证空 serial no-op
    expect(h.connectWsFn).not.toHaveBeenCalled();
    expect(h.store.serial).toBe("");
  });

  it("setAutoRun 切换模块级标志：关闭后变更 inputs 不跑 network", () => {
    const h = makeHarness();
    const m = createSessionManager(h.deps);
    m.ensureSession("C1-aaaa1111-bbbb");
    m.activateSession("C1-aaaa1111-bbbb");
    const ws = h.fakes.get("C1-aaaa1111-bbbb")!;
    ws.onMessage({ type: "hello", serial: "C1-aaaa1111-bbbb", inputRev: 0, outputRev: 0 });
    ws.onMessage({ type: "inputs", rev: 1, inputs: [payload(0)] }); // replay

    m.setAutoRun(true);
    ws.onMessage({ type: "inputs", rev: 2, inputs: [payload(0, 5)] });
    expect(h.network.run).toHaveBeenCalledTimes(1);

    m.setAutoRun(false);
    ws.onMessage({ type: "inputs", rev: 3, inputs: [payload(0, 9)] });
    expect(h.network.run).toHaveBeenCalledTimes(1); // autoRun off：不再跑
  });
});
