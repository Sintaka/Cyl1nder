import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Camera } from "three";

/**
 * Houdini-style navigation: Alt+LMB rotate, Alt+MMB pan, Alt+RMB zoom (drag),
 * wheel = zoom. OrbitControls is only enabled while Alt is held.
 * Mouse-button mapping is forced to Houdini conventions (LMB rotate / MMB pan /
 * RMB dolly) because three.js defaults are LMB rotate / MMB dolly / RMB pan.
 */
/** Move the camera along its view direction (real dolly, not fov change). dir>0 = closer. */
function dollyCamera(controls: OrbitControls, amount: number): void {
  const cam = controls.object as THREE.PerspectiveCamera;
  const target = controls.target;
  const dir = target.clone().sub(cam.position);
  const dist = dir.length();
  if (dist < 0.001) return;
  const next = Math.max(0.2, Math.min(200, dist + amount));
  dir.normalize().multiplyScalar(next - dist);
  cam.position.add(dir);
  controls.update();
}

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

    // Houdini drag-zoom on RMB (with or without Alt): right/up drag zooms IN,
    // left/down zooms OUT, incremental, normalized, ~4x base sensitivity
    // (2x the previous setting as requested). Fully takes over RMB from OrbitControls.
    dom.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 2) return;
        e.preventDefault();
        e.stopPropagation();
        let last = { x: e.clientX, y: e.clientY };
        const onMove = (ev: PointerEvent) => {
          const dx = ev.clientX - last.x;
          const dy = ev.clientY - last.y;
          last = { x: ev.clientX, y: ev.clientY };
          const delta = (dx - dy) / 60; // normalized: right(+x)-up(-y) = in
          if (Math.abs(delta) > 0.001) {
            dollyCamera(this.controls, delta * 0.5); // ~2x sensitivity real dolly
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

    // Wheel zoom ALWAYS works (Houdini: wheel zooms without Alt). Captured before
    // OrbitControls so it can't be skipped by enabled=false and never doubles up.
    dom.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = -e.deltaY;
        dollyCamera(this.controls, delta * 0.02); // real camera displacement
      },
      { capture: true, passive: false },
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
