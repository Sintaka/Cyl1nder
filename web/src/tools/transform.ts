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