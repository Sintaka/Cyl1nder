import { BridgeClient } from "../bridge/client";
import { AnchorProbeResult, BRIDGE_URL, MappingsResponse, ProjectRef } from "../protocol/types";

type Listener = () => void;

/** 项目 store（无框架 pub-sub，照 ChannelsStore 骨架）：
 *  持有项目列表（成员 = 通道引用快照），供 overview / 后续 nodeview 项目根共用。 */
export class ProjectsStore {
  projects: ProjectRef[] = [];

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  setProjects(list: ProjectRef[]): void {
    this.projects = list;
    this.emit();
  }

  /** 幂等 upsert：按 projectSerial 去重，已存在则整体替换，否则追加。 */
  upsertProject(p: ProjectRef): void {
    const i = this.projects.findIndex((x) => x.projectSerial === p.projectSerial);
    if (i >= 0) this.projects[i] = p;
    else this.projects.push(p);
    this.emit();
  }

  /** 拉取项目列表 → setProjects。网络失败吞错、不抛给调用方：
   *  桥离线 / 接口未就绪时保持现有 projects 原状（首次加载则仍为空）。 */
  async refresh(): Promise<void> {
    try {
      const { projects } = await new BridgeClient().listProjects();
      this.setProjects(projects);
    } catch {
      /* 吞错：保留原状（同 channelsStore.refresh 语义，overview 直接走 BridgeClient 以显示 banner）。 */
    }
  }
}

export const projectsStore = new ProjectsStore();

// ---------------------------------------------------------------------------
// 项目改名/删除/清理 + 映射读写的 HTTP 客户端。
// 为什么写在 store 而不是 bridge/client.ts：这批端点是 overview 项目页专用，
// bridge/client.ts 不在本次写集；overview 本来就直接 fetch BRIDGE_URL，此处沿用同款裸 fetch。
// ---------------------------------------------------------------------------

/** 逻辑名 URL 编码：**按段** encodeURIComponent 后用 `/` 拼回。
 *  逻辑名可含 `/`（如 `point_1/tx`），而 bridge 以 `:path` 捕获该参数——`/` 必须
 *  原样保留才能匹配到路由，其余不安全字符（空格 `#` `?` `%` 等）仍需转义。
 *  整串 encodeURIComponent 会把 `/` 变成 `%2F` 导致 404，encodeURI 又漏掉 `#`/`?`。 */
export function encodeMappingName(name: string): string {
  return name
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: unknown; error?: unknown } | null;
      if (body?.error !== undefined) detail = String(body.error);
      else if (body?.detail !== undefined) detail = String(body.detail);
    } catch {
      /* 无 JSON body：保留 status 文本 */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

const projectUrl = (pid: string): string => `${BRIDGE_URL}/api/projects/${encodeURIComponent(pid)}`;

/** PATCH /api/projects/{pid} — 改名（body {label}）。 */
export async function patchProjectLabel(pid: string, label: string): Promise<{ ok: boolean; project: ProjectRef }> {
  return jsonOrThrow(
    await fetch(projectUrl(pid), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    }),
  );
}

/** DELETE /api/projects/{pid} → `{ok, removed:boolean}`。
 *  注意 removed 是 **bool** 而非 pid：未知 pid 返回 **200 + removed:false**（不是 404，
 *  刻意照 remove_member 的宽松风格）。调用方应把 false 当「本来就没了」而不是错误。 */
export async function deleteProject(pid: string): Promise<{ ok: boolean; removed: boolean }> {
  const r = await jsonOrThrow<{ ok: boolean; removed?: unknown }>(
    await fetch(projectUrl(pid), { method: "DELETE" }),
  );
  return { ok: r.ok, removed: r.removed === true };
}

/** POST /api/projects/cleanup — 清理空项目 → {ok, removed:[pid…]}。 */
export async function cleanupProjects(): Promise<{ ok: boolean; removed: string[] }> {
  const r = await jsonOrThrow<{ ok: boolean; removed?: string[] }>(
    await fetch(`${BRIDGE_URL}/api/projects/cleanup`, { method: "POST", headers: { Accept: "application/json" } }),
  );
  return { ok: r.ok, removed: Array.isArray(r.removed) ? r.removed : [] };
}

/** GET /api/projects/{pid}/mappings — 映射表（entries/anchors/resolved）。 */
export async function fetchMappings(pid: string): Promise<MappingsResponse> {
  return jsonOrThrow(await fetch(`${projectUrl(pid)}/mappings`, { headers: { Accept: "application/json" } }));
}

const mappingUrl = (pid: string, name: string): string =>
  `${projectUrl(pid)}/mappings/${encodeMappingName(name)}`;

const mappingValueUrl = (pid: string, name: string): string => `${mappingUrl(pid, name)}/value`;

/** DELETE /api/projects/{pid}/mappings/{name} — 解绑一个逻辑名。
 *  与 deleteProject 不对称：未知逻辑名这里返回 **404**（桥侧刻意选择，已在协议文档记录），
 *  故 404 归一为 `{ok:true, removed:false}` = 「本来就没了」，不当错误抛给 UI。 */
export async function deleteMapping(pid: string, name: string): Promise<{ ok: boolean; removed: boolean }> {
  const res = await fetch(mappingUrl(pid, name), { method: "DELETE", headers: { Accept: "application/json" } });
  if (res.status === 404) return { ok: true, removed: false };
  const r = await jsonOrThrow<{ ok?: boolean; removed?: unknown }>(res);
  return { ok: r.ok ?? true, removed: r.removed !== false };
}

/** GET /api/projects/{pid}/mappings/{name}/value — 读值。
 *  不抛：桥离线 / 404 / {ok:false} 一律归一为 {ok:false, error}（照 client.channelValue 语义）。 */
export async function getMappingValue(
  pid: string,
  name: string,
): Promise<{ ok: boolean; value: unknown; error?: string }> {
  return mappingValue("GET", pid, name);
}

/** PUT /api/projects/{pid}/mappings/{name}/value — 写值（body {value}），错误语义同 getMappingValue。 */
export async function putMappingValue(
  pid: string,
  name: string,
  value: unknown,
): Promise<{ ok: boolean; value: unknown; error?: string }> {
  return mappingValue("PUT", pid, name, { value });
}

async function mappingValue(
  method: "GET" | "PUT",
  pid: string,
  name: string,
  body?: { value: unknown },
): Promise<{ ok: boolean; value: unknown; error?: string }> {
  try {
    const res = await fetch(mappingValueUrl(pid, name), {
      method,
      headers: body ? { "Content-Type": "application/json" } : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      value?: unknown;
      error?: string;
      detail?: unknown;
    } | null;
    if (!res.ok) {
      let error: string;
      if (typeof data?.error === "string") error = data.error;
      else if (data?.detail !== undefined) error = String(data.detail);
      else error = `${res.status} ${res.statusText}`;
      return { ok: false, value: undefined, error };
    }
    return { ok: data?.ok ?? true, value: data?.value, error: data?.error };
  } catch (err) {
    return { ok: false, value: undefined, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 探测失败（桥离线 / 接口未就绪 / 错误信封）的归一形状。
 *  用 `ok:false` 做判别标记：AnchorProbeResult 本身**没有** ok 字段，
 *  故调用方 `"ok" in r` 即可区分「探到结论」与「探不动」。 */
export interface AnchorProbeFailure {
  ok: false;
  error: string;
}

/** GET /api/projects/{pid}/anchors/{serial}/probe — 锚点存活实证（核对 mcp.health 的 pid）。
 *
 *  **不抛**（照 getMappingValue/putMappingValue 语义）：探测失败是日常结果而不是崩溃，
 *  桥离线 / 404 / HTTP 错误 / `{ok:false,error}` 信封一律归一为 AnchorProbeFailure。
 *  语义提醒：`alive && pidMatched` 才算确认活着；alive 但 pid 不匹配 = 端口被另一个
 *  Houdini 占着（实例换了），**不能**当健康处理。 */
export async function probeAnchor(pid: string, serial: string): Promise<AnchorProbeResult | AnchorProbeFailure> {
  const url = `${projectUrl(pid)}/anchors/${encodeURIComponent(serial)}/probe`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data = (await res.json().catch(() => null)) as
      | (Partial<AnchorProbeResult> & { ok?: boolean; error?: string; detail?: unknown })
      | null;
    if (!res.ok) {
      let error: string;
      if (typeof data?.error === "string") error = data.error;
      else if (data?.detail !== undefined) error = String(data.detail);
      else error = `${res.status} ${res.statusText}`;
      return { ok: false, error };
    }
    // 200 但带错误信封（桥问不到 Houdini 时的常见形状）→ 同样算「探不动」。
    if (data === null) return { ok: false, error: "探测响应不是 JSON" };
    if (data.ok === false) return { ok: false, error: typeof data.error === "string" ? data.error : "probe failed" };
    return {
      serial: typeof data.serial === "string" && data.serial ? data.serial : serial,
      alive: data.alive === true,
      pidMatched: data.pidMatched === true,
      port: typeof data.port === "number" ? data.port : 0,
      expectedPid: typeof data.expectedPid === "number" ? data.expectedPid : 0,
      actualPid: typeof data.actualPid === "number" ? data.actualPid : 0,
      hip: typeof data.hip === "string" ? data.hip : "",
      reason: typeof data.reason === "string" ? data.reason : "",
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
