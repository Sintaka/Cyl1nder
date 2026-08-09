import { Graph, Node, type Edge } from "@antv/x6";
import { DEFAULT_FLAGS, type NodeFlags } from "./flags";

export const INPUT_NODE = "cyl.input";
export const OUTPUT_NODE = "cyl.output";
export const NULL_NODE = "cyl.null";

export const IN_PORTS = ["in0", "in1", "in2", "in3"] as const;
export const OUT_PORTS = ["out0", "out1", "out2", "out3"] as const;
export type PortId = (typeof IN_PORTS)[number] | (typeof OUT_PORTS)[number];

export interface GraphHandlers {
  /** Node (or its port) clicked in the graph -> link to the 3D viewport. */
  onNodePick?: (kind: "input" | "output" | "null", port: number | null, nodeId: string) => void;
  /** A data edge was removed (cut mode). */
  onEdgeCut?: (edgeId: string) => void;
  /** A node was removed (cut mode / context menu). */
  onNodeRemoved?: (nodeId: string) => void;
}

/** Compact Houdini-SOP-like node: small body, title, ports on the sides. */
const PORT_GROUP = {
  in: { position: { name: "left" }, attrs: { circle: { r: 4, magnet: true, stroke: "#ff6b6b", strokeWidth: 1.2, fill: "#2b0b0b" } } },
  out: { position: { name: "right" }, attrs: { circle: { r: 4, magnet: true, stroke: "#4fc3f7", strokeWidth: 1.2, fill: "#0b2430" } } },
} as const;

function portItems(ids: readonly string[], group: "in" | "out") {
  return ids.map((id) => ({ id, group }));
}

/** Apply flag-derived styling to a node body/title. */
export function applyFlags(node: Node): void {
  const f = getFlags(node);
  const body: Record<string, unknown> = {};
  const title: Record<string, unknown> = {};
  let dash = "";
  if (f.bypass) dash = "6 3";
  if (f.freeze) {
    title.text = `${titleText(node)} 🔒`;
    title.fill = "#7a7f87";
  }
  node.attr("body/strokeDasharray", dash);
  node.attr("body/strokeWidth", f.display ? 2 : 1);
  node.attr("body/filter", f.display ? "url(#cyl-glow)" : "none");
  node.attr("title/fill", f.freeze ? "#7a7f87" : undefined);
  node.attr("wfBadge/display", f.wireframe ? "block" : "none");
}

function titleText(node: Node): string {
  const t = node.attr("title/text") as string;
  return t.replace(/ 🔒$/, "");
}

export function getFlags(node: Node): NodeFlags {
  const d = (node.getData() ?? {}) as { flags?: Partial<NodeFlags> };
  return { ...DEFAULT_FLAGS, ...(d.flags ?? {}) };
}

export function setFlags(node: Node, patch: Partial<NodeFlags>): NodeFlags {
  const f = { ...getFlags(node), ...patch };
  node.setData({ ...(node.getData() ?? {}), flags: f }, { silent: true });
  applyFlags(node);
  return f;
}

export function toggleFlag(node: Node, key: keyof NodeFlags): NodeFlags {
  return setFlags(node, { [key]: !getFlags(node)[key] });
}

/** Node markup: body rect + title + stats + wireframe badge + lock glyph slot. */
function makeMarkup(kind: "in" | "out" | "null") {
  const colors =
    kind === "in"
      ? { fill: "#13241c", stroke: "#2f7d54", title: "#7ce3a8" }
      : kind === "out"
        ? { fill: "#2b1c1c", stroke: "#c94f4f", title: "#ff9e9e" }
        : { fill: "#1c1e24", stroke: "#5a6478", title: "#b8c2d6" };
  return {
    attrs: {
      body: { refWidth: "100%", refHeight: "100%", fill: colors.fill, stroke: colors.stroke, strokeWidth: 1.2, rx: 5, ry: 5 },
      title: { refX: 8, refY: 12, textAnchor: "start", fontSize: 11, fontWeight: "bold", fill: colors.title, text: kind },
      stats: { refX: 8, refY: 30, textAnchor: "start", fontSize: 8, fill: "#8f959e", text: "" },
      wfBadge: { refX: "100%", refY: 10, textAnchor: "end", fontSize: 8, fill: "#ffd166", text: "⛶", display: "none" },
    },
  };
}

/** Register the three core node shapes once. */
export function registerNodes(): void {
  const InputNode = Node.define({
    name: INPUT_NODE,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "text", selector: "title" },
      { tagName: "text", selector: "stats" },
      { tagName: "text", selector: "wfBadge" },
    ],
    ...makeMarkup("in"),
    ports: { groups: { out: PORT_GROUP.out }, items: portItems(IN_PORTS, "out") },
  });
  Graph.registerNode(INPUT_NODE, InputNode);

  const OutputNode = Node.define({
    name: OUTPUT_NODE,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "text", selector: "title" },
      { tagName: "text", selector: "stats" },
      { tagName: "text", selector: "wfBadge" },
    ],
    ...makeMarkup("out"),
    ports: { groups: { in: PORT_GROUP.in }, items: portItems(OUT_PORTS, "in") },
  });
  Graph.registerNode(OUTPUT_NODE, OutputNode);

  const NullNode = Node.define({
    name: NULL_NODE,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "text", selector: "title" },
      { tagName: "text", selector: "stats" },
      { tagName: "text", selector: "wfBadge" },
    ],
    ...makeMarkup("null"),
    ports: {
      groups: { in: PORT_GROUP.in, out: PORT_GROUP.out },
      items: [...portItems(IN_PORTS, "in"), ...portItems(OUT_PORTS, "out")],
    },
  });
  Graph.registerNode(NULL_NODE, NullNode);
}

/** Create the graph with Houdini-ish interactions wired (handlers are optional). */
export function createGraph(container: HTMLElement, handlers: GraphHandlers = {}): Graph {
  const graph: Graph = new Graph({
    container,
    autoResize: true,
    background: { color: "#141518" },
    grid: { visible: true, size: 12, type: "dot" },
    panning: true,
    mousewheel: { enabled: true, modifiers: [] },
    connecting: {
      allowBlank: false,
      allowLoop: false,
      allowNode: false,
      allowEdge: false,
      allowPort: true,
      snap: true,
      createEdge(): Edge {
        return graph.createEdge({
          attrs: { line: { stroke: "#4fc3f7", strokeWidth: 1.5, targetMarker: { name: "block" } } },
        });
      },
    },
  });

  graph.on("node:click", ({ node, e }) => {
    const port = (e.target as Element | null)?.getAttribute("port-id") ?? null;
    const kind = node.shape === INPUT_NODE ? "input" : node.shape === OUTPUT_NODE ? "output" : "null";
    const idx = port ? parseInt((port as string).replace(/[a-z]/g, ""), 10) : null;
    handlers.onNodePick?.(kind, Number.isNaN(idx as number) ? null : idx, node.id);
  });

  graph.on("edge:click", ({ edge }) => {
    // Cut mode is handled by the caller (global Y key); plain click only selects.
  });

  return graph;
}

/** Create/refresh the fixed input_ + output_ backbone and the 4 data edges. */
export function upsertFlowGraph(
  graph: Graph,
  serial: string,
  inputStats: string,
  outputStats: string,
): void {
  const inputNode = getOrAdd(graph, INPUT_NODE, "cyl.input", 24, 32, 116, 148, serial, inputStats);
  const outputNode = getOrAdd(graph, OUTPUT_NODE, "cyl.output", 420, 32, 116, 148, "", outputStats);

  // Edges: input_ out_i -> output_ in_i (data-flow backbone, per index).
  for (let i = 0; i < 4; i++) {
    const edgeId = `flow-edge-in${i}`;
    if (!graph.getCellById(edgeId)) {
      graph.addEdge({
        id: edgeId,
        source: { cell: INPUT_NODE, port: `in${i}` },
        target: { cell: OUTPUT_NODE, port: `out${i}` },
        attrs: { line: { stroke: "#3d4a5a", strokeWidth: 1.2 } },
        zIndex: 1,
      });
    }
  }
  void inputNode;
  void outputNode;
}

function getOrAdd(
  graph: Graph,
  id: string,
  shape: string,
  x: number,
  y: number,
  w: number,
  h: number,
  serial: string,
  stats: string,
): Node {
  let n = graph.getCellById(id) as Node | undefined;
  if (n) {
    n.setAttrs({ stats: { text: stats }, serialText: { text: serial } });
  } else {
    n = graph.addNode({ id, shape, x, y, width: w, height: h, attrs: { stats: { text: stats } } }) as Node;
    // Hide serial line for output_ (no serial needed); keep it minimal.
  }
  return n;
}

/** Add a user-created null node at a graph position. */
export function addNullNode(graph: Graph, x: number, y: number): Node {
  const id = `null-${Date.now().toString(36)}-${Math.floor(Math.random() * 4096).toString(36)}`;
  return graph.addNode({
    id,
    shape: NULL_NODE,
    x,
    y,
    width: 116,
    height: 148,
    attrs: { title: { text: "null" }, stats: { text: "passthrough" } },
  }) as Node;
}
