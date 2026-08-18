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
import { fireNodeState, showTooltip, hideTooltip, fireRename, getChannelDisplaySerial } from "./graph";
import type { CylNode } from "./graph";
import { FLOAT, GEO, VEC3 } from "./graph-model";
import { elide } from "../app/elide";

const { RefSocket } = Presets.classic;

/** 序列号/长标签在 tooltip 与副标题里的省略预算（中段省略，两端都留）。 */
const LABEL_MAX = 48;
const SERIAL_MAX = 28;

/**
 * 端口数据类型 -> dot 环颜色类（Houdini VOP 惯例：看颜色即知类型）。
 *
 * 用**与连线完全相同的色板**（nodeview.css）：geo #ff6b6b（默认规则，无类）、
 * float #7ce3a8（.type-float）、vec3 #7fb0ff（.type-vec3）——于是环色与在环内交汇的
 * 那两根线同色。未知/缺省一律按 geo（与 graph-model 的 toSocketType 兜底一致）。
 */
export function dotTypeClass(socketName: string): string {
  if (socketName === FLOAT) return "type-float";
  if (socketName === VEC3) return "type-vec3";
  return ""; // GEO 及未知：默认环色
}

/** dot 的端口类型：以 out0 为准（junction 两端同型；缺则退 in0，再退 geo）。 */
function dotSocketName(node: CylNode): string {
  return node.outputs.out0?.socket?.name ?? node.inputs.in0?.socket?.name ?? GEO;
}

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

  // _dot_ junction node: visually a pure circle (no head/chips/labels/stats), but it
  // MUST still hand rete two real socket anchors or its wires have nowhere to land.
  //
  // Why the anchors exist at all: rete only learns a socket position from a
  // `rendered`/`socket` event carrying the socket ELEMENT (BaseSocketPosition ->
  // SocketsPositionsStorage). The old dot rendered no RefSocket, so
  // sockets.getPosition() returned null for in0/out0, the connection listener never
  // fired a position update, and every wire touching a dot kept a stale/zero endpoint.
  //
  // Why the circle still looks like a circle: the anchors are 4x4 fully transparent
  // spans, absolutely positioned OUT of flow, so they contribute nothing to the 10x10
  // circle's box. They are NOT display:none - getElementCenter() spins on a null
  // offsetParent (`while (!child.offsetParent) await ...`), so a hidden anchor would
  // hang that loop. Transparent + pointer-events:none keeps them measurable and inert.
  //
  // Why the sides look swapped in CSS: DOMSocketPosition adds a FIXED ±12px to the
  // measured centre (-12 input / +12 output). To make both wire ends meet at the
  // circle's centre - the whole point of a Houdini junction dot - each anchor is
  // pre-offset by the opposite 12px, so the ±12 cancels out. See nodeview.css.
  if (node.kind === "dot") {
    const socketName = dotSocketName(node);
    const flags = node.flags ?? { display: false, bypass: false, freeze: false, reference: false };
    const tip = `${elide(node.label, LABEL_MAX)} · junction (${socketName})`;
    // Pass the port's OWN socket instance (never a freshly built one - a new object each
    // render would churn the socket render path for no reason).
    const anchor = (side: "input" | "output", key: string, socket: ClassicPreset.Socket) => (
      <div className={`cyl-rp-dot-port ${side}`} key={key} data-port-id={key}>
        <RefSocket
          name={side}
          side={side}
          emit={emit}
          nodeId={node.id as string as never}
          socketKey={key}
          payload={socket}
        />
      </div>
    );
    return (
      <div
        className={`cyl-rp-dot ${dotTypeClass(socketName)} ${flags.bypass ? "bypass" : ""} ${
          flags.freeze ? "freeze" : ""
        } ${flags.reference ? "reference" : ""} ${flags.display ? "displayed" : ""} ${
          node.selected ? "selected" : ""
        }`}
        onMouseEnter={(e) => showTooltip(e.clientX, e.clientY, tip)}
        onMouseMove={(e) => showTooltip(e.clientX, e.clientY, tip)}
        onMouseLeave={() => hideTooltip()}
      >
        {node.inputs.in0 ? anchor("input", "in0", node.inputs.in0.socket) : null}
        {node.outputs.out0 ? anchor("output", "out0", node.outputs.out0.socket) : null}
      </div>
    );
  }

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

  // P2b 项目根：标题 + label，无端口无 chips（display 等 4 chips 全部不渲染）。
  // 双击改名入口禁用（v1 固定标签）；样式类 .cyl-rp-project。
  if (node.kind === "project") {
    return (
      <div className={`cyl-rp-node cyl-rp-project ${node.selected ? "selected" : ""}`}>
        <div className="cyl-rp-head">
          <span className="cyl-rp-title" title={node.label}>
            {node.label}
          </span>
        </div>
      </div>
    );
  }

  // P2b 成员通道：标题 = label、副标题 = serial；仅渲染 display chip（点亮态跟随
  // channelDisplaySerial——与旧 kinds display 状态机隔离），其余 3 chips 不渲染；
  // 1 in / 1 out 端口保留（视觉关联线用）；双击改名入口禁用（标题与 serial 解耦）。
  // 样式类 .cyl-rp-channel。
  if (node.kind === "channel") {
    const serial = node.channel?.serial ?? "";
    const lit = serial !== "" && getChannelDisplaySerial() === serial;
    return (
      <div className={`cyl-rp-node cyl-rp-channel ${lit ? "displayed" : ""} ${node.selected ? "selected" : ""}`}>
        <div className="cyl-rp-head">
          <span className="cyl-rp-title" title={node.label}>
            {node.label}
          </span>
          <div className="cyl-rp-chips">
            <button
              type="button"
              className={`cyl-ns display ${lit ? "on" : ""}`}
              onPointerDownCapture={(e) => {
                e.stopPropagation();
                displayHandler?.(node.id as string); // 路由到 graph.ts 的 channel display 状态机
              }}
              onMouseEnter={(e) => showTooltip(e.clientX, e.clientY, "Display (active member, unique among channels)")}
              onMouseMove={(e) => showTooltip(e.clientX, e.clientY, "Display (active member, unique among channels)")}
              onMouseLeave={() => hideTooltip()}
            />
          </div>
        </div>
        {/* serial 中段省略：CSS 的 text-overflow 只砍尾巴，而 C1-… 的尾段才是区分位
            （C1-msm6dsp7-ob6t 与 C1-msm6dsp7-zq9x 砍尾后长得一样）。title 给全量。 */}
        <div className="cyl-rp-channel-sub" title={serial}>
          {elide(serial, SERIAL_MAX)}
        </div>
        <div className="cyl-rp-ports">
          <div className="cyl-rp-col">{inputs.map(([k, i]) => (i ? port("input", node.id as string, k, i.socket, i.label ?? k) : null))}</div>
          <div className="cyl-rp-col">{outputs.map(([k, o]) => (o ? port("output", node.id as string, k, o.socket, o.label ?? k) : null))}</div>
        </div>
      </div>
    );
  }

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