/**
 * Shared mutable state between the viewport picking and gizmo controllers
 * (2.3 split): Enter-edit activation + the currently-selected curve line.
 * Owned by the Viewport shell; passed by reference to both controllers.
 */
import type * as THREE from "three";

export interface ViewportState {
  enterActive: boolean;
  selectedLine: THREE.Line | null;
}