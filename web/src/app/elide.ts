/**
 * 共享文本省略助手（纯函数，无 DOM；单测见 web/tests/elide.test.ts）。
 *
 * 为什么不用纯 CSS `text-overflow: ellipsis`：CSS 只会砍**尾巴**。Cyl1nder 里几乎所有
 * 长文本的辨识信息都在**两端**——序列号 `C1-msm6dsp7-ob6t`（前缀说明"这是什么"，尾段
 * 说明"是哪一个"）、路径 `/obj/geo1/transform1/tx`（尾段才是参数名）、逻辑地址
 * `point_1/tx`。砍尾巴恰好砍掉唯一有区分度的那一半：`C1-msm6dsp7…` 与
 * `C1-msm6dsq9…` 看起来一样。所以默认做**中段省略**，两端都留。
 *
 * 与既有尾部截断（trace.ts 的 truncateDigest / overview.ts 的 formatChannelValue）
 * 的区别：那两处截的是 digest / JSON 值——信息从头往后递减，砍尾巴是对的，故不动它们。
 */

/** 省略号（单个 U+2026，不是三个点——三个点会多吃 2 个字符预算）。 */
export const ELLIPSIS = "…";

/** 按**码点**切分：Array.from 不会把代理对（emoji、CJK 扩展区）劈成两个坏字符。
 *  `str.slice` 按 UTF-16 码元切，正好能切出半个 emoji（� ）——所以这里一律走码点。 */
function points(s: string): string[] {
  return Array.from(s);
}

/** 归一 max 到非负整数（NaN / Infinity / 负数 / 小数 → 安全值）。 */
function limitOf(max: number): number {
  if (!Number.isFinite(max)) return 0;
  return Math.max(0, Math.floor(max));
}

/**
 * 中段省略：**两端都保留**，只吃掉中间。
 *
 * 算法：
 *   1. 文本码点数 <= max → **原样返回**（不加省略号，短文本零成本）；
 *   2. 预算 budget = max - 省略号码点数；
 *   3. head = ceil(budget / 2)、tail = budget - head——**头多分一个**：前缀
 *      （`C1-` / `/obj`）通常比尾巴更需要完整，奇数预算给头；
 *   4. 拼 `head + … + tail`。
 *
 * 不变量：省略发生时**结果码点数恰好等于 max**（永不超预算，故可安全喂给定宽容器）。
 * max 小到装不下省略号时退化为「省略号自身的前 max 个码点」（max=0 → 空串）。
 *
 * @param text 原文（null/undefined 按空串处理）
 * @param max 允许的最大**码点**数
 * @param ellipsis 省略标记（默认单字符 …）
 */
export function elide(text: string, max: number, ellipsis: string = ELLIPSIS): string {
  const s = text ?? "";
  const limit = limitOf(max);
  if (limit === 0) return "";
  const chars = points(s);
  if (chars.length <= limit) return s; // 装得下：原样，不加省略号
  const mark = points(ellipsis);
  if (limit <= mark.length) return mark.slice(0, limit).join(""); // 连省略号都装不下
  const budget = limit - mark.length;
  const head = Math.ceil(budget / 2); // 奇数预算头多分一个（前缀优先）
  const tail = budget - head;
  const left = chars.slice(0, head).join("");
  const right = tail > 0 ? chars.slice(chars.length - tail).join("") : "";
  return left + ellipsis + right;
}

/**
 * 尾部省略（`abcdef…`）：信息从头往后递减的文本用它（JSON 值、digest、日志行）。
 *
 * 与 trace.ts 的 truncateDigest 的差别：**这里结果总长不超过 max**（省略号算在预算内），
 * truncateDigest 是 `slice(0, max) + "…"`（总长 max+1）。定宽容器请用本函数。
 */
export function elideEnd(text: string, max: number, ellipsis: string = ELLIPSIS): string {
  const s = text ?? "";
  const limit = limitOf(max);
  if (limit === 0) return "";
  const chars = points(s);
  if (chars.length <= limit) return s;
  const mark = points(ellipsis);
  if (limit <= mark.length) return mark.slice(0, limit).join("");
  return chars.slice(0, limit - mark.length).join("") + ellipsis;
}
