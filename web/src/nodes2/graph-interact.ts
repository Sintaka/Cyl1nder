/**
 * Graph interaction layer (2.2 split): Tab search, Y cut mode, flag menu,
 * MMB pan, dot grid, insertion, rect select, shake disconnect, tooltip, and the
 * node state / rename handlers. All DOM/listener wiring lives here.
 */
import { ClassicPreset, NodeEditor } from "rete";
import { AreaPlugin } from "rete-area-plugin";
import Fuse from "fuse.js";
import { store } from "../stores/workspace";
import { notifyNodeChanged } from "./NodeView";
import type { ConnectionRef, UndoManager } from "./undo";
import type { CylNode, NodeFlags } from "./graph-model";
import {
  PORT_PARAM,
  TYPE_PARAM,
  canConnectSockets,
  isEnterableKind,
  log,
  makePaletteNode,
  netKindOfCreatable,
  nodeFromTarget,
  nodeSocketType,
  notifySelection,
  setConnectionWaypoint,
  syncPortSocketType,
} from "./graph-model";
import type { AreaExtra, NetKind, NodeKind, ParamSpec, ReteGraphHandlers, Schemes } from "./graph-model";
import { cachedPorts, loadCapabilities, normalizeSerial } from "./serial-capabilities";

interface PaletteEntry {
  kind: NodeKind;
  label: string;
  desc: string;
  keywords: string;
}

const PALETTE: PaletteEntry[] = [
  { kind: "geo", label: "geo", desc: "geometry container 可进入", keywords: "geo geometry object subnet 几何 容器 进入" },
  // desc 从「4-output source」改为单端口说明：面板建的是 schema 4 单端口形态
  // （1 端口 + serial 地址 + 端口选择），4 端口形状只存在于旧图恢复。
  { kind: "input", label: "_input_", desc: "source 单端口 serial+port", keywords: "source input 输入 起点 serial 地址" },
  { kind: "output", label: "_output_", desc: "sink 单端口 serial+port", keywords: "sink output 输出 终点 serial 地址" },
  { kind: "null", label: "null", desc: "passthrough 1+1", keywords: "null passthrough 直通" },
  { kind: "transform", label: "transform", desc: "translate by group 变换/移动", keywords: "transform translate move 变换 移动 组" },
];
// dot 不再是可创建的节点：路径中点（waypoint）是挂在**连接**上的纯装饰属性，
// 由 Alt+左键点线创建（见 attachReconnect），既不进拓扑也不影响 cook。
// P2b：project/channel 刻意不出现在 Tab 面板（它们只能由 loadProjectGraph 建立——项目根
// 与成员通道不是可自由创建的图元）；create() 与既有交互对这两种 kind 无特殊逻辑。

const fuse = new Fuse(PALETTE, {
  keys: [
    { name: "label", weight: 0.5 },
    { name: "desc", weight: 0.25 },
    { name: "keywords", weight: 0.25 },
  ],
  threshold: 0.4,
  ignoreLocation: true,
});

/**
 * 当前层级提供方（v0.1.00119）：graph.ts 在 createReteGraph 里注册，Tab 面板据此过滤。
 *
 * 为什么是回调而不是参数：`attachTabSearch` 只在建图时调用**一次**，而层级会随
 * 进入/退出子网络变化——传值会永久冻结在建图那一刻的层级上。缺省 `"sop"`：
 * 未注册时（单测直接调 attachTabSearch / ?serial= 单 serial 路径）面板内容与改造前
 * 逐字一致（input/output/null/transform），geo 不出现。
 */
let netKindProvider: (() => NetKind) | null = null;
export function setNetKindProvider(fn: (() => NetKind) | null): void {
  netKindProvider = fn;
}

function currentNetKind(): NetKind {
  return netKindProvider?.() ?? "sop";
}

/** 本层可创建的面板条目：`netKindOfCreatable(kind) === 当前层`。
 *  project/channel 返回 null → 永不入选（它们只能由 loadProjectGraph 建立）。 */
function paletteForCurrentLayer(): PaletteEntry[] {
  const layer = currentNetKind();
  return PALETTE.filter((e) => netKindOfCreatable(e.kind) === layer);
}

let lastGraphMouse = { x: 0, y: 0 };

// ---------------------------------------------------------------------------
// Cross-mode interaction coordination: a connection reconnect gesture claims the
// pointer, so rect-select / shake / insertion must not start while it is busy.
// Window-level Escape (graph.ts) cancels every in-flight gesture via the registry.
// ---------------------------------------------------------------------------
let reconnectPointerActive = false; // pointerdown started on a connection
let reconnectGrabbed = false;       // connection drag is live (preview follows mouse)

/** True while a connection reconnect gesture owns the pointer. */
export function isReconnectBusy(): boolean {
  return reconnectPointerActive || reconnectGrabbed;
}

type InteractionCanceller = () => void;
let interactionCancellers: InteractionCanceller[] = [];

export function registerInteractionCanceller(fn: InteractionCanceller): void {
  if (!interactionCancellers.includes(fn)) interactionCancellers.push(fn);
}

/** Runs every registered Escape-canceller (reconnect / insertion / palette). */
export function cancelGraphInteractions(): void {
  for (const fn of [...interactionCancellers]) fn();
}

export function attachTabSearch(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): void {
  const overlay = document.createElement("div");
  overlay.className = "cyl-palette hidden";
  overlay.innerHTML = `<input class="cyl-palette-input" placeholder="Tab: search nodes…" spellcheck="false" /><div class="cyl-palette-list"></div>`;
  const input = overlay.querySelector(".cyl-palette-input") as HTMLInputElement;
  const list = overlay.querySelector(".cyl-palette-list") as HTMLDivElement;
  container.appendChild(overlay);

  let open = false;
  let index = 0;
  let results: PaletteEntry[] = [];

  const render = () => {
    list.innerHTML = "";
    results.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "cyl-palette-row" + (i === index ? " active" : "");
      row.innerHTML = `<span class="p-label">${r.label}</span><span class="p-desc">${r.desc}</span>`;
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        index = i;
        create();
      });
      list.appendChild(row);
    });
  };

  const create = async (mirror = false) => {
    const entry = results[index];
    if (!entry) return;
    // place near the mouse if it is inside the graph, else a default spot
    const rect = container.getBoundingClientRect();
    const inside =
      lastGraphMouse.x >= rect.left && lastGraphMouse.x <= rect.right && lastGraphMouse.y >= rect.top && lastGraphMouse.y <= rect.bottom;
    let center = { x: 240, y: 120 };
    if (inside) {
      const t = area.area.transform; // screen -> area-local: (client - rect - translate) / zoom
      center = {
        x: (lastGraphMouse.x - rect.left - t.x) / t.k,
        y: (lastGraphMouse.y - rect.top - t.y) / t.k,
      };
    }
    // 每个面板条目都是「每次 Tab 都新建一个」的工厂类节点（各有独立序号）。
    // 「建哪种 / 建成什么形状 / 撞名怎么办」是 makePaletteNode 的职责（graph-model，可单测）；
    // 这里只剩 addNode + translate 的接线。
    //
    // **_input_/_output_ 为什么从"每图唯一、移过去"改成"新建"**（v0.1.00120 修的 bug）：
    // 旧代码假设默认那一对必然存在，于是只把它 area.translate 到鼠标处。自 v0.1.00119
    // 起项目根图是空的、新建的 geo 子网络也是空的，`find()` 什么都找不到 → 面板**静默
    // 什么都不做**（用户报的「新建不了 input 和 output 节点」就是这个）。而且用户现在
    // 明确要能拉多个：一个 input 填一个 serial 地址、一个 output 填另一个，再连起来。
    const taken = new Set(editor.getNodes().map((x) => (x as CylNode).label));
    const n = makePaletteNode(entry.kind, taken);
    if (!n) {
      close();
      return; // project/channel 之类不可建的 kind：原地返回（面板本就不列它们）
    }
    await editor.addNode(n);
    await area.translate(n.id, center);
    log(`created ${entry.kind} node ${n.label}`);
    close();
    // Shift+Enter：刚建出来的这个 `_output_` 立刻接收选中 input 的镜像（用户要求的
    // 「Tab 选到 output，此时 shift+Enter」那条路径）。只对 output 生效——别的 kind 没有
    // address/port 参数，镜像无从谈起；此时**不新建**额外节点，n 个 input 里配不上的
    // 那些由 runShiftEnterWire 逐个报原因跳过。
    // layout=true：这个节点刚建出来、从未被 pick，摆它不会连带拖走用户选中的 input
    // （见 runShiftEnterWire 的 layout 论证），而且它的位置本来就还没被用户指定过。
    if (mirror && n.kind === "output") await startShiftEnterWire(editor, area, [n], true);
  };

  const close = () => {
    open = false;
    overlay.classList.add("hidden");
    input.blur();
  };
  // Window-level Escape (graph.ts) closes the palette too.
  registerInteractionCanceller(close);

  const update = (q: string) => {
    // 先按当前层级过滤，再让 fuse 在**全表**上搜索后取交集：fuse 索引建于模块加载时、
    // 无法随层级重建，所以过滤放在结果侧（层级集合很小，代价可忽略）。
    const allowed = paletteForCurrentLayer();
    const inLayer = new Set(allowed.map((e) => e.kind));
    results = q.trim() ? fuse.search(q).map((r) => r.item).filter((e) => inLayer.has(e.kind)) : allowed;
    index = 0;
    render();
  };

  input.addEventListener("input", () => update(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { index = (index + 1) % Math.max(1, results.length); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { index = (index - 1 + results.length) % Math.max(1, results.length); render(); e.preventDefault(); }
    // Shift+Enter 与 Enter 分开：Enter 只建节点（旧行为逐字不变），Shift+Enter 建完
    // 立刻镜像。焦点此刻在面板输入框上，而 core/shortcuts.ts 的 Enter 分支对
    // input/textarea 一律早退，所以这条路径与视口 Enter 枢轴天然不冲突。
    else if (e.key === "Enter") { create(e.shiftKey); e.preventDefault(); }
    else if (e.key === "Escape") { close(); e.preventDefault(); }
  });

  attachShiftEnterWire(editor, area);

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    open = !open;
    if (open) { overlay.classList.remove("hidden"); input.value = ""; update(""); input.focus(); }
    else close();
  });
}

// ---------------------------------------------------------------------------
// Y cut line: hold Y, drag a red line across connections to cut them all
// ---------------------------------------------------------------------------

/** Screen-space point-to-segment distance (px). */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Sample a connection's rendered SVG path into screen-space points (same technique as hitTestConnection). */
function sampleConnectionPath(
  area: AreaPlugin<Schemes, AreaExtra>,
  id: string,
): { x: number; y: number }[] | null {
  const view = area.connectionViews.get(id);
  if (!view) return null;
  const svg = (view.element.querySelector("path") ?? view.element) as SVGPathElement | null;
  if (!svg || typeof svg.getTotalLength !== "function") return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const len = svg.getTotalLength();
  const step = Math.max(4, len / 40);
  const pts: { x: number; y: number }[] = [];
  for (let t = 0; t <= len; t += step) {
    const p = svg.getPointAtLength(t);
    const sp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
    pts.push({ x: sp.x, y: sp.y });
  }
  return pts;
}

export function attachCutMode(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  handlers: ReteGraphHandlers,
  undoManager: UndoManager,
): void {
  let armed = false;
  let drawing = false;
  let pts: { x: number; y: number }[] = [];

  // Full-cover, absolutely-positioned SVG for the red cut polyline. pointer-events:none
  // so it never intercepts graph input; z-index above nodes/connections/previews.
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:9;";
  svg.style.width = "100%";
  svg.style.height = "100%";
  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  poly.setAttribute("stroke", "#ff3b30");
  poly.setAttribute("stroke-width", "2");
  poly.setAttribute("stroke-linecap", "round");
  poly.setAttribute("fill", "none");
  poly.setAttribute("points", "");
  svg.appendChild(poly);
  container.appendChild(svg);

  const isTyping = () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    return el.getClientRects().length > 0;
  };

  const pathLen = (arr: { x: number; y: number }[]) => {
    let len = 0;
    for (let i = 1; i < arr.length; i++) len += Math.hypot(arr[i].x - arr[i - 1].x, arr[i].y - arr[i - 1].y);
    return len;
  };
  const setPoints = (arr: { x: number; y: number }[]) => {
    const rect = container.getBoundingClientRect();
    poly.setAttribute("points", arr.map((p) => `${p.x - rect.left},${p.y - rect.top}`).join(" "));
  };
  const clear = () => {
    pts = [];
    poly.setAttribute("points", "");
  };

  const cutConnection = (id: string) => {
    const conn = editor.getConnection(id) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
    const src = conn ? ((editor.getNode(conn.source) as CylNode | undefined)?.label ?? conn.source) : "?";
    const tgt = conn ? ((editor.getNode(conn.target) as CylNode | undefined)?.label ?? conn.target) : "?";
    if (conn) {
      undoManager.push({
        type: "cut",
        connection: { source: conn.source, sourceOutput: conn.sourceOutput, target: conn.target, targetInput: conn.targetInput },
      });
    }
    void editor.removeConnection(id);
    log(`cut connection ${id} (${src} -> ${tgt})`);
    handlers.onNetworkChanged?.();
  };

  const cutByPolyline = (arr: { x: number; y: number }[]) => {
    // One stroke = one undoable operation: collect every hit once (the same
    // connection may be crossed by several polyline segments), then remove all.
    const cutRefs: ConnectionRef[] = [];
    const seen = new Set<string>();
    const ids = Array.from(area.connectionViews.keys());
    for (const id of ids) {
      if (!area.connectionViews.has(id)) continue;
      const sampled = sampleConnectionPath(area, id);
      if (!sampled) continue;
      for (let i = 1; i < arr.length; i++) {
        const ax = arr[i - 1].x;
        const ay = arr[i - 1].y;
        const bx = arr[i].x;
        const by = arr[i].y;
        if (!sampled.some((p) => distToSegment(p.x, p.y, ax, ay, bx, by) <= 8)) continue;
        const conn = editor.getConnection(id) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
        if (conn && !seen.has(id)) {
          seen.add(id);
          cutRefs.push({
            source: conn.source,
            sourceOutput: conn.sourceOutput,
            target: conn.target,
            targetInput: conn.targetInput,
          });
        }
        break;
      }
    }
    if (cutRefs.length === 0) return;
    for (const id of seen) void editor.removeConnection(id);
    undoManager.push({ type: "cut-many", connections: cutRefs });
    log(`cut ${cutRefs.length} connection(s) via polyline`);
    handlers.onNetworkChanged?.();
  };

  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "y" || e.repeat || isTyping()) return;
    armed = true;
    e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() !== "y") return;
    armed = false;
    drawing = false;
    clear();
  });

  container.addEventListener(
    "pointerdown",
    (e) => {
      if (!armed || e.button !== 0) return;
      const target = e.target as Element;
      // only start a cut line on the blank graph surface (not nodes/ports/chips/inputs)
      if (nodeFromTarget(editor, area, target)) return;
      if (target.closest?.(".cyl-ns") || target.closest?.(".cyl-rp-port") || target.closest?.("button") || target instanceof HTMLInputElement) return;
      drawing = true;
      pts = [{ x: e.clientX, y: e.clientY }];
      setPoints(pts);
      e.preventDefault();
      e.stopImmediatePropagation(); // keep rect-select / area drag from hijacking the cut
    },
    true,
  );

  container.addEventListener(
    "pointermove",
    (e) => {
      if (!drawing) return;
      const last = pts[pts.length - 1];
      if (pts.length < 500 && Math.hypot(e.clientX - last.x, e.clientY - last.y) > 4) {
        pts.push({ x: e.clientX, y: e.clientY });
        setPoints(pts);
      }
      e.preventDefault();
    },
    true,
  );

  const up = (e: PointerEvent) => {
    if (!armed || !drawing) return;
    drawing = false;
    const arr = pts;
    clear();
    if (arr.length === 0) return;
    if (pathLen(arr) < 4) {
      // click without dragging: cut the single connection under the cursor
      const connId = hitTestConnection(area, e.clientX, e.clientY);
      if (connId) cutConnection(connId);
    } else {
      cutByPolyline(arr);
    }
  };
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

// ---------------------------------------------------------------------------
// right-click flag menu (DOM overlay)
// ---------------------------------------------------------------------------

export function attachFlagMenu(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  onChanged?: (node: CylNode) => void,
): void {
  const menu = document.createElement("div");
  menu.className = "cyl-node-menu hidden";
  container.appendChild(menu);
  let currentId = "";
  const close = () => menu.classList.add("hidden");

  const show = (x: number, y: number, node: CylNode) => {
    currentId = node.id;
    menu.innerHTML = "";
    const labels: [keyof NodeFlags, string][] = [
      ["display", "Display"],
      ["bypass", "Bypass"],
      ["freeze", "Freeze"],
      ["reference", "Wireframe"],
    ];
    for (const [key, label] of labels) {
      const row = document.createElement("div");
      row.className = "cyl-node-menu-row";
      row.innerHTML = `<input type="checkbox" ${node.flags[key] ? "checked" : ""}/><span>${label}</span>`;
      // pointerdown (not click): the container closes the menu on any pointerdown
      // (bubble phase), which would otherwise swallow the row click.
      row.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        node.flags = { ...node.flags, [key]: !node.flags[key] };
        log(`node ${node.kind} ${key}=${node.flags[key]}`);
        onChanged?.(node);
        notifyNodeChanged();
        show(x, y, node);
      });
      menu.appendChild(row);
    }
    const del = document.createElement("div");
    del.className = "cyl-node-menu-row danger";
    del.innerHTML = `<span>Delete</span>`;
    del.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (node.kind === "null") void editor.removeNode(node.id);
      close();
    });
    menu.appendChild(del);
    menu.classList.remove("hidden");
    const rect = container.getBoundingClientRect();
    menu.style.left = `${Math.min(x - rect.left, rect.width - 170)}px`;
    menu.style.top = `${Math.min(y - rect.top, rect.height - 190)}px`;
  };

  container.addEventListener("contextmenu", (ev) => {
    const hit = nodeFromTarget(editor, area, ev.target as Element);
    if (hit) {
      ev.preventDefault();
      show(ev.clientX, ev.clientY, hit.node);
    } else {
      close();
    }
  });
  container.addEventListener("pointerdown", () => close());
}

/** Node state chips handler: toggles reference/bypass/freeze per node; display is unique via setDisplayHandler. */
let nodeStateHandler: ((nodeId: string, key: "display" | "reference" | "bypass" | "freeze") => void) | null = null;
export function setNodeStateHandler(
  fn: ((nodeId: string, key: "display" | "reference" | "bypass" | "freeze") => void) | null,
): void {
  nodeStateHandler = fn;
}

export function fireNodeState(nodeId: string, key: "display" | "reference" | "bypass" | "freeze"): void {
  nodeStateHandler?.(nodeId, key);
}

/** Rename handler: returns the final (deduped) label for a node rename; registered by createReteGraph. */
let renameHandler: ((nodeId: string, desired: string) => string) | null = null;
export function setRenameHandler(fn: ((nodeId: string, desired: string) => string) | null): void {
  renameHandler = fn;
}

export function fireRename(nodeId: string, desired: string): string {
  return renameHandler ? renameHandler(nodeId, desired) : desired;
}

// ---------------------------------------------------------------------------
// 双击进入子网络（v0.1.00119，task #4）
//
// **为什么是 pointerdown 计时而不是 ondblclick**：rete 的节点 pointerdown 链
// （Drag -> nodepicked -> simpleNodesOrder）会把节点元素在 DOM 里**重新排序**，
// 浏览器据此认为"按下的那个元素没了"，于是 click/dblclick 在节点子元素上根本不触发。
// NodeView.tsx 的重命名（约 278 行）早就踩过同一个坑并用手写计时解决——这里照抄那条
// 结论，两处互不干扰：本检测器**排除** .cyl-rp-title，所以标题上的双击仍然只改名。
//
// 与"双击缩放"的关系：rete Zoom 自带的 dblclick 缩放已在 graph.ts 用 area.addPipe
// 拦掉（只挡 source === "dblclick"）。那个 guard 是本手势可用的前提，别删。
// ---------------------------------------------------------------------------

/** 两次 pointerdown 判定为双击的时间窗（ms）。取 350ms：略紧于重命名的 400ms，
 *  于是"标题双击改名"与"节点体双击进入"即便手速接近也不会互相抢。 */
const ENTER_DBLCLICK_MS = 350;
/** 双击允许的位移（px）：超过即认为是两次独立点击（可能夹着一次拖动）。 */
const ENTER_DBLCLICK_PX = 8;

/** 进入节点的处理器（graph.ts 注册；返回是否真的进入了）。 */
let enterNodeHandler: ((nodeId: string) => boolean) | null = null;
export function setEnterNodeHandler(fn: ((nodeId: string) => boolean) | null): void {
  enterNodeHandler = fn;
}

/**
 * 双击可进入节点 -> 进入其子网络。容器级 capture 监听，理由同其它手势：
 * rete 的节点 drag 会 stopPropagation，冒泡阶段收不到。
 *
 * 刻意**不**进入的落点（各有其因，删任何一条都会毁掉一个既有手势）：
 *   - `.cyl-rp-title` / `.cyl-rp-rename` / input：那是重命名的双击（NodeView 自己的检测器）
 *   - `.cyl-rp-port`：端口是 ConnectionPlugin 的地盘，双击端口不该跳层
 *   - `.cyl-ns`：状态 chip（display/bypass/…），channel 的进入成员走的就是 display chip
 *   - button：flag 菜单等 DOM 控件
 */
export function attachEnterNode(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): void {
  let last: { id: string; t: number; x: number; y: number } | null = null;
  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const target = e.target as Element;
      if (
        target.closest?.(".cyl-rp-title") ||
        target.closest?.(".cyl-rp-rename") ||
        target.closest?.(".cyl-rp-port") ||
        target.closest?.(".cyl-ns") ||
        target.closest?.("button") ||
        target instanceof HTMLInputElement
      ) {
        last = null; // 落在排除区：本次不参与计时，也把上一次清掉（避免跨元素凑成双击）
        return;
      }
      const hit = nodeFromTarget(editor, area, target);
      if (!hit) {
        last = null;
        return;
      }
      const now = performance.now();
      const prev = last;
      if (
        prev &&
        prev.id === hit.id &&
        now - prev.t < ENTER_DBLCLICK_MS &&
        Math.abs(e.clientX - prev.x) < ENTER_DBLCLICK_PX &&
        Math.abs(e.clientY - prev.y) < ENTER_DBLCLICK_PX
      ) {
        last = null;
        // 只有可进入的 kind 才拦事件：不可进入的节点双击必须保持原样（选中/拖动照旧），
        // 否则"双击一个 transform"会莫名其妙地吃掉一次 pointerdown。
        if (!isEnterableKind(hit.node.kind)) return;
        e.preventDefault();
        e.stopPropagation();
        enterNodeHandler?.(hit.id);
        return;
      }
      last = { id: hit.id, t: now, x: e.clientX, y: e.clientY };
    },
    true,
  );
}

/** Custom floating tooltip (dark rounded chip) replacing the native title tooltip. */
let tooltipEl: HTMLDivElement | null = null;
export function initTooltip(container: HTMLElement): void {
  if (tooltipEl) return;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "cyl-tooltip hidden";
  container.appendChild(tooltipEl);
}

export function showTooltip(x: number, y: number, text: string): void {
  if (!tooltipEl) return;
  tooltipEl.textContent = text;
  tooltipEl.classList.remove("hidden");
  const parent = tooltipEl.parentElement;
  const rect = parent?.getBoundingClientRect();
  if (rect) {
    const w = tooltipEl.offsetWidth;
    const h = tooltipEl.offsetHeight;
    tooltipEl.style.left = `${Math.min(x - rect.left + 12, rect.width - w - 8)}px`;
    tooltipEl.style.top = `${Math.min(y - rect.top + 16, rect.height - h - 8)}px`;
  }
}

export function hideTooltip(): void {
  tooltipEl?.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Houdini-style navigation: MMB drag pans the canvas (wheel zoom is built-in)
// ---------------------------------------------------------------------------

export function attachMMBPan(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): void {
  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 1) return; // middle mouse
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY };
      const t0 = { ...area.area.transform };
      const onMove = (ev: PointerEvent) => {
        void area.area.translate(t0.x + (ev.clientX - start.x), t0.y + (ev.clientY - start.y));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    true,
  );
}

// ---------------------------------------------------------------------------
// Dot-grid background with zoom LOD (Houdini-ish position reference).
// Screen-space fixed dots; fade out as you zoom out, brighten when zoomed in.
// ---------------------------------------------------------------------------

export function attachDotGrid(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): void {
  const grid = document.createElement("div");
  grid.className = "cyl-dotgrid";
  container.appendChild(grid);

  const update = () => {
    const k = area.area.transform.k;
    const t = area.area.transform;
    // LOD: bright when zoomed in, dim and finally hidden when zoomed far out
    let opacity = 0;
    if (k >= 0.9) opacity = 0.85;
    else if (k >= 0.55) opacity = 0.5;
    else if (k >= 0.3) opacity = 0.22;
    grid.style.opacity = String(opacity);
    // dots scroll with pan (screen-space grid follows the content a little)
    const size = 22;
    grid.style.backgroundPosition = `${-(t.x % size)}px ${-(t.y % size)}px`;
  };

  area.addPipe((ctx) => {
    if (ctx.type === "zoomed" || ctx.type === "translated") update();
    return ctx;
  });
  requestAnimationFrame(update);
}

// ---------------------------------------------------------------------------
// Insertion: drag a standalone null node over a connection -> highlight preview,
// release -> splice it into the edge (A->B becomes A->null->B).
// ---------------------------------------------------------------------------

function hitTestConnection(
  area: AreaPlugin<Schemes, AreaExtra>,
  x: number,
  y: number,
): string | null {
  // getScreenCTM maps SVG path-local points to screen coordinates, so the area's
  // translate/scale transform is fully accounted for (verified against DOMPoint).
  const threshold = 14;
  for (const [id, view] of area.connectionViews) {
    const svg = (view.element.querySelector("path") ?? view.element) as SVGPathElement | null;
    if (!svg || typeof svg.getTotalLength !== "function") continue;
    const ctm = svg.getScreenCTM();
    if (!ctm) continue;
    const rect = svg.getBoundingClientRect();
    if (x < rect.left - 40 || x > rect.right + 40 || y < rect.top - 40 || y > rect.bottom + 40) continue;
    const len = svg.getTotalLength();
    const step = Math.max(4, len / 40);
    for (let t = 0; t <= len; t += step) {
      const p = svg.getPointAtLength(t);
      const sp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
      const dx = sp.x - x;
      const dy = sp.y - y;
      if (dx * dx + dy * dy < threshold * threshold) return id;
    }
  }
  return null;
}

/** Bézier path matching the real connections (curvature 0.3), used by the insertion preview. */
function connectionPathD(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y1 - y2);
  const off = Math.max(dy / 2, dx) * 0.3;
  return `M ${x1} ${y1} C ${x1 + off} ${y1}, ${x2 - off} ${y2}, ${x2} ${y2}`;
}

/** Nodes that can be drag-inserted into a connection: exactly one input + one output. */
function isInsertable(n: CylNode): boolean {
  return !!n.inputs && !!n.outputs && Object.keys(n.inputs).length === 1 && Object.keys(n.outputs).length === 1;
}

export function attachInsertion(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  handlers: ReteGraphHandlers,
  undoManager: UndoManager,
): void {
  let draggingNodeId: string | null = null;
  let draggingNode: CylNode | null = null;
  let hoverConn: string | null = null;

  // Insertion preview overlay: two dashed flowing curves (source -> mouse -> target).
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.setAttribute("class", "cyl-insert-preview");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:0;";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  container.appendChild(overlay);
  const previewA = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const previewB = document.createElementNS("http://www.w3.org/2000/svg", "path");
  for (const path of [previewA, previewB]) {
    path.setAttribute("class", "cyl-insert-preview-path");
    overlay.appendChild(path);
  }

  /** Container-local center of a node port socket circle (RefSocket span) -> preview endpoint. */
  const portCenterLocal = (nodeId: string, portId: string, rect: DOMRect): { x: number; y: number } | null => {
    const el = area.nodeViews.get(nodeId)?.element.querySelector(`[data-port-id="${portId}"]`);
    if (!el) return null;
    // [data-port-id] is the whole port row (socket circle + label, ~39px wide);
    // its center is NOT the circle center. Use the RefSocket span (input at the
    // left end, output at the right end) - it hugs the circle.
    const sock = el.querySelector(":scope > span.input, :scope > span.output");
    const target = (sock ?? el) as Element;
    const r = target.getBoundingClientRect();
    return { x: r.left + r.width / 2 - rect.left, y: r.top + r.height / 2 - rect.top };
  };

  /**
   * Two flowing dashed curves following the dragged node while hovering a
   * connection: previewA = connection source socket -> dragged node IN port,
   * previewB = dragged node OUT port -> connection target socket. Re-drawn on
   * every pointermove so the endpoints track the moving node's ports.
   */
  // The container pointermove listener runs in the capture phase, BEFORE rete's
  // node drag handler applies the move, so DOM port positions lag one event
  // behind. Defer the redraw to the next frame so the curves follow the node.
  let previewRaf = 0;
  const refreshPreview = (mouseX: number, mouseY: number) => {
    if (previewRaf) cancelAnimationFrame(previewRaf);
    previewRaf = requestAnimationFrame(() => {
      previewRaf = 0;
      updatePreview(mouseX, mouseY);
    });
  };

  const updatePreview = (mouseX: number, mouseY: number) => {
    previewA.setAttribute("d", "");
    previewB.setAttribute("d", "");
    if (!hoverConn || !draggingNodeId) return;
    const view = area.connectionViews.get(hoverConn);
    if (!view) return;
    const svg = view.element.querySelector("path") as SVGPathElement | null;
    if (!svg || typeof svg.getTotalLength !== "function") return;
    const ctm = svg.getScreenCTM();
    const rect = container.getBoundingClientRect();
    if (!ctm) return;
    const len = svg.getTotalLength();
    const p0 = svg.getPointAtLength(0);
    const p1 = svg.getPointAtLength(len);
    const start = new DOMPoint(p0.x, p0.y).matrixTransform(ctm);
    const end = new DOMPoint(p1.x, p1.y).matrixTransform(ctm);
    const inC = portCenterLocal(draggingNodeId, "in0", rect);
    const outC = portCenterLocal(draggingNodeId, "out0", rect);
    if (!inC || !outC) return;
    previewA.setAttribute("d", connectionPathD(start.x - rect.left, start.y - rect.top, inC.x, inC.y));
    previewB.setAttribute("d", connectionPathD(outC.x, outC.y, end.x - rect.left, end.y - rect.top));
  };

  const setHover = (connId: string | null, mouseX = 0, mouseY = 0) => {
    if (hoverConn) {
      area.connectionViews.get(hoverConn)?.element.querySelector("path")?.classList.remove("drop-target");
      hoverConn = null;
    }
    if (connId) {
      const view = area.connectionViews.get(connId);
      if (view) {
        view.element.querySelector("path")?.classList.add("drop-target");
        hoverConn = connId;
      }
    }
    refreshPreview(mouseX, mouseY);
  };
  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      if (isReconnectBusy()) return; // reconnect grab owns the pointer
      const target = e.target as Element;
      // Only dragging the node BODY (title/head/stats) starts insertion
      // tracking - ports/sockets, chips, buttons and the rename input must not.
      if (
        target.closest?.(".cyl-rp-port") ||
        target.closest?.(".cyl-ns") ||
        target.closest?.("button") ||
        target.closest?.(".cyl-rp-rename") ||
        target instanceof HTMLInputElement
      ) return;
      const hit = nodeFromTarget(editor, area, target);
      // any single-in/single-out node (null / transform) can be drag-inserted
      if (hit && isInsertable(hit.node)) {
        draggingNodeId = hit.id;
        draggingNode = hit.node;
      }
    },
    true,
  );

  container.addEventListener(
    "pointermove",
    (e) => {
      lastGraphMouse = { x: e.clientX, y: e.clientY };
      if (!draggingNodeId) return;
      const connId = hitTestConnection(area, e.clientX, e.clientY);
      if (connId !== hoverConn) setHover(connId, e.clientX, e.clientY);
      else refreshPreview(e.clientX, e.clientY); // keep endpoints on the moving node
    },
    true,
  );

  const up = () => {
    if (!draggingNodeId) return;
    draggingNodeId = null;
    const node = draggingNode;
    draggingNode = null;
    const connId = hoverConn;
    setHover(null);
    if (!connId || !node) return;
    const conn = editor.getConnection(connId) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
    if (!conn) return;
    const srcNode = editor.getNode(conn.source as string) as CylNode | undefined;
    const tgtNode = editor.getNode(conn.target as string) as CylNode | undefined;
    if (!srcNode || !tgtNode) return;
    if (srcNode.id === node.id || tgtNode.id === node.id) {
      log(`insert skipped: dragged node ${node.label} is an endpoint of the hovered connection`);
      return;
    }
    void (async () => {
      // one-input constraint: drop any existing connection into this node's in0 first
      const existing = editor.getConnections().find(
        (c) => c.target === node.id && c.targetInput === "in0",
      ) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
      if (existing) await editor.removeConnection(existing.id);
      await editor.removeConnection(connId);
      await editor.addConnection(
        new ClassicPreset.Connection(srcNode, conn.sourceOutput as string, node, "in0") as unknown as Schemes["Connection"],
      );
      await editor.addConnection(
        new ClassicPreset.Connection(node, "out0", tgtNode, conn.targetInput as string) as unknown as Schemes["Connection"],
      );
      store.pushLog(`[node] inserted ${node.label} into ${srcNode.label} -> ${tgtNode.label}`);
      // keep the inserted node clear of its source: minX = src edge + node width + 30
      const pos = area.nodeViews.get(node.id)?.position;
      if (pos) {
        const srcPos = area.nodeViews.get(srcNode.id)?.position;
        if (srcPos) {
          const width = (area.nodeViews.get(node.id)?.element.getBoundingClientRect().width ?? 150) / area.area.transform.k;
          const minX = srcPos.x + width + 30;
          if (pos.x < minX) {
            void area.translate(node.id, { x: minX, y: pos.y });
            pos.x = minX;
          }
        }
        // spread the layout: shift every node to the right of the inserted node
        const offset = 180;
        for (const n of editor.getNodes()) {
          if (n.id === node.id) continue;
          const nPos = area.nodeViews.get(n.id)?.position;
          if (nPos && nPos.x > pos.x + 30) void area.translate(n.id, { x: nPos.x + offset, y: nPos.y });
        }
      }
      undoManager.push({
        type: "insert",
        nodeId: node.id,
        nodeLabel: node.label,
        connection: { source: conn.source, sourceOutput: conn.sourceOutput, target: conn.target, targetInput: conn.targetInput },
        prevConnection: existing
          ? { source: existing.source, sourceOutput: existing.sourceOutput, target: existing.target, targetInput: existing.targetInput }
          : null,
      });
      handlers.onNetworkChanged?.();
    })();
  };
  window.addEventListener("pointerup", up);

  // Window-level Escape (graph.ts) cancels an in-progress drag-insert gesture.
  registerInteractionCanceller(() => {
    if (!draggingNodeId) return;
    draggingNodeId = null;
    draggingNode = null;
    setHover(null);
  });
}

// ---------------------------------------------------------------------------
// LMB drag on blank canvas = rectangle multi-select (rete nodes)
// ---------------------------------------------------------------------------

export function attachRectSelect(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  selectable: { select: (id: string, acc: boolean) => Promise<void>; unselect: (id: string) => Promise<void> } | undefined,
): void {
  const overlay = document.createElement("div");
  overlay.className = "cyl-rect-select hidden";
  /** 「算不算拖出了一个框」的像素阈值。与 reconnect 的抓线阈值同量级，手感一致。 */
  const RECT_SELECT_MIN_PX = 4;
  container.appendChild(overlay);
  let sel: { x0: number; y0: number } | null = null;

  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0 || e.altKey || e.metaKey || e.ctrlKey) return;
      const target = e.target as Element;
      if (target.closest(".cyl-ns") || target.closest(".cyl-rp-port") || target.closest("button") || target instanceof HTMLInputElement) return;
      if (target.closest('[data-testid="connection"]')) return; // connection click/reconnect, not rect select
      if (isReconnectBusy()) return; // reconnect grab owns the pointer
      if (nodeFromTarget(editor, area, target)) return; // node drag, not rect select
      sel = { x0: e.clientX, y0: e.clientY };
      // **不在这里 remove("hidden")**（v0.1.00122 修）：overlay 上还留着上一次拖拽的
      // left/top/width/height，此刻显示出来就是「闪一下上次的选区」——用户单击或
      // 按住不动都会看到。改为等 pointermove 真的算出新几何之后再显示：
      // 先把尺寸归零，再由 move 分支决定显不显示。
      overlay.style.width = "0px";
      overlay.style.height = "0px";
    },
    true,
  );
  container.addEventListener(
    "pointermove",
    (e) => {
      if (!sel) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const x0 = sel.x0 - rect.left;
      const y0 = sel.y0 - rect.top;
      const w = Math.abs(x - x0);
      const h = Math.abs(y - y0);
      overlay.style.left = `${Math.min(x0, x)}px`;
      overlay.style.top = `${Math.min(y0, y)}px`;
      overlay.style.width = `${w}px`;
      overlay.style.height = `${h}px`;
      // 只有真的拖出一个框才显示（阈值同 reconnect 的 6px 手感）：单击时 w/h 都是 0，
      // 显示一个零尺寸框只会让用户看到上次残留的边框。
      if (w > RECT_SELECT_MIN_PX || h > RECT_SELECT_MIN_PX) overlay.classList.remove("hidden");
    },
    true,
  );
  const up = (e: PointerEvent) => {
    if (!sel || !selectable) return;
    // 单击（没拖出框）**不动选择**：否则「点一下空白」会把已有选择全清掉，而那与
    // 「框选了 0 个节点」在代码里长得一样。阈值与显示阈值同一个，行为才一致。
    const moved =
      Math.abs(e.clientX - sel.x0) > RECT_SELECT_MIN_PX || Math.abs(e.clientY - sel.y0) > RECT_SELECT_MIN_PX;
    if (!moved) {
      sel = null;
      overlay.classList.add("hidden");
      return;
    }
    const t = area.area.transform;
    const rect = container.getBoundingClientRect();
    const lx = (Math.min(sel.x0, e.clientX) - rect.left - t.x) / t.k;
    const ly = (Math.min(sel.y0, e.clientY) - rect.top - t.y) / t.k;
    const rx = (Math.max(sel.x0, e.clientX) - rect.left - t.x) / t.k;
    const ry = (Math.max(sel.y0, e.clientY) - rect.top - t.y) / t.k;
    sel = null;
    overlay.classList.add("hidden");
    for (const [id, view] of area.nodeViews) {
      const p = view.position;
      if (p && p.x >= lx && p.x <= rx && p.y >= ly && p.y <= ry) {
        void selectable.select(id, true);
      } else {
        void selectable.unselect(id);
      }
    }
    store.pushLog(`[node] rect-select complete`);
    window.setTimeout(notifySelection, 0); // select()/unselect() are async
  };
  window.addEventListener("pointerup", up);
}

// ---------------------------------------------------------------------------
// Shake a node to pop it out of the chain: all its connections are cut and each
// A -> node -> B path heals into a direct A -> B (keeping the original
// sourceOutput/targetInput) when the socket types match and B's target slot is
// free. The shaken node stays disconnected. Multi-port nodes without a
// through-path just get cut.
// Threshold: drag back-and-forth (>=3 direction reversals within ~1000ms with
// >4px per segment; a slower real-mouse shake keeps enough points in the buffer).
// Undo = one {type:"shake"} entry (cut + added).
// ---------------------------------------------------------------------------

export function attachShakeDisconnect(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  handlers: ReteGraphHandlers,
  undoManager: UndoManager,
): void {
  let trackingId: string | null = null;
  let shakeFired = false;
  let buf: { x: number; y: number; t: number }[] = [];

  const reset = () => {
    trackingId = null;
    shakeFired = false;
    buf = [];
  };

  const shakeNode = async (id: string) => {
    const node = editor.getNode(id) as CylNode | undefined;
    if (!node) return;

    // 1. Record + cut every connection touching this node.
    const touching = editor.getConnections().filter((c) => c.source === id || c.target === id);
    const cutRefs: ConnectionRef[] = touching.map((c) => ({
      source: c.source,
      sourceOutput: c.sourceOutput,
      target: c.target,
      targetInput: c.targetInput,
    }));
    for (const c of touching) {
      const src = (editor.getNode(c.source) as CylNode | undefined)?.label ?? c.source;
      const tgt = (editor.getNode(c.target) as CylNode | undefined)?.label ?? c.target;
      await editor.removeConnection(c.id);
      log(`shake cut ${c.id} (${src} -> ${tgt})`);
    }

    // 2. Heal each A -> node -> B path into a direct A -> B (keep the original
    //    sourceOutput/targetInput, e.g. input.in1 -> null1 -> output.out1 becomes
    //    input.in1 -> output.out1). Only when A's output socket type matches B's
    //    input socket type and B's target slot is free; multi-port nodes without
    //    a through-path just get cut.
    const ins = touching.filter((c) => c.target === id);
    const outs = touching.filter((c) => c.source === id);
    const addedRefs: ConnectionRef[] = [];
    const healed: Set<string> = new Set(); // B target slot already reconnected
    for (const inc of ins) {
      const a = editor.getNode(inc.source) as CylNode | undefined;
      if (!a) continue;
      const aOut = a.outputs?.[inc.sourceOutput];
      if (!aOut) continue;
      for (const outc of outs) {
        const b = editor.getNode(outc.target) as CylNode | undefined;
        if (!b) continue;
        if (a.id === b.id) continue; // never heal into a self-loop
        const bIn = b.inputs?.[outc.targetInput];
        if (!bIn || bIn.socket.name !== aOut.socket.name) continue;
        const slot = `${outc.target}:${outc.targetInput}`;
        if (healed.has(slot)) continue;
        const inFree = !editor.getConnections().some((c) => c.target === outc.target && c.targetInput === outc.targetInput);
        if (!inFree) continue;
        await editor.addConnection(
          new ClassicPreset.Connection(a, inc.sourceOutput, b, outc.targetInput) as unknown as Schemes["Connection"],
        );
        addedRefs.push({ source: inc.source, sourceOutput: inc.sourceOutput, target: outc.target, targetInput: outc.targetInput });
        healed.add(slot);
        log(`shake heal: ${a.label}.${inc.sourceOutput} -> ${b.label}.${outc.targetInput}`);
        break;
      }
    }

    if (cutRefs.length > 0 || addedRefs.length > 0) {
      undoManager.push({ type: "shake", cut: cutRefs, added: addedRefs });
      handlers.onNetworkChanged?.();
    }
  };

  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      if (isReconnectBusy()) return; // reconnect grab owns the pointer
      const target = e.target as Element;
      if (target.closest?.(".cyl-rp-port") || target.closest?.(".cyl-ns") || target.closest?.("button") || target instanceof HTMLInputElement) return;
      const hit = nodeFromTarget(editor, area, target);
      if (!hit) return;
      trackingId = hit.id;
      shakeFired = false;
      buf = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    },
    true,
  );

  container.addEventListener(
    "pointermove",
    (e) => {
      const id = trackingId;
      if (!id || shakeFired) return;
      const now = performance.now();
      buf.push({ x: e.clientX, y: e.clientY, t: now });
      if (buf.length > 24) buf.shift();
      // Only the last ~1000ms of movement matters for the reversal pattern.
      const recent = buf.filter((p) => now - p.t <= 1000);
      if (recent.length < 4) return;
      let reversals = 0;
      let prev: { dx: number; dy: number } | null = null;
      for (let i = 1; i < recent.length; i++) {
        const dx = recent[i].x - recent[i - 1].x;
        const dy = recent[i].y - recent[i - 1].y;
        if (Math.hypot(dx, dy) < 4) continue; // ignore micro-movements
        if (prev && prev.dx * dx + prev.dy * dy < 0) reversals += 1;
        prev = { dx, dy };
      }
      if (reversals < 3) return;
      shakeFired = true;
      void shakeNode(id);
    },
    true,
  );

  window.addEventListener("pointerup", reset);
  window.addEventListener("pointercancel", reset);
}
// ---------------------------------------------------------------------------
// Connection selection: a plain click (no drag, no modifiers) on a wire selects
// it with a bright highlight. B-key toggles bypass on the selected wire (see
// graph.toggleSelectedConnectionBypass). Clicking blank/node/port or Esc clears
// the selection. Selection is independent of node selection (never touches
// `node.selected`).
// ---------------------------------------------------------------------------
let selectedConnId: string | null = null;

export function getSelectedConnectionId(): string | null {
  return selectedConnId;
}

function connectionPathEl(area: AreaPlugin<Schemes, AreaExtra>, id: string): Element | null {
  return area.connectionViews.get(id)?.element.querySelector("path") ?? null;
}

function selectConnection(area: AreaPlugin<Schemes, AreaExtra>, id: string): void {
  if (selectedConnId === id) return;
  if (selectedConnId) connectionPathEl(area, selectedConnId)?.classList.remove("cyl-wire-selected");
  selectedConnId = id;
  connectionPathEl(area, id)?.classList.add("cyl-wire-selected");
}

export function clearConnectionSelection(area: AreaPlugin<Schemes, AreaExtra>): void {
  if (!selectedConnId) return;
  connectionPathEl(area, selectedConnId)?.classList.remove("cyl-wire-selected");
  selectedConnId = null;
}

/** Wire-selection plumbing: a pointerdown on anything that is NOT a connection
 *  (node body / port / blank) clears the selection. The actual select happens in
 *  attachReconnect's plain-click up; Esc clears via the interaction canceller. */
export function attachConnectionSelect(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): void {
  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      // Alt 必须继续被忽略：Alt+点线是 waypoint 手势（attachReconnect），它命中的可能是
      // 线体之外的空白（hitTestConnection 有 14px 容差），若在这里清选，等于"建 waypoint
      // 顺手把线的选中态清掉"。metaKey/ctrlKey 同理不参与清选。
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const target = e.target as Element;
      if (target.closest?.('[data-testid="connection"]')) return; // connection click -> handled by reconnect select
      clearConnectionSelection(area);
    },
    true,
  );
  registerInteractionCanceller(() => clearConnectionSelection(area));
}

// ---------------------------------------------------------------------------
// Connection reconnect: grab an existing connection (pointerdown + drag >6px),
// preview a re-route through the mouse with flowing dashed curves, then confirm
// on release-over-a-port (while holding) or on a follow-up click (after release).
// ESC / click-on-blank cancels; Alt+click(+drag) on a connection sets/moves its
// waypoint (纯装饰的路径中点，不改拓扑、不触发 cook)，甩远即删。
// ---------------------------------------------------------------------------

/** Alt 拖动"甩掉" waypoint 的判定半径（屏幕像素，以手势起点那条线的原始几何为基准）。
 *  取 hitTestConnection 的 14px 命中半径 × 8 = 112px：既明显大于"沿着线微调中点"的
 *  日常位移（也远大于 reconnect 的 6px 起拖阈值，两个手势不会互相误判），又只需约半个
 *  节点宽度的甩动就能删除——不必把鼠标丢到画布外。 */
const WAYPOINT_FLING_PX = 14 * 8;

interface PortHit {
  nodeId: string;
  key: string;
  side: "input" | "output";
}

/** Nearest port socket circle center to (mouseX, mouseY) within threshold px
 *  (screen space), or null. Uses the RefSocket span like the insertion preview. */
function hitTestPort(
  area: AreaPlugin<Schemes, AreaExtra>,
  mouseX: number,
  mouseY: number,
  threshold = 20,
): { hit: PortHit; x: number; y: number } | null {
  let best: { hit: PortHit; x: number; y: number } | null = null;
  let bestDist = threshold;
  for (const [nodeId, view] of area.nodeViews) {
    const els = view.element.querySelectorAll<HTMLElement>("[data-port-id]");
    for (const el of els) {
      const key = el.getAttribute("data-port-id") ?? "";
      if (!key) continue;
      const sock = el.querySelector(":scope > span.input, :scope > span.output");
      const target = (sock ?? el) as HTMLElement;
      const r = target.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = Math.hypot(cx - mouseX, cy - mouseY);
      if (dist <= bestDist) {
        bestDist = dist;
        best = {
          hit: {
            nodeId,
            key,
            side: sock ? (sock.classList.contains("output") ? "output" : "input") : "input",
          },
          x: cx,
          y: cy,
        };
      }
    }
  }
  return best;
}

export function attachReconnect(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  handlers: ReteGraphHandlers,
  undoManager: UndoManager,
): void {
  let grabbed = false;
  let holding = false;
  let trackedConnId: string | null = null;
  let grabbedConnId: string | null = null;
  let grabStart = { x: 0, y: 0 };

  // Reconnect preview overlay: two flowing dashed curves (same look as the
  // insert preview; .cyl-reconnect-preview carries the full dash style in CSS so
  // the insertion overlay selector svg.cyl-insert-preview stays unambiguous).
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.setAttribute("class", "cyl-reconnect-preview");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:3;";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  container.appendChild(overlay);
  const previewA = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const previewB = document.createElementNS("http://www.w3.org/2000/svg", "path");
  for (const path of [previewA, previewB]) {
    path.setAttribute("class", "cyl-insert-preview-path");
    overlay.appendChild(path);
  }

  const toLocal = (clientX: number, clientY: number) => {
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  /** Original connection path endpoints in screen space (exact line touch points). */
  const connEndpoints = (connId: string): { start: { x: number; y: number }; end: { x: number; y: number } } | null => {
    const view = area.connectionViews.get(connId);
    const svg = view?.element.querySelector("path") as SVGPathElement | null;
    if (!svg || typeof svg.getTotalLength !== "function") return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const len = svg.getTotalLength();
    const p0 = svg.getPointAtLength(0);
    const p1 = svg.getPointAtLength(len);
    const start = new DOMPoint(p0.x, p0.y).matrixTransform(ctm);
    const end = new DOMPoint(p1.x, p1.y).matrixTransform(ctm);
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
  };

  let hoverPortEl: Element | null = null;
  const setPortHighlight = (port: PortHit | null) => {
    if (hoverPortEl) {
      hoverPortEl.classList.remove("reconnect-hover");
      hoverPortEl = null;
    }
    if (port) {
      const el = area.nodeViews.get(port.nodeId)?.element.querySelector(`[data-port-id="${port.key}"]`);
      if (el) {
        el.classList.add("reconnect-hover");
        hoverPortEl = el;
      }
    }
  };

  const markGrabbedPath = (targeted: boolean) => {
    const view = grabbedConnId ? area.connectionViews.get(grabbedConnId) : undefined;
    const path = view?.element.querySelector("path");
    path?.classList.add("reconnect-grabbed");
    if (targeted) path?.classList.add("reconnect-target");
    else path?.classList.remove("reconnect-target");
  };

  /** Dash preview: near a port -> one segment; else the whole line through the mouse. */
  const updatePreview = (clientX: number, clientY: number) => {
    previewA.setAttribute("d", "");
    previewB.setAttribute("d", "");
    if (!grabbed || !grabbedConnId) return;
    const eps = connEndpoints(grabbedConnId);
    if (!eps) return;
    const rect = container.getBoundingClientRect();
    const mouse = toLocal(clientX, clientY);
    const near = hitTestPort(area, clientX, clientY);
    setPortHighlight(near ? near.hit : null);
    markGrabbedPath(!!near);
    const s = { x: eps.start.x - rect.left, y: eps.start.y - rect.top };
    const e = { x: eps.end.x - rect.left, y: eps.end.y - rect.top };
    if (near) {
      const p = toLocal(near.x, near.y);
      if (near.hit.side === "input") {
        // re-target: original source socket -> hovered input port
        previewA.setAttribute("d", connectionPathD(s.x, s.y, p.x, p.y));
      } else {
        // re-source: hovered output port -> original target socket
        previewA.setAttribute("d", connectionPathD(p.x, p.y, e.x, e.y));
      }
    } else {
      // whole line "passes through" the mouse
      previewA.setAttribute("d", connectionPathD(s.x, s.y, mouse.x, mouse.y));
      previewB.setAttribute("d", connectionPathD(mouse.x, mouse.y, e.x, e.y));
    }
  };

  const clearReconnect = () => {
    if (grabbedConnId) {
      const view = area.connectionViews.get(grabbedConnId);
      view?.element.querySelector("path")?.classList.remove("reconnect-grabbed", "reconnect-target");
    }
    setPortHighlight(null);
    clearWaypointDrag(); // Esc / pointercancel 也要把 Alt 手势的状态一并清掉
    grabbed = false;
    holding = false;
    trackedConnId = null;
    grabbedConnId = null;
    reconnectPointerActive = false;
    reconnectGrabbed = false;
    previewA.setAttribute("d", "");
    previewB.setAttribute("d", "");
  };

  const labelOf = (id: string) => (editor.getNode(id) as CylNode | undefined)?.label ?? id;

  /** Re-route the grabbed connection to the hovered port (with undo + replace). */
  const applyReconnect = async (port: PortHit) => {
    const connId = grabbedConnId;
    if (!connId) {
      clearReconnect();
      return;
    }
    const conn = editor.getConnection(connId) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
    if (!conn) {
      clearReconnect();
      return;
    }
    const before: ConnectionRef = {
      source: conn.source,
      sourceOutput: conn.sourceOutput,
      target: conn.target,
      targetInput: conn.targetInput,
    };
    let after: ConnectionRef;
    if (port.side === "input") {
      if (port.nodeId === conn.source) {
        log(`reconnect blocked: self-connection on ${labelOf(port.nodeId)}`);
        clearReconnect();
        return;
      }
      after = { source: conn.source, sourceOutput: conn.sourceOutput, target: port.nodeId, targetInput: port.key };
    } else {
      if (port.nodeId === conn.target) {
        log(`reconnect blocked: self-connection on ${labelOf(port.nodeId)}`);
        clearReconnect();
        return;
      }
      after = { source: port.nodeId, sourceOutput: port.key, target: conn.target, targetInput: conn.targetInput };
    }
    if (
      after.source === before.source &&
      after.sourceOutput === before.sourceOutput &&
      after.target === before.target &&
      after.targetInput === before.targetInput
    ) {
      log("reconnect no-op: same port");
      clearReconnect();
      return;
    }
    // rete Input is single-connection: replacing an occupied target input drops
    // the old feeder first and records it (undo restores both).
    let prevConnection: ConnectionRef | null = null;
    if (port.side === "input") {
      const existing = editor.getConnections().find(
        (c) => c.target === after.target && c.targetInput === after.targetInput && c.id !== connId,
      ) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
      if (existing) {
        prevConnection = {
          source: existing.source,
          sourceOutput: existing.sourceOutput,
          target: existing.target,
          targetInput: existing.targetInput,
        };
        await editor.removeConnection(existing.id);
        log(
          `reconnect replaced ${labelOf(existing.source)}.${existing.sourceOutput} -> ${labelOf(existing.target)}.${existing.targetInput}`,
        );
      }
    }
    const srcNode = editor.getNode(after.source) as CylNode | undefined;
    const tgtNode = editor.getNode(after.target) as CylNode | undefined;
    if (!srcNode || !tgtNode) {
      clearReconnect();
      return;
    }
    await editor.removeConnection(connId);
    await editor.addConnection(
      new ClassicPreset.Connection(srcNode, after.sourceOutput as string, tgtNode, after.targetInput as string) as unknown as Schemes["Connection"],
    );
    undoManager.push({ type: "reconnect", before, after, prevConnection });
    handlers.onNetworkChanged?.();
    log(
      `reconnect ${labelOf(before.source)}.${before.sourceOutput} -> ${labelOf(before.target)}.${before.targetInput} => ${labelOf(after.source)}.${after.sourceOutput} -> ${labelOf(after.target)}.${after.targetInput}`,
    );
    clearReconnect();
  };

  // -------------------------------------------------------------------------
  // Waypoint gesture (Alt + LMB on a wire). 与 reconnect 共用同一套 pointer 状态机，
  // 但走**平行**的一组变量：Alt 分支在 trackedConnId 赋值之前就 return，所以 reconnect
  // 预览不会出现、线也不会进入 selected 态。
  // -------------------------------------------------------------------------
  let waypointConnId: string | null = null;   // 正在跟随鼠标的连接（甩掉后置 null）
  let waypointActive = false;                 // 本次 pointer 是 Alt 起手的（甩掉后仍为 true）
  let waypointBase: { x: number; y: number }[] = []; // 手势起点时那条线的屏幕采样点
  // 手势期间额外挂在 window 上的 pointermove（挂它的理由见 bindWaypointWindowMove）。
  let waypointWindowMove: ((e: PointerEvent) => void) | null = null;

  const clearWaypointDrag = () => {
    // 摘掉 window 监听：置空即幂等 —— clearReconnect(Esc/pointercancel) 与 pointerup
    // 可能连着调两次，既不会重复 remove，也不会每次手势泄漏一个监听。
    if (waypointWindowMove) {
      window.removeEventListener("pointermove", waypointWindowMove, true);
      waypointWindowMove = null;
    }
    waypointConnId = null;
    waypointActive = false;
    waypointBase = [];
  };

  /** client -> area-local，和节点摆放用的是同一套算术（insert 预览/Tab 面板同款）。 */
  const toGraph = (clientX: number, clientY: number) => {
    const rect = container.getBoundingClientRect();
    const t = area.area.transform;
    return { x: (clientX - rect.left - t.x) / t.k, y: (clientY - rect.top - t.y) / t.k };
  };

  /** 手势起点那条线的屏幕空间采样点：和 hitTestConnection 同样用 getScreenCTM +
   *  getPointAtLength，所以"离线多远"用的就是命中测试那套几何。jsdom 下取不到长度时
   *  返回空数组 —— 距离恒为 0，绝不会误删。 */
  const sampleConnScreen = (connId: string): { x: number; y: number }[] => {
    const view = area.connectionViews.get(connId);
    const svg = (view?.element.querySelector("path") ?? view?.element) as SVGPathElement | null;
    if (!svg || typeof svg.getTotalLength !== "function") return [];
    const ctm = svg.getScreenCTM();
    if (!ctm) return [];
    const len = svg.getTotalLength();
    const step = Math.max(4, len / 40);
    const pts: { x: number; y: number }[] = [];
    for (let t = 0; t <= len; t += step) {
      const p = svg.getPointAtLength(t);
      const sp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
      pts.push({ x: sp.x, y: sp.y });
    }
    return pts;
  };

  /** 鼠标到"手势起点那条线"的最近距离。采样为空（jsdom / 无 CTM）时返回 0 —— 宁可不删。 */
  const distToBase = (clientX: number, clientY: number): number => {
    if (!waypointBase.length) return 0;
    let best = Infinity;
    for (const p of waypointBase) {
      const d = Math.hypot(p.x - clientX, p.y - clientY);
      if (d < best) best = d;
    }
    return best;
  };

  /** 写入/移动 waypoint，然后只重绘这一条连接。**不动拓扑、不发 onNetworkChanged。** */
  const putWaypoint = (connId: string, clientX: number, clientY: number) => {
    const conn = editor.getConnection(connId);
    if (!conn) return;
    setConnectionWaypoint(conn, toGraph(clientX, clientY));
    void area.update("connection", connId);
  };

  /** 甩远 -> 删掉 waypoint。删的是连接上的一个属性，连接本身**始终是同一条**，
   *  不可能像老的 _dot_ 节点那样留下两截半线。 */
  const dropWaypoint = (connId: string) => {
    const conn = editor.getConnection(connId);
    if (!conn) return;
    setConnectionWaypoint(conn, null);
    void area.update("connection", connId);
    log(`waypoint removed from connection ${connId} (flung > ${WAYPOINT_FLING_PX}px)`);
  };

  /** 已经处理过的那个 move 事件对象。window 与 container 两个监听器会为**同一个事件**
   *  各触发一次（capture 阶段 window 先到），按对象身份去重 = 一次 move 只写一次
   *  waypoint、只用一组坐标判一次甩远，绝不会拿旧坐标算距离。 */
  let waypointMoveSeen: Event | null = null;

  /** waypoint 拖动的唯一权威处理：container / window 谁先收到就谁执行，另一个被去重挡掉。 */
  const onWaypointMove = (e: PointerEvent) => {
    if (!waypointActive) return;
    if (waypointMoveSeen === e) return; // 同一事件的第二次投递
    waypointMoveSeen = e;
    // 兜底：万一漏收 pointerup（切窗口/失焦），别让 hover 继续拖 waypoint。
    if ((e.buttons & 1) === 0) { clearWaypointDrag(); return; }
    if (!waypointConnId) return; // 已经甩掉了，本次 pointer 不再重建
    if (distToBase(e.clientX, e.clientY) > WAYPOINT_FLING_PX) {
      dropWaypoint(waypointConnId);
      waypointConnId = null;
      return;
    }
    putWaypoint(waypointConnId, e.clientX, e.clientY);
  };

  /** container 是图面板本身，指针一旦拖出它的 bounding box 就收不到 pointermove 了
   *  （实测 20 步的甩动只有 3 个事件进得来，距离永远到不了 WAYPOINT_FLING_PX，于是
   *  永远删不掉）。所以手势期间额外在 window 上挂一份，拖到窗口任何角落都持续跟手。
   *  只在手势内存活，clearWaypointDrag() 负责摘掉。 */
  const bindWaypointWindowMove = () => {
    if (waypointWindowMove) return;
    waypointWindowMove = (e: PointerEvent) => onWaypointMove(e);
    window.addEventListener("pointermove", waypointWindowMove, true);
  };

  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const target = e.target as Element;
      // Confirm a previously-released grab: near a port = apply, blank = cancel.
      if (grabbed && !holding) {
        e.preventDefault();
        e.stopPropagation();
        const port = hitTestPort(area, e.clientX, e.clientY);
        if (port) void applyReconnect(port.hit);
        else clearReconnect();
        return;
      }
      // Ports/sockets belong to the ConnectionPlugin and node bodies to node drag
      // (both can sit within 14px of a connection line), so a pointerdown on them
      // must never start a reconnect grab or a waypoint drag.
      if (target.closest?.(".cyl-rp-port")) return;
      if (nodeFromTarget(editor, area, target)) return;
      // Alt+click on a connection -> set its waypoint right there (Alt+drag moves it).
      // 必须在下面 trackedConnId 赋值**之前**拦掉：那个顺序就是"不出 reconnect 预览、
      // 线也不进 selected 态"的全部原因。
      if (e.altKey) {
        const connId = hitTestConnection(area, e.clientX, e.clientY);
        if (connId) {
          e.preventDefault();
          e.stopPropagation();
          waypointBase = sampleConnScreen(connId); // 取原始几何，之后 waypoint 会把线拉弯
          waypointConnId = connId;
          waypointActive = true;
          bindWaypointWindowMove(); // 甩出面板之外也要继续收 move，否则删不掉
          putWaypoint(connId, e.clientX, e.clientY);
        }
        return;
      }
      // Start tracking a grab: pointerdown on an existing connection (left button).
      const connId = hitTestConnection(area, e.clientX, e.clientY);
      if (connId) {
        e.preventDefault();
        e.stopPropagation();
        trackedConnId = connId;
        holding = true;
        grabStart = { x: e.clientX, y: e.clientY };
        reconnectPointerActive = true;
      }
    },
    true,
  );

  container.addEventListener(
    "pointermove",
    (e) => {
      lastGraphMouse = { x: e.clientX, y: e.clientY };
      // Alt 手势独占本次 pointer：它从不设 trackedConnId，所以放在最前面短路即可。
      // 逻辑本体在 onWaypointMove，跟 window 那份共用同一份去重，所以指针在面板内、
      // 面板外走的都是同一条代码路径，一次 move 只生效一次。
      if (waypointActive) {
        onWaypointMove(e);
        return;
      }
      if (grabbed && grabbedConnId) {
        updatePreview(e.clientX, e.clientY);
      } else if (trackedConnId && !grabbed) {
        const dx = e.clientX - grabStart.x;
        const dy = e.clientY - grabStart.y;
        if (dx * dx + dy * dy > 36) {
          // crossed the >6px threshold: enter grabbed (button may be released now)
          grabbed = true;
          grabbedConnId = trackedConnId;
          reconnectGrabbed = true;
          markGrabbedPath(false);
          updatePreview(e.clientX, e.clientY);
        }
      }
    },
    true,
  );

  const up = (e: PointerEvent) => {
    // Alt 手势：松手就收工。放在最前面，因为它没有 trackedConnId，会被下面那行 return 掉。
    if (waypointActive) {
      clearWaypointDrag();
      return;
    }
    if (!trackedConnId && !grabbed) return;
    if (grabbed && holding) {
      holding = false;
      const port = hitTestPort(area, e.clientX, e.clientY);
      if (port) {
        void applyReconnect(port.hit);
      }
      // released over blank: stay grabbed, the preview keeps following the mouse
      return;
    }
    // plain click on a connection (never dragged past the threshold): with no
    // modifier keys this SELECTS the wire (B-key bypass target); anything else
    // just releases the grab.
    if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && trackedConnId) {
      selectConnection(area, trackedConnId);
    }
    clearReconnect();
  };
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", () => {
    if (grabbed || trackedConnId || waypointActive) clearReconnect();
  });

  // Window-level Escape (graph.ts) cancels the reconnect grab / waypoint drag.
  registerInteractionCanceller(() => {
    if (grabbed || trackedConnId || reconnectGrabbed || reconnectPointerActive || waypointActive) clearReconnect();
  });
}

// ---------------------------------------------------------------------------
// Shift+Enter：把选中的 `_input_` 一键「镜像」到 `_output_`（对齐 Houdini 的
// shift+enter 手感：找第一个匹配的接法连上，并顺手把插入位置摆好）。
//
// 用户要求：选中 n 个 input（各自已填 serial、选好端口）后 Tab 选到 output 再
// Shift+Enter → output 同步**同一个**序列号、端口一一对应连好、位置摆到右边。
//
// 为什么决策逻辑必须是**纯函数**：vitest 跑 environment:"node" 且没装 jsdom，凡碰
// DOM/rete 视图的都测不了。于是「配哪几对、抄什么参数、摆在哪」全部落在
// planShiftEnterWire（无 DOM、无网络、无缓存），DOM 那半截只剩照计划执行。
// ---------------------------------------------------------------------------

/** 镜像出来的 output 相对「最右侧 input」的水平间距（area 局部坐标）。
 *  取 220：略大于一个节点宽（~150）+ attachInsertion 用的 30 间隙，于是 output 不会
 *  压在 input 身上，又不必等 DOM 量宽度——纯函数拿不到 getBoundingClientRect。 */
export const SHIFT_ENTER_GAP_X = 220;

/** 端口清单里本手势唯一关心的两个字段（`SerialPortOption` 的结构子集）。
 *  刻意**不** import serial-capabilities：那模块带缓存与 fetch，进不了纯单测；清单由
 *  调用方注入——与 graph-model 的 derivePortType 注入 resolver 同一条路子。 */
export interface ShiftEnterPortOption {
  key: string;
  type: string;
}

/** 参与镜像的一个 `_input_`（参数已由调用方读出，故纯函数不碰 CylNode/rete）。 */
export interface ShiftEnterInput {
  id: string;
  label: string;
  /** 是否为**单端口 + 地址**形态（有 `address` 参数）。与 ShiftEnterOutput 的同名字段
   *  同一条理由，但这里只影响**说法**而非行为：旧 4 端口 `_input_` 的 params 为
   *  undefined，读出来的 address/port 都是空串，所以它本来也会被跳过 —— 只是原因会写成
   *  「没填地址」，那是**误导**：那个节点根本没有地址栏可填，用户照着提示去找会找不到。 */
  hasAddressParams: boolean;
  /** serial（address 参数）；空 = 还没填地址。 */
  address: string;
  /** 已选端口 key（port 参数）；空 = 还没选端口。 */
  port: string;
  /** 该 input 输出侧 socket 的当前类型（连线校验的左端）。 */
  socketType: string;
  x: number;
  y: number;
}
/** 待接收镜像的一个 `_output_`。 */
export interface ShiftEnterOutput {
  id: string;
  label: string;
  /** 是否为**单端口 + 地址**形态（有 `address` 参数）。旧 4 端口 `_output_`（schema<4
   *  的老图恢复出来的）`params` 恒为 undefined —— 它有真的 out0 端口，线接得上，但没有
   *  地方写 serial/port。不挡住就会连出一根"线接好了、序列号没写进去"的半成品，而且
   *  一声不响。故把它当作**配不上**处理（见 planShiftEnterWire 的 skip）。 */
  hasAddressParams: boolean;
  /** 该 output 输入侧 socket 的**当前**类型：桥没答出目标端口类型时，连线校验用它
   *  当右端（诚实：不知道类型就按"这个槽现在是什么"判，绝不假设会变成想要的那个）。 */
  socketType: string;
}

/** 一对配好的镜像：output 要写的参数 + 要连的端口 + 要摆的位置。 */
export interface ShiftEnterPair {
  inputId: string;
  inputLabel: string;
  outputId: string;
  outputLabel: string;
  /** 连线：input.`sourceOutput` -> output.`targetInput`。 */
  sourceOutput: string;
  targetInput: string;
  /** 抄给 output 的 serial（与 input 逐字相同——用户要求「填入相同的序列号」）。 */
  address: string;
  /** 写给 output 的 port 参数（= targetInput 的 key）。 */
  port: string;
  /** 写给 output 的 type 参数；`null` = 桥还没答出类型 → **不动它**
   *  （回落默认会让连线校验拿错类型放行错配的线，见 derivePortType 的同款论证）。 */
  type: string | null;
  x: number;
  y: number;
}

/** 被跳过的一个 input 及其**原因**（原因要能原样打进日志：绝不静默跳过）。 */
export interface ShiftEnterSkip {
  inputLabel: string;
  reason: string;
}

/** 一个**根本不能当接收方**的 output 及其原因。
 *
 *  为什么与 ShiftEnterSkip 分开、而不是塞进同一个数组：那个数组的每一项都是「某个
 *  **input** 没配上」，而这里说的是「某个 **output** 没资格」——把 output 的标签塞进
 *  `inputLabel` 字段等于让字段名说谎，日志读起来也会指错节点。 */
export interface ShiftEnterOutputSkip {
  outputLabel: string;
  reason: string;
}

export interface ShiftEnterPlan {
  pairs: ShiftEnterPair[];
  skipped: ShiftEnterSkip[];
  /** 被排除在候选之外的 output（如旧 4 端口形态）。 */
  ineligibleOutputs: ShiftEnterOutputSkip[];
}
/**
 * 「input 的这个端口，在 output 侧对应哪一个」——配对规则的**单源**。
 *
 * 按**下标**对应，不按名字：同一个 serial 的两侧清单是 in0..in3 / out0..out3，名字
 * 天生不同，按名字找必然找不到。下标对应正是 Houdini 的语义（第 i 个输入 ↔ 第 i 个
 * 输出）；而吊牌（tag）serial 两侧是**同一份**清单（参数天生双向），同一下标取回的
 * 就是同一个逻辑名，于是这一条规则把 HDA 与 tag 两种情形一起覆盖了。
 *
 * 清单为 `null`（桥还没答 / 离线）时回落到**命名约定** `in<N>` -> `out<N>`；不匹配这个
 * 形状的（tag 的逻辑名如 `transform1/tx`）原样返回。回落只在"还不知道"时用，且它复刻
 * 的就是 HDA 那条冻结约定，不算猜。
 *
 * 返回 `type: null` = 该端口类型未知 → 调用方**保持 output 现有类型不变**。
 */
export function resolveShiftEnterTarget(
  portKey: string,
  inputPorts: ShiftEnterPortOption[] | null,
  outputPorts: ShiftEnterPortOption[] | null,
): { key: string; type: string | null } | null {
  if (inputPorts && outputPorts) {
    const idx = inputPorts.findIndex((o) => o.key === portKey);
    // 清单已知却找不到这个端口 → 该端口不属于这个 serial（用户改过地址、或 registry
    // 变了）：**不回落**猜一个，直接判为无法配对，交给调用方跳过并报原因。
    if (idx < 0) return null;
    const hit = outputPorts[idx];
    if (!hit) return null; // 输出侧比输入侧短（如 1-in/0-out 的 serial）
    return { key: hit.key, type: hit.type === "" ? null : hit.type };
  }
  const m = /^in(\d+)$/.exec(portKey);
  const key = m ? `out${m[1]}` : portKey;
  // 清单未知 → 类型也未知（绝不因为"名字像 in0"就断定它是 geo）
  return { key, type: null };
}
/**
 * Shift+Enter 的**全部决策**（纯函数：配哪几对、抄什么参数、摆在哪、跳过谁为什么）。
 *
 * 配对规则 —— 用户原话是「shift enter 默认会**找第一个匹配的连接**尝试连线」：
 * input 按**视觉顺序**（y 再 x）逐个处理，每个都在剩余候选池里**顺序扫描、取第一个
 * 类型合得上的** output，用掉即移除。于是
 *   - 同类型的常见情形：第一个就匹配 → 退化成"上面的接上面的"下标对应；
 *   - 混类型：跨过合不上的那个继续找，接上的线严格更多，且顺序扫描 + 用掉即移除
 *     天然不会接出交叉线。
 * input 多于 output 时多出来的**跳过**（绝不新建用户没要的节点）；一个 input 在池里
 * 一个都合不上时**只跳过它**并列出试过的每个候选及其类型，候选池不变（留给后面的
 * input），于是一次错配不会把后面的全顶歪。
 *
 * 位置：所有 output 摆到「最右侧 input + SHIFT_ENTER_GAP_X」这条竖线上，y 与各自配对的
 * input 对齐（Houdini 的 shift+enter 也顺手整理插入位置）。
 *
 * @param canConnect 连线校验谓词，注入而非 import：单源仍是 graph-model 的
 *   canConnectSockets，注入只是为了让本函数保持纯（也便于单测直接喂矩阵）。
 * @param portsOf 取某 serial 某一侧的端口清单；`null` = 还不知道（走命名约定回落）。
 */
export function planShiftEnterWire(
  inputs: ShiftEnterInput[],
  outputs: ShiftEnterOutput[],
  portsOf: (serial: string, side: "inputs" | "outputs") => ShiftEnterPortOption[] | null,
  canConnect: (from: string, to: string) => boolean,
): ShiftEnterPlan {
  const pairs: ShiftEnterPair[] = [];
  const skipped: ShiftEnterSkip[] = [];
  // 资格筛选先做、且**只看 output 自身**：旧 4 端口形态对**任何** input 都写不进去，
  // 那是这个 output 的属性，不是某一对的失败。放在配对循环里当"跳过"会让它占着
  // cursor 的位置、把后面每个合格 output 一起挡住 —— 一个旧节点就能让整个手势变成
  // 静默无事发生（这条注释就是为了钉住那个已修掉的行为）。
  const ineligibleOutputs: ShiftEnterOutputSkip[] = [];
  const usable: ShiftEnterOutput[] = [];
  for (const o of outputs) {
    if (o.hasAddressParams) usable.push(o);
    else ineligibleOutputs.push({ outputLabel: o.label, reason: "legacy 4-port _output_ (no address/port params)" });
  }
  // 视觉顺序：y 优先、x 次之。排序放在函数内部而不是信赖调用方的顺序——
  // editor.getNodes() 的顺序是**建节点的顺序**，与用户在图上看到的上下关系无关。
  const ins = [...inputs].sort((a, b) => a.y - b.y || a.x - b.x);
  if (ins.length === 0 || usable.length === 0) return { pairs, skipped, ineligibleOutputs };
  const baseX = Math.max(...ins.map((i) => i.x)) + SHIFT_ENTER_GAP_X;
  // 尚未被占用的候选池。**用池 + 扫描、而不是一个游标**，因为用户要的是 Houdini 的
  // 「找**第一个匹配**的连接尝试连线」：某个 output 类型不合就往后找下一个，而不是
  // 让这个 input 直接落空。同类型的常见情形下两种写法结果完全一样（第一个就匹配），
  // 差别只在混类型时——扫描能接上的线严格更多，且永远不会接出交叉线（顺序扫描 +
  // 用掉即移除，天然保持"上面的接上面的"）。
  const remaining = [...usable];
  for (const inp of ins) {
    if (remaining.length === 0) {
      skipped.push({ inputLabel: inp.label, reason: "no free _output_ left to mirror into" });
      continue;
    }
    // 先判形态、再判"没填"：旧 4 端口 input 的 address 读出来也是空串，若不先分流，
    // 原因会写成「没填地址」——而那个节点根本没有地址栏，用户照提示去找会找不到。
    if (!inp.hasAddressParams) {
      skipped.push({ inputLabel: inp.label, reason: "legacy 4-port _input_ (no address/port params to mirror from)" });
      continue;
    }
    if (inp.address === "") {
      skipped.push({ inputLabel: inp.label, reason: "no serial (address) filled in" });
      continue;
    }
    if (inp.port === "") {
      skipped.push({ inputLabel: inp.label, reason: "no port selected" });
      continue;
    }
    const target = resolveShiftEnterTarget(
      inp.port,
      portsOf(inp.address, "inputs"),
      portsOf(inp.address, "outputs"),
    );
    if (!target) {
      skipped.push({ inputLabel: inp.label, reason: `port ${inp.port} has no counterpart on ${inp.address}` });
      continue;
    }
    // 「找第一个匹配的」：按顺序扫候选池，取第一个类型合得上的。
    // 目标类型未知 → 按该 output **当前** socket 类型校验（不假设它会变成想要的那个）。
    const at = remaining.findIndex((o) => canConnect(inp.socketType, target.type ?? o.socketType));
    if (at < 0) {
      // 一个都合不上：报**试过谁、各自为什么**，而不是只报第一个——否则用户看到
      // "拒了 geo -> float" 却不知道后面还有两个也试过了，会以为是漏扫。
      const tried = remaining
        .map((o) => `${o.label}(${target.type ?? o.socketType})`)
        .join(", ");
      skipped.push({
        inputLabel: inp.label,
        reason: `socket types refuse the wire (${inp.socketType} -> none of: ${tried})`,
      });
      continue; // 候选池不变：这些 output 留给后面的 input
    }
    const out = remaining[at];
    pairs.push({
      inputId: inp.id,
      inputLabel: inp.label,
      outputId: out.id,
      outputLabel: out.label,
      // rete 的 socket key 恒为 in0/out0（单端口形态，v0.1.00121 起）：`port` 参数是
      // **serial 上的逻辑端口**（in2 / transform1/tx），不是图内 socket 名。两者混用是
      // 很容易犯的错——连接会指向一个不存在的 key，线要么不建要么建歪。
      sourceOutput: "in0",
      targetInput: "out0",
      address: inp.address,
      port: target.key,
      type: target.type,
      x: baseX,
      y: inp.y,
    });
    remaining.splice(at, 1); // 用掉即移除：一个 output 只接一根线
  }
  return { pairs, skipped, ineligibleOutputs };
}
/**
 * 参数落盘处理器。graph.ts 的 `setNodeParams` 才是写参数的**正门**（它还顺手登记
 * address 引用点、按 capabilities 推导类型），但那个函数不导出、graph.ts 也不在本写集
 * 里，所以照本文件既有的 setter 惯例（setRenameHandler / setNodeStateHandler）留一个注册
 * 点：graph.ts 一行 `setApplyNodeParamsHandler((id, p) => graph.setNodeParams(id, p))`
 * 即可接上。未注册时走 fallback（直接改 params + 同步 socket 类型），功能完整，唯一缺的
 * 是「改名重写引用」的登记——见文末 report 说明。
 */
let applyNodeParamsHandler: ((nodeId: string, params: ParamSpec[]) => boolean) | null = null;
export function setApplyNodeParamsHandler(fn: ((nodeId: string, params: ParamSpec[]) => boolean) | null): void {
  applyNodeParamsHandler = fn;
}

/**
 * Shift+Enter 自动接线的撤销登记（v0.1.00132）。
 *
 * 为什么用模块级 setter 而不是把 `undoManager` 一路穿过三层签名
 * （attachTabSearch → startShiftEnterWire → runShiftEnterWire）：本文件已经为
 * `setApplyNodeParamsHandler` / `setRenameHandler` / `setNodeStateHandler` 立了同一个
 * 模式，穿参会让三个签名都被这一个功能污染。
 *
 * **不传也能用**：没登记时手势照常接线，只是没有撤销条目 —— 保底不因为调用方漏接就丢功能。
 */
let shiftEnterUndo: ((added: ConnectionRef[]) => void) | null = null;
export function setShiftEnterUndoHandler(fn: ((added: ConnectionRef[]) => void) | null): void {
  shiftEnterUndo = fn;
}

/** 把 address/port/type 写进一个 `_output_`（type 为 null 时**不动**该参数）。 */
function applyMirroredParams(node: CylNode, pair: ShiftEnterPair): void {
  const next: ParamSpec[] = (node.params ?? []).map((p) => {
    if (p.name === "address") return { ...p, value: pair.address };
    if (p.name === PORT_PARAM) return { ...p, value: pair.port };
    if (p.name === TYPE_PARAM && pair.type !== null) return { ...p, value: pair.type };
    return p;
  });
  if (applyNodeParamsHandler?.(node.id, next)) return;
  node.params = next;
  syncPortSocketType(node); // type 参数是 socket 类型的单源：写完必须同步端口
}
/** 当前被选中的节点（rete 的选择态就挂在节点自身的 `selected` 上——graph.ts 的
 *  getSelectedNode / frameSelection / Delete 都是这么读的，多选没有别的 API）。 */
function selectedNodesOfKind(editor: NodeEditor<Schemes>, kind: NodeKind): CylNode[] {
  return (editor.getNodes() as CylNode[]).filter(
    (n) => n.kind === kind && (n as unknown as { selected?: boolean }).selected === true,
  );
}

function readParamValue(n: CylNode, name: string): string {
  const v = n.params?.find((p) => p.name === name)?.value;
  return typeof v === "string" ? v : "";
}

/** 把一个真实 `_input_` 节点读成纯函数的入参形状。 */
function toShiftEnterInput(n: CylNode, area: AreaPlugin<Schemes, AreaExtra>): ShiftEnterInput {
  const pos = area.nodeViews.get(n.id)?.position;
  return {
    id: n.id,
    label: n.label,
    // 判据与 output 侧逐字相同（有 `address` 参数才是单端口+地址形态）
    hasAddressParams: (n.params ?? []).some((p) => p.name === "address"),
    address: normalizeSerial(readParamValue(n, "address")),
    port: readParamValue(n, PORT_PARAM),
    socketType: nodeSocketType(n),
    x: pos?.x ?? 0,
    y: pos?.y ?? 0,
  };
}
/**
 * 执行一次 Shift+Enter 镜像：读选中的 input → 预热 capabilities → 规划 → 落地。
 *
 * **预热是串行的**（不是 Promise.all）：`loadCapabilities` 的防抖是 latest-wins ——
 * 并发喂多个 serial 会让前面那些被"作废并用空能力收尾"，于是清单成了 null、类型全部
 * 未知。逐个 await 反而每个都真取到（同 serial 有缓存与 single-flight，多个 input 共用
 * 一个地址是常态，实际只发一次请求）。
 *
 * 已存在的连线**绝不拆**：目标端口已被占用时跳过并报原因（用户明确要求不顶掉既有线）。
 *
 * `layout` 为什么必须由调用方给、而不是恒为 true（真踩到的坑，见 rete 源码）：
 * `area.translate` 会发 `nodetranslated`，而 selectableNodes 的管道在**该节点正是
 * "picked" 的那一个**时会调 `selector.translate(dx,dy)` —— 那会把**其余每个选中节点**
 * 按同样位移一起拖走（rete-area-plugin.esm.js 的 selector.translate 与 isPicked）。
 * 于是：
 *   - 面板路径：节点刚 addNode 出来，从未被 pick 过 → 摆位置安全，且它本来就该被摆
 *     （用户没指定过它的位置）。layout = true。
 *   - window 路径：用户 Ctrl+点选的最后一个通常就是那个 output（= picked），一摆就把
 *     他选中的那些 input 全部甩飞。而且那些 output 的位置是**用户自己摆的**，我们没有
 *     理由动它。layout = false。
 */
async function runShiftEnterWire(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  outputs: CylNode[],
  layout: boolean,
): Promise<void> {
  const selectedInputs = selectedNodesOfKind(editor, "input");
  if (selectedInputs.length === 0) {
    log("shift+enter: no _input_ selected - nothing to mirror");
    return;
  }
  if (outputs.length === 0) {
    log("shift+enter: no _output_ to mirror into - not creating one");
    return;
  }
  const specs = selectedInputs.map((n) => toShiftEnterInput(n, area));
  for (const serial of new Set(specs.map((s) => s.address).filter((s) => s !== ""))) {
    await loadCapabilities(serial);
  }
  const plan = planShiftEnterWire(
    specs,
    outputs.map((o) => ({
      id: o.id,
      label: o.label,
      socketType: nodeSocketType(o),
      // 有 `address` 参数才是单端口+地址形态；旧 4 端口图恢复出来的 params 恒为 undefined
      hasAddressParams: (o.params ?? []).some((p) => p.name === "address"),
    })),
    (serial, side) => cachedPorts(serial, side),
    canConnectSockets,
  );
  for (const o of plan.ineligibleOutputs) log(`shift+enter cannot mirror into ${o.outputLabel}: ${o.reason}`);
  for (const s of plan.skipped) log(`shift+enter skipped ${s.inputLabel}: ${s.reason}`);
  // 真正接上的根数（≠ plan.pairs.length）：目标口被占、或编辑器管道否掉，都会少一根。
  // 汇总日志报**事实**而不是意图 —— 报计划数会让"接了 0 根"看起来像"接了 3 根"。
  let wired = 0;
  /** 真正接上的线，供撤销登记（v0.1.00132）。只记 `addConnection` 返回 true 的那些 ——
   *  把被拒的线也记进去，Ctrl+Z 就会去删一根不存在的线。 */
  const addedRefs: ConnectionRef[] = [];
  for (const pair of plan.pairs) {
    const src = editor.getNode(pair.inputId) as CylNode | undefined;
    const dst = editor.getNode(pair.outputId) as CylNode | undefined;
    if (!src || !dst) continue;
    // 占用检查必须在**写参数之前**：接不上就一个字节都不改。
    // 反过来（先写参数、再发现接不上）会留下一个"声称写到 serial X 的 out2、而实际
    // 喂给它的几何来自另一个不相干节点"的 output —— 参数与拓扑互相打脸，而日志只说
    // 了"保留原有连线"，没说"顺手把你的参数改了"。那比什么都不做更糟。
    const occupied = editor
      .getConnections()
      .some((c) => c.target === dst.id && c.targetInput === pair.targetInput);
    if (occupied) {
      log(`shift+enter kept existing wire into ${pair.outputLabel}.${pair.targetInput} (params left untouched)`);
      continue;
    }
    applyMirroredParams(dst, pair);
    if (layout) await area.translate(dst.id, { x: pair.x, y: pair.y });
    // **必须看返回值**：`editor.addConnection` 在管道否掉这根线时返回 false（rete 的
    // addConnection 只在"id 重复"时才 throw，那在这里不可能——每根线都是新实例）。
    // graph.ts 的连接管道有自己的校验（类型 / 自连），它拒了而这里照样打 "wired"，
    // 就成了"日志说接上了、图上没有线"——与前几个已修的坑同一类谎报。
    const added = await editor.addConnection(
      new ClassicPreset.Connection(src, pair.sourceOutput, dst, pair.targetInput) as unknown as Schemes["Connection"],
    );
    if (!added) {
      log(`shift+enter wire refused by the editor: ${pair.inputLabel} -> ${pair.outputLabel}`);
      continue;
    }
    wired += 1;
    addedRefs.push({
      source: src.id,
      sourceOutput: pair.sourceOutput,
      target: dst.id,
      targetInput: pair.targetInput,
    });
    log(`shift+enter wired ${pair.inputLabel} -> ${pair.outputLabel} (${pair.address} ${pair.port})`);
  }
  // 撤销登记（v0.1.00132）：只在**真的接上了线**时推。接了 0 根还推一条空条目，
  // 会让用户按一次 Ctrl+Z 什么都没发生 —— 那比没有撤销更让人困惑。
  if (addedRefs.length > 0) shiftEnterUndo?.(addedRefs);
  notifyNodeChanged(); // 参数/端口类型变了：让 NodeView 重画
  // 参数面板订阅的是**选择变化**（main.ts 经 onSelectionChanged 重渲染），不是节点重画。
  // 少了这一行，被镜像的那个 output 若正好是当前选中项，面板会继续显示改之前的空
  // address/port —— 图上线已经接好、面板却像什么都没发生，正是最容易被当成 bug 的表现。
  // 变异测试实测（v0.1.00149）：注释掉这一行，面板**仍然**刷新 —— 因为 v0.1.00131 起
  // `applyMirroredParams` 走 `setApplyNodeParamsHandler` → `api.setNodeParams`，那条路自己
  // 就通知了 store。所以这行在当前接线下**不是**承重的。
  // 保留它是廉价保险：一旦那个 handler 被摘掉（它本就是"可选的前门"），面板会退回读旧值。
  notifySelection();
  store.pushLog(`[node] shift+enter mirrored ${wired} input(s) to _output_`);
}

/**
 * 启动一次镜像，并在边界上**吞掉异常**（两个调用点都是 floating promise 的收尾）。
 *
 * 面板路径在 async 的 `create()` 里、window 路径是 `void` 调用 —— 都不等它。一旦内部
 * reject，那就是一条**没人接**的 promise：浏览器打一行 unhandled rejection，而用户只看到
 * 「按了 Shift+Enter 什么都没发生」，图里连条日志都没有。与本轮修掉的那几个"谎报 /
 * 静默"是同一类病，所以同样按"绝不静默"处理。
 *
 * 为什么不指望它永不 reject：`loadCapabilities` 承诺恒不抛、`addConnection` 只在 id 重复
 * 时 throw（此处每根线都是新实例，不可能），但 `applyMirroredParams` 会走
 * `setApplyNodeParamsHandler` 注册进来的 `graph.setNodeParams` —— 那是**别处**的代码，
 * 而且正是我们建议接上的那一条路。它抛不抛不由这里决定，故在边界兜住并留下日志。
 */
function startShiftEnterWire(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  outputs: CylNode[],
  layout: boolean,
): Promise<void> {
  return runShiftEnterWire(editor, area, outputs, layout).catch((err: unknown) => {
    log(`shift+enter failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}
/**
 * Shift+Enter 的 window 级监听：**面板关着**、选中里既有 input 又有 output 时生效
 * （用户已经手动选好了要写进去的那个 output）。面板开着的那条路径在 attachTabSearch
 * 的 keydown 里（那时焦点在面板输入框上，见那处注释）。
 *
 * **与 Enter 视口枢轴的冲突怎么避开**（core/shortcuts.ts 的 Enter → toggleEnter）：
 *  1. 那个处理器只在 `isEnterHovered()` 为真（鼠标在视口上）时才动手，而本手势要求
 *     选中里有 input+output，是图里的操作；
 *  2. 更硬的一道：本改动给 shortcuts.ts 的 Enter 分支加了 `e.shiftKey` 早退，于是
 *     **Shift+Enter 永远不再是 Enter**，两者在按键层面就互斥，不靠"谁先注册"或
 *     stopPropagation 这类顺序运气。
 */
function attachShiftEnterWire(editor: NodeEditor<Schemes>, area: AreaPlugin<Schemes, AreaExtra>): void {
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.shiftKey || e.repeat) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
    const outputs = selectedNodesOfKind(editor, "output");
    // 选中里没有 output → 本手势不适用：**不建**用户没要的节点，直接放行按键
    // （面板那条路径才负责"Tab 选到 output 再 Shift+Enter"的新建语义）。
    if (outputs.length === 0) return;
    if (selectedNodesOfKind(editor, "input").length === 0) return;
    e.preventDefault();
    // layout=false：这些 output 的位置是**用户自己摆的**，而且其中一个通常正是 rete 的
    // "picked" 节点 —— 摆它会把其余选中节点一起拖走（见 runShiftEnterWire 的 layout）。
    void startShiftEnterWire(editor, area, outputs, false);
  });
}

