/**
 * Viewport scene construction (2.3 split): THREE.Scene + data groups + lights +
 * debug boxes. Pure THREE construction, no DOM / store.
 */
import * as THREE from "three";

export interface ViewportScene {
  scene: THREE.Scene;
  inputGroup: THREE.Group;
  outputGroup: THREE.Group;
  nodeResultGroup: THREE.Group;
  referenceGroup: THREE.Group;
  debugBoxes: THREE.Group;
  headLight: THREE.DirectionalLight;
  ambient: THREE.AmbientLight;
}

export function buildViewportScene(): ViewportScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);
  scene.add(new THREE.GridHelper(10, 20, 0x3a3a3a, 0x262626));
  // debug boxes at +X and +Y offsets - prove the viewport renders geometry on its own
  const debugBoxes = new THREE.Group();
  debugBoxes.add(makeBox(new THREE.Vector3(4, 0, 0), 0xff5252));
  debugBoxes.add(makeBox(new THREE.Vector3(0, 4, 0), 0x4fc3f7));
  debugBoxes.visible = false;
  scene.add(debugBoxes);
  const headLight = new THREE.DirectionalLight(0xffffff, 1.1);
  headLight.position.set(4, 6, 8);
  scene.add(headLight);
  const ambient = new THREE.AmbientLight(0x404050, 0.8);
  scene.add(ambient);
  const inputGroup = new THREE.Group();
  const outputGroup = new THREE.Group();
  const nodeResultGroup = new THREE.Group();
  const referenceGroup = new THREE.Group();
  return { scene, inputGroup, outputGroup, nodeResultGroup, referenceGroup, debugBoxes, headLight, ambient };
}

export function makeBox(center: THREE.Vector3, color: number): THREE.LineSegments {
  const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.6, 0.6, 0.6));
  const box = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  box.position.copy(center);
  return box;
}
