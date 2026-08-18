// TS mirror of bridge/bridge/protocol.py (single source = bridge; keep in sync).
export const BRIDGE_URL = "http://127.0.0.1:8375";
export const SERIAL_RE = /^C1-[0-9a-z]{8,}-[0-9a-z]{4}$/;

export interface AttributeData {
  type: string;
  count: number;
  values: number[] | number[][];
}

export interface CurveData {
  pointIndices: number[];
  widths: number[] | null;
}

// Unified color attribute type: a vector float RGB triplet stored in normalized
// 0..1 space (e.g. [0.2, 0.4, 0.8]). color3 is a new unified-param-system type:
// usable both as a node param (Param panel) and in Preference.json values.
export type Color3Value = [number, number, number];

export interface InputPayload {
  index: number;
  name: string;
  pointCount: number;
  primCount: number;
  points: number[][];
  curves: CurveData[];
  faces?: number[][];
  attributes: Record<string, AttributeData>;
}

export interface OutputBuffer {
  index: number;
  rev: number;
  pointCount: number;
  primCount: number;
  points: number[][];
  curves: CurveData[];
  faces?: number[][];
  attributes: Record<string, AttributeData>;
}

export interface InputStat {
  index: number;
  name: string;
  pointCount: number;
  primCount: number;
  curveCount: number;
}

export interface OutputStat {
  index: number;
  rev: number;
  pointCount: number;
  primCount: number;
  curveCount: number;
}

export interface WorkspaceSummary {
  serial: string;
  inputRev: number;
  outputRev: number;
  inputs: InputStat[];
  outputs: OutputStat[];
}

export interface RegistryRecord {
  serial: string;
  hip: string;
  nodePath: string;
  label: string;
  createdAt: number;
  lastSeen: number;
}

// 关联注册（吊牌 HDA 通道）：bridge/bridge/channels.py channelRef 的 TS 镜像。
// param/data 通道 id = absolutePath，tag/hda 通道 id = serial。
export type ChannelKind = "tag" | "hda" | "param" | "data";

export interface ChannelRef {
  kind: ChannelKind;
  serial?: string | null;
  nodePath?: string | null;
  absolutePath?: string | null;
  /** data 通道专属：bridge 侧读写器名（如 apex-anim）；其余 kind 恒 null/缺省。 */
  adapter?: string | null;
  hip: string;
  label: string;
  registeredAt: number;
  lastSeen: number;
  /** 映射系统（v0.1.00114）：相对**吊牌所在网络**的地址（兄弟节点语义）；逻辑名默认取它。 */
  rel?: string | null;
  /** 值/端口类型（geo|float|vec3）；旧记录缺省按 "float"。 */
  type?: MappingType | string;
  /** 归属吊牌的标记模式（"parm" | "apex"）。 */
  mode?: TagMode | string | null;
}

// 项目层（P2a）：项目 = 通道引用聚合。项目序列号前缀 P1-，与 HDA serial（C1-）区分。
export const PROJECT_SERIAL_RE = /^P1-[0-9a-z]{8,}-[0-9a-z]{4}$/;

export interface ProjectRef {
  projectSerial: string;
  label: string;
  createdAt: number;
  updatedAt: number;
  members: ChannelRef[]; // 通道引用快照（live 状态以 /api/channels 为准）
}

// ---------------------------------------------------------------------------
// 映射系统（v0.1.00114，见 devlog/project-mapping-design.md）
//
// node 侧只引用**逻辑名（相对地址）**，绝对 Houdini 路径只存在于映射系统。
// 锚点 = 吊牌 serial（创建即不可变，移动/改名不变）；吊牌每次 cook 上报自身
// nodePath，锚点移动只改一处，其下全部 entry 自动跟随。
// 解析：absolutePath = <锚点 nodePath 所在网络> + "/" + entry.rel（兄弟节点语义）。
// ---------------------------------------------------------------------------

/** 端口/值类型：geo 走几何数据流；float/vec3 走映射系统按逻辑名读写。 */
export type MappingType = "geo" | "float" | "vec3";
export const MAPPING_TYPES: readonly MappingType[] = ["geo", "float", "vec3"];

/** 吊牌标记模式：普通参数 / scene animate（apex-ctrl）。 */
export type TagMode = "parm" | "apex";

/** 映射锚点。
 *
 *  pid / mcpPort（v0.1.00114）：吊牌 cook 时上报，用于**降级前实证**。心跳只证明
 *  「最近 cook 过」，吊牌长期不 cook 是正常的 —— 所以心跳超时不等于失联。有了
 *  pid+端口就能直接核对 `mcp.health` 的 pid，区分「只是没 cook」与「实例真没了」。 */
export interface AnchorRef {
  serial: string;   // 不可变
  nodePath: string; // 可变（移动/改名）
  hip: string;
  mode: TagMode | string;
  lastSeen: number;
  movedAt: number;  // 0 = 从未移动
  pid: number;      // Houdini 进程号（0 = 未上报）
  mcpPort: number;  // 该实例的 fxhoudinimcp 端口（0 = 未发现）
  verifiedAt: number;      // 最近一次 pid 核对成功的时刻（探测刷新，非心跳）
  verifiedAlive: boolean;  // 最近一次探测结论
}

/** 锚点存活探测结果。`alive && pidMatched` 才是确认活着；
 *  alive 但 pid 不匹配 = 该端口现在被另一个 Houdini 占着（实例换了）。 */
export interface AnchorProbeResult {
  serial: string;
  alive: boolean;
  pidMatched: boolean;
  port: number;
  expectedPid: number;
  actualPid: number;
  hip: string;
  reason: string;
}

export interface MappingEntry {
  anchor: string;            // 锚点 serial
  rel: string;               // 相对锚点所在网络，如 "transform1/tx"
  kind: "param" | "data" | string;
  adapter?: string | null;   // kind="data" 时的读写器（如 "apex-ctrl"）
  type: MappingType | string;
  label: string;
}

export interface MappingResolved {
  name: string;
  absolutePath: string;
  kind: "param" | "data" | string;
  adapter?: string | null;
  type: MappingType | string;
  anchor: string;
  ok: boolean;
  error: string;
}

export interface MappingsResponse {
  projectSerial: string;
  entries: Record<string, MappingEntry>;
  anchors: Record<string, AnchorRef>;
  resolved: Record<string, MappingResolved>;
}

/** WS：锚点（吊牌）位置变化 —— 逻辑名不变，仅提示与刷新。 */
export interface AnchorMovedMsg {
  type: "anchor-moved";
  serial: string;
  oldPath: string;
  newPath: string;
  names: string[];
}

// 轨迹事件（P3 审计视图：谁动了数据）。协议三处同步（protocol.py / types.ts / protocol.md）。
export type TraceActor = "web-gizmo" | "web-param" | "runtime-python" | "tag-hda" | "hda-cook" | "bridge";
export type TraceAction = "param-set" | "expr-set" | "inputs-push" | "outputs-edit" | "register" | "heartbeat" | "python-exec" | "data-get" | "data-set" | "anchor-move";

export interface TraceEvent {
  ts: number;
  project: string; // v1 恒 ""（项目过滤在查询时按成员关系解析）
  channel: string;
  actor: TraceActor | string;
  action: TraceAction | string;
  target: string;
  digest: string;
}

// P2b：项目图快照负载（nodeview 项目根）。结构与 nodes2/graph 的
// projectGraphSnapshot 序列化格式一致；web 与 bridge 之间仅作 opaque JSON 存读，
// 故保持 unknown 透传即可（必要时再收敛为具体类型）。
export type ProjectGraph = unknown;

export interface StatusResponse {
  serial: string;
  registry: RegistryRecord | null;
  workspace: WorkspaceSummary;
}

export interface LogEntry {
  ts: number;
  level: string;
  source: string;
  serial: string | null;
  message: string;
}

// Sync / preference types (bridge PUT /api/hda/{serial}/sync + Preference.json v1).
export type UpdateMode = "auto" | "mouseup";

export interface SyncConfig {
  fps: number;
}

export interface PreferenceJson {
  schemaVersion?: number;
  sync_max_fps?: number;
  update_mode?: UpdateMode;
  sync_enabled?: boolean;
}
// WS messages
export type WsServerMessage =
  | { type: "hello"; serial: string; inputRev: number; outputRev: number }
  | { type: "inputs"; inputs: InputPayload[]; rev: number; frame?: number }
  | { type: "outputs"; outputs: OutputBuffer[]; rev: number }
  | { type: "pong" }
  // P5a 通道值推送（bridge 广播 {values: {absolutePath: value}}，session 接收后经
  // applyChannelValues 注入通道参数面板即时刷新）。
  | { type: "channel-values"; values: Record<string, unknown> };

// NDJSON long-poll events (HDA -> bridge GET /stream; web does not consume)
export type StreamEvent =
  | { type: "outputs"; rev: number; fps?: number; sync_enabled?: boolean }
  | { type: "reset"; rev: number; fps?: number; sync_enabled?: boolean }
  | { type: "kick"; force: true; rev: number; fps?: number; sync_enabled?: boolean }
  | { type: "timeout"; rev: number; fps?: number; sync_enabled?: boolean };

// 时间轴双向同步（bridge WS 广播 timeline 消息 + fxhoudinimcp 代理端点）。
export interface TimelineMsg {
  type: "timeline";
  frame: number;
  fps: number;
  source: "hou" | "web";
  ts: number;
}

export interface TimelineState {
  frame: number;
  fps: number;
  source: "hou" | "web";
  ts: number;
}

export interface HoudiniHealth {
  status?: string;
  houdini_version?: string;
  hip_file?: string;
  pid?: number;
}

export interface HoudiniStatus {
  serial: string;
  mcpPort: number;
  alive: boolean;
  health: HoudiniHealth | null;
}
