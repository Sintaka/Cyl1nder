/**
 * 「一个地址 = 一个 serial，桥回答它提供什么端口」的前端缓存（v0.1.00120）。
 *
 * 用户在 `_input_`/`_output_` 里**只填一个 serial**，端口不再是写死的 in1..in4：
 *   - serial 是 SOP HDA  → 下拉给 in0..in3（`_input_`）/ out0..out3（`_output_`）
 *   - serial 是吊牌 tag  → 下拉给该 tag 的逻辑名，每项带自己的类型（`tx: float`）
 * 为什么必须问桥：多个 Houdini HDA 可以**故意共用一个 serial**，好让它们的参数被关联、
 * 由桥集中托管。那么「这个 serial 到底提供哪些端口」只有桥知道，前端猜不出来，也不该猜。
 *
 * 三个设计约束（与 mapping-types.ts 同源的「不猜」哲学）：
 *   1. **恒不抛**：桥离线 / 半截地址都归一成 `known:false` 空清单。地址是逐字输入的，
 *      打到一半查不到是**正常中间态**，不是错误，更不能让参数面板渲染崩掉。
 *   2. **同步可读**：`cachedPorts()` 是纯查缓存的同步函数——参数面板在渲染 <select> 的
 *      同一帧就要拿到选项，不能 await（每次重渲染 await 一次网络 = 面板闪烁）。
 *      没缓存时返回 null（= 「还不知道」），由调用方决定是先渲染当前值再异步补。
 *   3. **`""` 类型照原样保留**：桥用空串表示「类型未知」（它丢弃脏值而不猜默认 geo）。
 *      这里同样不补默认值——不知道类型就说不知道，让 type 参数保持不动。
 *
 * 纯度：fetch 只在 `loadCapabilities` 里；其余都是缓存上的纯函数，故可单测
 * （web/tests/serial-capabilities.test.ts 不碰真桥）。
 */
import { BridgeClient } from "../bridge/client";
import { MAPPING_TYPES, type MappingType, type SerialCapabilities, type SerialPortOption } from "../protocol/types";

/** 取端口清单的哪一侧：`_input_` 看 inputs，`_output_` 看 outputs。
 *  吊牌（tag）两侧是**同一份**清单（参数天生双向读写），桥直接回相同数组。 */
export type PortSide = "inputs" | "outputs";

/** serial -> 已取到的能力（**含 `known:false` 的否定结果**：见 loadCapabilities 的缓存论证）。 */
const cache = new Map<string, SerialCapabilities>();

/** 同一 serial 的并发取用合并为一次请求（面板重渲染 + 地址防抖可能同时触发）。 */
const inFlight = new Map<string, Promise<SerialCapabilities>>();

/** 失效纪元：invalidate 会 +1，在途请求回来时若纪元已变就**丢弃结果**并且不入缓存。
 *  否则「取能力中途切项目/桥重连」会被旧响应填成过期清单——比没清单更糟。 */
let epoch = 0;

/** 防抖：地址框是逐字输入的，`C1-msm6dsp7-ob6t` 一路打完会经过 15 个中间态。
 *  同一时刻只留**最后一次**待发请求（latest-wins），前面的直接取消——中间态的答案
 *  一定是 `known:false`，取回来也只是覆盖一遍空清单，纯属浪费往返。 */
interface Pending {
  serial: string;
  timer: ReturnType<typeof setTimeout>;
  /** 被取消时也要把 promise 收尾（否则调用方 await 永远悬着）。 */
  settle: (caps: SerialCapabilities) => void;
  /** 同 serial 再次请求时复用（否则一次防抖窗口里会排出多个定时器 → 多次往返）。 */
  promise: Promise<SerialCapabilities>;
}
let pending: Pending | null = null;

/** 默认防抖窗口（ms）。单测传 0 走「下一个 tick」而不是真等。 */
const DEBOUNCE_MS = 180;

/** 归一 serial：仅接受非空字符串，两端空白剔除（地址框里多打的空格不算内容）。
 *  空/非字符串 → ""，调用方据此判定「还没填」——**没填不是错误**，也不发请求。 */
export function normalizeSerial(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 未知 serial 的空能力（桥离线 / 半截地址 / 未注册都是这一个形状）。 */
export function unknownCapabilities(serial: string): SerialCapabilities {
  return { serial, kind: "", known: false, nodePath: "", hip: "", inputs: [], outputs: [] };
}

/**
 * 校验线上传来的端口类型。
 *
 * 协议把 `SerialPortOption.type` 声明成 `MappingType | ""`，但线上数据可能更脏
 * （手改 registry.json / 旧桥 / 将来新增类型）。凡不在 ("geo","float","vec3") 里的
 * 一律归成 `""`（= 类型未知）而**不是** geo：静默补一个默认类型会让连线校验拿着
 * 错类型放行错配的线，那正是映射系统当初要修的病。
 */
export function toPortType(v: unknown): MappingType | "" {
  return typeof v === "string" && (MAPPING_TYPES as readonly string[]).includes(v) ? (v as MappingType) : "";
}

/** 洗一份线上端口清单：丢掉 key 为空的项（下拉里没有 key 的选项无法回写），
 *  label 缺省回落到 key（宁可显示机器名，也不显示空行），type 经 toPortType 归一。 */
export function sanitizePortOptions(list: unknown): SerialPortOption[] {
  if (!Array.isArray(list)) return [];
  const out: SerialPortOption[] = [];
  for (const raw of list) {
    const o = raw as { key?: unknown; label?: unknown; type?: unknown } | null;
    const key = typeof o?.key === "string" ? o.key.trim() : "";
    if (key === "") continue;
    const label = typeof o?.label === "string" && o.label.trim() !== "" ? o.label : key;
    out.push({ key, label, type: toPortType(o?.type) });
  }
  return out;
}

/** 洗整份能力响应（`sanitizeCapabilities` 是 loadCapabilities 的可测内核，无网络）。
 *  `known` 只认真布尔 true；kind 只认 "hda"/"tag"，其余归 ""（未知 kind 不该被当成某一族）。 */
export function sanitizeCapabilities(serial: string, raw: unknown): SerialCapabilities {
  const r = raw as Partial<SerialCapabilities> | null;
  const kind = r?.kind === "hda" || r?.kind === "tag" ? r.kind : "";
  return {
    serial,
    kind,
    known: r?.known === true,
    nodePath: typeof r?.nodePath === "string" ? r.nodePath : "",
    hip: typeof r?.hip === "string" ? r.hip : "",
    inputs: sanitizePortOptions(r?.inputs),
    outputs: sanitizePortOptions(r?.outputs),
  };
}

/** 直接写缓存（测试与「桥推能力」将来的入口；纯写入无网络）。 */
export function setCapabilities(serial: string, raw: unknown): void {
  const key = normalizeSerial(serial);
  if (key === "") return;
  cache.set(key, sanitizeCapabilities(key, raw));
}

/**
 * 同步查缓存：拿到过 → 能力对象；没拿到过 → **null（「还不知道」）**。
 *
 * null 与「拿到了但 known:false」是**两回事**，故不合并：前者该去取，后者已经问过了，
 * 答案就是「这个 serial 桥不认识」，重复问只是刷网络。
 */
export function cachedCapabilities(serial: string): SerialCapabilities | null {
  const key = normalizeSerial(serial);
  if (key === "") return null;
  return cache.get(key) ?? null;
}

/** 同步取某一侧端口清单；未缓存 → null（「还不知道」，别当成空清单渲染成"无端口"）。 */
export function cachedPorts(serial: string, side: PortSide): SerialPortOption[] | null {
  const caps = cachedCapabilities(serial);
  return caps ? caps[side] : null;
}

/** 同步查某个 key 的类型；未缓存 / 无此 key / 类型未知 → null。
 *  参数面板据此把选中端口的类型写进 `type` 参数（null = 不动它，绝不猜）。 */
export function cachedPortType(serial: string, side: PortSide, key: string): MappingType | null {
  const list = cachedPorts(serial, side);
  if (!list) return null;
  const hit = list.find((o) => o.key === key);
  return hit && hit.type !== "" ? hit.type : null;
}

/**
 * 取一次 serial 能力并填缓存。**绝不抛、绝不 reject**（失败 = `known:false` 空清单）。
 *
 * - 已缓存（**含否定结果**）→ 直接同步返回，不发请求。
 * - 同 serial 在途 → 复用那个 promise（不重复发）。
 * - 否则防抖 `delayMs` 后发一次；期间来了新 serial → 旧的**取消**并用空能力收尾。
 * - 回来时若 `epoch` 变过 → **丢弃**（不入缓存、不当结果），返回空能力。
 *
 * 空 serial 直接返回空能力：没填地址不发请求（也不污染缓存）。
 */
export function loadCapabilities(serial: string, delayMs = DEBOUNCE_MS): Promise<SerialCapabilities> {
  const key = normalizeSerial(serial);
  if (key === "") return Promise.resolve(unknownCapabilities(""));
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const flying = inFlight.get(key);
  if (flying) return flying;
  if (pending) {
    // 同 serial 的待发请求 → 复用（防抖窗口内多次渲染只发一次）
    if (pending.serial === key) return pending.promise;
    // 前一个待发请求是另一个 serial（地址又被打了一个字）→ 作废：中间态的答案没人要
    clearTimeout(pending.timer);
    pending.settle(unknownCapabilities(pending.serial));
    pending = null;
  }
  const startedAt = epoch;
  // settle/timer 在 executor 里产生，promise 本身要回填进 pending（同 serial 复用），
  // 故先收集再一次性组装——executor 同步执行，赋值发生在 return 之前。
  let settle: (caps: SerialCapabilities) => void = () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<SerialCapabilities>((resolve) => {
    settle = resolve;
    timer = setTimeout(() => {
      pending = null;
      const req = (async () => {
        const raw = await new BridgeClient().getSerialCapabilities(key);
        // 期间被 invalidate 过 → 这份响应描述的是失效前的世界，丢掉
        if (startedAt !== epoch) return unknownCapabilities(key);
        const caps = sanitizeCapabilities(key, raw);
        cache.set(key, caps);
        return caps;
      })();
      inFlight.set(key, req);
      void req.finally(() => inFlight.delete(key)).then(resolve, () => resolve(unknownCapabilities(key)));
    }, delayMs);
  });
  if (timer !== null) pending = { serial: key, timer, settle, promise };
  return promise;
}

/** 丢缓存（切项目 / 桥重连 / 吊牌移动后调用）。
 *  回到「还不知道」态：下次渲染下拉会重新问桥，而不是复用可能已经过期的清单。
 *  在途请求的结果一并作废（epoch +1），待发的那个也取消。 */
export function invalidateCapabilities(): void {
  cache.clear();
  epoch += 1;
  if (pending) {
    clearTimeout(pending.timer);
    pending.settle(unknownCapabilities(pending.serial));
    pending = null;
  }
  inFlight.clear();
}
