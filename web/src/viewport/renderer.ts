import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { createRenderer, type RendererLike } from "./backend";
import { HoudiniControls } from "./controls";
import { buildCurves, buildInputs, buildOutputs } from "./geometry";
import { store } from "../stores/workspace";
import { applyTranslateToCurve, inputToOutput } from "../tools/transform";
import type { CurveData, OutputBuffer } from "../protocol/types";

export interface ReferenceItem {
  points: number[][];
  curves: CurveData[];
  color: number;
}

/**
 * Three.js viewport (WebGLRenderer default; WebGPU swap reserved via RENDER_MODE).
 * Data/render separation: store -> refresh() -> rebuild curve groups.
 */
export class Viewport {
  private renderer: RendererLike;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: HoudiniControls;
  private transform: TransformControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private inputGroup = new THREE.Group();
  private outputGroup = new THREE.Group();
  private referenceGroup = new THREE.Group();
  private lastInputRev = -1;
  private lastOutputRev = -1;
  private selectedLine: THREE.Line | null = null;
  private animId = 0;

  private constructor(
    private container: HTMLElement,
    private onEdit: (out: OutputBuffer) => void,
    renderer: RendererLike,
  ) {
    this.renderer = renderer;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    // The canvas is an <img>-like surface in Chrome: without this, right-click
    // opens the browser "Save image as" menu and drag can start an image drag.
    const canvas = this.renderer.domElement;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("dragover", (e) => e.preventDefault());
    canvas.addEventListener("drop", (e) => e.preventDefault());
    canvas.addEventListener("dragstart", (e) => e.preventDefault());
    canvas.style.touchAction = "none";
    canvas.style.userSelect = "none";

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
    this.scene.add(this.referenceGroup);

    new ResizeObserver(() => this.resize()).observe(container);
    this.animate();
  }

  /** Async factory: picks WebGL (default) or WebGPU via RENDER_MODE. */
  static async create(container: HTMLElement, onEdit: (out: OutputBuffer) => void): Promise<Viewport> {
    const renderer = await createRenderer();
    return new Viewport(container, onEdit, renderer);
  }

  refresh(): void {
    if (store.inputRev !== this.lastInputRev) {
      this.inputGroup.clear();
      this.inputGroup.add(buildInputs(store.inputs));
      this.lastInputRev = store.inputRev;
      store.pushLogSilent(`[viewport] inputs rebuilt rev=${store.inputRev} curves=${store.inputs.reduce((n, i) => n + i.curves.length, 0)}`);
    }
    if (store.outputRev !== this.lastOutputRev) {
      this.outputGroup.clear();
      this.outputGroup.add(buildOutputs(store.outputs));
      this.lastOutputRev = store.outputRev;
      store.pushLogSilent(`[viewport] outputs rebuilt rev=${store.outputRev} buffers=${store.outputs.length}`);
    }
  }

  /** Node display flags drive whether input/output groups are visible. */
  setVisibility(kind: "inputs" | "outputs", visible: boolean): void {
    this.inputGroup.visible = kind === "inputs" ? visible : this.inputGroup.visible;
    this.outputGroup.visible = kind === "outputs" ? visible : this.outputGroup.visible;
    store.pushLogSilent(`[viewport] visibility ${kind}=${visible} (inputs=${this.inputGroup.visible} outputs=${this.outputGroup.visible})`);
  }

  /** Wireframe reference overlays driven by node "wireframe" flags. */
  setReference(items: ReferenceItem[] | null): void {
    this.referenceGroup.clear();
    if (items) {
      for (const it of items) {
        const sub = buildCurves(it.points, it.curves, it.color, null);
        sub.traverse((o) => {
          if (o instanceof THREE.Line) {
            const m = o.material as THREE.LineBasicMaterial;
            m.transparent = true;
            m.opacity = 0.55;
          }
        });
        this.referenceGroup.add(sub);
      }
    }
  }

  /** Node-graph -> viewport linkage: picking a node/port selects its curve. */
  pickByNode(kind: "input" | "output" | "null", index: number | null): void {
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
      const sub = this.inputGroup.getObjectByName(`input${index}`) as THREE.Group | undefined;
      const line = sub?.children[0] as THREE.Line | undefined;
      if (line) {
        this.select(line);
        store.pushLog(`node link: selected input${index} (${inp.curves[0].pointIndices.length} pts)`);
      }
      return;
    }
    if (kind === "output") {
      store.pushLog("output_ node picked - outputs are read-only in v1 (edit happens on inputs)");
      return;
    }
    store.pushLog("null node picked - passthrough (no edit target in v1)");
  }

  private onPointerDown(e: PointerEvent): void {
    // Only plain left-click selects; Alt is handed to HoudiniControls navigation.
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

  /** Frame the visible geometry (or reset to default when nothing is shown). */
  frame(): void {
    const box = new THREE.Box3();
    let has = false;
    for (const group of [this.inputGroup, this.outputGroup]) {
      if (!group.visible) continue;
      const b = new THREE.Box3().setFromObject(group);
      if (!b.isEmpty()) {
        box.union(b);
        has = true;
      }
    }
    if (!has) {
      this.frameDefault();
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0, 0, Math.max(size * 1.5, 1)));
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.controls.update();
    store.pushLog(`[viewport] framed geometry center=${center.toArray().map((n) => n.toFixed(2)).join(",")} size=${size.toFixed(2)}`);
  }

  /** Reset to the default camera pose. */
  frameDefault(): void {
    this.controls.controls.target.set(0, 0, 0);
    this.camera.position.set(4, 3, 6);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.controls.update();
    store.pushLog("[viewport] frame default view");
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
