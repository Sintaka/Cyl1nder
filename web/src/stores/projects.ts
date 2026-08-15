import { BridgeClient } from "../bridge/client";
import { ProjectRef } from "../protocol/types";

type Listener = () => void;

/** 项目 store（无框架 pub-sub，照 ChannelsStore 骨架）：
 *  持有项目列表（成员 = 通道引用快照），供 overview / 后续 nodeview 项目根共用。 */
export class ProjectsStore {
  projects: ProjectRef[] = [];

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  setProjects(list: ProjectRef[]): void {
    this.projects = list;
    this.emit();
  }

  /** 幂等 upsert：按 projectSerial 去重，已存在则整体替换，否则追加。 */
  upsertProject(p: ProjectRef): void {
    const i = this.projects.findIndex((x) => x.projectSerial === p.projectSerial);
    if (i >= 0) this.projects[i] = p;
    else this.projects.push(p);
    this.emit();
  }

  /** 拉取项目列表 → setProjects。网络失败吞错、不抛给调用方：
   *  桥离线 / 接口未就绪时保持现有 projects 原状（首次加载则仍为空）。 */
  async refresh(): Promise<void> {
    try {
      const { projects } = await new BridgeClient().listProjects();
      this.setProjects(projects);
    } catch {
      /* 吞错：保留原状（同 channelsStore.refresh 语义，overview 直接走 BridgeClient 以显示 banner）。 */
    }
  }
}

export const projectsStore = new ProjectsStore();
