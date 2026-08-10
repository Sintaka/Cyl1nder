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

  /** Global dockview layout (persisted by bridge to a file - cross-browser). */
  async getUiLayout(): Promise<unknown> {
    return json<{ layout: unknown }>(await fetch(`${this.base}/api/ui/layout`)).then((r) => r.layout);
  }

  async putUiLayout(layout: unknown): Promise<void> {
    await fetch(`${this.base}/api/ui/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout }),
    });
  }

  /** Unified path system: read the disk snapshot (cyl://<serial>/snapshot). */
  async getSnapshot(
    serial: string,
  ): Promise<{ serial: string; snapshot: { inputs?: unknown[]; outputs?: unknown[]; graph?: unknown; parm?: unknown; docking?: unknown } | null }> {
    return json(await fetch(`${this.base}/api/hda/${serial}/snapshot`));
  }

  /** Persist the scene part: node graph / node params / docking layout. */
  async putSnapshot(
    serial: string,
    data: { graph?: unknown; parm?: unknown; docking?: unknown },
  ): Promise<{ ok: boolean; serial: string }> {
    return json(
      await fetch(`${this.base}/api/hda/${serial}/snapshot`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    );
  }

  async getLogs(serial?: string, level?: string, limit = 200): Promise<LogEntry[]> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (serial) q.set("serial", serial);
    if (level) q.set("level", level);
    return json<{ logs: LogEntry[] }>(await fetch(`${this.base}/api/logs?${q}`)).then((r) => r.logs);
  }
}

export type WsHandler = (msg: any) => void;

/** Live channel: ws://127.0.0.1:8375/ws?serial=... with automatic reconnect (exponential backoff). */
export function connectWs(serial: string, onMessage: WsHandler, onStatus: (open: boolean) => void): () => void {
  let closed = false;
  let retries = 0;
  let ws: WebSocket | null = null;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(`ws://${new URL(BRIDGE_URL).host}/ws?serial=${encodeURIComponent(serial)}`);
    ws.onopen = () => {
      retries = 0;
      onStatus(true);
    };
    ws.onclose = () => {
      onStatus(false);
      if (closed) return;
      const delay = Math.min(500 * 2 ** retries, 5000);
      retries += 1;
      setTimeout(connect, delay);
    };
    ws.onerror = () => {
      /* onclose follows and schedules the reconnect */
    };
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data as string));
      } catch {
        /* ignore malformed */
      }
    };
  };

  connect();
  return () => {
    closed = true;
    if (ws) ws.close();
  };
}