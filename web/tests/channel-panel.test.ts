import { describe, expect, it } from "vitest";
import { isNumericValue, mergePending, mergeValues, parseInput } from "../src/app/channel-panel";

describe("isNumericValue（数字判据：typeof v === number → number 输入框）", () => {
  it("number → true", () => {
    expect(isNumericValue(3.14)).toBe(true);
    expect(isNumericValue(0)).toBe(true);
    expect(isNumericValue(-2e3)).toBe(true);
  });

  it("数字字符串 → false（字符串/布尔用 text 输入框）", () => {
    expect(isNumericValue("3.14")).toBe(false);
    expect(isNumericValue("0")).toBe(false);
  });

  it("布尔 → false", () => {
    expect(isNumericValue(true)).toBe(false);
    expect(isNumericValue(false)).toBe(false);
  });

  it("null / undefined / 数组 / 对象 → false", () => {
    expect(isNumericValue(null)).toBe(false);
    expect(isNumericValue(undefined)).toBe(false);
    expect(isNumericValue([1])).toBe(false);
    expect(isNumericValue({})).toBe(false);
  });
});

describe("parseInput（number 输入解析）", () => {
  it("合法数字文本 → number", () => {
    expect(parseInput("3.5", 0)).toBe(3.5);
    expect(parseInput("  -2e3 ", 0)).toBe(-2000);
    expect(parseInput("42", 0)).toBe(42);
  });

  it("空白 / 空串 → 回退 prev（不推脏值）", () => {
    expect(parseInput("", 1.5)).toBe(1.5);
    expect(parseInput("   ", 1.5)).toBe(1.5);
  });

  it("非法文本 → 回退 prev", () => {
    expect(parseInput("abc", 1.5)).toBe(1.5);
    expect(parseInput("3.5abc", 1.5)).toBe(1.5);
    expect(parseInput("Infinity", 1.5)).toBe(1.5); // Number("Infinity") 非有限
  });

  it("prev 为任意类型时回退原样（不转换类型）", () => {
    expect(parseInput("", true)).toBe(true);
    expect(parseInput("", "abc")).toBe("abc");
  });
});

describe("mergeValues（WS 推送合并不覆盖编辑行）", () => {
  it("incoming 覆盖未在编辑中的行", () => {
    const cur = { a: 1, b: 2 };
    const out = mergeValues(cur, { a: 10, b: 20 }, new Set(["c"]));
    expect(out.a).toBe(10);
    expect(out.b).toBe(20);
  });

  it("编辑中的行保留 current 值（不被推送覆盖）", () => {
    const cur = { a: 5, b: 2 };
    const out = mergeValues(cur, { a: 99, b: 20 }, new Set(["a"]));
    expect(out.a).toBe(5); // 编辑中：保留
    expect(out.b).toBe(20); // 非编辑：覆盖
  });

  it("editingKeys 支持数组形式", () => {
    const cur = { a: 5, b: 2, c: 3 };
    const out = mergeValues(cur, { a: 99, b: 20, c: 30 }, ["a", "b"]);
    expect(out).toEqual({ a: 5, b: 2, c: 30 });
  });

  it("incoming 未含的 key 保留 current 原值", () => {
    const cur = { a: 1, b: 2, c: 3 };
    const out = mergeValues(cur, { b: 20 }, new Set());
    expect(out.a).toBe(1);
    expect(out.b).toBe(20);
    expect(out.c).toBe(3);
  });

  it("空 incoming 为 no-op（返回同一 current 对象）", () => {
    const cur = { a: 1 };
    expect(mergeValues(cur, {}, new Set())).toBe(cur);
    expect(cur).toEqual({ a: 1 });
  });
});

describe("mergePending（节流 pending 合并，latest-wins）", () => {
  it("同 key 后到值覆盖旧值（latest-wins）", () => {
    const p: Record<string, unknown> = { tx: 1, ty: 2 };
    mergePending(p, { tx: 5 });
    expect(p).toEqual({ tx: 5, ty: 2 });
  });

  it("不同 key 累积", () => {
    const p: Record<string, unknown> = {};
    mergePending(p, { tx: 1 });
    mergePending(p, { ty: 2 });
    mergePending(p, { tz: 3 });
    expect(p).toEqual({ tx: 1, ty: 2, tz: 3 });
  });

  it("空 values 为 no-op", () => {
    const p: Record<string, unknown> = { tx: 1 };
    mergePending(p, {});
    expect(p).toEqual({ tx: 1 });
  });

  it("从空 pending 起步合并", () => {
    const p: Record<string, unknown> = {};
    mergePending(p, { tx: 1.5 });
    expect(p).toEqual({ tx: 1.5 });
  });
});
