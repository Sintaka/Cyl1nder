import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { HoudiniControls } from "./controls";
import { buildInputs, buildOutputs } from "./geometry";
import { store } from "../stores/workspace";
import { applyTranslateToCurve, inputToOutput } from "../tools/transform";
import type { CurveData, OutputBuffer } from "../protocol/types";

/**
 * Three.js viewport (WebGLRenderer default; WebGPU swap reserved via RENDER_MODE).
 * Data/render separation: store -> refresh() -> rebuild curve groups.
 */
export class Viewport {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: HoudiniControls;
  private transform: TransformControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private inputGroup = new THREE.Group();
  private outputGroup = new THREE.Group();
  private lastInputRev = -1;
  private lastOutputRev = -1;
  private selectedLine: THREE.Line | null = null;
  private animId = 0;

  constructor(
    private container: HTMLElement,
    private onEdit: (out: OutputBuffer) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x1a1a1a);
    this.scene.add(new THREE.GridHelper(10, 20, 0x3a3a3a, 0x262626));

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.01,
      1000,
    );
    this.camera.position.set(4, 3, 6);
    this.camera.lookAt(0, 0, 0);

    this.controls = new HoudiniControls(this.camera, this.renderer.domElement);

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode("translate");
    this.transform.setSize(0.7);
    this.transform.addEventListener("dragging-changed", (e: any) => {
      this.controls.controls.enabled = !e.value;
      if (!e.value) this.commitEdit();
    });
    this.scene.add(this.transform.getHelper());  // three r180: TransformControls extends Controls

    this.renderer.domElement.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.scene.add(this.inputGroup);
    this.scene.add(this.outputGroup);

    new ResizeObserver(() => this.resize()).observe(container);
    this.animate();
  }

  refresh(): void {
    if (store.inputRev !== this.lastInputRev) {
      this.inputGroup.clear();
      this.inputGroup.add(buildInputs(store.inputs));
      this.lastInputRev = store.inputRev;
    }
    if (store.outputRev !== this.lastOutputRev) {
      this.outputGroup.clear();
      this.outputGroup.add(buildOutputs(store.outputs));
      this.lastOutputRev = store.outputRev;
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.altKey || e.button !== 0 || this.transform.dragging) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.params.Line!.threshold = 0.035;
    const hits = this.raycaster.intersectObjects(this.inputGroup.children, true);
    if (hits.length > 0) this.select(hits[0].object as THREE.Line);
    else this.clearSelection();
  }

  private select(line: THREE.Line): void {
    const inputIndex = line.userData.inputIndex as number;
    const curve = line.userData.curve as CurveData;
    const input = store.inputs.find((i) => i.index === inputIndex);
    if (input === undefined || curve === undefined) return;
    this.selectedLine = line;
    line.position.set(0, 0, 0);
    this.transform.attach(line);
    store.setSelectedInput(inputIndex);
    store.pushLog(`selected input${inputIndex} curve (${curve.pointIndices.length} pts) - drag to translate`);
  }

  private clearSelection(): void {
    if (this.transform.dragging) return;
    this.selectedLine = null;
    this.transform.detach();
    store.setSelectedInput(null);
  }

  private commitEdit(): void {
    const line = this.selectedLine;
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
    this.onEdit(out);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate = (): void => {
    this.animId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.animId);
    this.controls.controls.dispose();
    this.transform.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}