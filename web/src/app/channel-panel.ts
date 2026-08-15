/**
 * 通道参数面板（P5a）：列出当前 serial 的 param 通道（吊牌注册），显示/编辑当前值。
 *
 * - 值输入：数字（typeof v === "number"）→ <input type="number" step="any">，
 *   字符串/布尔 → text。
 * - 编辑提交：input change → 该行标记 editing（WS 推送不覆盖）→ 节流 latest-wins
 *   （实例内 pending map + 1000/sync_fps 定时 flush；flush 时 putChannelValues，
 *   结算后清 pending + editing，错误显示在面板顶部提示）。
 * - 回显：WS {type:"channel-values"} 推送经 applyValues 即时刷新；250ms 轮询兜底
 *   （仅 deps.isVisible() && 有 serial 时）调 getChannelValues。
 * - serial 变化 → 重拉列表 + 清 pending；断开/无通道 → 占位文案。
 *
 * 纯逻辑（isNumericValue / parseInput / mergeValues / mergePending）独立导出，
 * 供 web/tests/channel-panel.test.ts 直接单测（无 DOM）。
 */
import "../styles/channel-panel.css";
import { BridgeClient } from "../bridge/client";
import type { ChannelRef } from "../protocol/types";

export interface ChannelPanelDeps {
  /** 当前活动 serial（store.serial）。空串 = 无连接 → 占位。 */
  getSerial(): string;
  /** 面板提交节流 fps（1..60，缺省 30）：flush 间隔 = 1000/fps ms。 */
  getSyncMaxFps(): number;
  /** 面板可见性（轮询门控）。dock 注入：容器 isConnected（dockview 隐藏 tab 时
   *  内容元素脱离 DOM）+ document.visibilityState。 */
  isVisible(): boolean;
  /** P5b：H→C 值转发——WS 推送 / 250ms 轮询 / 首屏拉取拿到 values 后都回调
   *  （main.ts 注入绑定管理器的 applyIncoming）。可选；缺省不接线行为不变。 */
  onValues?(values: Record<string, unknown>): void;
}

export interface ChannelPanelHandle {
  /** WS 推送即时刷新（编辑中的行不覆盖）。 */
  applyValues(values: Record<string, unknown>): void;
  /** 重拉通道列表（serial 变化 / 手动刷新）。 */
  refresh(): Promise<void>;
  /** 停掉内部定时器（面板关闭时调用）。 */
  dispose(): void;
}

/** 数字判据：typeof v === "number" → number 输入框；字符串/布尔 → text。 */
export function isNumericValue(v: unknown): boolean {
  return typeof v === "number";
}

/** number 输入解析：空白/非法文本回退 prev（不推脏值）；合法数字 → number。 */
export function parseInput(text: string, prev: unknown): unknown {
  const t = text.trim();
  if (t === "") return prev;
  const n = Number(t);
  return Number.isFinite(n) ? n : prev;
}

/** WS 推送合并：incoming 只覆盖未在编辑中的行；其余（含编辑行）保留 current。
 *  返回同一个 current 对象（就地合并）。 */
export function mergeValues(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  editingKeys: ReadonlySet<string> | readonly string[],
): Record<string, unknown> {
  const editing = editingKeys instanceof Set ? editingKeys : new Set(editingKeys);
  for (const k of Object.keys(incoming)) {
    if (editing.has(k)) continue;
    current[k] = incoming[k];
  }
  return current;
}

/** 节流 pending 合并（latest-wins）：后到值覆盖同 key 旧值，不同 key 累积。
 *  返回同一个 pending 对象（就地合并）。 */
export function mergePending(
  pending: Record<string, unknown>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  for (const k of Object.keys(values)) pending[k] = values[k];
  return pending;
}

/** 面板轮询兜底间隔（ms）。 */
export const CHANNEL_POLL_MS = 250;
const FPS_DEFAULT = 30;
const FPS_MIN = 1;
const FPS_MAX = 60;

/** fps 钳制到 1..60（非法 → 30），flush 间隔 = 1000/fps。 */
function clampFps(v: number): number {
  if (!Number.isFinite(v)) return FPS_DEFAULT;
  return Math.min(FPS_MAX, Math.max(FPS_MIN, Math.round(v)));
}

interface ChannelRow {
  path: string;
  el: HTMLElement;
  input: HTMLInputElement;
  dot: HTMLElement;
  value: unknown;
  numeric: boolean;
}

/** 面板组件：纯 TS + DOM，无框架。返回句柄供 dock.ts / main.ts 使用。 */
export function initChannelPanel(container: HTMLElement, deps: ChannelPanelDeps): ChannelPanelHandle {
  const client = new BridgeClient();
  const rows = new Map<string, ChannelRow>();
  const editing = new Set<string>();
  let refsByPath = new Map<string, ChannelRef>();
  let values: Record<string, unknown> = {};
  let pending: Record<string, unknown> = {};
  let lastSerial = "";
  let flushing = false;
  let disposed = false;

  // ---- DOM 骨架：标题 + 错误横幅 + 列表（行或占位） ----
  container.classList.add("cyl-channel-panel");
  const head = document.createElement("div");
  head.className = "cyl-channel-head";
  head.textContent = "通道参数";
  const errEl = document.createElement("div");
  errEl.className = "cyl-channel-error";
  errEl.hidden = true;
  const listEl = document.createElement("div");
  listEl.className = "cyl-channel-list";
  container.append(head, errEl, listEl);

  const showError = (msg: string): void => {
    errEl.textContent = msg;
    errEl.hidden = !msg;
  };

  const setDot = (row: ChannelRow, state: "ok" | "pending" | "error"): void => {
    row.dot.className = `cyl-channel-dot ${state}`;
    row.dot.title =
      state === "pending" ? "编辑中（待提交）" : state === "error" ? "提交失败" : "已同步";
  };

  const tailOf = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

  function onInputChange(path: string, input: HTMLInputElement, numeric: boolean): void {
    const prev = rows.get(path)?.value ?? values[path];
    const next = numeric ? parseInput(input.value, prev) : input.value;
    if (next === prev) {
      input.value = String(prev ?? ""); // 未变化：还原显示，不推
      return;
    }
    values[path] = next;
    const row = rows.get(path);
    if (row) {
      row.value = next;
      setDot(row, "pending");
    }
    editing.add(path);
    pending = mergePending(pending, { [path]: next });
  }

  function buildRow(path: string, ref: ChannelRef): ChannelRow {
    const numeric = isNumericValue(values[path]);
    const rowEl = document.createElement("div");
    rowEl.className = "cyl-channel-row";
    const labelEl = document.createElement("span");
    labelEl.className = "cyl-channel-label";
    labelEl.textContent = tailOf(path); // label = absolutePath 尾段；title 全量
    labelEl.title = path;
    const input = document.createElement("input");
    input.className = "cyl-channel-input";
    input.type = numeric ? "number" : "text";
    if (numeric) input.step = "any";
    input.value = String(values[path] ?? "");
    const dot = document.createElement("span");
    dot.className = "cyl-channel-dot ok";
    dot.title = "已同步";
    rowEl.append(labelEl, input, dot);
    input.addEventListener("change", () => onInputChange(path, input, numeric));
    return { path, el: rowEl, input, dot, value: values[path], numeric };
  }

  /** 值类型翻转（数字↔文本，罕见）时重建该行输入控件；编辑中的行不重建。 */
  function replaceRow(row: ChannelRow): void {
    const ref = refsByPath.get(row.path);
    if (!ref) return;
    const next = buildRow(row.path, ref);
    row.el.replaceWith(next.el);
    rows.set(row.path, next);
  }

  function setRowValue(row: ChannelRow, v: unknown): void {
    row.value = v;
    if (isNumericValue(v) !== row.numeric) {
      if (editing.has(row.path)) return;
      replaceRow(row);
      return;
    }
    row.input.value = String(v ?? "");
  }

  function renderList(): void {
    listEl.textContent = "";
    rows.clear();
    const serial = deps.getSerial();
    const placeholder = (text: string): void => {
      const ph = document.createElement("div");
      ph.className = "cyl-channel-empty";
      ph.textContent = text;
      listEl.appendChild(ph);
    };
    if (!serial) {
      placeholder("未连接：输入序列号并 Connect 后显示该 serial 的 param 通道。");
      return;
    }
    const paths = [...refsByPath.keys()].sort();
    if (paths.length === 0) {
      placeholder("无 param 通道：在 Houdini 吊牌（Cyl1nderTag）上注册参数条目并 cook。");
      return;
    }
    for (const path of paths) {
      const row = buildRow(path, refsByPath.get(path)!);
      rows.set(path, row);
      listEl.appendChild(row.el);
    }
  }

  /** 重拉通道列表（kind=="param" && serial 匹配）并首屏拉一次当前值。 */
  async function refresh(): Promise<void> {
    const serial = deps.getSerial();
    lastSerial = serial;
    if (!serial) {
      refsByPath.clear();
      values = {};
      renderList();
      showError("");
      return;
    }
    try {
      const r = await client.listChannels();
      const next = new Map<string, ChannelRef>();
      for (const c of r.channels) {
        if (c.kind === "param" && c.serial === serial && c.absolutePath) next.set(c.absolutePath, c);
      }
      // 丢弃已消失通道的值，保留仍在的值
      const kept: Record<string, unknown> = {};
      for (const p of next.keys()) if (Object.prototype.hasOwnProperty.call(values, p)) kept[p] = values[p];
      values = kept;
      refsByPath = next;
      renderList();
      showError("");
    } catch (e) {
      showError(`通道列表读取失败：${e instanceof Error ? e.message : String(e)}`);
    }
    // 列表就绪后拉一次当前值（250ms 轮询也会兜底，这里首屏秒出）
    const vr = await client.getChannelValues(serial).catch(() => ({ ok: false as const, values: {} }));
    if (!disposed && vr.ok) applyValues(vr.values);
  }

  /** WS 推送 / 轮询结果应用：编辑中的行不覆盖；值类型翻转时重建输入控件。
   *  末尾转发原始 incoming 给 deps.onValues（绑定管理器 H→C 入口；防回环在管理器侧）。 */
  function applyValues(incoming: Record<string, unknown>): void {
    values = mergeValues(values, incoming, editing);
    for (const [path, v] of Object.entries(incoming)) {
      if (editing.has(path)) continue;
      const row = rows.get(path);
      if (row) setRowValue(row, v);
    }
    deps.onValues?.(incoming);
  }

  /** 节流 flush：pending 快照后立即清空（PUT 期间的编辑进入新 pending，latest-wins 不断流）。
   *  结算后清 editing + 状态点；失败在面板顶部提示（轮询会带回真实值）。 */
  async function flushPending(serial: string): Promise<void> {
    if (flushing) return; // 单飞行：避免并发 PUT 乱序（bridge 也有 single-flight，双保险）
    const batch = pending;
    if (Object.keys(batch).length === 0) return;
    pending = {};
    const keys = Object.keys(batch);
    flushing = true;
    let r: { ok: boolean; error?: string };
    try {
      r = await client.putChannelValues(serial, batch);
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      flushing = false;
    }
    for (const k of keys) {
      editing.delete(k);
      const row = rows.get(k);
      if (row) setDot(row, r.ok ? "ok" : "error");
    }
    showError(r.ok ? "" : `通道值提交失败：${r.error ?? "unknown"}`);
  }

  // ---- 定时器：250ms 轮询（可见性门控）+ 1000/fps flush ----
  const pollTimer = window.setInterval(() => {
    if (disposed) return;
    const serial = deps.getSerial();
    if (!serial || !deps.isVisible()) return;
    if (serial !== lastSerial) {
      // serial 变化：重拉列表 + 清 pending（旧 serial 的编辑不发给新 serial）
      pending = {};
      editing.clear();
      void refresh();
      return;
    }
    void client
      .getChannelValues(serial)
      .then((r) => {
        if (!disposed && r.ok) applyValues(r.values);
      })
      .catch(() => undefined);
  }, CHANNEL_POLL_MS);

  const flushTimer = window.setInterval(() => {
    if (disposed) return;
    const serial = deps.getSerial();
    if (!serial) return;
    void flushPending(serial);
  }, Math.max(17, Math.round(1000 / clampFps(deps.getSyncMaxFps()))));

  // ---- 初始渲染 ----
  renderList();
  lastSerial = deps.getSerial();
  if (lastSerial) void refresh();

  return {
    applyValues,
    refresh,
    dispose: () => {
      disposed = true;
      window.clearInterval(pollTimer);
      window.clearInterval(flushTimer);
      container.textContent = "";
    },
  };
}
