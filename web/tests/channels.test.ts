import { describe, expect, it, vi } from "vitest";
import type { ChannelRef } from "../src/protocol/types";
import { ChannelsStore, channelIdOf } from "../src/stores/channels";

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

describe("channelIdOf", () => {
  it("param 通道 id = absolutePath", () => {
    expect(channelIdOf(param())).toBe("/obj/geo1/transform1/tx");
  });

  it("tag/hda 通道 id = serial", () => {
    expect(channelIdOf(tag())).toBe("C1-aaaaaaaa-bbbb");
    expect(channelIdOf(tag({ kind: "hda" }))).toBe("C1-aaaaaaaa-bbbb");
  });

  it("缺省时回退空串", () => {
    expect(channelIdOf(param({ absolutePath: null }))).toBe("");
    expect(channelIdOf(tag({ serial: undefined }))).toBe("");
  });
});

describe("ChannelsStore", () => {
  it("setChannels 替换列表并 emit", () => {
    const s = new ChannelsStore();
    const fn = vi.fn();
    s.subscribe(fn);
    s.setChannels([tag(), param()]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.channels).toHaveLength(2);
  });

  it("upsertChannel 重复 upsert 替换同 key", () => {
    const s = new ChannelsStore();
    s.upsertChannel(param({ label: "tx", lastSeen: 2000 }));
    s.upsertChannel(param({ label: "tx-v2", lastSeen: 3000 }));
    expect(s.channels).toHaveLength(1);
    expect(s.channels[0].label).toBe("tx-v2");
    expect(s.channels[0].lastSeen).toBe(3000);
  });

  it("upsertChannel 不同 key 追加", () => {
    const s = new ChannelsStore();
    s.upsertChannel(param({ absolutePath: "/obj/geo1/transform1/tx" }));
    s.upsertChannel(param({ absolutePath: "/obj/geo1/transform1/ty" }));
    expect(s.channels).toHaveLength(2);
  });

  it("setStatus 记录状态并 emit", () => {
    const s = new ChannelsStore();
    const fn = vi.fn();
    s.subscribe(fn);
    s.setStatus("C1-aaaaaaaa-bbbb", "online");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.status["C1-aaaaaaaa-bbbb"]).toBe("online");
  });

  it("subscribe 返回退订函数", () => {
    const s = new ChannelsStore();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.setChannels([tag()]);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    s.setChannels([]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
