import { BridgeClient } from "../bridge/client";
import { ChannelRef } from "../protocol/types";

export type ChannelStatus = "offline" | "connecting" | "online";

type Listener = () => void;

/** 关联注册大全 store（无框架 pub-sub，照 WorkspaceStore 骨架）：
 *  持有全局通道引用列表 + 每通道连接状态，供 overview / 项目绑定共用。 */
export class ChannelsStore {
  channels: ChannelRef[] = [];
  status: Record<string, ChannelStatus> = {};

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  setChannels(list: ChannelRef[]): void {
    this.channels = list;
    this.emit();
  }

  /** 幂等 upsert：按 channelIdOf 去重，已存在则整体替换，否则追加。 */
  upsertChannel(ref: ChannelRef): void {
    const id = channelIdOf(ref);
    const i = this.channels.findIndex((c) => channelIdOf(c) === id);
    if (i >= 0) this.channels[i] = ref;
    else this.channels.push(ref);
    this.emit();
  }

  setStatus(channelId: string, s: ChannelStatus): void {
    this.status[channelId] = s;
    this.emit();
  }

  /** 拉取大全列表 → setChannels。网络失败吞错、不抛给调用方：
   *  桥离线 / 接口未就绪时保持现有 channels 原状（首次加载则仍为空）。 */
  async refresh(): Promise<void> {
    try {
      const { channels } = await new BridgeClient().listChannels();
      this.setChannels(channels);
    } catch {
      /* 吞错：保留原状，调用方按需自行探测错误（overview 直接走 BridgeClient 以显示 banner）。 */
    }
  }
}

/** 通道全局唯一 id：param/data 通道 = absolutePath，tag/hda 通道 = serial。
 *  （P4 起 kind=data 与 param 同规则：注册表 key 即 absolutePath，见 devlog/protocol.md channelId。） */
export function channelIdOf(ref: ChannelRef): string {
  return ref.kind === "param" || ref.kind === "data" ? (ref.absolutePath ?? "") : (ref.serial ?? "");
}

export const channelsStore = new ChannelsStore();
