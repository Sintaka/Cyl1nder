import { BRIDGE_URL, ChannelRef, InputPayload, LogEntry, OutputBuffer, ProjectRef, SerialCapabilities, StatusResponse, TraceEvent } from "../protocol/types";
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
   * GET /api/serials/{serial}/capabilities —— 「这个 serial 提供什么端口」。
   *
   * 用户在 `_input_`/`_output_` 里只填**一个地址 = 一个 serial**，由桥回答它是 SOP HDA
   * （in0..in3 / out0..out3）还是吊牌（该 tag 的逻辑名 + 各自类型）。多个 HDA 可以**故意**
   * 共用一个 serial 把参数集中托管，所以「serial → 端口清单」只有桥知道，前端不能推。
   *
   * **不抛、恒回一个对象**：地址是逐字输入的，半截地址（`C`、`C1-msm6`…）在桥侧同样是
   * 200 + `known:false`——那是**正常中间态不是错误**。断连 / 旧桥 404 也归一成
   * `known:false` 空清单：下拉暂时没得选，而不是把异常抛进参数面板的渲染路径。
   */
  async getSerialCapabilities(serial: string): Promise<SerialCapabilities> {
    const empty: SerialCapabilities = {
      serial,
      kind: "",
      known: false,
      nodePath: "",
      hip: "",
      inputs: [],
      outputs: [],
    };
    try {
      const res = await fetch(`${this.base}/api/serials/${encodeURIComponent(serial)}/capabilities`);
      if (!res.ok) return empty;
      const body = (await res.json().catch(() => null)) as SerialCapabilities | null;
      return body ?? empty;
    } catch {
      return empty;
    }
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

  /** GET /api/hda/{serial}/timeline — current timeline state (frame/fps/source/ts/mcpPort). */
  async getTimeline(serial: string): Promise<{ serial: string; frame: number; fps: number; source: "hou" | "web"; ts: number; mcpPort: number }> {
    return json(await fetch(`${this.base}/api/hda/${serial}/timeline`));
  }

  /** PUT /api/hda/{serial}/timeline — web 设帧；bridge 经 fxhoudinimcp 代理到 Houdini。 */
  async putTimeline(serial: string, frame: number): Promise<{ ok: boolean; frame?: number; mcp_port?: number; error?: string; throttled?: boolean }> {
    return json(
      await fetch(`${this.base}/api/hda/${serial}/timeline`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frame }),
      }),
    );
  }

  /** GET /api/hda/{serial}/houdini — Houdini 活性 + fxhoudinimcp 端口 + health。 */
  async getHoudini(serial: string): Promise<{ serial: string; mcpPort: number; alive: boolean; health: unknown | null }> {
    return json(await fetch(`${this.base}/api/hda/${serial}/houdini`));
  }

  /** PUT /api/hda/{serial}/houdini — 登记该 serial 的 fxhoudinimcp 端口。 */
  async putHoudiniMcp(serial: string, mcpPort: number): Promise<unknown> {
    return json(
      await fetch(`${this.base}/api/hda/${serial}/houdini`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcp_port: mcpPort }),
      }),
    );
  }

  /** POST /api/hda/{serial}/houdini/cmd — 任意 fxhoudinimcp 命令代理。 */
  async houdiniCmd(serial: string, command: string, params?: Record<string, unknown>): Promise<unknown> {
    return json(
      await fetch(`${this.base}/api/hda/${serial}/houdini/cmd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params ? { command, params } : { command }),
      }),
    );
  }

  /** POST /api/hda/{serial}/houdini/python — 在 Houdini 内执行 Python（fxhoudinimcp 代理）。 */
  async houdiniPython(serial: string, code: string, returnExpression?: string): Promise<unknown> {
    return json(
      await fetch(`${this.base}/api/hda/${serial}/houdini/python`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(returnExpression ? { code, return_expression: returnExpression } : { code }),
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

  /** GET /api/trace — 轨迹事件查询（P3 审计视图）。空值省略 query 参数，URLSearchParams 构造
   *  （与 trace.ts 的 buildTraceQuery 同构，分层各自实现，不交叉 import）。 */
  async listTrace(
    filters: { project?: string; actor?: string; action?: string; channel?: string; target?: string; limit?: number } = {},
  ): Promise<{ events: TraceEvent[]; count: number }> {
    const q = new URLSearchParams();
    if (filters.project) q.set("project", filters.project);
    if (filters.actor) q.set("actor", filters.actor);
    if (filters.action) q.set("action", filters.action);
    if (filters.channel) q.set("channel", filters.channel);
    if (filters.target) q.set("target", filters.target);
    if (filters.limit !== undefined && filters.limit > 0) q.set("limit", String(filters.limit));
    const qs = q.toString();
    return json(await fetch(`${this.base}/api/trace${qs ? `?${qs}` : ""}`));
  }

  /** channelId URL 编码：去前导 `/`、保留段间 `/`（param 通道 id = absolutePath，tag/hda 通道 id = serial）。 */
  private _channelUrl(id: string): string {
    return encodeURI(id.replace(/^\//, ""));
  }

  /** GET /api/channels — 关联注册大全列表。 */
  async listChannels(): Promise<{ channels: ChannelRef[] }> {
    return json(await fetch(`${this.base}/api/channels`));
  }

  /** PUT /api/channels/{id} — 注册/幂等覆盖一个通道引用。 */
  async putChannel(channelId: string, ref: ChannelRef): Promise<{ ok: boolean; channelId: string }> {
    return json(
      await fetch(`${this.base}/api/channels/${this._channelUrl(channelId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ref),
      }),
    );
  }

  /** POST /api/hda/{serial}/channels/heartbeat — 吊牌 cook 节流心跳摘要。 */
  async heartbeatChannels(
    serial: string,
    summary: { nodePath: string; upstreamNodePath: string; fingerprint: string },
  ): Promise<{ ok: boolean; serial: string; lastSeen: number }> {
    return json(
      await fetch(`${this.base}/api/hda/${serial}/channels/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(summary),
      }),
    );
  }

  /** GET /api/channels/{id}/probe — 经 houdini 代理做存活/匹配探测。 */
  async probeChannel(channelId: string): Promise<{
    ok: boolean;
    alive: boolean;
    matched: boolean;
    nodePath: string;
    serial: string;
    reason?: string | null;
  }> {
    return json(await fetch(`${this.base}/api/channels/${this._channelUrl(channelId)}/probe`));
  }

  /** GET /api/channels/{id}/value — data 通道读值（P4）。
   *  不抛：404 无通道 / 400 非 data 或未知 adapter / MCP 不可达（HTTP 200 + {ok:false,error}）
   *  都归一为 {ok:false, error}。 */
  async getChannelValue(channelId: string): Promise<{ ok: boolean; value: unknown; error?: string }> {
    return this.channelValue("GET", channelId);
  }

  /** PUT /api/channels/{id}/value — data 通道写值（body {"value": <任意 JSON>}），错误语义同 getChannelValue。 */
  async putChannelValue(channelId: string, value: unknown): Promise<{ ok: boolean; value: unknown; error?: string }> {
    return this.channelValue("PUT", channelId, value);
  }

  /**
   * PUT /api/projects/{pid}/mappings/{name}/value — **把图算出的值写回 Houdini**
   * （v0.1.00125，非 geo `_output_` 的落地通路）。
   *
   * 与 `putChannelValue` 的区别：那条按**通道 id** 写、只覆盖 data 通道；这条按
   * **项目 + 逻辑名**写，桥会解析成绝对路径再调 `parameters.set_parameter`
   * 或 data adapter —— 这才是 `_output_` 的 `address`+`port` 所指的东西。
   *
   * **409 = cook 会成环**（桥侧硬约束）。这里把它归一成 `ok:false` 并带上桥给的中文
   * 原因，让调用方可以直接显示；**不重试** —— 环不会因为再发一次就消失。
   */
  async putMappingValue(
    projectId: string,
    name: string,
    value: unknown,
  ): Promise<{ ok: boolean; value?: unknown; error?: string; cycle?: boolean }> {
    const url = `${this.base}/api/projects/${encodeURIComponent(projectId)}/mappings/${name
      .split("/")
      .map(encodeURIComponent)
      .join("/")}/value`;
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 409) {
        return { ok: false, cycle: true, error: String(body.detail ?? "cook 会成环") };
      }
      if (!res.ok) return { ok: false, error: String(body.detail ?? `HTTP ${res.status}`) };
      return { ok: body.ok !== false, value: body.value, error: body.error ? String(body.error) : undefined };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /** data 通道 value 端点共用实现：GET 无 body；PUT body {"value": value}（JSON.stringify）。 */
  private async channelValue(
    method: "GET" | "PUT",
    channelId: string,
    value?: unknown,
  ): Promise<{ ok: boolean; value: unknown; error?: string }> {
    try {
      const res = await fetch(`${this.base}/api/channels/${this._channelUrl(channelId)}/value`, {
        method,
        headers: value !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: value !== undefined ? JSON.stringify({ value }) : undefined,
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        value?: unknown;
        error?: string;
        detail?: unknown;
      } | null;
      if (!res.ok) {
        let error: string;
        if (body && typeof body.error === "string") error = body.error;
        else if (body && body.detail !== undefined) error = String(body.detail);
        else error = `${res.status} ${res.statusText}`;
        return { ok: false, value: undefined, error };
      }
      return { ok: body?.ok ?? true, value: body?.value, error: body?.error };
    } catch (err) {
      return { ok: false, value: undefined, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** GET /api/hda/{serial}/channel-values — 该 serial 全部 param 通道的当前值
   *  （bridge 侧 0.25s 缓存，照 GET /timeline 模式）。不抛：断连/旧桥/400 都归一为
   *  {ok:false, values:{}, error}。 */
  async getChannelValues(serial: string): Promise<{ ok: boolean; values: Record<string, unknown>; error?: string }> {
    try {
      const res = await fetch(`${this.base}/api/hda/${serial}/channel-values`);
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        values?: Record<string, unknown>;
        error?: string;
        detail?: unknown;
      } | null;
      if (!res.ok) {
        let error: string;
        if (body && typeof body.error === "string") error = body.error;
        else if (body && body.detail !== undefined) error = String(body.detail);
        else error = `${res.status} ${res.statusText}`;
        return { ok: false, values: {}, error };
      }
      return { ok: body?.ok ?? true, values: body?.values ?? {}, error: body?.error };
    } catch (err) {
      return { ok: false, values: {}, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** PUT /api/hda/{serial}/channel-values — 批量写 param 通道值（body {values}；
   *  bridge 侧 Sync Max FPS 节流 + latest-wins + single-flight，成功后不回显广播）。
   *  错误语义同 getChannelValues。 */
  async putChannelValues(
    serial: string,
    values: Record<string, unknown>,
  ): Promise<{ ok: boolean; values?: Record<string, unknown>; error?: string }> {
    try {
      const res = await fetch(`${this.base}/api/hda/${serial}/channel-values`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        values?: Record<string, unknown>;
        error?: string;
        detail?: unknown;
      } | null;
      if (!res.ok) {
        let error: string;
        if (body && typeof body.error === "string") error = body.error;
        else if (body && body.detail !== undefined) error = String(body.detail);
        else error = `${res.status} ${res.statusText}`;
        return { ok: false, error };
      }
      return { ok: body?.ok ?? true, values: body?.values, error: body?.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** GET /api/projects — 项目列表（P2a 项目层，成员为通道引用快照）。 */
  async listProjects(): Promise<{ projects: ProjectRef[] }> {
    return json(await fetch(`${this.base}/api/projects`));
  }

  /** POST /api/projects — 新建项目；P2a 不做改名，label 可空。 */
  async createProject(label?: string): Promise<{ ok: boolean; project: ProjectRef }> {
    return json(
      await fetch(`${this.base}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label ?? "" }),
      }),
    );
  }

  /** GET /api/projects/{id} — 单个项目详情。 */
  async getProject(projectId: string): Promise<{ ok: boolean; project: ProjectRef }> {
    return json(await fetch(`${this.base}/api/projects/${encodeURIComponent(projectId)}`));
  }

  /** POST /api/projects/{id}/members — 加成员（body = channelRef，bridge 按通道 key 去重）。 */
  async addProjectMember(projectId: string, ref: ChannelRef): Promise<{ ok: boolean; project: ProjectRef }> {
    return json(
      await fetch(`${this.base}/api/projects/${encodeURIComponent(projectId)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ref),
      }),
    );
  }

  /** DELETE /api/projects/{id}/members?channelId= — 移除成员（channelId 同 channelIdOf）。 */
  async removeProjectMember(projectId: string, channelId: string): Promise<{ ok: boolean; project: ProjectRef }> {
    return json(
      await fetch(
        `${this.base}/api/projects/${encodeURIComponent(projectId)}/members?channelId=${encodeURIComponent(channelId)}`,
        { method: "DELETE" },
      ),
    );
  }

  /** POST /api/projects/ensure — 隐式项目：无含该 serial 通道的项目则自动建 P1-… 单成员项目。 */
  async ensureProject(serial: string): Promise<{ ok: boolean; project: ProjectRef; created: boolean }> {
    return json(
      await fetch(`${this.base}/api/projects/ensure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial }),
      }),
    );
  }

  /** GET /api/projects/{projectId}/graph — P2b 项目图快照（nodeview 项目根）。 */
  async getProjectGraph(projectId: string): Promise<{ ok: boolean; graph: unknown }> {
    return json(await fetch(`${this.base}/api/projects/${encodeURIComponent(projectId)}/graph`));
  }

  /** PUT /api/projects/{projectId}/graph — 保存项目图快照（body {graph}）。 */
  async putProjectGraph(projectId: string, graph: unknown): Promise<{ ok: boolean }> {
    return json(
      await fetch(`${this.base}/api/projects/${encodeURIComponent(projectId)}/graph`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graph }),
      }),
    );
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