/**
 * Enter-edit + gizmo-demo controller (2.3 split): owns the TransformControls
 * attach/detach state machine for the Enter gizmo (cyl-enter-gizmo temp object,
 * pivot marker) and the G-key demo box. Receives shared state + scene / transform
 * / enterBtn via deps.
 */
import * as THREE from "three";
import type { TransformControls } from "three/addons/controls/TransformControls.js";
import { store } from "../stores/workspace";
import type { ViewportState } from "./state";

export interface GizmoDeps {
  state: ViewportState;
  scene: THREE.Scene;
  transform: TransformControls;
  enterBtn: HTMLButtonElement;
}

export interface GizmoController {
  setEnterEditHandler(fn: (() => void) | null): void;
  isEnterActive(): boolean;
  enterButtonClick(): void;
  notifyDragEnd(): void;
  toggleGizmoDemo(): void;
  cycleGizmoMode(): void;
  beginTransformGizmo(
    nodeId: string,
    tx: number,
    ty: number,
    tz: number,
    px: number,
    py: number,
    pz: number,
    onChange: (tx: number, ty: number, tz: number) => void,
    onDragEnd?: () => void,
  ): void;
  setEnterPivot(x: number, y: number, z: number): void;
  setEnterPosition(x: number, y: number, z: number): void;
  endTransformGizmo(opts?: { keepActive?: boolean }): void;
  setEnterActive(active: boolean): void;
}

export function createGizmo(deps: GizmoDeps): GizmoController {
  /** three.js TransformControls gizmo demo box (G toggle / Shift+G cycle). */
  let gizmoDemo: THREE.Mesh | null = null;
  let gizmoModes: ("translate" | "rotate" | "scale")[] = ["translate", "rotate", "scale"];
  let gizmoModeIdx = 0;
  let enterObject: THREE.Object3D | null = null;
  let enterMarker: THREE.Object3D | null = null;
  let enterOnChange: ((tx: number, ty: number, tz: number) => void) | null = null;
  let enterOnDragEnd: (() => void) | null = null;
  let demoWasOn = false;
  let demoMode: "translate" | "rotate" | "scale" = "translate";
  let enterResumeLine: THREE.Line | null = null;
  let enterEditHandler: (() => void) | null = null;

  /** three.js gizmo demo: TransformControls is the gizmo (the project already uses it
   *  for translate editing). G toggles the demo box, Shift+G cycles the gizmo mode. */
  const toggleGizmoDemo = (): void => {
    if (deps.state.enterActive) {
      store.pushLog("[viewport] exit enter edit mode first (Esc)");
      return;
    }
    if (gizmoDemo) {
      deps.transform.detach();
      deps.scene.remove(gizmoDemo);
      gizmoDemo = null;
      store.pushLog("[viewport] gizmo demo OFF");
      return;
    }
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshLambertMaterial({ color: 0x7ce3a8 }),
    );
    box.position.set(2, 1.5, 0);
    deps.scene.add(box);
    deps.transform.attach(box);
    deps.transform.setMode(gizmoModes[0]);
    gizmoModeIdx = 0;
    gizmoDemo = box;
    store.pushLog("[viewport] gizmo demo ON (three.js TransformControls) mode=translate - G toggle / Shift+G cycle");
  };

  /** Cycle translate -> rotate -> scale on the gizmo demo (no-op while demo is off). */
  const cycleGizmoMode = (): void => {
    if (deps.state.enterActive || !gizmoDemo) return;
    gizmoModeIdx = (gizmoModeIdx + 1) % 3;
    deps.transform.setMode(gizmoModes[gizmoModeIdx]);
    store.pushLog(`[viewport] gizmo mode = ${gizmoModes[gizmoModeIdx]}`);
  };

  /** Register the "enter node viewport edit" handler (main.ts); null clears it. */
  const setEnterEditHandler = (fn: (() => void) | null): void => {
    enterEditHandler = fn;
  };

  /** True while Enter edit mode is active (gizmo may be idle when no transform is selected). */
  const isEnterActive = (): boolean => {
    return deps.state.enterActive;
  };

  /** Enter edit mode for a transform node: attach the translate gizmo to a temp
   *  object at (tx,ty,tz) and report drags (rounded 4dp) via onChange. The reference
   *  marker sits at the PIVOT (px,py,pz) - dragging the gizmo moves tx/ty/tz only. */
  const beginTransformGizmo = (
    nodeId: string,
    tx: number,
    ty: number,
    tz: number,
    px: number,
    py: number,
    pz: number,
    onChange: (tx: number, ty: number, tz: number) => void,
    onDragEnd?: () => void,
  ): void => {
    if (deps.state.enterActive) endTransformGizmo({ keepActive: true });
    // mutual exclusion with the G-key demo / curve-line editing (one gizmo owner)
    demoWasOn = !!gizmoDemo;
    if (gizmoDemo) deps.transform.detach();
    enterResumeLine = deps.state.selectedLine;
    if (deps.state.selectedLine) deps.transform.detach();
    demoMode = deps.transform.getMode();
    deps.transform.setMode("translate"); // X/Y/Z arrows + XY/YZ/XZ plane squares
    enterOnChange = onChange;
    enterOnDragEnd = onDragEnd ?? null;

    const obj = new THREE.Object3D();
    obj.name = "cyl-enter-gizmo";
    obj.position.set(tx, ty, tz);
    deps.scene.add(obj);
    enterObject = obj;

    enterMarker = makeTranslateMarker();
    enterMarker.name = "cyl-enter-pivot";
    enterMarker.position.set(px, py, pz);
    deps.scene.add(enterMarker);

    const onObjChange = (): void => {
      const p = obj.position;
      const r = (n: number): number => Math.round(n * 10000) / 10000;
      enterOnChange?.(r(p.x), r(p.y), r(p.z));
    };
    obj.userData.cylEnterChange = onObjChange;
    deps.transform.addEventListener("objectChange", onObjChange);
    deps.transform.attach(obj);

    deps.state.enterActive = true;
    deps.enterBtn.classList.add("cyl-enter-on");
    store.pushLog(`[viewport] enter edit mode: transform ${nodeId} gizmo at (${tx}, ${ty}, ${tz}) - drag axes/planes (Esc to exit)`);
  };

  /** Move the pivot reference marker (param-panel px/py/pz edits while Enter is active). */
  const setEnterPivot = (x: number, y: number, z: number): void => {
    if (enterMarker) enterMarker.position.set(x, y, z);
  };

  /** Move the Enter gizmo temp object (tx/ty/tz) - used after param undo/redo so the
   *  gizmo snaps back to the reverted node params. No-op when no gizmo is bound. */
  const setEnterPosition = (x: number, y: number, z: number): void => {
    if (enterObject) enterObject.position.set(x, y, z);
  };

  /** Leave Enter edit mode: detach, drop the temp object/marker, restore G demo / curve.
   *  With keepActive the MODE stays on (button lit, isEnterActive() true) and only the
   *  gizmo is dropped - used when the selection has no edit target (null/input/output). */
  const endTransformGizmo = (opts: { keepActive?: boolean } = {}): void => {
    const { keepActive = false } = opts;
    const obj = enterObject;
    if (obj) {
      const fn = obj.userData.cylEnterChange as (() => void) | undefined;
      if (fn) deps.transform.removeEventListener("objectChange", fn);
      deps.transform.detach();
      deps.scene.remove(obj);
    }
    if (enterMarker) {
      deps.scene.remove(enterMarker);
      enterMarker.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else if (m) m.dispose();
      });
    }
    enterObject = null;
    enterMarker = null;
    enterOnChange = null;
    enterOnDragEnd = null;
    if (keepActive) return; // mode stays active, gizmo idle until a transform is selected
    const wasActive = deps.state.enterActive;
    deps.state.enterActive = false;
    deps.enterBtn.classList.remove("cyl-enter-on");
    if (demoWasOn && gizmoDemo) {
      deps.transform.setMode(demoMode);
      deps.transform.attach(gizmoDemo);
    }
    demoWasOn = false;
    if (enterResumeLine && deps.state.selectedLine === enterResumeLine) {
      deps.transform.attach(enterResumeLine);
    }
    enterResumeLine = null;
    if (wasActive) store.pushLog("[viewport] exited enter edit mode");
  };

  /** Activate Enter mode WITHOUT a gizmo (e.g. no transform selected): the mode stays
   *  on, the toolbar button stays lit, and the viewport renders normally. False = exit. */
  const setEnterActive = (active: boolean): void => {
    if (active) {
      deps.state.enterActive = true;
      deps.enterBtn.classList.add("cyl-enter-on");
      return;
    }
    endTransformGizmo();
  };

  /** Small reference marker at the PIVOT position: RGB axis stubs only (no box). */
  const makeTranslateMarker = (): THREE.Group => {
    const g = new THREE.Group();
    const axes: Array<[THREE.Vector3, number]> = [
      [new THREE.Vector3(1, 0, 0), 0xff5252],
      [new THREE.Vector3(0, 1, 0), 0x4fc3f7],
      [new THREE.Vector3(0, 0, 1), 0xffee58],
    ];
    for (const [dir, color] of axes) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(0.6)]),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }),
      );
      g.add(line);
    }
    return g;
  };

  /** Enter toolbar button click: toggle Enter edit mode off/on. */
  const enterButtonClick = (): void => {
    if (deps.state.enterActive) endTransformGizmo();
    else enterEditHandler?.();
  };

  /** TransformControls drag-end (mouseup update mode commits the buffered value once). */
  const notifyDragEnd = (): void => {
    if (deps.state.enterActive) enterOnDragEnd?.();
  };

  return {
    setEnterEditHandler,
    isEnterActive,
    enterButtonClick,
    notifyDragEnd,
    toggleGizmoDemo,
    cycleGizmoMode,
    beginTransformGizmo,
    setEnterPivot,
    setEnterPosition,
    endTransformGizmo,
    setEnterActive,
  };
}