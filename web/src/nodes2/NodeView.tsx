/**
 * Custom React node view for the Cyl1nder rete graph (Houdini-SOP style).
 * Rendered via Presets.classic.setup({ customize: { node: NodeView } }).
 *
 * - Node header: name top-left (double-click to rename), 4 state chips top-right
 *   (from right to left): Display (light blue, one per network) / Reference (pink) /
 *   Bypass (yellow) / Freeze (icy blue). Reference/Bypass/Freeze are per-node toggles.
 * - ports rendered with RefSocket; each port div carries data-port-id for linkage.
 */
import React, { useEffect, useReducer, useRef, useState } from "react";
import { ClassicPreset } from "rete";
import { Presets } from "rete-react-plugin";
import type { ClassicScheme, ReactArea2D, RenderEmit } from "rete-react-plugin";
import { fireNodeState, showTooltip, hideTooltip } from "./graph";
import type { CylNode } from "./graph";

const { RefSocket } = Presets.classic;

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
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  const inputs = Object.entries(node.inputs);
  const outputs = Object.entries(node.outputs);
  const flags = node.flags ?? { display: false, bypass: false, freeze: false, reference: false };

  const commitName = () => {
    const v = name.trim();
    if (v && v !== node.label) {
      node.label = v;
      node.baseLabel = v;
      notifyNodeChanged();
    }
    setEditing(false);
  };

  const chip = (
    key: "display" | "reference" | "bypass" | "freeze",
    label: string,
    active: boolean,
    title: string,
  ) => (
    <button
      type="button"
      className={`cyl-ns ${key} ${active ? "on" : ""}`}
      title={title}
      onPointerDownCapture={(e) => {
        e.stopPropagation();
        fireNodeState(node.id as string, key);
      }}
    >
      {label}
    </button>
  );

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
      {side === "input" && <RefSocket name="input" side="input" emit={emit} nodeId={node.id as string as never} socketKey={key} payload={socket} />}
      <span className="cyl-rp-port-label">{label}</span>
      {side === "output" && <RefSocket name="output" side="output" emit={emit} nodeId={node.id as string as never} socketKey={key} payload={socket} />}
    </div>
  );

  return (
    <div
      className={`cyl-rp-node ${flags.bypass ? "bypass" : ""} ${flags.freeze ? "freeze" : ""} ${
        flags.reference ? "reference" : ""
      } ${flags.display ? "displayed" : ""} ${node.selected ? "selected" : ""}`}
    >
      <div className="cyl-rp-head">
        {editing ? (
          <input
            ref={inputRef}
            className="cyl-rp-rename"
            value={name}
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") setEditing(false);
              e.stopPropagation();
            }}
            onBlur={commitName}
            onPointerDownCapture={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="cyl-rp-title"
            title="double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setName(node.label);
              setEditing(true);
            }}
          >
            {node.label}
          </span>
        )}
        <div className="cyl-rp-chips">
          {chip("display", "D", flags.display, "Display (one per network, light blue)")}
          {chip("reference", "R", flags.reference, "Reference (pink, no logic yet)")}
          {chip("bypass", "B", flags.bypass, "Bypass (yellow, no logic yet)")}
          {chip("freeze", "F", flags.freeze, "Freeze (icy blue, no logic yet)")}
        </div>
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