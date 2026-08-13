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
