import { describe, expect, it } from "vitest";
import { isParamEditorFocused, paramsEqual, shouldDeferParamRender } from "../src/app/param";
import type { ParamInfo } from "../src/app/param";

/**
 * 聚焦保护（v0.1.00128）的纯逻辑覆盖。
 *
 * 病象：param 输入框里打字时，每个字符都触发 commit → network.run() → store flush →
 * refreshSelectionPanels → renderParams 的整块 `innerHTML =` 重写，把**正在聚焦的
 * input 连根丢掉**（e2e 探针实测：慢速输入 "123" 只剩 "1"、焦点退回 BODY）。
 * 用户因此"必须在极短时间内按回车"——那是撞两个按键挤进同一帧的运气。
 *
 * 这里只测两个纯判据（vitest 环境是 node 且没装 jsdom，renderParams 本身测不了；
 * DOM 行为由 e2e 覆盖）：
 *   - isParamEditorFocused：焦点是否落在**本面板**参数表里的可编辑控件上
 *   - shouldDeferParamRender：这次重渲染该不该推迟
 */

/** 最小 DOM 替身：只提供两个判据真正读的成员（tagName / closest / contains）。 */
function fakeActive(tagName: string, insideTable: boolean, table: object = { t: "table" }) {
  return {
    tagName,
    closest: (sel: string) => (sel === ".cyl-param-table" && insideTable ? table : null),
  };
}

/** 面板替身：contains 用身份比较（真 DOM 的 contains 也是包含关系判定）。 */
function fakePanel(...owned: object[]) {
  return { contains: (node: never) => owned.includes(node as unknown as object) };
}

describe("isParamEditorFocused", () => {
  const table = { t: "table" };
  const panel = fakePanel(table);

  it("true for a focused input inside this panel's param table", () => {
    expect(isParamEditorFocused(panel, fakeActive("INPUT", true, table))).toBe(true);
  });

  it("true for select and textarea too (both hold an unfinished edit)", () => {
    expect(isParamEditorFocused(panel, fakeActive("SELECT", true, table))).toBe(true);
    expect(isParamEditorFocused(panel, fakeActive("TEXTAREA", true, table))).toBe(true);
  });

  it("tolerates lowercase tagName", () => {
    expect(isParamEditorFocused(panel, fakeActive("input", true, table))).toBe(true);
  });

  // 按钮/锚点不是编辑器：⛓ 链接按钮拿到焦点时**不该**冻结重渲染，否则点一下 ⛓
  // 就把面板卡在旧值上。
  it("false for a focused button inside the table", () => {
    expect(isParamEditorFocused(panel, fakeActive("BUTTON", true, table))).toBe(false);
  });

  it("false when focus is outside any param table (BODY after teardown)", () => {
    expect(isParamEditorFocused(panel, fakeActive("BODY", false))).toBe(false);
    expect(isParamEditorFocused(panel, fakeActive("INPUT", false))).toBe(false);
  });

  // 同页第二个参数面板：别人的输入框不该冻结**我的**重渲染。
  it("false when the input's table belongs to a DIFFERENT panel", () => {
    const other = { t: "other-table" };
    expect(isParamEditorFocused(panel, fakeActive("INPUT", true, other))).toBe(false);
  });

  it("false for null panel / null activeElement", () => {
    expect(isParamEditorFocused(null, fakeActive("INPUT", true, table))).toBe(false);
    expect(isParamEditorFocused(panel, null)).toBe(false);
    expect(isParamEditorFocused(undefined, undefined)).toBe(false);
  });
});

describe("shouldDeferParamRender", () => {
  // 这是修复的核心判据：同节点 + 有人在打字 → 推迟。
  it("defers a same-node refresh while an editor is focused", () => {
    expect(
      shouldDeferParamRender({ renderedNodeId: "tf1", nextNodeId: "tf1", editorFocused: true }),
    ).toBe(true);
  });

  it("never defers when no editor is focused (the normal per-frame path)", () => {
    expect(
      shouldDeferParamRender({ renderedNodeId: "tf1", nextNodeId: "tf1", editorFocused: false }),
    ).toBe(false);
  });

  // 换节点必须照渲：显示 A 的标题配 B 的值会让人把值改到错误的节点上——
  // 比打断打字严重得多。
  it("does NOT defer when the target node changed, even mid-typing", () => {
    expect(
      shouldDeferParamRender({ renderedNodeId: "tf1", nextNodeId: "tf2", editorFocused: true }),
    ).toBe(false);
  });

  it("does not defer without a rendered node or without a target", () => {
    expect(
      shouldDeferParamRender({ renderedNodeId: null, nextNodeId: "tf1", editorFocused: true }),
    ).toBe(false);
    expect(
      shouldDeferParamRender({ renderedNodeId: "tf1", nextNodeId: null, editorFocused: true }),
    ).toBe(false);
  });
});

/**
 * paramsEqual 拦的是**空提交**。
 *
 * 每个控件同时听 input 与 change，而 number input 的 change **在失焦时**才发、值与最后
 * 一次 input 相同。以前这条空提交跑不起来（面板每帧重渲染，input 早被换掉了）；聚焦
 * 保护让输入框活到失焦，它就真的会跑 —— 落在 600ms undo 去抖之后，生成一条
 * before === after 的空 undo 记录，害得用户按一次 Ctrl+Z"像是没反应"（e2e round7
 * param undo 正是这样红的）。
 */
describe("paramsEqual", () => {
  const p = (name: string, value: unknown, type = "float"): ParamInfo => ({ name, type, value });

  it("true for the identical array (fast path)", () => {
    const a = [p("tx", 5)];
    expect(paramsEqual(a, a)).toBe(true);
  });

  it("true for a fresh array with the same names and values (the no-op commit)", () => {
    expect(paramsEqual([p("tx", 5), p("ty", 0)], [p("tx", 5), p("ty", 0)])).toBe(true);
  });

  it("false when any value differs", () => {
    expect(paramsEqual([p("tx", 5)], [p("tx", 6)])).toBe(false);
  });

  it("distinguishes 0 from empty string without coercing", () => {
    expect(paramsEqual([p("g", 0, "string")], [p("g", "", "string")])).toBe(false);
  });

  // vector/color3 的值是数组，applyEdit 每次都新建 → 必须逐元素比，否则空提交拦不住。
  it("compares array values element-wise, not by reference", () => {
    expect(paramsEqual([p("c", [1, 0, 0], "color3")], [p("c", [1, 0, 0], "color3")])).toBe(true);
    expect(paramsEqual([p("c", [1, 0, 0], "color3")], [p("c", [1, 0, 1], "color3")])).toBe(false);
    expect(paramsEqual([p("c", [1, 0], "vector2")], [p("c", [1, 0, 0], "vector3")])).toBe(false);
  });

  it("false when a param is renamed or the count differs", () => {
    expect(paramsEqual([p("tx", 5)], [p("ty", 5)])).toBe(false);
    expect(paramsEqual([p("tx", 5)], [p("tx", 5), p("ty", 0)])).toBe(false);
  });

  // type/default 不参与：它们不是"用户改了什么"的一部分。
  it("ignores type and default metadata", () => {
    expect(
      paramsEqual([{ name: "tx", type: "float", value: 1, default: 0 }], [{ name: "tx", type: "int", value: 1 }]),
    ).toBe(true);
  });
});
