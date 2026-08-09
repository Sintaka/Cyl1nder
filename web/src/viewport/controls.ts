import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Camera } from "three";

/**
 * Houdini-style navigation: Alt+LMB rotate, Alt+MMB pan, Alt+RMB zoom (drag),
 * wheel = zoom. OrbitControls is only enabled while Alt is held.
 */
export class HoudiniControls {
  readonly controls: OrbitControls;

  constructor(camera: Camera, dom: HTMLElement) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.enabled = false;

    dom.addEventListener("pointerdown", (e) => {
      if (e.altKey) this.controls.enabled = true;
    });
    const release = () => {
      this.controls.enabled = false;
    };
    window.addEventListener("pointerup", release);
    dom.addEventListener("pointercancel", release);
  }

  update(): void {
    this.controls.update();
  }
}