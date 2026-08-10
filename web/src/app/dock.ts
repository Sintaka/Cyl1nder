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

  dv.addPanel({ id: "graph", component: "graph", title: "Node Graph" });
  dv.addPanel({
    id: "viewport",
    component: "viewport",
    title: "Viewport",
    position: { direction: "right" },
  });
  dv.addPanel({
    id: "inspector",
    component: "inspector",
    title: "Inspector",
    position: { referencePanel: "viewport", direction: "below" },
  });
  dv.addPanel({
    id: "log",
    component: "log",
    title: "Log",
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
        void client.putUiLayout(json).catch(() => undefined);
        store.pushLog(layoutDebug(container, byId));
        store.pushLog(`[layout-json] ${JSON.stringify(json)}`);
      } catch {
        /* ignore */
      }
    }, 600);
  });

  // NOTE: dockview 7 fromJSON drops content renderers on 5-panel layouts (observed
  // with the Log panel: the tab survives but .cyl-log leaves the DOM). Layout restore
  // via fromJSON is therefore disabled; we always start from the programmatic default
  // below and keep saving the user's arrangement for future restore-once the bug is
  // understood or worked around.
  return dv;
}
