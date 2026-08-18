/** data 通道写值的输入解析（overview 写值 prompt / 后续正式面板共用）。
 *
 *  为什么不能只用 JSON.parse：JSON 不接受省略整数位的小数——`.2`、`1.`、`+0.5`
 *  全是 SyntaxError，而手输这些是常态（实机踩到：输 `.2` 直接报错）。
 *  策略：先按 JSON 解（对象/数组/null/true 等结构化值照旧），失败再按「裸数字」兜底。
 */

/** 解析失败哨兵——用 Symbol 而非 null/undefined，因为 `null`、`0`、`""`
 *  都是合法的写入值，不能与失败混为一谈。 */
export const INVALID_CHANNEL_VALUE = Symbol("invalid-channel-value");

/** 整串必须恰好是一个十进制数：可选符号 + （`1` / `1.` / `1.5` / `.5`）+ 可选指数。
 *  刻意不接受 `0x10`、`Infinity`、`NaN`、`1.2.3`（parseFloat 会把它们截成半个数）。 */
const BARE_NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** 解析用户输入的通道值。
 *
 *  @returns 解析出的值，或 `INVALID_CHANNEL_VALUE`（空串也算失败，交调用方提示）。
 */
export function parseChannelValue(raw: string): unknown {
  const s = raw.trim();
  if (s === "") return INVALID_CHANNEL_VALUE;
  try {
    return JSON.parse(s);
  } catch {
    if (BARE_NUMBER_RE.test(s)) {
      const n = parseFloat(s);
      if (Number.isFinite(n)) return n;
    }
    return INVALID_CHANNEL_VALUE;
  }
}
