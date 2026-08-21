/**
 * 通道参数面板（P5a）：列出当前 serial 的 param 通道（吊牌注册），显示/编辑当前值。
 *
 * - 值输入按行 kind 分三种（rowKindFor）：vec3（值是 3 个有限数字的数组，或吊牌声明
 *   type=="vec3"）→ 一行三个 number 框（x/y/z，跟 param.ts 的 vec 行同形）；number
 *   （typeof v === "number"）→ 单个 number 框；其余 → text。vec3 判据优先于 number/text，
 *   这样声明为 vec3 的通道首屏（还没值）也先出三格，不等首个值到达才现形。
 * - 编辑提交：input change → 该行标记 editing（WS 推送不覆盖）→ 节流 latest-wins
 *   （实例内 pending map + 1000/sync_fps 定时 flush；flush 时 putChannelValues，
 *   结算后清 pending + editing，错误显示在面板顶部提示）。
 * - 回显：WS {type:"channel-values"} 推送经 applyValues 即时刷新；250ms 轮询兜底
 *   （仅 deps.isVisible() && 有 serial 时）调 getChannelValues。
 * - serial 变化 → 重拉列表 + 清 pending；断开/无通道 → 占位文案。
 *
 * 纯逻辑（isNumericValue / rowKindFor / parseInput / assembleVec3 / mergeValues /
 * mergePending / dotStateFor / formatFailedBanner）独立导出，供
 * web/tests/channel-panel.test.ts 直接单测（无 DOM；vitest 环境是 node 且没装
 * jsdom，buildRow 等 DOM 部分测不了）。
 */
import "../styles/channel-panel.css";
import equal from "fast-deep-equal";
import { BridgeClient } from "../bridge/client";
import { elide } from "./elide";
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

/** 数字判据：typeof v === "number" → number 输入框；字符串/布尔 → text。
 *  仍导出供既有代码/测试使用；行 kind 判定内部改用更细的 rowKindFor。 */
export function isNumericValue(v: unknown): boolean {
  return typeof v === "number";
}

export type ChannelRowKind = "number" | "text" | "vec3";

/** 3 个有限数字（拒绝 bool——typeof true === "boolean" 而非 "number"，Number.isFinite(true) 也是 false）。 */
function isVec3Array(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

/** 行 kind 判据：vec3 优先（值已是 3 元数组，或吊牌声明 type=="vec3"——首屏无值时靠它先出三格），
 *  否则 number（typeof v === "number"），否则 text。 */
export function rowKindFor(value: unknown, declaredType?: string): ChannelRowKind {
  if (isVec3Array(value) || declaredType === "vec3") return "vec3";
  if (typeof value === "number") return "number";
  return "text";
}

/** 取值的 vec3 视图：非法/缺省（首屏还没值）时退回 [0,0,0]，供三个输入框有东西可显示。 */
function vec3Of(v: unknown): [number, number, number] {
  return isVec3Array(v) ? v : [0, 0, 0];
}

/** 单分量编辑装配：组出完整 [x,y,z]，未编辑的两个分量取自 prev（不是重新解析兄弟输入框——
 *  兄弟框可能正显示旧值/空白，从 DOM 反解会把显示层的偶然状态当成数据源）。
 *  该分量走 parseInput：空白/非法文本回退 prev 的对应分量，不推 NaN/0。 */
export function assembleVec3(prev: unknown, index: 0 | 1 | 2, text: string): [number, number, number] {
  const base = vec3Of(prev);
  const next: [number, number, number] = [...base];
  const parsed = parseInput(text, base[index]);
  next[index] = typeof parsed === "number" && Number.isFinite(parsed) ? parsed : base[index];
  return next;
}

export interface Vec3CommitResult {
  next: [number, number, number];
  /** false = 与 prev 逐元素相同，调用方不应推送（否则 250ms 轮询回显同值会每 tick 重推，
   *  刷爆 Houdini 的 undo 栈——已踩过的坑）。 */
  changed: boolean;
}

/** vec3 单分量提交判定（纯函数，可单测）：装配完整数组 + 与 prev 逐元素比较。
 *  是否推送的唯一依据就是这里的 `changed`，onVecInputChange 直接采信，不再自行判断。 */
export function commitVec3(prev: unknown, index: 0 | 1 | 2, text: string): Vec3CommitResult {
  const next = assembleVec3(prev, index, text);
  return { next, changed: !equal(next, vec3Of(prev)) };
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

export type ChannelDotState = "ok" | "pending" | "error";

/** PUT 结算后单行状态点判定（纯函数，无 DOM）：决定某个 path 该显示什么点。
 *  顺序即优先级（devlog/protocol.md 响应契约）：
 *  1. throttled —— 桥把这次写节流合并进下一次 flush，尚未真正尝试写入，
 *     绝不能显示"已同步"（这是三个缺陷里最易误判的一个：节流恰好在快速编辑时触发）；
 *  2. failed 存在（无论是否命中该 path）——协议保证 failed 只在"逐通道结果已知"时
 *     才出现，所以命中该 path → error，不命中 → 该通道其实成功了，必须是 ok
 *     （这正是缺陷 B：同批里别的通道失败，不能连坐拖这行变红——failed 存在就说明
 *     逐通道详情齐全，缺席即无罪，不能落到下面那条"整体失败"分支）；
 *  3. failed 整个缺失且 ok:false —— 没有逐通道信息的整体性失败（传输层错误 /
 *     houdini mcp not reachable），批次里每一行都算未知失败；
 *  4. 否则 ok。 */
export function dotStateFor(
  path: string,
  res: { ok: boolean; failed?: Record<string, string>; throttled?: boolean },
): ChannelDotState {
  if (res.throttled === true) return "pending";
  if (res.failed) return Object.prototype.hasOwnProperty.call(res.failed, path) ? "error" : "ok";
  if (res.ok === false) return "error";
  return "ok";
}

/** 失败横幅里单个 path / error 的中段省略预算，以及最多具名列出的通道数
 *  （超出只报数量，避免一次失败几十个通道时横幅刷屏）。 */
const BANNER_PATH_MAX = 40;
const BANNER_ERROR_MAX = 60;
const BANNER_MAX_NAMED = 5;

/** 把 failed（path→error）格式化成横幅文案："path: error；path2: error2（另 N 个通道失败）"。
 *  过长的 path/error 走 elide 中段省略（devlog/development-standards.md 铁律：
 *  长标识串保头保尾、禁止砍尾——路径的尾段参数名和错误信息的头部类型都是辨识关键）。 */
export function formatFailedBanner(failed: Record<string, string>): string {
  const entries = Object.entries(failed);
  const shown = entries
    .slice(0, BANNER_MAX_NAMED)
    .map(([path, err]) => `${elide(path, BANNER_PATH_MAX)}: ${elide(err, BANNER_ERROR_MAX)}`);
  const rest = entries.length - shown.length;
  const list = shown.join("；");
  return rest > 0 ? `${list}（另 ${rest} 个通道失败）` : list;
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
  dot: HTMLElement;
  value: unknown;
  kind: ChannelRowKind;
  /** number/text 行专属。 */
  input?: HTMLInputElement;
  /** vec3 行专属：x/y/z 三个输入框。 */
  vecInputs?: [HTMLInputElement, HTMLInputElement, HTMLInputElement];
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

  /** vec3 行单分量提交：commitVec3 装配完整数组并做逐元素比较，changed=false 直接还原
   *  显示、不进 pending（守住「同值不重推」——避免轮询回显把它当新编辑再打一遍）。 */
  function onVecInputChange(path: string, index: 0 | 1 | 2, input: HTMLInputElement): void {
    const prev = rows.get(path)?.value ?? values[path];
    const { next, changed } = commitVec3(prev, index, input.value);
    if (!changed) {
      input.value = String(vec3Of(prev)[index]);
      return;
    }
    values[path] = next;
    const row = rows.get(path);
    if (row) {
      row.value = next;
      setDot(row, "pending");
      row.vecInputs?.forEach((inp, i) => {
        if (i !== index) inp.value = String(next[i]); // 未编辑的两个分量：显示同步到装配后的值
      });
    }
    editing.add(path);
    pending = mergePending(pending, { [path]: next });
  }

  /** vec3 行三个 number 框跟 param.ts 的 `.cyl-param-vec` 同形（一行三格）；CSS 归属固定，
   *  这里用内联样式实现该布局（devlog/development-standards.md 规则 4 的应急口子）。 */
  function buildVecInputs(path: string, vec: [number, number, number]): [HTMLInputElement, HTMLInputElement, HTMLInputElement] {
    const inputs = vec.map((v, i) => {
      const inp = document.createElement("input");
      inp.className = "cyl-channel-input";
      inp.type = "number";
      inp.step = "any";
      inp.value = String(v);
      inp.style.flex = "1 1 0";
      inp.style.minWidth = "0";
      inp.addEventListener("change", () => onVecInputChange(path, i as 0 | 1 | 2, inp));
      return inp;
    }) as [HTMLInputElement, HTMLInputElement, HTMLInputElement];
    return inputs;
  }

  function buildRow(path: string, ref: ChannelRef): ChannelRow {
    const kind = rowKindFor(values[path], ref.type);
    const rowEl = document.createElement("div");
    rowEl.className = "cyl-channel-row";
    const labelEl = document.createElement("span");
    labelEl.className = "cyl-channel-label";
    labelEl.textContent = tailOf(path); // label = absolutePath 尾段；title 全量
    labelEl.title = path;
    const dot = document.createElement("span");
    dot.className = "cyl-channel-dot ok";
    dot.title = "已同步";

    if (kind === "vec3") {
      const vecInputs = buildVecInputs(path, vec3Of(values[path]));
      const wrap = document.createElement("span");
      wrap.style.cssText = "display:inline-flex;gap:4px;align-items:center;flex:1;min-width:0;";
      wrap.append(...vecInputs);
      rowEl.append(labelEl, wrap, dot);
      return { path, el: rowEl, dot, value: values[path], kind, vecInputs };
    }

    const input = document.createElement("input");
    input.className = "cyl-channel-input";
    input.type = kind === "number" ? "number" : "text";
    if (kind === "number") input.step = "any";
    input.value = String(values[path] ?? "");
    rowEl.append(labelEl, input, dot);
    input.addEventListener("change", () => onInputChange(path, input, kind === "number"));
    return { path, el: rowEl, dot, value: values[path], kind, input };
  }

  /** 行 kind 翻转（number↔text↔vec3，罕见）时重建该行输入控件；编辑中的行不重建。 */
  function replaceRow(row: ChannelRow): void {
    const ref = refsByPath.get(row.path);
    if (!ref) return;
    const next = buildRow(row.path, ref);
    row.el.replaceWith(next.el);
    rows.set(row.path, next);
  }

  function setRowValue(row: ChannelRow, v: unknown): void {
    row.value = v;
    const kind = rowKindFor(v, refsByPath.get(row.path)?.type);
    if (kind !== row.kind) {
      if (editing.has(row.path)) return;
      replaceRow(row);
      return;
    }
    if (row.kind === "vec3") {
      const vec = vec3Of(v);
      row.vecInputs?.forEach((inp, i) => (inp.value = String(vec[i])));
      return;
    }
    if (row.input) row.input.value = String(v ?? "");
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
   *  结算后清 editing + 逐行状态点（dotStateFor，不再用整批共享的 r.ok）；
   *  逐通道失败在面板顶部具名提示；节流响应不报错（还没尝试写，谈不上失败）。
   *  节流时**不**把 keys 放回 pending——桥已经把这批值收进它自己下一次 flush，
   *  客户端重新排队等于重复发送（这个坑后人很容易"修复"回来，故留此注释）。 */
  async function flushPending(serial: string): Promise<void> {
    if (flushing) return; // 单飞行：避免并发 PUT 乱序（bridge 也有 single-flight，双保险）
    const batch = pending;
    if (Object.keys(batch).length === 0) return;
    pending = {};
    const keys = Object.keys(batch);
    flushing = true;
    let r: { ok: boolean; error?: string; failed?: Record<string, string>; throttled?: boolean };
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
      if (row) setDot(row, dotStateFor(k, r));
    }
    if (r.throttled) {
      showError(""); // 已接受、待桥后续 flush 尝试——不是失败，"pending" 点已经表达了在飞行中
    } else if (r.failed) {
      showError(`通道值提交失败：${formatFailedBanner(r.failed)}`);
    } else {
      showError(r.ok ? "" : `通道值提交失败：${r.error ?? "unknown"}`);
    }
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
