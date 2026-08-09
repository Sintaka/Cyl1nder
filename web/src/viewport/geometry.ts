import * as THREE from "three";
import type { CurveData, InputPayload, OutputBuffer } from "../protocol/types";

export const INPUT_COLORS = [0x4fc3f7, 0xffb74d, 0x81c784, 0xba68c8];
export const OUTPUT_COLOR = 0xff5252;

function toVec(p: number[]): THREE.Vector3 {
  return new THREE.Vector3(p[0], p[1], p[2]);
}

/** One polyline per curve; store curve + input index in userData for raycast selection. */
export function buildCurves(
  points: number[][],
  curves: CurveData[],
  color: number,
  inputIndex: number | null,
): THREE.Group {
  const group = new THREE.Group();
  for (const curve of curves) {
    const pts = curve.pointIndices
      .map((i) => points[i])
      .filter((p): p is number[] => Boolean(p));
    if (pts.length < 2) continue;
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map(toVec));
    const mat = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geo, mat);
    line.userData = { curve, inputIndex };
    group.add(line);
  }
  return group;
}

export function buildInputs(inputs: InputPayload[]): THREE.Group {
  const group = new THREE.Group();
  for (const inp of inputs) {
    const sub = buildCurves(inp.points, inp.curves, INPUT_COLORS[inp.index % INPUT_COLORS.length], inp.index);
    sub.name = `input${inp.index}`;
    group.add(sub);
  }
  return group;
}

export function buildOutputs(outputs: OutputBuffer[]): THREE.Group {
  const group = new THREE.Group();
  for (const buf of outputs) {
    const sub = buildCurves(buf.points, buf.curves, OUTPUT_COLOR, null);
    sub.name = `output${buf.index}`;
    group.add(sub);
  }
  return group;
}