import { Graph, Node } from "@antv/x6";

export const INPUT_NODE = "input_";
export const OUTPUT_NODE = "output_";
const IN_PORTS = ["in0", "in1", "in2", "in3"];
const OUT_PORTS = ["out0", "out1", "out2", "out3"];

/** Data-flow graph: input_ (4 out) -> output_ (4 in). Houdini updates drive the run. */
export function registerNodes(): void {
  const InputNode = Node.define({
    name: INPUT_NODE,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "text", selector: "title" },
      { tagName: "text", selector: "serial" },
      { tagName: "text", selector: "stats" },
    ],
    attrs: {
      body: { refWidth: "100%", refHeight: "100%", fill: "#1c2b24", stroke: "#2f7d54", strokeWidth: 1, rx: 4, ry: 4 },
      title: { refX: 8, refY: 10, textAnchor: "start", fontSize: 12, fontWeight: "bold", fill: "#7ce3a8", text: "Input" },
      serial: { refX: 8, refY: 24, textAnchor: "start", fontSize: 8, fill: "#7a7f87", text: "" },
      stats: { refX: 8, refY: 42, textAnchor: "start", fontSize: 9, fill: "#9fd8ff", text: "" },
    },
    ports: {
      groups: {
        out: {
          position: { name: "right" },
          attrs: { circle: { r: 4, magnet: true, stroke: "#4fc3f7", strokeWidth: 1, fill: "#0b2430" } },
        },
      },
      items: IN_PORTS.map((id) => ({ id, group: "out" })),
    },
  });
  Graph.registerNode(INPUT_NODE, InputNode);

  const OutputNode = Node.define({
    name: OUTPUT_NODE,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "text", selector: "title" },
      { tagName: "text", selector: "stats" },
    ],
    attrs: {
      body: { refWidth: "100%", refHeight: "100%", fill: "#2b1c1c", stroke: "#c94f4f", strokeWidth: 1, rx: 4, ry: 4 },
      title: { refX: 8, refY: 10, textAnchor: "start", fontSize: 12, fontWeight: "bold", fill: "#ff9e9e", text: "Output" },
      stats: { refX: 8, refY: 26, textAnchor: "start", fontSize: 9, fill: "#ffb3b3", text: "" },
    },
    ports: {
      groups: {
        in: {
          position: { name: "left" },
          attrs: { circle: { r: 4, magnet: true, stroke: "#ff6b6b", strokeWidth: 1, fill: "#2b0b0b" } },
        },
      },
      items: OUT_PORTS.map((id) => ({ id, group: "in" })),
    },
  });
  Graph.registerNode(OUTPUT_NODE, OutputNode);
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

/** Create/refresh input_ + output_ nodes and the 4 data-flow edges. */
export function upsertFlowGraph(
  graph: Graph,
  serial: string,
  inputStats: string,
  outputStats: string,
): void {
  let inputNode = graph.getCellById(INPUT_NODE) as Node | undefined;
  if (inputNode) {
    inputNode.setAttrs({ serial: { text: serial }, stats: { text: inputStats } });
  } else {
    inputNode = graph.addNode({
      shape: INPUT_NODE,
      id: INPUT_NODE,
      x: 32,
      y: 40,
      width: 210,
      height: 170,
      attrs: { serial: { text: serial }, stats: { text: inputStats } },
    }) as Node;
  }

  let outputNode = graph.getCellById(OUTPUT_NODE) as Node | undefined;
  if (outputNode) {
    outputNode.setAttrs({ stats: { text: outputStats } });
  } else {
    outputNode = graph.addNode({
      shape: OUTPUT_NODE,
      id: OUTPUT_NODE,
      x: 380,
      y: 40,
      width: 210,
      height: 170,
      attrs: { stats: { text: outputStats } },
    }) as Node;
  }

  for (let i = 0; i < 4; i++) {
    const edgeId = `edge-in${i}-out${i}`;
    if (!graph.getCellById(edgeId)) {
      graph.addEdge({
        id: edgeId,
        source: { cell: INPUT_NODE, port: `in${i}` },
        target: { cell: OUTPUT_NODE, port: `out${i}` },
        attrs: { line: { stroke: "#4fc3f7", strokeWidth: 1 } },
      });
    }
  }
}