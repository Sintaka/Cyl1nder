/**
 * Custom React node view for the Cyl1nder rete graph (Houdini-SOP style).
 * Rendered via Presets.classic.setup({ customize: { node: NodeView } }).
 *
 * - Node header: name top-left (double-click to rename), 4 state chips top-right
 *   (from right to left): Display (light blue, one per network) / Reference (pink) /
 *   Bypass (yellow) / Freeze (icy blue). Reference/Bypass/Freeze are per-node toggles.
 * - ports rendered with RefSocket; each port div carries data-port-id for linkage.
 */
import React, { useEffect, useReducer, useRef } from "react";
import { ClassicPreset } from "rete";
import { Presets } from "rete-react-plugin";
import type { ClassicScheme, ReactArea2D, RenderEmit } from "rete-react-plugin";
import { fireNodeState, showTooltip, hideTooltip, fireRename } from "./graph";
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

/**
 * Last pointerdown on a node title, for manual double-click detection.
 * Module-level on purpose: NodeView is remounted by the rete react plugin on
 * selection re-renders, so a per-instance ref would reset between the two clicks
 * of a double-click and the rename would never open.
 */
let lastTitleDown: { t: number; x: number; y: number } | null = null;

/**
 * Rename-in-progress state. Also module-level on purpose: the rete react plugin
 * remounts NodeView on selection re-renders (which the double-click gesture itself
 * triggers), so per-instance state would be reset and close the rename input.
 */
let editingNodeId: string | null = null;
let editValue = "";

type Props = {
  data: ClassicScheme["Node"];
  emit: RenderEmit<ClassicScheme>;
};

export function NodeView({ data, emit }: Props) {
  const node = data as CylNode;
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeNodeChanged(() => force()), []);
  const btnRef = useRef<HTMLButtonElement>(null);
  const editing = editingNodeId === node.id;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) return;
    // Focus on the next frame AND after a short delay: the freshly-mounted input may
    // not be interactive yet, and the tail of the dblclick gesture (including the
    // rete-triggered remount) can steal focus / unmount a focused input. Focusing
    // after that settles keeps the input reliably focused for typing.
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select(); // selecting-all means typing replaces the old name
    });
    const late = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 120);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(late);
    };
  }, [editing]);

  const startRename = () => {
    lastTitleDown = null;
    editingNodeId = node.id as string;
    editValue = node.label;
    force();
  };

  const commitName = () => {
    const v = editValue.trim();
    if (v && v !== node.label) {
      // Ultimate suffix dedup: the graph-level rename handler returns a label that is
      // unique across ALL nodes (foo -> foo1 -> foo2 ...) and applies it to the node.
      const final = fireRename(node.id as string, v);
      if (node.label !== final) {
        node.label = final;
        notifyNodeChanged();
      }
    }
    editingNodeId = null;
    force();
  };

  const chip = (
    key: "display" | "reference" | "bypass" | "freeze",
    active: boolean,
    title: string,
  ) => (
    <button
      type="button"
      className={`cyl-ns ${key} ${active ? "on" : ""}`}
      onPointerDownCapture={(e) => {
        e.stopPropagation();
        if (key === "display") {
          // display is unique per network - route to the display handler, not fireNodeState
          displayHandler?.(node.id as string);
        } else {
          fireNodeState(node.id as string, key);
        }
      }}
      onMouseEnter={(e) => showTooltip(e.clientX, e.clientY, title)}
      onMouseMove={(e) => showTooltip(e.clientX, e.clientY, title)}
      onMouseLeave={() => hideTooltip()}
    >
      {/* pure color block - no letter */}
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

  const inputs = Object.entries(node.inputs);
  const outputs = Object.entries(node.outputs);
  const flags = node.flags ?? { display: false, bypass: false, freeze: false, reference: false };

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
            value={editValue}
            spellCheck={false}
            onChange={(e) => {
              editValue = e.target.value;
              force();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                editingNodeId = null;
                force();
              }
              e.stopPropagation();
            }}
            onBlur={commitName}
            onPointerDownCapture={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="cyl-rp-title"
            title="double-click to rename"
            onPointerDownCapture={(e) => {
              // rete's node pointerdown chain (Drag -> nodepicked -> simpleNodesOrder)
              // reorders the node element in the DOM, which suppresses the browser's
              // click/dblclick events on this span, so onDoubleClick alone never fires.
              // Detect the double-click manually so the rename input reliably opens.
              const now = performance.now();
              const last = lastTitleDown;
              if (last && now - last.t < 400 && Math.abs(e.clientX - last.x) < 8 && Math.abs(e.clientY - last.y) < 8) {
                e.preventDefault(); // suppress the tail mousedown of the dblclick so it cannot steal focus
                startRename();
              } else {
                lastTitleDown = { t: now, x: e.clientX, y: e.clientY };
              }
            }}
            onDoubleClick={(e) => {
              e.preventDefault(); // stop native text selection of the title
              e.stopPropagation();
              startRename();
            }}
          >
            {node.label}
          </span>
        )}
        <div className="cyl-rp-chips">
          {chip("display", flags.display, "Display (one per network, light blue)")}
          {chip("reference", flags.reference, "Reference (pink, no logic yet)")}
          {chip("bypass", flags.bypass, "Bypass (yellow, no logic yet)")}
          {chip("freeze", flags.freeze, "Freeze (icy blue, no logic yet)")}
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