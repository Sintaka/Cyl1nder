import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Camera } from "three";

/**
 * Houdini-style navigation: Alt+LMB rotate, Alt+MMB pan, Alt+RMB zoom (drag),
 * wheel = zoom. OrbitControls is only enabled while Alt is held.
 * Mouse-button mapping is forced to Houdini conventions (LMB rotate / MMB pan /
 * RMB dolly) because three.js defaults are LMB rotate / MMB dolly / RMB pan.
 */
export class HoudiniControls {
  readonly controls: OrbitControls;

  constructor(camera: Camera, dom: HTMLElement) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    // Houdini convention: MMB = pan, RMB = zoom. three default is the opposite.
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.DOLLY,
    };
    this.controls.enabled = false;

    // Capture phase: must enable BEFORE OrbitControls' bubble-phase pointerdown,
    // otherwise OrbitControls skips the down event while disabled and loses the
    // drag start (Alt navigation silently does nothing).
    dom.addEventListener(
      "pointerdown",
      (e) => {
        if (e.altKey) this.controls.enabled = true;
      },
      true,
    );

    // Houdini drag-zoom on plain RMB (no Alt): right/up drag zooms IN, left/down
    // zooms OUT, incremental, ~2x sensitivity, fully takes over RMB.
    dom.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 2 || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        let last = { x: e.clientX, y: e.clientY };
        const onMove = (ev: PointerEvent) => {
          const dx = ev.clientX - last.x;
          const dy = ev.clientY - last.y;
          last = { x: ev.clientX, y: ev.clientY };
          const delta = (dx - dy) / 60; // normalized: right(+x)-up(-y) = in
          if (Math.abs(delta) > 0.001) {
            const cam = this.controls.object as THREE.PerspectiveCamera;
            const factor = 1 + Math.abs(delta) * 2; // ~2x sensitivity
            cam.zoom = Math.max(0.05, Math.min(40, cam.zoom * (delta > 0 ? factor : 1 / factor)));
            cam.updateProjectionMatrix();
            this.controls.update();
          }
        };
        const up = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      },
      true,
    );
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
