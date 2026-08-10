/** Docking layout (dockview): Node Graph / Viewport / Inspector / Log as
 *  draggable, floatable, resizable panels. Replaces the old flex+splitters body. */
import { DockviewComponent } from "dockview";
import "dockview/dist/styles/dockview.css";

export interface DockContent {
  graph: HTMLElement;
  viewport: HTMLElement;
  inspector: HTMLElement;
  log: HTMLElement;
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

  return dv;
}