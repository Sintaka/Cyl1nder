/**
 * Graph domain model (2.2 split): node/connection/selection data structures,
 * node factories, read-only queries, graph (de)serialization and network snapshot.
 * Pure data + area transform; the shell (graph.ts) owns mutations that notify the
 * React NodeView layer (e.g. setNodeParams -> notifyNodeChanged).
 */
import { ClassicPreset, NodeEditor } from "rete";
import { AreaPlugin } from "rete-area-plugin";
import { DataflowEngine, type DataflowEngineScheme } from "rete-engine";
import type { ClassicScheme, ReactArea2D } from "rete-react-plugin";
import { store } from "../stores/workspace";
import type { ChannelRef } from "../protocol/types";
import type { NetworkSnapshot } from "./network";
import type { UndoAction } from "./undo";

export type Schemes = ClassicScheme;
export type AreaExtra = ReactArea2D<Schemes>;

// P2b 项目模式：project（项目根，无端口）+ channel（成员通道，1 in/1 out，compute 忽略——
// v1 关联线纯视觉）。两者只在项目图（schemaVersion 3）中出现；?serial= 单 serial 场景保持旧 kinds。
export type NodeKind = "input" | "output" | "null" | "transform" | "dot" | "project" | "channel";

export interface NodeFlags {
  display: boolean;
  bypass: boolean;
  freeze: boolean;
  reference: boolean;
}

export const DEFAULT_FLAGS: NodeFlags = { display: false, bypass: false, freeze: false, reference: false };

export interface ParamSpec {
  name: string;
  type: string;
  value: unknown;
  default?: unknown;
}

export interface SelectedNodeInfo {
  kind: NodeKind;
  id: string;
  label: string;
  port: number | null;
  params: ParamSpec[];
}

/** P2b 项目模式输入：项目根 serial（P1-…）+ label + 成员通道引用快照。
 *  （graph.ts 的 loadProjectGraph 使用；planProjectGraph 是其纯规划核心。） */
export interface ProjectGraphInput {
  projectSerial: string;
  label: string;
  members: ChannelRef[];
}

export interface ReteGraphHandlers {
  onNodePick?: (kind: NodeKind, port: number | null, nodeId: string) => void;
  onFlagsChanged?: (kind: NodeKind, flags: NodeFlags) => void;
  onSelectionChanged?: () => void;
  onNetworkChanged?: () => void;
  onParamsApplied?: (nodeId: string, params: Array<{ name: string; type: string; value: unknown }>) => void;
}

export interface ReteGraph {
  editor: NodeEditor<Schemes>;
  area: AreaPlugin<Schemes, AreaExtra>;
  engine: DataflowEngine<DataflowEngineScheme>;
  destroy(): void;
  setStats(kind: NodeKind, stats: string): void;
  getFlags(kind: NodeKind): NodeFlags | undefined;
  setFlag(kind: NodeKind, key: keyof NodeFlags, value: boolean): NodeFlags | undefined;
  getDisplayNode(): { kind: NodeKind; flags: NodeFlags } | null;
  getDisplayPortIndex(): number | null;
  getSelectedNode(): SelectedNodeInfo | null;
  onSelectionChanged(cb: () => void): () => void;
  frameSelection(): void;
  serializeGraph(): unknown;
  restoreGraph(data: unknown): Promise<void>;
  /** Bumped on every connection/node add/remove; lets the network runner detect
   *  whether store.outputs were cooked for the CURRENT graph topology. */
  getGraphVersion(): number;
  getNetworkSnapshot(): NetworkSnapshot;
  setNodeParams(nodeId: string, params: ParamSpec[]): boolean;
  /** 节点错误系统：**全量**覆盖每节点错误（表里没有的节点被清空）。仅当真的有
   *  变化时才触发一次 NodeView 重渲染，返回是否发生了变化。 */
  setNodeErrors(errors: NodeErrorMap): boolean;
  /** 读某节点错误的只读拷贝（节点不存在 / 无错误 → []）。 */
  getNodeErrors(nodeId: string): NodeError[];
  /** P2b 项目模式：以项目根 + 成员 channel 节点重建图（saved = 项目图快照 v3）。 */
  loadProjectGraph(input: ProjectGraphInput, saved: unknown): void;
  /** 项目图快照（serializeGraph 的 v3 输出；项目模式下供保存）。 */
  projectGraphSnapshot(): unknown;
  /** channel 节点点 display chip 时回调 fn(serial)（写集 C：激活成员）；null 解除注册。 */
  setChannelDisplayHandler(fn: ((serial: string) => void) | null): void;
  /** 当前图是否为项目根（存在 project 节点）。 */
  isProjectMode(): boolean;
  /** Toggle the bypass visual flag on the currently-selected connection; returns
   *  false when no (live) connection is selected. Pure visual + persisted. */
  toggleSelectedConnectionBypass(): boolean;
  setConnectionBypass(id: string, on: boolean): void;
  /** Start the flowing-dash runtime animation on the display node's upstream chain
   *  for min(ms, 2000) ms (no-op when ms < 120). */
  markRuntimeActivity(ms: number): void;
  undo(): void;
  redo(): void;
  pushUndo(action: UndoAction): void;
  pushUndoGroup(actions: UndoAction[]): void;
}

// ---------------------------------------------------------------------------
// 端口数据类型（socket type）：几何 + 标量/向量共存于同一张图，因此连线必须按类型
// 校验（graph.ts 的 ConnectionPlugin 预设）并按类型着色（nodeview.css）。
// 与 protocol/types.ts 的 MappingType（"geo" | "float" | "vec3"）同名同值——
// 映射系统按逻辑名传标量/向量值，这里只负责图内端口的类型标注。
// ---------------------------------------------------------------------------
export const GEO = "geo";
export const FLOAT = "float";
export const VEC3 = "vec3";

/** 合法端口类型集合（未知类型一律视为非法，连线被拒）。 */
export const SOCKET_TYPES: readonly string[] = [GEO, FLOAT, VEC3];

/**
 * 连线类型校验的**纯谓词**（socket-type.test.ts 直接测它，不驱动 rete 插件）：
 * 仅当「源输出端口类型 === 目标输入端口类型」且该类型合法时允许连线。
 * 空串 / 未知类型（历史脏数据、拼错的 type 参数）→ 拒绝，绝不放行。
 */
export function canConnectSockets(from: string, to: string): boolean {
  return SOCKET_TYPES.includes(from) && from === to;
}

/** 把 type 参数值归一到合法端口类型（非法 / 缺省 → geo，保持旧图行为）。 */
export function toSocketType(v: unknown): string {
  return typeof v === "string" && SOCKET_TYPES.includes(v) ? v : GEO;
}

/**
 * 端口 dot 的类型着色类名（Houdini VOP 惯例：看颜色即知类型）。
 *
 * 与连线着色 applyConnectionTypeVisual 同一套配色约定（cyl-wire-float /
 * cyl-wire-vec3），但作用在**端口**上：`geo` 与任何非法/未知类型都返回 ""
 * ——即**不加类**，沿用既有灰白端口样式，因此旧 4 端口图外观零变化。
 * NodeView（另一写集）把它拼到 `cyl-rp-port` 的 className 上，CSS 里定义
 * `.cyl-port-float` / `.cyl-port-vec3` 的颜色。放在这里是因为「类型 → 类名」
 * 是数据层规则，可无 DOM 单测。
 */
export function socketTypeClass(socketType: unknown): string {
  if (socketType === FLOAT) return "cyl-port-float";
  if (socketType === VEC3) return "cyl-port-vec3";
  return "";
}

// ---------------------------------------------------------------------------
// 节点错误系统（node error system）
//
// 「谁产生错误」与「谁显示错误」解耦：产生方（network.ts 的结构性错误 /
// computeOutputs 的 errors / 桥侧 mapping 解析失败）各有自己的载荷形状，统一经
// toNodeErrors 归一成 NodeError 后交给 setNodeErrors 落到节点上；NodeView 只读
// node.errors 渲染角标，不认识任何产生方。
//
// 错误是**运行期瞬时态**：不进 serializeGraph、不进 getNetworkSnapshot、不进
// undo——重建图/重算后由下一次 setNodeErrors 全量覆盖（旧图字节级兼容不受影响）。
// ---------------------------------------------------------------------------

/** 错误等级：error（红，计算已不可信）/ warning（黄，可继续但需注意）。 */
export type NodeErrorSeverity = "error" | "warning";

/**
 * 一条节点错误。挂在 CylNode.errors 上，由 NodeView 渲染成标题角标 + 端口高亮。
 * - `severity` 决定配色与角标取值（worstSeverity 取最坏）。
 * - `message` 人类可读的一整句（含节点名/端口名，直接可展示在 tooltip 里）。
 * - `port` 非空时表示错误归属某个具体端口（如 in0 / out2）；NodeView 据此高亮
 *   那一个端口 dot，为空则只在标题上出角标。
 * - `source` 产生方标签（"multi-source" / "compute" / "mapping" / "bridge"…），
 *   仅用于去重与排错日志，不参与展示。
 */
export interface NodeError {
  severity: NodeErrorSeverity;
  message: string;
  port?: string;
  source?: string;
}

/** 每节点错误表（nodeId -> 该节点的错误列表）；setNodeErrors 的入参形状。 */
export type NodeErrorMap = Record<string, NodeError[]>;

/** 归一 severity：仅接受 "warning"，其余（含缺省/非法/大小写不符）→ "error"。
 *  取「未知即 error」而非「未知即 warning」：宁可把问题显眼化，不可静默降级。 */
export function toNodeErrorSeverity(v: unknown): NodeErrorSeverity {
  return v === "warning" ? "warning" : "error";
}

/**
 * 把**任意**产生方载荷归一成 NodeError 列表（防御式，风格同 sanitizeBindings：
 * 非法输入一律忽略，绝不抛）。接受的形状：
 *   1. 字符串                     → { severity:"error", message }
 *   2. { message | error | text } → 取第一个非空字符串字段作 message
 *   3. 上述两者的数组             → 逐项转换，非法项跳过
 *   4. 其它（null/数字/对象无消息字段）→ 跳过
 * severity 经 toNodeErrorSeverity 归一；port / source 仅接受非空字符串，
 * 否则不带该键（保持 NodeError 载荷最小）。
 */
export function toNodeErrors(v: unknown): NodeError[] {
  const items = Array.isArray(v) ? v : [v];
  const out: NodeError[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      if (item !== "") out.push({ severity: "error", message: item });
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const message = [o.message, o.error, o.text].find((x): x is string => typeof x === "string" && x !== "");
    if (message === undefined) continue;
    const e: NodeError = { severity: toNodeErrorSeverity(o.severity), message };
    if (typeof o.port === "string" && o.port !== "") e.port = o.port;
    if (typeof o.source === "string" && o.source !== "") e.source = o.source;
    out.push(e);
  }
  return out;
}

/**
 * network.ts 的 MultiSourceError[] → NodeErrorMap（结构性错误的标准转换）。
 * 一个输入端口被多源喂 = error 等级，且**归属该输入端口**（port = targetInput），
 * 于是 NodeView 能精确高亮出错的那个端口。按结构类型接收（不 import network.ts
 * 的具体类型）以免数据层反向依赖计算层。
 */
export function multiSourceErrorsToNodeErrors(
  errors: ReadonlyArray<{ nodeId: string; targetInput?: string; message: string }>,
): NodeErrorMap {
  const map: NodeErrorMap = {};
  for (const e of errors) {
    if (!e?.nodeId || typeof e.message !== "string" || e.message === "") continue;
    const entry: NodeError = { severity: "error", message: e.message, source: "multi-source" };
    if (typeof e.targetInput === "string" && e.targetInput !== "") entry.port = e.targetInput;
    (map[e.nodeId] ??= []).push(entry);
  }
  return map;
}

/** 合并多个来源的错误表（后者追加到前者之后，同 nodeId 不覆盖而是拼接）。
 *  产生方各自独立上报（结构性 + compute + mapping），合并后一次性 setNodeErrors。 */
export function mergeNodeErrorMaps(...maps: Array<NodeErrorMap | null | undefined>): NodeErrorMap {
  const out: NodeErrorMap = {};
  for (const m of maps) {
    if (!m) continue;
    for (const [id, list] of Object.entries(m)) {
      if (!Array.isArray(list) || list.length === 0) continue;
      (out[id] ??= []).push(...list);
    }
  }
  return out;
}

/** 一组错误里最坏的等级（有任一 error → "error"；全 warning → "warning"；空 → null）。
 *  NodeView 的标题角标取值用它（一个节点只出一个角标，取最坏）。 */
export function worstSeverity(errors: readonly NodeError[] | undefined): NodeErrorSeverity | null {
  if (!errors || errors.length === 0) return null;
  return errors.some((e) => e.severity === "error") ? "error" : "warning";
}

/** 错误列表的稳定指纹（severity|port|message 顺序敏感）：churn 判定用。
 *  message 也进指纹——同端口同等级但文案变了（如多源从 2 个变 3 个）仍要刷新。 */
function errorsSignature(errors: readonly NodeError[]): string {
  return errors.map((e) => `${e.severity}\u0000${e.port ?? ""}\u0000${e.message}`).join("\u0001");
}

/** 两组错误是否等价（用于跳过无变化的重渲染）。 */
export function sameNodeErrors(
  a: readonly NodeError[] | undefined,
  b: readonly NodeError[] | undefined,
): boolean {
  const la = a ?? [];
  const lb = b ?? [];
  if (la.length !== lb.length) return false;
  return errorsSignature(la) === errorsSignature(lb);
}

/**
 * 把错误表**全量**落到编辑器里的节点上，返回是否真的有变化（churn 门闩）。
 *
 * 全量语义：表里没有的节点会被**清空**错误（errors 键删除，而非留空数组）——
 * 于是「上一轮报错、这一轮修好了」无需产生方显式清除。逐节点用 sameNodeErrors
 * 比对指纹：一个都没变 → 返回 false，调用方据此**不触发** notifyNodeChanged
 * （NodeView 全量重渲染的唯一入口），这就是避免 churn 的地方——每秒 cook 若错误
 * 不变则零重渲染。表里指向不存在节点的条目被忽略（图已重建/节点已删）。
 */
export function applyNodeErrors(editor: NodeEditor<Schemes>, errors: NodeErrorMap): boolean {
  let changed = false;
  for (const n of editor.getNodes() as CylNode[]) {
    const next = errors[n.id] ?? [];
    if (sameNodeErrors(n.errors, next)) continue;
    if (next.length === 0) delete n.errors;
    else n.errors = next.map((e) => ({ ...e }));
    changed = true;
  }
  return changed;
}

/** 读某节点错误的只读拷贝（节点不存在 / 无错误 → []）。 */
export function nodeErrorsOf(editor: NodeEditor<Schemes>, id: string): NodeError[] {
  const n = editor.getNode(id) as CylNode | undefined;
  return (n?.errors ?? []).map((e) => ({ ...e }));
}

export const log = (m: string): void => {
  store.pushLog(`[node] ${m}`);
};

export const BASE_LABEL: Record<string, string> = { _input_: "_input_", _output_: "_output_", null: "null" };

/** Selection-change listeners (panels that follow the selected node). */
const selectionListeners = new Set<() => void>();
export function notifySelection(): void {
  for (const fn of selectionListeners) fn();
}

export function onSelectionChange(cb: () => void): () => void {
  selectionListeners.add(cb);
  return () => selectionListeners.delete(cb);
}

export function nodeByKind(editor: NodeEditor<Schemes>, kind: NodeKind): CylNode | undefined {
  return editor.getNodes().find((x) => (x as CylNode).kind === kind) as CylNode | undefined;
}

/**
 * Resolve the _input_ source port (in0..in3) feeding a null/transform node's in0,
 * following passthrough chains (null/transform out0 -> next in0). _input_ source
 * -> its in\d port; null/transform source -> recurse into its in0 (visited-set
 * guards cycles); output/unknown/no connection -> null. Shared by display focus
 * and selection panels so null and transform resolve identically.
 */
export function resolveInputSourcePort(
  editor: NodeEditor<Schemes>,
  nodeId: string,
  visited: Set<string> = new Set(),
): number | null {
  if (visited.has(nodeId)) return null;
  visited.add(nodeId);
  const conn = editor.getConnections().find(
    (c) => c.target === nodeId && c.targetInput === "in0",
  ) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
  if (!conn) return null;
  const src = editor.getNode(conn.source) as CylNode | undefined;
  const out = String(conn.sourceOutput ?? "");
  if (src?.kind === "input") {
    const m = /^in(\d)$/.exec(out);
    return m ? Number(m[1]) : null;
  }
  if ((src?.kind === "null" || src?.kind === "transform" || src?.kind === "dot") && out === "out0") {
    return resolveInputSourcePort(editor, src.id, visited);
  }
  return null;
}

/** Resolve a DOM target to a rete node via area.nodeViews (element containment). */
export function nodeFromTarget(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  target: Element | null,
): { id: string; node: CylNode } | null {
  if (!target) return null;
  for (const [id, view] of area.nodeViews) {
    if (view.element.contains(target)) {
      const n = editor.getNode(id) as CylNode | undefined;
      if (n) return { id, node: n };
    }
  }
  return null;
}

/** Re-render one node: emit render WITH its element (ElementsHolder needs it as WeakMap key). */
export function renderNode(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  nodeId: string,
): void {
  const view = area.nodeViews.get(nodeId);
  const node = editor.getNode(nodeId);
  if (view && node) {
    (editor as unknown as { emit(s: unknown): void }).emit({
      type: "render",
      data: { type: "node", payload: node, element: view.element },
    });
  }
}

export function portIndexFromTarget(target: Element | null): number | null {
  const el = target?.closest?.("[data-port-id]");
  if (!el) return null;
  const raw = el.getAttribute("data-port-id") ?? "";
  const idx = parseInt(raw.replace(/[a-z]/g, ""), 10);
  return Number.isNaN(idx) ? null : idx;
}

export class CylNode extends ClassicPreset.Node {
  flags: NodeFlags = { ...DEFAULT_FLAGS };
  stats = "";
  kind: NodeKind = "null";
  baseLabel = "";
  params?: ParamSpec[];
  /** P2b：仅 kind==="channel" 使用——成员通道引用（tag/hda 的 serial 即节点 id）。
   *  project/channel 都不参与几何计算，关联线 v1 纯视觉。 */
  channel?: ChannelRef | null;
  /** P5b 通道引用绑定：paramName -> 通道 absolutePath（如 tx -> "/obj/geo1/transform1/tx"）。
   *  空/缺省时不序列化该键（旧图字节级兼容）。 */
  bindings?: Record<string, string>;
  /** schema 4 单端口形态：_input_/_output_ 的**逻辑名/相对地址**（如 "point_1/tx"）。
   *  绝对 Houdini 路径由桥侧映射系统按逻辑名解析——节点内绝不存绝对路径（移动 tag
   *  HDA 不再毁图）。与 bindings 同规则：空/缺省时不序列化该键（旧图字节级兼容）。 */
  address?: string;
  /** 工厂位置提示（makeProjectNode/makeChannelNode 的 x/y 参数）；视图位置仍由
   *  area.translate 落地（serializeGraph 读 area.nodeViews 的位置，不读本字段）。 */
  pos?: { x: number; y: number };
  /** 节点错误系统：**运行期瞬时态**（不序列化、不进 compute 快照、不进 undo）。
   *  由 setNodeErrors 全量覆盖；无错误时该键被删除（不留空数组）。 */
  errors?: NodeError[];
  constructor(label: string, kind: NodeKind) {
    super(label);
    this.kind = kind;
    this.baseLabel = label;
    BASE_LABEL[label] = label;
  }
  /** Rete dataflow: v1 just passes placeholder markers (stats view only). */
  data(inputs: Record<string, unknown[]>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(this.outputs)) out[key] = { port: key, src: this.label };
    for (const key of Object.keys(inputs)) out[key] = inputs[key]?.[0] ?? { empty: true };
    return out;
  }
  flagText(): string {
    const f = this.flags;
    return (
      (f.bypass ? "⏭" : "") +
      (f.freeze ? "🔒" : "") +
      (f.reference ? "⛶" : "")
    );
  }
}

/** _input_ / _output_ 的单端口参数（schema 4 形态）：address = 逻辑名/相对地址
 *  （如 "point_1/tx"，桥侧映射系统据此解析绝对路径）；type = 端口数据类型。 */
function addressParams(): ParamSpec[] {
  return [
    { name: "address", type: "string", value: "", default: "" },
    { name: "type", type: "menu", value: GEO, default: GEO },
  ];
}

/**
 * _input_ 节点。**默认是旧 4 端口形态**（in0..in3 全 GEO，无参数）——4 端口形状是
 * dataflow / chain-cache / 快照 / e2e 的承重墙，无参调用必须原样保持。
 * singlePort=true → schema 4 单端口形态：1 个 in0 + address/type 参数，端口类型跟随
 * type 参数。只有**新建图**（graph.ts buildGraph）与 schema>=4 的恢复走这条路。
 */
export function makeInputNode(singlePort = false): CylNode {
  const n = new CylNode("_input_", "input");
  if (!singlePort) {
    for (let i = 0; i < 4; i++) n.addOutput(`in${i}`, new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
    return n;
  }
  n.addOutput("in0", new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  n.params = addressParams();
  return n;
}
/** _output_ 节点：默认旧 out0..out3；singlePort=true → 单端口 out0 + address/type。 */
export function makeOutputNode(singlePort = false): CylNode {
  const n = new CylNode("_output_", "output");
  if (!singlePort) {
    for (let i = 0; i < 4; i++) n.addInput(`out${i}`, new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
    return n;
  }
  n.addInput("out0", new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
  n.params = addressParams();
  return n;
}

/** 读节点参数值（缺省 → undefined）；address/type 的唯一读入口。 */
function readParam(n: CylNode, name: string): unknown {
  return n.params?.find((p) => p.name === name)?.value;
}

/** _input_/_output_ 的单端口类型（读 type 参数；非法/缺省 → geo）。 */
export function nodeSocketType(n: CylNode): string {
  return toSocketType(readParam(n, "type"));
}

/**
 * 把 _input_/_output_ 单端口的 socket 类型同步到 type 参数（改 type 参数后调用）。
 * 仅作用于单端口形态（旧 4 端口图不动）；端口不存在 / 类型未变 → false。
 * rete 的 Socket 只带 name，直接换 socket 实例即可（连线校验读的就是它）。
 */
export function syncPortSocketType(n: CylNode): boolean {
  const want = nodeSocketType(n);
  if (n.kind === "input") {
    const port = n.outputs.in0;
    if (!port || Object.keys(n.outputs).length !== 1 || port.socket.name === want) return false;
    port.socket = new ClassicPreset.Socket(want);
    return true;
  }
  if (n.kind === "output") {
    const port = n.inputs.out0;
    if (!port || Object.keys(n.inputs).length !== 1 || port.socket.name === want) return false;
    port.socket = new ClassicPreset.Socket(want);
    return true;
  }
  return false;
}
/** Houdini-style unique naming: null1, null2… (first node already carries a suffix). */
let nullSeq = 1;
export function makeNullNode(): CylNode {
  const name = `null${nullSeq}`;
  nullSeq += 1;
  const n = new CylNode(name, "null");
  n.baseLabel = "null";
  n.addInput("in0", new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
  n.addOutput("out0", new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  return n;
}
/** Houdini-style unique naming: _dot_1, _dot_2… (independent seq). */
let dotSeq = 1;
export function makeDotNode(): CylNode {
  const name = `_dot_${dotSeq}`;
  dotSeq += 1;
  const n = new CylNode(name, "dot");
  n.baseLabel = "_dot_";
  n.addInput("in0", new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
  n.addOutput("out0", new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  return n;
}
/** Reserve the dot sequence counter past a restored label so undo-redo rebuilds
 *  never collide with an existing _dot_ label. */
export function claimDotLabel(label: string): void {
  const m = /^_dot_(\d+)$/.exec(label);
  if (m) {
    const n = Number(m[1]);
    if (dotSeq <= n) dotSeq = n + 1;
  }
}
/** Houdini-style unique naming: transform1, transform2… (independent seq). */
let transformSeq = 1;
export function makeTransformNode(): CylNode {
  const name = `transform${transformSeq}`;
  transformSeq += 1;
  const n = new CylNode(name, "transform");
  n.baseLabel = "transform";
  n.addInput("in0", new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
  n.addOutput("out0", new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  n.params = [
    { name: "px", type: "float", value: 0, default: 0 },
    { name: "py", type: "float", value: 0, default: 0 },
    { name: "pz", type: "float", value: 0, default: 0 },
    { name: "tx", type: "float", value: 0, default: 0 },
    { name: "ty", type: "float", value: 0, default: 0 },
    { name: "tz", type: "float", value: 0, default: 0 },
    { name: "group", type: "string", value: "", default: "" },
    { name: "class", type: "string", value: "autoguess", default: "autoguess" },
  ];
  return n;
}

// ---------------------------------------------------------------------------
// P2b 项目模式节点工厂（project 根 / channel 成员通道）
// ---------------------------------------------------------------------------

/** 项目图序列化版本（P2b）：v3 只在图内含 project/channel 节点时输出（buildGraphSnapshot
 *  自动判定）；否则保持 v2，绝不含新字段（round14-autosave / round16-undo 兼容）。 */
export const PROJECT_GRAPH_SCHEMA = 3;

/**
 * 单端口 + address 形态的图版本（schema 4）。
 *
 * 只在图内**真的用上了** address / 非 geo type 时才输出（buildGraphSnapshot 自动判定）；
 * 全默认的新图（address="" + type="geo"）序列化后与旧图**字节一致**（无 params 键），
 * 仍输出 v2/v3。restoreGraph 据此判形状：
 *   - schemaVersion < 4，或连接里出现 in1..in3 / out1..out3 → 旧 **4 端口形态原样重建**；
 *   - schemaVersion >= 4 且无旧端口引用 → 单端口 + address 形态。
 */
export const ADDRESS_GRAPH_SCHEMA = 4;

/** 项目根节点：**无端口**（不参与任何连线/几何计算；id = 项目 serial P1-…，标签即项目名）。
 *  x/y 仅作位置提示（loadProjectGraph/restoreGraph 仍以 area.translate 落地视图位置）。 */
export function makeProjectNode(id: string, label: string, x = 24, y = 40): CylNode {
  const n = new CylNode(label, "project");
  n.id = id;
  n.pos = { x, y };
  return n;
}

/** 成员通道节点：**1 in / 1 out**（视觉关联线用，v1 不参与几何计算/旧 display 状态机）。
 *  id = 成员 serial（tag/hda）；channel 携带完整 ChannelRef（label = member.label || serial）。 */
export function makeChannelNode(id: string, channel: ChannelRef, label: string, x = 340, y = 40): CylNode {
  const n = new CylNode(label, "channel");
  n.id = id;
  n.channel = channel;
  n.pos = { x, y };
  n.addInput("in0", new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
  n.addOutput("out0", new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  return n;
}

/** rete connection augmented with the wire-bypass visual flag. B-key toggles it
 *  on the selected connection; it is persisted (serializeGraph) but NEVER read by
 *  the compute path (getNetworkSnapshot / network.ts ignore it). */
interface BypassConnection {
  bypass?: boolean;
}

export function getConnectionBypass(conn: unknown): boolean {
  return (conn as BypassConnection).bypass === true;
}

/** waypoint 与 bypass 同一套约定：挂在连接对象上、会被序列化，但**计算路径永不读它**
 *  （`getNetworkSnapshot` / `network.ts` 完全无视）——它是纯装饰件。 */
interface WaypointConnection {
  waypoint?: ConnectionWaypoint;
}

export function getConnectionWaypoint(conn: unknown): ConnectionWaypoint | null {
  const wp = (conn as WaypointConnection).waypoint;
  if (!wp || !Number.isFinite(wp.x) || !Number.isFinite(wp.y)) return null;
  return wp;
}

/** 设/删路径中点。传 null 即删除——**删的是连接的一个属性，不是拓扑操作**，
 *  所以绝不可能留下半截线。 */
export function setConnectionWaypoint(conn: unknown, wp: ConnectionWaypoint | null): void {
  const c = conn as WaypointConnection;
  if (wp && Number.isFinite(wp.x) && Number.isFinite(wp.y)) c.waypoint = { x: wp.x, y: wp.y };
  else delete c.waypoint;
}

export function setConnectionBypassFlag(conn: unknown, on: boolean): void {
  const c = conn as BypassConnection;
  if (on) c.bypass = true;
  else delete c.bypass;
}

/** 读某节点某端口的 socket 类型名（供连线校验/着色）；端口不存在 → ""（拒绝连线）。 */
export function socketNameOf(
  editor: NodeEditor<Schemes>,
  nodeId: string,
  side: "input" | "output",
  key: string,
): string {
  const n = editor.getNode(nodeId) as CylNode | undefined;
  if (!n) return "";
  const port = side === "output" ? n.outputs[key] : n.inputs[key];
  return port?.socket?.name ?? "";
}

/** 按数据类型给连线着色（Houdini VOP 惯例：看颜色即知类型）。geo 保持既有灰白
 *  （不加类），float/vec3 加对应类；与 bypass 视觉同机制（rAF 重试一次）。 */
export function applyConnectionTypeVisual(
  area: AreaPlugin<Schemes, AreaExtra>,
  id: string,
  socketType: string,
): void {
  const apply = (): boolean => {
    const path = area.connectionViews.get(id)?.element.querySelector("path");
    if (!path) return false;
    path.classList.toggle("cyl-wire-float", socketType === FLOAT);
    path.classList.toggle("cyl-wire-vec3", socketType === VEC3);
    return true;
  };
  if (!apply()) {
    requestAnimationFrame(() => {
      apply();
    });
  }
}

/** Apply (or remove) the bypass visual class on a connection's rendered path.
 *  Right after addConnection the view may not be rendered yet, so retry once on
 *  the next animation frame before giving up. */
export function applyConnectionBypassVisual(
  area: AreaPlugin<Schemes, AreaExtra>,
  id: string,
  on: boolean,
): void {
  const apply = (): boolean => {
    const path = area.connectionViews.get(id)?.element.querySelector("path");
    if (!path) return false;
    path.classList.toggle("cyl-wire-bypass", on);
    return true;
  };
  if (!apply()) {
    requestAnimationFrame(() => {
      apply();
    });
  }
}

/** 序列化用的纯节点描述（serializeGraph 从 editor/area 采集后交给 buildGraphSnapshot）。 */
export interface GraphNodeSnapshotData {
  id: string;
  kind: NodeKind;
  label: string;
  baseLabel: string;
  flags: NodeFlags;
  params?: ParamSpec[];
  x: number;
  y: number;
  channel?: ChannelRef | null;
  /** P5b：通道引用绑定（paramName -> 通道 absolutePath；空/缺省时序列化省略该键）。 */
  bindings?: Record<string, string>;
  /** schema 4：_input_/_output_ 的逻辑名（空/缺省时序列化省略该键）。 */
  address?: string;
}

/** 连线上的路径中点（v0.1.00118）：**装饰件，不是节点**。
 *
 *  为什么挂在连接上而不是做成 NodeKind：旧的 `dot` 是真节点，插入时要
 *  「删 1 条连接 + 加 1 节点 + 加 2 条连接」，于是它进入拓扑、参与 cook trace，
 *  删掉还会留下两条半截线。改成连接自己的一个可选字段后：
 *  - 连接始终是**一条**（source → target），不可能出现"连接一半的线"
 *  - 拓扑不变 → cook 完全不受影响，无需 passthrough 特例
 *  - 任一端断联时连接本身消失，waypoint 随之消失，不需要额外清理逻辑
 *  - 天然兼容既有连线：给任何一条线加个字段即可，不用重连
 */
export interface ConnectionWaypoint {
  x: number;
  y: number;
}

/** 序列化用的纯连接描述（serializeGraph 采集后交给 buildGraphSnapshot）。 */
export interface GraphConnectionSnapshotData {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
  bypass?: boolean;
  /** 路径中点；**无则不输出该键**（无 waypoint 的图与旧图字节一致）。 */
  waypoint?: ConnectionWaypoint;
}

/** 参数是否为「单端口默认值」——address="" 或 type="geo"。这类参数**不序列化**，
 *  于是全默认的新 _input_/_output_ 与旧 4 端口节点输出字节一致（无 params 键）。 */
function isDefaultAddressParam(p: ParamSpec): boolean {
  if (p.name === "address") return p.value === "" || p.value == null;
  if (p.name === "type") return p.value === GEO || p.value == null;
  return false;
}

/** 剔除默认 address/type 后的参数列表（空 → undefined，序列化时无该键）。 */
function serializableParams(kind: NodeKind, params?: ParamSpec[]): ParamSpec[] | undefined {
  if (!params || params.length === 0) return undefined;
  if (kind !== "input" && kind !== "output") return params; // 其它 kind 的参数原样
  const kept = params.filter((p) => !isDefaultAddressParam(p));
  return kept.length > 0 ? kept : undefined;
}

/**
 * 纯序列化（可单测）：
 * - 图内含任一 project/channel 节点 → schemaVersion 3（channel 字段仅 channel 节点带）；
 * - _input_/_output_ **真的用上了** address / 非 geo type → schemaVersion 4（单端口形态）；
 * - 否则 schemaVersion 2 且**绝不含新字段**（round14-autosave / round16-undo 字节兼容）。
 * address / type 全默认时不输出 params，因此新建图（未填 address）与旧图字节一致。
 * v3 与 v4 同时成立时取 4——restoreGraph 的形状判定需要看到它。
 */
export function buildGraphSnapshot(
  nodes: GraphNodeSnapshotData[],
  connections: GraphConnectionSnapshotData[],
  viewport: { k: number; x: number; y: number },
): unknown {
  const isProjectGraph = nodes.some((n) => n.kind === "project" || n.kind === "channel");
  let usesAddress = false;
  const serializedNodes = nodes.map((n) => {
    const entry: Record<string, unknown> = {
      id: n.id,
      kind: n.kind,
      label: n.label,
      baseLabel: n.baseLabel,
      flags: n.flags,
      x: n.x,
      y: n.y,
    };
    const params = serializableParams(n.kind, n.params);
    if (params) entry.params = params;
    // P5b：bindings 非空才输出该键（空 {} / undefined 省略——旧图字节级兼容）
    if (n.bindings && Object.keys(n.bindings).length > 0) entry.bindings = n.bindings;
    // schema 4：address 非空才输出该键（与 bindings 同规则）
    if (n.address) entry.address = n.address;
    if ((n.kind === "input" || n.kind === "output") && (n.address || params)) {
      usesAddress = true; // 留下的必是非默认 address/type
    }
    if (isProjectGraph && n.channel) entry.channel = n.channel; // v2 绝不含新字段；v3 也省略 null
    return entry;
  });
  const schemaVersion = usesAddress
    ? ADDRESS_GRAPH_SCHEMA
    : isProjectGraph
      ? PROJECT_GRAPH_SCHEMA
      : 2;
  return { schemaVersion, viewport, nodes: serializedNodes, connections };
}

export function serializeGraph(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
): unknown {
  const nodes: GraphNodeSnapshotData[] = editor.getNodes().map((n) => {
    const c = n as CylNode;
    const pos = area.nodeViews.get(n.id)?.position;
    return {
      id: n.id,
      kind: c.kind,
      label: c.label,
      baseLabel: c.baseLabel,
      flags: c.flags,
      params: c.params && c.params.length > 0 ? c.params : undefined,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      channel: c.channel ?? undefined,
      // P5b：bindings 非空才采集（空 {} / undefined → undefined → 序列化无该键）
      bindings: c.bindings && Object.keys(c.bindings).length > 0 ? c.bindings : undefined,
      // schema 4：address 空串/缺省 → undefined（序列化无该键）
      address: c.address ? c.address : undefined,
    };
  });
  // Defensive: only serialize connections whose endpoint nodes still exist. Rete can
  // leave orphan connections behind after node removal, and persisting those produced
  // the "4 headless segments" bug (1 node / 4 dangling conns snapshot).
  const nodeIds = new Set(editor.getNodes().map((n) => n.id));
  const connections: GraphConnectionSnapshotData[] = editor
    .getConnections()
    .filter((c) => nodeIds.has(c.source) && nodeIds.has(c.target))
    .map((c) => {
      const entry: GraphConnectionSnapshotData = {
        source: c.source,
        sourceOutput: c.sourceOutput,
        target: c.target,
        targetInput: c.targetInput,
      };
      // only emit the flag when true, so older snapshots stay byte-compatible
      if (getConnectionBypass(c)) entry.bypass = true;
      // 同理：无 waypoint 时不输出该键，无装饰件的图与旧图字节一致
      const wp = getConnectionWaypoint(c);
      if (wp) entry.waypoint = { x: wp.x, y: wp.y };
      return entry;
    });
  return buildGraphSnapshot(nodes, connections, { ...area.area.transform });
}

/**
 * 纯恢复决策（可单测）：按 kind 构造节点；project → 项目根（无端口），channel →
 * 成员通道（需 channel 引用）；**未知 kind → null（跳过该节点不崩）**；channel 缺
 * channel 引用 → null（跳过）。restoreGraph 对 null 直接 continue。
 */
export function restoreNodeForKind(
  nd: {
    kind: NodeKind;
    id?: string;
    label?: string;
    channel?: ChannelRef | null;
    bindings?: unknown; // P5b：可选通道引用绑定（sanitizeBindings 校验；非法忽略）
    address?: unknown; // schema 4：可选逻辑名（sanitizeAddress 校验；非法忽略）
    params?: ParamSpec[];
  },
  /** true → _input_/_output_ 重建为**旧 4 端口形态**（v2/v3 图 / 含 in1..in3 引用的图）。
   *  restoreGraph 用 detectLegacyPorts 判定后传入；**默认 true = 旧形状**（无参调用
   *  与改动前完全一致）。 */
  legacyPorts = true,
): CylNode | null {
  let n: CylNode | null;
  switch (nd.kind) {
    case "input":
      n = makeInputNode(!legacyPorts);
      break;
    case "output":
      n = makeOutputNode(!legacyPorts);
      break;
    case "null":
      n = makeNullNode();
      break;
    case "transform":
      n = makeTransformNode();
      break;
    case "dot":
      n = makeDotNode();
      break;
    case "project":
      n = makeProjectNode(nd.id ?? "", nd.label ?? "project");
      break;
    case "channel":
      n = nd.channel ? makeChannelNode(nd.id ?? "", nd.channel, nd.label ?? nd.channel.serial ?? "channel") : null;
      break;
    default:
      return null; // 未知 kind：跳过，不崩
  }
  // P5b：bindings 可选读入（非法忽略）——restoreGraph 的节点重建经此一处落地绑定
  if (n) {
    const bindings = sanitizeBindings(nd.bindings);
    if (bindings) n.bindings = bindings;
    // schema 4：address 落地到字段 + 参数（两处同源，参数面板改的是参数）；
    // 快照里 address 省略但 params 带 address 时，以 params 为准（下面 restoreGraph 赋 params）。
    const address = sanitizeAddress(nd.address);
    if (address) n.address = address;
    if (!legacyPorts && (n.kind === "input" || n.kind === "output")) {
      syncAddressParams(n, address, nd.params);
    }
  }
  return n;
}

/** 校验反序列化 address：仅接受非空字符串（数组/对象/数字等非法输入 → undefined）。
 *  与 sanitizeBindings 同防御风格：非法值忽略，绝不抛。 */
export function sanitizeAddress(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/**
 * 单端口节点的 address/type 参数补全：快照的 params 里可能只剩非默认项（序列化剔除了
 * 默认值），这里把缺的补回默认值并让 address 字段与参数一致，最后同步 socket 类型。
 */
function syncAddressParams(n: CylNode, address: string | undefined, saved?: ParamSpec[]): void {
  const savedAddress = saved?.find((p) => p.name === "address");
  const savedType = saved?.find((p) => p.name === "type");
  const addr = sanitizeAddress(savedAddress?.value) ?? address ?? "";
  const type = toSocketType(savedType?.value);
  // 快照里已有的那一项**原样保留**（含有/无 default 键），只补缺的那一项：
  // 于是 serialize -> restore -> serialize 字节稳定（不会凭空长出 default 键）。
  n.params = [
    savedAddress ? { ...savedAddress, value: addr } : { name: "address", type: "string", value: addr, default: "" },
    savedType ? { ...savedType, value: type } : { name: "type", type: "menu", value: type, default: GEO },
  ];
  if (addr) n.address = addr;
  else delete n.address;
  syncPortSocketType(n);
}

/**
 * 旧 4 端口形态判定（restoreGraph 的兼容开关）：
 * - schemaVersion < 4（v2/v3 或缺省）→ 旧形态；
 * - 任一连接引用 _input_ 的 in1..in3 / _output_ 的 out1..out3 → 旧形态
 *   （即便 schemaVersion 被手改过，也按实际端口引用重建，绝不丢连接）。
 * 两条都不成立 → 单端口 + address 形态（只有新建图会走到这里）。
 */
export function detectLegacyPorts(d: {
  schemaVersion?: number;
  nodes?: Array<{ id: string; kind: NodeKind }>;
  connections?: Array<{ source: string; sourceOutput: string; target: string; targetInput: string }>;
}): boolean {
  if ((d.schemaVersion ?? 2) < ADDRESS_GRAPH_SCHEMA) return true;
  const inputIds = new Set((d.nodes ?? []).filter((n) => n.kind === "input").map((n) => n.id));
  const outputIds = new Set((d.nodes ?? []).filter((n) => n.kind === "output").map((n) => n.id));
  return (d.connections ?? []).some(
    (c) =>
      (inputIds.has(c.source) && /^in[1-3]$/.test(c.sourceOutput)) ||
      (outputIds.has(c.target) && /^out[1-3]$/.test(c.targetInput)),
  );
}

export async function restoreGraph(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  data: unknown,
): Promise<void> {
  const d = data as {
    nodes?: {
      id: string;
      kind: NodeKind;
      label: string;
      baseLabel?: string;
      flags?: NodeFlags;
      params?: ParamSpec[];
      x: number;
      y: number;
      channel?: ChannelRef | null; // v3：channel 节点携带的成员引用
      bindings?: unknown; // P5b：可选通道引用绑定（restoreNodeForKind 内校验读入）
      address?: unknown; // schema 4：可选逻辑名（restoreNodeForKind 内校验读入）
    }[];
    connections?: {
      source: string;
      sourceOutput: string;
      target: string;
      targetInput: string;
      bypass?: boolean;
      waypoint?: ConnectionWaypoint;
    }[];
    viewport?: { k: number; x: number; y: number };
    schemaVersion?: number;
  };
  if (!d?.nodes) return;
  // 兼容开关：v2/v3 图（或任何还在用 in1..in3 / out1..out3 的图）→ 旧 4 端口形态原样重建
  const legacyPorts = detectLegacyPorts(d);
  // Remove every live connection FIRST: rete's removeNode does not reliably drop its
  // connections, so restoring over a stale graph left headless segments behind.
  for (const c of editor.getConnections()) await editor.removeConnection(c.id);
  for (const n of editor.getNodes()) await editor.removeNode(n.id);
  const idMap = new Map<string, string>();
  let displayAssigned = false;
  for (const nd of d.nodes) {
    // v3 项目分支 + 未知 kind 跳过（restoreNodeForKind 返回 null 时 continue）
    const n = restoreNodeForKind(nd, legacyPorts);
    if (!n) {
      log(`restore skipped node id=${nd.id} kind=${String(nd.kind)} (unknown kind or missing channel ref)`);
      continue;
    }
    const flags = { ...DEFAULT_FLAGS, ...(nd.flags ?? {}) };
    // P2b：project/channel 的 display 不进持久化状态机（channel display 是独立模块态，
    // 由 graph.ts setDisplayHandler 路由；这里强制熄灭，避免污染旧 kinds 唯一 display）
    if (n.kind === "project" || n.kind === "channel") flags.display = false;
    if (flags.display && displayAssigned) {
      flags.display = false; // only ONE display per network survives a restore
    } else if (flags.display) {
      displayAssigned = true;
    }
    n.flags = flags;
    n.label = nd.label ?? n.label;
    if (n.kind === "dot") claimDotLabel(n.label); // restore advances the seq so Ctrl+add never collides
    n.baseLabel = nd.baseLabel ?? n.baseLabel;
    // 单端口 _input_/_output_ 的 params 已由 restoreNodeForKind 补全（默认值 + socket
    // 类型同步），不能被快照里「只剩非默认项」的 params 覆盖回去。
    const addressForm = !legacyPorts && (n.kind === "input" || n.kind === "output");
    if (nd.params && !addressForm) n.params = nd.params;
    await editor.addNode(n);
    idMap.set(nd.id, n.id);
    await area.translate(n.id, { x: nd.x ?? 0, y: nd.y ?? 0 });
  }
  for (const c of d.connections ?? []) {
    const src = editor.getNode(idMap.get(c.source) ?? "") as CylNode | undefined;
    const tgt = editor.getNode(idMap.get(c.target) ?? "") as CylNode | undefined;
    if (!src || !tgt) continue;
    if (src.id === tgt.id) {
      log(`restore skipped self-connection on ${src.label}`);
      continue;
    }
    const conn = new ClassicPreset.Connection(src, c.sourceOutput, tgt, c.targetInput) as unknown as Schemes["Connection"];
    await editor.addConnection(conn);
    if (c.bypass) {
      // persist + re-style the bypass flag on the rebuilt connection
      setConnectionBypassFlag(conn, true);
      applyConnectionBypassVisual(area, conn.id, true);
    }
    // waypoint 随连接恢复（纯属性，无需重建拓扑）
    if (c.waypoint) setConnectionWaypoint(conn, c.waypoint);
  }
  if (d.viewport && d.viewport.k) {
    await area.area.zoom(d.viewport.k);
    await area.area.translate(d.viewport.x ?? 0, d.viewport.y ?? 0);
  }
  store.pushLog(`[node] restored graph: ${d.nodes.length} nodes / ${(d.connections ?? []).length} connections`);
  notifySelection(); // selection was reset by the rebuild
}

// ---------------------------------------------------------------------------
// P5b 通道引用绑定：数据层纯函数（无 DOM，可直接单测）。graph.ts 的薄壳 API
// （getNodeParamBindings / listNodeParamBindings / setNodeBindings）把这里的纯函数
// 绑到当前图句柄 activeGraph。绑定不触发 network.run；持久化走既有 serializeGraph
// 快照机制（autosave / 显式保存自动携带 bindings 键）。
// ---------------------------------------------------------------------------

/** 校验反序列化 bindings：仅接受「普通对象 + 全部字符串值」；数组/字符串/null 等
 *  非法输入 → undefined；值非字符串的键被忽略；结果为空 → undefined（restore 后
 *  节点不带该键，保持旧图字节级兼容）。 */
export function sanitizeBindings(v: unknown): Record<string, string> | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 单节点绑定视图（params 名/值 + bindings 拷贝）；节点不存在 → null。 */
export function nodeParamBindingsView(
  editor: NodeEditor<Schemes>,
  id: string,
): { params: ParamSpec[]; bindings: Record<string, string> } | null {
  const n = editor.getNode(id) as CylNode | undefined;
  if (!n) return null;
  return {
    params: (n.params ?? []).map((p) => ({ name: p.name, type: p.type, value: p.value })), // 完整 ParamSpec（main.ts 合并写回用）
    bindings: { ...(n.bindings ?? {}) },
  };
}

/** 全部节点绑定视图（id/label/params/bindings）；无绑定节点 → bindings = {}。 */
export function listNodeParamBindingsView(editor: NodeEditor<Schemes>): {
  id: string;
  label: string;
  params: ParamSpec[];
  bindings: Record<string, string>;
}[] {
  return (editor.getNodes() as CylNode[]).map((n) => ({
    id: n.id,
    label: n.label,
    params: (n.params ?? []).map((p) => ({ name: p.name, type: p.type, value: p.value })), // 完整 ParamSpec
    bindings: { ...(n.bindings ?? {}) },
  }));
}

/** 写入节点 bindings（拷贝入节点；清空 = 传 {} → 删除该键，序列化时无 bindings）；
 *  节点不存在 → false。 */
export function applyNodeBindings(
  editor: NodeEditor<Schemes>,
  id: string,
  bindings: Record<string, string>,
): boolean {
  const n = editor.getNode(id) as CylNode | undefined;
  if (!n) return false;
  if (Object.keys(bindings).length === 0) {
    delete n.bindings; // 空 → 无键（字节级兼容：serializeGraph 不输出空 bindings）
  } else {
    n.bindings = { ...bindings };
  }
  return true;
}

export function getNetworkSnapshot(editor: NodeEditor<Schemes>): NetworkSnapshot {
  // P2b：project/channel **不进 compute 快照**——channel 的关联线 v1 纯视觉，不参与
  // 几何计算/race；compute（traceChainSpecs / chain-cache）只应看到旧 kinds。过滤掉
  // 这类节点及其连接后，输出链自然回退 passthrough（与「channel 即便有连接也不参与
  // 几何计算」一致），且无需改 nodes2/network.ts。
  const computeNodes = (editor.getNodes() as CylNode[]).filter(
    (n) => n.kind !== "project" && n.kind !== "channel",
  );
  const nodeIds = new Set(computeNodes.map((n) => n.id));
  return {
    nodes: computeNodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      params: n.params ?? [],
    })),
    // 端口数据类型不单独入快照：type 就在 params 里，network.ts 直接读（非 geo 的
    // _input_/_output_ 端口被排除在几何计算之外）。旧 4 端口图无 type 参数 → 全 geo。
    connections: editor
      .getConnections()
      .filter((c) => nodeIds.has(c.source) && nodeIds.has(c.target))
      .map((c) => ({ source: c.source, sourceOutput: c.sourceOutput, target: c.target, targetInput: c.targetInput })),
  };
}

// ---------------------------------------------------------------------------
// P2b 项目图规划（纯函数，graph.ts 的 loadProjectGraph 执行该计划）
// ---------------------------------------------------------------------------

/** loadProjectGraph 的纯规划结果：graph.ts 只负责把 plan 落到编辑器/画布。 */
export interface ProjectGraphPlanNode {
  id: string;
  kind: "project" | "channel";
  label: string;
  channel: ChannelRef | null;
  x: number;
  y: number;
}
export interface ProjectGraphPlan {
  nodes: ProjectGraphPlanNode[];
  connections: GraphConnectionSnapshotData[];
  viewport: { k: number; x: number; y: number } | null;
}

/**
 * 纯规划（可单测）：project 根（label = input.label || input.projectSerial）+ 每个
 * tag/hda 成员一个 channel 节点（id = serial，label = member.label || serial）；**param
 * 成员跳过（v1）**。saved（项目图快照 v3）提供按 id 匹配的位置/连接/viewport；saved 里
 * 存在但当前 members 没有的成员（缺失成员）→ 不在 plan 中，自然跳过。连接仅保留两端点
 * 都在 plan 里的（防御性过滤，与 restoreGraph 一致）。
 */
export function planProjectGraph(input: ProjectGraphInput, saved?: unknown): ProjectGraphPlan {
  const s = (saved ?? null) as {
    nodes?: Array<{ id: string; x?: number; y?: number }>;
    connections?: GraphConnectionSnapshotData[];
    viewport?: { k: number; x: number; y: number };
  } | null;
  const posOf = (id: string): { x: number; y: number } | null => {
    const hit = s?.nodes?.find((n) => n.id === id);
    return hit && typeof hit.x === "number" ? { x: hit.x, y: hit.y ?? 0 } : null;
  };
  const nodes: ProjectGraphPlanNode[] = [];
  nodes.push({
    id: input.projectSerial,
    kind: "project",
    label: input.label || input.projectSerial,
    channel: null,
    ...(posOf(input.projectSerial) ?? { x: 24, y: 40 }),
  });
  let channelIndex = 0;
  for (const m of input.members) {
    if (m.kind !== "tag" && m.kind !== "hda") continue; // param 成员跳过（v1）
    const id = m.serial ?? "";
    if (!id) continue; // tag/hda 必有 serial；缺则防御性跳过
    nodes.push({
      id,
      kind: "channel",
      label: m.label || id,
      channel: m,
      ...(posOf(id) ?? { x: 340, y: 40 + channelIndex * 80 }), // 默认：项目根右侧纵向排列
    });
    channelIndex += 1;
  }
  const ids = new Set(nodes.map((n) => n.id));
  const connections = (s?.connections ?? []).filter((c) => ids.has(c.source) && ids.has(c.target));
  const viewport = s?.viewport && s.viewport.k ? s.viewport : null;
  return { nodes, connections, viewport };
}
