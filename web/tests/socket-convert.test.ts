import { describe, expect, it } from "vitest";
import {
  FLOAT,
  GEO,
  VEC3,
  canConnectSockets,
  convertSocketValue,
} from "../src/nodes2/graph-model";

/**
 * 数值端口隐式转换（float ↔ vec3）的取值语义单测——针对 graph-model.ts 的纯函数
 * convertSocketValue + canConnectSockets（不驱动 rete、不碰 network.ts）。
 *
 * 背景（见 nodes2/network.ts 顶部注释与本文件对应 devlog）：float/vec3 类型的
 * _input_/_output_ 端口值从不经过几何 trace（isGeoPort 在 node.kind==="input" 时
 * 立即判定死链，非 geo 的 _output_ 也不会被选为 outNode），它们的值走映射系统按
 * 逻辑名读写。因此 convertSocketValue 目前**没有**在 network.ts 里被调用——
 * 转换语义只在这里、直接对着 graph-model 的纯函数钉住。
 */

describe("convertSocketValue（float ↔ vec3 取值转换）", () => {
  it("float -> vec3：有限数值 -> 三分量同值", () => {
    expect(convertSocketValue(5, FLOAT, VEC3)).toEqual([5, 5, 5]);
    expect(convertSocketValue(0, FLOAT, VEC3)).toEqual([0, 0, 0]);
    expect(convertSocketValue(-2.5, FLOAT, VEC3)).toEqual([-2.5, -2.5, -2.5]);
  });

  it("float -> vec3：非有限数（NaN/Infinity）不编造向量，原样返回", () => {
    expect(convertSocketValue(NaN, FLOAT, VEC3)).toBe(NaN);
    expect(convertSocketValue(Infinity, FLOAT, VEC3)).toBe(Infinity);
    expect(convertSocketValue(-Infinity, FLOAT, VEC3)).toBe(-Infinity);
  });

  it("float -> vec3：非 number 类型的值（脏数据）原样返回，不抛", () => {
    expect(convertSocketValue("5", FLOAT, VEC3)).toBe("5");
    expect(convertSocketValue(undefined, FLOAT, VEC3)).toBeUndefined();
    expect(convertSocketValue(null, FLOAT, VEC3)).toBeNull();
  });

  it("vec3 -> float：取第一个通道", () => {
    expect(convertSocketValue([1, 2, 3], VEC3, FLOAT)).toBe(1);
    expect(convertSocketValue([0, 9, 9], VEC3, FLOAT)).toBe(0);
    expect(convertSocketValue([-4.2], VEC3, FLOAT)).toBe(-4.2); // 长度不足 3 也按第一分量取
  });

  it("vec3 -> float：空数组原样返回（不是 undefined，不编造 0）", () => {
    const empty: number[] = [];
    expect(convertSocketValue(empty, VEC3, FLOAT)).toBe(empty);
    expect(convertSocketValue(empty, VEC3, FLOAT)).not.toBeUndefined();
  });

  it("vec3 -> float：非数组的值（脏数据）原样返回，不抛", () => {
    expect(convertSocketValue(5, VEC3, FLOAT)).toBe(5);
    expect(convertSocketValue("nope", VEC3, FLOAT)).toBe("nope");
    expect(convertSocketValue(undefined, VEC3, FLOAT)).toBeUndefined();
    expect(convertSocketValue(null, VEC3, FLOAT)).toBeNull();
  });

  it("同类型：原样返回（不复制/不改造，含引用同一性）", () => {
    expect(convertSocketValue(5, FLOAT, FLOAT)).toBe(5);
    const arr = [1, 2, 3];
    expect(convertSocketValue(arr, VEC3, VEC3)).toBe(arr); // 同一引用，未被克隆
    expect(convertSocketValue("geo-blob", GEO, GEO)).toBe("geo-blob");
  });

  it("任一端是 geo：原样返回，绝不当数值处理", () => {
    expect(convertSocketValue(5, FLOAT, GEO)).toBe(5);
    expect(convertSocketValue(5, GEO, FLOAT)).toBe(5);
    expect(convertSocketValue([1, 2, 3], VEC3, GEO)).toEqual([1, 2, 3]);
    expect(convertSocketValue([1, 2, 3], GEO, VEC3)).toEqual([1, 2, 3]);
  });
});

describe("canConnectSockets 与 convertSocketValue 的转换表一致性", () => {
  const TYPES = [GEO, FLOAT, VEC3] as const;

  it("凡 convertSocketValue 会真的改写值的一对，canConnectSockets 必须放行", () => {
    // "会真的改写值" = 用一个有代表性的输入探测，转换结果与输入不同（引用/值都变了）。
    const probes: Record<string, unknown> = { [GEO]: "geo-blob", [FLOAT]: 3, [VEC3]: [3, 4, 5] };
    for (const from of TYPES) {
      for (const to of TYPES) {
        const before = probes[from];
        const after = convertSocketValue(before, from, to);
        const changed = after !== before || JSON.stringify(after) !== JSON.stringify(before);
        if (changed) {
          expect(canConnectSockets(from, to), `${from} -> ${to} 转换改写了值，但连线被拒`).toBe(true);
        }
      }
    }
  });

  it("凡 geo 参与的一对，canConnectSockets 必须拒绝（除 geo->geo 本身）", () => {
    for (const to of TYPES) {
      if (to !== GEO) expect(canConnectSockets(GEO, to)).toBe(false);
    }
    for (const from of TYPES) {
      if (from !== GEO) expect(canConnectSockets(from, GEO)).toBe(false);
    }
    expect(canConnectSockets(GEO, GEO)).toBe(true);
  });

  it("float<->vec3 双向放行，且转换语义确实不同（float 广播 vs vec3 取首分量）", () => {
    expect(canConnectSockets(FLOAT, VEC3)).toBe(true);
    expect(canConnectSockets(VEC3, FLOAT)).toBe(true);
    expect(convertSocketValue(7, FLOAT, VEC3)).toEqual([7, 7, 7]);
    expect(convertSocketValue([7, 8, 9], VEC3, FLOAT)).toBe(7);
  });
});
