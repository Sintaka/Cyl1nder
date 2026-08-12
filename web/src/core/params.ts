export interface ParamLike {
  name: string;
  type: string;
  value: unknown;
}

/** Read float/int params into a {name: value} record (missing / invalid -> 0). */
export function readParamFloats(params: ParamLike[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) {
    if (p.type !== "float" && p.type !== "int") continue;
    const n = typeof p.value === "number" ? p.value : Number(p.value);
    out[p.name] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

/** Deep-copy a params array (values are plain JSON data) - snapshots for drag undo. */
export function cloneParams(params: ParamLike[]): ParamLike[] {
  return JSON.parse(JSON.stringify(params));
}

/** Params content equality (same order; name/type/value only) - skips no-op drag undo. */
export function paramsEqual(a: ParamLike[], b: ParamLike[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i];
    return p.name === q.name && p.type === q.type && p.value === q.value;
  });
}
