import {
  AnchorProbeResult,
  AnchorRef,
  BRIDGE_URL,
  ChannelRef,
  MappingEntry,
  MappingResolved,
  MappingsResponse,
  PROJECT_SERIAL_RE,
  ProjectRef,
  SERIAL_RE,
} from "./protocol/types";
import { BridgeClient } from "./bridge/client";
import { channelIdOf } from "./stores/channels";
import {
  EVIDENCE_CONCURRENCY,
  PROBE_CONCURRENCY,
  cleanupProjects,
  deleteMapping,
  deleteProject,
  fetchMappings,
  getMappingValue,
  mapWithLimit,
  patchProjectLabel,
  probeAnchor,
  projectsStore,
  putMappingValue,
} from "./stores/projects";
import { INVALID_CHANNEL_VALUE, parseChannelValue } from "./app/channel-value";

// Overview 总管页面（项目优先）：项目（主入口）→ 映射（展开项目的逻辑名视图）→ 场景（诊断，默认折叠）。
// 为什么这个顺序：用户按「项目」开工，序列号（C1-…）是排障细节，不该当门面。
// 契约（bridge，部分并行实现中）：
//   GET    /api/projects                        -> {projects:[ProjectRef]}
//   POST   /api/projects            {label}     -> {ok, project}
//   PATCH  /api/projects/{pid}      {label}     -> {ok, project}
//   DELETE /api/projects/{pid}                  -> {ok, removed}
//   POST   /api/projects/cleanup                -> {ok, removed:[pid…]}
//   GET    /api/projects/{pid}/mappings         -> MappingsResponse
//   GET|PUT /api/projects/{pid}/mappings/{name}/value -> {ok, value} / {ok:false, error}
//   GET  /api/scenes / POST /api/scenes / POST /api/scenes/cleanup（诊断区沿用原契约）
// 结构照 trace.ts 惯例：纯函数顶部导出供单测（web/tests/overview-projects.test.ts、
// data-channels.test.ts；vitest 为 node 环境，无 document 时页面块整体跳过）。

interface ActiveScene {
  serial: string;
  label: string;
  nodePath: string;
  lastSeen: number;
  /** 最近一次推数据/活动的 epoch 秒，0=从未。旧桥响应没有该字段，按 0（未cook）处理。 */
  lastActivity?: number;
  inputRev: number;
  outputRev: number;
}

interface HistoryScene {
  serial: string;
  savedAt: number;
}

interface ScenesResponse {
  active: ActiveScene[];
  history: HistoryScene[];
}

interface CleanupResponse {
  ok: boolean;
  removed: string[];
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const OFFLINE_MS = 150_000; // lastSeen 超过 150s -> 离线（心跳约 1min 一次，阈值 2.5×60=150s；慢时钟，避免长轮询空闲误报）
const STALE_ACTIVITY_MS = 5_000; // lastActivity 超过 5s 未推数据 -> 未cook

type ActiveState = "offline" | "uncooked" | "online";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);

/** 兼容秒级时间戳；正常为毫秒。 */
function epochMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

/** 相对时间文案（纯：差值由调用方给，便于单测固定时钟）。 */
function relSince(diff: number): string {
  if (diff < 5_000) return "刚刚";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function relTime(ts: number): string {
  const diff = Date.now() - epochMs(ts);
  if (diff < 5_000) return "刚刚";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function clockTime(ts: number): string {
  const d = new Date(epochMs(ts));
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ============ 纯函数（供单测：web/tests/data-channels.test.ts） ============

/** data 通道值全量 JSON 文本（value cell 的 title 用）：JSON.stringify，
 *  失败回退 String()（undefined / BigInt / 循环引用等 stringify 拒绝的值）。 */
export function channelValueString(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

/** data 通道值显示文本（供单测）：JSON.stringify + 超 40 字符截断加省略号；失败回退见 channelValueString。 */
export function formatChannelValue(v: unknown): string {
  const s = channelValueString(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

/** 通道行操作按钮 HTML（供单测）：kind=data → 「读值」「写值」两个按钮；其余 kind → 「探测」。
 *  按钮 id 用 channelIdOf（data/param = absolutePath，tag/hda = serial）。 */
export function channelActionButtons(ref: ChannelRef): string {
  const id = channelIdOf(ref);
  if (ref.kind === "data") {
    return (
      `<button class="ov-open" type="button" data-read-channel="${esc(id)}">读值</button>` +
      `<button class="ov-open" type="button" data-write-channel="${esc(id)}">写值</button>`
    );
  }
  return `<button class="ov-open" type="button" data-channel-id="${esc(id)}">探测</button>`;
}

// ============ 纯函数（供单测：web/tests/overview-projects.test.ts） ============

export const UNNAMED_PROJECT = "未命名项目";

/** 该 label 是否只是个「序列号尾巴」——项目自动按成员 serial 命名留下的无意义名字。
 *  判定：整体就是一个序列号（C1- 场景 / P1- 项目自身），或等于任一成员的
 *  serial / channelId。成员可能已被移除，但名字里的 serial 一样没有意义，
 *  所以正则判定不依赖 members。 */
function isSerialTail(label: string, members: ChannelRef[]): boolean {
  if (SERIAL_RE.test(label) || PROJECT_SERIAL_RE.test(label)) return true;
  return members.some((m) => label === (m.serial ?? "") || label === channelIdOf(m));
}

/** 成员的人类可读线索：优先非序列号 label，其次绝对路径/节点路径尾段。 */
function memberHint(m: ChannelRef): string {
  const label = (m.label ?? "").trim();
  if (label && !SERIAL_RE.test(label)) return label;
  const path = (m.absolutePath ?? m.nodePath ?? "").trim();
  const tail = path.slice(path.lastIndexOf("/") + 1);
  return tail;
}

/** 项目里最能说明「这是什么」的成员名（供单测）；全无线索时返回空串。 */
export function bestMemberLabel(members: ChannelRef[]): string {
  for (const m of members) {
    const hint = memberHint(m);
    if (hint) return hint;
  }
  return "";
}

/** 项目行可见名（供单测）——**项目 = hip 文件**（v0.1.00116）后的优先级：
 *
 *  1. 有意义的 `label`（用户改过名）→ 原样用；
 *  2. 否则 `hipName`（如 `beginTest-1.hip`）—— 这才是现在的常态；
 *  3. 都没有 → 「未命名项目 · <最佳成员名>」（旧回退，成员也没线索则只写「未命名项目」）。
 *
 *  **任何情况下都不以序列号开头**；projectSerial 只进 title。 */
export function projectDisplayName(p: ProjectRef): string {
  const members = Array.isArray(p.members) ? p.members : [];
  const label = (p.label ?? "").trim();
  if (label && !isSerialTail(label, members)) return label;
  const hipName = (p.hipName ?? "").trim();
  if (hipName) return hipName;
  const hint = bestMemberLabel(members);
  return hint ? `${UNNAMED_PROJECT} · ${hint}` : UNNAMED_PROJECT;
}

/** hip 绝对路径的短形（供单测）：**只取尾部若干段**，前面用省略号省略。
 *  为什么不显示全路径：项目名已经是文件名，全路径会把行撑爆；但只有文件名又分不清
 *  `a/scene.hip` 与 `b/scene.hip`——所以留 2~3 段尾巴做辨识，全路径进 title。
 *  Windows `\` 与 POSIX `/` 都吃；段数不超过 keep 时原样返回（不加省略号）。 */
export function shortHipPath(hip: string, keep = 3): string {
  const raw = (hip ?? "").trim();
  if (!raw) return "";
  const sep = raw.includes("\\") ? "\\" : "/";
  const parts = raw.split(/[\\/]+/).filter((s) => s.length > 0);
  if (parts.length === 0) return "";
  const n = Math.max(1, Math.floor(keep) || 1);
  if (parts.length <= n) {
    // 段数本来就少：原样（POSIX 绝对路径保留打头的 `/`，否则 /tmp/a.hip 会变成 tmp/a.hip）
    const lead = raw.startsWith("/") ? "/" : "";
    return lead + parts.join(sep);
  }
  return `…${sep}${parts.slice(-n).join(sep)}`;
}

/** `已换绑` 徽标的时效窗口：超过这个时长就不再显示（瞬时信息不该永久占位）。
 *  取 10 分钟——比证据新鲜窗口（3 分钟）宽，因为"刚换绑过"值得多看一会儿，
 *  但远短于永久。 */
export const MIGRATED_BADGE_MS = 600_000;

/** 另存为迁移徽标（供单测）：`migratedAt` 在时效窗口内才有；previousHip 进 title。
 *  语气刻意平淡——迁移是正常操作（换绑文件），不是错误。 */
export function migratedBadgeHtml(p: ProjectRef, now: number = Date.now()): string {
  const at = p.migratedAt ?? 0;
  if (!at) return "";
  // 时效窗口（v0.1.00117 修）：`migratedAt` 是永久字段、没有任何东西会清它，
  // 所以原来这枚徽标一旦出现就**永久驻留**在文件名旁边（用户报的 bug）。
  // 「刚刚换绑过」是**瞬时**信息，过期就不该再占视觉位置；想追溯的话
  // hip 小字的 title 里始终有完整的 previousHip → hip。
  if (now - epochMs(at) > MIGRATED_BADGE_MS) return "";
  const prev = (p.previousHip ?? "").trim();
  const when = relSince(now - epochMs(at));
  const title = prev
    ? `${when}另存为迁移：原文件 ${prev} → 现文件 ${p.hip ?? ""}（成员已按新文件核对）`
    : `${when}另存为迁移（未记录原文件）`;
  return `<span class="ov-badge migrated" title="${esc(title)}">已换绑</span>`;
}

/** 新建项目的默认名（供单测）：留空时用「项目 N」（N = 现有项目数 + 1），
 *  保证新项目永远不会被按成员 serial 命名。 */
export function defaultProjectName(count: number): string {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `项目 ${n + 1}`;
}

// ---- 降级前实证（心跳 × 探测） ----
//
// 吊牌**只在 cook 时心跳**，坐着不 cook 一小时是正常的：单看心跳年龄就降级是「猜测
// 冒充事实」（实测线上一个健康吊牌心跳已 2938s）。所以心跳超时只是**触发探测的条件**，
// 结论由 `GET /api/projects/{pid}/anchors/{serial}/probe`（核对 mcp.health 的 pid）给出。

/** 一个锚点的探测缓存条目：in-flight / 本次探到的结论 / 探不动 / **持久化旧证据**。
 *
 *  `seeded` 是刷新网页后状态不掉的那一格：桥把每次探测结论写在锚点上
 *  （`AnchorRef.verifiedAt` / `verifiedAlive`），页面加载时拿它回填。
 *  但它是**过去的结论**，不是当前实测——所以类型上就与 `done` 分开，
 *  渲染时也必须说清「这是记录，不是刚探的」。 */
export type AnchorProbeEntry =
  | { status: "checking" }
  | { status: "done"; result: AnchorProbeResult }
  | { status: "error"; error: string }
  | { status: "seeded"; alive: boolean; verifiedAt: number };

/** 持久化证据的「新鲜」窗口：超过它就只算陈旧参考，不当结论用。
 *  取 3 分钟——探测本来就是一瞬间的快照，几分钟前的存活说明不了现在。 */
export const EVIDENCE_FRESH_MS = 180_000;

/** 持久化证据是否已陈旧（供单测：now 可注入）。verifiedAt=0（从未核实）按陈旧处理。 */
export function isStaleEvidence(verifiedAt: number, now: number = Date.now()): boolean {
  if (!verifiedAt) return true;
  return now - epochMs(verifiedAt) > EVIDENCE_FRESH_MS;
}

/** 由持久化锚点字段生成 seeded 条目（供单测）：从未核实过 → undefined（**不造结论**）。
 *  这是「刷新掉状态」的修复入口：页面加载时对每个锚点调它一次即可。 */
export function seedEntryFromAnchor(anchor: AnchorRef): AnchorProbeEntry | undefined {
  const at = anchor.verifiedAt ?? 0;
  if (!at) return undefined;
  return { status: "seeded", alive: anchor.verifiedAlive === true, verifiedAt: at };
}

/** 探测结果查表：serial -> 条目。Map 与普通对象都收（页面用 Map，单测用字面量）。 */
export type ProbeLookup = Map<string, AnchorProbeEntry> | Record<string, AnchorProbeEntry>;

function probeEntryOf(probes: ProbeLookup | undefined, serial: string): AnchorProbeEntry | undefined {
  if (!probes || !serial) return undefined;
  return probes instanceof Map ? probes.get(serial) : probes[serial];
}

/** 单个探测结论的语义判定（供单测）——**契约里最容易搞错的一格在这里**。
 *
 *  - `alive && pidMatched` → `"alive"`：同一个 Houdini 实例确认活着（只是没 cook）。
 *  - `alive && !pidMatched` → `"replaced"`：端口有人应答，但**已经是另一个进程**
 *    （Houdini 重启/被替换）。吊牌所属实例已经没了，**绝不能算健康**。
 *  - `!alive` → `"dead"`：没人应答，确认不可达。
 *  - `expectedPid === 0` → `"unverifiable"`：吊牌从没上报过 pid（旧版 HDA），
 *    无从核对，只能照实说「无法核实」而不是给个假结论。 */
export function probeVerdict(r: AnchorProbeResult): "alive" | "replaced" | "dead" | "unverifiable" {
  if (r.expectedPid === 0) return "unverifiable";
  if (!r.alive) return "dead";
  return r.pidMatched ? "alive" : "replaced";
}

/** 项目里出现过的锚点 serial（去重保序）：探测按锚点做，故状态灯按成员 serial 查表。 */
export function anchorSerialsOf(p: ProjectRef): string[] {
  const members = Array.isArray(p.members) ? p.members : [];
  const out: string[] = [];
  for (const m of members) {
    const s = (m.serial ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** 项目聚合状态灯（供单测）。
 *
 *  **必须传 liveSeen**：`project.members` 是加入项目时的**引用快照**，其 `lastSeen`
 *  自那一刻起就不再更新（`projects.py` 明确写了「live 状态以 /api/channels 大全为准」）。
 *  只看快照会把活着的成员判成离线——实测快照 13081s vs live 2938s。
 *  liveSeen = 通道 key -> 该通道的 live lastSeen（由 /api/channels 大全构建）。
 *
 *  第 4 参 `probes`（可选，**追加不改序**：既有 3 参调用与单测原样有效）= 按锚点
 *  serial 缓存的探测结论。心跳新鲜时**根本不看** probes（省一次 Houdini 往返）；
 *  只有心跳超时——本会降级的那一刻——才拿探测结论说话：
 *
 *  | 心跳 | 探测 | 状态 | 文案 |
 *  |---|---|---|---|
 *  | 新鲜 | 不看 | online | `在线 n/m` |
 *  | 超时 | 无（未探） | offline | `无心跳`（可能只是没 cook） |
 *  | 超时 | in-flight | checking | `检测中…` |
 *  | 超时 | alive+pid 匹配 | idle | `在线（未 cook）` |
 *  | 超时 | alive 但 pid 不匹配 / 不 alive | gone | `失联` |
 *  | 超时 | expectedPid=0 | offline | `无心跳（无法核实）` |
 *  | 超时 | seeded（新鲜，存活） | idle | `在线（未 cook·据记录）` |
 *  | 超时 | seeded（新鲜，未确认） | gone | `失联（据记录）` |
 *  | 超时 | seeded（陈旧） | stale | `旧记录：…`（仅供参考，非当前结论） |
 *
 *  注意 `无心跳` 不是 `离线`：心跳年龄证不了「不在了」，这层诚实要留着。
 *  同理 seeded（桥持久化的旧探测结论）**永远排在本次实测之后**，且文案自带
 *  「据记录 / 旧记录」标注——把旧结论渲染成新结论正是本轮要消灭的「猜测冒充事实」。 */
export function projectStatusLight(
  p: ProjectRef,
  now: number = Date.now(),
  liveSeen?: Record<string, number>,
  probes?: ProbeLookup,
): {
  state: "online" | "offline" | "empty" | "idle" | "checking" | "gone" | "stale";
  text: string;
  title: string;
} {
  const members = Array.isArray(p.members) ? p.members : [];
  if (members.length === 0) return { state: "empty", text: "空", title: "项目还没有成员" };
  const seenOf = (m: ChannelRef): number => {
    const key = channelIdOf(m);
    const live = liveSeen?.[key];
    // live 值优先；缺失时退回快照（比什么都不显示好，但可能偏旧）
    return typeof live === "number" && live > 0 ? live : m.lastSeen;
  };
  const live = members.filter((m) => now - epochMs(seenOf(m)) <= OFFLINE_MS).length;
  if (live > 0) {
    return { state: "online", text: `在线 ${live}/${members.length}`, title: `${live} 个成员心跳正常` };
  }

  // 心跳全超时：本该降级——先看有没有实证，再决定说什么。
  const serials = anchorSerialsOf(p);
  const entries = serials.map((s) => ({ serial: s, entry: probeEntryOf(probes, s) }));
  const verdicts = entries
    .filter((e) => e.entry?.status === "done")
    .map((e) => ({ serial: e.serial, r: (e.entry as { status: "done"; result: AnchorProbeResult }).result }))
    .map((e) => ({ ...e, v: probeVerdict(e.r) }));

  // 有任何一个锚点被证实活着 → 进程在，只是没 cook。这是真话，不是降级。
  const aliveOnes = verdicts.filter((e) => e.v === "alive");
  if (aliveOnes.length > 0) {
    const hips = aliveOnes.map((e) => `${e.serial} pid ${e.r.actualPid}${e.r.hip ? ` · ${e.r.hip}` : ""}`);
    return {
      state: "idle",
      text: "在线（未 cook）",
      title: `探测确认实例存活，只是最近没 cook：${hips.join("；")}`,
    };
  }

  // 没有活着的，但有确证「没了」的 → 失联（含 pid 不匹配 = 实例被换掉）。
  const goneOnes = verdicts.filter((e) => e.v === "dead" || e.v === "replaced");
  if (goneOnes.length > 0) {
    const replaced = goneOnes.filter((e) => e.v === "replaced");
    const why = goneOnes
      .map((e) =>
        e.v === "replaced"
          ? `${e.serial}：端口 ${e.r.port} 上是另一个进程（期望 pid ${e.r.expectedPid}，实际 ${e.r.actualPid}）`
          : `${e.serial}：无人应答${e.r.reason ? `（${e.r.reason}）` : ""}`,
      )
      .join("；");
    return {
      state: "gone",
      text: replaced.length > 0 && replaced.length === goneOnes.length ? "失联（实例已换）" : "失联",
      title: `探测确认吊牌所属 Houdini 实例已不在：${why}`,
    };
  }

  // 探测中（还没有任何结论）→ 别急着下判断。
  if (entries.some((e) => e.entry?.status === "checking")) {
    return { state: "checking", text: "检测中…", title: "正在核对 Houdini 实例（mcp.health + pid）…" };
  }

  // 有结论但全是「无法核实」（旧版吊牌没上报 pid）→ 照实说，不给假判决。
  if (verdicts.length > 0 && verdicts.every((e) => e.v === "unverifiable")) {
    return {
      state: "offline",
      text: "无心跳（无法核实）",
      title: "吊牌没上报 pid（旧版 HDA），无法核对实例存活；心跳超时只说明最近没 cook",
    };
  }

  // 本次会话没探过，但**桥上有持久化的旧结论** → 用它，但绝不装成刚探的。
  // 这是「刷新网页掉状态」的修复点：状态来自后端持久化字段，而不是页面内存。
  const seeds = entries
    .filter((e) => e.entry?.status === "seeded")
    .map((e) => ({ serial: e.serial, s: e.entry as { status: "seeded"; alive: boolean; verifiedAt: number } }));
  if (seeds.length > 0) {
    const recent = seeds.filter((e) => !isStaleEvidence(e.s.verifiedAt, now));
    const recentAlive = recent.filter((e) => e.s.alive);
    if (recentAlive.length > 0) {
      const when = relSince(now - epochMs(recentAlive[0].s.verifiedAt));
      return {
        // 文案上明写「据记录」：与刚探出来的「在线（未 cook）」一眼分得开。
        state: "idle",
        text: "在线（未 cook·据记录）",
        title: `${when}的探测记录显示实例存活（桥持久化的 verifiedAlive，非本次实测）：${recentAlive
          .map((e) => e.serial)
          .join("；")}。点「检测」取当前结论。`,
      };
    }
    if (recent.length > 0) {
      const when = relSince(now - epochMs(recent[0].s.verifiedAt));
      return {
        state: "gone",
        text: "失联（据记录）",
        title: `${when}的探测记录未能确认实例存活（桥持久化的 verifiedAlive=false，非本次实测）：${recent
          .map((e) => e.serial)
          .join("；")}。点「检测」取当前结论。`,
      };
    }
    // 全是陈旧证据（超过新鲜窗口）→ 单独一档，**明说是旧记录且仅供参考**。
    const newest = seeds.reduce((a, b) => (b.s.verifiedAt > a.s.verifiedAt ? b : a));
    const when = relSince(now - epochMs(newest.s.verifiedAt));
    return {
      state: "stale",
      text: newest.s.alive ? "旧记录：存活" : "旧记录：未确认",
      title: `仅供参考，非当前结论：最近一次探测在${when}（${
        newest.s.alive ? "当时存活" : "当时未确认存活"
      }），已超过 ${Math.round(EVIDENCE_FRESH_MS / 60_000)} 分钟。心跳同时超时（吊牌只在 cook 时心跳）。点「检测」取当前结论。`,
    };
  }

  // 探不动（桥离线 / 接口未就绪）→ 退回诚实的「无心跳」，并把原因写进 title。
  const errs = entries
    .filter((e) => e.entry?.status === "error")
    .map((e) => `${e.serial}：${(e.entry as { status: "error"; error: string }).error}`);
  if (errs.length > 0) {
    return {
      state: "offline",
      text: "无心跳",
      title: `心跳超时且探测失败（吊牌只在 cook 时心跳，未必不在）：${errs.join("；")}`,
    };
  }

  // 从未探测：保持原有诚实文案 —— 不断言节点已死。
  return {
    state: "offline",
    text: "无心跳",
    title: `${members.length} 个成员最近都没有心跳（吊牌只在 cook 时心跳，可能只是没 cook；点「检测」核实存活）`,
  };
}

/** 一条映射行的全部渲染输入（entries + resolved + anchors 按逻辑名对齐）。 */
export interface MappingRow {
  name: string;
  entry: MappingEntry;
  resolved?: MappingResolved;
  anchor?: AnchorRef;
}

/** MappingsResponse → 按逻辑名排序的行列表（供单测）。 */
export function mappingRows(res: MappingsResponse): MappingRow[] {
  const entries = res.entries ?? {};
  return Object.keys(entries)
    .sort()
    .map((name) => ({
      name,
      entry: entries[name],
      resolved: res.resolved?.[name],
      anchor: res.anchors?.[entries[name].anchor],
    }));
}

/** 值输入框的占位提示（供单测）：按类型给出该行**实际**的值形状。
 *  实测（live Houdini）：float 行是裸数字 `0.18`；vec3 行是**对象**
 *  `{"ctrl":"…","t":[…],"r":[…]}`——不是三元数组，也不是标量，故分开提示。 */
export function valuePlaceholder(type: string): string {
  if (type === "vec3") return '对象，如 {"t":[0,1,0],"r":[0,0,0]}';
  if (type === "float") return "数字，如 .2 / 0.18";
  return "值（JSON 或裸数字）";
}

/** 锚点 pid/端口的可见文案（供单测）——这是「降级前实证」要用的证据本身，
 *  所以摆在映射面板里给人看，而不是只写进日志。
 *  `pid === 0` = 吊牌从没上报过（旧版 HDA），明说「未上报 pid（旧版吊牌）」，
 *  而不是干巴巴显示一个 `0` 让人误以为进程号真是 0。 */
export function anchorPidText(anchor?: AnchorRef): string {
  if (!anchor) return "";
  if (!anchor.pid) return "未上报 pid（旧版吊牌）";
  const port = anchor.mcpPort ? `:${anchor.mcpPort}` : ":未发现端口";
  return `pid ${anchor.pid}${port}`;
}

/** 锚点证据的 title 全景（供单测）：hip / 最近心跳 / 最近核实。
 *  `now` 可注入，单测才能固定时钟。 */
export function anchorEvidenceTitle(anchor: AnchorRef, now: number = Date.now()): string {
  const bits = [`锚点 ${anchor.serial}`];
  if (anchor.hip) bits.push(`hip ${anchor.hip}`);
  bits.push(anchor.pid ? `pid ${anchor.pid}` : "pid 未上报（旧版吊牌，无法核实存活）");
  bits.push(anchor.mcpPort ? `MCP 端口 ${anchor.mcpPort}` : "MCP 端口未发现");
  bits.push(anchor.lastSeen ? `最近心跳 ${relSince(now - epochMs(anchor.lastSeen))}（吊牌只在 cook 时心跳）` : "从未心跳");
  if (anchor.verifiedAt) {
    // 旧的核实结论只是**参考**，不当当前判决：所以文案写「（仅供参考）」。
    bits.push(
      `最近核实 ${relSince(now - epochMs(anchor.verifiedAt))}：${anchor.verifiedAlive ? "存活" : "未确认存活"}（仅供参考，非当前结论）`,
    );
  } else {
    bits.push("尚未核实过存活");
  }
  return bits.join(" · ");
}

/** 映射行 HTML（供单测）：逻辑名 / 类型 / 绝对路径 / 值 / 锚点状态 / 解绑。
 *  - resolved.ok === false → 行加 .broken 并显示 error（解析不出绝对路径，值也没法读写）
 *  - anchor.movedAt > 0 → 「已移动」徽标 + 当前路径（正常状态，不是错误）
 *  - type=geo → 值列不给输入框（几何走数据流，不经映射读写）
 *  - 解绑按钮恒给（断裂/几何行同样需要能清掉） */
export function mappingRowHtml(row: MappingRow): string {
  const { name, entry, resolved, anchor } = row;
  const ok = resolved?.ok !== false;
  const path = resolved?.absolutePath ?? "";
  const editable = entry.type !== "geo" && ok;
  const valueCell = editable
    ? `<input class="ov-map-input" type="text" data-map-name="${esc(name)}" data-map-type="${esc(entry.type)}" placeholder="${esc(valuePlaceholder(entry.type))}" />` +
      `<button class="ov-open" type="button" data-map-read="${esc(name)}">读值</button>` +
      `<button class="ov-open" type="button" data-map-write="${esc(name)}">写值</button>`
    : `<span class="ov-map-novalue">${entry.type === "geo" ? "几何流" : "不可读写"}</span>`;

  const anchorBits: string[] = [];
  if (anchor && anchor.movedAt > 0) {
    anchorBits.push(`<span class="ov-badge moved" title="锚点已移动（正常：逻辑名不变，路径自动跟随）">已移动</span>`);
  }
  anchorBits.push(
    `<small class="ov-anchor-path" title="${esc(anchor?.nodePath ?? entry.anchor)}">${esc(anchor?.nodePath ?? entry.anchor)}</small>`,
  );
  // pid/端口证据：用户要求记录的东西，就得看得见。
  if (anchor) {
    const pidText = anchorPidText(anchor);
    const cls = anchor.pid ? "ov-anchor-pid" : "ov-anchor-pid nopid";
    anchorBits.push(`<small class="${cls}" title="${esc(anchorEvidenceTitle(anchor))}">${esc(pidText)}</small>`);
  }

  return `
    <div class="ov-row mappings${ok ? "" : " broken"}" data-map-row="${esc(name)}">
      <div class="ov-cell ov-label" title="${esc(name)}">${esc(name)}</div>
      <div class="ov-cell"><span class="ov-kind ${esc(entry.type)}">${esc(entry.type)}</span></div>
      <div class="ov-cell ov-map-path" title="${esc(ok ? path : (resolved?.error ?? ""))}">${
        ok ? esc(path) : `<span class="ov-map-error">${esc(resolved?.error ?? "解析失败")}</span>`
      }</div>
      <div class="ov-cell ov-map-value" data-map-value="${esc(name)}">${valueCell}</div>
      <div class="ov-cell ov-anchor">${anchorBits.join("")}</div>
      <div class="ov-cell ov-action"><button class="ov-remove" type="button" data-map-delete="${esc(name)}">解绑</button></div>
    </div>`;
}

/** 映射值输入解析（供单测）：**直接委托** parseChannelValue，
 *  故 `.2` / `{"t":[0,1,0]}` 照旧可用（禁止在此重写解析或用 JSON.parse）。 */
export function parseMappingInput(raw: string): unknown {
  return parseChannelValue(raw);
}

/** 刷新按钮在「检测全部」期间的文案（供单测）：total=0 → 恢复「刷新」。 */
export function probeProgressLabel(done: number, total: number): string {
  if (total <= 0) return "刷新";
  return `检测中 ${Math.min(done, total)}/${total}…`;
}

/** 清理结果文案（供单测）：removed 为空说明没有空项目。 */
export function cleanupSummary(removed: string[]): string {
  if (removed.length === 0) return "没有空项目";
  const preview = removed.slice(0, 5).join("、") + (removed.length > 5 ? "…" : "");
  return `已清理 ${removed.length} 个空项目：${preview}`;
}

// ============ 页面（DOM）。单测 node 环境无 document 时整块跳过，纯函数照常可导入。 ============
if (typeof document !== "undefined") {
  function $(sel: string): HTMLElement {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing element: ${sel}`);
    return el as HTMLElement;
  }

  const banner = $("#ov-banner");
  const refreshBtn = $("#ov-refresh") as HTMLButtonElement;

  function setBanner(kind: "offline" | "error" | "ok", text: string): void {
    banner.textContent = text;
    banner.className = `ov-banner ${kind === "ok" ? "hidden" : kind}`;
  }

  function openSerial(serial: string): void {
    location.href = `/?serial=${encodeURIComponent(serial)}`;
  }

  function openProject(pid: string): void {
    location.href = `/?project=${encodeURIComponent(pid)}`;
  }

  const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  /** 按 dataset 值查元素：逻辑名/serial 可含引号，直接拼进属性选择器会炸，
   *  故用 selector 粗筛 + dataset 精确比对。 */
  function findByData<T extends HTMLElement>(
    root: HTMLElement,
    selector: string,
    key: string,
    value: string,
  ): T | null {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
      if (el.dataset[key] === value) return el as T;
    }
    return null;
  }

  // ---------------- 1) 项目（主入口） ----------------
  const projectsClient = new BridgeClient();
  const projectsHint = $("#projects-hint");
  const projectsError = $("#projects-error");
  const projectsList = $("#projects-list");
  const projectsRefresh = $("#projects-refresh") as HTMLButtonElement;
  const projectsCleanup = $("#projects-cleanup") as HTMLButtonElement;
  const projectsCleanupResult = $("#projects-cleanup-result");
  const projectName = $("#project-name") as HTMLInputElement;
  const projectNew = $("#project-new") as HTMLButtonElement;

  /** 展开中的项目 serial（映射区跟随它；单选，展开即成为「聚焦项目」）。 */
  let expandedProject: string | null = new URLSearchParams(location.search).get("project");
  /** 正在改名的项目 serial（渲染成行内 input）。 */
  let editingProject: string | null = null;
  /** 通道 key -> live lastSeen（每次 loadProjects 从 /api/channels 大全重建）。
   *  成员快照的 lastSeen 是冻结值，状态灯必须看这张表，见 projectStatusLight 注释。 */
  let liveSeenByChannel: Record<string, number> = {};
  /** 锚点 serial -> 探测缓存。**按需**填充，绝不在渲染/轮询路径上探：
   *  一次探测 = 一次 Houdini 往返，放进 render 就等于每帧都问 Houdini。
   *  刷新（loadProjects）故意**不清**这张表：结论比心跳年龄有价值得多，
   *  留着显示（陈旧与否由用户再点「检测」决定）。
   *  页面加载时还会用桥持久化的 verifiedAt/verifiedAlive 回填 `seeded` 条目，
   *  所以**刷新网页不再掉状态**（seeded 与实测在类型上分开，文案也分开）。 */
  const probeByAnchor = new Map<string, AnchorProbeEntry>();
  /** 已自动探过一次的项目（展开时自动探一次，之后只认手动点「检测」）。 */
  const autoProbed = new Set<string>();
  /** 「检测全部」进行中的进度（done/total）；total=0 表示没在跑。 */
  let probeAllProgress = { done: 0, total: 0 };

  /** 拉通道大全（只为取 live lastSeen；失败由调用方退回快照）。 */
  async function fetchChannels(): Promise<{ channels: ChannelRef[] }> {
    const res = await fetch(`${BRIDGE_URL}/api/channels`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new HttpError(res.status);
    return (await res.json()) as { channels: ChannelRef[] };
  }

  function showProjectsError(msg: string): void {
    projectsError.textContent = msg;
    projectsError.classList.remove("hidden");
  }
  function hideProjectsError(): void {
    projectsError.classList.add("hidden");
  }

  /** 按需探测一个项目的全部锚点（并发），结束后只重渲染项目列表。
   *  同一锚点已在 in-flight 时跳过，避免连点打出一串往返。 */
  async function probeProject(pid: string): Promise<void> {
    const p = projectsStore.projects.find((x) => x.projectSerial === pid);
    if (!p) return;
    const serials = anchorSerialsOf(p).filter((s) => probeByAnchor.get(s)?.status !== "checking");
    if (serials.length === 0) return;
    for (const s of serials) probeByAnchor.set(s, { status: "checking" });
    renderProjects(projectsStore.projects);
    await Promise.all(
      serials.map(async (s) => {
        const r = await probeAnchor(pid, s); // 不抛：失败也是普通结果
        probeByAnchor.set(s, "ok" in r ? { status: "error", error: r.error } : { status: "done", result: r });
      }),
    );
    renderProjects(projectsStore.projects);
  }

  /** 刷新按钮的进度文案（同步 projects 面板与顶部两个按钮）。 */
  function syncRefreshButtons(): void {
    const { done, total } = probeAllProgress;
    const running = total > 0;
    projectsRefresh.disabled = running;
    projectsRefresh.textContent = running ? probeProgressLabel(done, total) : "刷新";
    refreshBtn.disabled = running || refreshBtn.dataset.busy === "1";
  }

  /** 检测**全部**项目的锚点（刷新按钮的语义修复点）。
   *
   *  - 并发有界（PROBE_CONCURRENCY，默认 5）：每个探测都是一次 Houdini 往返，
   *    项目多了不能一把梭；但也不能串行等一整轮。
   *  - 同一 serial 只探一次（多个项目共享锚点时去重）。
   *  - 单个失败不影响其余（probeAnchor 不抛，mapWithLimit 再兜一层）。
   *  - 按钮显示 `检测中 3/9…` 并禁用；**没有任何定时器**——只在显式刷新时跑。 */
  async function probeAllProjects(): Promise<void> {
    if (probeAllProgress.total > 0) return; // 已经在跑：别叠一轮
    const tasks: { pid: string; serial: string }[] = [];
    const seen = new Set<string>();
    for (const p of projectsStore.projects) {
      for (const s of anchorSerialsOf(p)) {
        if (seen.has(s)) continue;
        seen.add(s);
        tasks.push({ pid: p.projectSerial, serial: s });
      }
    }
    if (tasks.length === 0) return;
    probeAllProgress = { done: 0, total: tasks.length };
    for (const t of tasks) probeByAnchor.set(t.serial, { status: "checking" });
    syncRefreshButtons();
    renderProjects(projectsStore.projects);
    await mapWithLimit(tasks, PROBE_CONCURRENCY, async (t) => {
      const r = await probeAnchor(t.pid, t.serial); // 不抛：失败也是普通结果
      probeByAnchor.set(t.serial, "ok" in r ? { status: "error", error: r.error } : { status: "done", result: r });
      probeAllProgress = { done: probeAllProgress.done + 1, total: probeAllProgress.total };
      syncRefreshButtons();
      renderProjects(projectsStore.projects); // 逐个亮灯，用户能看到进度
    });
    probeAllProgress = { done: 0, total: 0 };
    syncRefreshButtons();
    renderProjects(projectsStore.projects);
  }

  /** 用桥持久化的锚点证据（verifiedAt/verifiedAlive）回填状态 —— **刷新网页不掉状态**。
   *
   *  证据只能从 `GET /api/projects/{pid}/mappings` 的 anchors 拿（桥没有大全端点），
   *  故按项目并发拉取（EVIDENCE_CONCURRENCY 有界；这是桥本地 JSON，不碰 Houdini）。
   *  只填**空位**：本次会话已有 checking/done/error 的锚点不覆盖（实测优先于记录）。 */
  async function seedProbesFromPersisted(list: ProjectRef[]): Promise<void> {
    const pids = list.filter((p) => anchorSerialsOf(p).length > 0).map((p) => p.projectSerial);
    if (pids.length === 0) return;
    let filled = 0;
    await mapWithLimit(pids, EVIDENCE_CONCURRENCY, async (pid) => {
      const res = await fetchMappings(pid); // 抛错由 mapWithLimit 兜住（该项目无证据即可）
      for (const anchor of Object.values(res.anchors ?? {})) {
        const cur = probeByAnchor.get(anchor.serial);
        if (cur && cur.status !== "seeded") continue; // 本次实测/在飞的不动
        const seed = seedEntryFromAnchor(anchor);
        if (!seed) continue;
        probeByAnchor.set(anchor.serial, seed);
        filled++;
      }
    });
    if (filled > 0) renderProjects(projectsStore.projects);
  }

  /** 展开时自动探一次：**只一次**（记在 autoProbed 里），之后要新结论就手动点「检测」。
   *  刻意不在这里做定时/轮询——一次探测就是一次 Houdini 往返。 */
  async function autoProbeOnce(pid: string): Promise<void> {
    if (autoProbed.has(pid)) return;
    autoProbed.add(pid);
    await probeProject(pid);
  }

  function projectRowHtml(p: ProjectRef): string {
    const members = Array.isArray(p.members) ? p.members : [];
    const pid = p.projectSerial;
    const light = projectStatusLight(p, Date.now(), liveSeenByChannel, probeByAnchor);
    const expanded = expandedProject === pid;
    const checking = anchorSerialsOf(p).some((s) => probeByAnchor.get(s)?.status === "checking");
    // 名字列：改名中 → 行内 input（回车提交 / Esc 取消）；否则「hip 文件名 + 短路径」，
    // 序列号只进 title。短路径是**次要文字**（独立小字行），不塞进名字里。
    const hip = (p.hip ?? "").trim();
    const short = shortHipPath(hip);
    const nameCell =
      editingProject === pid
        ? `<input class="ov-name-input" type="text" data-rename-input="${esc(pid)}" value="${esc(p.label ?? "")}" placeholder="项目名称" />`
        : `<span class="ov-project-name" title="${esc(pid)}">${esc(projectDisplayName(p))}</span>` +
          migratedBadgeHtml(p) +
          (short ? `<small class="ov-project-hip" title="${esc(hip)}">${esc(short)}</small>` : "");
    return `
    <div class="ov-row projects${expanded ? " focused" : ""}${light.state === "gone" ? " probe-gone" : ""}" data-project-serial="${esc(pid)}">
      <div class="ov-cell ov-label">${nameCell}</div>
      <div class="ov-cell ov-count">${members.length} 成员</div>
      <div class="ov-cell ov-seen ${light.state}"><span class="ov-state" title="${esc(light.title)}">${esc(light.text)}</span></div>
      <div class="ov-cell ov-action">
        <button class="ov-open" type="button" data-open-project="${esc(pid)}">打开</button>
        <button class="ov-probe" type="button" data-probe="${esc(pid)}"${checking ? " disabled" : ""} title="核对该项目锚点所属 Houdini 实例（mcp.health + pid）；心跳超时未必失联">${checking ? "检测中…" : "检测"}</button>
        <button class="ov-expand" type="button" data-expand="${esc(pid)}">${expanded ? "收起映射" : "映射"}</button>
        <button class="ov-expand" type="button" data-rename="${esc(pid)}">改名</button>
        <button class="ov-remove" type="button" data-delete-project="${esc(pid)}">删除</button>
      </div>
    </div>`;
  }

  function renderProjects(list: ProjectRef[]): void {
    projectsList.innerHTML = list.map(projectRowHtml).join("");
    projectsHint.classList.toggle("hidden", list.length > 0);
    projectsHint.textContent = list.length ? "" : "暂无项目（点「新建项目」开始）";
    // 顶部「打开主应用」指向最近更新的项目；完全没有项目时才回退空 ?serial=
    // （index.html 的入口守卫用 has() 判定，空值仍会加载主应用而不重定向回本页）。
    const openApp = document.getElementById("ov-open-app") as HTMLAnchorElement | null;
    if (openApp) {
      const newest = list.reduce<ProjectRef | null>(
        (best, p) => (best === null || epochMs(p.updatedAt) > epochMs(best.updatedAt) ? p : best),
        null,
      );
      openApp.href = newest ? `/?project=${encodeURIComponent(newest.projectSerial)}` : "/?serial=";
    }
    if (editingProject) {
      const input = findByData<HTMLInputElement>(projectsList, "input[data-rename-input]", "renameInput", editingProject);
      input?.focus();
      input?.select();
    }
  }

  /** 拉项目列表并渲染。
   *
   *  `probeAll=true`（用户点「刷新」时）→ 列完之后**检测每一个**有锚点的项目，
   *  而不是只更新列表把状态灯留在「无心跳」。首次加载传 false：状态由桥持久化
   *  证据回填（seedProbesFromPersisted），不平白打一轮 Houdini 往返。 */
  async function loadProjects(probeAll = false): Promise<void> {
    projectsRefresh.disabled = true;
    hideProjectsError();
    projectsHint.classList.remove("hidden");
    projectsHint.textContent = "加载中…";
    projectsList.innerHTML = "";
    try {
      const { projects } = await projectsClient.listProjects();
      projectsStore.setProjects(projects);
      // 同时拉通道大全构建 live lastSeen 表：成员快照的 lastSeen 是加入时的冻结值，
      // 只看它会把活着的成员判成离线（实测快照 13081s vs live 2938s）。
      // 拉不到就退回快照（状态灯偏旧但页面照常可用）。
      try {
        const { channels } = await fetchChannels();
        liveSeenByChannel = Object.fromEntries(
          channels.map((c) => [channelIdOf(c), typeof c.lastSeen === "number" ? c.lastSeen : 0]),
        );
      } catch {
        liveSeenByChannel = {};
      }
      // ?project= / 展开态在列表里已不存在时清掉，避免映射区指向幽灵项目。
      if (expandedProject && !projects.some((p) => p.projectSerial === expandedProject)) expandedProject = null;
      renderProjects(projects);
      if (expandedProject) {
        void loadMappings(expandedProject);
        void autoProbeOnce(expandedProject); // ?project= 直达时也核实一次（仍是每项目一次）
      } else renderMappingsIdle();
      // 刷新网页后状态不掉：先用桥持久化的 verifiedAt/verifiedAlive 回填（标注为记录）。
      await seedProbesFromPersisted(projects);
      // 用户点「刷新」= 「检测一下所有节点的状态」：实测覆盖掉上面的记录。
      if (probeAll) await probeAllProjects();
    } catch (err) {
      projectsStore.setProjects([]);
      renderProjects([]);
      showProjectsError(
        err instanceof HttpError
          ? `桥返回 HTTP ${err.status}：/api/projects 未就绪？`
          : "桥离线：无法连接 127.0.0.1:8375，项目列表不可用。",
      );
      setBanner("offline", "桥离线：无法连接 127.0.0.1:8375，项目与场景列表不可用；新建也需要桥在线。");
    } finally {
      syncRefreshButtons(); // 探测跑完才解禁（probeAllProgress.total 归零后）
    }
  }

  async function createProject(): Promise<void> {
    hideProjectsError();
    projectNew.disabled = true;
    projectNew.textContent = "创建中…";
    // 留空 → 「项目 N」；绝不让桥按成员 serial 自动命名。
    const label = projectName.value.trim() || defaultProjectName(projectsStore.projects.length);
    try {
      await projectsClient.createProject(label);
      projectName.value = "";
      await loadProjects();
    } catch (err) {
      showProjectsError(`新建项目失败：${errText(err)}`);
    } finally {
      projectNew.disabled = false;
      projectNew.textContent = "新建项目";
    }
  }

  async function submitRename(pid: string, label: string): Promise<void> {
    hideProjectsError();
    editingProject = null;
    try {
      await patchProjectLabel(pid, label);
      await loadProjects();
    } catch (err) {
      showProjectsError(`改名失败：${errText(err)}`);
      renderProjects(projectsStore.projects);
    }
  }

  async function removeProject(pid: string): Promise<void> {
    const p = projectsStore.projects.find((x) => x.projectSerial === pid);
    const name = p ? projectDisplayName(p) : pid;
    if (!window.confirm(`删除项目「${name}」？\n（${pid}）\n项目本身会被移除，场景/序列号不受影响。`)) return;
    hideProjectsError();
    try {
      const { removed } = await deleteProject(pid);
      if (expandedProject === pid) expandedProject = null;
      // removed:false = 桥说这个 pid 本来就不存在（200 而非 404，刻意的宽松语义）。
      // 结果与用户诉求一致（它没了），所以只给灰字提示 + 刷新，不报错。
      if (!removed) {
        projectsCleanupResult.textContent = "该项目已不存在（列表已刷新）";
        projectsCleanupResult.title = pid;
        projectsCleanupResult.className = "ov-projects-cleanup-result none";
      }
      await loadProjects();
    } catch (err) {
      showProjectsError(`删除失败：${errText(err)}`);
    }
  }

  async function runProjectsCleanup(): Promise<void> {
    projectsCleanup.disabled = true;
    projectsCleanup.textContent = "清理中…";
    projectsCleanupResult.classList.add("hidden");
    try {
      const { removed } = await cleanupProjects();
      projectsCleanupResult.textContent = cleanupSummary(removed);
      projectsCleanupResult.title = removed.join("\n");
      projectsCleanupResult.className = `ov-projects-cleanup-result ${removed.length ? "ok" : "none"}`;
      await loadProjects();
    } catch (err) {
      projectsCleanupResult.textContent = `清理失败：${errText(err)}`;
      projectsCleanupResult.title = "";
      projectsCleanupResult.className = "ov-projects-cleanup-result err";
    } finally {
      projectsCleanup.disabled = false;
      projectsCleanup.textContent = "清理空项目";
    }
  }

  // 「刷新」= 重新列项目 **并检测每一个项目的锚点状态**（用户诉求 2）。
  projectsRefresh.addEventListener("click", () => void loadProjects(true));
  projectsCleanup.addEventListener("click", () => void runProjectsCleanup());
  projectNew.addEventListener("click", () => void createProject());
  projectName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void createProject();
  });

  projectsList.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const open = target.closest?.("button[data-open-project]") as HTMLElement | null;
    if (open) {
      openProject(open.dataset.openProject ?? "");
      return;
    }
    const probe = target.closest?.("button[data-probe]") as HTMLElement | null;
    if (probe) {
      void probeProject(probe.dataset.probe ?? "");
      return;
    }
    const expand = target.closest?.("button[data-expand]") as HTMLElement | null;
    if (expand) {
      const pid = expand.dataset.expand ?? "";
      expandedProject = expandedProject === pid ? null : pid;
      renderProjects(projectsStore.projects);
      if (expandedProject) {
        void loadMappings(expandedProject);
        void autoProbeOnce(expandedProject); // 展开时自动核实一次（每项目仅一次）
      } else renderMappingsIdle();
      return;
    }
    const rename = target.closest?.("button[data-rename]") as HTMLElement | null;
    if (rename) {
      editingProject = rename.dataset.rename ?? null;
      renderProjects(projectsStore.projects);
      return;
    }
    const del = target.closest?.("button[data-delete-project]") as HTMLElement | null;
    if (del) void removeProject(del.dataset.deleteProject ?? "");
  });

  // 行内改名：回车提交 / Esc 取消 / 失焦提交（失焦提交是为了少一次点击）。
  projectsList.addEventListener("keydown", (e) => {
    const input = (e.target as HTMLElement).closest?.("input[data-rename-input]") as HTMLInputElement | null;
    if (!input) return;
    if (e.key === "Enter") void submitRename(input.dataset.renameInput ?? "", input.value.trim());
    else if (e.key === "Escape") {
      editingProject = null;
      renderProjects(projectsStore.projects);
    }
  });
  projectsList.addEventListener(
    "blur",
    (e) => {
      const input = (e.target as HTMLElement).closest?.("input[data-rename-input]") as HTMLInputElement | null;
      if (input && editingProject) void submitRename(input.dataset.renameInput ?? "", input.value.trim());
    },
    true,
  );

  // ---------------- 2) 映射（跟随展开的项目） ----------------
  const mappingsHint = $("#mappings-hint");
  const mappingsError = $("#mappings-error");
  const mappingsList = $("#mappings-list");
  const mappingsOf = $("#mappings-of");
  const mappingsRefresh = $("#mappings-refresh") as HTMLButtonElement;

  function renderMappingsIdle(): void {
    mappingsList.innerHTML = "";
    mappingsError.classList.add("hidden");
    mappingsOf.textContent = "";
    mappingsHint.classList.remove("hidden");
    mappingsHint.textContent = "展开一个项目（点项目行的「映射」）查看它的映射。";
  }

  async function loadMappings(pid: string): Promise<void> {
    mappingsRefresh.disabled = true;
    mappingsError.classList.add("hidden");
    mappingsList.innerHTML = "";
    mappingsHint.classList.remove("hidden");
    mappingsHint.textContent = "加载中…";
    const p = projectsStore.projects.find((x) => x.projectSerial === pid);
    mappingsOf.textContent = p ? projectDisplayName(p) : pid;
    mappingsOf.title = pid;
    try {
      const res = await fetchMappings(pid);
      const rows = mappingRows(res);
      mappingsList.innerHTML = rows.map(mappingRowHtml).join("");
      mappingsHint.classList.toggle("hidden", rows.length > 0);
      mappingsHint.textContent = rows.length ? "" : "该项目还没有映射（吊牌标记参数后出现）。";
    } catch (err) {
      mappingsHint.classList.add("hidden");
      mappingsError.textContent = `映射不可用：${errText(err)}（桥 127.0.0.1:8375 是否在运行 / 接口是否就绪？）`;
      mappingsError.classList.remove("hidden");
    } finally {
      mappingsRefresh.disabled = false;
    }
  }

  function mappingInput(name: string): HTMLInputElement | null {
    return findByData<HTMLInputElement>(mappingsList, "input[data-map-name]", "mapName", name);
  }

  /** 读/写结果回填该行。成功时 input.value = 值的 JSON 全文——float 行是裸数字
   *  `0.18`，vec3 行是整个对象 `{"ctrl":…,"t":[…],"r":[…]}`，原样可再写回（改 t 不丢 ctrl）。
   *  失败**不动 input.value**（别把用户刚敲的东西吞掉），只标红 + 恢复占位提示 + 顶部显错。 */
  function setMappingResult(name: string, r: { ok: boolean; value: unknown; error?: string }): void {
    const input = mappingInput(name);
    const cell = findByData<HTMLElement>(mappingsList, "[data-map-value]", "mapValue", name);
    if (input) input.placeholder = valuePlaceholder(input.dataset.mapType ?? "");
    if (r.ok) {
      const full = channelValueString(r.value);
      if (input) input.value = full;
      cell?.classList.remove("err");
      if (cell) cell.title = full;
      mappingsError.classList.add("hidden");
    } else {
      const err = r.error ?? "unknown";
      cell?.classList.add("err");
      if (cell) cell.title = err;
      mappingsError.textContent = `${name}：${err}`;
      mappingsError.classList.remove("hidden");
    }
  }

  async function readMapping(name: string): Promise<void> {
    if (!expandedProject) return;
    const input = mappingInput(name);
    if (input) input.placeholder = "读取中…";
    setMappingResult(name, await getMappingValue(expandedProject, name));
  }

  async function writeMapping(name: string): Promise<void> {
    if (!expandedProject) return;
    const input = mappingInput(name);
    if (!input) return;
    const parsed = parseMappingInput(input.value);
    if (parsed === INVALID_CHANNEL_VALUE) {
      setMappingResult(name, { ok: false, value: undefined, error: "无效值（JSON 或裸数字，如 .2 / {\"t\":[0,1,0]}）" });
      return;
    }
    input.placeholder = "写入中…";
    setMappingResult(name, await putMappingValue(expandedProject, name, parsed));
  }

  mappingsRefresh.addEventListener("click", () => {
    if (expandedProject) void loadMappings(expandedProject);
    else renderMappingsIdle();
  });

  /** 解绑逻辑名：确认 → DELETE → 刷新。未知逻辑名桥返回 404，store 已归一为
   *  {ok:true, removed:false}，此处按「本来就没了」处理：照常刷新，不弹错。 */
  async function removeMapping(name: string): Promise<void> {
    if (!expandedProject) return;
    if (!window.confirm(`解绑逻辑名「${name}」？\n只移除映射，Houdini 节点与参数不受影响。`)) return;
    mappingsError.classList.add("hidden");
    try {
      await deleteMapping(expandedProject, name);
      await loadMappings(expandedProject);
    } catch (err) {
      mappingsError.textContent = `解绑失败：${errText(err)}`;
      mappingsError.classList.remove("hidden");
    }
  }

  mappingsList.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const read = target.closest?.("button[data-map-read]") as HTMLElement | null;
    if (read) {
      void readMapping(read.dataset.mapRead ?? "");
      return;
    }
    const write = target.closest?.("button[data-map-write]") as HTMLElement | null;
    if (write) {
      void writeMapping(write.dataset.mapWrite ?? "");
      return;
    }
    const del = target.closest?.("button[data-map-delete]") as HTMLElement | null;
    if (del) void removeMapping(del.dataset.mapDelete ?? "");
  });

  // 值 input 回车即写（省一次点击）。
  mappingsList.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const input = (e.target as HTMLElement).closest?.("input[data-map-name]") as HTMLInputElement | null;
    if (input) void writeMapping(input.dataset.mapName ?? "");
  });

  // ---------------- 3) 场景（诊断区，默认折叠） ----------------
  const cleanupBtn = $("#ov-cleanup") as HTMLButtonElement;
  const cleanupResult = $("#ov-cleanup-result");
  const activeHint = $("#active-hint");
  const activeList = $("#active-list");
  const historyHint = $("#history-hint");
  const historyList = $("#history-list");
  const newLabel = $("#new-label") as HTMLInputElement;
  const newButton = $("#new-button") as HTMLButtonElement;
  const newError = $("#new-error");

  /** 三态判定：离线 / 未cook / 在线，离线优先。 */
  function activeState(s: ActiveScene): { state: ActiveState; text: string; title: string } {
    const seenDiff = Date.now() - epochMs(s.lastSeen);
    if (seenDiff > OFFLINE_MS) {
      return { state: "offline", text: "离线", title: `Houdini 心跳断开（lastSeen ${relTime(s.lastSeen)}）` };
    }
    const activity = s.lastActivity ?? 0; // 旧响应无 lastActivity 时按 0 = 从未推数据 -> 未cook
    if (activity === 0) {
      return { state: "uncooked", text: "未cook", title: "Houdini 在跑但从未推过数据（lastActivity=0）" };
    }
    const activityDiff = Date.now() - epochMs(activity);
    if (activityDiff > STALE_ACTIVITY_MS || (s.inputRev === 0 && s.outputRev === 0)) {
      return { state: "uncooked", text: "未cook", title: `Houdini 在跑但该场景还没 cook（lastActivity ${relTime(activity)}）` };
    }
    return { state: "online", text: "在线", title: `正常在线（最近活动 ${relTime(activity)}）` };
  }

  function activeRowHtml(s: ActiveScene): string {
    const { state, text, title } = activeState(s);
    const label = s.label ? esc(s.label) : esc(s.serial);
    const path = s.nodePath ? `<small class="ov-path" title="${esc(s.nodePath)}">${esc(s.nodePath)}</small>` : "";
    return `
    <div class="ov-row">
      <div class="ov-cell ov-serial" title="${esc(s.serial)}">${esc(s.serial)}</div>
      <div class="ov-cell ov-label">${label}${path}</div>
      <div class="ov-cell ov-seen ${state}">
        <span class="ov-state" title="${esc(title)}">${text}</span>
        <small class="ov-seen-at">${relTime(s.lastSeen)}</small>
      </div>
      <div class="ov-cell ov-revs"><span class="rev">in ${s.inputRev}</span><span class="rev">out ${s.outputRev}</span></div>
      <div class="ov-cell ov-action"><button class="ov-open" type="button" data-serial="${esc(s.serial)}">打开</button></div>
    </div>`;
  }

  function historyRowHtml(s: HistoryScene): string {
    return `
    <div class="ov-row history">
      <div class="ov-cell ov-serial" title="${esc(s.serial)}">${esc(s.serial)}</div>
      <div class="ov-cell ov-seen">${clockTime(s.savedAt)}</div>
      <div class="ov-cell ov-action"><button class="ov-open" type="button" data-serial="${esc(s.serial)}">打开</button></div>
    </div>`;
  }

  function renderActive(list: ActiveScene[]): void {
    activeList.innerHTML = list.map(activeRowHtml).join("");
    activeHint.classList.toggle("hidden", list.length > 0);
    activeHint.textContent = list.length ? "" : "暂无活跃场景";
  }

  function renderHistory(list: HistoryScene[]): void {
    historyList.innerHTML = list.map(historyRowHtml).join("");
    historyHint.classList.toggle("hidden", list.length > 0);
    historyHint.textContent = list.length ? "" : "暂无历史场景";
  }

  function renderUnavailable(msg: string): void {
    activeList.innerHTML = "";
    historyList.innerHTML = "";
    activeHint.classList.remove("hidden");
    activeHint.textContent = msg;
    historyHint.classList.remove("hidden");
    historyHint.textContent = msg;
  }

  async function fetchScenes(): Promise<ScenesResponse> {
    const res = await fetch(`${BRIDGE_URL}/api/scenes`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new HttpError(res.status);
    return (await res.json()) as ScenesResponse;
  }

  /** 桥异常统一提示：连接失败=offline，HTTP 错误=error（接口可能未就绪）。 */
  function failMessage(err: unknown): string {
    if (err instanceof HttpError) {
      setBanner("error", `桥返回 HTTP ${err.status}：/api/scenes 未就绪？`);
      return "无法加载（接口未就绪）";
    }
    setBanner("offline", "桥离线：无法连接 127.0.0.1:8375，场景列表不可用；新建场景也需要桥在线。");
    return "无法加载（桥离线）";
  }

  async function loadScenes(): Promise<void> {
    activeHint.classList.remove("hidden");
    activeHint.textContent = "加载中…";
    activeList.innerHTML = "";
    historyHint.classList.remove("hidden");
    historyHint.textContent = "加载中…";
    historyList.innerHTML = "";
    try {
      const scenes = await fetchScenes();
      setBanner("ok", "");
      renderActive(scenes.active);
      renderHistory(scenes.history);
    } catch (err) {
      renderUnavailable(failMessage(err));
    }
  }

  /** 清理无效场景：POST /api/scenes/cleanup -> {ok, removed}，成功后重新拉取渲染。 */
  async function cleanupScenes(): Promise<void> {
    cleanupBtn.disabled = true;
    cleanupBtn.textContent = "清理中…";
    cleanupResult.classList.add("hidden");
    try {
      const res = await fetch(`${BRIDGE_URL}/api/scenes/cleanup`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new HttpError(res.status);
      const data = (await res.json()) as CleanupResponse;
      const removed = Array.isArray(data.removed) ? data.removed : [];
      if (removed.length === 0) {
        cleanupResult.textContent = "没有无效场景";
        cleanupResult.title = "";
        cleanupResult.className = "ov-cleanup-result none";
      } else {
        const preview = removed.slice(0, 5).join("、") + (removed.length > 5 ? "…" : "");
        cleanupResult.textContent = `已清理 ${removed.length} 个无效场景：${preview}`;
        cleanupResult.title = removed.join("\n");
        cleanupResult.className = "ov-cleanup-result ok";
      }
      await loadScenes(); // 清理成功后重新拉取渲染
    } catch (err) {
      cleanupResult.textContent =
        err instanceof HttpError ? `清理接口未就绪（HTTP ${err.status}）` : "清理失败（桥离线）";
      cleanupResult.title = "";
      cleanupResult.className = "ov-cleanup-result err";
    } finally {
      cleanupBtn.disabled = false;
      cleanupBtn.textContent = "清理无效场景";
    }
  }

  cleanupBtn.addEventListener("click", () => void cleanupScenes());

  // 打开按钮：事件委托（active + history 共用）
  for (const list of [activeList, historyList]) {
    list.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest?.("button[data-serial]");
      if (!btn) return;
      openSerial((btn as HTMLElement).dataset.serial ?? "");
    });
  }

  newButton.addEventListener("click", async () => {
    newError.classList.add("hidden");
    newButton.disabled = true;
    newButton.textContent = "创建中…";
    const label = newLabel.value.trim();
    try {
      const res = await fetch(`${BRIDGE_URL}/api/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(label ? { label } : {}),
      });
      if (!res.ok) throw new HttpError(res.status);
      const data = (await res.json()) as { serial: string };
      openSerial(data.serial); // 即使没有 Houdini，web 也可打开空 workspace 编辑
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      failMessage(err);
      newError.textContent = `创建失败：${detail}（桥 127.0.0.1:8375 是否在运行？）`;
      newError.classList.remove("hidden");
      newButton.disabled = false;
      newButton.textContent = "新建场景";
    }
  });

  // 顶部「刷新」：项目（含全量检测）+ 场景一起刷（映射跟随项目）。
  refreshBtn.addEventListener("click", () => {
    refreshBtn.dataset.busy = "1";
    refreshBtn.disabled = true;
    void Promise.all([loadProjects(true), loadScenes()]).finally(() => {
      refreshBtn.dataset.busy = "0";
      syncRefreshButtons();
    });
  });

  // 首次加载不探测（状态由桥持久化证据回填）；显式刷新才打 Houdini 往返。
  void loadProjects();
  void loadScenes();
}
