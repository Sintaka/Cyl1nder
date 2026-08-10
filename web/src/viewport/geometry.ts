import * as THREE from "three";
import type { CurveData, InputPayload, OutputBuffer } from "../protocol/types";

export const INPUT_COLORS = [0x4fc3f7, 0xffb74d, 0x81c784, 0xba68c8];
export const OUTPUT_COLOR = 0xff5252;

function toVec(p: number[]): THREE.Vector3 {
  return new THREE.Vector3(p[0], p[1], p[2]);
}

/** Mesh faces -> group of { faceMesh, wireMesh } so the renderer can switch display modes
 *  (lit / unlit / wireframe / wireframe+face). Fan-triangulated; shared BufferGeometry. */
export function buildMeshFaces(points: number[][], faces: number[][], color: number): THREE.Group | null {
  if (faces.length === 0) return null;
  const tri: number[] = [];
  for (const face of faces) {
    if (face.length < 3) continue;
    for (let i = 1; i < face.length - 1; i++) tri.push(face[0], face[i], face[i + 1]);
  }
  if (tri.length === 0) return null;
  const positions = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    positions[i * 3] = p[0] ?? 0;
    positions[i * 3 + 1] = p[1] ?? 0;
    positions[i * 3 + 2] = p[2] ?? 0;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(tri);
  geo.computeVertexNormals(); // MeshLambertMaterial requires normals; without them faces don't shade
  const face = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x9aa0a6, side: THREE.DoubleSide }));
  const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, wireframe: true }));
  wire.visible = false;
  const group = new THREE.Group();
  group.add(face);
  group.add(wire);
  group.userData = { color, face, wire };
  return group;
}

/** Isolated points (not referenced by any curve/face) rendered as small dots. */
function buildPoints(points: number[][], used: Set<number>, color: number): THREE.Points | null {
  const pts: number[] = [];
  points.forEach((p, i) => {
    if (used.has(i)) return;
    pts.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
  });
  if (pts.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.06, sizeAttenuation: true }));
}

/** One polyline per curve + wireframe/faces for mesh + dots for isolated points. */
export function buildCurves(
  points: number[][],
  curves: CurveData[],
  faces: number[][],
  color: number,
  inputIndex: number | null,
): THREE.Group {
  const group = new THREE.Group();
  const used = new Set<number>();
  for (const curve of curves) {
    const idxs = curve.pointIndices.filter((i) => i >= 0 && i < points.length);
    idxs.forEach((i) => used.add(i));
    const pts = idxs.map((i) => points[i]).filter((p): p is number[] => Boolean(p));
    if (pts.length < 2) continue;
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map(toVec));
    const mat = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geo, mat);
    line.userData = { curve, inputIndex };
    group.add(line);
  }
  for (const face of faces) face.forEach((i) => used.add(i));
  const mesh = buildMeshFaces(points, faces, color);
  if (mesh) group.add(mesh);
  const pts = buildPoints(points, used, color);
  if (pts) group.add(pts);
  return group;
}

export function buildInputs(inputs: InputPayload[]): THREE.Group {
  const group = new THREE.Group();
  for (const inp of inputs) {
    const sub = buildCurves(inp.points, inp.curves, inp.faces ?? [], INPUT_COLORS[inp.index % INPUT_COLORS.length], inp.index);
    sub.name = `input${inp.index}`;
    group.add(sub);
  }
  return group;
}

export function buildOutputs(outputs: OutputBuffer[]): THREE.Group {
  const group = new THREE.Group();
  for (const buf of outputs) {
    const sub = buildCurves(buf.points, buf.curves, buf.faces ?? [], OUTPUT_COLOR, null);
    sub.name = `output${buf.index}`;
    group.add(sub);
  }
  return group;
}