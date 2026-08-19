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
export type NodeKind = "input" | "output" | "null" | "transform" | "project" | "channel" | "geo";

/**
 * 网络层级（v0.1.00119）：照 Houdini 的 `/obj` 与 obj 内 sop 的关系建模。
 *
 * - `obj`：第一层（项目根图）与其中建的 subnet/geo，**不是 sop**。只能创建 geo 类节点。
 * - `sop`：进入 geo 类节点之后的子网络。`input`/`output`/`null`/`transform` 只在这一层可建。
 *
 * 为什么单开一个维度而不是继续往 `NodeKind` 里堆：「这个节点是什么」与「它活在哪一层」
 * 是两件正交的事。堆进 NodeKind 会让每个既有的 `kind === "..."` 判断都要跟着分裂一次
 * （dataflow / network / NodeView / undo 全中），而多一个维度只影响真正关心层级的地方。
 *
 * 缺省 `"sop"`：旧图的每个节点都没有这个字段，读出来一律是 sop —— 与改造前行为逐字一致。
 */
export type NetKind = "obj" | "sop";

/** 该 kind 是否可进入（双击进入其子网络）。目前只有 geo 类。 */
export function isEnterableKind(kind: NodeKind): boolean {
  return kind === "geo";
}

/** 该 kind 允许在哪一层创建。project/channel 不由用户创建，故不出现在任何层的面板里。 */
export function netKindOfCreatable(kind: NodeKind): NetKind | null {
  if (kind === "geo") return "obj";
  if (kind === "input" || kind === "output" || kind === "null" || kind === "transform") return "sop";
  return null; // project / channel：只能由 loadProjectGraph 建立
}

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
  if (!SOCKET_TYPES.includes(from) || !SOCKET_TYPES.includes(to)) return false;
  if (from === to) return true;
  // 标量/向量之间允许隐式转换（用户要求）：float -> vec3 三分量同值、vec3 -> float 取第一分量。
  // 转换的**数值语义**由 network.ts 落实（convertSocketValue），这里只放行连线。
  // geo 与 float/vec3 之间永远不通：几何不是数值，转换没有意义。
  return (from === FLOAT && to === VEC3) || (from === VEC3 && to === FLOAT);
}

/**
 * 按端口类型转换一个值（float ↔ vec3）——连线放行之后的**数值**语义单源。
 *
 * - `float -> vec3`：三个分量都取该值（用户要求「三个值都是这个 float」）
 * - `vec3 -> float`：取第一个通道（用户要求「直接取第一个通道」）
 * - 同类型 / 任一端是 geo / 非有限数 → 原样返回（绝不编造数值）
 *
 * 放在 graph-model 而不是 network.ts：连线校验（canConnectSockets）与取值转换是同一条
 * 规则的两半，分开放会让「能连但算错」这类不一致有机会出现。
 */
export function convertSocketValue(value: unknown, from: string, to: string): unknown {
  if (from === to) return value;
  if (from === FLOAT && to === VEC3) {
    const n = typeof value === "number" && Number.isFinite(value) ? value : null;
    return n === null ? value : [n, n, n];
  }
  if (from === VEC3 && to === FLOAT) {
    return Array.isArray(value) && value.length > 0 ? value[0] : value;
  }
  return value;
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
 * ——即**不加类**，沿用 CSS 里的默认端口色（geo = 朱红 `#ff6b6b`，与 geo 线同色），
 * 因此旧 4 端口图外观零变化。
 * （此处原写作"灰白"，是错的：不加类的端口渲染出来是朱红。这种含糊描述正是
 *  float/vec3 配色被写反还长期没被发现的原因之一，故一并纠正。）
 * NodeView（另一写集）把它拼到 `cyl-rp-port` 的 className 上，CSS 里定义
 * `.cyl-port-float` / `.cyl-port-vec3` 的颜色。放在这里是因为「类型 → 类名」
 * 是数据层规则，可无 DOM 单测。
 */
export function socketTypeClass(socketType: unknown): string {
  if (socketType === FLOAT) return "cyl-port-float";
  if (socketType === VEC3) return "cyl-port-vec3";
  // geo 从 v0.1.00121 起也**显式出类**：此前它靠「不加类 = CSS 默认色」来上朱红，
  // 结果所有**没有类型**的端口也一并变红（红色还兼作错误色，整张图像在报错）。
  // 现在无类型 = 中性灰白，是 geo 才朱红——「不知道类型」与「是几何」得能分辨。
  if (socketType === GEO) return "cyl-port-geo";
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

/**
 * 一条「同一 serial 的同一 out 端口被两个 _output_ 节点重复占用」错误（v0.1.00120）。
 *
 * 用户原话：「Cyl1nder 中同一个序列号 out 的同一个端口不可重复, 否则报错」。语义上这是
 * **写冲突**：两个 _output_ 都想往同一个 (serial, port) 写几何/数值，桥侧无从裁决谁赢。
 */
export interface DuplicateOutputPortError {
  /** 冲突里**每一个**参与节点的 id（成对/成组，全部都要报——用户得看见是哪几个撞了）。 */
  nodeIds: string[];
  /** address 参数值（serial）。 */
  serial: string;
  /** port 参数值（capabilities 里的 key，如 "out1"）。 */
  port: string;
  /** 参与冲突的节点标签（消息里列出，顺序同 nodeIds）。 */
  labels: string[];
  message: string;
}

/** findDuplicateOutputPorts 的入参形状：**结构化接收**，不 import 任何具体节点类型。
 *  于是 NetworkSnapshot 的节点、CylNode、单测里的字面量都能直接喂进来。 */
export interface OutputPortNodeLike {
  id: string;
  /** 刻意是宽 `string` 而不是 `NodeKind`：本谓词只把它与 `"output"` 比一次，
   *  用不上窄类型；而调用方 `NetworkSnapshot.nodes`（network.ts 的 `NetworkNode`）
   *  的 kind 本就是 `string`，收窄会让快照传不进来，只能靠 cast 绕——那是把类型
   *  检查关掉，不是满足它。 */
  kind: string;
  label?: string;
  params?: ReadonlyArray<{ name: string; value: unknown }>;
}

/** 从节点的 params 里读一个字符串参数（非字符串/缺省 → ""）。 */
function stringParam(n: OutputPortNodeLike, name: string): string {
  const v = n.params?.find((p) => p.name === name)?.value;
  return typeof v === "string" ? v : "";
}

/**
 * 检出重复占用的 (serial, port) 组合 —— **纯谓词**，不碰编辑器、不碰 DOM。
 *
 * 规则（三条都是刻意的）：
 *  1. 只看 `kind === "output"`：input 侧一个 serial 的同一端口被读多次完全合法
 *     （读没有冲突，写才有）。
 *  2. `address`（serial）或 `port` **任一为空 → 跳过**。地址填了还没选端口、或反之，
 *     都是正常的填写中间态；把它报成错误会让用户在填第一个字符时就看见红三角。
 *  3. 键是 `serial + "\u0000" + port` 的**精确**组合：serial 不同或 port 不同都不冲突。
 *
 * 同组里**每一个**节点都被列进 `nodeIds`（不是只报后来的那个）：用户要看见"是这两个
 * 撞了"，只标第二个等于让他自己去猜第一个是谁。
 */
export function findDuplicateOutputPorts(
  nodes: ReadonlyArray<OutputPortNodeLike>,
): DuplicateOutputPortError[] {
  const groups = new Map<string, OutputPortNodeLike[]>();
  for (const n of nodes) {
    if (!n || n.kind !== "output") continue;
    const serial = stringParam(n, "address");
    const port = stringParam(n, PORT_PARAM);
    if (serial === "" || port === "") continue; // 未填完 ≠ 错误
    const key = `${serial}\u0000${port}`;
    const list = groups.get(key);
    if (list) list.push(n);
    else groups.set(key, [n]);
  }
  const out: DuplicateOutputPortError[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const [serial, port] = key.split("\u0000");
    const labels = list.map((n) => n.label ?? n.id);
    out.push({
      nodeIds: list.map((n) => n.id),
      serial,
      port,
      labels,
      message: `output port ${serial}.${port} is claimed by ${list.length} nodes (${labels.join(", ")}): one serial port can only be written once - change the address or pick another port`,
    });
  }
  return out;
}

/**
 * DuplicateOutputPortError[] → NodeErrorMap（照 multiSourceErrorsToNodeErrors 的形状）。
 *
 * `port` 一律填 `"out0"` 而不是冲突的那个 key：单端口 _output_ 的**图内 socket**就叫
 * out0，NodeView 高亮的是图内端口 dot。冲突的 capabilities key（"out1"…）在 message
 * 里说清楚——两者是不同层的东西，混用会让红圈打在一个不存在的端口上。
 */
export function duplicateOutputPortsToNodeErrors(
  errors: ReadonlyArray<DuplicateOutputPortError>,
): NodeErrorMap {
  const map: NodeErrorMap = {};
  for (const e of errors) {
    if (!e?.nodeIds?.length || typeof e.message !== "string" || e.message === "") continue;
    for (const id of e.nodeIds) {
      if (!id) continue;
      (map[id] ??= []).push({
        severity: "error",
        message: e.message,
        port: "out0",
        source: "duplicate-output-port",
      });
    }
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
  if ((src?.kind === "null" || src?.kind === "transform") && out === "out0") {
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
  /** 该节点活在哪一层（v0.1.00119）。缺省 `"sop"` —— 旧图无此字段，行为与改造前一致。 */
  netKind?: NetKind;
  /** 仅 kind==="project"：当前绑定的 hip 绝对路径（v0.1.00119，task #6）。
   *  **不序列化**——hip 的权威来源是桥侧 `ProjectRef.hip`，每次 loadProjectGraph 重新注入；
   *  存进快照只会在另存为之后变成过期数据（比没有更糟）。 */
  hip?: string;
  /** 可进入节点（geo 类）的**子网络**，内联存在父节点上。
   *
   *  为什么内联而不是每个子网一个文件/桥端点：用户明确要求「不用塞多个文件夹，以免浪费
   *  token」。子图是父图的一部分，跟着同一份 graph.json 往返，无需新增协议面。
   *  空/缺省时不序列化该键（旧图字节级兼容）。 */
  children?: unknown;
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

/**
 * 单端口 `_input_`/`_output_` 里「选中的端口/通道」参数名（v0.1.00120）。
 *
 * 抽成常量而不是散写字面量：这个名字是**跨写集契约**——参数面板（另一写集）按它
 * 渲染下拉、capabilities 解析（再一个写集）按它写回选中的 key，本文件按它做
 * 序列化过滤与重复检测。三处必须逐字一致，散写字面量迟早会有一处拼错。
 */
export const PORT_PARAM = "port";

/**
 * _input_ / _output_ 的单端口参数（schema 4 形态）。
 *
 * - `address`：**一个序列号**（serial）。用户只填这一个值，桥侧
 *   `GET /api/serials/{serial}/capabilities` 回答"它提供什么"——SOP HDA → in0..in3 /
 *   out0..out3；tag → 该 tag 的逻辑名及其类型。
 *   （历史注释说 address 是"逻辑名/相对地址（如 point_1/tx）"，那是 address 还兼任
 *    端口选择时的形态；现在**端口选择分出去成了 `port`**，address 只剩 serial。）
 * - `port`：从 capabilities 里选中的那个 `key`（如 "out1" / "transform1/tx"）。
 *   空 = 还没选（**不是错误**：地址填了但端口未选是正常的中间状态）。
 * - `type`：端口数据类型。**仍由映射/capabilities 解析写入**、由 syncPortSocketType
 *   读出去换 socket——本次改动一个字都没碰那条通路。
 */
function addressParams(): ParamSpec[] {
  return [
    { name: "address", type: "string", value: "", default: "" },
    { name: "type", type: "menu", value: GEO, default: GEO },
    { name: PORT_PARAM, type: "menu", value: "", default: "" },
  ];
}

// ---------------------------------------------------------------------------
// _input_ / _output_ 的标签序号（v0.1.00120）
//
// 这两种节点原本是「每图唯一」，所以没有序号计数器。现在用户要能拉多个 input、各填
// 一个 serial 地址再各选端口，于是必须像 null/transform/geo 那样发唯一名。
//
// **命名取「首个不带序号，第二个起 _input_2」而不是 input1/input2**：
//   - `_input_` / `_output_` 这两个字面量是**外部契约**，13 个 e2e spec 的存档 fixture
//     直接写 `label: "_input_"` 并用 `hasText: "_input_"` 定位节点（round2/3/4/5/6/7/8、
//     round12/14/15/16/17/18/19/20、waypoint-verify、rename-refs-verify），
//     `bridge/tests/test_mcp.py` 也断言 `sourceLabel == "_input_"`。改首名 = 一次性打断
//     这些全部，收益是零。
//   - 与 null/transform/geo 的「首个也带序号（null1）」**刻意不同**：那三个从来没有
//     "无序号"形态，而这两个的无序号形态已经被冻结在存档与文档里（devlog/shortcuts.md
//     记的就是 `_input_` / `_output_`）。一致性在这里要让位于兼容性。
//   - 保留首尾下划线：它标记「这是网络的边界节点，不是普通 SOP」，Houdini 也是这个味道。
// ---------------------------------------------------------------------------

/** 下一个 _input_ 序号：1 → `_input_`（无后缀），2 → `_input_2`，以此类推。 */
let inputSeq = 1;
/** 同上，_output_ 独立计数（与 nullSeq/transformSeq/geoSeq 各自独立同理）。 */
let outputSeq = 1;

/** 序号 → 标签：首个不带后缀（冻结契约），第二个起接数字。 */
function seqLabel(base: string, seq: number): string {
  return seq <= 1 ? base : `${base}${seq}`;
}

/**
 * 恢复图/undo 时推进 _input_ 序号，避免与既有节点撞名（照 claimGeoLabel 的做法）。
 * 认两种形态：`_input_`（占掉序号 1 → 下一个至少是 2）与 `_input_<n>`（下一个至少 n+1）。
 */
export function claimInputLabel(label: string): void {
  claimSeqLabel(label, "_input_", (n) => {
    if (inputSeq <= n) inputSeq = n + 1;
  });
}

/** 同上，_output_ 侧。 */
export function claimOutputLabel(label: string): void {
  claimSeqLabel(label, "_output_", (n) => {
    if (outputSeq <= n) outputSeq = n + 1;
  });
}

/** claimInputLabel / claimOutputLabel 的共同核心：解析 `<base>` 或 `<base><n>` 的序号。
 *  不匹配（用户改过名，如 "myInput"）→ 什么都不做：那种名字不占本序列的号。 */
function claimSeqLabel(label: string, base: string, bump: (n: number) => void): void {
  if (label === base) {
    bump(1);
    return;
  }
  if (!label.startsWith(base)) return;
  const rest = label.slice(base.length);
  if (!/^\d+$/.test(rest)) return;
  const n = parseInt(rest, 10);
  if (Number.isFinite(n)) bump(n);
}

/**
 * _input_ 节点。**默认是旧 4 端口形态**（in0..in3 全 GEO，无参数）——4 端口形状是
 * dataflow / chain-cache / 快照 / e2e 的承重墙，无参调用必须原样保持。
 * singlePort=true → schema 4 单端口形态：1 个 in0 + address/type/port 参数，端口类型
 * 跟随 type 参数。只有**新建图**（graph.ts buildGraph / Tab 面板）与 schema>=4 的恢复
 * 走这条路。
 *
 * 标签按 inputSeq 发号：第一个仍是 `_input_`（e2e / 桥测试冻结的字面量），之后
 * `_input_2`、`_input_3`…（见上方序号块的论证）。
 */
export function makeInputNode(singlePort = false): CylNode {
  const n = new CylNode(seqLabel("_input_", inputSeq), "input");
  inputSeq += 1;
  // baseLabel 恒为 `_input_`（不含序号）：与 null/transform/geo 同约定——baseLabel 是
  // "这是哪一族节点"，label 才是"这一个叫什么"。改名逻辑与面板都读 baseLabel。
  n.baseLabel = "_input_";
  if (!singlePort) {
    for (let i = 0; i < 4; i++) n.addOutput(`in${i}`, new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
    return n;
  }
  n.addOutput("in0", new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  n.params = addressParams();
  return n;
}
/** _output_ 节点：默认旧 out0..out3；singlePort=true → 单端口 out0 + address/type/port。
 *  标签同 makeInputNode：首个 `_output_`，之后 `_output_2`…（独立序号）。 */
export function makeOutputNode(singlePort = false): CylNode {
  const n = new CylNode(seqLabel("_output_", outputSeq), "output");
  outputSeq += 1;
  n.baseLabel = "_output_";
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
/**
 * geo 类节点（obj 层唯一可创建的 kind）：1 in / 1 out，**可进入**，其子网络是 sop 层。
 *
 * 端口保留是为了让 obj 层之间能连线（照 Houdini 的 obj 层可以有输入输出关系）；
 * v1 这条连线**不参与几何计算**（network.ts 不认识 geo kind，等同死链回退 passthrough），
 * 与 channel 节点的关联线同款语义。
 */
let geoSeq = 1;
export function makeGeoNode(): CylNode {
  const name = `geo${geoSeq}`;
  geoSeq += 1;
  const n = new CylNode(name, "geo");
  n.baseLabel = "geo";
  n.netKind = "obj";
  n.addInput("in0", new ClassicPreset.Input(new ClassicPreset.Socket(GEO)));
  n.addOutput("out0", new ClassicPreset.Output(new ClassicPreset.Socket(GEO)));
  return n;
}

/** 恢复图时推进 geo 序号，避免 undo/redo 或新建时撞名（照 claimDotLabel 的旧做法）。 */
export function claimGeoLabel(label: string): void {
  const m = /^geo(\d+)$/.exec(label);
  if (!m) return;
  const n = parseInt(m[1], 10);
  if (Number.isFinite(n) && geoSeq <= n) geoSeq = n + 1;
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

/** kind → 该 kind 的工厂（Tab 面板可建的五种）；project/channel → null。
 *
 *  `input`/`output` **一律 singlePort=true**：面板建的必须是 schema 4 单端口 + serial 地址
 *  形态。工厂的默认 `false`（旧 4 端口）只服务于冻结测试与旧图恢复，绝不能漏到这里。 */
function paletteFactory(kind: NodeKind): (() => CylNode) | null {
  switch (kind) {
    case "input":
      return () => makeInputNode(true);
    case "output":
      return () => makeOutputNode(true);
    case "null":
      return makeNullNode;
    case "transform":
      return makeTransformNode;
    case "geo":
      return makeGeoNode;
    default:
      return null; // project / channel：只能由 loadProjectGraph 建立
  }
}

/**
 * Tab 面板「新建一个节点」的**决策单源**（v0.1.00120）。
 *
 * 为什么住在 graph-model 而不是 graph-interact：graph-interact 经 NodeView 传递依赖到
 * graph.ts（进而 three / DOM），在 node 环境的 vitest 里根本 import 不进来。把「建哪种、
 * 建成什么形状、撞名怎么办」这段**纯决策**放这里，于是它可被直接单测，而 graph-interact
 * 只剩 editor.addNode + area.translate 的 DOM 侧接线。
 *
 * `taken`：图里已有的标签集合。序号是模块级单调递增的，所以重取一次必然拿到新名字；
 * 循环仍设上界（纯防御：万一将来有人让某个工厂发固定名，这里也不会挂死浏览器）。
 * 不可建的 kind → null（调用方原地返回，不建节点）。
 */
export function makePaletteNode(kind: NodeKind, taken: ReadonlySet<string> = new Set()): CylNode | null {
  const make = paletteFactory(kind);
  if (!make) return null;
  let n = make();
  for (let guard = 0; taken.has(n.label) && guard < 1000; guard += 1) n = make();
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

/**
 * obj/sop 层级图版本（schema 5，v0.1.00119）。
 *
 * **为什么又是一个新常量，而不是把 3 或 4 往上 bump**：`project-graph.test.ts` 里有两条
 * 断言互相夹死同一类图——一条要求「含 project/channel 的图 === PROJECT_GRAPH_SCHEMA」，
 * 另一条对同类图要求字面量 `3`。bump 任何一个都会打破其中一条。语义上这三个数各有其意
 * （3 = 项目图、4 = 单端口 address 形态、5 = 含层级），**别去合并它们**。
 *
 * 只在图内真的用上层级（有 netKind==="obj" 的节点，或有节点带 children）时才输出 5；
 * 否则沿用既有判定链 → v2/v3/v4 的输出**字节不变**。
 */
export const HIER_GRAPH_SCHEMA = 5;

/** 项目根节点：**无端口**（不参与任何连线/几何计算；id = 项目 serial P1-…，标签即项目名）。
 *  x/y 仅作位置提示（loadProjectGraph/restoreGraph 仍以 area.translate 落地视图位置）。
 *
 *  `hip`（v0.1.00119，task #6）：当前绑定的 hip 绝对路径，NodeView 在标题下方以**中段省略**
 *  的小字显示（完整值进 title）。只作显示——项目与 hip 的绑定权威在桥侧 `ProjectRef.hip`，
 *  这里拿到的是那个值的快照，**不参与任何解析**。 */
export function makeProjectNode(id: string, label: string, x = 24, y = 40, hip = ""): CylNode {
  const n = new CylNode(label, "project");
  n.id = id;
  n.pos = { x, y };
  if (hip) n.hip = hip;
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

/** 按数据类型给连线着色（Houdini VOP 惯例：看颜色即知类型）。
 *
 *  geo **不加类**，沿用 CSS 默认线色 = 朱红 `#ff6b6b`（此处原写作"灰白"，是错的，
 *  同 socketTypeClass 那处）；float 加 `cyl-wire-float` = 浅蓝 `#7fb0ff`，
 *  vec3 加 `cyl-wire-vec3` = 深绿 `#2f9e63`。三处必须逐字一致：线色（本函数的类）、
 *  端口色（socketTypeClass 的类）、waypoint 圆点（CSS 兄弟选择器继承线的类）——
 *  **配色单源在 `nodeview.css` 的配色块**，改色只改那里，这里只负责挂类。
 *  （v0.1.00119 纠正：float/vec3 此前在线色与圆点上写反了，而注释里只写颜色名
 *   不写色值，正是它长期没被发现的原因，所以这里把色值写出来。）
 *
 *  与 bypass 视觉同机制（rAF 重试一次）。 */
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
  /** schema 5：所在层级（"sop" 是缺省值，序列化省略）。 */
  netKind?: NetKind;
  /** schema 5：可进入节点的子图（缺省省略）。形状是 buildGraphSnapshot 的输出本身。 */
  children?: unknown;
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

/** 参数是否为「单端口默认值」——address="" / type="geo" / port=""。这类参数**不序列化**，
 *  于是全默认的新 _input_/_output_ 与旧 4 端口节点输出字节一致（无 params 键）。
 *
 *  `port` 必须进这张表，否则新增该参数会让每个 v2/v3/v4/v5 快照凭空多出一个
 *  `{"name":"port",...}`——那是字节级兼容的承重墙（有冻结测试盯着）。
 *  未选端口（"") 与"没有这个参数"在序列化层等价，正是这条规则做到的。 */
function isDefaultAddressParam(p: ParamSpec): boolean {
  if (p.name === "address") return p.value === "" || p.value == null;
  if (p.name === "type") return p.value === GEO || p.value == null;
  if (p.name === PORT_PARAM) return p.value === "" || p.value == null;
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
 * - 图内**用上了层级**（有 obj 层节点或有子图）→ schemaVersion 5（v0.1.00119）；
 * - 图内含任一 project/channel 节点 → schemaVersion 3（channel 字段仅 channel 节点带）；
 * - _input_/_output_ **真的用上了** address / 非 geo type → schemaVersion 4（单端口形态）；
 * - 否则 schemaVersion 2 且**绝不含新字段**（round14-autosave / round16-undo 字节兼容）。
 * address / type 全默认时不输出 params，因此新建图（未填 address）与旧图字节一致。
 * 多个条件同时成立时取**最大**版本号——restoreGraph 的形状判定需要看到最高的那个。
 * netKind / children 同样只在非默认时输出，所以 v2/v3/v4 的字节输出不受本次改动影响。
 */
export function buildGraphSnapshot(
  nodes: GraphNodeSnapshotData[],
  connections: GraphConnectionSnapshotData[],
  viewport: { k: number; x: number; y: number },
): unknown {
  const isProjectGraph = nodes.some((n) => n.kind === "project" || n.kind === "channel");
  let usesAddress = false;
  let usesHierarchy = false;
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
    // v0.1.00119 层级：两个键都只在非默认时出现，所以旧图输出字节不变。
    // netKind 省略 === "sop"（缺省值），children 省略 === 无子图。
    if (n.netKind && n.netKind !== "sop") entry.netKind = n.netKind;
    if (n.children != null) entry.children = n.children;
    if ((n.netKind && n.netKind !== "sop") || n.children != null) usesHierarchy = true;
    return entry;
  });
  // 多条件同时成立取最大版本号：restoreGraph 靠它选重建形状，看到的必须是最高的那个。
  const schemaVersion = usesHierarchy
    ? HIER_GRAPH_SCHEMA
    : usesAddress
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
      // schema 5 层级：缺省 sop / 无子图 → undefined（buildGraphSnapshot 据此省略键）
      netKind: c.netKind,
      children: c.children,
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
    netKind?: unknown; // schema 5：所在层级（仅接受 "obj"/"sop"，其它忽略 → 缺省 sop）
    children?: unknown; // schema 5：子图（原样带回，形状由 buildGraphSnapshot 定义）
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
    case "project":
      n = makeProjectNode(nd.id ?? "", nd.label ?? "project");
      break;
    case "channel":
      n = nd.channel ? makeChannelNode(nd.id ?? "", nd.channel, nd.label ?? nd.channel.serial ?? "channel") : null;
      break;
    case "geo":
      n = makeGeoNode();
      break;
    default:
      return null; // 未知 kind：跳过，不崩
  }
  // schema 5 层级：netKind / children 原样带回，并推进 geo 序号防撞名。
  if (n && n.kind === "geo") claimGeoLabel(nd.label ?? "");
  // v0.1.00120：_input_/_output_ 现在可多建，序号同样要在恢复时推进——否则恢复一张
  // 含 `_input_3` 的图之后新建，会再发一个 `_input_3` 撞名。
  if (n && n.kind === "input") claimInputLabel(nd.label ?? "");
  if (n && n.kind === "output") claimOutputLabel(nd.label ?? "");
  if (n) {
    if (nd.netKind === "obj" || nd.netKind === "sop") n.netKind = nd.netKind;
    if (nd.children != null) n.children = nd.children;
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

/** 校验反序列化 port（选中的端口/通道 key）：仅接受字符串，其余（数字/对象/缺省）→ ""。
 *
 *  与 sanitizeAddress 的返回约定**刻意不同**：这里回 `""` 而不是 undefined，因为
 *  "未选端口"是一个**正常值**（参数必须存在且为空串），而不是"这个字段不存在"。 */
export function sanitizePort(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * 单端口节点的 address/type/port 参数补全：快照的 params 里可能只剩非默认项（序列化剔除了
 * 默认值），这里把缺的补回默认值并让 address 字段与参数一致，最后同步 socket 类型。
 *
 * `port` 走**同一条补全规则**，于是一张 schema-4 老图（那时还没有 port 这个参数）恢复后
 * 也带上 `port=""`——参数面板拿到的形状与新建节点完全一致，无需在 UI 侧写"可能没有这个
 * 参数"的分支。补回来的是默认值，序列化时又被 isDefaultAddressParam 剔掉，所以**往返
 * 字节不变**。
 */
function syncAddressParams(n: CylNode, address: string | undefined, saved?: ParamSpec[]): void {
  const savedAddress = saved?.find((p) => p.name === "address");
  const savedType = saved?.find((p) => p.name === "type");
  const savedPort = saved?.find((p) => p.name === PORT_PARAM);
  const addr = sanitizeAddress(savedAddress?.value) ?? address ?? "";
  const type = toSocketType(savedType?.value);
  const port = sanitizePort(savedPort?.value);
  // 快照里已有的那一项**原样保留**（含有/无 default 键），只补缺的那一项：
  // 于是 serialize -> restore -> serialize 字节稳定（不会凭空长出 default 键）。
  // 顺序固定 address -> type -> port：addressParams() 与本函数必须同序，否则同一张图
  // 经不同路径（新建 / 恢复）得到的 params 顺序不同，序列化就不再字节稳定。
  n.params = [
    savedAddress ? { ...savedAddress, value: addr } : { name: "address", type: "string", value: addr, default: "" },
    savedType ? { ...savedType, value: type } : { name: "type", type: "menu", value: type, default: GEO },
    savedPort ? { ...savedPort, value: port } : { name: PORT_PARAM, type: "menu", value: port, default: "" },
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
  // **只按「有没有真的引用 in1-3 / out1-3」判定**（v0.1.00121 修）。
  //
  // 原先还有一条 `schemaVersion < 4 → 旧形态` 的短路，那是「保存后 reload 变成 4 端口」
  // 的根因：单端口节点在 address/type/port 全默认时，序列化会把这些键**全部剔除**
  // （为了与旧图字节兼容），于是快照降级成 v2；再读回来时这条短路就把它判成旧形态、
  // 按 4 端口重建。用户看到的正是「创建时是 1 个，存盘 reload 后变 4 个」。
  //
  // 端口引用才是形态的**充分且必要**证据：真正的旧 4 端口图必然连过 in1-3/out1-3
  // （只连 in0/out0 的旧图与单端口图在拓扑上完全等价，按单端口重建不丢任何连接）。
  // 因此不再需要看版本号，v2/v3/v4/v5 一视同仁。
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
