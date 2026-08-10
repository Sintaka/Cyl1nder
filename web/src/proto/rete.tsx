/**
 * rete.js 2 prototype - Houdini-style node graph with engine-level caching.
 * Visit /proto-rete.html (independent dev entry; does not touch main app).
 *
 * Demonstrates:
 *  - 4-in/4-out vertical nodes (input_ -> transform -> output_)
 *  - engine-level output caching (rete-engine Dataflow): recompute only when
 *    inputs/connections change - watch "RECOMPUTE" logs vs cache hits.
 *  - node-level bypass flag (transform) with a page-level toggle.
 */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClassicPreset, NodeEditor } from "rete";
import { AreaPlugin, AreaExtensions } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { DataflowEngine, type DataflowEngineScheme } from "rete-engine";
import { Presets, ReactPlugin, useRete } from "rete-react-plugin";
import type { ClassicScheme, ReactArea2D } from "rete-react-plugin";
import { store } from "../stores/workspace";

type Schemes = ClassicScheme;
type AreaExtra = ReactArea2D<Schemes>;
type Ctx = { editor: NodeEditor<Schemes>; engine: DataflowEngine<DataflowEngineScheme> };

const log = (m: string) => store.pushLog(`[rete-proto] ${m}`);
const GEO = "geo";

// ---------------------------------------------------------------------------
// nodes (ClassicPreset.Node + data() = DataflowNode)
// ---------------------------------------------------------------------------

class InputNode extends ClassicPreset.Node {
  constructor() {
    super("input_");
    for (let i = 0; i < 4; i++) this.addOutput(`in${i}`, new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  }
  data(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < 4; i++) out[`in${i}`] = { port: i, src: "input_" };
    return out;
  }
}

export class TransformNode extends ClassicPreset.Node {
  flags = { bypass: false };
  constructor() {
    super("transform");
    for (let i = 0; i < 4; i++) {
      this.addInput(`in${i}`, new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
      this.addOutput(`out${i}`, new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
    }
  }
  data(inputs: Record<string, unknown[]>): Record<string, unknown> {
    log("transform.data() RECOMPUTE" + (this.flags.bypass ? " [bypass: passthrough]" : ""));
    const out: Record<string, unknown> = {};
    for (let i = 0; i < 4; i++) {
      const v = inputs[`in${i}`]?.[0];
      out[`out${i}`] = this.flags.bypass
        ? v ?? { empty: true }
        : v
          ? { ...(v as object), transformed: true }
          : { empty: true };
    }
    return out;
  }
}

class OutputNode extends ClassicPreset.Node {
  constructor() {
    super("output_");
    for (let i = 0; i < 4; i++) this.addInput(`out${i}`, new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
  }
  data(inputs: Record<string, unknown[]>): Record<string, unknown> {
    log("output_.data() consumed");
    return inputs;
  }
}

// ---------------------------------------------------------------------------
// editor + engine
// ---------------------------------------------------------------------------

/** createEditor for useRete: engine auto-registers via editor.use (listens nodecreated). */
async function createEditor(el: HTMLElement): Promise<Ctx & { destroy: () => void }> {
  const editor = new NodeEditor<Schemes>();
  const area = new AreaPlugin<Schemes, AreaExtra>(el);
  const connection = new ConnectionPlugin<Schemes, AreaExtra>();
  const engine = new DataflowEngine<DataflowEngineScheme>();
  const react = new ReactPlugin<Schemes, AreaExtra>({ createRoot });

  // rete 2 plugin hierarchy: editor.use(area) + area.use(render/connection);
  // engine attaches to the editor (dataflow layer).
  connection.addPreset(ConnectionPresets.classic.setup());
  react.addPreset(Presets.classic.setup());
  AreaExtensions.simpleNodesOrder(area);
  AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
    accumulating: AreaExtensions.accumulateOnCtrl(),
  });

  // casts keep the prototype typecheck clean (strict types at migration)
  (editor as unknown as { use(p: unknown): void }).use(area);
  (area as unknown as { use(p: unknown): void }).use(react);
  (area as unknown as { use(p: unknown): void }).use(connection);
  (editor as unknown as { use(p: DataflowEngine<DataflowEngineScheme>): void }).use(engine);

  const input = new InputNode();
  const transform = new TransformNode();
  const output = new OutputNode();

  for (const n of [input, transform, output]) await editor.addNode(n);
  await area.translate(input.id, { x: 20, y: 40 });
  await area.translate(transform.id, { x: 320, y: 40 });
  await area.translate(output.id, { x: 620, y: 40 });

  for (let i = 0; i < 4; i++) {
    await editor.addConnection(
      new ClassicPreset.Connection(input, `in${i}`, transform, `in${i}`) as unknown as Schemes["Connection"],
    );
    await editor.addConnection(
      new ClassicPreset.Connection(transform, `out${i}`, output, `out${i}`) as unknown as Schemes["Connection"],
    );
  }

  void AreaExtensions.zoomAt(area, editor.getNodes());
  const r = await engine.fetch(output.id);
  log(`initial fetch(output_) -> ${JSON.stringify(r).slice(0, 160)}`);

  return {
    editor,
    engine,
    destroy: () => (editor as unknown as { destroy?: () => void }).destroy?.(),
  };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export function ReteProto() {
  const [ref, ret] = useRete(createEditor);
  const [logs, setLogs] = useState<string[]>([]);
  useEffect(() => store.subscribe(() => setLogs(store.logs.slice(-14))), []);

  const outNode = () => ret?.editor.getNodes().find((n) => n.label === "output_");

  const toggleBypass = () => {
    if (!ret) return;
    const t = ret.editor.getNodes().find((n) => n.label === "transform") as TransformNode | undefined;
    if (!t) return;
    t.flags.bypass = !t.flags.bypass;
    log(`transform bypass = ${t.flags.bypass}`);
    ret.engine.reset();
    const out = outNode();
    if (out) void ret.engine.fetch(out.id).then((r: Record<string, any>) => log(`after bypass -> ${JSON.stringify(r).slice(0, 160)}`));
  };

  const refetch = () => {
    if (!ret) return;
    const out = outNode();
    if (!out) return;
    void ret.engine.fetch(out.id).then((r: Record<string, any>) => log(`fetch(output_) -> ${JSON.stringify(r).slice(0, 160)}`));
  };

  const reset = () => {
    if (!ret) return;
    ret.engine.reset();
    log("engine.reset() - next fetch recomputes");
    refetch();
  };

  return (
    <div className="proto-wrap">
      <div className="proto-toolbar">
        <button onClick={toggleBypass}>Toggle transform bypass</button>
        <button onClick={refetch}>fetch(output_)</button>
        <button onClick={reset}>engine.reset + fetch</button>
        <span className="proto-note">repeated fetch(output_) = cache hit (no RECOMPUTE)</span>
      </div>
      <div ref={ref} className="proto-editor" />
      <pre className="proto-log">{logs.join("\n")}</pre>
    </div>
  );
}

export function mountReteProto(container: HTMLElement): () => void {
  const root = createRoot(container);
  root.render(React.createElement(ReteProto));
  return () => root.unmount();
}