import { describe, expect, it } from "vitest";
import { matchingPoints, parseGroupExpression, pointInGroup, resolveAttribute } from "../src/nodes2/groups";
import type { GroupData, GroupFilter } from "../src/nodes2/groups";
import type { AttributeData } from "../src/protocol/types";

/** n points at (i, y, 0). */
const pts = (n: number, y = 0): number[][] => Array.from({ length: n }, (_, i) => [i, y, 0]);

const attr = (type: string, values: AttributeData["values"]): AttributeData => ({
  type,
  count: 1,
  values,
});

/** String attributes arrive as strings at runtime (protocol types them as numbers). */
const stringAttr = (values: string[]): AttributeData =>
  ({ type: "String", count: 1, values: values as unknown as number[] }) as AttributeData;

const data = (points: number[][], attributes: GroupData["attributes"] = {}): GroupData => ({
  points,
  attributes,
  curves: [],
});

type Cls = GroupFilter["cls"];
const match = (expr: string, d: GroupData, cls?: Cls): number[] =>
  matchingPoints(parseGroupExpression(expr, cls), d);

describe("parseGroupExpression basics", () => {
  it("empty / whitespace / * match all points", () => {
    const d = data(pts(5));
    expect(matchingPoints(parseGroupExpression(""), d)).toEqual([0, 1, 2, 3, 4]);
    expect(matchingPoints(parseGroupExpression("   "), d)).toEqual([0, 1, 2, 3, 4]);
    expect(matchingPoints(parseGroupExpression("*"), d)).toEqual([0, 1, 2, 3, 4]);
    expect(parseGroupExpression("").all).toBe(true);
    expect(parseGroupExpression("*").all).toBe(true);
  });

  it("autoguess / no class resolve to points in v1", () => {
    expect(parseGroupExpression("1-2").cls).toBe("points");
    expect(parseGroupExpression("1-2", "autoguess").cls).toBe("points");
    expect(parseGroupExpression("1-2", "prim").cls).toBe("prim");
  });
});

describe("id rules", () => {
  const d = data(pts(10));
  it("range n-m (inclusive)", () => {
    expect(match("1-5", d)).toEqual([1, 2, 3, 4, 5]);
  });
  it("single id", () => {
    expect(match("3", d)).toEqual([3]);
  });
  it("range with step n-m:step", () => {
    expect(match("1-10:2", d)).toEqual([1, 3, 5, 7, 9]);
  });
  it("space-separated id list", () => {
    expect(match("2 5 8", d)).toEqual([2, 5, 8]);
  });
  it("comma-separated id list", () => {
    expect(match("1,3,5", d)).toEqual([1, 3, 5]);
  });
  it("keep,step: first K ids then skip S / keep S cycles", () => {
    expect(match("0-10:3,2", data(pts(11)))).toEqual([0, 1, 2, 5, 6, 9, 10]);
    // literal "keep" shorthand (docs write <keep> as a number) -> K = 1
    expect(match("0-10:keep,2", d)).toEqual([0, 3, 4, 7, 8]);
  });
  it("dedupes overlapping rules", () => {
    expect(match("1-2 2-3", d)).toEqual([1, 2, 3]);
  });
});

describe("remove rules (^ / !)", () => {
  it("^ removes from the accumulated selection (starts empty)", () => {
    const d = data(pts(5));
    expect(match("0-4 ^1-2", d)).toEqual([0, 3, 4]);
    // removal from an empty base selects nothing
    expect(match("^1-2", d)).toEqual([]);
    expect(match("!1-2", d)).toEqual([]);
    expect(match("0-4 !1", d)).toEqual([0, 2, 3, 4]);
  });
  it("* ^ids = all except", () => {
    expect(match("* ^1-2", data(pts(5)))).toEqual([0, 3, 4]);
  });
});

describe("attribute rules", () => {
  it("@P.y>0 compares a point component", () => {
    const d = data([[0, -1, 0], [0, 2, 0], [0, 0, 0], [0, 5, 0]]);
    expect(match("@P.y>0", d)).toEqual([1, 3]);
    expect(match("@P[1]>0", d)).toEqual([1, 3]);
  });

  it("@id==3 / @id != 3 attribute comparison", () => {
    const d = data(pts(5), { id: attr("Int", [0, 1, 2, 3, 4]) });
    expect(match("@id==3", d)).toEqual([3]);
    expect(match("@id != 3", d)).toEqual([0, 1, 2, 4]);
  });

  it("@group_arm reads the group_arm attribute (1 = in group)", () => {
    const d = data(pts(4), { group_arm: attr("Float", [1, 0, 1, 0]) });
    expect(match("@group_arm", d)).toEqual([0, 2]);
    // bare @name (no op/component) is shorthand for the same group_arm attribute
    expect(match("@arm", d)).toEqual([0, 2]);
  });

  it("i@age>10 typed int comparison", () => {
    const d = data(pts(4), { age: attr("Int", [5, 12, 8, 20]) });
    expect(match("i@age>10", d)).toEqual([1, 3]);
  });

  it("p@orient bare typed attribute = existence rule", () => {
    const d = data(pts(4), {
      orient: attr("Quaternion", [[1, 0, 0, 0], [0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0]]),
    });
    expect(match("p@orient", d)).toEqual([0, 1, 2, 3]);
  });

  it("4@transform / 3@transform same base name resolve to the first match", () => {
    const attrs: GroupData["attributes"] = {
      "4@transform": attr("Matrix4", [Array(16).fill(1), Array(16).fill(2)]),
      "3@transform": attr("Matrix3", [Array(9).fill(3), Array(9).fill(4)]),
    };
    const d = data(pts(2), attrs);
    expect(resolveAttribute(attrs, "transform")?.key).toBe("4@transform");
    expect(resolveAttribute(attrs, "transform", "4")?.key).toBe("4@transform");
    // prefixHint "3" matches the Matrix3 entry
    expect(resolveAttribute(attrs, "transform", "3")?.key).toBe("3@transform");
    // no type match -> falls back to the first same-name entry
    expect(resolveAttribute(attrs, "transform", "i")?.key).toBe("4@transform");
    expect(resolveAttribute(attrs, "nope")).toBeNull();
    expect(match("4@transform", d)).toEqual([0, 1]);
    expect(match("3@transform", d)).toEqual([0, 1]);
  });

  it("@Cd[1]>0 compares a vector component by index", () => {
    const d = data(pts(3), {
      Cd: attr("Vector3", [[1, 0, 0], [0, 2, 0], [0.5, -1, 0]]),
    });
    expect(match("@Cd[1]>0", d)).toEqual([1]);
  });

  it("quoted string values compare as strings", () => {
    const d = data(pts(3), { name: stringAttr(["foo", "bar", "foo"]) });
    expect(match('@name=="foo"', d)).toEqual([0, 2]);
    expect(match('@name!="foo"', d)).toEqual([1]);
    // quoted numeric string stringifies the numeric lhs ("1" matches id 1)
    const num = data(pts(3), { id: attr("Int", [0, 1, 2]) });
    expect(match('@id=="1"', num)).toEqual([1]);
  });

  it('quoted values preserve spaces and support \\" escapes', () => {
    const d = data(pts(3), { name: stringAttr(["a b", 'a"b', "foo"]) });
    expect(match('@name=="a b"', d)).toEqual([0]);
    expect(match('@name=="a\\"b"', d)).toEqual([1]);
  });

  it("@attr=5-10 range and @attr=\"5 8 10\" quoted list values", () => {
    const d = data(pts(11), { id: attr("Int", pts(11).map((_, i) => i)) });
    expect(match("@id=5-10", d)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(match('@id="5 8 10"', d)).toEqual([5, 8, 10]);
  });
});

describe("class-aware matching", () => {
  const primData = (): GroupData => ({
    points: pts(5),
    attributes: { id: attr("Int", [0, 1, 2, 3, 4]) },
    curves: [
      { pointIndices: [0, 1], widths: null },
      { pointIndices: [2, 3], widths: null },
    ],
    faces: [[4]],
  });

  it("prim class maps prim indices to their points", () => {
    const d = primData();
    expect(match("0-1", d, "prim")).toEqual([0, 1, 2, 3]);
    expect(match("2", d, "prim")).toEqual([4]);
    expect(match("0-2", d, "prim")).toEqual([0, 1, 2, 3, 4]);
  });

  it("prim class dedupes shared points within a prim", () => {
    const d: GroupData = {
      points: pts(3),
      attributes: {},
      curves: [{ pointIndices: [0, 0, 1], widths: null }],
      faces: [[1, 2]],
    };
    expect(match("0", d, "prim")).toEqual([0, 1]);
  });

  it("prim @P.y uses the prim's first point; attr rules match nothing (no prim attrs)", () => {
    const d = primData();
    // prim0/1/2 first points all have y=0 -> none
    expect(match("@P.y>0", d, "prim")).toEqual([]);
    const withY = { ...d, points: [[0, 0, 0], [1, 1, 0], [2, 2, 0], [3, 3, 0], [4, 4, 0]] };
    // prim1 first point (2,2,0) y=2, prim2 first point (4,4,0) y=4
    expect(match("@P.y>0", withY, "prim")).toEqual([2, 3, 4]);
    // v1 carries point attrs only -> @id==3 never hits for prims
    expect(match("@id==3", d, "prim")).toEqual([]);
  });

  it("vertices class maps vertex indices (curves then faces) to points", () => {
    const d: GroupData = {
      points: pts(5),
      attributes: {},
      curves: [
        { pointIndices: [3, 1], widths: null },
        { pointIndices: [0, 2], widths: null },
      ],
      faces: [[4]],
    };
    // vertices: 0->3, 1->1, 2->0, 3->2, 4->4
    expect(match("0-2", d, "vertices")).toEqual([0, 1, 3]);
    expect(match("1 3 4", d, "vertices")).toEqual([1, 2, 4]);
  });

  it("detail class: single element; a hit selects all points", () => {
    const d = data([[0, 1, 0], [1, 0, 0], [2, 0, 0]]);
    expect(match("0", d, "detail")).toEqual([0, 1, 2]);
    expect(match("1", d, "detail")).toEqual([]);
    expect(match("@P.y>0", d, "detail")).toEqual([0, 1, 2]); // reads point 0
    expect(match("*", d, "detail")).toEqual([0, 1, 2]);
  });
});

describe("pointInGroup", () => {
  it("checks membership of a point index", () => {
    const d = data(pts(4));
    expect(pointInGroup(parseGroupExpression("1-2"), d, 1)).toBe(true);
    expect(pointInGroup(parseGroupExpression("1-2"), d, 3)).toBe(false);
    expect(pointInGroup(parseGroupExpression("*"), d, 3)).toBe(true);
    expect(pointInGroup(parseGroupExpression("^1-2"), d, 1)).toBe(false);
  });
});
