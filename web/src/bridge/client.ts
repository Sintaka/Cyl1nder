import { BRIDGE_URL, InputPayload, LogEntry, OutputBuffer, StatusResponse } from "../protocol/types";
import { encode, decode } from "@msgpack/msgpack";

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

  /**
   * One-shot HDA kick: asks the bridge to set a transient force flag and touch
   * lastSeen so the HDA recooks on its next /pending poll (offline -> ok).
   * Never throws: an old bridge without the endpoint (404) or a disconnect
   * yields { ok: false }.
   */
  async kick(serial: string): Promise<{ ok: boolean }> {
    try {
      const res = await fetch(`${this.base}/api/hda/${serial}/kick`, { method: "POST" });
      if (!res.ok) return { ok: false };
      const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      return { ok: body?.ok ?? true };
    } catch {
      return { ok: false };
    }
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
        headers: { "Content-Type": "application/msgpack" },
        body: encode({ outputs }),
      }),
    );
  }

  async getOutputs(serial: string, since: number): Promise<{ outputs: OutputBuffer[]; rev: number }> {
    const res = await fetch(`${this.base}/api/hda/${serial}/outputs?since=${since}`, {
      headers: { Accept: "application/msgpack" },
    });
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
    const contentType = res.headers.get("content-type") ?? "";
    return contentType.includes("msgpack")
      ? (decode(await res.arrayBuffer()) as { outputs: OutputBuffer[]; rev: number })
      : ((await res.json()) as { outputs: OutputBuffer[]; rev: number });
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
  ): Promise<{ serial: string; snapshot: { inputs?: unknown[]; outputs?: unknown[]; graph?: unknown; parm?: unknown; docking?: unknown; preference?: unknown } | null }> {
    return json(await fetch(`${this.base}/api/hda/${serial}/snapshot`));
  }

  /** Persist the scene part: node graph / node params / docking layout. */
  async putSnapshot(
    serial: string,
    data: { graph?: unknown; parm?: unknown; docking?: unknown; preference?: unknown },
  ): Promise<{ ok: boolean; serial: string }> {
    return json(
      await fetch(`${this.base}/api/hda/${serial}/snapshot`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    );
  }

  /** Push the per-serial sync rate cap to the bridge (PUT /api/hda/{serial}/sync).
   *  Bridge applies it to notify/broadcast/stream forwarding; web Preference.json
   *  is the durable source. */
  async putSyncFps(serial: string, fps: number): Promise<{ ok: boolean; fps: number }> {
    return json(
      await fetch(`${this.base}/api/hda/${serial}/sync`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fps }),
      }),
    );
  }

  /** Push the per-serial manual two-way sync gate to the bridge (web is the source
   *  of truth; OFF = local mode: zero /stream, zero outputs echo). */
  async putSyncEnabled(serial: string, enabled: boolean): Promise<{ ok: boolean; sync_enabled: boolean }> {
    return json(
      await fetch(`${this.base}/api/hda/${serial}/sync-enabled`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }),
    );
  }

  /** Scene library: active (live) scenes + save history. */
  async listScenes(): Promise<{
    active: Array<{ serial: string; label: string; nodePath: string; lastSeen: string; inputRev: number; outputRev: number }>;
    history: Array<{ serial: string; savedAt: string }>;
  }> {
    return json(await fetch(`${this.base}/api/scenes`));
  }

  /** Register a new scene (bridge creates the serial); returns the new serial. */
  async createScene(label?: string): Promise<{ serial: string }> {
    return json(
      await fetch(`${this.base}/api/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(label ? { label } : {}),
      }),
    );
  }

  /** Save the WHOLE serial-named scene folder under targetDir (overwrite prompts upstream). */
  async saveSceneFolder(
    serial: string,
    targetDir: string,
    overwrite = false,
  ): Promise<{ ok: boolean; exists?: boolean; path?: string; error?: string }> {
    return json(
      await fetch(`${this.base}/api/hda/${serial}/scene/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_dir: targetDir, overwrite }),
      }),
    );
  }

  /** Open a scene folder by path (folder name = serial); returns the serial to connect. */
  async openSceneFolder(folderPath: string): Promise<{ serial: string; ok?: boolean; error?: string }> {
    return json(
      await fetch(`${this.base}/api/scenes/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: folderPath }),
      }),
    );
  }

  /** Named desktop layouts (Documents/Cyl1nder/Layouts). */
  async listLayouts(): Promise<string[]> {
    return json<{ layouts: string[] }>(await fetch(`${this.base}/api/ui/layouts`)).then((r) => r.layouts);
  }
  async saveLayout(name: string, layout: unknown): Promise<{ ok: boolean; name: string }> {
    return json(await fetch(`${this.base}/api/ui/layouts/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout }),
    }));
  }
  async loadLayout(name: string): Promise<{ name: string; layout: unknown | null }> {
    return json(await fetch(`${this.base}/api/ui/layouts/${encodeURIComponent(name)}`));
  }

  async getLogs(serial?: string, level?: string, limit = 200): Promise<LogEntry[]> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (serial) q.set("serial", serial);
    if (level) q.set("level", level);
    return json<{ logs: LogEntry[] }>(await fetch(`${this.base}/api/logs?${q}`)).then((r) => r.logs);
  }
}

export type WsHandler = (msg: any) => void;

/** Live channel: ws://127.0.0.1:8375/ws?serial=...&proto=msgpack with automatic reconnect (exponential backoff). */
export function connectWs(serial: string, onMessage: WsHandler, onStatus: (open: boolean) => void): () => void {
  let closed = false;
  let retries = 0;
  let ws: WebSocket | null = null;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(`ws://${new URL(BRIDGE_URL).host}/ws?serial=${encodeURIComponent(serial)}&proto=msgpack`);
    ws.binaryType = "arraybuffer";
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
        if (typeof ev.data === "string") {
          // JSON default path (bridge fallback / non-msgpack connections)
          onMessage(JSON.parse(ev.data));
        } else {
          // binary msgpack frame (proto=msgpack)
          onMessage(decode(new Uint8Array(ev.data)));
        }
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