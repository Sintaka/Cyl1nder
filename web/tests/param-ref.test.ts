import { describe, expect, it } from "vitest";
import { parseParamRef } from "../src/nodes2/param-ref";

/** 引用表达式解析：`<地址>` / `<地址>.<分量>`。#4/#5/#6 共用的唯一判据。 */
describe("parseParamRef", () => {
  const ok = (s: string) => {
    const r = parseParamRef(s);
    if (!r.ok) throw new Error(`expected ok for ${JSON.stringify(s)}: ${r.reason}`);
    return r;
  };

  it("空串 = 没有引用（合法状态，不是错误）", () => {
    for (const v of ["", "   ", null, undefined, 42]) {
      const r = parseParamRef(v as never);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.address).toBe("");
    }
  });

  it("纯地址：相对与绝对都不带分量", () => {
    expect(ok("transform1/tx").address).toBe("transform1/tx");
    expect(ok("transform1/tx").components).toEqual([]);
    expect(ok("/obj/geo1/transform1/tx").address).toBe("/obj/geo1/transform1/tx");
    expect(ok("point_1").compSet).toBeNull();
  });

  it("单分量：xyzw 与 rgba 下标一致", () => {
    expect(ok("point_1.x").components).toEqual([0]);
    expect(ok("point_1.r").components).toEqual([0]);
    expect(ok("point_1.y").components).toEqual([1]);
    expect(ok("point_1.g").components).toEqual([1]);
    expect(ok("point_1.w").components).toEqual([3]);
    expect(ok("point_1.a").components).toEqual([3]);
    expect(ok("point_1.x").compSet).toBe("xyzw");
    expect(ok("point_1.r").compSet).toBe("rgba");
    expect(ok("point_1.z").address).toBe("point_1"); // 地址不含分量后缀
  });

  it("多分量 swizzle：同一套内合法", () => {
    expect(ok("p.xy").components).toEqual([0, 1]);
    expect(ok("p.xyz").components).toEqual([0, 1, 2]);
    expect(ok("p.rgb").components).toEqual([0, 1, 2]);
    expect(ok("p.yx").components).toEqual([1, 0]); // 顺序按用户写的来
  });

  it("**混用直接报错**（用户明确要求），不按「下标反正一样」放行", () => {
    for (const bad of ["p.xg", "p.rx", "p.xyza", "p.rgbw"]) {
      const r = parseParamRef(bad);
      expect(r.ok, `${bad} 必须报错`).toBe(false);
      if (!r.ok) expect(r.reason).toContain("混用");
    }
  });

  it("大小写不敏感（.X 与 .x 同义）", () => {
    expect(ok("p.X").components).toEqual([0]);
    expect(ok("p.RGB").components).toEqual([0, 1, 2]);
  });

  it("地址里本来就有点 → 那个点属于地址，不是分量", () => {
    const r = ok("sceneanimate1/animation.data");
    expect(r.address).toBe("sceneanimate1/animation.data");
    expect(r.components).toEqual([]);
  });

  it("退化输入：末尾点归地址；只有分量没地址报错；超 4 个分量报错", () => {
    expect(ok("tx.").address).toBe("tx.");
    const noAddr = parseParamRef(".x");
    expect(noAddr.ok).toBe(false);
    const tooMany = parseParamRef("p.xyzwx");
    expect(tooMany.ok).toBe(false);
  });
});
