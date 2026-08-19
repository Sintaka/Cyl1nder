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
  /**
   * **相对引用表达式**（v0.1.00121，需求 #4/#5/#6）：如 `transform1/tx`、`point_1.x`。
   *
   * 非空时这个参数的值「跟着引用走」——由取值侧按 `param-ref.ts` 解析后拉取并覆盖
   * `value`。为什么存相对而不是解析成绝对：相对引用**唯一的价值**就是锚点移动/改名后
   * 自动跟随（映射系统的 rel 语义），存成绝对等于把它降级成一个会失效的快照。
   *
   * 空/缺省时**不序列化该键**（`isDefaultAddressParam` 一并剔除），所以没用引用的图
   * 与改动前字节一致。绝对形式的引用不走这里，走既有的 P5b `bindings`。
   */
  ref?: string;
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

/** 合法端口类型集合（未知类型一律视为非法，连线被拒）。
 *
 *  **ANY 刻意不在表内**：它不是一种数据类型，而是「还不知道是什么类型」。放进来会让
 *  `socket-type.test.ts` 的完整兼容矩阵（3 类型 × 2 错配 = 6 条）连带 SOCKET_TYPES
 *  的语义一起变形，而那张矩阵测的正是"三种真类型之间怎么互通"。 */
export const SOCKET_TYPES: readonly string[] = [GEO, FLOAT, VEC3];

/**
 * 「类型待定」端口（v0.1.00121，动态端口用）。
 *
 * 为什么必须有这么一个哨兵、而不是继续用空串或直接给 GEO：
 *  - 空串在 `canConnectSockets` 里是**非法**（历史脏数据一律拒绝），拿它当待定会让
 *    动态端口谁都连不上——方向正好反了。
 *  - 给 GEO 则等于「猜」：一个刚建出来的 `null` 若默认 geo，float 源根本连不进来，
 *    类型推导永远没有起点。而 `null` 的类型恰恰应当由**上游**决定。
 *
 * 语义：ANY 与任何合法类型（含 ANY 自身）都可连；一旦某个动态节点被接上，
 * `propagateDynamicTypes` 就把它的全部端口换成推导出的真类型，此后再连线就走
 * 正常的类型校验——**待定只存在于"还没接上"这段时间**。
 * 着色上 ANY 不出类（socketTypeClass 返回 ""），即中性灰白：与「未知类型 = 灰白、
 * geo = 朱红」那条已落地的约定完全一致。
 */
export const ANY = "any";

/** 端口类型是否**可参与连线**：三种真类型 + 待定 ANY。空串/拼错的类型 → false。 */
export function isConnectableSocket(t: unknown): boolean {
  return typeof t === "string" && (SOCKET_TYPES.includes(t) || t === ANY);
}

/**
 * 端口类型所属「族」：几何族 vs 数值族。**类型冲突判定的单源**。
 *
 * 族内互通（float ↔ vec3 有隐式转换语义，见 convertSocketValue），族间永不互通。
 * ANY 不属于任何族（返回 null）——待定的东西谈不上冲突。
 */
export function socketFamily(t: unknown): "geo" | "num" | null {
  if (t === GEO) return "geo";
  if (t === FLOAT || t === VEC3) return "num";
  return null;
}

/**
 * 连线类型校验的**纯谓词**（socket-type.test.ts 直接测它，不驱动 rete 插件）：
 * 仅当「源输出端口类型 === 目标输入端口类型」且该类型合法时允许连线。
 * 空串 / 未知类型（历史脏数据、拼错的 type 参数）→ 拒绝，绝不放行。
 */
export function canConnectSockets(from: string, to: string): boolean {
  if (!isConnectableSocket(from) || !isConnectableSocket(to)) return false;
  // 任一端待定 → 放行（动态端口的类型推导起点；接上之后端口即被换成真类型）。
  // 注意这**不是**放松校验：ANY 只出现在还没被推导过的动态端口上，一旦推导完成
  // 它就不再是 ANY，后续连线照旧走下面的严格规则。
  if (from === ANY || to === ANY) return true;
  if (from === to) return true;
  // 标量/向量之间允许隐式转换（用户要求）：float -> vec3 三分量同值、vec3 -> float 取第一分量。
  // 转换的**数值语义**由 network.ts 落实（convertSocketValue），这里只放行连线。
  // geo 与 float/vec3 之间永远不通：几何不是数值，转换没有意义。
  return (from === FLOAT && to === VEC3) || (from === VEC3 && to === FLOAT);
}

/**
 * 「往一个**槽**里接线」的类型校验 —— 用户要求「null 的几何体端口应该拒绝浮点输入,
 * 毕竟几何体数据不是浮点」的**具名落地点**。
 *
 * 与 `canConnectSockets` 的区别只在**读哪个类型**：这里读的是槽的类型（通道单源），
 * 而不是某一个 socket 的镜像值。于是：
 *  - 槽已定型为 geo → float / vec3 一律拒（几何不是数值，跨族永不互通）；
 *  - 槽已定型为 float/vec3 → geo 一律拒（反向同理）；
 *  - 槽仍待定（ANY）→ 放行，并由第一根线给它定型（推导的起点）。
 *
 * 抽成具名谓词而不是让调用方各自拼 `socketFamily` 比较：这条规则被三处依赖（连线校验、
 * 冲突检出、单测），散写迟早有一处把 `null`（无族）当成"兼容"而放行。
 */
export function canConnectIntoSlot(incoming: string, slotType: string): boolean {
  if (!isConnectableSocket(incoming) || !isConnectableSocket(slotType)) return false;
  if (slotType === ANY || incoming === ANY) return true; // 待定：由第一根线定型
  const a = socketFamily(incoming);
  const b = socketFamily(slotType);
  if (a === null || b === null) return false; // 无族 = 未知，宁拒不放
  return a === b; // 族内互通（float ↔ vec3），跨族（geo ↔ 数值）永不互通
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
  inputKey = "in0",
): number | null {
  if (visited.has(nodeId)) return null;
  visited.add(nodeId);
  const conn = editor.getConnections().find(
    (c) => c.target === nodeId && c.targetInput === inputKey,
  ) as ClassicPreset.Connection<CylNode, CylNode> | undefined;
  if (!conn) return null;
  const src = editor.getNode(conn.source) as CylNode | undefined;
  const out = String(conn.sourceOutput ?? "");
  if (src?.kind === "input") {
    const m = /^in(\d)$/.exec(out);
    return m ? Number(m[1]) : null;
  }
  // null 是 N 条**独立**直通通道：从 `out{k}` 下来就要回到它自己的 `in{k}`，而不是恒回
  // `in0`。恒回 in0 会让"槽 1 的显示焦点"报出槽 0 的来源端口——看着有值、指错通道。
  if (src?.kind === "null") {
    const k = dynamicOutputIndex(out);
    if (k === null) return null;
    return resolveInputSourcePort(editor, src.id, visited, dynamicInputKey(k));
  }
  if (src?.kind === "transform" && out === "out0") {
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
  /**
   * 动态节点（`null`）的**每槽类型单源**（v0.1.00125）。
   *
   * 在此之前"这个节点是什么类型"只存在于每个 rete socket 上，于是同一个节点的
   * in 与 out 各存一份、可以各自漂移——用户批评的「in 和 out 不应该分开看」在存储
   * 层面就是这件事。现在类型只存这里一份，`in{k}` 与 `out{k}` 都只是它的**视图**：
   * `applyDynamicTypes` 写这里再机械镜像到 socket（rete 的连线校验与着色只认 socket，
   * 镜像无法省略），`slotTypesConsistent` 则把「镜像不得漂移」变成可断言的不变式。
   *
   * **为什么是数组而不是一个标量**（v0.1.00125 的核心改动）：用户明确要求
   * 「现在如果我连入一个 float 了, 我是不能连一个 geo 进入同一个 null 的, 优化一下」。
   * 一个标量类型在语义上宣称"整个节点只有一种类型"，于是槽 0 接了 float 就把槽 1 也
   * 一并定死。而 `null` 不是 merge（用户已排除：「merge 在 houdini sop 中更多是对几何体
   * 操作, 先不考虑」），它是 **N 条互不相干的直通通道**——槽 k 的 `out{k}` 只搬运
   * 槽 k 的 `in{k}`。互不相干的通道必须能各自定型，所以类型天然是"每槽一个"。
   *
   * 用**数组按槽序号索引**而不是 `Record<string, string>` 按端口 key：槽序号才是身份
   * （`in2` 与 `out2` 是同一个槽的两个视图），按 key 存又会退回"in/out 各存一份、可以
   * 漂移"的老问题。稀疏/越界一律读作 `ANY`（见 `slotTypeOf`），于是"端口长出来了但还
   * 没推导过"与"这个槽还没定型"是同一件事，不需要额外的初始化步骤。
   *
   * **不序列化**：类型由上游推导而来（propagateDynamicTypes），存进快照只会在下次
   * 加载时与真实上游打脸——与 `projectEmpty` / `hip` 同一条理由。
   */
  slotTypes?: string[];
  /** P2b：仅 kind==="channel" 使用——成员通道引用（tag/hda 的 serial 即节点 id）。
   *  project/channel 都不参与几何计算，关联线 v1 纯视觉。 */
  channel?: ChannelRef | null;
  /** P5b 通道引用绑定：paramName -> 通道 absolutePath（如 tx -> "/obj/geo1/transform1/tx"）。
   *  空/缺省时不序列化该键（旧图字节级兼容）。 */
  bindings?: Record<string, string>;
  /** 该节点活在哪一层（v0.1.00119）。缺省 `"sop"` —— 旧图无此字段，行为与改造前一致。 */
  netKind?: NetKind;
  /** 仅 kind==="project"：项目里除根节点外**什么都没有**（v0.1.00122）。
   *  NodeView 据此画一行「建 geo → 双击进入 → 建 input/output」的提示。
   *  **不序列化**：它是根据当前图算出来的瞬时事实，存下来只会在下次加载时说谎。 */
  projectEmpty?: boolean;
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
 * - `type`：端口数据类型，**派生值，用户不可编辑**（v0.1.00121，用户要求 #2：
 *   「in/out 的 type 应该直接根据所选端口的类型生成，不用用户再手动指定一遍」）。
 *   它仍然是一个 ParamSpec（见下方 TYPE_PARAM 处的完整论证：存储位置不变才能保住
 *   序列化字节兼容与 syncPortSocketType 那条通路），但值只由 derivePortType 从
 *   capabilities/映射表算出来并覆盖写入；面板据 isDerivedParam 把它渲染成只读。
 */
function addressParams(): ParamSpec[] {
  return [
    { name: "address", type: "string", value: "", default: "" },
    { name: TYPE_PARAM, type: "menu", value: GEO, default: GEO },
    { name: PORT_PARAM, type: "menu", value: "", default: "" },
  ];
}

/**
 * 端口类型参数名。与 PORT_PARAM 同理抽成常量（跨写集契约，三处必须逐字一致）。
 *
 * **`type` 为什么仍然是一个可写字段、而不是改成 getter 或干脆删掉**（用户明确问了）：
 *  1. **序列化承重墙**：`isDefaultAddressParam` 靠"值 === geo 就剔除"来保住 v2/v3/v4/v5
 *     快照的字节兼容（有冻结测试盯着）。改成 getter 就没有"值"可剔，那批测试全断。
 *  2. **它已经是 socket 类型的单源**：`syncPortSocketType` 读的就是它。删掉就得另开
 *     一条通路，于是"端口显示的类型"和"序列化里的类型"有机会互相打脸 —— 这正是
 *     映射系统当初要修的病。
 *  3. **只读是"谁能写"的约束，不是"存在哪"的约束**：数据层保证它只被 derivePortType
 *     的结果覆盖（graph.ts 的 setNodeParams 里落实），面板据 isDerivedParam 渲染成
 *     禁用控件。用户改不动它，而机器仍能把推导结果写进去。
 * 所以：**仍可写（对机器），已只读（对用户）**。
 */
export const TYPE_PARAM = "type";

/**
 * 该参数是否为**派生只读**参数（面板据此渲染禁用控件，不接受用户编辑）。
 *
 * 目前只有单端口 `_input_`/`_output_` 的 `type`。旧 4 端口节点没有 params，
 * 走不到这里；其它 kind 的同名参数（若将来有）不受影响 —— 判据带 kind 就是为了
 * 不让"叫 type 的参数一律只读"这种过宽规则溜进来。
 */
export function isDerivedParam(kind: NodeKind, name: string): boolean {
  return (kind === "input" || kind === "output") && name === TYPE_PARAM;
}

/** `_input_` 从 serial **读**（inputs 侧），`_output_` 往它**写**（outputs 侧）；
 *  其它 kind → null（它们没有 port 参数，不该去查能力）。与 param.ts 的 portSideOf
 *  同一条规则，但这里是数据层的那一份（面板侧那份服务于 DOM 渲染）。 */
export function portSideOfKind(kind: NodeKind): "inputs" | "outputs" | null {
  if (kind === "input") return "inputs";
  if (kind === "output") return "outputs";
  return null;
}

/**
 * 从「所选端口 + 地址」**派生**端口类型 —— 用户要求 #2 的落地点（纯函数）。
 *
 * 解析顺序（两级，缺一不可）：
 *  1. **capabilities**：`portType(serial, side, portKey)` —— 桥对该 serial 的权威答复，
 *     也是用户在下拉里**看见的**那个类型（`tx: float`）。选了端口就该拿这一个。
 *  2. **映射表**：`addressType(address)` —— 端口还没选（`port` 为空）时的回退。
 *
 * 返回 `null` = **还不知道**（未缓存 / 表里没有 / 桥说空）。调用方必须**保持当前
 * 类型不变**，绝不回落 geo：静默补类型会让连线校验放行错配的线（mapping-types.ts
 * 的三态诚实注释讲的是同一件事）。解析器以参数注入，是为了让数据层不 import
 * serial-capabilities/mapping-types —— 那两个模块带缓存与网络，进不了纯单测。
 */
export function derivePortType(
  n: CylNode,
  resolve: {
    portType: (serial: string, side: "inputs" | "outputs", key: string) => string | null;
    addressType: (address: string) => string | null;
  },
): string | null {
  const side = portSideOfKind(n.kind);
  if (!side) return null;
  const address = typeof readParam(n, "address") === "string" ? String(readParam(n, "address")) : "";
  const port = sanitizePort(readParam(n, PORT_PARAM));
  if (address !== "" && port !== "") {
    const t = resolve.portType(address, side, port);
    if (t !== null && SOCKET_TYPES.includes(t)) return t;
  }
  if (address !== "") {
    const t = resolve.addressType(address);
    if (t !== null && SOCKET_TYPES.includes(t)) return t;
  }
  return null;
}

/**
 * 把派生出的类型写回 `type` 参数并同步 socket；返回是否有变化。
 * `null`（还不知道）→ **什么都不做**（保持当前类型，见 derivePortType 的论证）。
 */
export function applyDerivedPortType(n: CylNode, derived: string | null): boolean {
  if (derived === null) return false;
  const tp = n.params?.find((p) => p.name === TYPE_PARAM);
  if (!tp || tp.value === derived) return false;
  tp.value = derived;
  return true;
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

// ---------------------------------------------------------------------------
// 动态输入端口（v0.1.00121）：照 Houdini Merge SOP —— 永远多留**一个**空端口
//
// 用户要求端口数量不再写死，而是「接满了就长一个新的，拆掉就收回去」。这里把它拆成
// 两个**纯函数** + 一个落地函数，于是 grow/shrink 规则可以完全无 DOM 单测：
//   planDynamicInputs  ——「现在应该有哪些 key」（纯计算）
//   syncDynamicInputs  ——「把节点改成那样」（唯一改 rete 端口的地方）
//
// 规则（三条，每条都有非它不可的理由）：
//  1. **端口数 = 最大已接序号 + 2**（即"最后一个已接"之后正好一个空位）；一根线都
//     没接 → 只有 `in0` 一个空位。于是"永远有且只有一个可接的空端口"。
//  2. **中间的空洞必须保留**：若 in0 与 in2 已接、in1 空着，仍保留 in1。因为 key 是
//     连接的身份（`targetInput`），删掉 in1 会迫使 in2 改名 → 那根线要么断、要么指向
//     一个不存在的 key。宁可留个洞，绝不动已接的线。
//  3. **只缩到那个空位为止**：拆线之后多出来的尾部空端口被回收，但永远留一个。
//
// 为什么不做成"每种 kind 各自的端口表"：动态与否是**一个维度**（hasDynamicInputs），
// 与 kind 是什么正交。目前只有 `null` 是动态的（它就是 Cyl1nder 的 merge）；
// transform/geo 语义上是一进一出，_output_ 是单端口 + 地址，都不该长端口。
// ---------------------------------------------------------------------------

/** 动态输入端口的 key 前缀（`in0`/`in1`…）。与 _input_ 的输出端口同名不同侧，互不干扰。 */
const DYN_IN = "in";

/** 该 kind 的输入端口是否**动态增减**。目前仅 `null`（Cyl1nder 的 merge 节点）。 */
export function hasDynamicInputs(kind: NodeKind): boolean {
  return kind === "null";
}

/** 序号 → 动态输入 key。 */
export function dynamicInputKey(i: number): string {
  return `${DYN_IN}${i}`;
}

// ---------------------------------------------------------------------------
// 端口槽（PortSlot）：**in 与 out 是同一个对象的两个视图**（v0.1.00122）
//
// 用户的批评（逐字）：「null 不应该以 in 和 out 分开看, 更不应该把那个 in 端的灵活端口
// 看作一个可修改参数(还没接东西呢没数据进来), in 和 out 应该是同一个对象」。
//
// 改造前的模型确实是"分开看"的：`ref_in0` 与 `ref_out0` 是**两个**参数，类型也是每个
// socket 各存一份。于是同一条数据通道在存储上有 2~N 份互相独立的副本，谁都可以单独被
// 改坏——而它们描述的本来就是同一件事。
//
// 现在的模型只有一个东西：**槽**。一个槽 = 一条数据通道，拥有
//   - 一个类型（存 `CylNode.slotTypes[k]`，socket 只是镜像）
//   - 一个引用表达式（存**一个** `ref_slot{k}` 参数，没有 in/out 之分）
//   - 两个**视图**：输入侧 `in{k}`、输出侧 `out{k}`（`slotPortViews`）
// `slotIndexOfPort` 把任一侧的 key 映射回同一个槽序号，所以「从 in 侧读」与「从 out 侧
// 读」必然得到同一个对象——这不是靠两处同步维持的，而是只有一处可存。
//
// **输出侧每槽一个 `out{k}`**（v0.1.00125）。上一版把所有槽的输出视图并到 `out0`，
// 理由是当时 `network.ts` 对 `null` 一律 `findFeeder(snap, node.id, "in0")`、完全无视
// sourceOutput，多长的 out{k} 会被静默当成 out0 的数据（"看着对、算出来错"）。
// 那个前提已经没了：`network.ts` 现在有 `slotFeederFor(snap, node, sourceOutput)`，
// `out{k}` → `in{k}`，且该槽未接线时返回 undefined（**绝不借别的槽的数据充数**）。
// 于是每槽一个输出端口才是可寻址的、算得对的形态——`null` 是 N 条独立直通通道，
// 不是 merge（用户已排除 merge 语义）。
//
// **槽 0 的输出键仍逐字是 `out0`**：端口 key 就是连接身份（`sourceOutput`），既有图、
// 冻结快照、13 个 e2e spec 与 network/dataflow/chain-cache 三批单测全都写着 `out0`。
// 新增的只有 `out1`、`out2`…，一个既有键都没有改名。
// ---------------------------------------------------------------------------

/** 槽引用参数名前缀。**保留 `ref_` 前缀**：`isDefaultRefParam` 与旧快照的默认值剔除
 *  规则都按前缀判定，换前缀会让历史 `ref_in*` 参数不再被剔除，v2 图凭空长出 params。 */
export const REF_PARAM_PREFIX = "ref_";

/** 槽序号 → 该槽的引用参数名（`ref_slot0`）。**无 in/out 之分**：一个槽一个引用。 */
export function slotRefParamName(slot: number): string {
  return `${REF_PARAM_PREFIX}slot${slot}`;
}

/** 旧的按端口命名（`ref_in0` / `ref_out0`）——**仅供读取旧快照做迁移**。
 *  新代码一律用 slotRefParamName；保留导出是为了让迁移规则可被单测直接钉住。 */
export function legacyRefParamName(portKey: string): string {
  return `${REF_PARAM_PREFIX}${portKey}`;
}

/** 一个槽的完整模型（纯数据；不含 rete 对象）。 */
export interface PortSlot {
  /** 槽序号（= 输入视图的序号）。 */
  index: number;
  /** 输入侧视图 key（`in{index}`）。 */
  inputKey: string;
  /** 输出侧视图 key（`out{index}`）——每槽一个独立输出（见上方论证）。 */
  outputKey: string;
  /** **该槽**的数据类型（未推导出 → ANY）。同槽的 in/out 两侧读到的必然是这一个值；
   *  **不同槽互不影响**（槽 0 是 geo 不妨碍槽 1 是 float，这正是本次改动）。 */
  type: string;
  /** 该槽是否已被接线（决定它有没有引用参数——见 slotRefScope）。 */
  wired: boolean;
  /** 该槽的引用表达式（未接线的槽恒为 ""，因为它连参数都不存在）。 */
  ref: string;
}

/**
 * **引用参数的作用域规则**（用户批评的第二半）：
 * 「更不应该把那个 in 端的灵活端口看作一个可修改参数(还没接东西呢没数据进来)」。
 *
 * 规则：**只有已接线的槽才有引用参数**。尾部那个 spare（永远空着、等下一根线的那个）
 * 一律**没有**参数。理由正是用户说的那句：引用是"用这个地址的值**覆盖**流进来的值"，
 * 而没接线的槽根本没有值可覆盖——给它一个可填的框，等于请用户去配置一条不存在的数据流。
 *
 * 推论（刻意的）：一个**全新、未接线**的 null 的 `params` 是 `undefined`，参数面板里
 * 引用区是空的。这与 v0.1.00121 那轮「面板里啥都没有」的 bug **形状相同但语义相反**：
 * 那时是接了线也没有参数（漏了生成），现在是没接线才没有参数（接上就有）。
 */
export function slotRefScope(slot: PortSlot): boolean {
  return slot.wired;
}

/**
 * 按**已接线的槽**重建 null 节点的引用参数列表；返回是否有变化。
 *
 * 一个槽**一个**参数（`ref_slot0`），不再是 in/out 各一个——这是"in 与 out 是同一个
 * 对象"在参数层的落地：改一次就改了整条通道，不存在"in 侧填了 out 侧没填"的状态。
 *
 * **保留已有值**：接线增减时不能把用户填过的引用擦掉，按参数名从旧列表里捞回来。
 * 旧快照的 `ref_in{k}` 也在这里被认领（`legacyRefParamName`），于是老图里填过的引用
 * 迁移到新命名而不是被静默丢弃。
 *
 * 空值参数序列化时由 `isDefaultRefParam` 剔除，磁盘上的 v2 快照仍不带 params 键。
 *
 * `wiredKeys` 缺省 `[]` = **一根线都没接**（于是参数全清）。这个缺省是刻意的：接线信息
 * 只能来自连接表，节点自己回答不了；把"没告诉我"当成"没接线"，最坏结果是参数被清空后
 * 由下一次 syncDynamicInputs 按真实连接补回，而反过来（当成"都接着"）会给不存在的数据流
 * 留下一堆可填的框——正是用户批评的那件事。
 */
export function syncRefParams(n: CylNode, wiredKeys: readonly string[] = []): boolean {
  if (!hasDynamicInputs(n.kind)) return false;
  const prev = new Map((n.params ?? []).map((p) => [p.name, p]));
  const next: ParamSpec[] = [];
  for (const slot of nodeSlots(n, wiredKeys)) {
    if (!slotRefScope(slot)) continue;
    const name = slotRefParamName(slot.index);
    // 迁移：新名没有就认领旧的按端口命名（in 侧优先——它才是"数据流进来的那一侧"）
    const legacy = prev.get(legacyRefParamName(slot.inputKey)) ?? prev.get(legacyRefParamName(slot.outputKey));
    const kept = prev.get(name) ?? (legacy ? { ...legacy, name } : undefined);
    next.push(kept ?? { name, type: "string", value: "", default: "" });
  }
  const cur = n.params ?? [];
  const same =
    cur.length === next.length && cur.every((p, i) => p.name === next[i]?.name && p.value === next[i]?.value);
  if (same) return false;
  // 一个都不剩 → 删键而不是留空数组：`params: []` 与"没有参数"在面板/序列化里都该等价，
  // 留个空数组只会让下游多写一处 `length === 0` 分支。
  if (next.length === 0) delete n.params;
  else n.params = next;
  return true;
}

/**
 * 节点的槽列表（**纯模型视图**：无 rete 副作用，可直接单测）。
 *
 * 槽数 = 输入端口数（`planDynamicInputs` 已保证"已接线的最大序号 + 1 个 spare"）。
 * 每个槽的 `type` 读的是**该槽自己**的 `slotTypes[index]`——同一个槽的 in/out 只有一处
 * 可读（这就是"in/out 是同一个对象"），而不同槽各读各的（这就是"槽之间互不影响"）。
 */
export function nodeSlots(n: CylNode, wiredKeys: readonly string[] = []): PortSlot[] {
  if (!hasDynamicInputs(n.kind)) return [];
  const wired = new Set(wiredKeys.filter((k) => dynamicInputIndex(k) !== null));
  return Object.keys(n.inputs)
    .map((k) => dynamicInputIndex(k))
    .filter((i): i is number => i !== null)
    .sort((a, b) => a - b)
    .map((index) => {
      const inputKey = dynamicInputKey(index);
      const isWired = wired.has(inputKey);
      const refParam = n.params?.find((p) => p.name === slotRefParamName(index));
      return {
        index,
        inputKey,
        outputKey: dynamicOutputKey(index),
        type: slotTypeOf(n, index),
        wired: isWired,
        ref: isWired && typeof refParam?.value === "string" ? refParam.value : "",
      };
    });
}

/** 任一侧的端口 key → 槽序号。**in{k} 与 out{k} 归一到同一个槽**。
 *  不属于本节点端口体系的 key（端口不存在 / 形状不对）→ null。 */
export function slotIndexOfPort(n: CylNode, key: string): number | null {
  if (!hasDynamicInputs(n.kind)) return null;
  const asInput = dynamicInputIndex(key);
  if (asInput !== null && n.inputs[key]) return asInput;
  const asOutput = dynamicOutputIndex(key);
  if (asOutput !== null && n.outputs[key]) return asOutput;
  return null;
}

/** 一个槽的全部端口视图（输入侧 + 输出侧）：`["in{k}", "out{k}"]`。
 *  每槽一进一出——槽 k 的 `out{k}` 只搬运槽 k 的 `in{k}`（见本节顶部论证）。 */
export function slotPortViews(slot: PortSlot): string[] {
  return [slot.inputKey, slot.outputKey];
}

/**
 * **某一个槽**的类型（单源）：未推导 / 越界 / 脏值 → ANY。socket 上的值只是镜像。
 *
 * 越界读成 ANY 而不是抛：端口可能刚长出来、`slotTypes` 还没被 `applyDynamicTypes`
 * 填到那一格。"还没定型"与"这个槽是 ANY"本来就是同一件事，于是不需要初始化步骤。
 */
export function slotTypeOf(n: CylNode, index: number): string {
  const t = n.slotTypes?.[index];
  return isConnectableSocket(t) ? (t as string) : ANY;
}

/**
 * 不变式：**每个 socket 的类型都等于它所属槽的类型**（镜像没有漂移）。
 *
 * 存一份、镜像 N 份是被 rete 逼出来的（连线校验与着色只认 socket），但"存的那份"与
 * "镜像"一旦不等，就又回到了 in/out 各存一份的老问题。所以把它写成可断言的谓词，
 * 由单测在每条改类型的路径后面钉一次。逐槽比对（不是"全端口同一个值"）——那正是
 * 本次改动：槽 0 与槽 1 允许不同类型，只有**同槽的 in/out** 必须相等。
 */
export function slotTypesConsistent(n: CylNode): boolean {
  if (!hasDynamicInputs(n.kind)) return true;
  for (const [key, port] of Object.entries(n.inputs)) {
    const i = dynamicInputIndex(key);
    if (i === null) continue;
    if (port?.socket.name !== slotTypeOf(n, i)) return false;
  }
  for (const [key, port] of Object.entries(n.outputs)) {
    const i = dynamicOutputIndex(key);
    if (i === null) continue;
    if (port?.socket.name !== slotTypeOf(n, i)) return false;
  }
  return true;
}

/** 动态输入 key → 序号；非该形状（`out0`、`inx`、`in-1`…）→ null。 */
export function dynamicInputIndex(key: string): number | null {
  const m = /^in(\d+)$/.exec(key);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/** 动态输出端口的 key 前缀。与 `_output_` 的输入端口同名不同侧，互不干扰
 *  （`socketNameOf` 按 side 取端口表，`slotIndexOfPort` 按端口是否存在判定）。 */
const DYN_OUT = "out";

/** 槽序号 → 动态输出 key。**槽 0 恒为 `out0`**（既有连接身份，一个字节都不能改）。 */
export function dynamicOutputKey(i: number): string {
  return `${DYN_OUT}${i}`;
}

/** 动态输出 key → 序号；非该形状（`in0`、`outx`、`out-1`…）→ null。 */
export function dynamicOutputIndex(key: string): number | null {
  const m = /^out(\d+)$/.exec(key);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * 「这个动态节点现在应该有哪些输入 key」——**纯函数**（grow/shrink 规则单源）。
 *
 * `wiredKeys`：当前真的有线接着的输入 key（顺序无关，非 `in\d+` 的一律忽略）。
 * 返回 `in0..inN` 的连续列表，N = 最大已接序号 + 1；无已接 → `["in0"]`。
 * 连续输出（含空洞）是刻意的：见上方规则 2。
 */
export function planDynamicInputs(wiredKeys: readonly string[]): string[] {
  const count = planDynamicSlotCount(wiredKeys, []);
  return Array.from({ length: count }, (_, i) => dynamicInputKey(i));
}

/**
 * 槽数（in/out 两侧共用的**唯一**计数）——grow/shrink 规则的真正单源。
 *
 * = max(最大已接**输入**序号, 最大已接**输出**序号) + 2，即"最后一个用到的槽之后正好
 * 一个空位"；两侧都没接 → 1。
 *
 * **为什么输出侧也要参与计数**：端口 key 就是连接身份。若只按输入侧算，一个"下游接了
 * `out2`、上游却把 `in2` 拆了"的图会把 `out2` 收掉，那根下游线立刻指向一个不存在的
 * key（数据里在、画面上没有）——正是 restoreGraph 那处注释警告的形态。让两侧取 max
 * 之后，任何**已接线的** key 都不可能被回收，与"中间空洞必须保留"是同一条铁律。
 */
export function planDynamicSlotCount(
  wiredInputs: readonly string[],
  wiredOutputs: readonly string[],
): number {
  let max = -1;
  for (const k of wiredInputs) {
    const i = dynamicInputIndex(k);
    if (i !== null && i > max) max = i;
  }
  for (const k of wiredOutputs) {
    const i = dynamicOutputIndex(k);
    if (i !== null && i > max) max = i;
  }
  return max + 2;
}

/** 「现在应该有哪些输出 key」——`out0..outN`，与输入侧**逐槽一一对应**（同一个计数）。
 *  槽 0 恒为 `out0`，所以既有图/测试/e2e 引用的那个 key 逐字不变。 */
export function planDynamicOutputs(
  wiredInputs: readonly string[],
  wiredOutputs: readonly string[] = [],
): string[] {
  const count = planDynamicSlotCount(wiredInputs, wiredOutputs);
  return Array.from({ length: count }, (_, i) => dynamicOutputKey(i));
}

/**
 * 把节点的端口改成计划的结果（**两侧同时**：`in{k}` 与 `out{k}` 逐槽成对）；
 * 返回是否真的增删过端口。
 *
 * `wiredOutputKeys`：下游已经接走的输出 key。参与槽数计数，于是拆上游不会收掉
 * 一个**下游还接着**的 `out{k}`（见 planDynamicSlotCount 的论证）。
 *
 * 新端口一律建成 **ANY**（待定）：类型是**每槽**的属性，只有真的接上线的槽才有类型，
 * 而新长出来的端口按定义还没接线。**已存在的端口也不在这里换类型**——那是
 * `applyDynamicTypes` 的职责，两件事分开才不会"加个端口顺手把别人的类型改了"。
 * 非动态 kind → 直接 false（旧 4 端口图、transform、geo 一个字节都不动）。
 */
export function syncDynamicInputs(
  n: CylNode,
  wiredKeys: readonly string[],
  wiredOutputKeys: readonly string[] = [],
): boolean {
  if (!hasDynamicInputs(n.kind)) return false;
  // 两侧从**同一个**槽数派生：槽是一进一出的，端口数瘸腿就意味着某个槽只有半边视图，
  // 而 `slotPortViews` 承诺每个槽都有 in{k} 与 out{k}。
  const count = planDynamicSlotCount(wiredKeys, wiredOutputKeys);
  const wantIn = Array.from({ length: count }, (_, i) => dynamicInputKey(i));
  const wantOut = Array.from({ length: count }, (_, i) => dynamicOutputKey(i));
  const wantInSet = new Set(wantIn);
  const wantOutSet = new Set(wantOut);
  let changed = false;
  for (const key of Object.keys(n.inputs)) {
    // 非 `in\d+` 的输入端口不属于本规则管辖 → 留着（防御：将来若有别的输入端口）
    if (dynamicInputIndex(key) === null) continue;
    if (wantInSet.has(key)) continue;
    n.removeInput(key);
    changed = true;
  }
  for (const key of Object.keys(n.outputs)) {
    if (dynamicOutputIndex(key) === null) continue;
    if (wantOutSet.has(key)) continue;
    n.removeOutput(key);
    changed = true;
  }
  for (const key of wantIn) {
    if (n.inputs[key]) continue;
    n.addInput(key, new ClassicPreset.Input(new ClassicPreset.Socket(ANY)));
    changed = true;
  }
  for (const key of wantOut) {
    if (n.outputs[key]) continue;
    n.addOutput(key, new ClassicPreset.Output(new ClassicPreset.Socket(ANY)));
    changed = true;
  }
  // 端口变了就同步引用参数：**已接线的槽**要有地方填引用，消失/未接线的槽不该留下
  // 孤儿参数。放在这里而不是让调用方各自记得调——槽与参数必须同生同灭，分开就会漂移。
  // 传 wiredKeys 是关键：作用域规则（slotRefScope）判的就是"这个槽接了没有"。
  if (syncRefParams(n, wiredKeys)) changed = true;
  return changed;
}

/**
 * 一张图里每个动态节点的已接输入 key（`syncDynamicInputsFromConnections` 与
 * restoreGraph 的预建端口共用这一处采集，避免两处口径不同）。
 */
export function wiredInputKeysByNode(
  connections: ReadonlyArray<{ target: string; targetInput: string }>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const c of connections) {
    if (!c?.target || typeof c.targetInput !== "string") continue;
    const list = map.get(c.target);
    if (list) list.push(c.targetInput);
    else map.set(c.target, [c.targetInput]);
  }
  return map;
}

/** 同上，**输出侧**：nodeId -> 被下游接走的 sourceOutput key。
 *  端口回收要看它，否则会收掉一个下游还接着的 `out{k}`（连接身份被打断）。 */
export function wiredOutputKeysByNode(
  connections: ReadonlyArray<{ source: string; sourceOutput: string }>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const c of connections) {
    if (!c?.source || typeof c.sourceOutput !== "string") continue;
    const list = map.get(c.source);
    if (list) list.push(c.sourceOutput);
    else map.set(c.source, [c.sourceOutput]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 动态节点的类型推导（v0.1.00121）：类型**从上游流下来**，用户不再手填
//
// 用户要求（#2 的另一半）：端口类型应当由所选参数/上游决定，不该让人再指定一遍。
// 对 `_input_`/`_output_` 是"由 capabilities 决定"（见 derivePortType）；对 `null`
// 这种动态节点则是"由**接进这个槽的那根线**决定"（v0.1.00125 起**逐槽独立**）：
//   1. 未接线的槽 → ANY（待定，灰白，谁都能接）；
//   2. 槽 k 接上线 → **只有**槽 k 的 `in{k}` 与 `out{k}` 换成源类型，其余槽不动；
//   3. 于是同一个 null 上，槽 0 可以是 geo、槽 1 可以是 float —— 这正是用户要的
//      「连入一个 float 了, 也要能连一个 geo 进入同一个 null」；
//   4. 而**同一个槽**内仍然严格：槽 0 已是 geo，float 就接不进 `in0`
//      （`canConnectIntoSlot` 跨族永不互通 = 用户的「几何体端口应该拒绝浮点输入」）；
//   5. 冲突被**挡在连线之前**而不是先接上再删：删线是破坏性操作，"连不上"才是用户
//      能立刻理解的反馈（Houdini 也是连不上）。
//   6. 例外：float ↔ vec3 同族，允许接（隐式转换是既有语义）。
//
// 恢复旧图 / undo 重放这两条路会**绕过**连线插件的校验（直接 editor.addConnection），
// 所以再补一道**只报不删**的冲突检出（findPortTypeConflicts → 节点红角标）。
// ---------------------------------------------------------------------------

/** propagateDynamicTypes 的入参形状：结构化接收（同 findDuplicateOutputPorts 的理由）。 */
export interface TypedConnectionLike {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

/**
 * **每槽**应当是什么类型 —— 返回按槽序号索引的数组（v0.1.00125 的推导核心）。
 *
 * 槽 k 的类型 = 接进 `in{k}` 的那根线的源端口类型；该槽没接线（或源类型还待定）→ ANY。
 * **绝不跨槽借类型**：槽 1 空着就是 ANY，不会因为槽 0 是 float 而被一并定死——那正是
 * 用户批评的行为（「连了 float 就不能再连 geo」）。
 *
 * 同一个 `in{k}` 被多源喂时（非法拓扑，`findMultiSourceErrors` 另有报错）按**源节点 id
 * 升序**取第一个：结果与连线创建顺序无关，同一张图无论怎么重放都推出同一套类型。
 *
 * 长度取"已接槽的最大序号 + 1"，其余（含尾部 spare）由 `slotTypeOf` 读成 ANY —— 不需要
 * 把 ANY 显式填进数组，"没有这一格"与"这一格是 ANY"本来就该等价。
 */
export function resolveSlotTypes(
  n: CylNode,
  connections: ReadonlyArray<TypedConnectionLike>,
  socketTypeOf: (nodeId: string, key: string) => string,
): string[] {
  const types: string[] = [];
  const incoming = connections
    .filter((c) => c.target === n.id && dynamicInputIndex(c.targetInput) !== null)
    .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  for (const c of incoming) {
    const k = dynamicInputIndex(c.targetInput) as number;
    if (types[k] !== undefined && types[k] !== ANY) continue; // 已定型：先到者赢（稳定）
    const t = socketTypeOf(c.source, c.sourceOutput);
    types[k] = t !== "" && t !== ANY && isConnectableSocket(t) ? t : ANY;
  }
  for (let i = 0; i < types.length; i += 1) if (types[i] === undefined) types[i] = ANY;
  return types;
}

/**
 * 把**每槽**推导出的类型落到该槽的两个视图（`in{k}` / `out{k}`）；返回是否有变化。
 *
 * `slotTypes` 里没有的槽（含尾部 spare）落 ANY：一个没接线的槽**必须**留在待定，
 * 否则它就会替下一根线预先做决定 —— 那正是改造前"连了 float 就不能再连 geo"的根因。
 * `out{k}` 同步换：下游据此继续推导（float 经过一串 null 的槽 k 仍是 float）。
 */
export function applyDynamicTypes(n: CylNode, slotTypes: readonly string[]): boolean {
  if (!hasDynamicInputs(n.kind)) return false;
  let changed = false;
  // 先写**单源**（每槽类型），再机械镜像到 socket。顺序重要：socket 是视图，
  // 视图不该比它的来源更新。镜像不可省略——rete 的连线校验与着色只认 socket。
  const want = Object.keys(n.inputs)
    .map((k) => dynamicInputIndex(k))
    .filter((i): i is number => i !== null);
  const next: string[] = [];
  for (const i of want) {
    const t = slotTypes[i];
    next[i] = isConnectableSocket(t) ? (t as string) : ANY;
  }
  for (let i = 0; i < next.length; i += 1) if (next[i] === undefined) next[i] = ANY;
  if ((n.slotTypes ?? []).join("\u0000") !== next.join("\u0000")) {
    n.slotTypes = next;
    changed = true;
  }
  for (const [key, port] of Object.entries(n.inputs)) {
    const i = dynamicInputIndex(key);
    if (i === null || !port) continue;
    const t = slotTypeOf(n, i);
    if (port.socket.name === t) continue;
    port.socket = new ClassicPreset.Socket(t);
    changed = true;
  }
  for (const [key, port] of Object.entries(n.outputs)) {
    const i = dynamicOutputIndex(key);
    if (i === null || !port) continue;
    const t = slotTypeOf(n, i);
    if (port.socket.name === t) continue;
    port.socket = new ClassicPreset.Socket(t);
    changed = true;
  }
  return changed;
}

/**
 * 全图类型推导 + 端口增减，**迭代到不动点**；返回被改动过的节点 id 集合。
 *
 * 为什么要迭代而不是一遍扫完：类型沿链**传递**（float → null1 → null2 → …），一遍
 * 只能推进一层。上界 = 节点数 + 1（链最长就这么长），既保证收敛也不可能挂死；
 * 到界仍在变（理论上只可能是环，而环在 connectioncreate 处已被挡）→ 就此停手，
 * 不抛异常：一张图的显示逻辑不该因为拓扑怪异而整页崩掉。
 */
export function propagateDynamicTypes(editor: NodeEditor<Schemes>): Set<string> {
  const touched = new Set<string>();
  const nodes = (editor.getNodes() as CylNode[]).filter((n) => hasDynamicInputs(n.kind));
  if (nodes.length === 0) return touched;
  const socketTypeOf = (nodeId: string, key: string): string => socketNameOf(editor, nodeId, "output", key);
  for (let round = 0; round <= nodes.length; round += 1) {
    let dirty = false;
    const connections = editor.getConnections() as TypedConnectionLike[];
    const wiredIn = wiredInputKeysByNode(connections);
    const wiredOut = wiredOutputKeysByNode(connections);
    for (const n of nodes) {
      // 顺序刻意：先补/收端口（两侧成对，新端口一律 ANY），再逐槽压类型。
      // 分开是必须的：端口存在与否是拓扑事实，类型是每槽的推导结果，混在一起就会
      // 出现"加个端口顺手把别人的槽定型了"。
      if (syncDynamicInputs(n, wiredIn.get(n.id) ?? [], wiredOut.get(n.id) ?? [])) dirty = true;
      if (applyDynamicTypes(n, resolveSlotTypes(n, connections, socketTypeOf))) dirty = true;
      if (dirty) touched.add(n.id);
    }
    if (!dirty) break;
  }
  return touched;
}

/**
 * 一条「**同一个槽**被两种不同族类型同时喂」的冲突（v0.1.00121，v0.1.00125 收窄到槽）。
 *
 * 只报**跨族**（geo vs float/vec3）：float ↔ vec3 有既有隐式转换语义，不是冲突。
 * **不同槽之间不是冲突**（槽 0 是 geo、槽 1 是 float 完全合法，那是本次特性）——
 * 冲突只可能出现在一个 `in{k}` 被多源喂的非法拓扑里（`findMultiSourceErrors` 另报）。
 */
export interface PortTypeConflict {
  nodeId: string;
  /** 该**槽**已定型的类型（该槽第一根线定的那个）。 */
  nodeType: string;
  /** 与之冲突的输入端口 key。 */
  port: string;
  /** 那个端口上游给的类型。 */
  incomingType: string;
  message: string;
}

/**
 * 检出跨族类型冲突 —— **纯谓词，只报不删**。
 *
 * 正常拖拽路径下它永远查不到东西（连线插件已挡）；它守的是**绕过校验**的那两条路：
 * 恢复旧图与 undo 重放都直接 `editor.addConnection`。查到 = 图里真有一根语义上不该
 * 存在的线，报红角标让用户自己拆 —— 悄悄删掉别人存盘里的线是更坏的选择。
 */
export function findPortTypeConflicts(
  editor: NodeEditor<Schemes>,
): PortTypeConflict[] {
  const out: PortTypeConflict[] = [];
  const connections = editor.getConnections() as TypedConnectionLike[];
  const socketTypeOf = (nodeId: string, key: string): string => socketNameOf(editor, nodeId, "output", key);
  for (const n of editor.getNodes() as CylNode[]) {
    if (!hasDynamicInputs(n.kind)) continue;
    const slotTypes = resolveSlotTypes(n, connections, socketTypeOf);
    for (const c of connections) {
      const k = dynamicInputIndex(c.targetInput);
      if (c.target !== n.id || k === null) continue;
      // **按槽**取已定型的类型：跨槽的类型差异不是冲突（那是每槽独立的正常形态）。
      const slotType = slotTypes[k] ?? ANY;
      const fam = socketFamily(slotType);
      if (fam === null) continue; // 该槽待定：谈不上冲突
      const incoming = socketTypeOf(c.source, c.sourceOutput);
      const incomingFam = socketFamily(incoming);
      if (incomingFam === null || incomingFam === fam) continue;
      const srcLabel = (editor.getNode(c.source) as CylNode | undefined)?.label ?? c.source;
      out.push({
        nodeId: n.id,
        nodeType: slotType,
        port: c.targetInput,
        incomingType: incoming,
        message: `${n.label}.${c.targetInput} is fed ${incoming} by ${srcLabel} but slot ${k} resolved to ${slotType}: geometry and numeric ports never mix - remove one of the wires`,
      });
    }
  }
  return out;
}

/** PortTypeConflict[] → NodeErrorMap（照 duplicateOutputPortsToNodeErrors 的形状）。 */
export function portTypeConflictsToNodeErrors(
  conflicts: ReadonlyArray<PortTypeConflict>,
): NodeErrorMap {
  const map: NodeErrorMap = {};
  for (const c of conflicts) {
    if (!c?.nodeId || !c.message) continue;
    (map[c.nodeId] ??= []).push({
      severity: "error",
      message: c.message,
      port: c.port,
      source: "port-type-conflict",
    });
  }
  return map;
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

/** Houdini-style unique naming: null1, null2… (first node already carries a suffix).
 *
 *  v0.1.00121：`null` 成为**动态端口 + 类型待定**节点（Cyl1nder 的 merge）。
 *  端口起手仍是 1 in / 1 out（形状不变），但类型是 ANY 而不是 GEO：
 *   - 类型由上游决定（propagateDynamicTypes），起手写死 GEO 就等于"猜"，
 *     float 源根本连不进来，推导永远没有起点；
 *   - 视觉上 ANY 不出类 = 中性灰白，正是「未知类型灰白 / geo 朱红」那条约定。
 *     旧图里一个**接着 geo 线**的 null 恢复后会被推回 GEO（朱红），外观不变；
 *     一个**空着**的 null 变灰白 —— 那是"它现在确实还不知道类型"的诚实表达。 */
let nullSeq = 1;
export function makeNullNode(): CylNode {
  const name = `null${nullSeq}`;
  nullSeq += 1;
  const n = new CylNode(name, "null");
  n.baseLabel = "null";
  n.slotTypes = [ANY]; // 每槽类型单源（socket 只是镜像）；起手只有槽 0，且待定
  n.addInput(dynamicInputKey(0), new ClassicPreset.Input(new ClassicPreset.Socket(ANY)));
  // 槽 0 的输出视图逐字仍是 `out0`（既有连接身份，冻结契约）。
  n.addOutput(dynamicOutputKey(0), new ClassicPreset.Output(new ClassicPreset.Socket(ANY)));
  // **刻意不生成引用参数**：新建的 null 一根线都没接，没有数据流进来，就没有"覆盖流入值"
  // 这件事可配置（slotRefScope 的论证）。接上第一根线时 syncDynamicInputs 会补上。
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
  if (!port) return ""; // 端口不存在 → 拒绝连线（不可回落到槽类型，否则连不存在的端口都能连）
  // 动态节点：类型的**单源是槽**，socket 只是镜像。这里读单源而不是镜像，于是
  // 「镜像还没刷到」的窗口期里连线校验也不会放行错配的线。
  //
  // **按 key 解析到它所属的那个槽**（v0.1.00125）：`in2`/`out2` → 槽 2。这就是为什么
  // 插件能一边拒绝 geo 进一个已定型 float 的槽、一边放行 geo 进另一个空槽——上一版这里
  // 返回一个节点级类型，两个槽读到同一个值，于是必然一起放行或一起拒绝。
  // 解析不出槽（理论上不可能：端口既存在又不是 `in\d+`/`out\d+`）→ 回落 socket 镜像，
  // 而不是编造一个类型。
  if (hasDynamicInputs(n.kind)) {
    const slot = slotIndexOfPort(n, key);
    if (slot !== null) return slotTypeOf(n, slot);
  }
  return port.socket?.name ?? "";
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

/** 动态端口引用参数（null 节点的 `ref_in0` / `ref_out0`…）是否处于默认（= 空）状态。
 *
 *  与 address/type/port 同理：**空引用与"没有这个参数"在序列化层必须等价**。
 *  `dynamic-ports.test.ts:414` 那条断言（v2 图里 null 节点 `params === undefined`）
 *  是字节兼容的承重墙——null 从来不带 params，加了引用参数之后若不剔除默认值，
 *  每个既有 v2 快照都会凭空多出一串 `ref_in*`。 */
function isDefaultRefParam(p: ParamSpec): boolean {
  if (!p.name.startsWith(REF_PARAM_PREFIX)) return false;
  return p.value === "" || p.value == null;
}

/** 剔除默认参数后的列表（空 → undefined，序列化时无该键）。
 *
 *  三类 kind 各有自己的默认集：`input`/`output` 是 address/type/port，
 *  `null` 是 `ref_*`。其余 kind 原样输出（transform 的 tx/ty/tz 等本来就该存）。 */
function serializableParams(kind: NodeKind, params?: ParamSpec[]): ParamSpec[] | undefined {
  if (!params || params.length === 0) return undefined;
  if (kind === "input" || kind === "output") {
    const kept = params.filter((p) => !isDefaultAddressParam(p));
    return kept.length > 0 ? kept : undefined;
  }
  if (hasDynamicInputs(kind)) {
    const kept = params.filter((p) => !isDefaultRefParam(p));
    return kept.length > 0 ? kept : undefined;
  }
  return params;
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
  // 动态端口（v0.1.00121）：**先按快照里的连接把端口补齐，再加连接**。
  // rete 的 addConnection 不校验端口是否存在（读过 rete.esm.js 确认），所以顺序反了
  // 不会报错，只会留下一根**指向不存在 key** 的连接：数据里在、画面上没有。
  // 采集用 wiredInputKeysByNode，与运行期 propagateDynamicTypes 同一处口径。
  const savedWired = wiredInputKeysByNode(d.connections ?? []);
  // 输出侧同理（v0.1.00125，每槽一个 `out{k}`）：一根接在 `out2` 上的下游线同样需要
  // 那个端口**在 addConnection 之前**就存在，否则它会指向一个不存在的 key。
  const savedWiredOut = wiredOutputKeysByNode(d.connections ?? []);
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
    // 动态端口：按**快照里这个节点被接过的 key** 预建端口（含尾部那一个 spare）。
    // 用 nd.id（快照 id）查，而不是 n.id（新建的 id）—— 连接表里写的是前者。
    if (hasDynamicInputs(n.kind)) {
      syncDynamicInputs(n, savedWired.get(nd.id) ?? [], savedWiredOut.get(nd.id) ?? []);
    }
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
  // 连接都在了 → 一次性推导动态节点类型（旧图里接着 geo 线的 null 在此被推回 GEO，
  // 于是外观与改造前一致）。放在连接之后是必须的：推导读的就是连接。
  propagateDynamicTypes(editor);
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
