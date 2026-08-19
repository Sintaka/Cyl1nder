import { describe, expect, it } from "vitest";
import {
  addressOf,
  canWriteProjectGraph,
  isInSubNetwork,
  pathOf,
  projectIdOf,
  snapshotSerialOf,
  withPath,
  type GraphScope,
} from "../src/app/graph-scope";

const P = "P1-msyiasx0-a2gf";
const C = "C1-msm6dsp7-ob6t";
const member: GraphScope = { kind: "member", projectId: P, serial: C };

describe("canWriteProjectGraph（钉住真实数据丢失）", () => {
  it("成员图绝不允许写进项目槽位", () => {
    expect(canWriteProjectGraph(member)).toBe(false);
  });

  it("只有项目根图可以写项目槽位", () => {
    expect(canWriteProjectGraph({ kind: "project", projectId: P })).toBe(true);
    expect(canWriteProjectGraph({ kind: "serial", serial: C })).toBe(false);
    expect(canWriteProjectGraph({ kind: "none" })).toBe(false);
  });
});

describe("addressOf", () => {
  it("member 带项目前缀（回归：曾退化成 /C1-…/）", () => {
    expect(addressOf(member)).toBe(`/${P}/${C}/`);
  });

  it("project / serial / none", () => {
    expect(addressOf({ kind: "project", projectId: P })).toBe(`/${P}/`);
    expect(addressOf({ kind: "serial", serial: C })).toBe(`/${C}/`);
    expect(addressOf({ kind: "none" })).toBe("/");
  });
});

describe("addressOf + 层级路径（v0.1.00119 obj/sop）", () => {
  it("项目根 + 空/缺省 path === 改造前输出（字节不变）", () => {
    expect(addressOf({ kind: "project", projectId: P })).toBe(`/${P}/`);
    expect(addressOf({ kind: "project", projectId: P, path: [] })).toBe(`/${P}/`);
  });

  it("进入 geo1 / geo1-geo2", () => {
    expect(addressOf({ kind: "project", projectId: P, path: ["geo1"] })).toBe(`/${P}/geo1/`);
    expect(addressOf({ kind: "project", projectId: P, path: ["geo1", "geo2"] })).toBe(`/${P}/geo1/geo2/`);
  });

  it("member / serial 的既有两段与一段形态不变，层级在其后追加", () => {
    expect(addressOf(member)).toBe(`/${P}/${C}/`);
    expect(addressOf({ ...member, path: ["geo1"] })).toBe(`/${P}/${C}/geo1/`);
    expect(addressOf({ kind: "serial", serial: C, path: ["geo1"] })).toBe(`/${C}/geo1/`);
  });

  it("空段被剔除 —— 地址栏是用户可打字的入口，`//` 是看不出错在哪的地址", () => {
    expect(addressOf({ kind: "project", projectId: P, path: ["", "geo1", ""] })).toBe(`/${P}/geo1/`);
    expect(addressOf({ kind: "project", projectId: P, path: ["", ""] })).toBe(`/${P}/`);
  });
});

describe("canWriteProjectGraph 与层级路径无关（子图内联在项目自己的 graph.json 里）", () => {
  it("在 geo 子网络里仍然是项目图 —— 收紧成 false 会让 Save 静默改道丢编辑", () => {
    expect(canWriteProjectGraph({ kind: "project", projectId: P, path: ["geo1"] })).toBe(true);
    expect(canWriteProjectGraph({ kind: "project", projectId: P, path: ["geo1", "geo2"] })).toBe(true);
  });

  it("成员图在子网络里也依然不许写项目槽位", () => {
    expect(canWriteProjectGraph({ ...member, path: ["geo1"] })).toBe(false);
  });
});

describe("pathOf / isInSubNetwork / withPath", () => {
  it("缺省 path → []，不在子网络", () => {
    expect(pathOf({ kind: "project", projectId: P })).toEqual([]);
    expect(isInSubNetwork({ kind: "project", projectId: P })).toBe(false);
    expect(pathOf({ kind: "none" })).toEqual([]);
  });

  it("有 path → 深度 > 0", () => {
    const s: GraphScope = { kind: "project", projectId: P, path: ["geo1"] };
    expect(pathOf(s)).toEqual(["geo1"]);
    expect(isInSubNetwork(s)).toBe(true);
  });

  it("withPath 逐字保留归属键（顺手改 kind 正是本文件要防的事故形状）", () => {
    expect(withPath({ kind: "project", projectId: P }, ["geo1"])).toEqual({
      kind: "project",
      projectId: P,
      path: ["geo1"],
    });
    expect(withPath(member, ["geo1"])).toEqual({ kind: "member", projectId: P, serial: C, path: ["geo1"] });
  });

  it("回到顶层时删掉 path 键 —— 无层级的 scope 与改造前结构相同", () => {
    expect(withPath({ kind: "project", projectId: P, path: ["geo1"] }, [])).toEqual({
      kind: "project",
      projectId: P,
    });
    expect(withPath({ ...member, path: ["geo1"] }, [])).toEqual({ kind: "member", projectId: P, serial: C });
    expect(withPath({ kind: "serial", serial: C, path: ["geo1"] }, [])).toEqual({ kind: "serial", serial: C });
    expect(withPath({ kind: "none" }, ["geo1"])).toEqual({ kind: "none" });
  });
});

describe("snapshotSerialOf / projectIdOf", () => {
  it("member 既记来源项目又记 serial —— 这正是它不能等同于项目根的原因", () => {
    expect(projectIdOf(member)).toBe(P);
    expect(snapshotSerialOf(member)).toBe(C);
  });

  it("项目根没有单一 serial（旧代码在此写 per-serial snapshot 会 400）", () => {
    expect(snapshotSerialOf({ kind: "project", projectId: P })).toBeNull();
    expect(projectIdOf({ kind: "serial", serial: C })).toBeNull();
  });
});
