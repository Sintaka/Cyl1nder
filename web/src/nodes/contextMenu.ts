import type { Graph, Node } from "@antv/x6";
import { FLAG_LABELS, type NodeFlags } from "./flags";
import { toggleFlag } from "./cyl1nderNode";

/** Minimal Houdini-style node context menu: flag toggles + delete.
 *  One floating menu reused across the graph. */
export function attachContextMenu(
  graph: Graph,
  container: HTMLElement,
  onFlagsChanged?: (nodeId: string, flags: NodeFlags) => void,
  onDelete?: (nodeId: string) => void,
): () => void {
  const menu = document.createElement("div");
  menu.className = "cyl-node-menu hidden";
  container.appendChild(menu);
  let current: Node | null = null;
  let cleanupListeners: (() => void)[] = [];

  function close(): void {
    menu.classList.add("hidden");
    current = null;
    for (const off of cleanupListeners) off();
    cleanupListeners = [];
  }

  function show(node: Node, x: number, y: number): void {
    current = node;
    menu.innerHTML = "";
    const flags = (node.getData()?.flags ?? {}) as Partial<NodeFlags>;
    (Object.keys(FLAG_LABELS) as (keyof NodeFlags)[]).forEach((key) => {
      const row = document.createElement("div");
      row.className = "cyl-node-menu-row";
      row.innerHTML = `<input type="checkbox" ${flags[key] ? "checked" : ""}/><span>${FLAG_LABELS[key]}</span>`;
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const f = toggleFlag(node, key);
        onFlagsChanged?.(node.id, f);
        show(node, x, y); // re-render with new state
      });
      menu.appendChild(row);
    });
    const del = document.createElement("div");
    del.className = "cyl-node-menu-row danger";
    del.innerHTML = `<span>Delete</span>`;
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      graph.removeNode(node.id);
      onDelete?.(node.id);
      close();
    });
    menu.appendChild(del);

    menu.classList.remove("hidden");
    const rect = container.getBoundingClientRect();
    menu.style.left = `${Math.min(x - rect.left, rect.width - 170)}px`;
    menu.style.top = `${Math.min(y - rect.top, rect.height - 190)}px`;

    const onDown = (e: MouseEvent) => {
      if (!menu.contains(e.target as globalThis.Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    cleanupListeners = [
      () => window.removeEventListener("mousedown", onDown),
      () => window.removeEventListener("keydown", onKey),
    ];
  }

  graph.on("node:contextmenu", ({ node, e }) => {
    e.preventDefault();
    show(node, e.clientX, e.clientY);
  });
  graph.on("blank:contextmenu", (e: any) => {
    e.e?.preventDefault?.();
    close();
  });

  return close;
}
