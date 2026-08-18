import { describe, expect, it } from "vitest";
import { ELLIPSIS, elide, elideEnd } from "../src/app/elide";

/** 码点长度（断言"结果恰好占 max 个码点"时不能用 .length——代理对会算 2）。 */
const cp = (s: string): number => Array.from(s).length;

describe("elide（中段省略：两端都保留）", () => {
  it("装得下就原样返回，不加省略号", () => {
    expect(elide("short", 10)).toBe("short");
    expect(elide("exact", 5)).toBe("exact"); // 恰好等于 max 也不省略
    expect(elide("", 5)).toBe("");
  });

  it("省略时两端都在：头尾原文都能对上", () => {
    const out = elide("C1-msm6dsp7-ob6t", 12);
    expect(out).toContain(ELLIPSIS);
    expect(out.startsWith("C1-")).toBe(true); // 前缀（"这是什么"）保住
    expect(out.endsWith("ob6t")).toBe(true); // 尾段（"是哪一个"）保住
  });

  it("核心价值：尾部截断会混淆的两个序列号，中段省略后仍可区分（回归）", () => {
    const a = "C1-msm6dsp7-ob6t";
    const b = "C1-msm6dsp7-zq9x"; // 只有尾段不同——纯 CSS/尾截断会砍掉唯一区分位
    expect(elide(a, 12)).not.toBe(elide(b, 12));
    expect(elideEnd(a, 12)).toBe(elideEnd(b, 12)); // 对照：尾部截断确实分不出来
  });

  it("省略发生时结果码点数恰好等于 max（永不超预算）", () => {
    for (const max of [4, 5, 6, 12, 13, 20, 21]) {
      expect(cp(elide("/obj/geo1/transform1/tx", max))).toBe(max);
    }
  });

  it("奇数预算头多分一个（前缀优先于尾段）", () => {
    // max=6 → budget=5 → head=3 / tail=2
    expect(elide("abcdefghij", 6)).toBe(`abc${ELLIPSIS}ij`);
    // max=7 → budget=6 → head=3 / tail=3
    expect(elide("abcdefghij", 7)).toBe(`abc${ELLIPSIS}hij`);
  });

  it("路径类文本：尾段（真正的参数名）不丢", () => {
    expect(elide("/obj/geo1/transform1/tx", 14).endsWith("tx")).toBe(true);
  });

  it("max 装不下省略号时退化，且绝不抛", () => {
    expect(elide("abcdef", 1)).toBe(ELLIPSIS); // 只够放省略号本身
    expect(elide("abcdef", 0)).toBe("");
    expect(cp(elide("abcdef", 2))).toBe(2);
  });

  it("非法 max 按 0 处理（NaN / 负数 / Infinity 不抛）", () => {
    expect(elide("abcdef", Number.NaN)).toBe("");
    expect(elide("abcdef", -5)).toBe("");
    expect(elide("abcdef", Number.POSITIVE_INFINITY)).toBe("");
    expect(elide("abcdef", 4.7)).toBe(elide("abcdef", 4)); // 小数向下取整
  });

  it("按码点切分：代理对（emoji）不会被劈成坏字符", () => {
    const s = "🙂🙂🙂🙂🙂🙂🙂🙂";
    const out = elide(s, 5);
    expect(cp(out)).toBe(5);
    expect(out).not.toContain("\uFFFD");
    expect(out.includes("\uD83D") && !out.includes("🙂")).toBe(false); // 无半个代理对
    for (const ch of Array.from(out)) {
      expect(ch === ELLIPSIS || ch === "🙂").toBe(true);
    }
  });

  it("CJK 按码点计数（不按显示宽度——调用方自己按容器给 max）", () => {
    // 10 码点 → max=6：budget=5 → head=3（变换节）/ tail=2（通道）
    expect(elide("变换节点参数绑定通道", 6)).toBe(`变换节${ELLIPSIS}通道`);
    expect(cp(elide("变换节点参数绑定通道", 6))).toBe(6);
  });

  it("自定义省略标记按其码点数计入预算", () => {
    expect(elide("abcdefghij", 7, "...")).toBe("ab...ij"); // budget=4 → head2/tail2
    expect(cp(elide("abcdefghij", 7, "..."))).toBe(7);
  });

  it("null / undefined 文本按空串处理（防御反序列化脏值）", () => {
    expect(elide(undefined as unknown as string, 8)).toBe("");
    expect(elide(null as unknown as string, 8)).toBe("");
  });
});

describe("elideEnd（尾部省略：信息从头递减的文本）", () => {
  it("装得下原样；超了砍尾巴加省略号", () => {
    expect(elideEnd("short", 10)).toBe("short");
    expect(elideEnd("abcdefghij", 6)).toBe(`abcde${ELLIPSIS}`);
  });

  it("总长不超过 max（与 trace.ts truncateDigest 的 max+1 行为不同）", () => {
    for (const max of [3, 4, 10]) {
      expect(cp(elideEnd("0123456789abcdef", max))).toBe(max);
    }
  });

  it("边界与非法输入不抛", () => {
    expect(elideEnd("abc", 0)).toBe("");
    expect(elideEnd("abcdef", 1)).toBe(ELLIPSIS);
    expect(elideEnd("abcdef", Number.NaN)).toBe("");
    expect(elideEnd(undefined as unknown as string, 5)).toBe("");
  });

  it("按码点切分：不产出半个 emoji", () => {
    const out = elideEnd("🙂🙂🙂🙂🙂", 3);
    expect(cp(out)).toBe(3);
    expect(out).toBe(`🙂🙂${ELLIPSIS}`);
  });
});
