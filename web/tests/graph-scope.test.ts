import { describe, expect, it } from "vitest";
import {
  addressOf,
  canWriteProjectGraph,
  projectIdOf,
  snapshotSerialOf,
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
