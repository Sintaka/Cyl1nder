// Cyl1nder 轨迹审计页（/trace.html）：谁动了数据（P3）。
// 页面结构/风格参照 overview.ts（品牌区/面板/banner/$()/esc），但独立实现，不 import overview.ts；
// 需要的小工具（$ / esc / 秒级时间戳兼容）在本文件内自实现，注释说明与 overview 同款。
// 纯函数（buildTraceQuery / truncateDigest / formatTraceTime / actorColor）导出供单测
// （web/tests/trace.test.ts；vitest 为 node 环境，无 DOM 时页面块整体跳过）。

import { BridgeClient } from "./bridge/client";
import type { TraceEvent } from "./protocol/types";

// ============ 纯函数（供单测：web/tests/trace.test.ts） ============

/** listTrace 的过滤参数（空值省略，构造见 buildTraceQuery）。 */
export interface TraceFilters {
  project?: string;
  actor?: string;
  action?: string;
  channel?: string;
  target?: string;
  limit?: number;
}

/** 构造 /api/trace 查询串（供单测）：空值省略、URLSearchParams 编码；
 *  与 bridge/client.ts 的 listTrace 内部同构（分层各自实现，不交叉 import）。 */
export function buildTraceQuery(filters: TraceFilters): string {
  const q = new URLSearchParams();
  for (const key of ["project", "actor", "action", "channel", "target"] as const) {
    const v = filters[key];
    if (v) q.set(key, v);
  }
  if (filters.limit !== undefined && filters.limit > 0) q.set("limit", String(filters.limit));
  return q.toString();
}

/** digest 单行截断（供单测）：空白折叠为单空格，超 max 截断加省略号。 */
export function truncateDigest(digest: string, max = 80): string {
  const flat = digest.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max) + "…";
}

/** 时间格式化 YYYY-MM-DD HH:mm:ss（供单测）；兼容秒级时间戳（与 overview.ts epochMs 同款）。 */
export function formatTraceTime(ts: number): string {
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** actor → 徽标颜色（供单测）：6 类颜色同 styles/trace.css 顶部注释调色板，未知 actor 回退灰。 */
const ACTOR_COLORS: Record<string, string> = {
  "web-gizmo": "#9fd8ff", // 蓝
  "web-param": "#5eead4", // 青
  "runtime-python": "#c4b5fd", // 紫
  "tag-hda": "#7ce3a8", // 绿
  "hda-cook": "#9ca3af", // 灰
  bridge: "#fde047", // 黄
};
export function actorColor(actor: string): string {
  return ACTOR_COLORS[actor] ?? "#9ca3af";
}

// ============ 页面常量 ============
const TRACE_LIMIT = 200; // 一次拉取上限（v1 不分页）
const CHANNEL_TRUNCATE = 48; // channel 长路径显示截断长度
const DEBOUNCE_MS = 300; // channel 输入防抖

const client = new BridgeClient();

// ============ 页面（DOM）。单测 node 环境无 #tr-root 时整块跳过，纯函数照常可导入。 ============
if (typeof document !== "undefined" && document.querySelector(".tr-root")) {
  // 与 overview.ts 同款本地 $ 选择器 helper（trace.ts 不 import overview.ts）
  function $(sel: string): HTMLElement {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing element: ${sel}`);
    return el as HTMLElement;
  }

  // 与 overview.ts 同款 esc：转义全部动态文本
  const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);

  const banner = $("#tr-banner");
  const refreshBtn = $("#tr-refresh") as HTMLButtonElement;
  const projectSelect = $("#tr-project") as HTMLSelectElement;
  const actorSelect = $("#tr-actor") as HTMLSelectElement;
  const actionSelect = $("#tr-action") as HTMLSelectElement;
  const channelInput = $("#tr-channel") as HTMLInputElement;
  const countEl = $("#tr-count");
  const hint = $("#tr-hint");
  const list = $("#tr-list");

  const urlProject = new URLSearchParams(location.search).get("project"); // ?project= 初始过滤

  function setBanner(kind: "offline" | "error" | "ok", text: string): void {
    banner.textContent = text;
    banner.className = `tr-banner ${kind === "ok" ? "hidden" : kind}`;
  }

  /** 桥异常统一提示（照 overview 风格）：连接失败（fetch 抛 TypeError）=离线，其余=接口未就绪。 */
  function failMessage(err: unknown): string {
    if (err instanceof TypeError) {
      setBanner("offline", "桥离线：无法连接 127.0.0.1:8375，轨迹不可用。");
      return "无法加载（桥离线）";
    }
    setBanner("error", `桥返回错误：${err instanceof Error ? err.message : String(err)}（/api/trace 未就绪？）`);
    return "无法加载（接口未就绪）";
  }

  /** 填项目 select（label 空回退 projectSerial，同 overview 项目显示名）；失败仅 banner 提示，页面仍可用。 */
  async function loadProjects(): Promise<void> {
    try {
      const { projects } = await client.listProjects();
      projectSelect.innerHTML =
        `<option value="">全部项目</option>` +
        projects
          .map(
            (p) =>
              `<option value="${esc(p.projectSerial)}" title="${esc(p.projectSerial)}">${esc(p.label || p.projectSerial)}</option>`,
          )
          .join("");
      // ?project= 命中则选中（无该选项时 select 保持「全部项目」）
      if (urlProject) projectSelect.value = urlProject;
    } catch (err) {
      if (err instanceof TypeError) {
        setBanner("offline", "桥离线：无法连接 127.0.0.1:8375，项目过滤不可用（轨迹仍可加载）。");
      } else {
        setBanner(
          "error",
          `桥返回错误：${err instanceof Error ? err.message : String(err)}（/api/projects 未就绪，项目过滤不可用）。`,
        );
      }
    }
  }

  /** 当前过滤（空值省略，与 client.listTrace 契约一致）。 */
  function currentFilters(): TraceFilters {
    const f: TraceFilters = { limit: TRACE_LIMIT };
    const project = projectSelect.value;
    const actor = actorSelect.value;
    const action = actionSelect.value;
    const channel = channelInput.value.trim();
    if (project) f.project = project;
    if (actor) f.actor = actor;
    if (action) f.action = action;
    if (channel) f.channel = channel;
    return f;
  }

  function eventRowHtml(e: TraceEvent, index: number): string {
    const color = actorColor(e.actor);
    const digest = e.digest ?? "";
    return `
    <div class="tr-row" data-index="${index}">
      <div class="tr-cell tr-time">${esc(formatTraceTime(e.ts))}</div>
      <span class="tr-actor" style="color:${color};border-color:${color}55">${esc(e.actor)}</span>
      <span class="tr-action">${esc(e.action)}</span>
      <div class="tr-cell tr-channel" title="${esc(e.channel)}">${esc(truncateDigest(e.channel, CHANNEL_TRUNCATE))}</div>
      <div class="tr-cell tr-target" title="${esc(e.target)}">${esc(e.target)}</div>
      <div class="tr-cell tr-digest" data-full="${esc(digest)}" title="点击展开完整 digest">${esc(truncateDigest(digest))}</div>
    </div>`;
  }

  function renderEvents(events: TraceEvent[], count: number): void {
    // 顶部：count 总数 + 「仅显示前 limit 条」说明（count 超本次条数才提示截断）
    countEl.textContent =
      count > events.length ? `共 ${count} 条（仅显示前 ${TRACE_LIMIT} 条）` : `共 ${count} 条`;
    hint.classList.toggle("hidden", events.length > 0);
    hint.textContent = events.length
      ? ""
      : "暂无事件（符合当前过滤；Houdini cook / web 改参 / 吊牌注册会产生轨迹）";
    list.innerHTML = events.map((e, i) => eventRowHtml(e, i)).join("");
  }

  /** 点击行：展开显示全量 digest（保留换行），再点收起为单行截断。 */
  function toggleDigest(row: HTMLElement): void {
    const cell = row.querySelector<HTMLElement>(".tr-digest");
    if (!cell) return;
    const full = cell.dataset.full ?? "";
    if (row.classList.toggle("tr-expanded")) {
      cell.textContent = full;
      cell.title = "点击收起";
    } else {
      cell.textContent = truncateDigest(full);
      cell.title = "点击展开完整 digest";
    }
  }

  async function loadEvents(): Promise<void> {
    refreshBtn.disabled = true;
    hint.classList.remove("hidden");
    hint.textContent = "加载中…";
    list.innerHTML = "";
    try {
      const { events, count } = await client.listTrace(currentFilters());
      setBanner("ok", "");
      renderEvents(events, count);
    } catch (err) {
      list.innerHTML = "";
      hint.classList.remove("hidden");
      hint.textContent = failMessage(err);
    } finally {
      refreshBtn.disabled = false;
    }
  }

  /** 启动：先填项目 select（应用 ?project=），再拉事件（初始过滤含 URL 项目）。 */
  async function boot(): Promise<void> {
    await loadProjects();
    await loadEvents();
  }

  refreshBtn.addEventListener("click", () => void loadEvents());
  for (const sel of [projectSelect, actorSelect, actionSelect]) {
    sel.addEventListener("change", () => void loadEvents());
  }
  // channel 输入 300ms 防抖；回车立即刷新（跳过剩余防抖）
  let channelTimer: number | undefined;
  channelInput.addEventListener("input", () => {
    if (channelTimer) window.clearTimeout(channelTimer);
    channelTimer = window.setTimeout(() => void loadEvents(), DEBOUNCE_MS);
  });
  channelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (channelTimer) window.clearTimeout(channelTimer);
      void loadEvents();
    }
  });
  // 行点击展开/收起 digest（事件委托，同 overview 打开按钮模式）
  list.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest?.(".tr-row") as HTMLElement | null;
    if (row) toggleDigest(row);
  });

  void boot();
}
