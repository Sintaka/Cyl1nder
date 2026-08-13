import type { CurveData, InputPayload, OutputBuffer } from "../protocol/types";

/** Pure edit-tool math (unit-testable without DOM). v1 tool: translate selected curve. */

export function translatePoint(p: number[], dx: number, dy: number, dz: number): number[] {
  return [p[0] + dx, p[1] + dy, p[2] + dz];
}

export function translatePoints(points: number[][], dx: number, dy: number, dz: number): number[][] {
  return points.map((p) => translatePoint(p, dx, dy, dz));
}

/** Translate only the points of one curve inside an input payload (shared points stay). */
export function applyTranslateToCurve(
  input: InputPayload,
  curveIndex: number,
  dx: number,
  dy: number,
  dz: number,
): number[][] {
  const curve: CurveData | undefined = input.curves[curveIndex];
  if (!curve) return input.points.map((p) => [...p]);
  const points = input.points.map((p) => [...p]);
  for (const i of curve.pointIndices) {
    if (i >= 0 && i < points.length) points[i] = translatePoint(points[i], dx, dy, dz);
  }
  return points;
}

/** Wrap edited points back into an OutputBuffer for a given output index. */
export function inputToOutput(index: number, input: InputPayload, points: number[][]): OutputBuffer {
  return {
    index,
    rev: 0,
    pointCount: points.length,
    primCount: input.primCount,
    points,
    curves: input.curves,
    faces: input.faces ?? [],
    attributes: input.attributes,
  };
}

/**
 * Translate only the points matching a Houdini-style group expression.
 * `base` provides attributes/curves/faces for matching; `points` is the
 * CURRENT point array (may already be transformed upstream in a chain). The filter
 * resolves its class from `cls` (autoguess -> points in v1). Returns a new array.
 */
import { parseGroupExpression, matchingPoints, type GroupClass, type GroupData } from "../nodes2/groups";

export function applyTranslateGrouped(
  base: InputPayload,
  points: number[][],
  groupExpr: string,
  cls: GroupClass,
  dx: number,
  dy: number,
  dz: number,
): number[][] {
  const filter = parseGroupExpression(groupExpr, cls);
  // P-based rules (e.g. @P.y>0) must evaluate against the CURRENT point array
  // (the input to THIS node in a chain), not the original base payload.
  const data: GroupData = { points, attributes: base.attributes, curves: base.curves, faces: base.faces ?? [] };
  const next = points.map((p) => [...p]);
  for (const i of matchingPoints(filter, data)) {
    if (i >= 0 && i < next.length) next[i] = translatePoint(next[i], dx, dy, dz);
  }
  return next;
}

/** In-place translate: add (dx,dy,dz) to EVERY point when `matched` is null
 *  (all-points group), otherwise only to the points whose index is in `matched`.
 *  Mutates the input array - zero allocation (clone-free translate fast path).
 *  P2: the chain cache applies per-frame translate deltas directly to its own
 *  mutable output points instead of re-cloning the whole array every frame. */
export function applyTranslateDeltaInPlace(
  points: number[][],
  matched: Set<number> | null,
  dx: number,
  dy: number,
  dz: number,
): void {
  if (matched === null) {
    for (const p of points) {
      p[0] += dx;
      p[1] += dy;
      p[2] += dz;
    }
    return;
  }
  for (const i of matched) {
    const p = points[i];
    if (!p) continue;
    p[0] += dx;
    p[1] += dy;
    p[2] += dz;
  }
}
