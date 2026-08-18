import { describe, expect, it, vi } from "vitest";
import type { ChannelRef, ProjectRef } from "../src/protocol/types";
import { PROJECT_SERIAL_RE, SERIAL_RE } from "../src/protocol/types";
import { ProjectsStore } from "../src/stores/projects";

const tag = (over: Partial<ChannelRef> = {}): ChannelRef => ({
  kind: "tag",
  serial: "C1-aaaaaaaa-bbbb",
  nodePath: "/obj/geo1/tag1",
  hip: "scene.hip",
  label: "吊牌",
  registeredAt: 1000,
  lastSeen: 2000,
  ...over,
});

const project = (over: Partial<ProjectRef> = {}): ProjectRef => ({
  projectSerial: "P1-m1abc2d3e-ab12",
  label: "测试项目",
  // v0.1.00116：项目 = 一个 hip 文件（key 仍是 projectSerial，hip 只是当前绑定）
  hip: "D:/proj/scene.hip",
  hipName: "scene.hip",
  createdAt: 1000,
  updatedAt: 1000,
  migratedAt: 0,
  previousHip: "",
  members: [],
  ...over,
});

describe("PROJECT_SERIAL_RE", () => {
  it("匹配合法 P1- 序列号", () => {
    expect(PROJECT_SERIAL_RE.test("P1-m1abc2d3e-ab12")).toBe(true);
    expect(PROJECT_SERIAL_RE.test("P1-12345678-12ab")).toBe(true);
    expect(PROJECT_SERIAL_RE.test("P1-a1b2c3d4e5f6-zz99")).toBe(true);
  });

  it("拒绝非法 P1- 序列号", () => {
    expect(PROJECT_SERIAL_RE.test("P1-abc-ab")).toBe(false); // 中段不足 8 位
    expect(PROJECT_SERIAL_RE.test("P1-1234567890-12345")).toBe(false); // 尾段超过 4 位
    expect(PROJECT_SERIAL_RE.test("P1-ABCDEFGH-ab12")).toBe(false); // 大写不允许
    expect(PROJECT_SERIAL_RE.test("p1-12345678-ab12")).toBe(false); // 前缀必须大写 P1
    expect(PROJECT_SERIAL_RE.test("P1-12345678-")).toBe(false); // 缺尾段
  });

  it("C1- 系列（HDA serial）不匹配，反之亦然", () => {
    expect(PROJECT_SERIAL_RE.test("C1-m1abc2d3e-ab12")).toBe(false);
    expect(SERIAL_RE.test("P1-m1abc2d3e-ab12")).toBe(false);
  });
});

describe("ProjectsStore", () => {
  it("setProjects 替换列表并 emit", () => {
    const s = new ProjectsStore();
    const fn = vi.fn();
    s.subscribe(fn);
    s.setProjects([project(), project({ projectSerial: "P1-bbbbbbbb-cccc" })]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.projects).toHaveLength(2);
  });

  it("upsertProject 同 serial 整体替换", () => {
    const s = new ProjectsStore();
    s.upsertProject(project({ label: "v1", updatedAt: 1000, members: [tag()] }));
    s.upsertProject(project({ label: "v2", updatedAt: 2000 }));
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0].label).toBe("v2");
    expect(s.projects[0].updatedAt).toBe(2000);
    expect(s.projects[0].members).toHaveLength(0); // 整体替换：旧成员快照被覆盖
  });

  it("upsertProject 不同 serial 追加", () => {
    const s = new ProjectsStore();
    s.upsertProject(project({ projectSerial: "P1-aaaaaaaa-bbbb" }));
    s.upsertProject(project({ projectSerial: "P1-bbbbbbbb-cccc" }));
    expect(s.projects).toHaveLength(2);
  });

  it("subscribe 触发与退订", () => {
    const s = new ProjectsStore();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.setProjects([project()]);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    s.setProjects([]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("upsertProject 也触发 subscribe", () => {
    const s = new ProjectsStore();
    const fn = vi.fn();
    s.subscribe(fn);
    s.upsertProject(project());
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
