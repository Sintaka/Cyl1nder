/** Docking layout (dockview): Node Graph / Viewport / Inspector / Log / Spreadsheet / Params
 *  as draggable, floatable, resizable panels.
 *
 * Layout persistence (so ANY browser/session - including the agent's headless
 * browser - sees the same layout):
 *   save: debounced -> localStorage + PUT /api/ui/layout (bridge writes a file)
 *   load: GET /api/ui/layout (file, cross-browser) -> localStorage -> default
 * Every layout change also prints a debug summary (panel relative position +
 * bounds + full JSON) into the Log panel so it can be inspected remotely.
 *
 * Dockview UI niceties (this file + styles/dock.css):
 *  - Tabs are styled as rounded rectangles (see dock.css .dv-tab rules).
 *  - A "+" button is injected into every tab bar; it opens a small dark menu
 *    that adds NEW independent instance panels (Log/Inspector/Spreadsheet get
 *    fresh store-driven content, Viewport/Node Graph get a v1 placeholder).
 */
import { DockviewComponent } from "dockview";
import "dockview/dist/styles/dockview.css";
import { store } from "../stores/workspace";
import { BridgeClient } from "../bridge/client";
import { initChannelPanel, type ChannelPanelHandle } from "./channel-panel";
import { clampSyncFps, SYNC_FPS_DEFAULT } from "./preference";

export interface DockContent {
  graph: HTMLElement;
  viewport: HTMLElement;
  inspector: HTMLElement;
  log: HTMLElement;
  spreadsheet: HTMLElement;
  param: HTMLElement;
  /** 通道参数面板容器（P5a）。main.ts 不传（非其写集），dock 自建主实例；可选以兼容旧调用。 */
  channel?: HTMLElement;
}

const STORAGE_KEY = "cyl1nder.dock.layout.v1";
const client = new BridgeClient();

/** Panel types offered by the "+" add-panel menu. */
const PANEL_TYPES = [
  { type: "graph", title: "Node Graph" },
  { type: "viewport", title: "Viewport" },
  { type: "inspector", title: "Inspector" },
  { type: "log", title: "Log" },
  { type: "spreadsheet", title: "Spreadsheet" },
  { type: "param", title: "Params" },
  { type: "channel", title: "通道参数" },
] as const;

const PANEL_TYPE_TITLES: Record<string, string> = Object.fromEntries(
  PANEL_TYPES.map((t) => [t.type, t.title]),
);

/**
 * Instance panels use DISTINCT component names `<type>:<n>` (e.g. `log:2`) so
 * toJSON/fromJSON recreates them as fresh instances instead of stealing the
 * original shared content element. `createComponent` maps `name:2`-style names
 * back to the base type for the placeholder/fresh-content factory.
 */
const INSTANCE_RE = /^([a-z]+):(\d+)$/;

/** Panel bounds relative to the dock container - what a human/agent can eyeball. */
function layoutDebug(container: HTMLElement, byId: Record<string, HTMLElement>): string {
  const cr = container.getBoundingClientRect();
  const parts: string[] = [];
  for (const [id, el] of Object.entries(byId)) {
    const r = el.getBoundingClientRect();
    parts.push(`${id}:x=${Math.round(r.x - cr.x)},y=${Math.round(r.y - cr.y)},w=${Math.round(r.width)},h=${Math.round(r.height)}`);
  }
  return `[layout] ${parts.join(" | ")}`;
}

// ---------------------------------------------------------------------------
// Fresh instance content factories
// ---------------------------------------------------------------------------

/** Log categories - mirrors main.ts (which is NOT editable from this task). */
const LOG_FILTERS: [string, string][] = [
  ["all", "All"],
  ["geo", "Geo"],
  ["viewport", "Viewport"],
  ["ui", "UI"],
  ["bridge", "Bridge"],
];

function categorizeLog(m: string): string {
  if (/\[viewport\]/.test(m)) return "viewport";
  if (/inputs rev=|outputs|\[mesh\]|\[path\]|pushed|rev=/i.test(m)) return "geo";
  if (/\[layout\]|\[node\]|\[file\]|display|visibility/i.test(m)) return "ui";
  if (/\[bridge\]|python|runtime/i.test(m)) return "bridge";
  return "ui";
}

/** Render store.logs into ANY `.cyl-log-body` (used by fresh Log instances). */
function renderLogBody(body: HTMLElement, filter: string): void {
  const rows = filter === "all" ? store.logs : store.logs.filter((m) => categorizeLog(m) === filter);
  body.textContent = rows.slice(-40).join("\n");
}

/** Fresh, independent Log panel: filter bar + pre.cyl-log-body + own store sub. */
function createFreshLog(): { el: HTMLElement; dispose: () => void } {
  const el = document.createElement("div");
  el.className = "cyl-log cyl-log-panel cyl-log-instance";
  let filter = "all";
  const bar = document.createElement("div");
  bar.className = "cyl-log-filter";
  bar.innerHTML = LOG_FILTERS.map(
    ([k, label]) => `<button type="button" data-filter="${k}" class="${k === "all" ? "active" : ""}">${label}</button>`,
  ).join("");
  const body = document.createElement("pre");
  body.className = "cyl-log-body";
  bar.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest?.("button");
    if (!btn) return;
    filter = (btn as HTMLElement).dataset.filter ?? "all";
    bar.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    renderLogBody(body, filter);
  });
  el.appendChild(bar);
  el.appendChild(body);
  // Duplicate content with the original is acceptable per spec: main.ts only
  // renders into layout.logEl, so each fresh instance subscribes on its own.
  const unsub = store.subscribe(() => renderLogBody(body, filter));
  renderLogBody(body, filter);
  return { el, dispose: unsub };
}

/** Fresh Inspector instance: same summary fields as the main inspector. */
function createFreshInspector(): { el: HTMLElement; dispose: () => void } {
  const el = document.createElement("div");
  el.className = "cyl-inspector cyl-inspector-instance";
  const render = () => {
    const rows: string[] = [
      `<div class="insp-row"><b>serial</b> ${store.serial || "—"}</div>`,
      `<div class="insp-row"><b>status</b> ${store.status}</div>`,
      `<div class="insp-row"><b>inputRev</b> ${store.inputRev}</div>`,
      `<div class="insp-row"><b>outputRev</b> ${store.outputRev}</div>`,
    ];
    for (const inp of store.inputs) {
      rows.push(`<div class="insp-row inp"><b>in${inp.index}</b> ${inp.pointCount}pt / ${inp.curves.length}crv</div>`);
    }
    for (const out of store.outputs) {
      rows.push(`<div class="insp-row out"><b>out${out.index}</b> ${out.pointCount}pt / ${out.curves.length}crv r${out.rev}</div>`);
    }
    rows.push(`<div class="insp-row hint">Inspector 实例（v1）· 字段与主面板一致</div>`);
    el.innerHTML = rows.join("");
  };
  const unsub = store.subscribe(render);
  render();
  return { el, dispose: unsub };
}

/** Fresh Spreadsheet instance: v1 shows input/output counts + a note. */
function createFreshSpreadsheet(): { el: HTMLElement; dispose: () => void } {
  const el = document.createElement("div");
  el.className = "cyl-spreadsheet cyl-spreadsheet-instance";
  const render = () => {
    el.innerHTML = `<div class="cyl-sp-section">
      <div class="cyl-sp-head">Spreadsheet 实例</div>
      <div class="cyl-sp-empty">inputs ${store.inputs.length} 组 · outputs ${store.outputs.length} 组（v1 仅计数；完整表格见主 Spreadsheet 面板）</div>
    </div>`;
  };
  const unsub = store.subscribe(render);
  render();
  return { el, dispose: unsub };
}

/** Fresh Param instance: v1 shows a note only (no selection subscription;
 *  the main param panel is wired by main.ts, which is out of scope here). */
function createFreshParam(): { el: HTMLElement; dispose: () => void } {
  const el = document.createElement("div");
  el.className = "cyl-param cyl-param-instance";
  el.innerHTML = `
    <div class="cyl-param-head">Params 实例</div>
    <div class="cyl-param-empty">Param 实例 · 跟随选中节点，与主面板一致</div>`;
  return { el, dispose: () => {} };
}

/** P5a 通道参数面板句柄注册点：main.ts 在 SessionDeps 注入 applyChannelValues 时调用
 *  channelPanelRef.current?.applyValues(...)。dock 每次创建通道面板实例后赋值；
 *  current 为 null（面板尚未创建）时 main.ts 端 no-op。接口稳定，勿改形状。 */
export const channelPanelRef: { current: ReturnType<typeof initChannelPanel> | null } = { current: null };

/** P5a 面板节流来源：main.ts 的 syncMaxFps 是模块内 let（非本文件可读），
 *  面板自读 localStorage "cyl1nder.prefs" 的 sync_max_fps（1..60，缺省 30）。 */
function readSyncMaxFpsFromPrefs(): number {
  try {
    const raw = localStorage.getItem("cyl1nder.prefs");
    if (raw) {
      const p = JSON.parse(raw) as { sync_max_fps?: unknown };
      return clampSyncFps(p.sync_max_fps);
    }
  } catch {
    /* corrupt JSON -> default */
  }
  return SYNC_FPS_DEFAULT;
}

/** 通道参数面板实例（主实例与 "+" 新增实例共用）：容器注入 initChannelPanel；
 *  每次创建都重绑 channelPanelRef.current（main.ts 粘合 WS 推送的目标）。
 *  isVisible：dockview 隐藏 tab 时内容元素脱离 DOM（isConnected=false），
 *  叠加 document.visibilityState 门控轮询。 */
function createChannelPanel(): { el: HTMLElement; dispose: () => void; handle: ChannelPanelHandle } {
  const container = document.createElement("div");
  container.className = "cyl-channel-panel";
  const handle = initChannelPanel(container, {
    getSerial: () => store.serial,
    getSyncMaxFps: readSyncMaxFpsFromPrefs,
    isVisible: () => container.isConnected && document.visibilityState === "visible",
  });
  channelPanelRef.current = handle;
  return { el: container, dispose: () => handle.dispose(), handle };
}

/**
 * Viewport / Node Graph are heavy singletons (a second WebGL canvas / rete
 * editor would require wiring from main.ts which is out of scope). v1: add the
 * panel with a styled placeholder instance - the user accepted "全部都是实例就行",
 * so placeholder instances are the safe v1 until a panel-association system lands.
 */
function createPlaceholder(type: string, title: string): { el: HTMLElement; dispose: () => void } {
  const el = document.createElement("div");
  el.className = "cyl-instance-placeholder";
  el.innerHTML = `
    <div class="cyl-instance-ph-title">${title}</div>
    <div class="cyl-instance-ph-note">v1 单例：${PANEL_TYPE_TITLES[type] ?? type} 已有一份，此为占位实例（后续再做面板关联）</div>`;
  return { el, dispose: () => {} };
}

/** Build a fresh, INDEPENDENT content element for an added panel instance. */
function createInstanceContent(type: string, title: string): { el: HTMLElement; dispose: () => void } {
  switch (type) {
    case "log":
      return createFreshLog();
    case "inspector":
      return createFreshInspector();
    case "spreadsheet":
      return createFreshSpreadsheet();
    case "param":
      return createFreshParam();
    case "channel":
      return createChannelPanel();
    default:
      return createPlaceholder(type, title);
  }
}

// ---------------------------------------------------------------------------
// "+" add-panel button + menu
// ---------------------------------------------------------------------------

let addMenuEl: HTMLDivElement | null = null;
let addMenuGroupId: string | undefined;
let addMenuReady = false;

/** Largest existing instance index for a type, so new ids never collide. */
function nextInstanceIndex(dv: DockviewComponent, type: string): number {
  let max = 0;
  for (const p of dv.api.panels) {
    const m = INSTANCE_RE.exec(p.id);
    if (m && m[1] === type) max = Math.max(max, Number(m[2]));
  }
  return max + 1;
}

/** Add a NEW independent instance panel into the clicked group (or active group). */
function addInstancePanel(dv: DockviewComponent, groupId: string | undefined, type: string, title: string): void {
  const idx = nextInstanceIndex(dv, type);
  const name = `${type}:${idx}`;
  const position = groupId ? { referenceGroup: groupId, direction: "within" as const } : undefined;
  dv.addPanel({
    id: name,
    component: name, // distinct component name -> fresh instance on add AND on fromJSON restore
    title: `${title} ${idx}`,
    params: { cylInstance: true, cylPanelType: type },
    ...(position ? { position } : {}),
  });
  store.pushLog(`[layout] added ${title} instance ${name}`);
}

function hideAddMenu(): void {
  if (addMenuEl) addMenuEl.style.display = "none";
}

/** One shared fixed-position dark menu, created lazily and reused. */
function ensureAddMenu(dv: DockviewComponent): HTMLDivElement {
  if (!addMenuEl) {
    addMenuEl = document.createElement("div");
    addMenuEl.className = "cyl-dock-add-menu";
    addMenuEl.style.display = "none";
    for (const t of PANEL_TYPES) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t.title;
      b.addEventListener("click", () => {
        addInstancePanel(dv, addMenuGroupId, t.type, t.title);
        hideAddMenu();
      });
      addMenuEl.appendChild(b);
    }
    document.body.appendChild(addMenuEl);
  }
  if (!addMenuReady) {
    addMenuReady = true;
    // Close on outside click (capture so it runs before the click's own handler).
    document.addEventListener(
      "pointerdown",
      (e) => {
        const menu = addMenuEl;
        if (!menu || menu.style.display === "none") return;
        const t = e.target as Node;
        if (menu.contains(t)) return;
        if (t instanceof Element && t.closest?.(".cyl-dock-add")) return;
        hideAddMenu();
      },
      { capture: true },
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideAddMenu();
    });
  }
  return addMenuEl;
}

function toggleAddMenu(dv: DockviewComponent, groupId: string | undefined, btn: HTMLElement): void {
  const menu = ensureAddMenu(dv);
  if (menu.style.display === "block") {
    hideAddMenu();
    return;
  }
  const r = btn.getBoundingClientRect();
  menu.style.display = "block";
  const mw = menu.offsetWidth || 180;
  menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - mw - 4))}px`;
  menu.style.top = `${r.bottom + 4}px`;
  addMenuGroupId = groupId;
}

/** Find the group id whose tab bar contains the "+" button (fallback: active group). */
function groupIdForButton(dv: DockviewComponent, btn: HTMLElement): string | undefined {
  const gv = btn.closest(".dv-groupview") as HTMLElement | null;
  if (!gv) return dv.api.activeGroup?.id;
  return dv.api.groups.find((g) => g.element === gv)?.id ?? dv.api.activeGroup?.id;
}

/** Horizontal wheel scrolling for overflowing tab strips (capture + preventDefault).
 *  Only intercepts the wheel when the tabs actually overflow, so normal page
 *  scrolling and the 3D viewport wheel-zoom (a different element) are untouched.
 */
function attachTabBarWheel(bar: HTMLElement): void {
  if (bar.dataset.cylWheelBound === "1") return;
  bar.dataset.cylWheelBound = "1";
  bar.addEventListener(
    "wheel",
    (e) => {
      const tabsContainer = bar.querySelector<HTMLElement>(".dv-tabs-container");
      if (!tabsContainer) return;
      if (tabsContainer.scrollWidth <= tabsContainer.clientWidth) return;
      e.preventDefault();
      e.stopPropagation();
      tabsContainer.scrollLeft += e.deltaY + e.deltaX;
    },
    { capture: true, passive: false },
  );
}

/** Close the ENTIRE dock group behind a "✕" button (all panels in that tab bar). */
function closeTabGroup(dv: DockviewComponent, btn: HTMLElement): void {
  const gv = btn.closest(".dv-groupview") as HTMLElement | null;
  const group = gv ? dv.api.groups.find((g) => g.element === gv) : dv.api.activeGroup;
  if (!group) {
    store.pushLog("[layout] ✕ close: no dock group found");
    return;
  }
  const names = group.panels.map((p) => p.title ?? p.id).join(", ") || group.id;
  const count = group.panels.length;
  group.api.close();
  store.pushLog("[layout] closed dock group \"" + names + "\" (" + count + " panels) via ✕");
}

/** Inject (or keep) the "+" add button right after the tabs of every tab bar, the
 *  pinned "✕" group-close button at the far-right end of the bar, and horizontal
 *  wheel scrolling for overflowing tab strips. */
function refreshAddButtons(dv: DockviewComponent, container: HTMLElement): void {
  const bars = container.querySelectorAll<HTMLElement>(".dv-tabs-and-actions-container");
  for (const bar of Array.from(bars)) {
    const tabsContainer = bar.querySelector<HTMLElement>(".dv-tabs-container");
    if (!tabsContainer) continue;

    // "+" add-panel button: kept as the LAST child of the scrollable tabs list so
    // it sits immediately after the last tab and moves right as tabs are
    // added/docked. appendChild both creates and re-positions an existing node,
    // so this never duplicates.
    let addBtn = bar.querySelector<HTMLButtonElement>(".cyl-dock-add");
    if (!addBtn) {
      addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "cyl-dock-add";
      addBtn.title = "添加面板 (add panel)";
      addBtn.textContent = "+";
      // Listeners attach ONCE at creation; refreshAddButtons only re-positions an
      // existing button (attaching on every call would stack duplicate handlers).
      const created = addBtn;
      // Keep dockview's tab/group drag sources from treating the button as a tab.
      created.addEventListener("pointerdown", (e) => e.stopPropagation());
      created.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleAddMenu(dv, groupIdForButton(dv, created), created);
      });
    }
    const add = addBtn;
    tabsContainer.appendChild(add);

    // "✕" group-close button: pinned at the far-right END of the tab bar (OUTSIDE
    // the scrollable tabs list) so it never scrolls away; closes the whole group.
    let closeBtn = bar.querySelector<HTMLButtonElement>(":scope > .cyl-dock-close");
    if (!closeBtn) {
      closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "cyl-dock-close";
      closeBtn.title = "关闭整个 Docking 分组 (close group)";
      closeBtn.textContent = "✕";
      // Listeners attach ONCE at creation; refreshAddButtons only re-positions.
      const created = closeBtn;
      created.addEventListener("pointerdown", (e) => e.stopPropagation());
      created.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTabGroup(dv, created);
      });
    }
    const close = closeBtn;
    bar.appendChild(close);

    attachTabBarWheel(bar);
  }
}

// ---------------------------------------------------------------------------
// setupDock
// ---------------------------------------------------------------------------

export function setupDock(container: HTMLElement, content: DockContent): DockviewComponent {
  const byId: Record<string, HTMLElement> = {
    graph: content.graph,
    viewport: content.viewport,
    inspector: content.inspector,
    log: content.log,
    spreadsheet: content.spreadsheet,
    param: content.param,
  };
  if (content.channel) byId.channel = content.channel;

  const dv = new DockviewComponent(container, {
    createComponent: (opts: { id: string; name: string } & { params?: { cylInstance?: boolean; cylPanelType?: string } }) => {
      const raw = String(opts.name ?? opts.id ?? "");
      // dockview 7 passes only { id, name } to createComponent at runtime (params
      // reach init, not opts), so the distinct `type:n` component name is the
      // primary instance signal; opts.params is accepted as a forward-compat fallback.
      const m = INSTANCE_RE.exec(raw);
      const isInstance = !!m || (!!opts.params?.cylInstance && !!opts.params.cylPanelType);
      const type = m ? m[1] : opts.params?.cylPanelType ?? raw;

      // Fresh wrapper each call; content element is attached in init() which dockview
      // calls at panel-initialization time (after the wrapper is in the DOM). Attaching
      // eagerly left .cyl-log orphaned across fromJSON re-layouts.
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "width:100%;height:100%;";

      if (isInstance && type) {
        // Independent instance: each gets its OWN content element, never the
        // shared originals in byId.
        const built = createInstanceContent(type, PANEL_TYPE_TITLES[type] ?? raw);
        const inner = built.el;
        return {
          element: wrapper,
          init: () => {
            if (inner.isConnected) inner.remove();
            if (!wrapper.contains(inner)) wrapper.appendChild(inner);
          },
          dispose: () => built.dispose(),
        };
      }

      // Original 6 panels: shared content element from byId. The channel panel is
      // NOT part of main.ts's DockContent (out of that file's scope) - dock.ts
      // builds its own primary instance, so a layout referencing
      // contentComponent "channel" restores correctly and binds channelPanelRef.
      let inner: HTMLElement | undefined;
      let builtChannel: { dispose: () => void } | null = null;
      if (raw === "channel") {
        if (byId.channel) {
          inner = byId.channel; // 调用方自供容器（未来 main.ts 接住时用）
        } else {
          const built = createChannelPanel();
          builtChannel = built;
          inner = built.el;
        }
      } else {
        inner = byId[raw];
      }
      return {
        element: wrapper,
        init: () => {
          if (inner) {
            if (inner.isConnected) inner.remove();
            if (!wrapper.contains(inner)) wrapper.appendChild(inner);
          }
        },
        dispose: () => builtChannel?.dispose(),
      };
    },
    theme: { name: "dark", className: "dockview-theme-dark", colorScheme: "dark" },
  });

  // Desk1 programmatic layout: viewport top-left (large), log below it, inspector
  // top-right, graph below inspector, spreadsheet at the bottom-right. Explicit
  // positions keep panels from collapsing together (dockview's default stacking).
  dv.addPanel({ id: "viewport", component: "viewport", title: "Viewport" });
  dv.addPanel({
    id: "log",
    component: "log",
    title: "Log",
    position: { referencePanel: "viewport", direction: "below" },
  });
  dv.addPanel({
    id: "inspector",
    component: "inspector",
    title: "Inspector",
    position: { referencePanel: "viewport", direction: "right" },
  });
  dv.addPanel({
    id: "graph",
    component: "graph",
    title: "Node Graph",
    position: { referencePanel: "inspector", direction: "below" },
  });
  dv.addPanel({
    id: "spreadsheet",
    component: "spreadsheet",
    title: "Spreadsheet",
    position: { referencePanel: "graph", direction: "below" },
  });
  // P5a 通道参数面板（主实例）：main.ts 之后 applyLayout(Default.json) 会重建网格，
  // 该面板不在 Default.json 时会被关闭（applyLayout 失败回退程序化布局时保留）；
  // 随时可用 "+" 菜单重新添加。createComponent("channel") 自建实例并绑定 channelPanelRef。
  dv.addPanel({
    id: "channel",
    component: "channel",
    title: "通道参数",
    position: { referencePanel: "spreadsheet", direction: "below" },
  });

  // Save layout (debounced) + print debug summary + keep "+" buttons in sync.
  let saveTimer: number | undefined;
  const onLayoutChange = () => {
    refreshAddButtons(dv, container);
    if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        const json = dv.toJSON();
        // sanity: a corrupt save (branch data degraded to a string) would break
        // every future load into an equal-split layout - refuse to persist that.
        const bad = (n: unknown): boolean =>
          !!n &&
          typeof n === "object" &&
          (n as { type?: string }).type === "branch" &&
          !Array.isArray((n as { data?: unknown }).data);
        if (bad((json as { grid?: { root?: unknown } })?.grid?.root)) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
        // persist as docking-layout.json in the unified path system
        if (store.serial) {
          void client.putSnapshot(store.serial, { docking: json }).catch(() => undefined);
        }
        store.pushLog(layoutDebug(container, byId));
      } catch {
        /* ignore */
      }
    }, 600);
  };
  dv.api.onDidLayoutChange(onLayoutChange);
  dv.api.onDidLayoutFromJSON(onLayoutChange);

  // "+" buttons after setup (groups render synchronously, but a 0ms pass is cheap).
  refreshAddButtons(dv, container);
  window.setTimeout(() => refreshAddButtons(dv, container), 0);

  // NOTE: dockview 7 fromJSON drops content renderers on 5-panel layouts (observed
  // with the Log panel: the tab survives but .cyl-log leaves the DOM). applyLayout
  // uses fromJSON (best effort) and re-attaches any orphaned content afterwards.
  return dv;
}

/** Apply a saved layout JSON (best effort).
 *  NOTE: dockview 7 lazily mounts inactive tab content - a tab that is never shown
 *  keeps its content element inside a DETACHED wrapper until activated (the tab bar
 *  survives but .cyl-log is not in the DOM). This is dockview's intended behavior;
 *  the app reacts to it in main.ts via api.onDidActiveChange -> renderLog().
 */
export function applyLayout(dv: DockviewComponent, json: unknown, _content: DockContent): void {
  try {
    (dv as unknown as { fromJSON(d: unknown, o: { reuseExistingPanels: boolean }): void }).fromJSON(
      json as Parameters<DockviewComponent["fromJSON"]>[0],
      { reuseExistingPanels: true },
    );
  } catch {
    /* fall through to the programmatic layout already built by setupDock */
  }
}

