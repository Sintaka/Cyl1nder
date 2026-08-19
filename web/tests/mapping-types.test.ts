import { beforeEach, describe, expect, it, vi } from "vitest";

// fetch 走 mock：单测**绝不碰真桥**（桥可能没开，且单测不该依赖外部进程状态）。
const fetchMappingsMock = vi.fn();
vi.mock("../src/stores/projects", () => ({
  fetchMappings: (pid: string) => fetchMappingsMock(pid),
}));
// store.pushLog 是 primeMappingTypes 的失败出口，替掉以便断言"失败被记录且不抛"。
const pushLog = vi.fn();
vi.mock("../src/stores/workspace", () => ({ store: { pushLog: (m: string) => pushLog(m) } }));

import {
  invalidateMappingTypes,
  isMappingTypesPrimed,
  mappingAddressErrors,
  primeMappingTypes,
  resolveAddressType,
  setMappingTypes,
  toMappingTypeName,
} from "../src/nodes2/mapping-types";

const entry = (type: unknown) => ({ anchor: "C1-x", rel: "transform1/tx", kind: "param", type, label: "" });

beforeEach(() => {
  invalidateMappingTypes(); // 模块级缓存跨测试共享 -> 每例先归零
  fetchMappingsMock.mockReset();
  pushLog.mockReset();
});

describe("resolveAddressType", () => {
  it("已登记的逻辑名 -> 映射表里的类型（不是节点上手打的 type）", () => {
    setMappingTypes({ "point_1/tx": entry("float"), "ctrl/pos": entry("vec3"), mesh: entry("geo") });
    expect(resolveAddressType("point_1/tx")).toBe("float");
    expect(resolveAddressType("ctrl/pos")).toBe("vec3");
    expect(resolveAddressType("mesh")).toBe("geo");
  });

  it("未登记的逻辑名 -> null（绝不猜默认 geo）", () => {
    setMappingTypes({ "point_1/tx": entry("float") });
    expect(resolveAddressType("nope")).toBeNull();
  });

  it("缓存未加载 -> null（同样不猜）", () => {
    expect(isMappingTypesPrimed()).toBe(false);
    expect(resolveAddressType("point_1/tx")).toBeNull();
  });

  it("空 / 空白 address -> null（没填不是错误，也没有类型）", () => {
    setMappingTypes({ "point_1/tx": entry("float") });
    expect(resolveAddressType("")).toBeNull();
    expect(resolveAddressType("   ")).toBeNull();
  });

  it("两端空白被剔除（参数框里多打的空格不该让查表失败）", () => {
    setMappingTypes({ "point_1/tx": entry("vec3") });
    expect(resolveAddressType("  point_1/tx  ")).toBe("vec3");
  });
});

describe("toMappingTypeName —— 线上脏数据校验", () => {
  it("只认 geo/float/vec3", () => {
    expect(toMappingTypeName("geo")).toBe("geo");
    expect(toMappingTypeName("float")).toBe("float");
    expect(toMappingTypeName("vec3")).toBe("vec3");
  });

  it("其它一律 null（协议允许 type 是任意 string，前端不能盲信）", () => {
    for (const v of ["int", "Float", "vector3", "", null, undefined, 3, {}, ["float"]]) {
      expect(toMappingTypeName(v)).toBeNull();
    }
  });

  it("脏 type 的 entry 不入缓存 -> 该逻辑名按未登记处理，而不是带着未知类型上端口", () => {
    setMappingTypes({ bad: entry("int"), good: entry("float") });
    expect(resolveAddressType("bad")).toBeNull();
    expect(resolveAddressType("good")).toBe("float");
  });
});

describe("mappingAddressErrors", () => {
  it("已登记 -> 无错误", () => {
    setMappingTypes({ "point_1/tx": entry("float") });
    expect(mappingAddressErrors([{ nodeId: "n1", address: "point_1/tx" }])).toEqual({});
  });

  it("空 / 空白 address -> 无错误（未填写的节点不是错误）", () => {
    setMappingTypes({});
    expect(mappingAddressErrors([
      { nodeId: "n1", address: "" },
      { nodeId: "n2", address: "   " },
    ])).toEqual({});
  });

  it("已加载但表里没有 -> error 级，文案说「未登记」", () => {
    setMappingTypes({ other: entry("geo") });
    const errs = mappingAddressErrors([{ nodeId: "n1", address: "ghost" }]);
    expect(errs["n1"]).toHaveLength(1);
    expect(errs["n1"][0].severity).toBe("error");
    expect(errs["n1"][0].source).toBe("mapping");
    expect(errs["n1"][0].message).toContain("未登记");
    expect(errs["n1"][0].message).toContain("ghost");
  });

  it("缓存未加载 -> 文案说「映射表未加载」，**不指控**地址未登记（桥离线时冤枉用户）", () => {
    const errs = mappingAddressErrors([{ nodeId: "n1", address: "ghost" }]);
    expect(errs["n1"][0].message).toContain("映射表未加载");
    expect(errs["n1"][0].message).not.toContain("未登记");
  });

  it("同一个地址在两种状态下产生**不同**文案（这正是三态诚实的要点）", () => {
    const notPrimed = mappingAddressErrors([{ nodeId: "n1", address: "ghost" }])["n1"][0].message;
    setMappingTypes({});
    const primedAbsent = mappingAddressErrors([{ nodeId: "n1", address: "ghost" }])["n1"][0].message;
    expect(notPrimed).not.toBe(primedAbsent);
  });

  it("多节点各自成键；nodeId 缺失的条目被跳过（不崩）", () => {
    setMappingTypes({ ok: entry("geo") });
    const errs = mappingAddressErrors([
      { nodeId: "n1", address: "ghost" },
      { nodeId: "n2", address: "ok" },
      { nodeId: "", address: "ghost" },
    ]);
    expect(Object.keys(errs)).toEqual(["n1"]);
  });
});

describe("primeMappingTypes", () => {
  it("成功 -> 填缓存并标记已加载", async () => {
    fetchMappingsMock.mockResolvedValue({ entries: { "a/b": entry("vec3") } });
    await primeMappingTypes("P1-12345678-ab12");
    expect(isMappingTypesPrimed()).toBe(true);
    expect(resolveAddressType("a/b")).toBe("vec3");
  });

  it("桥离线（fetch 抛）-> **不 reject**、不 prime，只记一行日志", async () => {
    fetchMappingsMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(primeMappingTypes("P1-12345678-ab12")).resolves.toBeUndefined();
    expect(isMappingTypesPrimed()).toBe(false); // 保持"不知道"态，不谎报未登记
    expect(pushLog).toHaveBeenCalledTimes(1);
    expect(pushLog.mock.calls[0][0]).toContain("映射类型加载失败");
  });

  it("响应缺 entries -> 视为空表且已加载（表确实取到了，只是空的）", async () => {
    fetchMappingsMock.mockResolvedValue({});
    await primeMappingTypes("P1-12345678-ab12");
    expect(isMappingTypesPrimed()).toBe(true);
    expect(resolveAddressType("a/b")).toBeNull();
  });

  it("空 pid -> 直接返回，不发请求", async () => {
    await primeMappingTypes("");
    expect(fetchMappingsMock).not.toHaveBeenCalled();
    expect(isMappingTypesPrimed()).toBe(false);
  });

  it("同 pid 并发只发一次请求", async () => {
    fetchMappingsMock.mockResolvedValue({ entries: { x: entry("geo") } });
    await Promise.all([primeMappingTypes("P1-a"), primeMappingTypes("P1-a")]);
    expect(fetchMappingsMock).toHaveBeenCalledTimes(1);
  });

  it("取表途中被 invalidate -> 旧响应作废（不把过期数据写回缓存）", async () => {
    let release: (v: unknown) => void = () => {};
    fetchMappingsMock.mockReturnValue(new Promise((r) => { release = r; }));
    const p = primeMappingTypes("P1-a");
    invalidateMappingTypes();
    release({ entries: { stale: entry("float") } });
    await p;
    expect(isMappingTypesPrimed()).toBe(false);
    expect(resolveAddressType("stale")).toBeNull();
  });
});

describe("invalidateMappingTypes", () => {
  it("真的清空缓存并退回未加载态", () => {
    setMappingTypes({ "a/b": entry("float") });
    expect(resolveAddressType("a/b")).toBe("float");
    invalidateMappingTypes();
    expect(isMappingTypesPrimed()).toBe(false);
    expect(resolveAddressType("a/b")).toBeNull();
    // 失效后错误文案随之切回"未加载"（而不是继续说"未登记"）
    expect(mappingAddressErrors([{ nodeId: "n", address: "a/b" }])["n"][0].message).toContain("映射表未加载");
  });
});
