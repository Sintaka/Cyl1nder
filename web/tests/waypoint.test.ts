import { describe, expect, it } from "vitest";
import {
  getConnectionWaypoint,
  setConnectionWaypoint,
} from "../src/nodes2/graph-model";

// waypoint = 连线上的装饰件，**不是节点**（v0.1.00118）。
// 旧 dot 是真节点：插入要「删1连接+加1节点+加2连接」，于是进入拓扑、参与 cook，
// 删掉还留两条半截线。改成连接的一个可选属性后这些问题在结构上消失。
describe("connection waypoint accessors", () => {
  it("默认无 waypoint", () => {
    expect(getConnectionWaypoint({})).toBeNull();
  });

  it("设置后可读回", () => {
    const c: Record<string, unknown> = {};
    setConnectionWaypoint(c, { x: 12, y: -34 });
    expect(getConnectionWaypoint(c)).toEqual({ x: 12, y: -34 });
  });

  it("传 null 删除该键（删属性而非改拓扑，故不可能留半截线）", () => {
    const c: Record<string, unknown> = {};
    setConnectionWaypoint(c, { x: 1, y: 2 });
    setConnectionWaypoint(c, null);
    expect(getConnectionWaypoint(c)).toBeNull();
    expect("waypoint" in c).toBe(false); // 键被 delete，不是留个 undefined
  });

  it("非有限坐标一律当无（脏数据不产出坏路径）", () => {
    const c: Record<string, unknown> = {};
    c.waypoint = { x: Number.NaN, y: 3 };
    expect(getConnectionWaypoint(c)).toBeNull();
    c.waypoint = { x: 1, y: Number.POSITIVE_INFINITY };
    expect(getConnectionWaypoint(c)).toBeNull();
  });

  it("无 waypoint 的连接序列化不含该键（旧图字节兼容）", () => {
    // 与 bypass 同一约定：只在有值时才输出，否则新增字段会把所有旧快照的字节改掉
    const conns = [{ source: "a", sourceOutput: "out0", target: "b", targetInput: "in0" }];
    const entry: Record<string, unknown> = { ...conns[0] };
    const wp = getConnectionWaypoint(conns[0]);
    if (wp) entry.waypoint = wp;
    expect(JSON.stringify(entry)).toBe(
      '{"source":"a","sourceOutput":"out0","target":"b","targetInput":"in0"}',
    );
  });

  it("存的是副本，外部改动不污染连接状态", () => {
    const c: Record<string, unknown> = {};
    const src = { x: 5, y: 6 };
    setConnectionWaypoint(c, src);
    src.x = 999;
    expect(getConnectionWaypoint(c)).toEqual({ x: 5, y: 6 });
  });
});
