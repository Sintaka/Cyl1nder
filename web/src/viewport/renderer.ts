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

/** Viewport display modes: smooth/flat Lambert shading (optional black wire),
 *  unlit wire shading, pure wireframe, and a translucent wireframe ghost. */
export type DisplayMode =
  | "smooth-shaded"
  | "smooth-wire"
  | "flat-shaded"
  | "flat-wire"
  | "unlit-wire"
  | "wireframe"
  | "wireframe-ghost";

/** Mode label + menu order (menu renders in object-key order, exactly as required). */
const MODE_LABELS: Record<DisplayMode, string> = {
  "smooth-shaded": "Smooth Shaded",
  "smooth-wire": "Smooth Wire Shaded",
  "flat-shaded": "Flat Shaded",
  "flat-wire": "Flat Wire Shaded",
  "unlit-wire": "Unlit Wire Shaded",
  wireframe: "Wireframe",
  "wireframe-ghost": "Wireframe Ghost",
};

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

  /** Display modes: smooth/flat shaded (Lambert, optional black wire), unlit wire, wireframe, wireframe ghost. */
  displayMode: DisplayMode = "smooth-shaded";
  /** Debug reference boxes: verify the viewport can render (independent of incoming data). */
  private debugBoxes = new THREE.Group();
  private headLight = new THREE.DirectionalLight(0xffffff, 1.1);
  private ambient = new THREE.AmbientLight(0x404050, 0.8);
  private modeBtn: HTMLButtonElement;
  /** Mode remembered before entering wireframe-ghost, so W can restore it. */
  private modeBeforeGhost: DisplayMode = "smooth-shaded";

  private constructor(
    private container: HTMLElement,
    private onEdit: (out: OutputBuffer) => void,
    renderer: RendererLike,
  ) {
    this.renderer = renderer;
    // preserveDrawingBuffer so compositor/drawImage captures see WebGL content (debug friendly)
    (renderer as { preserveDrawingBuffer?: boolean }).preserveDrawingBuffer = true;
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
    // debug boxes at +X and +Y offsets - prove the viewport renders geometry on its own
    this.debugBoxes.add(this.makeBox(new THREE.Vector3(4, 0, 0), 0xff5252));
    this.debugBoxes.add(this.makeBox(new THREE.Vector3(0, 4, 0), 0x4fc3f7));
    this.debugBoxes.visible = false;
    this.scene.add(this.debugBoxes);
    this.headLight.position.set(4, 6, 8);
    this.scene.add(this.headLight);
    this.scene.add(this.ambient);

    // display-mode toggle chip (top-right of the viewport)
    this.modeBtn = document.createElement("button");
    this.modeBtn.type = "button";
    this.modeBtn.className = "cyl-mode-chip";
    this.modeBtn.textContent = MODE_LABELS[this.displayMode];
    // hold-to-open dropdown: hover an option, release applies it
    const modeMenu = document.createElement("div");
    modeMenu.className = "cyl-mode-menu hidden";
    container.appendChild(modeMenu);
    const showModeMenu = () => {
      const modes = (Object.keys(MODE_LABELS) as DisplayMode[]).map(
        (k) => [k, MODE_LABELS[k]] as [DisplayMode, string],
      );
      modeMenu.innerHTML = modes
        .map(([k, label]) => `<div class="cyl-mode-item ${k === this.displayMode ? "on" : ""}" data-mode="${k}">${label}</div>`)
        .join("");
      modeMenu.classList.remove("hidden");
      const r = this.modeBtn.getBoundingClientRect();
      modeMenu.style.left = `${r.left}px`;
      modeMenu.style.top = `${r.bottom + 2}px`;
    };
    const hideModeMenu = () => modeMenu.classList.add("hidden");
    const applyMode = () => {
      const hover = modeMenu.querySelector(".cyl-mode-item.hover") as HTMLElement | null;
      const m = (hover?.dataset.mode ?? this.displayMode) as DisplayMode;
      this.setDisplayMode(m);
      hideModeMenu();
    };
    modeMenu.addEventListener("pointermove", (e) => {
      const item = (e.target as HTMLElement).closest?.(".cyl-mode-item");
      modeMenu.querySelectorAll(".cyl-mode-item").forEach((i) => i.classList.toggle("hover", i === item));
    });
    // Click vs drag: a plain click keeps the menu open persistently (click an item or
    // anywhere outside to apply/close); a drag (pointer moved >4px) applies the hovered
    // option on release. This fixes "click closes immediately" and the docked-panel clip.
    let modeOpen = false;
    let modeStart = { x: 0, y: 0 };
    const openModeMenu = () => { showModeMenu(); modeOpen = true; };
    const closeModeMenu = () => { modeOpen = false; hideModeMenu(); };
    this.modeBtn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (modeOpen) { closeModeMenu(); return; } // second click toggles closed
      modeStart = { x: e.clientX, y: e.clientY };
      openModeMenu();
    });
    window.addEventListener("pointerup", (e) => {
      if (!modeOpen) return;
      const dx = e.clientX - modeStart.x;
      const dy = e.clientY - modeStart.y;
      if (Math.hypot(dx, dy) > 4) applyMode(); // drag: apply hovered option on release
      // click: menu stays open; item click / outside click closes it
    });
    modeMenu.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest?.(".cyl-mode-item");
      if (item) {
        this.setDisplayMode((item as HTMLElement).dataset.mode as DisplayMode);
        closeModeMenu();
      }
    });
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (modeOpen && !modeMenu.contains(e.target as Node) && e.target !== this.modeBtn) closeModeMenu();
      },
      true,
    );
    container.appendChild(this.modeBtn);

    // 35mm-equivalent lens: vertical FOV = 2*atan(24/(2*35)) ≈ 38 deg (full-frame 36x24).
    const CAMERA_FOV_35MM = 38;
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV_35MM,
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
    this.attachKeyboardShortcuts();
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
      store.pushLogSilent(`[viewport] inputs rebuilt rev=${store.inputRev} curves=${store.inputs.reduce((n, i) => n + i.curves.length, 0)} faces=${store.inputs.reduce((n, i) => n + (i.faces?.length ?? 0), 0)}`);
      this.applyDisplayMode();
    }
    if (store.outputRev !== this.lastOutputRev) {
      this.outputGroup.clear();
      this.outputGroup.add(buildOutputs(store.outputs));
      this.lastOutputRev = store.outputRev;
      store.pushLogSilent(`[viewport] outputs rebuilt rev=${store.outputRev} buffers=${store.outputs.length}`);
      this.applyDisplayMode();
    }
  }

  /** Node display flags drive whether input/output groups are visible. */
  setVisibility(kind: "inputs" | "outputs", visible: boolean): void {
    this.inputGroup.visible = kind === "inputs" ? visible : this.inputGroup.visible;
    this.outputGroup.visible = kind === "outputs" ? visible : this.outputGroup.visible;
    store.pushLogSilent(`[viewport] visibility ${kind}=${visible} (inputs=${this.inputGroup.visible} outputs=${this.outputGroup.visible})`);
  }

  private makeBox(center: THREE.Vector3, color: number): THREE.LineSegments {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.6, 0.6, 0.6));
    const box = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    box.position.copy(center);
    return box;
  }

  /** Toggle the debug reference boxes (view capability check). */
  toggleDebugBoxes(): void {
    this.debugBoxes.visible = !this.debugBoxes.visible;
    store.pushLog(`[viewport] debug boxes ${this.debugBoxes.visible ? "shown" : "hidden"}`);
  }

  /** Display flag shows only the FIRST port of the displayed node (Houdini display).
   *  index=null shows the whole group. */
  setDisplayFocus(kind: "inputs" | "outputs", index: number | null): void {
    // buildInputs/buildOutputs wrap the per-port groups inside one Group; traverse
    // to find the actual inputN/outputN groups (face/wire meshes live inside them).
    const root = kind === "inputs" ? this.inputGroup : this.outputGroup;
    const prefix = kind === "inputs" ? "input" : "output";
    const re = new RegExp(`^${prefix}(\\d+)$`);
    root.traverse((o) => {
      const m = o.name?.match(re);
      if (m) o.visible = index === null || Number(m[1]) === index;
    });
    store.pushLogSilent(`[viewport] display focus ${kind} index=${index}`);
  }

  /** Wireframe reference overlays driven by node "wireframe" flags. */
  setReference(items: ReferenceItem[] | null): void {
    this.referenceGroup.clear();
    if (items) {
      for (const it of items) {
        const sub = buildCurves(it.points, it.curves, [], it.color, null);
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
    this.applyDisplayMode();
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

  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    this.modeBtn.textContent = MODE_LABELS[mode];
    this.applyDisplayMode();
    store.pushLog(`[viewport] display mode = ${mode}`);
  }

  /** W / Shift+W display-mode hotkeys. Lives here (not main.ts) so F/B handlers stay untouched. */
  private attachKeyboardShortcuts(): void {
    const isTyping = (): boolean => {
      const el = document.activeElement;
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      );
    };
    window.addEventListener("keydown", (e) => {
      if (e.repeat || e.key.toLowerCase() !== "w" || isTyping()) return;
      e.preventDefault();
      if (e.shiftKey) {
        // Shift+W: toggle inside the shaded pair you're in; from any other mode, enter the smooth pair.
        if (this.displayMode === "flat-shaded") this.setDisplayMode("flat-wire");
        else if (this.displayMode === "flat-wire") this.setDisplayMode("flat-shaded");
        else if (this.displayMode === "smooth-shaded") this.setDisplayMode("smooth-wire");
        else if (this.displayMode === "smooth-wire") this.setDisplayMode("smooth-shaded");
        else this.setDisplayMode("smooth-wire");
        return;
      }
      // W: toggle between the PREVIOUS mode and wireframe-ghost (remember/restore).
      if (this.displayMode === "wireframe-ghost") {
        this.setDisplayMode(this.modeBeforeGhost);
      } else {
        this.modeBeforeGhost = this.displayMode;
        this.setDisplayMode("wireframe-ghost");
      }
    });
  }

  /** Apply the current display mode to every face/wire mesh pair (curves stay lines). */
  private applyDisplayMode(): void {
    const m = this.displayMode;
    const wireVisible =
      m === "smooth-wire" || m === "flat-wire" || m === "unlit-wire" || m === "wireframe" || m === "wireframe-ghost";
    // Wireframe + ghost use bone-white wire (#CCCBBA); every other wire mode stays black.
    const wireColor = m === "wireframe" || m === "wireframe-ghost" ? 0xcccbBA : 0x000000;
    const walk = (obj: THREE.Object3D): void => {
      const ud = obj.userData as { face?: THREE.Mesh; wire?: THREE.Mesh; color?: number };
      if (ud.face && ud.wire) {
        const color = ud.color ?? 0x4fc3f7;
        let faceMat: THREE.Material | THREE.Material[];
        if (m === "smooth-shaded" || m === "smooth-wire") {
          // smooth vertex normals (computeVertexNormals in geometry.ts) + grey Lambert + headlight
          faceMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6, side: THREE.DoubleSide });
        } else if (m === "flat-shaded" || m === "flat-wire") {
          faceMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6, side: THREE.DoubleSide, flatShading: true });
        } else if (m === "unlit-wire") {
          faceMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
        } else if (m === "wireframe-ghost") {
          faceMat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
          });
        } else {
          faceMat = ud.face.material; // wireframe: faces hidden, material irrelevant
        }
        ud.face.material = faceMat;
        ud.face.visible = m !== "wireframe";
        ud.wire.material = new THREE.LineBasicMaterial({ color: wireColor });
        ud.wire.visible = wireVisible;
      }
      for (const c of obj.children) walk(c);
    };
    walk(this.inputGroup);
    walk(this.outputGroup);
    walk(this.referenceGroup);
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
    // headlight = simple camera light
    this.headLight.position.copy(this.camera.position);
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
