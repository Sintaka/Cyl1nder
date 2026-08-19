import { describe, expect, it } from "vitest";
import {
  absoluteAddress,
  adaptRefToTarget,
  buildRefMenuItems,
  pasteDisabledReason,
  planParamRows,
  planVecGroups,
  relativeAddress,
  resolvePasteSink,
  type ParamPanelInfo,
  type ParamRefClip,
  type ParamRefTarget,
} from "../src/app/param";

/** transform 节点的真实参数形状（照 graph-model.makeTransformNode，那是别人的写集，
 *  这里只复制形状用于断言——若那边改了参数名，本测试应当跟着红）。 */
function transformInfo(): ParamPanelInfo {
  return {
    label: "transform1",
    kind: "transform",
    params: [
      { name: "px", type: "float", value: 0, default: 0 },
      { name: "py", type: "float", value: 0, default: 0 },
      { name: "pz", type: "float", value: 0, default: 0 },
      { name: "tx", type: "float", value: 0, default: 0 },
      { name: "ty", type: "float", value: 0, default: 0 },
      { name: "tz", type: "float", value: 0, default: 0 },
      { name: "group", type: "string", value: "", default: "" },
      { name: "class", type: "string", value: "autoguess", default: "autoguess" },
    ],
  };
}

const floatTarget = (name: string, componentIndex: number | null = null): ParamRefTarget => ({
  name,
  kind: "float",
  componentIndex,
});
const vecTarget = (): ParamRefTarget => ({
  name: "t",
  kind: "vec3",
  members: ["tx", "ty", "tz"],
  componentIndex: null,
});

const vecClip: ParamRefClip = {
  relative: "transform1/t",
  absolute: "/obj/geo1/transform1/t",
  kind: "vec3",
  label: "t",
};
const floatClip: ParamRefClip = {
  relative: "transform1/tx",
  absolute: "/obj/geo1/transform1/tx",
  kind: "float",
  label: "tx",
};

/** #6：tx/ty/tz 合成一行 vec3（行首 T），底层仍是三个独立 float。 */
describe("planVecGroups / planParamRows（vec3 成组决策）", () => {
  it("transform：t 成组，成员按 x/y/z 顺序", () => {
    const groups = planVecGroups(transformInfo());
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("t");
    expect(groups[0].label).toBe("T"); // 用户原话「前面是 T」
    expect(groups[0].members).toEqual(["tx", "ty", "tz"]);
  });

  it("组行落在**首个分量原来的位置**，其余分量从流里摘掉", () => {
    const rows = planParamRows(transformInfo());
    // px/py/pz 三行 + T 一行 + group + class = 6 行（原本 8 个参数）
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => (r.kind === "param" ? r.param.name : `vec:${r.group.name}`))).toEqual([
      "px",
      "py",
      "pz",
      "vec:t",
      "group",
      "class",
    ]);
  });

  it("vec 行带齐三个分量参数（渲染时各自仍出一个 input）", () => {
    const row = planParamRows(transformInfo()).find((r) => r.kind === "vec");
    expect(row?.kind).toBe("vec");
    if (row?.kind !== "vec") return;
    expect(row.params.map((p) => p.name)).toEqual(["tx", "ty", "tz"]);
    expect(row.params.every((p) => p.type === "float")).toBe(true);
  });

  it("**缺一个分量就不成组**（宁可三行散开，也不渲染只有两格的假 vec3）", () => {
    const info = transformInfo();
    info.params = info.params.filter((p) => p.name !== "tz");
    expect(planVecGroups(info)).toEqual([]);
    expect(planParamRows(info).every((r) => r.kind === "param")).toBe(true);
  });

  it("分量类型不对（tx 被换成 string）也不成组", () => {
    const info = transformInfo();
    info.params = info.params.map((p) => (p.name === "tx" ? { ...p, type: "string", value: "" } : p));
    expect(planVecGroups(info)).toEqual([]);
  });

  it("别的 kind 不成组（只有 transform 声明了 t）", () => {
    const info = transformInfo();
    info.kind = "null";
    expect(planVecGroups(info)).toEqual([]);
    expect(planParamRows(info)).toHaveLength(8);
  });

  it("kind 为 null / 无参数时不炸", () => {
    expect(planVecGroups({ label: null, kind: null, params: [] })).toEqual([]);
    expect(planParamRows({ label: null, kind: null, params: [] })).toEqual([]);
  });
});

/** #5：地址拼装。相对形式**不带 `../`**——它相对的是网络，不是节点。 */
describe("relativeAddress / absoluteAddress", () => {
  it("相对 = <节点标签>/<参数名>，不带 ../", () => {
    expect(relativeAddress("transform1", "tx")).toBe("transform1/tx");
    expect(relativeAddress("transform1", "t")).toBe("transform1/t");
    expect(relativeAddress("transform1", "tx").startsWith("../")).toBe(false);
  });

  it("节点标签缺失 → 裸参数名（仍是合法相对地址，不拼 undefined/）", () => {
    expect(relativeAddress(null, "tx")).toBe("tx");
    expect(relativeAddress("", "tx")).toBe("tx");
    expect(relativeAddress("  ", "tx")).toBe("tx");
  });

  it("绝对 = <网络路径>/<相对地址>，末尾斜杠归一", () => {
    expect(absoluteAddress("/obj/geo1", "transform1/tx")).toBe("/obj/geo1/transform1/tx");
    expect(absoluteAddress("/obj/geo1/", "transform1/tx")).toBe("/obj/geo1/transform1/tx");
    expect(absoluteAddress("/obj/geo1///", "transform1/tx")).toBe("/obj/geo1/transform1/tx");
  });

  it("**网络路径未知 → null**（调用方据此禁用菜单项，绝不拼半截路径）", () => {
    expect(absoluteAddress(null, "transform1/tx")).toBeNull();
    expect(absoluteAddress(undefined, "transform1/tx")).toBeNull();
    expect(absoluteAddress("   ", "transform1/tx")).toBeNull();
  });
});

/** 四种「源类型 → 目标类型」组合，只有 vec3→float 要改写地址。 */
describe("adaptRefToTarget（引用适配到粘贴目标）", () => {
  const ok = (r: ReturnType<typeof adaptRefToTarget>) => {
    if (!r.ok) throw new Error(`expected ok: ${r.reason}`);
    return r.expression;
  };

  it("float → float：原样（**验收用例：transform 的 tx 驱动映射通道 tx**）", () => {
    expect(ok(adaptRefToTarget(floatClip, floatTarget("tx", 0), "relative"))).toBe("transform1/tx");
    expect(ok(adaptRefToTarget(floatClip, floatTarget("tx", 0), "absolute"))).toBe("/obj/geo1/transform1/tx");
  });

  it("float → float 跨参数：地址仍是**源**的，与目标名无关", () => {
    // 复制 tx、粘到 ty：ty 的值跟随 tx（这是引用，不是改名）
    expect(ok(adaptRefToTarget(floatClip, floatTarget("ty", 1), "relative"))).toBe("transform1/tx");
  });

  it("vec3 → vec3：原样", () => {
    expect(ok(adaptRefToTarget(vecClip, vecTarget(), "relative"))).toBe("transform1/t");
    expect(ok(adaptRefToTarget(vecClip, vecTarget(), "absolute"))).toBe("/obj/geo1/transform1/t");
  });

  it("vec3 → float：**补目标自己的分量后缀**（右键 T 复制，粘到 ty → .y）", () => {
    expect(ok(adaptRefToTarget(vecClip, floatTarget("tx", 0), "relative"))).toBe("transform1/t.x");
    expect(ok(adaptRefToTarget(vecClip, floatTarget("ty", 1), "relative"))).toBe("transform1/t.y");
    expect(ok(adaptRefToTarget(vecClip, floatTarget("tz", 2), "relative"))).toBe("transform1/t.z");
    expect(ok(adaptRefToTarget(vecClip, floatTarget("tz", 2), "absolute"))).toBe("/obj/geo1/transform1/t.z");
  });

  it("vec3 → 不属于任何组的 float：退回 .x（而不是拼出无分量的 vec3 引用）", () => {
    expect(ok(adaptRefToTarget(vecClip, floatTarget("px", null), "relative"))).toBe("transform1/t.x");
  });

  it("**float → vec3 拒绝**：一个标量填不满三个分量，不猜用户想要 (v,v,v)", () => {
    const r = adaptRefToTarget(floatClip, vecTarget(), "relative");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("填不满");
  });

  it("要绝对但剪贴板没有绝对形式 → 报错并说明原因", () => {
    const noAbs: ParamRefClip = { ...floatClip, absolute: null };
    const r = adaptRefToTarget(noAbs, floatTarget("tx", 0), "absolute");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("网络路径未知");
    // 相对形式仍可用（绝对不可用不该连带废掉相对）
    expect(ok(adaptRefToTarget(noAbs, floatTarget("tx", 0), "relative"))).toBe("transform1/tx");
  });
});

/** 用户要求的**正是这三项**：复制当前 param / 粘贴相对 / 粘贴绝对。 */
describe("buildRefMenuItems（三个菜单项）", () => {
  const find = (items: ReturnType<typeof buildRefMenuItems>, id: string) => items.find((i) => i.id === id)!;

  it("恒为三项，顺序 = 复制 / 粘贴相对 / 粘贴绝对", () => {
    const items = buildRefMenuItems(floatTarget("tx", 0), floatClip);
    expect(items.map((i) => i.id)).toEqual(["copy", "paste-relative", "paste-absolute"]);
    expect(find(items, "paste-relative").label).toBe("粘贴相对参考 param 地址");
    expect(find(items, "paste-absolute").label).toBe("粘贴绝对 param 地址");
  });

  it("复制项**恒可用**（只读面板也该能复制），标签带参数名", () => {
    const items = buildRefMenuItems(floatTarget("tx", 0), null);
    expect(find(items, "copy").enabled).toBe(true);
    expect(find(items, "copy").label).toContain("tx");
  });

  it("剪贴板为空 → 两个粘贴项禁用，且原因是「先复制」", () => {
    const items = buildRefMenuItems(floatTarget("tx", 0), null);
    expect(find(items, "paste-relative").enabled).toBe(false);
    expect(find(items, "paste-absolute").enabled).toBe(false);
    expect(find(items, "paste-relative").title).toContain("剪贴板为空");
  });

  it("启用的粘贴项带最终表达式（title 也回显它）", () => {
    const items = buildRefMenuItems(floatTarget("ty", 1), vecClip);
    const rel = find(items, "paste-relative");
    expect(rel.enabled).toBe(true);
    expect(rel.expression).toBe("transform1/t.y");
    expect(rel.title).toContain("transform1/t.y");
    expect(find(items, "paste-absolute").expression).toBe("/obj/geo1/transform1/t.y");
  });

  it("float → vec3：粘贴项禁用且写明类型不匹配（复制项仍可用）", () => {
    const items = buildRefMenuItems(vecTarget(), floatClip);
    expect(find(items, "copy").enabled).toBe(true);
    expect(find(items, "paste-relative").enabled).toBe(false);
    expect(find(items, "paste-relative").title).toContain("填不满");
  });

  it("没有绝对地址：绝对项禁用，相对项照常可用（互不牵连）", () => {
    const items = buildRefMenuItems(floatTarget("tx", 0), { ...floatClip, absolute: null });
    expect(find(items, "paste-relative").enabled).toBe(true);
    expect(find(items, "paste-absolute").enabled).toBe(false);
    expect(find(items, "paste-absolute").title).toContain("网络路径未知");
  });

  it("**两条通路都没有** → 粘贴禁用，复制仍可用（复制不依赖落地通路）", () => {
    const items = buildRefMenuItems(floatTarget("tx", 0), floatClip, { onPasteRef: false, onBind: false });
    expect(find(items, "paste-relative").enabled).toBe(false);
    expect(find(items, "paste-absolute").enabled).toBe(false);
    expect(find(items, "copy").enabled).toBe(true);
  });

  it("**只有 bindCtx（今天的实况）**：绝对 float 可粘，相对被禁并说明原因", () => {
    const items = buildRefMenuItems(floatTarget("tx", 0), floatClip, { onPasteRef: false, onBind: true });
    const abs = find(items, "paste-absolute");
    expect(abs.enabled).toBe(true);
    expect(abs.sink).toBe("bind");
    expect(abs.expression).toBe("/obj/geo1/transform1/tx");
    const rel = find(items, "paste-relative");
    expect(rel.enabled).toBe(false);
    expect(rel.title).toContain("只存绝对通道路径");
  });

  it("只有 bindCtx 时，带分量后缀的绝对粘贴被禁（bindings 只接受真实 parm 路径）", () => {
    const items = buildRefMenuItems(floatTarget("ty", 1), vecClip, { onPasteRef: false, onBind: true });
    expect(find(items, "paste-absolute").enabled).toBe(false);
    expect(find(items, "paste-absolute").title).toContain("分量后缀");
  });

  it("接了 onPasteRef → 相对与绝对都可粘，sink 走 paste-ref", () => {
    const items = buildRefMenuItems(floatTarget("tx", 0), floatClip, { onPasteRef: true, onBind: false });
    expect(find(items, "paste-relative").sink).toBe("paste-ref");
    expect(find(items, "paste-absolute").sink).toBe("paste-ref");
  });

  it("bind 通路的启用项 title 说明它经 P5b 落地（不假装是原生引用）", () => {
    const items = buildRefMenuItems(floatTarget("tx", 0), floatClip, { onPasteRef: false, onBind: true });
    expect(find(items, "paste-absolute").title).toContain("P5b");
  });

  it("拼出来的表达式过共用解析器：非法（分量混用）必须变成禁用 + 原因", () => {
    // 构造一个已经带 rgba 分量的源，再粘到 float 目标 → 会拼出 `.r` 后再补 `.x`？
    // 不会：vec3→float 补的是**目标**分量，所以这里验的是「解析器兜底真的接在链路上」。
    const weird: ParamRefClip = { relative: "p.xg", absolute: "/obj/geo1/p.xg", kind: "float", label: "p" };
    const items = buildRefMenuItems(floatTarget("tx", 0), weird);
    expect(find(items, "paste-relative").enabled).toBe(false);
    expect(find(items, "paste-relative").title).toContain("引用非法");
  });
});

/** 引用落地走哪条通路。今天只有 P5b bindings 接了线，所以这里的边界很窄。 */
describe("resolvePasteSink（落地通路选择）", () => {
  const both = { onPasteRef: true, onBind: true };
  const bindOnly = { onPasteRef: false, onBind: true };
  const none = { onPasteRef: false, onBind: false };

  it("onPasteRef 优先（最完整，相对/绝对都能存）", () => {
    expect(resolvePasteSink(floatTarget("tx", 0), "relative", "transform1/tx", both)).toBe("paste-ref");
    expect(resolvePasteSink(vecTarget(), "absolute", "/obj/geo1/transform1/t", both)).toBe("paste-ref");
  });

  it("**验收用例**：绝对 + 单 float + 无分量后缀 → 可经 P5b bindings 落地", () => {
    expect(resolvePasteSink(floatTarget("tx", 0), "absolute", "/obj/geo1/transform1/tx", bindOnly)).toBe("bind");
  });

  it("相对形式**不降级**成绝对绑定（那会静默丢掉跟随改名的语义）", () => {
    expect(resolvePasteSink(floatTarget("tx", 0), "relative", "transform1/tx", bindOnly)).toBeNull();
  });

  it("vec3 目标不能走 bind（一次 onBind 只能绑一个参数）", () => {
    expect(resolvePasteSink(vecTarget(), "absolute", "/obj/geo1/transform1/t", bindOnly)).toBeNull();
  });

  it("带分量后缀不能走 bind（bindings 存的是真实 parm 路径）", () => {
    expect(resolvePasteSink(floatTarget("ty", 1), "absolute", "/obj/geo1/transform1/t.y", bindOnly)).toBeNull();
  });

  it("非法表达式不能走 bind", () => {
    expect(resolvePasteSink(floatTarget("tx", 0), "absolute", "/obj/geo1/p.xg", bindOnly)).toBeNull();
  });

  it("一条通路都没有 → null", () => {
    expect(resolvePasteSink(floatTarget("tx", 0), "absolute", "/obj/geo1/transform1/tx", none)).toBeNull();
  });

  it("禁用原因按「用户能做什么」分开写", () => {
    expect(pasteDisabledReason(floatTarget("tx", 0), "relative")).toContain("绝对通道路径");
    expect(pasteDisabledReason(vecTarget(), "absolute")).toContain("vec3");
    expect(pasteDisabledReason(floatTarget("ty", 1), "absolute")).toContain("分量后缀");
  });
});
