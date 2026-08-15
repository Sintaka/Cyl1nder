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

// 轨迹事件（P3 审计视图：谁动了数据）。协议三处同步（protocol.py / types.ts / protocol.md）。
export type TraceActor = "web-gizmo" | "web-param" | "runtime-python" | "tag-hda" | "hda-cook" | "bridge";
export type TraceAction = "param-set" | "expr-set" | "inputs-push" | "outputs-edit" | "register" | "heartbeat" | "python-exec" | "data-get" | "data-set";

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
  | { type: "pong" };

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
