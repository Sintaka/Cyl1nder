import { describe, expect, it } from "vitest";
import { parseParamRef } from "../src/nodes2/param-ref";

/**
 * 通道函数引用 `ch()/chf()/chs()/chi()`（v0.1.00130，用户提议）。
 *
 * **语义来自真 Houdini 实测**（`/obj/vexref_probe`，HScript 参数表达式）：
 *   ch("../transform1/tx")  -> 3.75   成功
 *   ch("transform1/tx")     -> 0.0    裸形式在 Houdini 里根本不解析
 *   chf("../transform1/tx") -> 0.0    chf 不是 HScript 函数（只存在于 VEX）
 *   chs("../transform1/tx") -> 3.75
 *
 * 所以：`../` 是必须的（参数挂在节点上，要先跳到节点所在那一层）；
 * 而「裸地址」是**我们自己的**历史写法，只在函数形式之外继续支持。
 */
const ok = (s: string) => {
  const r = parseParamRef(s);
  if (!r.ok) throw new Error(`expected ok for ${JSON.stringify(s)}: ${r.reason}`);
  return r;
};

describe("ch() 引用参与写回取值", () => {
  it("null 的引用框写 ch(\"../transform1/tx\") → 推 transform1 的 tx 值", async () => {
    const { collectWritebackTargets, resolveWritebackValue } = await import("../src/core/dataflow");
    const snap = {
      nodes: [
        {
          id: "o",
          kind: "output",
          label: "_output_",
          params: [
            { name: "address", type: "string", value: "C1-aaaaaaaa-bbbb" },
            { name: "type", type: "menu", value: "float" },
            { name: "port", type: "menu", value: "transform1/tx" },
          ],
        },
        { id: "n", kind: "null", label: "null1", params: [{ name: "ref_slot0", type: "string", value: 'ch("../transform1/tx")' }] },
        { id: "x", kind: "transform", label: "transform1", params: [{ name: "tx", type: "float", value: 6.5 }] },
      ],
      connections: [{ source: "n", sourceOutput: "out0", target: "o", targetInput: "out0" }],
    } as never;
    const targets = collectWritebackTargets(snap);
    expect(targets).toHaveLength(1);
    expect(resolveWritebackValue(snap, targets[0])).toBe(6.5);
  });

  it("指向图外的节点 → undefined（这次不写，**绝不兜底写 0**）", async () => {
    const { resolveWritebackValue } = await import("../src/core/dataflow");
    const snap = {
      nodes: [
        { id: "n", kind: "null", label: "null1", params: [{ name: "ref_slot0", type: "string", value: 'ch("../nosuch/tx")' }] },
      ],
      connections: [{ source: "n", sourceOutput: "out0", target: "o", targetInput: "out0" }],
    } as never;
    const t = { nodeId: "o", address: "C1-aaaaaaaa-bbbb", port: "transform1/tx", type: "float" };
    expect(resolveWritebackValue(snap, t)).toBeUndefined();
  });
});

describe("通道函数引用", () => {
  it("`ch(\"../transform1/tx\")` → 网络相对地址 transform1/tx", () => {
    const r = ok('ch("../transform1/tx")');
    expect(r.address).toBe("transform1/tx");
    expect(r.fn).toBe("ch");
    expect(r.fnType).toBeNull(); // ch 同时能取 float/string → 类型由目标决定
  });

  it("引号可有可无（从 Houdini 抄带引号，手打常不带）", () => {
    expect(ok("ch(../transform1/tx)").address).toBe("transform1/tx");
    expect(ok("ch('../transform1/tx')").address).toBe("transform1/tx");
  });

  it("chf/chs/chi 各自带出类型；chf 作为 float 别名被接受", () => {
    expect(ok('chf("../a/tx")').fnType).toBe("float");
    expect(ok('chs("../a/name")').fnType).toBe("string");
    expect(ok('chi("../a/n")').fnType).toBe("int");
  });

  it("大小写不敏感、允许函数名与括号间有空格", () => {
    expect(ok('CH ( "../a/tx" )').fn).toBe("ch");
  });

  it("绝对路径直接放行（不需要 ../）", () => {
    expect(ok('ch("/obj/geo1/transform1/tx")').address).toBe("/obj/geo1/transform1/tx");
  });

  it("分量后缀仍然可用，且与函数形式叠加", () => {
    const r = ok('ch("../sceneanimate1/animation.x")');
    expect(r.address).toBe("sceneanimate1/animation");
    expect(r.components).toEqual([0]);
  });

  // --- 以下都是「宁可报错也不要静默指错地方」---------------------------------
  it("函数里写裸地址 → 报错并给出正确写法（Houdini 里它求值为 0）", () => {
    const r = parseParamRef('ch("transform1/tx")');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('ch("../transform1/tx")');
  });

  it("`../../` 报错而不是当成一层（会指向错误的节点）", () => {
    const r = parseParamRef('ch("../../a/tx")');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("../../");
  });

  it("空括号报错", () => {
    expect(parseParamRef("ch()").ok).toBe(false);
  });

  it("裸地址（旧写法）继续可用，fn 为 null", () => {
    const r = ok("transform1/tx");
    expect(r.address).toBe("transform1/tx");
    expect(r.fn).toBeNull();
  });

  it("空串仍是「没有引用」而不是错误", () => {
    const r = ok("");
    expect(r.address).toBe("");
    expect(r.fn).toBeNull();
  });
});
