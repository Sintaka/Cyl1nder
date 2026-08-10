/** Docking layout (dockview): Node Graph / Viewport / Inspector / Log as
 *  draggable, floatable, resizable panels.
 *
 * Layout persistence (so ANY browser/session - including the agent's headless
 * browser - sees the same layout):
 *   save: debounced -> localStorage + PUT /api/ui/layout (bridge writes a file)
 *   load: GET /api/ui/layout (file, cross-browser) -> localStorage -> default
 * Every layout change also prints a debug summary (panel relative position +
 * bounds + full JSON) into the Log panel so it can be inspected remotely.
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

export function setupDock(container: HTMLElement, content: DockContent): DockviewComponent {
  const byId: Record<string, HTMLElement> = {
    graph: content.graph,
    viewport: content.viewport,
    inspector: content.inspector,
    log: content.log,
    spreadsheet: content.spreadsheet,
  };

  const dv = new DockviewComponent(container, {
    createComponent: (opts: { id: string; name: string }) => {
      const key = String(opts.name ?? opts.id ?? "");
      // Fresh wrapper each call; content element is attached in init() which dockview
      // calls at panel-initialization time (after the wrapper is in the DOM). Attaching
      // eagerly left .cyl-log orphaned across fromJSON re-layouts.
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "width:100%;height:100%;";
      const inner = byId[key];
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

  // Save layout (debounced) + print debug summary on every layout change.
  let saveTimer: number | undefined;
  dv.api.onDidLayoutChange(() => {
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
  });

  // NOTE: dockview 7 fromJSON drops content renderers on 5-panel layouts (observed
  // with the Log panel: the tab survives but .cyl-log leaves the DOM). applyLayout
  // uses fromJSON (best effort) and re-attaches any orphaned content afterwards.
  return dv;
}

/** Apply a saved layout JSON (best effort); re-attach orphaned content elements. */
export function applyLayout(dv: DockviewComponent, json: unknown, content: DockContent): void {
  try {
    (dv as unknown as { fromJSON(d: unknown, o: { reuseExistingPanels: boolean }): void }).fromJSON(
      json as Parameters<DockviewComponent["fromJSON"]>[0],
      { reuseExistingPanels: true },
    );
  } catch {
    /* fall through to re-attach */
  }
  setTimeout(() => {
    for (const [id, el] of Object.entries(content)) {
      if (el.isConnected) continue;
      const panel = dv.getPanel(id) as { view?: { content?: { element?: HTMLElement } } } | undefined;
      const contentEl = panel?.view?.content?.element;
      if (contentEl && !el.isConnected) contentEl.appendChild(el);
    }
  }, 250);
}
