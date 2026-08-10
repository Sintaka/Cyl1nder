/** Docking layout (dockview): Node Graph / Viewport / Inspector / Log / Spreadsheet
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

export interface DockContent {
  graph: HTMLElement;
  viewport: HTMLElement;
  inspector: HTMLElement;
  log: HTMLElement;
  spreadsheet: HTMLElement;
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

/** Inject (or keep) a "+" button at the right end of every tab bar. */
function refreshAddButtons(dv: DockviewComponent, container: HTMLElement): void {
  const bars = container.querySelectorAll<HTMLElement>(".dv-tabs-and-actions-container");
  for (const bar of Array.from(bars)) {
    if (bar.querySelector(":scope > .cyl-dock-add")) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cyl-dock-add";
    btn.title = "添加面板 (add panel)";
    btn.textContent = "+";
    // Keep dockview's tab/group drag sources from treating the button as a tab.
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleAddMenu(dv, groupIdForButton(dv, btn), btn);
    });
    bar.appendChild(btn);
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
  };

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

      // Original 5 panels: shared content element from byId.
      const inner = byId[raw];
      return {
        element: wrapper,
        init: () => {
          if (inner) {
            if (inner.isConnected) inner.remove();
            if (!wrapper.contains(inner)) wrapper.appendChild(inner);
          }
        },
        dispose: () => {},
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

