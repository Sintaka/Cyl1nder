/**
 * Viewport display modes (2.3 split): mode type, labels, and the per-group
 * face/wire material switching (pure THREE traversal, no DOM / no store).
 */
import * as THREE from "three";

export type DisplayMode =
  | "smooth-shaded"
  | "smooth-wire"
  | "flat-shaded"
  | "flat-wire"
  | "unlit-shaded"
  | "unlit-wire"
  | "wireframe"
  | "wireframe-ghost";

export const MODE_LABELS: Record<DisplayMode, string> = {
  "smooth-shaded": "Smooth Shaded",
  "smooth-wire": "Smooth Wire Shaded",
  "flat-shaded": "Flat Shaded",
  "flat-wire": "Flat Wire Shaded",
  "unlit-shaded": "Unlit Shaded",
  "unlit-wire": "Unlit Wire Shaded",
  wireframe: "Wireframe",
  "wireframe-ghost": "Wireframe Ghost",
};

export function applyDisplayModeToGroup(group: THREE.Object3D, mode: DisplayMode): void {
  const wireVisible =
    mode === "smooth-wire" || mode === "flat-wire" || mode === "unlit-wire" || mode === "wireframe" || mode === "wireframe-ghost";
  // Wireframe + ghost use bone-white wire (#CCCBBA); every other wire mode stays black.
  const wireColor = mode === "wireframe" || mode === "wireframe-ghost" ? 0xcccbBA : 0x000000;
  const walk = (obj: THREE.Object3D): void => {
    const ud = obj.userData as { face?: THREE.Mesh; wire?: THREE.Mesh; color?: number };
    if (ud.face && ud.wire) {
      const color = ud.color ?? 0x4fc3f7;
      let faceMat: THREE.Material | THREE.Material[];
      if (mode === "smooth-shaded" || mode === "smooth-wire") {
        // smooth vertex normals (computeVertexNormals in geometry.ts) + grey Lambert + headlight
        faceMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6, side: THREE.DoubleSide });
      } else if (mode === "flat-shaded" || mode === "flat-wire") {
        faceMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6, side: THREE.DoubleSide, flatShading: true });
      } else if (mode === "unlit-shaded" || mode === "unlit-wire") {
        faceMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      } else if (mode === "wireframe-ghost") {
        faceMat = new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
        });
      } else {
        faceMat = ud.face.material; // wireframe: faces hidden, material irrelevant
      }
      ud.face.material = faceMat;
      ud.face.visible = mode !== "wireframe";
      ud.wire.material = new THREE.LineBasicMaterial({ color: wireColor });
      ud.wire.visible = wireVisible;
    }
    for (const c of obj.children) walk(c);
  };
  walk(group);
}