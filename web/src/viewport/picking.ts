/**
 * Curve picking + edit controller (2.3 split): raycaster hit-testing, selection,
 * commit edit (translate curve -> OutputBuffer). Receives shared state + camera /
 * transform / inputGroup via deps.
 */
import * as THREE from "three";
import type { TransformControls } from "three/addons/controls/TransformControls.js";
import { store } from "../stores/workspace";
import type { CurveData, OutputBuffer } from "../protocol/types";
import { applyTranslateToCurve, inputToOutput } from "../tools/transform";
import type { ViewportState } from "./state";

export interface PickingDeps {
  state: ViewportState;
  camera: THREE.PerspectiveCamera;
  transform: TransformControls;
  inputGroup: THREE.Group;
  domElement: HTMLElement;
  onEdit(out: OutputBuffer): void;
}

export interface PickingController {
  onPointerDown(e: PointerEvent): void;
  pickByNode(kind: "input" | "output" | "null" | "transform", index: number | null): void;
  commitEdit(): void;
}

export function createPicking(deps: PickingDeps): PickingController {
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();

  /** Node-graph -> viewport linkage: picking a node/port selects its curve. */
  function pickByNode(kind: "input" | "output" | "null" | "transform", index: number | null): void {
    if (kind === "input") {
      if (index === null) {
        store.pushLog("input_ node picked - click a port (in0..in3) to select that curve");
        return;
      }
      const inp = store.inputs.find((i) => i.index === index);
      if (!inp || inp.curves.length === 0) {
        store.pushLog(`input_${index}: no curve to select`);
        return;
      }
      const sub = deps.inputGroup.getObjectByName(`input${index}`) as THREE.Group | undefined;
      const line = sub?.children[0] as THREE.Line | undefined;
      if (line) {
        select(line);
        store.pushLog(`node link: selected input${index} (${inp.curves[0].pointIndices.length} pts)`);
      }
      return;
    }
    if (kind === "output") {
      store.pushLog("output_ node picked - outputs are read-only in v1 (edit happens on inputs)");
      return;
    }
    if (kind === "transform") {
      store.pushLog("transform node picked - passthrough (no edit target in v1)");
      return;
    }
    store.pushLog("null node picked - passthrough (no edit target in v1)");
  }

  function onPointerDown(e: PointerEvent): void {
    // Only plain left-click selects; Alt is handed to HoudiniControls navigation.
    if (deps.state.enterActive || e.altKey || e.button !== 0 || deps.transform.dragging) return;
    const rect = deps.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    raycaster.setFromCamera(pointer, deps.camera);
    raycaster.params.Line!.threshold = 0.035;
    const hits = raycaster.intersectObjects(deps.inputGroup.children, true);
    if (hits.length > 0) select(hits[0].object as THREE.Line);
    else clearSelection();
  }

  function select(line: THREE.Line): void {
    if (deps.state.enterActive) return; // Enter edit owns the gizmo
    const inputIndex = line.userData.inputIndex as number;
    const curve = line.userData.curve as CurveData;
    const input = store.inputs.find((i) => i.index === inputIndex);
    if (input === undefined || curve === undefined) return;
    deps.state.selectedLine = line;
    line.position.set(0, 0, 0);
    deps.transform.attach(line);
    store.setSelectedInput(inputIndex);
    store.pushLog(`selected input${inputIndex} curve (${curve.pointIndices.length} pts) - drag to translate`);
  }

  function clearSelection(): void {
    if (deps.transform.dragging) return;
    deps.state.selectedLine = null;
    deps.transform.detach();
    store.setSelectedInput(null);
  }

  function commitEdit(): void {
    if (deps.state.enterActive) return; // transform-param drag handled by the Enter onChange
    const line = deps.state.selectedLine;
    if (!line) return;
    const inputIndex = line.userData.inputIndex as number;
    const curve = line.userData.curve as CurveData;
    const input = store.inputs.find((i) => i.index === inputIndex);
    if (!input || !curve) return;
    const dx = line.position.x;
    const dy = line.position.y;
    const dz = line.position.z;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-6) return;
    const curveIdx = input.curves.indexOf(curve);
    const points = applyTranslateToCurve(input, curveIdx, dx, dy, dz);
    const out = inputToOutput(inputIndex, input, points);
    deps.onEdit(out);
  }

  return { onPointerDown, pickByNode, commitEdit };
}
