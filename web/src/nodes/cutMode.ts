import type { Graph } from "@antv/x6";
import { INPUT_NODE, OUTPUT_NODE } from "./cyl1nderNode";

/** Hold Y = cut mode (Houdini-ish). Click an edge to delete it, click a
 *  user node (null) to delete it. Input_/output_ backbone is protected. */
export function attachCutMode(
  graph: Graph,
  container: HTMLElement,
  onCut?: (what: "edge" | "node", id: string) => void,
): () => void {
  let active = false;
  const isTyping = () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.tagName === "SELECT")) return false;
    return el.getClientRects().length > 0; // hidden inputs (e.g. closed palette) don\u2019t block shortcuts
  };

  const down = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== "y" || e.repeat || isTyping()) return;
    active = true;
    container.classList.add("cut-mode");
    e.preventDefault();
  };
  const up = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== "y") return;
    active = false;
    container.classList.remove("cut-mode");
  };

  const onEdgeClick = ({ edge }: { edge: { id: string } }) => {
    if (!active) return;
    graph.removeEdge(edge.id);
    onCut?.("edge", edge.id);
  };
  const onNodeClick = ({ node }: { node: { id: string; shape: string } }) => {
    if (!active) return;
    if (node.shape === INPUT_NODE || node.shape === OUTPUT_NODE) return; // backbone protected
    graph.removeNode(node.id);
    onCut?.("node", node.id);
  };

  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  graph.on("edge:click", onEdgeClick);
  graph.on("node:click", onNodeClick);

  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    graph.off("edge:click", onEdgeClick);
    graph.off("node:click", onNodeClick);
    container.classList.remove("cut-mode");
  };
}
