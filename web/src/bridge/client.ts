import { BRIDGE_URL, InputPayload, LogEntry, OutputBuffer, StatusResponse } from "../protocol/types";

export interface HealthResponse {
  status: string;
  version: string;
  serials: number;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && body.detail) detail = String(body.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export class BridgeClient {
  constructor(private base: string = BRIDGE_URL) {}

  async health(): Promise<HealthResponse> {
    return json<HealthResponse>(await fetch(`${this.base}/api/health`));
  }

  async listSerials(): Promise<string[]> {
    return json<string[]>(await fetch(`${this.base}/api/serials`));
  }

  async getStatus(serial: string): Promise<StatusResponse> {
    return json<StatusResponse>(await fetch(`${this.base}/api/hda/${serial}/status`));
  }

  async pushInputs(
    serial: string,
    inputs: InputPayload[],
    meta: { nodePath?: string; label?: string } = {},
  ): Promise<{ ok: boolean; rev: number }> {
    return json(
      await fetch(`${this.base}/api/hda/${serial}/inputs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs, nodePath: meta.nodePath ?? "", label: meta.label ?? "Cyl1nder" }),
      }),
    );
  }

  async pushOutputs(serial: string, outputs: OutputBuffer[]): Promise<{ ok: boolean; rev: number }> {
    return json(
      await fetch(`${this.base}/api/hda/${serial}/outputs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputs }),
      }),
    );
  }

  async getOutputs(serial: string, since: number): Promise<{ outputs: OutputBuffer[]; rev: number }> {
    return json(await fetch(`${this.base}/api/hda/${serial}/outputs?since=${since}`));
  }

  async getLogs(serial?: string, level?: string, limit = 200): Promise<LogEntry[]> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (serial) q.set("serial", serial);
    if (level) q.set("level", level);
    return json<{ logs: LogEntry[] }>(await fetch(`${this.base}/api/logs?${q}`)).then((r) => r.logs);
  }
}

export type WsHandler = (msg: any) => void;

/** Live channel: ws://127.0.0.1:8375/ws?serial=... */
export function connectWs(serial: string, onMessage: WsHandler, onStatus: (open: boolean) => void): () => void {
  const ws = new WebSocket(`ws://${new URL(BRIDGE_URL).host}/ws?serial=${encodeURIComponent(serial)}`);
  ws.onopen = () => onStatus(true);
  ws.onclose = () => onStatus(false);
  ws.onerror = () => onStatus(false);
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data as string));
    } catch {
      /* ignore malformed */
    }
  };
  return () => ws.close();
}