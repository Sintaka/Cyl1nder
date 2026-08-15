// 纯逻辑测试：overview.ts 导出的 data 通道纯函数（值格式化 / 通道行操作按钮 HTML）+ channelIdOf 的 data 分支。
// 不测 DOM（vitest 为 node 环境；overview.ts 的页面块在无 document 时整体跳过，纯函数照常可导入）。
import { describe, expect, it } from "vitest";
import type { ChannelRef } from "../src/protocol/types";
import { channelActionButtons, channelValueString, formatChannelValue } from "../src/overview";
import { channelIdOf } from "../src/stores/channels";

const data = (over: Partial<ChannelRef> = {}): ChannelRef => ({
  kind: "data",
  serial: "C1-aaaaaaaa-bbbb",
  nodePath: "/obj/geo1/sceneanimate1",
  absolutePath: "/obj/geo1/sceneanimate1/animation",
  adapter: "apex-anim",
  hip: "scene.hip",
  label: "animation",
  registeredAt: 1000,
  lastSeen: 2000,
  ...over,
});

const param = (over: Partial<ChannelRef> = {}): ChannelRef => ({
  kind: "param",
  serial: "C1-aaaaaaaa-bbbb",
  nodePath: "/obj/geo1/tag1",
  absolutePath: "/obj/geo1/transform1/tx",
  hip: "scene.hip",
  label: "tx",
  registeredAt: 1000,
  lastSeen: 2000,
  ...over,
});

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

describe("channelValueString", () => {
  it("普通值输出 JSON 全量文本（不截断）", () => {
    expect(channelValueString({ a: [1, 2] })).toBe('{"a":[1,2]}');
    expect(channelValueString(42)).toBe("42");
    expect(channelValueString(null)).toBe("null");
    expect(channelValueString("abc")).toBe('"abc"');
  });

  it("stringify 失败回退 String()（BigInt 抛错 / undefined 返回 undefined）", () => {
    expect(channelValueString(10n)).toBe("10");
    expect(channelValueString(undefined)).toBe("undefined");
  });

  it("循环引用抛错回退 String()", () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(channelValueString(cyc)).toBe("[object Object]");
  });
});

describe("formatChannelValue（三态）", () => {
  it("短值原样返回（≤40 字符）", () => {
    expect(formatChannelValue({ a: 1 })).toBe('{"a":1}');
    expect(formatChannelValue(42)).toBe("42");
    expect(formatChannelValue("abc")).toBe('"abc"');
  });

  it("恰好 40 字符不截断，41 字符截断加省略号", () => {
    const s40 = `"${"x".repeat(38)}"`; // JSON 文本恰好 40 字符
    expect(formatChannelValue("x".repeat(38))).toBe(s40);
    // 41 字符 → 前 40 字符（开引号 + 39 个 x）+ …
    expect(formatChannelValue("x".repeat(39))).toBe(`"${"x".repeat(39)}…`);
  });

  it("超长截断为前 40 字符加省略号（与全量文本前 40 一致）", () => {
    const v = { key: "v".repeat(80) };
    const full = JSON.stringify(v);
    expect(full.length).toBeGreaterThan(40);
    expect(formatChannelValue(v)).toBe(full.slice(0, 40) + "…");
  });

  it("失败回退 String() 后正常输出（不抛）", () => {
    expect(formatChannelValue(10n)).toBe("10");
    expect(formatChannelValue(undefined)).toBe("undefined");
  });
});

describe("channelActionButtons", () => {
  it("data 通道 → 「读值」「写值」两个按钮（id = absolutePath）", () => {
    const html = channelActionButtons(data());
    expect(html).toContain('data-read-channel="/obj/geo1/sceneanimate1/animation"');
    expect(html).toContain('data-write-channel="/obj/geo1/sceneanimate1/animation"');
    expect(html).toContain(">读值<");
    expect(html).toContain(">写值<");
    expect(html).not.toContain("data-channel-id");
    expect(html).not.toContain("探测");
  });

  it("param 通道 → 「探测」按钮（id = absolutePath）", () => {
    const html = channelActionButtons(param());
    expect(html).toContain('data-channel-id="/obj/geo1/transform1/tx"');
    expect(html).toContain(">探测<");
    expect(html).not.toContain("data-read-channel");
    expect(html).not.toContain("data-write-channel");
  });

  it("tag/hda 通道 → 「探测」按钮（id = serial）", () => {
    expect(channelActionButtons(tag())).toContain('data-channel-id="C1-aaaaaaaa-bbbb"');
    expect(channelActionButtons(tag({ kind: "hda" }))).toContain('data-channel-id="C1-aaaaaaaa-bbbb"');
  });
});

describe("channelIdOf data 分支（P4：data 与 param 同规则 = absolutePath）", () => {
  it("data 通道 id = absolutePath", () => {
    expect(channelIdOf(data())).toBe("/obj/geo1/sceneanimate1/animation");
    expect(channelIdOf(data({ absolutePath: null }))).toBe("");
  });
});
