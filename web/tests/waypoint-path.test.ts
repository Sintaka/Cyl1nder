import { describe, expect, it } from "vitest";
import { waypointConnectionPath } from "../src/nodes2/waypoint-path";

const A = { x: 0, y: 0 };
const B = { x: 100, y: 50 };

describe("waypointConnectionPath", () => {
  it("无 waypoint -> 单段，起终点正确", () => {
    const d = waypointConnectionPath(A, B, null);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.endsWith("100 50")).toBe(true);
    expect((d.match(/C /g) ?? []).length).toBe(1); // 一段
  });

  it("有 waypoint -> 两段且路径连续（经过该点）", () => {
    const w = { x: 50, y: -20 };
    const d = waypointConnectionPath(A, B, w);
    expect((d.match(/C /g) ?? []).length).toBe(2); // 两段
    expect(d).toContain("50 -20");                  // 第一段终点 = waypoint
    expect(d.endsWith("100 50")).toBe(true);        // 整条仍终于 end
  });

  it("只有一个 M 指令（连续路径，无断口）", () => {
    const d = waypointConnectionPath(A, B, { x: 50, y: -20 });
    expect((d.match(/M /g) ?? []).length).toBe(1);
  });

  it("waypoint 落在直线上时不产生 NaN", () => {
    const d = waypointConnectionPath(A, B, { x: 50, y: 25 });
    expect(d).not.toContain("NaN");
  });

  it("起终点重合（自环式）不产生 NaN", () => {
    const d = waypointConnectionPath(A, A, { x: 10, y: 10 });
    expect(d).not.toContain("NaN");
  });
});
