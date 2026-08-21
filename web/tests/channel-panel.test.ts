import { describe, expect, it } from "vitest";
import {
  assembleVec3,
  commitVec3,
  dotStateFor,
  formatFailedBanner,
  isNumericValue,
  mergePending,
  mergeValues,
  parseInput,
  rowKindFor,
} from "../src/app/channel-panel";

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

describe("rowKindFor（行 kind 判据：vec3 优先于 number/text）", () => {
  it("3 个有限数字的数组 → vec3", () => {
    expect(rowKindFor([1, 2, 3])).toBe("vec3");
    expect(rowKindFor([0.0153, 0.7108, 0])).toBe("vec3");
  });

  it("长度不为 3 的数组 → 不是 vec3", () => {
    expect(rowKindFor([1, 2])).not.toBe("vec3");
    expect(rowKindFor([1, 2, 3, 4])).not.toBe("vec3");
  });

  it("含非数字元素的数组 → 不是 vec3", () => {
    expect(rowKindFor([1, "x", 3])).not.toBe("vec3");
  });

  it("含布尔元素的数组 → 不是 vec3（bool 被拒绝，即便 Number(true)==1）", () => {
    expect(rowKindFor([1, true, 3])).not.toBe("vec3");
  });

  it("number → number", () => {
    expect(rowKindFor(5)).toBe("number");
  });

  it("字符串 → text", () => {
    expect(rowKindFor("s")).toBe("text");
  });

  it("undefined + declaredType=vec3 → vec3（首屏还没值，靠吊牌声明先出三格）", () => {
    expect(rowKindFor(undefined, "vec3")).toBe("vec3");
  });
});

describe("assembleVec3（单分量编辑装配：其余分量取自 prev，不重解析兄弟输入框）", () => {
  it("编辑一个分量，另两个保留 prev 原值", () => {
    const next = assembleVec3([1, 2, 3], 0, "10");
    expect(next).toEqual([10, 2, 3]);
  });

  it("编辑 y 分量", () => {
    const next = assembleVec3([1, 2, 3], 1, "20");
    expect(next).toEqual([1, 20, 3]);
  });

  it("空白/非法文本回退该分量的 prev 值，不产生 NaN/0", () => {
    expect(assembleVec3([1, 2, 3], 0, "")).toEqual([1, 2, 3]);
    expect(assembleVec3([1, 2, 3], 0, "abc")).toEqual([1, 2, 3]);
  });

  it("prev 非法（如首屏 undefined）时退回 [0,0,0] 再装配", () => {
    expect(assembleVec3(undefined, 0, "5")).toEqual([5, 0, 0]);
  });
});

describe("commitVec3（vec3 提交判定：装配 + 逐元素比较，changed 是推送的唯一依据）", () => {
  it("提交值是 number 数组而非字符串——这正是本次修复要解决的问题", () => {
    const { next } = commitVec3([0.0153, 0.7108, 0], 0, "7");
    expect(next).toEqual([7, 0.7108, 0]);
    expect(Array.isArray(next)).toBe(true);
    next.forEach((v) => expect(typeof v).toBe("number"));
  });

  it("编辑一个分量保留另外两个", () => {
    const { next } = commitVec3([1, 2, 3], 2, "9");
    expect(next).toEqual([1, 2, 9]);
  });

  it("空白/非法分量回退 prev 分量，不推 NaN/0", () => {
    expect(commitVec3([1, 2, 3], 1, "").next).toEqual([1, 2, 3]);
    expect(commitVec3([1, 2, 3], 1, "garbage").next).toEqual([1, 2, 3]);
  });

  it("装配结果与 prev 逐元素相同 → changed=false（同值不应推送，防止轮询回显刷爆 undo 栈）", () => {
    expect(commitVec3([1, 2, 3], 0, "1").changed).toBe(false);
    expect(commitVec3([1, 2, 3], 1, "").changed).toBe(false); // 空白回退到同值
  });

  it("装配结果与 prev 不同 → changed=true", () => {
    expect(commitVec3([1, 2, 3], 0, "9").changed).toBe(true);
  });
});

describe("dotStateFor（PUT 结算逐行状态点判定：顺序即优先级）", () => {
  it("throttled:true → pending，即便 ok 是 true（缺陷 C：尚未尝试写入，不能显示已同步）", () => {
    expect(dotStateFor("/obj/geo1/tx", { ok: true, throttled: true })).toBe("pending");
  });

  it("path 在 failed 里 → error", () => {
    const res = { ok: false, failed: { "/obj/geo1/tx": "ValueError: xxx" } };
    expect(dotStateFor("/obj/geo1/tx", res)).toBe("error");
  });

  it("path 不在 failed 里、另一个 path 在 → ok（缺陷 B：不能连坐同批里的成功通道）", () => {
    const res = { ok: false, failed: { "/obj/geo1/ty": "ValueError: xxx" } };
    expect(dotStateFor("/obj/geo1/tx", res)).toBe("ok");
  });

  it("ok:false 且完全没有 failed → error（传输层/整体性失败，任意 path 都算未知失败）", () => {
    const res = { ok: false, error: "houdini mcp not reachable" };
    expect(dotStateFor("/obj/geo1/tx", res)).toBe("error");
    expect(dotStateFor("/obj/geo1/ty", res)).toBe("error");
  });

  it("{ok:true} 且无 failed/throttled → ok", () => {
    expect(dotStateFor("/obj/geo1/tx", { ok: true })).toBe("ok");
  });

  it("throttled 优先于 failed（哪怕 failed 里恰好有这个 path，也判 pending——钉住文档顺序，不留给巧合）", () => {
    const res = { ok: true, throttled: true, failed: { "/obj/geo1/tx": "stale error" } };
    expect(dotStateFor("/obj/geo1/tx", res)).toBe("pending");
  });
});

describe("formatFailedBanner（失败横幅文案：长标识串中段省略，超量只报数量）", () => {
  it("单个失败：path: error", () => {
    expect(formatFailedBanner({ "/obj/geo1/tx": "not found" })).toBe("/obj/geo1/tx: not found");
  });

  it("多个失败用中文分号连接", () => {
    const out = formatFailedBanner({ "/obj/geo1/tx": "a", "/obj/geo1/ty": "b" });
    expect(out).toBe("/obj/geo1/tx: a；/obj/geo1/ty: b");
  });

  it("超过具名上限只列前几个，剩余报数量", () => {
    const failed: Record<string, string> = {};
    for (let i = 0; i < 8; i++) failed[`/obj/geo1/p${i}`] = "err";
    const out = formatFailedBanner(failed);
    expect(out).toContain("（另 3 个通道失败）");
  });
});
