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
/** Topology equality for position-only updates: same point count, same curve
 *  point-index structure, same face structure. Point VALUES are ignored - a
 *  transform (translate) only changes coordinates, never the topology, so a
 *  same-topology buffer can update an existing group IN PLACE (no rebuild).
 *  The full index arrays are compared (not just lengths) so the deduped wire
 *  edge set is guaranteed identical too. */
export function sameTopology(a: OutputBuffer, b: OutputBuffer): boolean {
  if (a.pointCount !== b.pointCount) return false;
  const aCurves = a.curves ?? [];
  const bCurves = b.curves ?? [];
  if (aCurves.length !== bCurves.length) return false;
  for (let i = 0; i < aCurves.length; i++) {
    const ai = aCurves[i].pointIndices;
    const bi = bCurves[i].pointIndices;
    if (ai.length !== bi.length) return false;
    for (let j = 0; j < ai.length; j++) if (ai[j] !== bi[j]) return false;
  }
  const aFaces = a.faces ?? [];
  const bFaces = b.faces ?? [];
  if (aFaces.length !== bFaces.length) return false;
  for (let i = 0; i < aFaces.length; i++) {
    const af = aFaces[i];
    const bf = bFaces[i];
    if (af.length !== bf.length) return false;
    for (let j = 0; j < af.length; j++) if (af[j] !== bf[j]) return false;
  }
  return true;
}

/** In-place position update for a group produced by buildCurves() (a node-result
 *  group, an outputN sub-group, ...): rewrites the position attribute of every
 *  curve Line, the face Mesh (index unchanged, then recomputes normals), its
 *  wire LineSegments (same topology => same deduped edge set), and the
 *  isolated-point Points. Every length is validated; ANY mismatch returns false
 *  so the caller falls back to a full rebuild. */
export function updateGroupPositions(group: THREE.Group, buffer: OutputBuffer): boolean {
  const points = buffer.points ?? [];
  const curves = buffer.curves ?? [];
  const faces = buffer.faces ?? [];
  const used = new Set<number>();
  for (const curve of curves) {
    for (const i of curve.pointIndices) if (i >= 0 && i < points.length) used.add(i);
  }
  for (const face of faces) {
    for (const i of face) if (i >= 0 && i < points.length) used.add(i);
  }
  // Same topology => the same deduped edge set buildWireSegments was built with.
  const edges: Array<[number, number]> = [];
  {
    const seen = new Set<string>();
    for (const face of faces) {
      const n = face.length;
      for (let i = 0; i < n; i++) {
        const a = face[i];
        const b = face[(i + 1) % n];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([a, b]);
      }
    }
  }
  const isolated = points.filter((_, i) => !used.has(i));

  let ok = true;
  group.traverse((obj) => {
    if (!ok) return;
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      const attr = mesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!attr || attr.count !== points.length) {
        ok = false;
        return;
      }
      const arr = attr.array as Float32Array;
      points.forEach((p, i) => {
        arr[i * 3] = p[0] ?? 0;
        arr[i * 3 + 1] = p[1] ?? 0;
        arr[i * 3 + 2] = p[2] ?? 0;
      });
      attr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      return;
    }
    const segs = obj as THREE.LineSegments;
    if (segs.isLineSegments) {
      const attr = segs.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!attr || attr.count !== edges.length * 2) {
        ok = false;
        return;
      }
      const arr = attr.array as Float32Array;
      edges.forEach(([a, b], i) => {
        const pa = points[a];
        const pb = points[b];
        if (!pa || !pb) {
          ok = false;
          return;
        }
        arr[i * 6] = pa[0] ?? 0;
        arr[i * 6 + 1] = pa[1] ?? 0;
        arr[i * 6 + 2] = pa[2] ?? 0;
        arr[i * 6 + 3] = pb[0] ?? 0;
        arr[i * 6 + 4] = pb[1] ?? 0;
        arr[i * 6 + 5] = pb[2] ?? 0;
      });
      attr.needsUpdate = true;
      return;
    }
    const line = obj as THREE.Line;
    if (line.isLine) {
      const curve = line.userData?.curve as CurveData | undefined;
      const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!attr || !curve) {
        ok = false;
        return;
      }
      const idxs = curve.pointIndices.filter((i) => i >= 0 && i < points.length);
      if (attr.count !== idxs.length) {
        ok = false;
        return;
      }
      const arr = attr.array as Float32Array;
      idxs.forEach((i, k) => {
        const p = points[i];
        if (!p) {
          ok = false;
          return;
        }
        arr[k * 3] = p[0] ?? 0;
        arr[k * 3 + 1] = p[1] ?? 0;
        arr[k * 3 + 2] = p[2] ?? 0;
      });
      attr.needsUpdate = true;
      return;
    }
    const pts = obj as THREE.Points;
    if (pts.isPoints) {
      const attr = pts.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!attr || attr.count !== isolated.length) {
        ok = false;
        return;
      }
      const arr = attr.array as Float32Array;
      isolated.forEach((p, k) => {
        arr[k * 3] = p[0] ?? 0;
        arr[k * 3 + 1] = p[1] ?? 0;
        arr[k * 3 + 2] = p[2] ?? 0;
      });
      attr.needsUpdate = true;
    }
  });
  return ok;
}