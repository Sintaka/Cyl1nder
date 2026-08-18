import { beforeEach, describe, expect, it } from "vitest";
import {
  RefRegistry,
  isAtOrUnder,
  makeRefRegistry,
  normalizeRefPath,
  rewriteRefPath,
} from "../src/nodes2/ref-registry";

describe("normalizeRefPath", () => {
  it("去尾部斜杠，让 /obj/geo1/ 与 /obj/geo1 成为同一个前缀", () => {
    expect(normalizeRefPath("/obj/geo1/")).toBe("/obj/geo1");
    expect(normalizeRefPath("/obj/geo1")).toBe("/obj/geo1");
  });

  it("折叠重复分隔符 + 去首尾空白", () => {
    expect(normalizeRefPath("  /obj//geo1///tx  ")).toBe("/obj/geo1/tx");
  });

  it("根路径保留为 /（不被去成空串）", () => {
    expect(normalizeRefPath("/")).toBe("/");
    expect(normalizeRefPath("///")).toBe("/");
  });

  it("非字符串 / 空值 → 空串（调用方据此判非法）", () => {
    expect(normalizeRefPath("")).toBe("");
    expect(normalizeRefPath("   ")).toBe("");
    expect(normalizeRefPath(null)).toBe("");
    expect(normalizeRefPath(undefined)).toBe("");
    expect(normalizeRefPath(42)).toBe("");
    expect(normalizeRefPath(["/obj/geo1"])).toBe("");
  });
});

describe("isAtOrUnder（前缀边界规则）", () => {
  it("自身命中，子路径命中", () => {
    expect(isAtOrUnder("/obj/geo1", "/obj/geo1")).toBe(true);
    expect(isAtOrUnder("/obj/geo1/transform1/tx", "/obj/geo1")).toBe(true);
  });

  // 本模块存在的理由：纯 startsWith 会把 geo10 当成 geo1 的子路径。
  it("geo10 对前缀 geo1 不命中（纯 startsWith 的经典误伤）", () => {
    expect("/obj/geo10/tx".startsWith("/obj/geo1")).toBe(true); // 纯 startsWith 会命中
    expect(isAtOrUnder("/obj/geo10/tx", "/obj/geo1")).toBe(false); // 边界规则不命中
    expect(isAtOrUnder("/obj/geo10", "/obj/geo1")).toBe(false);
    expect(isAtOrUnder("/obj/geo1_backup", "/obj/geo1")).toBe(false);
  });

  it("父路径不命中子前缀（方向不可反）", () => {
    expect(isAtOrUnder("/obj/geo1", "/obj/geo1/transform1")).toBe(false);
  });

  it("根前缀命中一切绝对路径", () => {
    expect(isAtOrUnder("/obj/geo1", "/")).toBe(true);
    expect(isAtOrUnder("/", "/")).toBe(true);
  });

  it("空输入绝不命中（宁可不改也不错改）", () => {
    expect(isAtOrUnder("", "/obj/geo1")).toBe(false);
    expect(isAtOrUnder("/obj/geo1", "")).toBe(false);
  });
});

describe("rewriteRefPath", () => {
  it("整条相等 → 换成新路径；子路径 → 只换头，尾部原样", () => {
    expect(rewriteRefPath("/obj/geo1", "/obj/geo1", "/obj/box1")).toBe("/obj/box1");
    expect(rewriteRefPath("/obj/geo1/transform1/tx", "/obj/geo1", "/obj/box1")).toBe("/obj/box1/transform1/tx");
  });

  it("不命中的路径原样返回（含 geo10 误伤场景）", () => {
    expect(rewriteRefPath("/obj/geo10/tx", "/obj/geo1", "/obj/box1")).toBe("/obj/geo10/tx");
    expect(rewriteRefPath("/obj/other/tx", "/obj/geo1", "/obj/box1")).toBe("/obj/other/tx");
  });

  it("根前缀换头不产出 // 坏路径", () => {
    expect(rewriteRefPath("/obj/geo1", "/", "/scene")).toBe("/scene/obj/geo1");
    expect(rewriteRefPath("/obj/geo1", "/obj", "/")).toBe("/geo1");
  });
});

describe("RefRegistry 登记与生命周期", () => {
  let reg: RefRegistry;
  beforeEach(() => {
    reg = makeRefRegistry();
  });

  it("register 落库并归一化路径，返回拷贝", () => {
    const site = reg.register("n1", "tx", "/obj/geo1/transform1/tx/");
    expect(site).toEqual({ nodeId: "n1", field: "tx", path: "/obj/geo1/transform1/tx" });
    expect(reg.get("n1", "tx")?.path).toBe("/obj/geo1/transform1/tx");
    expect(reg.size()).toBe(1);
  });

  it("同一 (nodeId, field) 再次 register 覆盖而非堆叠", () => {
    reg.register("n1", "tx", "/obj/geo1/tx");
    reg.register("n1", "tx", "/obj/geo2/ty");
    expect(reg.size()).toBe(1);
    expect(reg.get("n1", "tx")?.path).toBe("/obj/geo2/ty");
  });

  it("非法输入不入表且不抛（空 id / 空字段 / 空路径 / 非字符串）", () => {
    expect(reg.register("", "tx", "/obj/geo1")).toBeNull();
    expect(reg.register("n1", "", "/obj/geo1")).toBeNull();
    expect(reg.register("n1", "tx", "   ")).toBeNull();
    expect(reg.register("n1", "tx", null as unknown as string)).toBeNull();
    expect(reg.size()).toBe(0);
  });

  it("get 返回拷贝：外部改动污染不到注册表", () => {
    reg.register("n1", "tx", "/obj/geo1/tx");
    const got = reg.get("n1", "tx");
    if (got) got.path = "/hacked";
    expect(reg.get("n1", "tx")?.path).toBe("/obj/geo1/tx");
  });

  it("unregister / unregisterNode / clear", () => {
    reg.register("n1", "tx", "/obj/geo1/tx");
    reg.register("n1", "ty", "/obj/geo1/ty");
    reg.register("n2", "tx", "/obj/geo1/tx");
    expect(reg.unregister("n1", "tx")).toBe(true);
    expect(reg.unregister("n1", "tx")).toBe(false);
    expect(reg.unregisterNode("n1")).toBe(1);
    expect(reg.unregisterNode("nope")).toBe(0);
    expect(reg.size()).toBe(1);
    reg.clear();
    expect(reg.size()).toBe(0);
    expect(reg.list()).toEqual([]);
  });

  it("list 稳定排序（nodeId 再 field）", () => {
    reg.register("n2", "tx", "/obj/a");
    reg.register("n1", "ty", "/obj/b");
    reg.register("n1", "tx", "/obj/c");
    expect(reg.list().map((s) => `${s.nodeId}.${s.field}`)).toEqual(["n1.tx", "n1.ty", "n2.tx"]);
  });
});

describe("RefRegistry.audit（谁引用了它 / parmsReferencingThis）", () => {
  let reg: RefRegistry;
  beforeEach(() => {
    reg = makeRefRegistry();
    reg.register("n1", "tx", "/obj/geo1/transform1/tx");
    reg.register("n2", "src", "/obj/geo1");
    reg.register("n3", "tx", "/obj/geo10/tx"); // 边界：不该跟着 geo1 走
    reg.register("n4", "tx", "/obj/other/tx");
  });

  it("命中自身与子路径，排除 geo10 与无关路径", () => {
    expect(reg.audit("/obj/geo1").map((s) => s.nodeId)).toEqual(["n1", "n2"]);
  });

  it("查询路径同样归一化（带尾斜杠也照样命中）", () => {
    expect(reg.audit("/obj/geo1/").map((s) => s.nodeId)).toEqual(["n1", "n2"]);
  });

  it("空 / 非法路径 → 空清单", () => {
    expect(reg.audit("")).toEqual([]);
    expect(reg.audit("   ")).toEqual([]);
  });

  it("audit 是只读的（不改注册表状态）", () => {
    const before = reg.list();
    reg.audit("/obj/geo1");
    expect(reg.list()).toEqual(before);
  });
});

// 登记表记的是「名字字符串」而非活指针 → 引用不存在的路径合法，改名后自愈。
describe("悬空引用自愈（Houdini 同性质）", () => {
  it("先引用尚不存在的路径，之后改名成它 → 引用即刻命中", () => {
    const reg = makeRefRegistry();
    // n1 引用 /obj/future（此刻图里没有这个节点）——登记表不校验存在性
    reg.register("n1", "src", "/obj/future/OUT");
    expect(reg.audit("/obj/future").map((s) => s.nodeId)).toEqual(["n1"]);
    // 把真实节点 /obj/tmp 改名成 /obj/future：n1 早已指向该名字，无需重写即生效
    expect(reg.rewriteOnRename("/obj/tmp", "/obj/future").rewritten).toBe(0);
    expect(reg.get("n1", "src")?.path).toBe("/obj/future/OUT");
  });
});

describe("RefRegistry.auditRename（改名前审计，零副作用）", () => {
  let reg: RefRegistry;
  beforeEach(() => {
    reg = makeRefRegistry();
    reg.register("n1", "tx", "/obj/geo1/transform1/tx");
    reg.register("n2", "src", "/obj/geo1");
    reg.register("n3", "tx", "/obj/geo10/tx");
  });

  it("报出完整影响面：exact 标出「就是这个节点」与「它的子路径」", () => {
    const audit = reg.auditRename("/obj/geo1", "/obj/box1");
    expect(audit.ok).toBe(true);
    expect(audit.reason).toBe("");
    expect(audit.changes).toEqual([
      { nodeId: "n1", field: "tx", from: "/obj/geo1/transform1/tx", to: "/obj/box1/transform1/tx", exact: false },
      { nodeId: "n2", field: "src", from: "/obj/geo1", to: "/obj/box1", exact: true },
    ]);
  });

  it("审计不改任何状态（改名前可反复查看）", () => {
    const before = reg.list();
    reg.auditRename("/obj/geo1", "/obj/box1");
    reg.auditRename("/obj/geo1", "/obj/box1");
    expect(reg.list()).toEqual(before);
  });

  it("非法参数 → ok=false + 具体 reason + 空 changes", () => {
    expect(reg.auditRename("", "/obj/box1")).toMatchObject({ ok: false, reason: "empty-old", changes: [] });
    expect(reg.auditRename("/obj/geo1", "  ")).toMatchObject({ ok: false, reason: "empty-new", changes: [] });
    // 归一化后相同（仅尾斜杠差异）也算未改名
    expect(reg.auditRename("/obj/geo1", "/obj/geo1/")).toMatchObject({ ok: false, reason: "unchanged", changes: [] });
  });

  it("审计里的路径是归一化形式", () => {
    const audit = reg.auditRename("/obj//geo1/", "/obj/box1/");
    expect(audit.oldPath).toBe("/obj/geo1");
    expect(audit.newPath).toBe("/obj/box1");
    expect(audit.ok).toBe(true);
  });
});

describe("RefRegistry.rewriteOnRename", () => {
  let reg: RefRegistry;
  beforeEach(() => {
    reg = makeRefRegistry();
  });

  it("重写登记过的引用点，保留 geo10 不动", () => {
    reg.register("n1", "tx", "/obj/geo1/transform1/tx");
    reg.register("n2", "src", "/obj/geo1");
    reg.register("n3", "tx", "/obj/geo10/tx");
    const res = reg.rewriteOnRename("/obj/geo1", "/obj/box1");
    expect(res.rewritten).toBe(2);
    expect(reg.get("n1", "tx")?.path).toBe("/obj/box1/transform1/tx");
    expect(reg.get("n2", "src")?.path).toBe("/obj/box1");
    expect(reg.get("n3", "tx")?.path).toBe("/obj/geo10/tx"); // 边界保护
  });

  // registered-only 的核心断言：没登记 = 没依赖 = 改名不碰。
  it("空注册表：返回 0 且什么都没改", () => {
    const res = reg.rewriteOnRename("/obj/geo1", "/obj/box1");
    expect(res.rewritten).toBe(0);
    expect(res.audit.ok).toBe(true);
    expect(res.audit.changes).toEqual([]);
    expect(reg.size()).toBe(0);
  });

  it("未登记的节点不受影响（只有登记过的那条被重写）", () => {
    reg.register("registered", "tx", "/obj/geo1/tx");
    const before = reg.get("registered", "tx")?.path;
    expect(before).toBe("/obj/geo1/tx");
    // 从未 register 过的引用点：改名后依然查不到，注册表不会替它凭空造一条
    expect(reg.get("unregistered", "tx")).toBeNull();
    reg.rewriteOnRename("/obj/geo1", "/obj/box1");
    expect(reg.get("unregistered", "tx")).toBeNull();
    expect(reg.size()).toBe(1);
  });

  it("幂等：同一次改名重复执行第二次为 0", () => {
    reg.register("n1", "tx", "/obj/geo1/tx");
    expect(reg.rewriteOnRename("/obj/geo1", "/obj/box1").rewritten).toBe(1);
    const second = reg.rewriteOnRename("/obj/geo1", "/obj/box1");
    expect(second.rewritten).toBe(0);
    expect(reg.get("n1", "tx")?.path).toBe("/obj/box1/tx");
  });

  it("非法改名（空路径 / 未改名）→ 0 且状态不变", () => {
    reg.register("n1", "tx", "/obj/geo1/tx");
    const before = reg.list();
    expect(reg.rewriteOnRename("", "/obj/box1").rewritten).toBe(0);
    expect(reg.rewriteOnRename("/obj/geo1", "").rewritten).toBe(0);
    expect(reg.rewriteOnRename("/obj/geo1", "/obj/geo1").rewritten).toBe(0);
    expect(reg.list()).toEqual(before);
  });

  it("audit 与 rewrite 报的是同一份变化（先看后做，所见即所改）", () => {
    reg.register("n1", "tx", "/obj/geo1/transform1/tx");
    reg.register("n2", "src", "/obj/geo1");
    const audit = reg.auditRename("/obj/geo1", "/obj/box1");
    const res = reg.rewriteOnRename("/obj/geo1", "/obj/box1");
    expect(res.audit.changes).toEqual(audit.changes);
    expect(res.rewritten).toBe(audit.changes.length);
  });

  it("连续改名沿引用点累积（geo1 → box1 → cube1）", () => {
    reg.register("n1", "tx", "/obj/geo1/transform1/tx");
    reg.rewriteOnRename("/obj/geo1", "/obj/box1");
    reg.rewriteOnRename("/obj/box1", "/obj/cube1");
    expect(reg.get("n1", "tx")?.path).toBe("/obj/cube1/transform1/tx");
  });

  // 实机验证的性质：相对与绝对在**改名**上完全等价（都登记、都重写）。
  it("相对路径与绝对路径同等重写（边界规则不看是否以 / 开头）", () => {
    reg.register("abs", "src", "/obj/geo1/OUT");
    reg.register("rel", "src", "geo1/OUT");
    expect(reg.rewriteOnRename("/obj/geo1", "/obj/box1").rewritten).toBe(1);
    expect(reg.get("abs", "src")?.path).toBe("/obj/box1/OUT");
    expect(reg.get("rel", "src")?.path).toBe("geo1/OUT"); // 相对串对绝对前缀不命中
    expect(reg.rewriteOnRename("geo1", "box1").rewritten).toBe(1);
    expect(reg.get("rel", "src")?.path).toBe("box1/OUT"); // 以自身形式重写
  });

  it("父级网络改名带走全部后代引用（一次改名，多点跟随）", () => {
    reg.register("a", "tx", "/obj/rig/geo1/tx");
    reg.register("b", "ty", "/obj/rig/geo2/ty");
    reg.register("c", "tz", "/obj/rig2/geo1/tz"); // rig2 不是 rig 的后代
    const res = reg.rewriteOnRename("/obj/rig", "/obj/rig_v2");
    expect(res.rewritten).toBe(2);
    expect(reg.get("a", "tx")?.path).toBe("/obj/rig_v2/geo1/tx");
    expect(reg.get("b", "ty")?.path).toBe("/obj/rig_v2/geo2/ty");
    expect(reg.get("c", "tz")?.path).toBe("/obj/rig2/geo1/tz");
  });
});
