import { describe, expect, it } from "vitest";
import { ANY, GEO, FLOAT, VEC3, canConnectSockets, socketTypeClass, SOCKET_TYPES } from "../src/nodes2/graph-model";

/**
 * ANY 通配端口类型（v0.1.00121）。
 *
 * 为什么必须有它：动态输入端口在**接线之前**没有类型，而空串在 canConnectSockets
 * 里是非法值（历史脏类型一律拒绝），GEO 又会挡住 float 源 —— 两者都会让类型传播
 * 没有起点。所以需要一个只存在于「还不知道」阶段的通配。
 *
 * 三条不变量（本文件钉住）：双向可连任意真实类型、**不进 SOCKET_TYPES**
 * （进了会让 socket-type.test.ts 的 3x2 兼容矩阵变形）、渲染成中性灰而不是红。
 */
describe("ANY 通配端口类型", () => {
  it("ANY connects both directions with every real type", () => {
    for (const t of [GEO, FLOAT, VEC3]) {
      expect(canConnectSockets(ANY, t), `ANY -> ${t}`).toBe(true);
      expect(canConnectSockets(t, ANY), `${t} -> ANY`).toBe(true);
    }
    expect(canConnectSockets(ANY, ANY)).toBe(true);
  });

  it("ANY is not in SOCKET_TYPES and renders neutral", () => {
    expect(SOCKET_TYPES).toEqual([GEO, FLOAT, VEC3]);
    expect(SOCKET_TYPES.includes(ANY)).toBe(false);
    expect(socketTypeClass(ANY)).toBe(""); // 中性灰，不是红
  });

  it("the real 3x2 matrix is unchanged: geo never talks to numbers", () => {
    expect(canConnectSockets(GEO, FLOAT)).toBe(false);
    expect(canConnectSockets(FLOAT, GEO)).toBe(false);
    expect(canConnectSockets(GEO, VEC3)).toBe(false);
    expect(canConnectSockets(VEC3, GEO)).toBe(false);
    expect(canConnectSockets(FLOAT, VEC3)).toBe(true);
    expect(canConnectSockets(VEC3, FLOAT)).toBe(true);
  });
});
