import { BRIDGE_URL, ChannelRef, ProjectRef } from "./protocol/types";
import { BridgeClient } from "./bridge/client";
import { channelsStore, channelIdOf } from "./stores/channels";
import { projectsStore } from "./stores/projects";
import { INVALID_CHANNEL_VALUE, parseChannelValue } from "./app/channel-value";

// Overview 总管页面：新建场景（置顶）/ 活跃场景 / 历史场景 / 关联注册大全 / 项目。
// 契约（bridge scenes.py，并行实现中）：
//   GET  /api/scenes -> { active:[{serial,label,nodePath,lastSeen,lastActivity?,inputRev,outputRev}], history:[{serial,savedAt}] }
//   POST /api/scenes -> body {label?} -> {serial}
//   POST /api/scenes/cleanup -> {ok, removed:[serial...]}   （并行实现中，可能 404）
// data 通道（P4）行交互契约：GET/PUT /api/channels/{channelId}/value（bridge 并行实现中）。
// 结构照 trace.ts 惯例：纯函数（formatChannelValue / channelActionButtons / channelValueString）
// 顶部导出供单测（web/tests/data-channels.test.ts；vitest 为 node 环境，无 document 时页面块整体跳过）。

interface ActiveScene {
  serial: string;
  label: string;
  nodePath: string;
  lastSeen: number;
  /** 最近一次推数据/活动的 epoch 秒，0=从未。旧桥响应没有该字段，按 0（未cook）处理。 */
  lastActivity?: number;
  inputRev: number;
  outputRev: number;
}

interface HistoryScene {
  serial: string;
  savedAt: number;
}

interface ScenesResponse {
  active: ActiveScene[];
  history: HistoryScene[];
}

interface CleanupResponse {
  ok: boolean;
  removed: string[];
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const OFFLINE_MS = 150_000; // lastSeen 超过 150s -> 离线（心跳约 1min 一次，阈值 2.5×60=150s；慢时钟，避免长轮询空闲误报）
const STALE_ACTIVITY_MS = 5_000; // lastActivity 超过 5s 未推数据 -> 未cook

type ActiveState = "offline" | "uncooked" | "online";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);



/** 兼容秒级时间戳；正常为毫秒。 */
function epochMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

function relTime(ts: number): string {
  const diff = Date.now() - epochMs(ts);
  if (diff < 5_000) return "刚刚";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function clockTime(ts: number): string {
  const d = new Date(epochMs(ts));
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ============ 纯函数（供单测：web/tests/data-channels.test.ts） ============

/** data 通道值全量 JSON 文本（value cell 的 title 用）：JSON.stringify，
 *  失败回退 String()（undefined / BigInt / 循环引用等 stringify 拒绝的值）。 */
export function channelValueString(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

/** data 通道值显示文本（供单测）：JSON.stringify + 超 40 字符截断加省略号；失败回退见 channelValueString。 */
export function formatChannelValue(v: unknown): string {
  const s = channelValueString(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

/** 通道行操作按钮 HTML（供单测）：kind=data → 「读值」「写值」两个按钮；其余 kind → 「探测」。
 *  按钮 id 用 channelIdOf（data/param = absolutePath，tag/hda = serial）。 */
export function channelActionButtons(ref: ChannelRef): string {
  const id = channelIdOf(ref);
  if (ref.kind === "data") {
    return (
      `<button class="ov-open" type="button" data-read-channel="${esc(id)}">读值</button>` +
      `<button class="ov-open" type="button" data-write-channel="${esc(id)}">写值</button>`
    );
  }
  return `<button class="ov-open" type="button" data-channel-id="${esc(id)}">探测</button>`;
}

// ============ 页面（DOM）。单测 node 环境无 document 时整块跳过，纯函数照常可导入。 ============
if (typeof document !== "undefined") {
  function $(sel: string): HTMLElement {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing element: ${sel}`);
    return el as HTMLElement;
  }

  const banner = $("#ov-banner");
  const refreshBtn = $("#ov-refresh") as HTMLButtonElement;
  const cleanupBtn = $("#ov-cleanup") as HTMLButtonElement;
  const cleanupResult = $("#ov-cleanup-result");
  const activeHint = $("#active-hint");
  const activeList = $("#active-list");
  const historyHint = $("#history-hint");
  const historyList = $("#history-list");
  const newLabel = $("#new-label") as HTMLInputElement;
  const newButton = $("#new-button") as HTMLButtonElement;
  const newError = $("#new-error");

  function setBanner(kind: "offline" | "error" | "ok", text: string): void {
    banner.textContent = text;
    banner.className = `ov-banner ${kind === "ok" ? "hidden" : kind}`;
  }

  function openSerial(serial: string): void {
    location.href = `/?serial=${encodeURIComponent(serial)}`;
  }

  /** 三态判定：离线 / 未cook / 在线，离线优先。 */
  function activeState(s: ActiveScene): { state: ActiveState; text: string; title: string } {
    const seenDiff = Date.now() - epochMs(s.lastSeen);
    if (seenDiff > OFFLINE_MS) {
      return { state: "offline", text: "离线", title: `Houdini 心跳断开（lastSeen ${relTime(s.lastSeen)}）` };
    }
    const activity = s.lastActivity ?? 0; // 旧响应无 lastActivity 时按 0 = 从未推数据 -> 未cook
    if (activity === 0) {
      return { state: "uncooked", text: "未cook", title: "Houdini 在跑但从未推过数据（lastActivity=0）" };
    }
    const activityDiff = Date.now() - epochMs(activity);
    if (activityDiff > STALE_ACTIVITY_MS || (s.inputRev === 0 && s.outputRev === 0)) {
      return { state: "uncooked", text: "未cook", title: `Houdini 在跑但该场景还没 cook（lastActivity ${relTime(activity)}）` };
    }
    return { state: "online", text: "在线", title: `正常在线（最近活动 ${relTime(activity)}）` };
  }

  function activeRowHtml(s: ActiveScene): string {
    const { state, text, title } = activeState(s);
    const label = s.label ? esc(s.label) : esc(s.serial);
    const path = s.nodePath ? `<small class="ov-path" title="${esc(s.nodePath)}">${esc(s.nodePath)}</small>` : "";
    return `
    <div class="ov-row">
      <div class="ov-cell ov-serial" title="${esc(s.serial)}">${esc(s.serial)}</div>
      <div class="ov-cell ov-label">${label}${path}</div>
      <div class="ov-cell ov-seen ${state}">
        <span class="ov-state" title="${esc(title)}">${text}</span>
        <small class="ov-seen-at">${relTime(s.lastSeen)}</small>
      </div>
      <div class="ov-cell ov-revs"><span class="rev">in ${s.inputRev}</span><span class="rev">out ${s.outputRev}</span></div>
      <div class="ov-cell ov-action"><button class="ov-open" type="button" data-serial="${esc(s.serial)}">打开</button></div>
    </div>`;
  }

  function historyRowHtml(s: HistoryScene): string {
    return `
    <div class="ov-row history">
      <div class="ov-cell ov-serial" title="${esc(s.serial)}">${esc(s.serial)}</div>
      <div class="ov-cell ov-seen">${clockTime(s.savedAt)}</div>
      <div class="ov-cell ov-action"><button class="ov-open" type="button" data-serial="${esc(s.serial)}">打开</button></div>
    </div>`;
  }

  function renderActive(list: ActiveScene[]): void {
    activeList.innerHTML = list.map(activeRowHtml).join("");
    activeHint.classList.toggle("hidden", list.length > 0);
    activeHint.textContent = list.length ? "" : "暂无活跃场景";
    // 顶部「打开主应用」带上最近活跃的 serial（无活跃场景时保留空 ?serial=，
    // index.html 的入口守卫用 has() 判定，空值仍会加载主应用而不重定向回本页）。
    const openApp = document.getElementById("ov-open-app") as HTMLAnchorElement | null;
    if (openApp) {
      const newest = list.reduce<ActiveScene | null>(
        (best, s) => (best === null || epochMs(s.lastSeen) > epochMs(best.lastSeen) ? s : best),
        null,
      );
      openApp.href = newest ? `/?serial=${encodeURIComponent(newest.serial)}` : "/?serial=";
    }
  }

  function renderHistory(list: HistoryScene[]): void {
    historyList.innerHTML = list.map(historyRowHtml).join("");
    historyHint.classList.toggle("hidden", list.length > 0);
    historyHint.textContent = list.length ? "" : "暂无历史场景";
  }

  function renderUnavailable(msg: string): void {
    activeList.innerHTML = "";
    historyList.innerHTML = "";
    activeHint.classList.remove("hidden");
    activeHint.textContent = msg;
    historyHint.classList.remove("hidden");
    historyHint.textContent = msg;
  }

  async function fetchScenes(): Promise<ScenesResponse> {
    const res = await fetch(`${BRIDGE_URL}/api/scenes`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new HttpError(res.status);
    return (await res.json()) as ScenesResponse;
  }

  /** 桥异常统一提示：连接失败=offline，HTTP 错误=error（接口可能未就绪）。 */
  function failMessage(err: unknown): string {
    if (err instanceof HttpError) {
      setBanner("error", `桥返回 HTTP ${err.status}：/api/scenes 未就绪？`);
      return "无法加载（接口未就绪）";
    }
    setBanner("offline", "桥离线：无法连接 127.0.0.1:8375，场景列表不可用；新建场景也需要桥在线。");
    return "无法加载（桥离线）";
  }

  async function loadScenes(): Promise<void> {
    refreshBtn.disabled = true;
    activeHint.classList.remove("hidden");
    activeHint.textContent = "加载中…";
    activeList.innerHTML = "";
    historyHint.classList.remove("hidden");
    historyHint.textContent = "加载中…";
    historyList.innerHTML = "";
    try {
      const scenes = await fetchScenes();
      setBanner("ok", "");
      renderActive(scenes.active);
      renderHistory(scenes.history);
    } catch (err) {
      renderUnavailable(failMessage(err));
    } finally {
      refreshBtn.disabled = false;
    }
  }

  /** 清理无效场景：POST /api/scenes/cleanup -> {ok, removed}，成功后重新拉取渲染。 */
  async function cleanupScenes(): Promise<void> {
    cleanupBtn.disabled = true;
    cleanupBtn.textContent = "清理中…";
    cleanupResult.classList.add("hidden");
    try {
      const res = await fetch(`${BRIDGE_URL}/api/scenes/cleanup`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new HttpError(res.status);
      const data = (await res.json()) as CleanupResponse;
      const removed = Array.isArray(data.removed) ? data.removed : [];
      if (removed.length === 0) {
        cleanupResult.textContent = "没有无效场景";
        cleanupResult.title = "";
        cleanupResult.className = "ov-cleanup-result none";
      } else {
        const preview = removed.slice(0, 5).join("、") + (removed.length > 5 ? "…" : "");
        cleanupResult.textContent = `已清理 ${removed.length} 个无效场景：${preview}`;
        cleanupResult.title = removed.join("\n");
        cleanupResult.className = "ov-cleanup-result ok";
      }
      await loadScenes(); // 清理成功后重新拉取渲染
    } catch (err) {
      cleanupResult.textContent =
        err instanceof HttpError ? `清理接口未就绪（HTTP ${err.status}）` : "清理失败（桥离线）";
      cleanupResult.title = "";
      cleanupResult.className = "ov-cleanup-result err";
    } finally {
      cleanupBtn.disabled = false;
      cleanupBtn.textContent = "清理无效场景";
    }
  }

  refreshBtn.addEventListener("click", () => void loadScenes());
  cleanupBtn.addEventListener("click", () => void cleanupScenes());

  // 打开按钮：事件委托（active + history 共用）
  for (const list of [activeList, historyList]) {
    list.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest?.("button[data-serial]");
      if (!btn) return;
      openSerial((btn as HTMLElement).dataset.serial ?? "");
    });
  }

  newButton.addEventListener("click", async () => {
    newError.classList.add("hidden");
    newButton.disabled = true;
    newButton.textContent = "创建中…";
    const label = newLabel.value.trim();
    try {
      const res = await fetch(`${BRIDGE_URL}/api/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(label ? { label } : {}),
      });
      if (!res.ok) throw new HttpError(res.status);
      const data = (await res.json()) as { serial: string };
      openSerial(data.serial); // 即使没有 Houdini，web 也可打开空 workspace 编辑
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      failMessage(err);
      newError.textContent = `创建失败：${detail}（桥 127.0.0.1:8375 是否在运行？）`;
      newError.classList.remove("hidden");
      newButton.disabled = false;
      newButton.textContent = "新建场景";
    }
  });

  // ============ 关联注册大全（吊牌 HDA 通道；P4 起含 data 非 geo 数据源通道） ============
  const channelsClient = new BridgeClient();

  type ChannelRowState = "offline" | "online" | "lost";

  /** param/data 通道显示 absolutePath 尾段（回退 label），tag/hda 显示 label（回退 serial）。 */
  function channelLabel(ref: ChannelRef): string {
    if (ref.kind === "param" || ref.kind === "data") {
      const p = ref.absolutePath ?? "";
      const tail = p.lastIndexOf("/") >= 0 ? p.slice(p.lastIndexOf("/") + 1) : p;
      return tail || ref.label || p;
    }
    return ref.label || ref.serial || "";
  }

  /** 探测前仅凭心跳判定：lastSeen 距今 >150s → 离线，否则在线（「失联」由探测得出）。 */
  function channelState(ref: ChannelRef): { state: ChannelRowState; text: string; title: string } {
    const seenDiff = Date.now() - epochMs(ref.lastSeen);
    if (seenDiff > OFFLINE_MS) {
      return { state: "offline", text: "离线", title: `心跳断开（lastSeen ${relTime(ref.lastSeen)}）` };
    }
    return { state: "online", text: "在线", title: `在线（lastSeen ${relTime(ref.lastSeen)}）` };
  }

  function channelRowHtml(ref: ChannelRef): string {
    const { state, text, title } = channelState(ref);
    const id = channelIdOf(ref);
    const label = channelLabel(ref);
    // data 行：多一列 value cell（初始 "—"，读/写后显示值），操作列换成读值/写值两个按钮（channelActionButtons）。
    const valueCell = ref.kind === "data" ? `<div class="ov-cell ov-value-cell" title="—">—</div>` : "";
    return `
    <div class="ov-row channels${ref.kind === "data" ? " data" : ""}" data-channel-id="${esc(id)}" draggable="true">
      <div class="ov-cell ov-label" title="${esc(label)}">${esc(label)}</div>
      <div class="ov-cell"><span class="ov-kind ${esc(ref.kind)}">${esc(ref.kind)}</span></div>
      <div class="ov-cell ov-serial" title="${esc(id)}">${esc(id)}</div>
      <div class="ov-cell ov-seen ${state}">
        <span class="ov-state" title="${esc(title)}">${text}</span>
        <small class="ov-seen-at">${relTime(ref.lastSeen)}</small>
      </div>
      ${valueCell}
      <div class="ov-cell ov-action">${channelActionButtons(ref)}</div>
    </div>`;
  }

  // 动态构建「关联注册大全」区块（overview.html 不在本写集，故用 DOM 创建，样式复用 ov-* 类）。
  const channelsPanel = document.createElement("section");
  channelsPanel.className = "ov-panel";
  channelsPanel.id = "channels-panel";
  const channelsHead = document.createElement("div");
  channelsHead.className = "ov-channels-head";
  const channelsHeading = document.createElement("h2");
  channelsHeading.className = "ov-section-heading";
  channelsHeading.textContent = "关联注册大全";
  const channelsRefresh = document.createElement("button");
  channelsRefresh.type = "button";
  channelsRefresh.className = "ov-channels-refresh"; // 独立类名：round8 的 strict locator 依赖 .ov-refresh 唯一（类冲突回归修复）
  channelsRefresh.textContent = "刷新";
  channelsHead.append(channelsHeading, channelsRefresh);
  const channelsHint = document.createElement("p");
  channelsHint.className = "ov-hint";
  channelsHint.textContent = "加载中…";
  const channelsError = document.createElement("p");
  channelsError.className = "ov-error hidden";
  const channelsList = document.createElement("div");
  channelsList.className = "ov-list";
  channelsPanel.append(channelsHead, channelsHint, channelsError, channelsList);
  $(".ov-main").appendChild(channelsPanel);

  function renderChannels(list: ChannelRef[]): void {
    channelsList.innerHTML = list.map(channelRowHtml).join("");
    channelsHint.classList.toggle("hidden", list.length > 0);
    channelsHint.textContent = list.length ? "" : "暂无关联注册（吊牌 HDA cook 后会出现）";
  }

  function findChannelRow(id: string): HTMLElement | null {
    for (const child of Array.from(channelsList.children)) {
      const el = child as HTMLElement;
      if (el.dataset.channelId === id) return el;
    }
    return null;
  }

  function setChannelRowState(row: HTMLElement, state: ChannelRowState, text: string, title: string, seenAt: string): void {
    const cell = row.querySelector(".ov-seen");
    if (!cell) return;
    cell.className = `ov-cell ov-seen ${state}`;
    cell.innerHTML = `<span class="ov-state" title="${esc(title)}">${esc(text)}</span><small class="ov-seen-at">${esc(seenAt)}</small>`;
  }

  async function probeChannel(id: string): Promise<void> {
    const row = findChannelRow(id);
    const btn = row?.querySelector("button[data-channel-id]") as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "探测中…";
    }
    const set = (state: ChannelRowState, text: string, title: string, seenAt = "已探测"): void => {
      if (row) setChannelRowState(row, state, text, title, seenAt);
    };
    try {
      const r = await channelsClient.probeChannel(id);
      if (!r.alive) {
        set("offline", "离线", `节点未存活${r.reason ? `：${r.reason}` : ""}`);
        channelsStore.setStatus(id, "offline");
      } else if (!r.matched) {
        set("lost", "失联", `节点存活但通道不匹配${r.reason ? `：${r.reason}` : ""}`);
        channelsStore.setStatus(id, "online");
      } else {
        set("online", "在线", `探测确认存活且匹配（${r.nodePath || r.serial || ""}）`);
        channelsStore.setStatus(id, "online");
      }
    } catch (err) {
      set("offline", "离线", `探测失败：${err instanceof Error ? err.message : String(err)}`, "探测失败");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "探测";
      }
    }
  }

  /** 把 data 通道读/写结果渲染进该行 value cell：ok → 值文本（>40 截断显示，title 全量）；失败 → error 截断（title 全量）。 */
  function setValueCell(cell: HTMLElement, r: { ok: boolean; value: unknown; error?: string }): void {
    if (r.ok) {
      const full = channelValueString(r.value);
      cell.dataset.full = full;
      cell.textContent = formatChannelValue(r.value);
      cell.title = full;
    } else {
      const err = r.error ?? "unknown";
      cell.dataset.full = "";
      cell.title = err;
      cell.textContent = err.length > 40 ? `${err.slice(0, 40)}…` : err;
    }
  }

  /** data 通道「读值」：GET value → 该行 value cell 显示 JSON.stringify（截断，title 全量）。 */
  async function readChannelValue(id: string): Promise<void> {
    const row = findChannelRow(id);
    const cell = row?.querySelector<HTMLElement>(".ov-value-cell") ?? null;
    if (!cell) return; // 非 data 行没有 value cell（读值按钮只存在于 data 行）
    cell.textContent = "读取中…";
    cell.title = "";
    setValueCell(cell, await channelsClient.getChannelValue(id));
  }

  /** data 通道「写值」：prompt 输入 JSON / 裸数字 → PUT value → 回显。
   *  取消直接返回；解析失败本地提示。 */
  async function writeChannelValue(id: string): Promise<void> {
    const row = findChannelRow(id);
    const cell = row?.querySelector<HTMLElement>(".ov-value-cell") ?? null;
    if (!cell) return;
    const current = cell.dataset.full ?? cell.textContent ?? "";
    const input = window.prompt("写入值（JSON 或裸数字，如 .2 / 0.2 / {\"t\":[0,1,0]}）：", current);
    if (input === null) return; // 取消
    const parsed = parseChannelValue(input);
    if (parsed === INVALID_CHANNEL_VALUE) {
      cell.textContent = "invalid value";
      cell.title = "";
      cell.dataset.full = "";
      return;
    }
    cell.textContent = "写入中…";
    cell.title = "";
    setValueCell(cell, await channelsClient.putChannelValue(id, parsed));
  }

  async function loadChannels(): Promise<void> {
    channelsRefresh.disabled = true;
    channelsError.classList.add("hidden");
    channelsHint.classList.remove("hidden");
    channelsHint.textContent = "加载中…";
    channelsList.innerHTML = "";
    try {
      const { channels } = await channelsClient.listChannels();
      channelsStore.setChannels(channels);
      renderChannels(channels);
    } catch (err) {
      channelsStore.setChannels([]);
      renderChannels([]);
      channelsError.textContent =
        err instanceof HttpError
          ? `桥返回 HTTP ${err.status}：/api/channels 未就绪？`
          : "桥离线：无法连接 127.0.0.1:8375，关联注册大全不可用。";
      channelsError.classList.remove("hidden");
    } finally {
      channelsRefresh.disabled = false;
    }
  }

  channelsRefresh.addEventListener("click", () => void loadChannels());
  channelsList.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    // data 行：读值 / 写值（按钮 data-read-channel / data-write-channel）
    const readBtn = target.closest?.("button[data-read-channel]");
    if (readBtn) {
      void readChannelValue((readBtn as HTMLElement).dataset.readChannel ?? "");
      return;
    }
    const writeBtn = target.closest?.("button[data-write-channel]");
    if (writeBtn) {
      void writeChannelValue((writeBtn as HTMLElement).dataset.writeChannel ?? "");
      return;
    }
    // 其余 kind：探测（事件委托原逻辑）
    const btn = target.closest?.("button[data-channel-id]");
    if (!btn) return;
    void probeChannel((btn as HTMLElement).dataset.channelId ?? "");
  });

  // 拖拽入项目（HTML5 DnD）：通道行可拖，dragstart 写入通道 id；不影响行内点击/探测。
  channelsList.addEventListener("dragstart", (e) => {
    const row = (e.target as HTMLElement).closest?.("[data-channel-id]") as HTMLElement | null;
    if (!row) return;
    const id = row.dataset.channelId ?? "";
    if (!id || !e.dataTransfer) return;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/cyl-channel-id", id);
  });

  // ============ 项目（P2a：通道引用聚合；项目行做拖放目标） ============
  const projectsClient = new BridgeClient();

  const projectsPanel = document.createElement("section");
  projectsPanel.className = "ov-panel";
  projectsPanel.id = "projects-panel";
  const projectsHead = document.createElement("div");
  projectsHead.className = "ov-projects-head";
  const projectsHeading = document.createElement("h2");
  projectsHeading.className = "ov-section-heading";
  projectsHeading.textContent = "项目";
  const projectsNew = document.createElement("button");
  projectsNew.type = "button";
  projectsNew.className = "ov-projects-new"; // 独立类名：round8 依赖 .ov-new-button 唯一（类冲突回归修复）
  projectsNew.textContent = "新建项目";
  const projectsRefresh = document.createElement("button");
  projectsRefresh.type = "button";
  projectsRefresh.className = "ov-projects-refresh";
  projectsRefresh.textContent = "刷新";
  projectsHead.append(projectsHeading, projectsNew, projectsRefresh);
  const projectsHint = document.createElement("p");
  projectsHint.className = "ov-hint";
  projectsHint.textContent = "加载中…";
  const projectsError = document.createElement("p");
  projectsError.className = "ov-error hidden";
  const projectsList = document.createElement("div");
  projectsList.className = "ov-list";
  projectsPanel.append(projectsHead, projectsHint, projectsError, projectsList);
  $(".ov-main").appendChild(projectsPanel);

  /** 展开中的项目 serial（刷新后保留展开态）。 */
  const expandedProjects = new Set<string>();
  /** ?project= 落地标记：命中且展开时给对应项目行加 .focused。 */
  const focusProject: string | null = new URLSearchParams(location.search).get("project");

  function showProjectsError(msg: string): void {
    projectsError.textContent = msg;
    projectsError.classList.remove("hidden");
  }
  function hideProjectsError(): void {
    projectsError.classList.add("hidden");
  }

  /** 项目行显示名：label 空回退 projectSerial。 */
  function projectDisplayName(p: ProjectRef): string {
    return p.label || p.projectSerial;
  }

  /** 成员显示名：param/data 显示 absolutePath 全文，tag/hda 显示 label（回退 serial/id）。 */
  function memberDisplayName(m: ChannelRef): string {
    if (m.kind === "param" || m.kind === "data") return m.absolutePath ?? channelIdOf(m);
    return m.label || m.serial || channelIdOf(m);
  }

  function memberRowHtml(p: ProjectRef, m: ChannelRef): string {
    const id = channelIdOf(m);
    const display = memberDisplayName(m);
    // tag/hda 成员可打开工作区；param/data 成员给移除（成员是引用快照，live 状态以 /api/channels 为准）。
    const action =
      m.kind === "param" || m.kind === "data"
        ? `<button class="ov-remove" type="button" data-remove-project="${esc(p.projectSerial)}" data-remove-channel="${esc(id)}">移除</button>`
        : `<button class="ov-open" type="button" data-open-serial="${esc(m.serial ?? "")}">打开</button>`;
    return `
    <div class="ov-member" data-member-id="${esc(id)}">
      <span class="ov-kind ${esc(m.kind)}">${esc(m.kind)}</span>
      <span class="ov-member-label" title="${esc(display)}">${esc(display)}</span>
      <span class="ov-cell ov-action">${action}</span>
    </div>`;
  }

  function projectRowHtml(p: ProjectRef): string {
    const members = Array.isArray(p.members) ? p.members : [];
    const expanded = expandedProjects.has(p.projectSerial);
    const focused = focusProject === p.projectSerial && expanded;
    const membersHtml = expanded
      ? `<div class="ov-members" data-members="${esc(p.projectSerial)}">${
          members.map((m) => memberRowHtml(p, m)).join("") ||
          '<p class="ov-hint">（空项目：把下方通道行拖到本项目行加入）</p>'
        }</div>`
      : "";
    return `
    <div class="ov-project" data-project-serial="${esc(p.projectSerial)}">
      <div class="ov-row projects${focused ? " focused" : ""}" data-project-serial="${esc(p.projectSerial)}">
        <div class="ov-cell ov-label" title="${esc(p.label || p.projectSerial)}">${esc(projectDisplayName(p))}</div>
        <div class="ov-cell ov-serial" title="${esc(p.projectSerial)}">${esc(p.projectSerial)}</div>
        <div class="ov-cell ov-count">${members.length} 成员</div>
        <div class="ov-cell ov-action"><button class="ov-expand" type="button" data-expand="${esc(p.projectSerial)}">${expanded ? "收起" : "展开"}</button></div>
      </div>
      ${membersHtml}
    </div>`;
  }

  function renderProjects(list: ProjectRef[]): void {
    projectsList.innerHTML = list.map(projectRowHtml).join("");
    projectsHint.classList.toggle("hidden", list.length > 0);
    projectsHint.textContent = list.length ? "" : "暂无项目（点「新建项目」，或把下方通道行拖到项目行）";
  }

  async function loadProjects(): Promise<void> {
    projectsRefresh.disabled = true;
    hideProjectsError();
    projectsHint.classList.remove("hidden");
    projectsHint.textContent = "加载中…";
    projectsList.innerHTML = "";
    try {
      const { projects } = await projectsClient.listProjects();
      projectsStore.setProjects(projects);
      renderProjects(projects);
      // ?project= 落地：列表加载后存在该项目 → 自动展开 + .focused 高亮。
      if (focusProject && projects.some((p) => p.projectSerial === focusProject)) {
        expandedProjects.add(focusProject);
        renderProjects(projects);
      }
    } catch (err) {
      projectsStore.setProjects([]);
      renderProjects([]);
      projectsError.textContent =
        err instanceof HttpError
          ? `桥返回 HTTP ${err.status}：/api/projects 未就绪？`
          : "桥离线：无法连接 127.0.0.1:8375，项目列表不可用。";
      projectsError.classList.remove("hidden");
    } finally {
      projectsRefresh.disabled = false;
    }
  }

  /** 移除项目成员：成员行「移除」→ DELETE /members?channelId= → 刷新。 */
  async function removeMember(projectId: string, channelId: string): Promise<void> {
    hideProjectsError();
    if (!projectId || !channelId) return;
    try {
      await projectsClient.removeProjectMember(projectId, channelId);
      await loadProjects();
    } catch (err) {
      showProjectsError(`移除成员失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 拖放入项目：channelsStore 找不到该通道 id → .ov-error 提示（拖拽失败）。 */
  async function addMemberByDrop(projectId: string, channelId: string): Promise<void> {
    hideProjectsError();
    if (!projectId || !channelId) {
      showProjectsError("拖拽数据无效：缺少项目或通道 id");
      return;
    }
    const ref = channelsStore.channels.find((c) => channelIdOf(c) === channelId);
    if (!ref) {
      showProjectsError(`找不到通道引用 ${channelId}（先刷新「关联注册大全」再拖）`);
      return;
    }
    try {
      await projectsClient.addProjectMember(projectId, ref);
      // 刷新两区块：成员快照在项目列表里；通道大全本身未变，本地重渲染即可。
      renderChannels(channelsStore.channels);
      await loadProjects();
    } catch (err) {
      showProjectsError(`添加成员失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  projectsNew.addEventListener("click", async () => {
    hideProjectsError();
    projectsNew.disabled = true;
    projectsNew.textContent = "创建中…";
    try {
      await projectsClient.createProject("");
      await loadProjects();
    } catch (err) {
      showProjectsError(`新建项目失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      projectsNew.disabled = false;
      projectsNew.textContent = "新建项目";
    }
  });

  projectsRefresh.addEventListener("click", () => void loadProjects());

  // 项目行交互：展开/收起、成员「打开」、成员「移除」。
  projectsList.addEventListener("click", (e) => {
    const expandBtn = (e.target as HTMLElement).closest?.("button[data-expand]");
    if (expandBtn) {
      const pid = (expandBtn as HTMLElement).dataset.expand ?? "";
      if (expandedProjects.has(pid)) expandedProjects.delete(pid);
      else expandedProjects.add(pid);
      renderProjects(projectsStore.projects);
      return;
    }
    const openBtn = (e.target as HTMLElement).closest?.("button[data-open-serial]");
    if (openBtn) {
      const serial = (openBtn as HTMLElement).dataset.openSerial ?? "";
      if (serial) openSerial(serial);
      return;
    }
    const removeBtn = (e.target as HTMLElement).closest?.("button[data-remove-project]");
    if (removeBtn) {
      const b = removeBtn as HTMLElement;
      void removeMember(b.dataset.removeProject ?? "", b.dataset.removeChannel ?? "");
    }
  });

  // 项目行 = 拖放目标：dragover 放行 + 高亮，drop 读通道 id 加入成员。
  let dropHoverRow: HTMLElement | null = null;
  function clearDropHover(): void {
    dropHoverRow?.classList.remove("drop-hover");
    dropHoverRow = null;
  }

  projectsList.addEventListener("dragover", (e) => {
    const row = (e.target as HTMLElement).closest?.(".ov-row.projects") as HTMLElement | null;
    if (!row) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (row !== dropHoverRow) {
      clearDropHover();
      dropHoverRow = row;
      row.classList.add("drop-hover");
    }
  });

  projectsList.addEventListener("dragleave", (e) => {
    const t = e.target as HTMLElement;
    if (!t.contains(e.relatedTarget as Node | null)) clearDropHover();
  });

  projectsList.addEventListener("drop", (e) => {
    clearDropHover();
    const row = (e.target as HTMLElement).closest?.(".ov-row.projects") as HTMLElement | null;
    if (!row) return;
    e.preventDefault();
    const projectId = row.dataset.projectSerial ?? "";
    const channelId = e.dataTransfer?.getData("text/cyl-channel-id") ?? "";
    void addMemberByDrop(projectId, channelId);
  });

  // 拖拽在通道列表结束时清残留高亮（兜底：drop 未触发的情况）。
  channelsList.addEventListener("dragend", clearDropHover);

  void loadScenes();
  void loadChannels();
  void loadProjects();
}
