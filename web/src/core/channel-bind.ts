/**
 * 通道绑定管理器（P5b）：把节点参数绑定（paramName → 通道 absolutePath）变成
 * web ⇄ Houdini 的双向同步。
 *
 * - web→H（onNodeParamsCommitted）：param 面板编辑 / gizmo 拖动经 setNodeParams 改参后调用；
 *   取该节点 bindings，bound 参数中「值与上次成功提交不同」的项并入 pending
 *   （absolutePath → value，latest-wins）→ 1000/fps 定时 flush（单飞行）→
 *   client.putChannelValues(serial, pending)。成功后把该路径最后写者的 key 记入 lastSent
 *   （下次同值提交为 no-op）；失败则 lastSent 不动 → 下次同值提交仍判定为变化，自然重试。
 * - H→web（applyIncoming）：WS 推送 / 250ms 轮询（经 channel-panel 的 onValues 转发）拿到的值，
 *   遍历绑定：values[path] 存在且与节点当前值不同 → applyNodeParamPatch（每节点一次）。
 *   防回环：值等于 pending 中本节点刚提交的 / lastSent 中本参数上次提交的 → 跳过
 *   （编辑发出后的回声不触发节点重写）。
 *
 * 纯逻辑、无 DOM：fake deps 直接单测（web/tests/channel-bind.test.ts）。
 * 节流照 channel-panel.ts 的 pending/flush 模式（实例级闭包 + 单飞行）。
 */
import { BridgeClient } from "../bridge/client";

/** listNodeParamBindings() 单节点条目：id / label + 当前参数值 + paramName → 通道 absolutePath。 */
export interface NodeParamBinding {
  id: string;
  label: string;
  params: { name: string; value: unknown }[];
  bindings: Record<string, string>;
}

export interface ChannelBindDeps {
  /** 当前活动 serial（tag serial）。空串 = 无连接。 */
  getSerial(): string;
  /** 提交节流 fps（1..60，缺省 30）：flush 间隔 = 1000/fps ms。 */
  getSyncMaxFps(): number;
  client: BridgeClient;
  /** 全部带绑定的节点（nodes2/graph.ts listNodeParamBindings，main.ts 注入）。 */
  listNodeParamBindings(): NodeParamBinding[];
  /** 值变化才应用；返回是否实际变化（main.ts：setNodeParams 合并 + network.run()）。 */
  applyNodeParamPatch(id: string, patch: Record<string, unknown>): boolean;
}

export interface ChannelBindManager {
  /** 节点参数提交后调用（param 面板编辑 / gizmo 拖动）：提取 bound 变化 → pending。 */
  onNodeParamsCommitted(id: string, params: { name: string; value: unknown }[]): void;
  /** H→C 值（WS 推送 / 轮询）应用到绑定节点 params（值对比防回环）。 */
  applyIncoming(values: Record<string, unknown>): void;
  /** 立即 flush pending（测试与页面卸载用）。 */
  flushNow(): Promise<void>;
  /** 停掉内部定时器。 */
  dispose(): void;
}

const FPS_DEFAULT = 30;
const FPS_MIN = 1;
const FPS_MAX = 60;
/** flush 间隔下限（ms）：fps 再高也不低于此（照 channel-panel.ts）。 */
const FLUSH_MIN_MS = 17;

/** fps 钳制到 1..60（非法 → 30），flush 间隔 = 1000/fps。 */
function clampFps(v: number): number {
  if (!Number.isFinite(v)) return FPS_DEFAULT;
  return Math.min(FPS_MAX, Math.max(FPS_MIN, Math.round(v)));
}

/**
 * 通道绑定管理器工厂。实例级闭包状态（pending / lastSent / 定时器），
 * 与 channel-panel.ts 的 pending/flush 节流同款模式。
 */
export function createChannelBindManager(deps: ChannelBindDeps): ChannelBindManager {
  // lastSent：`${id}:${name}` → 上次成功提交给 Houdini 的值（提交对比基准 + 回环判定）。
  const lastSent = new Map<string, unknown>();
  // pending：absolutePath → value（latest-wins）；flush 时快照清空，PUT 期间的编辑进新 pending 不断流。
  let pending = new Map<string, unknown>();
  // pendingOwner：absolutePath → 最后写者 key（`${id}:${name}`）——flush 成功后只把真正提交过的
  // 绑定记入 lastSent；多节点绑定同一通道时，其它节点的跟随更新不被误判为回环。
  let pendingOwner = new Map<string, string>();
  let serial = "";
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let flushing = false;
  let disposed = false;

  /** serial 变化时清空 pending/lastSent（旧场景的编辑不写进新场景，回环判定不串号）。 */
  function ensureSerial(): string {
    const s = deps.getSerial();
    if (s !== serial) {
      serial = s;
      pending = new Map();
      pendingOwner = new Map();
      lastSent.clear();
    }
    return s;
  }

  /** 取该节点 bindings；bound 参数中值与 lastSent 不同的项并入 pending（latest-wins）。 */
  function collectChanges(id: string, params: { name: string; value: unknown }[]): void {
    const node = deps.listNodeParamBindings().find((n) => n.id === id);
    if (!node) return;
    const bindings = node.bindings ?? {};
    const byName = new Map(params.map((p) => [p.name, p.value]));
    for (const [name, path] of Object.entries(bindings)) {
      if (!byName.has(name)) continue; // 本次提交未含该参数 → 不动
      const value = byName.get(name);
      const key = `${id}:${name}`;
      if (Object.is(lastSent.get(key), value)) continue; // 与上次成功提交相同 → 无变化
      pending.set(path, value);
      pendingOwner.set(path, key); // latest-wins：最后写者覆盖旧写者
    }
  }

  /** 节流 flush：pending 快照后立即清空（单飞行，避免并发 PUT 乱序）。 */
  async function flushPending(serial: string): Promise<void> {
    if (flushing) return;
    const batch = pending;
    if (batch.size === 0) return;
    const owners = pendingOwner;
    pending = new Map();
    pendingOwner = new Map();
    flushing = true;
    let r: { ok: boolean; error?: string };
    try {
      r = await deps.client.putChannelValues(serial, Object.fromEntries(batch));
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      flushing = false;
    }
    if (r.ok) {
      // 成功后：最后写者 key 记为已提交值（下次同值提交为 no-op）
      for (const [path, key] of owners) lastSent.set(key, batch.get(path));
    }
    // 失败：lastSent 不动（等价回滚）→ 下次同值提交仍判定为变化 → 自然重试
  }

  function onNodeParamsCommitted(id: string, params: { name: string; value: unknown }[]): void {
    if (disposed) return;
    if (!ensureSerial()) return; // 无连接：无绑定节点可提交
    collectChanges(id, params);
  }

  /** 防回环：值等于 pending 中本节点刚提交的 / lastSent 中本参数上次提交的 → 编辑回声，跳过。 */
  function isEcho(id: string, name: string, path: string, value: unknown): boolean {
    const key = `${id}:${name}`;
    const owner = pendingOwner.get(path);
    if (owner !== undefined && owner === key && Object.is(pending.get(path), value)) return true;
    return Object.is(lastSent.get(key), value);
  }

  function applyIncoming(values: Record<string, unknown>): void {
    if (disposed) return;
    ensureSerial();
    for (const node of deps.listNodeParamBindings()) {
      const bindings = node.bindings ?? {};
      const current = new Map(node.params.map((p) => [p.name, p.value]));
      const patch: Record<string, unknown> = {};
      for (const [name, path] of Object.entries(bindings)) {
        if (!Object.prototype.hasOwnProperty.call(values, path)) continue; // 非绑定通道 → 忽略
        const incoming = values[path];
        if (Object.is(current.get(name), incoming)) continue; // 与节点当前值相同 → 不写
        if (isEcho(node.id, name, path, incoming)) continue; // 刚提交的回声 → 不写（防回环）
        patch[name] = incoming;
      }
      if (Object.keys(patch).length > 0) deps.applyNodeParamPatch(node.id, patch);
    }
  }

  async function flushNow(): Promise<void> {
    if (disposed) return;
    const s = ensureSerial();
    if (!s) return;
    await flushPending(s);
  }

  function dispose(): void {
    disposed = true;
    if (flushTimer !== null) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    pending = new Map();
    pendingOwner = new Map();
    lastSent.clear();
  }

  // 定时 flush（1000/fps ms，照 channel-panel.ts）；pending 为空时 tick 为 no-op。
  flushTimer = setInterval(() => {
    if (disposed) return;
    const s = ensureSerial();
    if (!s) return;
    void flushPending(s);
  }, Math.max(FLUSH_MIN_MS, Math.round(1000 / clampFps(deps.getSyncMaxFps()))));

  return { onNodeParamsCommitted, applyIncoming, flushNow, dispose };
}
