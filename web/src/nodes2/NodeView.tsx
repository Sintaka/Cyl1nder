/**
 * Custom React node view for the Cyl1nder rete graph (Houdini-SOP style).
 * Rendered via Presets.classic.setup({ customize: { node: NodeView } }).
 *
 * - Houdini display button (blue rounded chip, top-right, one per network):
 *   clicking it makes THIS node the only display node.
 * - ports rendered with RefSocket (real sockets, no big blue container);
 *   each port div carries data-port-id for viewport linkage.
 * - stats line + flag badges (bypass/freeze/wireframe).
 */
import React, { useEffect, useReducer, useRef } from "react";
import { ClassicPreset } from "rete";
import { Presets } from "rete-react-plugin";
const { RefSocket } = Presets.classic;
import type { ClassicScheme, RenderEmit, ReactArea2D } from "rete-react-plugin";
import type { NodeId } from "rete";
import { hideTooltip, showTooltip } from "./graph";
import type { CylNode } from "./graph";

/** Module-level display handler registered by createReteGraph. */
let displayHandler: ((nodeId: string) => void) | null = null;
export function setDisplayHandler(fn: ((nodeId: string) => void) | null): void {
  displayHandler = fn;
}

/** All mounted NodeViews re-read node flags when this fires (bypasses rete render signal). */
const displayListeners = new Set<() => void>();
export function notifyNodeChanged(): void {
  for (const fn of displayListeners) fn();
}
function subscribeNodeChanged(fn: () => void): () => void {
  displayListeners.add(fn);
  return () => displayListeners.delete(fn);
}

type Props = {
  data: ClassicScheme["Node"];
  emit: RenderEmit<ClassicScheme>;
};

export function NodeView({ data, emit }: Props) {
  const node = data as CylNode;
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeNodeChanged(() => force()), []);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    // native capture listener: area-plugin stops bubbling of React synthetic events
    const onDown = (e: PointerEvent) => {
      e.stopPropagation();
      displayHandler?.(node.id as string);
    };
    el.addEventListener("pointerdown", onDown, true);
    return () => el.removeEventListener("pointerdown", onDown, true);
  }, [node.id]);
  const inputs = Object.entries(node.inputs);
  const outputs = Object.entries(node.outputs);
  const flags = node.flags ?? { display: false, bypass: false, freeze: false, wireframe: false };

  const port = (
    side: "input" | "output",
    id: string,
    key: string,
    socket: ClassicPreset.Socket,
    label: string,
  ) => (
    <div
      className={`cyl-rp-port ${side}`}
      key={key}
      data-port-id={key}
      onMouseEnter={(e) => showTooltip(e.clientX, e.clientY, `${side} · ${label} (${socket.name})`)}
      onMouseMove={(e) => showTooltip(e.clientX, e.clientY, `${side} · ${label} (${socket.name})`)}
      onMouseLeave={() => hideTooltip()}
    >
      {side === "input" && <RefSocket name="input" side="input" emit={emit} nodeId={node.id as NodeId} socketKey={key} payload={socket} />}
      <span className="cyl-rp-port-label">{label}</span>
      {side === "output" && <RefSocket name="output" side="output" emit={emit} nodeId={node.id as NodeId} socketKey={key} payload={socket} />}
    </div>
  );

  return (
    <div
      className={`cyl-rp-node ${flags.bypass ? "bypass" : ""} ${flags.freeze ? "freeze" : ""} ${
        flags.wireframe ? "wireframe" : ""
      } ${flags.display ? "displayed" : ""}`}
    >
      <div className="cyl-rp-head">
        <span className="cyl-rp-title">{node.label}</span>
        <span className="cyl-rp-badges">
          {flags.bypass ? "⏭" : ""}
          {flags.freeze ? "🔒" : ""}
          {flags.wireframe ? "⛶" : ""}
        </span>
        <button
          ref={btnRef}
          type="button"
          className={`cyl-rp-display ${flags.display ? "on" : ""}`}
          onMouseEnter={(e) => showTooltip(e.clientX, e.clientY, "Display: show this node's output (one per network)")}
          onMouseMove={(e) => showTooltip(e.clientX, e.clientY, "Display: show this node's output (one per network)")}
          onMouseLeave={() => hideTooltip()}
        >
          D
        </button>
      </div>
      {node.stats ? <div className="cyl-rp-stats">{node.stats}</div> : null}
      <div className="cyl-rp-ports">
        <div className="cyl-rp-col">{inputs.map(([k, i]) => (i ? port("input", node.id as string, k, i.socket, i.label ?? k) : null))}</div>
        <div className="cyl-rp-col">{outputs.map(([k, o]) => (o ? port("output", node.id as string, k, o.socket, o.label ?? k) : null))}</div>
      </div>
    </div>
  );
}

// re-export type used by graph.ts without importing rete directly
export type { ReactArea2D };