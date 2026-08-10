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
  };

  const dv = new DockviewComponent(container, {
    createComponent: (opts: { id: string; name: string }) => {
      const key = String(opts.name ?? opts.id ?? "");
      const element = byId[key] ?? document.createElement("div");
      element.style.width = "100%";
      element.style.height = "100%";
      return { element, init: () => {}, dispose: () => {} };
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

  // Save layout (debounced) + print debug summary on every layout change.
  let saveTimer: number | undefined;
  dv.api.onDidLayoutChange(() => {
    if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        const json = dv.toJSON();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
        void client.putUiLayout(json).catch(() => undefined);
        store.pushLog(layoutDebug(container, byId));
        store.pushLog(`[layout-json] ${JSON.stringify(json)}`);
      } catch {
        /* ignore */
      }
    }, 600);
  });

  // Restore: bridge file (cross-browser) -> localStorage -> default.
  const apply = (json: unknown) => {
    if (!json) return false;
    try {
      dv.fromJSON(json as Parameters<DockviewComponent["fromJSON"]>[0]);
      return true;
    } catch {
      return false;
    }
  };
  void client
    .getUiLayout()
    .then((fileLayout) => {
      const used = apply(fileLayout);
      if (used) store.pushLog("[layout] restored from bridge file");
      return used;
    })
    .catch(() => false)
    .then((used) => {
      if (!used) {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && apply(JSON.parse(saved))) {
          store.pushLog("[layout] restored from localStorage");
        }
      }
    });

  return dv;
}