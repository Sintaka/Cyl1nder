import { describe, expect, it } from "vitest";
import { buildGraphAddress } from "../src/app/graph-address";

describe("buildGraphAddress", () => {
  const P = "P1-msyqxnfg-ct3c";
  const C = "C1-msm6dsp7-ob6t";

  // 用户实测的原始 bug：进入成员后地址丢了项目前缀。
  it("进入成员后仍带项目前缀（回归：曾退化成 /C1-…/）", () => {
    expect(buildGraphAddress(P, C)).toBe(`/${P}/${C}/`);
    expect(buildGraphAddress(P, C)).not.toBe(`/${C}/`);
  });

  it("项目根（无活动成员）→ 仅项目段", () => {
    expect(buildGraphAddress(P, "")).toBe(`/${P}/`);
  });

  it("纯 serial 模式（无项目）→ 单段，保持旧行为", () => {
    expect(buildGraphAddress(null, C)).toBe(`/${C}/`);
  });

  it("两者都无 → 根", () => {
    expect(buildGraphAddress(null, "")).toBe("/");
    expect(buildGraphAddress("", "")).toBe("/");
  });

  it("空串 projectId 视同无项目（不产出 //C1-… 这种坏地址）", () => {
    expect(buildGraphAddress("", C)).toBe(`/${C}/`);
  });
});
