/**
 * Houdini-style group expression point matcher (matching side).
 * Stage 1.2 split: groups.ts is now a barrel re-exporting this module
 * (groups/matcher.ts) together with groups/parser.ts. Public API unchanged.
 */
import { isNumeric, resolveAttribute, type GroupClass, type GroupData, type GroupFilter, type GroupRule } from "./parser";

export const NUM_OPS: Record<string, (a: number, b: number) => boolean> = {
  "=": (a, b) => a === b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
};

/** Component aliases: .x/.u/.r -> 0, .y/.v/.g -> 1, .z/.w/.b -> 2 (Houdini convenience). */
export const COMP_ALIAS: Record<string, number> = { x: 0, u: 0, r: 0, y: 1, v: 1, g: 1, z: 2, w: 2, b: 2 };

/* ----------------------------------------------------------- id rule matching */

export function idSpecMatches(spec: string, e: number): boolean {
  if (spec === "*") return true;
  const m = /^(\d+)(?:-(\d+))?(?::([^,]+)(?:,(\d+))?)?$/.exec(spec);
  if (!m) return false;
  const n = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : n;
  if (m[3] === undefined) return e >= n && e <= hi;
  const step = Number(m[4] !== undefined ? m[4] : m[3]);
  if (e < n || e > hi) return false;
  if (m[4] === undefined) {
    // n-m:step -> n, n+step, n+2*step, ... (inclusive)
    const s = Number.isFinite(step) && step > 0 ? step : 1;
    return (e - n) % s === 0;
  }
  // n-m:keep,step -> keep the first K ids, then cycles of skip S / keep S.
  // Literal "keep" (docs shorthand for the <keep> placeholder) means K = 1.
  const kRaw = m[3];
  const k = kRaw === "keep" || !Number.isFinite(Number(kRaw)) ? 1 : Math.max(1, Number(kRaw));
  const s = Number.isFinite(step) && step > 0 ? step : 1;
  const off = e - n;
  if (off < k) return true;
  const rel = off - k;
  const within = rel % (s * 2);
  return within >= s; // skip the first s after the initial kept block, then keep s
}

/* ------------------------------------------------------------ class-aware map */

export function uniq(nums: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of nums) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** prim index -> its point numbers (curves' pointIndices then faces' elements, deduped). */
export function primPointSets(data: GroupData): number[][] {
  const sets: number[][] = [];
  for (const c of data.curves) sets.push(uniq(c.pointIndices));
  for (const f of data.faces ?? []) sets.push(uniq(f));
  return sets;
}

/** vertex index (curves then faces order) -> owning point number. */
export function vertexMap(data: GroupData): number[] {
  const map: number[] = [];
  for (const c of data.curves) map.push(...c.pointIndices);
  for (const f of data.faces ?? []) map.push(...f);
  return map;
}

export function range(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

/** The point whose attributes a rule reads for element e (null = none/out of range). */
export function rulePoint(
  cls: GroupClass,
  data: GroupData,
  e: number,
  primSets: number[][] | null,
  vmap: number[] | null,
): number | null {
  switch (cls) {
    case "points":
      return e >= 0 && e < data.points.length ? e : null;
    case "prim": {
      const set = primSets ? primSets[e] : undefined;
      return set && set.length > 0 ? set[0] : null; // P uses the prim's first point
    }
    case "vertices":
      return vmap && e >= 0 && e < vmap.length ? vmap[e] : null;
    case "detail":
      return data.points.length > 0 ? 0 : null; // v1 has no detail attrs -> read point 0
    default:
      return e >= 0 && e < data.points.length ? e : null;
  }
}

/** The points contributed by element e when it is selected. */
export function elementPoints(
  cls: GroupClass,
  data: GroupData,
  e: number,
  primSets: number[][] | null,
  vmap: number[] | null,
): number[] {
  switch (cls) {
    case "points":
      return e >= 0 && e < data.points.length ? [e] : [];
    case "prim": {
      const set = primSets ? primSets[e] : undefined;
      return set ?? [];
    }
    case "vertices":
      return vmap && e >= 0 && e < vmap.length ? [vmap[e]] : [];
    case "detail":
      return e === 0 ? range(data.points.length) : [];
    default:
      return e >= 0 && e < data.points.length ? [e] : [];
  }
}

/* ------------------------------------------------------------- value compare */

export function compIndex(comp: string): number {
  const n = Number(comp);
  if (Number.isInteger(n)) return n;
  return COMP_ALIAS[comp] ?? -1;
}

export function toNum(x: number | number[] | string): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (Array.isArray(x)) return x.length > 0 ? toNum(x[0]) : null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/** Loose scalar equality: numbers compare numerically, mixed number/string stringify. */
export function eqScalar(a: number | number[] | string, b: number | string): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  return String(a) === String(b);
}

export function arraysEqual(a: number[], b: (number | string)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!eqScalar(a[i], b[i])) return false;
  }
  return true;
}

export function parseValueList(v: string): (number | string)[] {
  return v
    .split(/\s+/)
    .map((t) => t.trim().replace(/,$/, ""))
    .filter((t) => t !== "")
    .map((t) => (isNumeric(t) ? Number(t) : t));
}

export function firstNum(items: (number | string)[]): number {
  for (const it of items) {
    const n = toNum(it);
    if (n !== null) return n;
  }
  return 0;
}

/** Compare a point-level value against a rule value ("5-10" range, "5 8 10" list, number, string). */
export function compareLhs(lhs: number | number[] | string, op: string, value: string, comp: string | null): boolean {
  const v = value.trim();
  const hasSpace = v.includes(" ");
  // A quoted value is a numeric list only when EVERY token is a number/range
  // ("5 8 10"); otherwise it is a single string value ("foo bar").
  const isNumList = hasSpace && v.split(/\s+/).every((t) => isNumeric(t) || /^\d+-\d+$/.test(t));
  let base: number | number[] | string = lhs;
  if (Array.isArray(base)) {
    if (comp !== null) {
      const c = compIndex(comp);
      base = c >= 0 && c < base.length ? base[c] : NaN;
    } else if (!isNumList) {
      // Houdini: multi-component attr without a component compares the FIRST component
      base = base.length > 0 ? base[0] : NaN;
    }
  }
  if (isNumList) {
    const items = parseValueList(v);
    if (Array.isArray(base)) {
      if (op === "=" || op === "==") return arraysEqual(base, items);
      if (op === "!=") return !arraysEqual(base, items);
      const x = toNum(base[0]);
      return x !== null && !!NUM_OPS[op] && NUM_OPS[op](x, firstNum(items));
    }
    if (op === "=" || op === "==") return items.some((it) => eqScalar(base, it));
    if (op === "!=") return !items.some((it) => eqScalar(base, it));
    const x = toNum(base);
    return x !== null && !!NUM_OPS[op] && NUM_OPS[op](x, firstNum(items));
  }
  const rangeM = /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/.exec(v);
  if (rangeM) {
    const lo = Number(rangeM[1]);
    const hi = Number(rangeM[2]);
    const x = toNum(base);
    if (x === null) return false;
    if (op === "=" || op === "==") return x >= lo && x <= hi;
    if (op === "!=") return x < lo || x > hi;
    return !!NUM_OPS[op] && NUM_OPS[op](x, lo);
  }
  if (isNumeric(v)) {
    const y = Number(v);
    const x = toNum(base);
    if (x === null) return false;
    return !!NUM_OPS[op] && NUM_OPS[op](x, y);
  }
  // quoted/unquoted string value (may contain spaces)
  if (op === "=" || op === "==") return eqScalar(base, v);
  if (op === "!=") return !eqScalar(base, v);
  return false;
}

/* ------------------------------------------------------------ rule evaluation */

export function ruleMatchesElement(
  rule: GroupRule,
  cls: GroupClass,
  data: GroupData,
  e: number,
  primSets: number[][] | null,
  vmap: number[] | null,
): boolean {
  if (rule.kind === "ids") return idSpecMatches(rule.spec, e);
  if (cls === "prim" && (rule.kind === "group" || (rule.kind === "attr" && rule.name !== "P"))) {
    // v1 serializer carries point attributes only -> prim attr/group rules never hit
    return false;
  }
  const p = rulePoint(cls, data, e, primSets, vmap);
  if (p === null || p >= data.points.length) return false;
  if (rule.kind === "group") {
    const res = resolveAttribute(data.attributes, rule.name);
    return res ? res.attr.values[p] === 1 : false; // group_xxx attr: 1 = in group
  }
  if (rule.op === "") {
    // bare typed attribute (e.g. "p@orient", "4@transform") -> existence rule
    if (rule.name === "P") return true;
    return resolveAttribute(data.attributes, rule.name, rule.prefix || undefined) !== null;
  }
  let lhs: number | number[] | string | null = null;
  if (rule.name === "P") {
    lhs = data.points[p]; // pseudo-attribute P
  } else {
    const res = resolveAttribute(data.attributes, rule.name, rule.prefix || undefined);
    if (!res) return false;
    const v = res.attr.values[p] as number | number[] | string | undefined;
    if (v === undefined || v === null) return false;
    lhs = v;
  }
  return compareLhs(lhs, rule.op, rule.value, rule.comp);
}

/** Accumulate the selected point set: start empty, add on remove=false, subtract on remove=true. */
export function computeSelection(filter: GroupFilter, data: GroupData): Set<number> {
  if (filter.all) return new Set(range(data.points.length));
  const cls: GroupClass = filter.cls === "autoguess" ? "points" : filter.cls;
  const primSets = cls === "prim" ? primPointSets(data) : null;
  const vmap = cls === "vertices" ? vertexMap(data) : null;
  const elements =
    cls === "points"
      ? range(data.points.length)
      : cls === "prim"
        ? range(primSets?.length ?? 0)
        : cls === "vertices"
          ? range(vmap?.length ?? 0)
          : cls === "detail"
            ? [0]
            : range(data.points.length);
  const sel = new Set<number>();
  for (const rule of filter.rules) {
    for (const e of elements) {
      if (!ruleMatchesElement(rule, cls, data, e, primSets, vmap)) continue;
      const pts = elementPoints(cls, data, e, primSets, vmap);
      if (rule.remove) {
        for (const p of pts) sel.delete(p);
      } else {
        for (const p of pts) sel.add(p);
      }
    }
  }
  return sel;
}

/**
 * Does pointIndex belong to the group selection? Class-aware:
 * - points/autoguess: index = point number; attr/group rules read POINT attributes + P
 * - prim: index = prim number; rules read prim attrs (v1 serializer only carries point
 *   attrs, so attr rules match nothing for prims) ; P component = prim's first point
 * - vertices: index = vertex number (curves then faces order); maps to its point
 * - detail: single element; if it matches, ALL points match
 * Pseudo-attribute "P" reads data.points[index] (x/y/z or [0]/[1]/[2]).
 */
export function pointInGroup(filter: GroupFilter, data: GroupData, pointIndex: number): boolean {
  return computeSelection(filter, data).has(pointIndex);
}

/** All matching point indices (sorted, deduped, ascending). */
export function matchingPoints(filter: GroupFilter, data: GroupData): number[] {
  return [...computeSelection(filter, data)].sort((a, b) => a - b);
}
