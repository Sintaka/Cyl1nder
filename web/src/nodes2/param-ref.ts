/**
 * 参数引用表达式（v0.1.00121）：`<地址>` 或 `<地址>.<分量>`。
 *
 * 这是 #4/#5/#6 共用的**唯一**解析器——null 节点每个端口的 string、param 面板右键
 * 「粘贴相对/绝对地址」、transform 的 vec3 引用框，三处都走它，所以「什么算合法引用」
 * 只有一个答案。
 *
 * ## 分量语法与「不可混用」
 *
 * 用户要求：「xyzw 和 rgba 指定的分量是一样的, 但是一个引用框不能混用（混用直接报错）」。
 * 所以分量**集合**是两套：`xyzw`（几何/位姿语义）与 `rgba`（颜色语义）。单分量引用
 * （`.x`）不存在混用问题；多分量 swizzle（`.xy` / `.rgb`）必须整串同属一套，
 * `.xg` / `.rx` 一律报错而不是"猜用户想要第 0、1 个"。
 *
 * 为什么不复用 `groups/matcher.ts` 的 `COMP_ALIAS`：那张表把 x/u/r 全映射到 0，
 * **刻意允许混用**（VEX group 表达式里 `@P.x` 与 `@Cd.r` 本就同义且不会同时出现）。
 * 这里的语义正相反——引用框是用户手打的地址，混写几乎总是笔误，静默接受会让人
 * 以为引用对了。两套规则不该共用一张表。
 *
 * ## 为什么解析器是纯函数
 *
 * 无 DOM、无 rete、无 fetch：地址合法性与分量语义是纯数据规则，可直接单测；
 * 「这个地址在桥上存不存在」是另一回事（由 mapping / capabilities 回答），不在这里。
 */

/** 分量字母 → 下标。两套各自独立，**不并成一张表**（并了就无法判混用）。 */
const XYZW: Record<string, number> = { x: 0, y: 1, z: 2, w: 3 };
const RGBA: Record<string, number> = { r: 0, g: 1, b: 2, a: 3 };

/** 分量集合名：用于报错文案与"不可混用"判定。 */
export type CompSet = "xyzw" | "rgba";

export interface ParamRef {
  /** 地址本体（去掉分量后缀），如 `transform1/tx` 或 `/obj/geo1/transform1/tx`。 */
  address: string;
  /** 分量下标序列；无分量后缀时为空数组（= 引用整个值）。 */
  components: number[];
  /** 分量用的是哪一套；无分量时为 null。 */
  compSet: CompSet | null;
  /** 原始分量文本（`xy` / `r`），用于回显与错误文案；无分量时 `""`。 */
  compText: string;
}

export interface ParamRefError {
  ok: false;
  /** 面向用户的中文原因（直接进报错角标 / tooltip）。 */
  reason: string;
}

export type ParamRefResult = ({ ok: true } & ParamRef) | ParamRefError;

/**
 * 解析一个引用表达式。**空串 = 没有引用**（合法状态，不是错误）：引用框留空就是
 * 「这个参数用自己的值」，把它当错误会让每个空框都顶一个红角标。
 *
 * 分量只从**最后一个 `.`** 之后取，且必须整串是分量字母；否则那个点属于地址本身
 * （逻辑名里合法地含点，例如 `sceneanimate1/animation.data`）。这条规则让
 * 「地址里有点」与「引用分量」不至于互相误伤。
 */
export function parseParamRef(raw: unknown): ParamRefResult {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return { ok: true, address: "", components: [], compSet: null, compText: "" };

  const dot = text.lastIndexOf(".");
  // 点在开头（`.x`）= 只有分量、没有地址 → 报错。**必须先判这条**：否则下面
  // `dot <= 0` 的「整串是地址」分支会把 `.x` 当成一个叫 ".x" 的地址静默放过。
  if (dot === 0) return { ok: false, reason: "只有分量、没有地址" };
  // 没有点，或点在末尾（`tx.`）→ 整串都是地址；末尾点交给地址合法性去判。
  if (dot < 0 || dot === text.length - 1) {
    return finishAddressOnly(text);
  }
  const head = text.slice(0, dot);
  const tail = text.slice(dot + 1).toLowerCase();

  const inXyzw = [...tail].every((ch) => ch in XYZW);
  const inRgba = [...tail].every((ch) => ch in RGBA);
  // 每个字母**单独看**是否都是某一套的成员（用于区分「混用」与「压根不是分量」）
  const allAreCompLetters = [...tail].every((ch) => ch in XYZW || ch in RGBA);

  if (!inXyzw && !inRgba) {
    // 混用：字母个个合法，但整串不同属一套 → **直接报错**，
    // 绝不按「反正 x 与 r 的下标都是 0」放行：那样用户看不出自己写错了。
    if (allAreCompLetters) {
      return { ok: false, reason: `分量不能混用 xyzw 与 rgba：「.${tail}」` };
    }
    // 压根不是分量字母 → 这个点属于地址本身（如 `sceneanimate1/animation.data`）。
    return finishAddressOnly(text);
  }

  // 长度上限放在集合判定**之后、建结果之前**：先确认这确实是分量串（否则
  // `foo.bargraph` 这种地址里的长单词会被误判成"分量太多"而不是"地址含点"）。
  // 上限 4：最宽的类型是 vec4/rgba，写 5 个字母必然是笔误（如 `.xyzwx`）。
  if (tail.length > 4) return { ok: false, reason: `分量最多 4 个：「.${tail}」` };
  const set: CompSet = inXyzw ? "xyzw" : "rgba";
  const table = inXyzw ? XYZW : RGBA;
  const addr = head.trim();
  if (addr === "") return { ok: false, reason: "只有分量、没有地址" };
  return {
    ok: true,
    address: addr,
    components: [...tail].map((ch) => table[ch]),
    compSet: set,
    compText: tail,
  };
}

function finishAddressOnly(text: string): ParamRefResult {
  return { ok: true, address: text, components: [], compSet: null, compText: "" };
}
