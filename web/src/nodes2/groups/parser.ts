/**
 * Houdini-style group expression parser (parsing side).
 * Stage 1.2 split: groups.ts is now a barrel re-exporting this module
 * (groups/parser.ts) together with groups/matcher.ts. Public API unchanged.
 */
import type { AttributeData, CurveData } from "../../protocol/types";

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
export const PREFIX_TYPES: Record<AttrPrefix, string[]> = {
  "": ["Float"],
  i: ["Int"],
  s: ["String"],
  v: ["Vector3"],
  p: ["Vector4", "Quaternion"],
  "3": ["Matrix3"],
  "4": ["Matrix4"],
};

/* ------------------------------------------------------------------ tokenizer */

/**
 * Split on whitespace + commas, keeping quoted strings intact (\" escapes inside).
 * A comma directly after ":keep"/":<number>" stays glued (n-m:keep,step range).
 */
export function tokenize(expr: string): string[] {
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
export const ATTR_NO_OP_RE = /^[isvp34]?@[A-Za-z_][A-Za-z0-9_]*(?:\.[xyzuvwrb]|\[\d+\])?$/;
export const OP_RE = /^(==|!=|>=|<=|=|>|<)/;
export const EXACT_OP_RE = /^(==|!=|>=|<=|=|>|<)$/;

/** Glue "attr op value" written with spaces ("@id != 3") back into one token. */
export function mergeAttrTokens(tokens: string[]): string[] {
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

export function isNumeric(s: string): boolean {
  return s.trim() !== "" && Number.isFinite(Number(s));
}

/** Parse a single token (no ^/! prefix) into a rule. */
export function parseToken(tok: string, remove: boolean): GroupRule {
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
export function stripAttrKey(key: string): string {
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
