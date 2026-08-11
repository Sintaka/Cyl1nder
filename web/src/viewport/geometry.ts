import * as THREE from "three";
import type { CurveData, InputPayload, OutputBuffer } from "../protocol/types";

export const INPUT_COLORS = [0x666666, 0x666666, 0x666666, 0x666666]; // default 0.4 grey (no per-port colors)
export const OUTPUT_COLOR = 0xff5252;

function toVec(p: number[]): THREE.Vector3 {
  return new THREE.Vector3(p[0], p[1], p[2]);
}

/** Wireframe edges built manually from faces (dedup), like Anime Hair Studio's approach
 *  (scalpBuilderCurveLatticeEdges): no internal triangle diagonals, no wireframe-Mesh quirks. */
function buildWireSegments(points: number[][], faces: number[][], color: number): THREE.LineSegments | null {
  const edges = new Set<string>();
  const pos: number[] = [];
  for (const face of faces) {
    const n = face.length;
    for (let i = 0; i < n; i++) {
      const a = face[i];
      const b = face[(i + 1) % n];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (edges.has(key)) continue;
      edges.add(key);
      const pa = points[a];
      const pb = points[b];
      if (!pa || !pb) continue;
      pos.push(pa[0] ?? 0, pa[1] ?? 0, pa[2] ?? 0, pb[0] ?? 0, pb[1] ?? 0, pb[2] ?? 0);
    }
  }
  if (pos.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }));
}

/** Mesh faces -> group of { faceMesh, wireMesh } so the renderer can switch display modes
 *  (smooth/flat shaded, unlit wire, wireframe, wireframe ghost). Fan-triangulated; shared
 *  BufferGeometry; computeVertexNormals supplies smooth normals (flat shading uses flatShading). */
export function buildMeshFaces(points: number[][], faces: number[][], color: number): THREE.Group | null {
  console.log("[mesh] buildMeshFaces points=", points.length, "faces=", faces.length);
  if (faces.length === 0) return null;
  const tri: number[] = [];
  for (const face of faces) {
    if (face.length < 3) continue;
    for (let i = 1; i < face.length - 1; i++) tri.push(face[0], face[i], face[i + 1]);
  }
  console.log("[mesh] triangles=", tri.length / 3, "sample face=", JSON.stringify(faces[0]));
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
  const face = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x666666, side: THREE.DoubleSide }));
  const wire = buildWireSegments(points, faces, 0x000000); // default black; renderer overrides per display mode
  if (wire) wire.visible = false;
  const group = new THREE.Group();
  group.add(face);
  if (wire) group.add(wire);
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


/** Displayed-node result highlight color (distinct from grey inputs / red outputs). */
export const NODE_RESULT_COLOR = 0x7ce3a8;

/** Render a single node's REAL output buffer (transformed geometry) as its own
 *  group named "cyl-node-result"; child objects get explicit non-input/output
 *  names so setDisplayFocus's inputN/outputN traversal never touches them. */
export function buildNodeResult(buffer: OutputBuffer): THREE.Group | null {
  const curves = buffer.curves ?? [];
  const faces = buffer.faces ?? [];
  if ((buffer.points?.length ?? 0) === 0 && curves.length === 0 && faces.length === 0) return null;
  const group = buildCurves(buffer.points ?? [], curves, faces, NODE_RESULT_COLOR, null);
  group.name = "cyl-node-result";
  group.children.forEach((ch, i) => {
    if (!ch.name) ch.name = `cyl-node-result-child-${i}`;
  });
  return group;
}