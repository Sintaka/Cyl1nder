/**
 * Custom React node view for the Cyl1nder rete graph (Houdini-SOP style).
 * Rendered via Presets.classic.setup({ customize: { node: NodeView } }).
 *
 * - Node header: name top-left (double-click to rename), 4 state chips top-right
 *   (from right to left): Display (light blue, one per network) / Reference (pink) /
 *   Bypass (yellow) / Freeze (icy blue). Reference/Bypass/Freeze are per-node toggles.
 * - ports rendered with RefSocket; each port div carries data-port-id for linkage.
 * - project 根节点：标题下两行 hip 小字（文件名 + 绝对路径，均中段省略、全量进 title）；
 *   node.hip 未绑定时整块不渲染。
 * - 可进入节点（isEnterableKind，目前 geo）：左侧紫罗兰强调条 + 表头 ▸ 标记，纯表现层
 *   （双击进入的手势在 graph-interact.ts）。
 */
import React, { useEffect, useReducer, useRef } from "react";
import { ClassicPreset } from "rete";
import { Presets } from "rete-react-plugin";
import type { ClassicScheme, ReactArea2D, RenderEmit } from "rete-react-plugin";
import { fireNodeState, showTooltip, hideTooltip, fireRename, getChannelDisplaySerial } from "./graph";
import type { CylNode } from "./graph";
import { socketTypeClass, worstSeverity, isEnterableKind } from "./graph-model";
import { elide } from "../app/elide";

const { RefSocket } = Presets.classic;

/** 序列号/长标签在 tooltip 与副标题里的省略预算（中段省略，两端都留）。 */
const LABEL_MAX = 48;
const SERIAL_MAX = 28;
/**
 * 项目根 hip 路径的省略预算。
 *
 * 为什么是 44 而不是照抄 SERIAL_MAX(28)：serial 定长 16 字符（`C1-msm6dsp7-ob6t`），28
 * 是「装得下就不省略」的宽松预算；hip 是**绝对路径**，实测形如
 * `D:/Animation_Project/beginTest/hip/beginTest-1.hip`（50 字符）——按 28 省略会把
 * `D:/Animation_…/beginTest-1.hip` 里的整个项目段吃光，路径就不再能定位「哪个项目」。
 *
 * 44 的来源是**几何**而非口味：小字 9px 等宽字体单字符约 5.4px，44 × 5.4 ≈ 238px，
 * 加节点左右 padding 12px ≈ 250px，正好落在节点 min-width 264px 之内 —— 即这行小字
 * **不会把项目根节点撑宽**（264px 是全局几何契约，不能让一行小字去改它）。
 * 按 elide 的分配（头多分一个）：head 22 字符够放 `D:/Animation_Project/`，
 * tail 21 字符够放 `/hip/beginTest-1.hip`，两端的辨识信息都保住。
 */
const HIP_MAX = 44;
/** hip 文件名单独一行的预算：比路径行短（文件名本就短），超长时同样中段省略——
 *  文件名的区分位在尾部版本号（`shot010-anim-v012.hip`），砍尾就分不出版本。 */
const HIPNAME_MAX = 32;

/** hip 文件名 = 路径最后一段（兼容 `/` 与 `\`，Houdini 在 Windows 上两种都会给）。 */
function hipBaseName(hip: string): string {
  const parts = hip.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
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

  // 错误角标状态：一个节点只出一枚（取最严重），tooltip 列全部原因。
  const nodeErrors = node.errors ?? [];
  const nodeSeverity = worstSeverity(nodeErrors);
  const errorTip = nodeErrors.map((e) => `${e.severity === "warning" ? "⚠" : "✖"} ${e.message}`).join("\n");

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

  // 每个端口必须真的渲染出 RefSocket：rete 只从带 socket ELEMENT 的 `rendered`/`socket`
  // 事件学到位置（BaseSocketPosition -> SocketsPositionsStorage）。不渲染 RefSocket 的端口
  // 会让 sockets.getPosition() 返回 null，连接监听器永不触发位置更新，接在该端口上的线
  // 就一直停在过期/零点坐标上。
  const port = (
    side: "input" | "output",
    id: string,
    key: string,
    socket: ClassicPreset.Socket,
    label: string,
  ) => {
    // 该端口自己的错误（NodeError.port === key）：端口点标红并把原因并进 tooltip，
    // 这样"哪个端口有问题"一眼可见，不用去翻节点 info。
    const portErr = (node.errors ?? []).find((e) => e.port === key);
    const tip =
      `${side} · ${label} (${socket.name})` + (portErr ? `\n⚠ ${portErr.message}` : "");
    return (
    <div
      className={`cyl-rp-port ${side} ${socketTypeClass(socket.name)}${portErr ? " has-error" : ""}`}
      key={key}
      data-port-id={key}
      onMouseEnter={(e) => showTooltip(e.clientX, e.clientY, tip)}
      onMouseMove={(e) => showTooltip(e.clientX, e.clientY, tip)}
      onMouseLeave={() => hideTooltip()}
    >
      {side === "input" && <RefSocket name="input" side="input" emit={emit} nodeId={node.id as string as never} socketKey={key} payload={socket} />}
      <span className="cyl-rp-port-label">{label}</span>
      {side === "output" && <RefSocket name="output" side="output" emit={emit} nodeId={node.id as string as never} socketKey={key} payload={socket} />}
    </div>
    );
  };

  const inputs = Object.entries(node.inputs);
  const outputs = Object.entries(node.outputs);
  const flags = node.flags ?? { display: false, bypass: false, freeze: false, reference: false };
  // 「可进入」按**能力**判定（isEnterableKind），不硬编码 "geo"：以后多一种容器 kind，
  // 这里与 CSS 都不用改。纯表现层——双击进入的手势在 graph-interact.ts（非本写集）。
  const enterable = isEnterableKind(node.kind);

  // P2b 项目根：标题 + label，无端口无 chips（display 等 4 chips 全部不渲染）。
  // 双击改名入口禁用（v1 固定标签）；样式类 .cyl-rp-project。
  if (node.kind === "project") {
    // hip 是**纯显示值**（makeProjectNode 的第 5 参 → CylNode.hip）：权威来源在桥侧
    // ProjectRef.hip，每次 loadProjectGraph 重新注入、不进快照（理由见 graph-model.ts
    // 的 CylNode.hip 注释）。故这里绝不拿它做解析/比较/去重，只管画。
    // 未绑定 hip 时是 undefined —— 下面整块不渲染（不留空行，节点回到"只有标题"的原样）。
    const hip = node.hip ?? "";
    const hipName = hipBaseName(hip);
    return (
      <div className={`cyl-rp-node cyl-rp-project ${node.selected ? "selected" : ""}`}>
        <div className="cyl-rp-head">
          <span className="cyl-rp-title" title={node.label}>
            {node.label}
          </span>
        </div>
        {/* hip 路径中段省略，理由与下面 channel 的 serial 完全同源：CSS 的 text-overflow
            只砍尾巴，而路径的辨识信息在**两端**——头部是盘符/项目
            （`D:/Animation_Project/…`）、尾部才是文件名（`beginTest-1.hip`），
            砍尾会把两个不同项目的 hip 显示成同一个字符串。title 一律给全量。
            文件名**另起一行**而不是靠路径尾段兜着：路径行的 tail 预算是定值（44 → 21 字符），
            文件名一旦超过它，被吃掉的就是文件名的**头部**——实测
            `…/sh0125_fx_destruction_rbd_v027.hip` 在路径行里只剩 `truction_rbd_v027.hip`，
            `sh0125_fx_des` 没了。而"当前是哪个 hip"恰是这块小字最该回答的问题，
            故单独一行按文件名自己的预算省略，头部永不被路径的目录段挤掉。 */}
        {hip ? (
          <>
            <div className="cyl-rp-project-hipname" title={hip}>
              {elide(hipName, HIPNAME_MAX)}
            </div>
            <div className="cyl-rp-project-hip" title={hip}>
              {elide(hip, HIP_MAX)}
            </div>
          </>
        ) : null}
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
      } ${flags.display ? "displayed" : ""} ${node.selected ? "selected" : ""}${
        nodeSeverity ? ` has-${nodeSeverity}` : ""
      }${enterable ? " cyl-rp-enterable" : ""}`}
    >
      {/* 错误角标（照 Houdini：红三角=error、黄三角=warning）。
          一个节点只出一枚，取最严重的一条；tooltip 列出全部原因，
          所以"节点 info 里说明报错原因"不需要额外面板。 */}
      {nodeSeverity ? (
        <span
          className={`cyl-rp-badge ${nodeSeverity}`}
          onMouseEnter={(e) => showTooltip(e.clientX, e.clientY, errorTip)}
          onMouseMove={(e) => showTooltip(e.clientX, e.clientY, errorTip)}
          onMouseLeave={() => hideTooltip()}
        >
          ▲
        </span>
      ) : null}
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
        {/* 可进入标记：树视图「可展开」的惯用 ▸。装饰件，不绑事件（pointer-events:none 在 CSS），
            拖拽/双击照旧落到节点本体。 */}
        {enterable ? (
          <span className="cyl-rp-enter-hint" title="double-click to enter this container">
            ▸
          </span>
        ) : null}
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