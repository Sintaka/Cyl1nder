import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeClient } from "../src/bridge/client";
import { createChannelBindManager, type ChannelBindDeps, type NodeParamBinding } from "../src/core/channel-bind";

// ---- fake deps（无 DOM / 无网络）：绑定列表 + patch 应用 + 假 client ----

interface FakeClient {
  putChannelValues: ReturnType<typeof vi.fn>;
}

let nodes: NodeParamBinding[];
let serial: string;
let client: FakeClient;
let patched: { id: string; patch: Record<string, unknown> }[];

/** 更新 fake 节点参数（模拟 setNodeParams 已生效）后再通知管理器（同真实 main.ts 接线顺序）。 */
function commit(mgr: ReturnType<typeof createChannelBindManager>, id: string, params: { name: string; value: unknown }[]): void {
  const node = nodes.find((n) => n.id === id);
  if (node) {
    for (const p of params) {
      const hit = node.params.find((x) => x.name === p.name);
      if (hit) hit.value = p.value;
    }
  }
  mgr.onNodeParamsCommitted(id, params);
}

function makeManager(): ReturnType<typeof createChannelBindManager> {
  const deps: ChannelBindDeps = {
    getSerial: () => serial,
    getSyncMaxFps: () => 30,
    client: client as unknown as BridgeClient,
    listNodeParamBindings: () => nodes,
    applyNodeParamPatch: (id, patch) => {
      patched.push({ id, patch });
      const node = nodes.find((n) => n.id === id);
      if (node) {
        for (const [k, v] of Object.entries(patch)) {
          const hit = node.params.find((p) => p.name === k);
          if (hit) hit.value = v;
        }
      }
      return true;
    },
  };
  return createChannelBindManager(deps);
}

const node = (id: string, bindings: Record<string, string>, values: Record<string, unknown> = {}): NodeParamBinding => ({
  id,
  label: id,
  params: Object.entries(values).map(([name, value]) => ({ name, value })),
  bindings,
});

beforeEach(() => {
  vi.useFakeTimers();
  serial = "C1-test";
  nodes = [];
  client = { putChannelValues: vi.fn(async () => ({ ok: true })) };
  patched = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("onNodeParamsCommitted（web→H 提交提取 + 节流 flush）", () => {
  it("无绑定节点 → no-op（不 PUT）", async () => {
    const mgr = makeManager();
    commit(mgr, "n1", [{ name: "tx", value: 1 }]); // 无此节点
    await vi.advanceTimersByTimeAsync(200);
    expect(client.putChannelValues).not.toHaveBeenCalled();
    mgr.dispose();
  });

  it("绑定未变：首次提交发 PUT；同值再提交不重复发", async () => {
    nodes = [node("n1", { tx: "/obj/geo1/transform1/tx" }, { tx: 1 })];
    const mgr = makeManager();
    commit(mgr, "n1", [{ name: "tx", value: 1 }]); // lastSent 空 → 变化
    await vi.advanceTimersByTimeAsync(100);
    expect(client.putChannelValues).toHaveBeenCalledTimes(1);
    expect(client.putChannelValues).toHaveBeenCalledWith("C1-test", { "/obj/geo1/transform1/tx": 1 });

    commit(mgr, "n1", [{ name: "tx", value: 1 }]); // 同值再提交 → no-op
    await vi.advanceTimersByTimeAsync(200);
    expect(client.putChannelValues).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });

  it("绑定变化 → pending 合并 latest-wins（同通道多次编辑只发最后值，不同通道累积）", async () => {
    nodes = [node("n1", { tx: "/t", ty: "/ty" }, { tx: 0, ty: 0 })];
    const mgr = makeManager();
    commit(mgr, "n1", [{ name: "tx", value: 1 }]);
    commit(mgr, "n1", [{ name: "tx", value: 2 }]); // 覆盖
    commit(mgr, "n1", [{ name: "ty", value: 5 }]); // 累积
    await vi.advanceTimersByTimeAsync(200);
    expect(client.putChannelValues).toHaveBeenCalledTimes(1);
    expect(client.putChannelValues).toHaveBeenCalledWith("C1-test", { "/t": 2, "/ty": 5 });
    mgr.dispose();
  });

  it("节流：flush 间隔内不 PUT，到点才发（fps=30 → 33ms）", async () => {
    nodes = [node("n1", { tx: "/t" }, { tx: 0 })];
    const mgr = makeManager();
    commit(mgr, "n1", [{ name: "tx", value: 1 }]);
    await vi.advanceTimersByTimeAsync(32); // 未到点
    expect(client.putChannelValues).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); // 33ms 到点
    expect(client.putChannelValues).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });

  it("flush 失败回滚 lastSent：同值再提交仍触发 PUT（下次重试）", async () => {
    nodes = [node("n1", { tx: "/t" }, { tx: 0 })];
    client.putChannelValues = vi.fn(async () => ({ ok: false, error: "bridge down" }));
    const mgr = makeManager();
    commit(mgr, "n1", [{ name: "tx", value: 1 }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(client.putChannelValues).toHaveBeenCalledTimes(1);
    commit(mgr, "n1", [{ name: "tx", value: 1 }]); // 同值再提交 → 仍判定变化（lastSent 未推进）
    await vi.advanceTimersByTimeAsync(100);
    expect(client.putChannelValues).toHaveBeenCalledTimes(2);
    mgr.dispose();
  });
});

describe("applyIncoming（H→web 值应用 + 防回环）", () => {
  it("新值 → applyNodeParamPatch 每节点一次、patch 正确", () => {
    nodes = [node("n1", { tx: "/t" }, { tx: 0 })];
    const mgr = makeManager();
    mgr.applyIncoming({ "/t": 2.5 });
    expect(patched).toEqual([{ id: "n1", patch: { tx: 2.5 } }]);
    expect(nodes[0].params.find((p) => p.name === "tx")!.value).toBe(2.5);
    mgr.dispose();
  });

  it("与节点当前值相同 → 不调（无变化不写）", () => {
    nodes = [node("n1", { tx: "/t" }, { tx: 1 })];
    const mgr = makeManager();
    mgr.applyIncoming({ "/t": 1 });
    expect(patched).toEqual([]);
    mgr.dispose();
  });

  it("防回环：提交后（pending 未 flush）同值回声 → 跳过", () => {
    nodes = [node("n1", { tx: "/t" }, { tx: 0 })];
    const mgr = makeManager();
    commit(mgr, "n1", [{ name: "tx", value: 1 }]); // pending{/t:1}，owner=n1:tx
    mgr.applyIncoming({ "/t": 1 }); // 回声
    expect(patched).toEqual([]);
    mgr.dispose();
  });

  it("防回环：flush 成功后同值回声 → 跳过（lastSent 命中，节点值被改走也不重写）", async () => {
    nodes = [node("n1", { tx: "/t" }, { tx: 0 })];
    const mgr = makeManager();
    commit(mgr, "n1", [{ name: "tx", value: 1 }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(client.putChannelValues).toHaveBeenCalledTimes(1);
    nodes[0].params[0].value = 3; // 模拟节点值被其它路径改走
    mgr.applyIncoming({ "/t": 1 }); // 我们刚提交的 1 的回声 → 跳过
    expect(patched).toEqual([]);
    mgr.applyIncoming({ "/t": 2 }); // 真变化 → 应用
    expect(patched).toEqual([{ id: "n1", patch: { tx: 2 } }]);
    mgr.dispose();
  });

  it("非绑定通道值 → 忽略", () => {
    nodes = [node("n1", { tx: "/t" }, { tx: 0 })];
    const mgr = makeManager();
    mgr.applyIncoming({ "/other/channel": 99 });
    expect(patched).toEqual([]);
    mgr.dispose();
  });

  it("多节点绑定同一通道：编辑节点的回声跳过，其它节点跟随更新", async () => {
    nodes = [
      node("n1", { tx: "/t" }, { tx: 0 }),
      node("n2", { ty: "/t" }, { ty: 0 }),
    ];
    const mgr = makeManager();
    commit(mgr, "n1", [{ name: "tx", value: 5 }]); // n1 编辑 → pending{/t:5} owner=n1:tx
    await vi.advanceTimersByTimeAsync(100); // flush 成功 → lastSent 只记 n1:tx
    mgr.applyIncoming({ "/t": 5 }); // Houdini 回声
    // n1：lastSent 命中 → 跳过；n2：跟随更新到 5
    expect(patched).toEqual([{ id: "n2", patch: { ty: 5 } }]);
    mgr.dispose();
  });
});

describe("flushNow / dispose / serial 变化", () => {
  it("flushNow 立即发 pending（不等定时器）", async () => {
    nodes = [node("n1", { tx: "/t" }, { tx: 0 })];
    const mgr = makeManager();
    commit(mgr, "n1", [{ name: "tx", value: 1 }]);
    expect(client.putChannelValues).not.toHaveBeenCalled();
    await mgr.flushNow();
    expect(client.putChannelValues).toHaveBeenCalledTimes(1);
    expect(client.putChannelValues).toHaveBeenCalledWith("C1-test", { "/t": 1 });
    mgr.dispose();
  });

  it("dispose 后不再提交", async () => {
    nodes = [node("n1", { tx: "/t" }, { tx: 0 })];
    const mgr = makeManager();
    mgr.dispose();
    commit(mgr, "n1", [{ name: "tx", value: 1 }]);
    await vi.advanceTimersByTimeAsync(200);
    expect(client.putChannelValues).not.toHaveBeenCalled();
  });

  it("serial 变化：旧 pending 丢弃不写进新场景；新 serial 下提交正常", async () => {
    nodes = [node("n1", { tx: "/t" }, { tx: 0 })];
    const mgr = makeManager();
    commit(mgr, "n1", [{ name: "tx", value: 1 }]); // 旧 serial 下编辑
    serial = "C2-other"; // 切换 serial
    await vi.advanceTimersByTimeAsync(200); // 旧 pending 被清 → 不 PUT
    expect(client.putChannelValues).not.toHaveBeenCalled();
    commit(mgr, "n1", [{ name: "tx", value: 2 }]); // 新 serial 下新提交
    await vi.advanceTimersByTimeAsync(100);
    expect(client.putChannelValues).toHaveBeenCalledTimes(1);
    expect(client.putChannelValues).toHaveBeenCalledWith("C2-other", { "/t": 2 });
    mgr.dispose();
  });
});
