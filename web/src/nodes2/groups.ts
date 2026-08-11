/**
 * Houdini-style group expression parser + point matcher.
 * Used by the transform node (v1) and future group-aware nodes.
 *
 * Syntax (Houdini group field): empty = all, "*" = all, "^"/"!" prefix = exclude,
 * "1-5" / "3" / "1-10:2" = id ranges, "@name" = group/attribute, "i@name" etc =
 * typed attribute access (i=int, s=string, v=vector, p=quaternion/vector4,
 * 3@=matrix3, 4@=matrix4, @ default = float), "@P.x" / "@Cd[2]" = vector component,
 * "@attr op value" (op: = == != > < >= <=) = attribute comparison, quoted strings
 * for string values. Duplicate attribute names (e.g. 4@transform + 3@transform)
 * resolve to the FIRST match. No npm lib exists for this (network-restricted,
 * zero new deps) so the parser is hand-rolled and compact.
 *
 * Syntax source: Houdini group field
 * (https://www.sidefx.com/docs/houdini/model/groups.html) + VEX attribute type
 * prefixes (i/s/v/p/3/4).
 *
 * Deliberate v1 simplifications vs stock Houdini:
 * - "!" behaves like "^" (removal from the accumulated selection, which starts
 *   EMPTY), NOT like "all except" (stock Houdini "!1-10" = everything except 1-10).
 * - attribute multi-values must be quoted ("5 8 10"); comma-separated values
 *   (e.g. @id=1,2,3) are not supported (commas separate tokens).
 * - no named-group/glob ("arm*") or "&" intersection support.
 */
import type { AttributeData, CurveData } from "../protocol/types";

export type GroupClass = "autoguess" | "points" | "vertices" | "prim" | "detail";

/** Typed-attribute prefixes: "" = float (default), i/s/v/p/3/4. */
export type AttrPrefix = "" | "i" | "s" | "v" | "p" | "3" | "4";

/** Minimal geometry data needed for group matching (InputPayload is a superset). */
export interface GroupData {
  points: number[][];
  attributes: Record<string, AttributeData>;
  curves: CurveData[];
  /** optional: missing = no faces (matching treats it as an empty list) */
  faces?: number[][];
}

export interface GroupFilter {
  /** resolved class: autoguess -> "points" in v1 */
  cls: GroupClass;
  /** empty expr / "*" -> match everything */
  all: boolean;
  /** ordered rules; remove=true subtracts (^ / !) from the accumulated selection */
  rules: GroupRule[];
}

export type GroupRule =
  | { kind: "group"; name: string; remove: boolean } // @group_x (or any @name with no op/component)
  | { kind: "attr"; name: string; prefix: AttrPrefix; comp: string | null; op: string; value: string; remove: boolean }
  | { kind: "ids"; spec: string; remove: boolean }; // "1-5", "3", "1-10:2", "*"

/** Houdini attribute dataType name(s) accepted per typed prefix (VEX prefixes). */
const PREFIX_TYPES: Record<AttrPrefix, string[]> = {
  "": ["Float"],
  i: ["Int"],
  s: ["String"],
  v: ["Vector3"],
  p: ["Vector4", "Quaternion"],
  "3": ["Matrix3"],
  "4": ["Matrix4"],
};

const NUM_OPS: Record<string, (a: number, b: number) => boolean> = {
  "=": (a, b) => a === b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
};

/** Component aliases: .x/.u/.r -> 0, .y/.v/.g -> 1, .z/.w/.b -> 2 (Houdini convenience). */
const COMP_ALIAS: Record<string, number> = { x: 0, u: 0, r: 0, y: 1, v: 1, g: 1, z: 2, w: 2, b: 2 };

/* ------------------------------------------------------------------ tokenizer */

/**
 * Split on whitespace + commas, keeping quoted strings intact (\" escapes inside).
 * A comma directly after ":keep"/":<number>" stays glued (n-m:keep,step range).
 */
function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inQuote) {
      if (ch === "\\" && expr[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuote = true;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === ",") {
      if (ch === "," && /:[^,]+$/.test(cur)) {
        cur += ","; // n-m:keep,step
        continue;
      }
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

/** attr token with no operator yet, e.g. "@P.y", "i@age", "4@transform" */
const ATTR_NO_OP_RE = /^[isvp34]?@[A-Za-z_][A-Za-z0-9_]*(?:\.[xyzuvwrb]|\[\d+\])?$/;
const OP_RE = /^(==|!=|>=|<=|=|>|<)/;
const EXACT_OP_RE = /^(==|!=|>=|<=|=|>|<)$/;

/** Glue "attr op value" written with spaces ("@id != 3") back into one token. */
function mergeAttrTokens(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let tok = tokens[i];
    const next = tokens[i + 1];
    if (next !== undefined && ATTR_NO_OP_RE.test(tok) && OP_RE.test(next)) {
      tok += next;
      i++;
      if (EXACT_OP_RE.test(next) && tokens[i + 1] !== undefined) {
        tok += tokens[i + 1];
        i++;
      }
    }
    out.push(tok);
  }
  return out;
}

/* ------------------------------------------------------------------- parsing */

function isNumeric(s: string): boolean {
  return s.trim() !== "" && Number.isFinite(Number(s));
}

/** Parse a single token (no ^/! prefix) into a rule. */
function parseToken(tok: string, remove: boolean): GroupRule {
  const m = /^([isvp34]?)@([A-Za-z_][A-Za-z0-9_]*)(.*)$/.exec(tok);
  if (!m) return { kind: "ids", spec: tok, remove };
  const prefix = (m[1] || "") as AttrPrefix;
  const name = m[2];
  let rest = m[3];
  let comp: string | null = null;
  if (rest.startsWith(".")) {
    comp = rest[1] || null;
    rest = rest.slice(2);
  } else if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close > 0) {
      comp = rest.slice(1, close);
      rest = rest.slice(close + 1);
    }
  }
  let op = "";
  const om = OP_RE.exec(rest);
  if (om) {
    op = om[1];
    rest = rest.slice(op.length);
  }
  // bare "@name" (default float prefix, no op/component) = group rule reading group_<name>
  if (!op && !comp && prefix === "") {
    const groupName = name.startsWith("group_") ? name : `group_${name}`;
    return { kind: "group", name: groupName, remove };
  }
  return { kind: "attr", name, prefix, comp, op, value: rest, remove };
}

/**
 * Parse a group expression + class hint into a GroupFilter.
 * - empty / whitespace / "*" -> { all: true }
 * - tokens split on spaces/commas (respecting quoted strings); "^"/"!" prefix = remove
 * - "@name" -> group rule; "prefix@name" -> typed; "@name.op" / "@name[2]" -> component
 * - "@name op value" -> attr comparison
 * - "n" / "n-m" / "n-m:step" / "n-m:keep,step" -> ids rule
 */
export function parseGroupExpression(expr: string, cls?: GroupClass): GroupFilter {
  const resolved: GroupClass = cls && cls !== "autoguess" ? cls : "points";
  const trimmed = (expr ?? "").trim();
  if (trimmed === "" || trimmed === "*") {
    return { cls: resolved, all: true, rules: [] };
  }
  const rules: GroupRule[] = [];
  for (const raw of mergeAttrTokens(tokenize(trimmed))) {
    if (!raw) continue;
    let tok = raw;
    let remove = false;
    if (tok[0] === "^" || tok[0] === "!") {
      remove = true;
      tok = tok.slice(1);
    }
    if (!tok) continue;
    rules.push(parseToken(tok, remove));
  }
  return { cls: resolved, all: false, rules };
}

/* ------------------------------------------------------------- attribute refs */

/** Strip a type prefix from an attribute key: "4@transform" -> "transform", "@P" -> "P". */
function stripAttrKey(key: string): string {
  return key.replace(/^[isvp34]?@/, "");
}

/**
 * Resolve an attribute by name: returns the FIRST key whose base name matches
 * (e.g. both "transform" matrix4 and matrix3 exist -> first in insertion order).
 * prefixHint is a hint for type matching; null when nothing found.
 */
export function resolveAttribute(
  attrs: Record<string, AttributeData>,
  name: string,
  prefixHint?: AttrPrefix,
): { attr: AttributeData; key: string } | null {
  let first: { attr: AttributeData; key: string } | null = null;
  const want = prefixHint ? PREFIX_TYPES[prefixHint] : null;
  for (const key of Object.keys(attrs)) {
    if (stripAttrKey(key) !== name) continue;
    if (!first) first = { attr: attrs[key], key };
    if (want && want.includes(attrs[key].type)) return { attr: attrs[key], key };
  }
  return first; // no type match -> fall back to the first same-name entry
}

/* ----------------------------------------------------------- id rule matching */

function idSpecMatches(spec: string, e: number): boolean {
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

function uniq(nums: number[]): number[] {
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
function primPointSets(data: GroupData): number[][] {
  const sets: number[][] = [];
  for (const c of data.curves) sets.push(uniq(c.pointIndices));
  for (const f of data.faces ?? []) sets.push(uniq(f));
  return sets;
}

/** vertex index (curves then faces order) -> owning point number. */
function vertexMap(data: GroupData): number[] {
  const map: number[] = [];
  for (const c of data.curves) map.push(...c.pointIndices);
  for (const f of data.faces ?? []) map.push(...f);
  return map;
}

function range(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

/** The point whose attributes a rule reads for element e (null = none/out of range). */
function rulePoint(
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
function elementPoints(
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

function compIndex(comp: string): number {
  const n = Number(comp);
  if (Number.isInteger(n)) return n;
  return COMP_ALIAS[comp] ?? -1;
}

function toNum(x: number | number[] | string): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (Array.isArray(x)) return x.length > 0 ? toNum(x[0]) : null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/** Loose scalar equality: numbers compare numerically, mixed number/string stringify. */
function eqScalar(a: number | number[] | string, b: number | string): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  return String(a) === String(b);
}

function arraysEqual(a: number[], b: (number | string)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!eqScalar(a[i], b[i])) return false;
  }
  return true;
}

function parseValueList(v: string): (number | string)[] {
  return v
    .split(/\s+/)
    .map((t) => t.trim().replace(/,$/, ""))
    .filter((t) => t !== "")
    .map((t) => (isNumeric(t) ? Number(t) : t));
}

function firstNum(items: (number | string)[]): number {
  for (const it of items) {
    const n = toNum(it);
    if (n !== null) return n;
  }
  return 0;
}

/** Compare a point-level value against a rule value ("5-10" range, "5 8 10" list, number, string). */
function compareLhs(lhs: number | number[] | string, op: string, value: string, comp: string | null): boolean {
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

function ruleMatchesElement(
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
function computeSelection(filter: GroupFilter, data: GroupData): Set<number> {
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
