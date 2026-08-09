import { Graph, Node } from "@antv/x6";

export const NODE_SHAPE = "cyl1nder";
const INPUT_IDS = ["in0", "in1", "in2", "in3"];
const OUTPUT_IDS = ["out0", "out1", "out2", "out3"];

/** Houdini-SOP-style compact node: title + serial + stats, 4 in / 4 out sockets. */
export function registerNode(): void {
  const Cyl1nderNode = Node.define({
    name: NODE_SHAPE,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "text", selector: "title" },
      { tagName: "text", selector: "serial" },
      { tagName: "text", selector: "stats" },
    ],
    attrs: {
      body: {
        refWidth: "100%",
        refHeight: "100%",
        fill: "#222428",
        stroke: "#3d4148",
        strokeWidth: 1,
        rx: 4,
        ry: 4,
      },
      title: {
        refX: 8,
        refY: 10,
        textAnchor: "start",
        fontSize: 12,
        fontWeight: "bold",
        fill: "#e8e8e8",
        text: "Cyl1nder",
      },
      serial: {
        refX: 8,
        refY: 24,
        textAnchor: "start",
        fontSize: 8,
        fill: "#7a7f87",
        text: "",
      },
      stats: {
        refX: 8,
        refY: 42,
        textAnchor: "start",
        fontSize: 9,
        fill: "#9fd8ff",
        text: "",
      },
    },
    ports: {
      groups: {
        in: {
          position: { name: "left" },
          attrs: {
            circle: { r: 4, magnet: true, stroke: "#4fc3f7", strokeWidth: 1, fill: "#0b2430" },
          },
        },
        out: {
          position: { name: "right" },
          attrs: {
            circle: { r: 4, magnet: true, stroke: "#ff6b6b", strokeWidth: 1, fill: "#2b0b0b" },
          },
        },
      },
      items: [
        ...INPUT_IDS.map((id) => ({ id, group: "in" })),
        ...OUTPUT_IDS.map((id) => ({ id, group: "out" })),
      ],
    },
  });
  Graph.registerNode(NODE_SHAPE, Cyl1nderNode);
}

export function createGraph(container: HTMLElement): Graph {
  return new Graph({
    container,
    autoResize: true,
    background: { color: "#141518" },
    grid: { visible: true, size: 12, type: "dot" },
    panning: true,
    mousewheel: { enabled: true, modifiers: [] },
  });
}

export function upsertHdaNode(graph: Graph, serial: string, statsText: string): Node {
  const existing = graph.getCellById(serial) as Node | undefined;
  if (existing) {
    existing.setAttrs({ serial: { text: serial }, stats: { text: statsText } });
    return existing;
  }
  return graph.addNode({
    shape: NODE_SHAPE,
    id: serial,
    x: 32,
    y: 24,
    width: 220,
    height: 160,
    attrs: { serial: { text: serial }, stats: { text: statsText } },
  });
}