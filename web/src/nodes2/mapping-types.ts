/**
 * _input_/_output_ 端口数据类型的**唯一真源**：映射系统（task #8）。
 *
 * 改造前端口类型来自节点上手打的 `type` 参数——用户可以打出任何字符串，而真正决定
 * 这个逻辑名是 geo 还是 float/vec3 的是桥侧映射表（`MappingEntry.type`）。两处并存
 * 必然漂移：图上写 float、映射表里登记的是 vec3，连线校验放行了但值语义是错的。
 * 于是这里把类型**只从映射表读**，并把「逻辑名根本没登记」变成节点上可见的红三角，
 * 而不是静默回落到 geo（静默默认值 = 用户以为连通了，实际什么都没接上）。
 *
 * 三态诚实（本文件的核心约束，见 resolveAddressType / mappingAddressErrors）：
 *   (a) 缓存已加载 + 找到该逻辑名        → 返回类型
 *   (b) 缓存已加载 + 表里没有该逻辑名    → null，且确实是「未登记」
 *   (c) 缓存**未**加载（桥离线/没取过） → 同样 null，但**不知道**是否未登记
 * (b) 与 (c) 都是 null，但错误文案必须不同：桥只是离线时说「你的地址无效」是冤枉用户。
 *
 * 纯度：fetch 只在 primeMappingTypes 里；其余都是缓存上的纯函数，故可单测
 * （web/tests/mapping-types.test.ts 不碰真桥）。
 */
import { MAPPING_TYPES } from "../protocol/types";
import { fetchMappings } from "../stores/projects";
import { store } from "../stores/workspace";
import type { NodeErrorMap } from "./graph-model";

/** 端口/值类型。与 protocol/types.ts 的 `MappingType`、桥侧 `MAPPING_TYPES` 同名同值。 */
export type MappingTypeName = "geo" | "float" | "vec3";

/** 逻辑名 -> 映射类型。**同步可读**：resolveAddressType 在 setNodeParams 热路径上被调用，
 *  不能是 async（每次改参数都 await 一次网络 = 编辑卡顿）。 */
const typeCache = new Map<string, MappingTypeName>();

/** 缓存是否**真的加载过一次**（区分状态 (b) 与 (c)）。
 *  注意：不能用 `typeCache.size > 0` 代替——空映射表也是「已加载」，那时表里没有的
 *  逻辑名确实是未登记，而不是「不知道」。 */
let primed = false;

/** 同一 pid 的并发 prime 合并成一次请求（图初始化 + anchor-moved 可能同时触发）。 */
let inFlight: Promise<void> | null = null;
let inFlightPid = "";

/** 失效纪元：invalidateMappingTypes 会 +1，在途请求回来时若纪元已变就**丢弃结果**。
 *  否则「取表中途 anchor-moved 失效」会被旧响应重新 prime 成过期数据——比没数据更糟。 */
let epoch = 0;

/** 缓存是否已加载。错误文案据此二选一，另有 NodeView 侧「映射表未加载」提示可用。 */
export function isMappingTypesPrimed(): boolean {
  return primed;
}

/** 归一 address：仅接受非空字符串，两端空白剔除（用户在参数框里打的空格不该算内容）。
 *  空/非字符串 → ""，调用方据此判定「没填」——没填不是错误。 */
export function normalizeAddress(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 校验线上传来的 type 值。
 *
 * 桥侧 `MappingEntry.type` 的静态类型是 `MappingType | string`——即协议**允许**脏值
 * （手改 registry.json / 旧版本桥 / 将来新增类型）。凡不在 ("geo","float","vec3") 里的
 * 一律**不入缓存**：宁可当作未登记报错，也不把一个前端不认识的类型塞进端口，
 * 让连线校验（canConnectSockets）拿着未知类型去做判断。
 */
export function toMappingTypeName(v: unknown): MappingTypeName | null {
  return typeof v === "string" && (MAPPING_TYPES as readonly string[]).includes(v)
    ? (v as MappingTypeName)
    : null;
}

/**
 * 逻辑名 -> 映射类型；**绝不猜默认值**。
 *
 * null 有两种含义（本身无法区分，故调用方要错误文案时用 isMappingTypesPrimed 或
 * 直接用 mappingAddressErrors）：表里没有该名，或缓存压根没加载。
 * 空 address → null（没填的节点不该被当成「未登记」）。
 */
export function resolveAddressType(address: string): MappingTypeName | null {
  const name = normalizeAddress(address);
  if (name === "") return null;
  return typeCache.get(name) ?? null;
}

/** 未登记逻辑名的错误文案（状态 (b)：确实查过了，表里没有）。 */
export function unregisteredMessage(name: string): string {
  return `逻辑名未登记：「${name}」不在映射表中，端口类型无法确定（请先在概览里登记该逻辑名）`;
}

/** 映射表未加载的错误文案（状态 (c)：不知道，**不指控用户**）。
 *  severity 仍是 error——端口类型确实取不到，计算不可信；但原因指向桥而非地址。 */
export function notPrimedMessage(name: string): string {
  return `映射表未加载：无法校验逻辑名「${name}」的类型（桥可能离线，重连后自动恢复）`;
}

/**
 * 一批 `{nodeId, address}` -> 每节点错误表，供 flush() 合并进 setNodeErrors。
 *
 * 规则：
 *   - address 空/空白           → **无错误**（还没填的节点不是错误）
 *   - 缓存已加载 + 找到         → 无错误
 *   - 缓存已加载 + 表里没有     → error「逻辑名未登记」
 *   - 缓存未加载                → error「映射表未加载」（文案不同！见文件头三态说明）
 * `source: "mapping"` 仅用于排错日志（NodeError.source 不参与展示）。
 * 同一 nodeId 多次出现会各自追加（mergeNodeErrorMaps 同语义），不去重。
 */
export function mappingAddressErrors(
  entries: Array<{ nodeId: string; address: string }>,
): NodeErrorMap {
  const map: NodeErrorMap = {};
  for (const e of entries) {
    if (!e?.nodeId) continue;
    const name = normalizeAddress(e.address);
    if (name === "") continue; // 未填写 → 不报错
    if (primed && typeCache.has(name)) continue; // 已登记 → 不报错
    (map[e.nodeId] ??= []).push({
      severity: "error",
      message: primed ? unregisteredMessage(name) : notPrimedMessage(name),
      source: "mapping",
    });
  }
  return map;
}

/** 用一份 entries 重建缓存（纯写入，无网络）——primeMappingTypes 的可测内核。
 *  脏 type 的 entry **被丢弃**（见 toMappingTypeName）；但缓存整体仍标记为已加载：
 *  我们确实拿到了映射表，只是那一条不可用 → 该逻辑名按「未登记」报错，这是对的。 */
export function setMappingTypes(entries: Record<string, { type?: unknown }> | null | undefined): void {
  typeCache.clear();
  for (const [name, entry] of Object.entries(entries ?? {})) {
    const key = normalizeAddress(name);
    if (key === "") continue;
    const t = toMappingTypeName((entry as { type?: unknown } | null)?.type);
    if (t) typeCache.set(key, t);
  }
  primed = true;
}

/**
 * 取一次项目映射表并填缓存。**绝不抛、绝不 reject**。
 *
 * 为什么不抛：映射查表失败不该让图编辑瘫掉。桥离线是常态（用户可能压根没开 Houdini），
 * 那时正确的行为是「不知道类型」（primed 保持 false → 错误文案说映射表未加载），
 * 而不是把异常抛给 cook 循环。失败经 store.pushLog 记一行（与 main.ts 同一套日志出口），
 * 不额外弹窗。
 *
 * 同 pid 的并发调用合并为一次请求；空 pid 直接返回（不 prime，保持 (c) 态）。
 */
export function primeMappingTypes(pid: string): Promise<void> {
  const id = typeof pid === "string" ? pid.trim() : "";
  if (id === "") return Promise.resolve();
  if (inFlight && inFlightPid === id) return inFlight;
  inFlightPid = id;
  const startedAt = epoch;
  inFlight = (async () => {
    try {
      const res = await fetchMappings(id);
      // 期间被 invalidate 过 → 丢弃这份响应（它描述的是失效前的世界）
      if (startedAt === epoch) setMappingTypes(res?.entries);
    } catch (err) {
      // 失败**不 prime**：宁可说「不知道」，也不谎报「未登记」。
      store.pushLog(`[mapping] 映射类型加载失败 pid=${id}: ${String(err)}`);
    } finally {
      inFlight = null;
      inFlightPid = "";
    }
  })();
  return inFlight;
}

/** 丢缓存（anchor-moved / 切项目 / 映射被编辑后调用）。
 *  回到未加载态 (c)——不是「表为空」态：下次查表前一律按「不知道」处理。
 *  同时废弃在途请求的结果归属（inFlightPid 清空后，旧请求 finally 仍会清 inFlight）。 */
export function invalidateMappingTypes(): void {
  typeCache.clear();
  primed = false;
  epoch += 1; // 在途请求的结果作废
  inFlightPid = ""; // 下次 prime 同 pid 也重新发（不复用已作废的那次）
}
