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
import { DESK1_LAYOUT } from "./layouts";

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

  // Restore priority: bridge file (user's latest custom layout) -> DESK1 (built-in default).
  // Sizes in saved layouts are absolute pixels captured at some window size; scale them
  // to the current dock so a 2159px-wide Desk1 does not degrade to a "relative-only" look
  // on a 1280px window.
  const scaleLayout = (json: { grid?: { width?: number; height?: number; root?: unknown } }) => {
    const grid = json.grid;
    if (!grid) return;
    const cw = container.clientWidth || 1280;
    const ch = container.clientHeight || 720;
    const sx = cw / (grid.width || cw);
    const sy = ch / (grid.height || ch);
    const walk = (node: any, parentOrient: "HORIZONTAL" | "VERTICAL" | null) => {
      if (!node) return;
      if (node.type === "leaf" && typeof node.size === "number") {
        node.size = Math.max(60, Math.round(node.size * (parentOrient === "VERTICAL" ? sy : sx)));
      } else if (node.type === "branch") {
        if (typeof node.size === "number") {
          node.size = Math.max(80, Math.round(node.size * (parentOrient === "VERTICAL" ? sy : sx)));
        }
        const orient: "HORIZONTAL" | "VERTICAL" = node.orientation === "VERTICAL" ? "VERTICAL" : "HORIZONTAL";
        for (const c of node.data ?? []) walk(c, orient);
      }
    };
    walk(grid.root, "HORIZONTAL");
  };

  const apply = (json: unknown) => {
    if (!json) return false;
    try {
      scaleLayout(json as { grid?: { width?: number; height?: number; root?: unknown } });
      dv.fromJSON(json as Parameters<DockviewComponent["fromJSON"]>[0]);
      return true;
    } catch {
      return false;
    }
  };
  void client
    .getUiLayout()
    .then((fileLayout) => {
      if (apply(fileLayout)) {
        store.pushLog("[layout] restored user layout from bridge file");
      } else if (apply(DESK1_LAYOUT)) {
        store.pushLog("[layout] restored default layout Desk1");
      }
    })
    .catch(() => {
      if (apply(DESK1_LAYOUT)) store.pushLog("[layout] restored default layout Desk1");
    });

  return dv;
}