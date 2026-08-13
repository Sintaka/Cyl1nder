/**
 * Camera helpers (2.3 split): 35mm-lens PerspectiveCamera creation + frame /
 * frame-default framing (Box3 fit). Depends on HoudiniControls for target/update.
 */
import * as THREE from "three";
import { store } from "../stores/workspace";
import type { HoudiniControls } from "./controls";

export const CAMERA_FOV_35MM = 38;

export function createCamera(aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_35MM, aspect, 0.01, 1000);
  camera.position.set(4, 3, 6);
  camera.lookAt(0, 0, 0);
  return camera;
}

export function frameVisible(
  camera: THREE.PerspectiveCamera,
  controls: HoudiniControls,
  groups: THREE.Group[],
): void {
  const box = new THREE.Box3();
  let has = false;
  for (const group of groups) {
    if (!group.visible) continue;
    const b = new THREE.Box3().setFromObject(group);
    if (!b.isEmpty()) {
      box.union(b);
      has = true;
    }
  }
  if (!has) {
    frameDefault(camera, controls);
    return;
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dir = camera.position.clone().sub(controls.controls.target);
  if (dir.length() < 1e-4) dir.set(0, 0, 1); // degenerate pose: fall back to +Z
  dir.normalize();
  controls.controls.target.copy(center);
  camera.position.copy(center).addScaledVector(dir, Math.max(size * 1.5, 1));
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  controls.controls.update();
  store.pushLog(`[viewport] framed geometry center=${center.toArray().map((n) => n.toFixed(2)).join(",")} size=${size.toFixed(2)}`);
}

export function frameDefault(camera: THREE.PerspectiveCamera, controls: HoudiniControls): void {
  controls.controls.target.set(0, 0, 0);
  camera.position.set(4, 3, 6);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  controls.controls.update();
  store.pushLog("[viewport] frame default view");
}
