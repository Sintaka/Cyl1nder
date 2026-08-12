import { BRIDGE_URL } from "./protocol/types";

// Overview 总管页面：新建场景（置顶）/ 活跃场景 / 历史场景。
// 契约（bridge scenes.py，并行实现中）：
//   GET  /api/scenes -> { active:[{serial,label,nodePath,lastSeen,lastActivity?,inputRev,outputRev}], history:[{serial,savedAt}] }
//   POST /api/scenes -> body {label?} -> {serial}
//   POST /api/scenes/cleanup -> {ok, removed:[serial...]}   （并行实现中，可能 404）

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

void loadScenes();
