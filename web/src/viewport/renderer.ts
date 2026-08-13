import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { createRenderer, type RendererLike } from "./backend";
import { HoudiniControls } from "./controls";
import { buildCurves, buildInputs, buildOutputs, buildNodeResult, sameTopology, updateGroupPositions } from "./geometry";
import { store } from "../stores/workspace";
import type { CurveData, OutputBuffer } from "../protocol/types";
import { MODE_LABELS, applyDisplayModeToGroup, type DisplayMode } from "./modes";
import { buildViewportScene } from "./scene";
import { CAMERA_FOV_35MM, createCamera, frameVisible, frameDefault } from "./camera";
import { createPicking, type PickingController } from "./picking";
import { createGizmo, type GizmoController } from "./gizmo";
import type { ViewportState } from "./state";

export interface ReferenceItem {
  points: number[][];
  curves: CurveData[];
  color: number;
}

export type { DisplayMode } from "./modes";

/**
 * Three.js viewport (WebGLRenderer default; WebGPU swap reserved via RENDER_MODE).
 * Data/render separation: store -> refresh() -> curve groups. Same-topology buffers
 * (e.g. an Enter-gizmo translate) update positions IN PLACE - no clear, no mesh
 * rebuild; topology changes rebuild. The Enter gizmo is a SEPARATE temp object:
 * geometry follows ONLY via parms -> refresh, never by moving geometry to preview.
 * Thin shell (2.3 split): scene/camera/picking/gizmo live in helper modules.
 */
export class Viewport {
  private renderer: RendererLike;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: HoudiniControls;
  private transform: TransformControls;
  private picking: PickingController;
  private gizmo: GizmoController;
  private state: ViewportState;
  private inputGroup: THREE.Group;
  private outputGroup: THREE.Group;
  private nodeResultGroup: THREE.Group;
  private referenceGroup: THREE.Group;
  private debugBoxes: THREE.Group;
  private headLight: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private lastInputRev = -1;
  private lastOutputRev = -1;
  /** Last buffer shown by showNodeResult - lets position-only updates skip rebuilds. */
  private lastNodeResult: OutputBuffer | null = null;
  /** Last output buffers shown by refresh() - lets position-only updates skip rebuilds. */
  private lastShownOutputs: OutputBuffer[] = [];
  private animId = 0;
  /** Pre-render flush hook (set by main.ts): runs network + store-view flush BEFORE
   *  this frame's render, so geometry and gizmo land on the same frame. */
  private preRenderFlush: (() => void) | null = null;
  /** True while the pointer hovers the viewport canvas (Enter-key gating in main.ts). */
  private hovered = false;
  private toolbar: HTMLDivElement;
  private enterBtn: HTMLButtonElement;
  private modeBtn: HTMLButtonElement;

  /** Display modes: smooth/flat shaded (Lambert, optional black wire), unlit shaded/wire, wireframe, wireframe ghost. */
  displayMode: DisplayMode = "flat-wire";
  /** Mode remembered before entering wireframe-ghost, so W can restore it. */
  private modeBeforeGhost: DisplayMode = "flat-wire";

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
    canvas.addEventListener("pointerenter", () => { this.hovered = true; });
    canvas.addEventListener("pointerleave", () => { this.hovered = false; });

    // scene construction moved to ./scene (buildViewportScene): background, grid,
    // debug boxes, headlight, ambient + the four data groups.
    const vs = buildViewportScene();
    this.scene = vs.scene;
    this.inputGroup = vs.inputGroup;
    this.outputGroup = vs.outputGroup;
    this.nodeResultGroup = vs.nodeResultGroup;
    this.referenceGroup = vs.referenceGroup;
    this.debugBoxes = vs.debugBoxes;
    this.headLight = vs.headLight;
    this.ambient = vs.ambient;

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

    // left icon toolbar: first icon = Enter (node viewport edit activation)
    this.toolbar = document.createElement("div");
    this.toolbar.className = "cyl-viewport-toolbar";
    this.enterBtn = document.createElement("button");
    this.enterBtn.type = "button";
    this.enterBtn.className = "cyl-tool-btn";
    this.enterBtn.title = "Enter node viewport edit";
    this.enterBtn.innerHTML = `
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 2 h2 M3 14 h2 M5 2 v12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        <path d="M8 8 h5 M11 4.5 l3.5 3.5 -3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    this.enterBtn.addEventListener("click", () => {
      this.gizmo.enterButtonClick();
    });
    this.toolbar.appendChild(this.enterBtn);
    container.appendChild(this.toolbar);

    // 35mm-equivalent lens: vertical FOV = 2*atan(24/(2*35)) ≈ 38 deg (full-frame 36x24).
    this.camera = createCamera(container.clientWidth / Math.max(1, container.clientHeight));

    this.controls = new HoudiniControls(this.camera, this.renderer.domElement);

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode("translate");
    this.transform.setSize(0.7);
    this.scene.add(this.transform.getHelper());  // three r180: TransformControls extends Controls

    // shared state passed by reference to both controllers
    this.state = { enterActive: false, selectedLine: null };
    this.picking = createPicking({
      state: this.state,
      camera: this.camera,
      transform: this.transform,
      inputGroup: this.inputGroup,
      domElement: this.renderer.domElement,
      onEdit,
    });
    this.gizmo = createGizmo({
      state: this.state,
      scene: this.scene,
      transform: this.transform,
      enterBtn: this.enterBtn,
    });

    this.transform.addEventListener("dragging-changed", (e: any) => {
      this.controls.controls.enabled = !e.value;
      if (!e.value) {
        this.picking.commitEdit();
        // Enter gizmo: report drag end (mouseup update mode commits the buffered value once)
        this.gizmo.notifyDragEnd();
      }
    });

    this.scene.add(this.inputGroup);
    this.scene.add(this.outputGroup);
    this.scene.add(this.referenceGroup);
    this.scene.add(this.nodeResultGroup);

    this.renderer.domElement.addEventListener("pointerdown", (e) => this.picking.onPointerDown(e));

    new ResizeObserver(() => this.resize()).observe(container);
    this.attachKeyboardShortcuts();
    this.animate();
  }

  /** Async factory: picks WebGL (default) or WebGPU via RENDER_MODE. */
  static async create(container: HTMLElement, onEdit: (out: OutputBuffer) => void): Promise<Viewport> {
    const renderer = await createRenderer();
    return new Viewport(container, onEdit, renderer);
  }

  /** Install the pre-render flush callback (main.ts pump: network + store view). */
  setPreRenderFlush(fn: (() => void) | null): void {
    this.preRenderFlush = fn;
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
      // Hidden outputGroup (display is a null/transform node -> the node-result
      // group carries the shown geometry): skip all per-frame geometry work. We
      // intentionally do NOT consume lastOutputRev/lastShownOutputs while hidden,
      // so when the display flips back to output, the next visible refresh()
      // rebuilds/updates this pending rev (dataflow.flush runs refreshNodeFlags
      // before refresh, so the visibility is current on the same frame).
      if (!this.outputGroup.visible) {
        // 隐藏：跳过几何工作；故意不更新 lastOutputRev/lastShownOutputs，这样以后显示时 refresh() 会重建
      } else {
        // Position-only fast path: when every buffer keeps the SAME topology as the
        // last shown one (e.g. an Enter-gizmo translate), rewrite each outputN
        // sub-group's positions in place - no clear, no mesh rebuild, so the geometry
        // follows the parms on the same frame. Any topology change / length mismatch
        // falls back to a full rebuild.
        let updated = false;
        if (
          this.lastShownOutputs.length === store.outputs.length &&
          store.outputs.every((o, i) => sameTopology(o, this.lastShownOutputs[i]))
        ) {
          let ok = true;
          for (const buf of store.outputs) {
            const sub = this.outputGroup.children.find(
              (c) => c.name === `output${buf.index}` && c instanceof THREE.Group,
            ) as THREE.Group | undefined;
            if (!sub || !updateGroupPositions(sub, buf)) {
              ok = false;
              break;
            }
          }
          updated = ok;
        }
        if (!updated) {
          this.outputGroup.clear();
          this.outputGroup.add(buildOutputs(store.outputs));
        }
        this.lastShownOutputs = store.outputs.map((o) => ({ ...o }));
        this.lastOutputRev = store.outputRev;
        store.pushLogSilent(`[viewport] outputs rebuilt rev=${store.outputRev} buffers=${store.outputs.length}`);
        this.applyDisplayMode();
      }
    }
  }

  /** Node display flags drive whether input/output groups are visible. */
  setVisibility(kind: "inputs" | "outputs", visible: boolean): void {
    this.inputGroup.visible = kind === "inputs" ? visible : this.inputGroup.visible;
    this.outputGroup.visible = kind === "outputs" ? visible : this.outputGroup.visible;
    store.pushLogSilent(`[viewport] visibility ${kind}=${visible} (inputs=${this.inputGroup.visible} outputs=${this.outputGroup.visible})`);
  }

  /** Toggle the debug reference boxes (view capability check). */
  toggleDebugBoxes(): void {
    this.debugBoxes.visible = !this.debugBoxes.visible;
    store.pushLog(`[viewport] debug boxes ${this.debugBoxes.visible ? "shown" : "hidden"}`);
  }

  /** Display flag shows only the port routed through the displayed node (Houdini display).
   *  index=null shows the whole group; index=-1 hides the whole group (a display
   *  null/transform with no connected input -> nothing to show). */
  setDisplayFocus(kind: "inputs" | "outputs", index: number | null): void {
    // buildInputs/buildOutputs wrap the per-port groups inside one Group; traverse
    // to find the actual inputN/outputN groups (face/wire meshes live inside them).
    const root = kind === "inputs" ? this.inputGroup : this.outputGroup;
    const prefix = kind === "inputs" ? "input" : "output";
    const re = new RegExp(`^${prefix}(\\d+)$`);
    root.traverse((o) => {
      const m = o.name?.match(re);
      if (m) o.visible = index === null ? true : index === -1 ? false : Number(m[1]) === index;
    });
    store.pushLogSilent(`[viewport] display focus ${kind} index=${index}`);
  }

  /** Show the displayed node's REAL chain output (transformed geometry) in the
   *  viewport; null hides it. A same-topology buffer (e.g. an Enter-gizmo translate
   *  drag) updates the existing group's positions IN PLACE - no clear, no rebuild;
   *  a topology change falls back to a full rebuild. */
  showNodeResult(buffer: OutputBuffer | null): void {
    if (buffer && this.lastNodeResult && sameTopology(buffer, this.lastNodeResult)) {
      if (updateGroupPositions(this.nodeResultGroup, buffer)) {
        this.nodeResultGroup.visible = true;
        this.lastNodeResult = { ...buffer };
        this.applyDisplayMode();
        return;
      }
    }
    this.nodeResultGroup.clear();
    if (buffer) {
      const g = buildNodeResult(buffer);
      if (g) this.nodeResultGroup.add(g);
      this.nodeResultGroup.visible = true;
    } else {
      this.nodeResultGroup.visible = false;
    }
    this.lastNodeResult = buffer ? { ...buffer } : null;
    this.applyDisplayMode();
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
  pickByNode(kind: "input" | "output" | "null" | "transform", index: number | null): void {
    this.picking.pickByNode(kind, index);
  }

  /** Frame the visible geometry (or reset to default when nothing is shown). */
  frame(): void {
    frameVisible(this.camera, this.controls, [this.inputGroup, this.outputGroup, this.nodeResultGroup]);
  }

  /** Reset to the default camera pose. */
  frameDefault(): void {
    frameDefault(this.camera, this.controls);
  }

  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    this.modeBtn.textContent = MODE_LABELS[mode];
    this.applyDisplayMode();
    store.pushLog(`[viewport] display mode = ${mode}`);
  }

  /** Display settings snapshot for layout JSON persistence. */
  getDisplaySettings(): { mode: DisplayMode } {
    return { mode: this.displayMode };
  }

  /** Restore display settings from a layout JSON blob; ignores unknown/empty shapes. */
  setDisplaySettings(s: { mode?: unknown } | null | undefined): void {
    if (typeof s?.mode === "string" && s.mode in MODE_LABELS && s.mode !== this.displayMode) {
      this.setDisplayMode(s.mode as DisplayMode);
    }
  }

  /** Default 3D viewport background color (Preferences.viewport_bg, #rrggbb). */
  setBackgroundColor(hex: string): void {
    this.scene.background = new THREE.Color(hex);
  }

  /** three.js gizmo demo: G toggles the demo box, Shift+G cycles the gizmo mode. */
  toggleGizmoDemo(): void {
    this.gizmo.toggleGizmoDemo();
  }

  /** Cycle translate -> rotate -> scale on the gizmo demo (no-op while demo is off). */
  cycleGizmoMode(): void {
    this.gizmo.cycleGizmoMode();
  }

  /** Register the "enter node viewport edit" handler (main.ts); null clears it. */
  setEnterEditHandler(fn: (() => void) | null): void {
    this.gizmo.setEnterEditHandler(fn);
  }

  /** True while Enter edit mode is active (gizmo may be idle when no transform is selected). */
  isEnterActive(): boolean {
    return this.gizmo.isEnterActive();
  }

  /** True while the pointer hovers the viewport canvas (Enter-key gating in main.ts). */
  isHovered(): boolean {
    return this.hovered;
  }

  /** Enter edit mode for a transform node: attach the translate gizmo to a temp
   *  object at (tx,ty,tz) and report drags (rounded 4dp) via onChange. The reference
   *  marker sits at the PIVOT (px,py,pz) - dragging the gizmo moves tx/ty/tz only. */
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
  ): void {
    this.gizmo.beginTransformGizmo(nodeId, tx, ty, tz, px, py, pz, onChange, onDragEnd);
  }

  /** Move the pivot reference marker (param-panel px/py/pz edits while Enter is active). */
  setEnterPivot(x: number, y: number, z: number): void {
    this.gizmo.setEnterPivot(x, y, z);
  }

  /** Move the Enter gizmo temp object (tx/ty/tz) - used after param undo/redo so the
   *  gizmo snaps back to the reverted node params. No-op when no gizmo is bound. */
  setEnterPosition(x: number, y: number, z: number): void {
    this.gizmo.setEnterPosition(x, y, z);
  }

  /** Leave Enter edit mode: detach, drop the temp object/marker, restore G demo / curve.
   *  With keepActive the MODE stays on (button lit, isEnterActive() true) and only the
   *  gizmo is dropped - used when the selection has no edit target (null/input/output). */
  endTransformGizmo(opts?: { keepActive?: boolean }): void {
    this.gizmo.endTransformGizmo(opts);
  }

  /** Activate Enter mode WITHOUT a gizmo (e.g. no transform selected): the mode stays
   *  on, the toolbar button stays lit, and the viewport renders normally. False = exit. */
  setEnterActive(active: boolean): void {
    this.gizmo.setEnterActive(active);
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
      if (e.repeat || isTyping()) return;
      const key = e.key.toLowerCase();
      if (key === "escape") {
        // Esc exits Enter mode ONLY while the pointer hovers the viewport; otherwise
        // it is left to the nodeview (connection-cancel etc.).
        if (this.hovered && this.gizmo.isEnterActive()) {
          e.preventDefault();
          this.gizmo.endTransformGizmo();
        }
        return;
      }
      if (key !== "w" && key !== "g") return;
      if (key === "g") {
        e.preventDefault();
        if (e.shiftKey) this.gizmo.cycleGizmoMode();
        else this.gizmo.toggleGizmoDemo();
        return;
      }
      e.preventDefault();
      if (e.shiftKey) {
        // Shift+W: toggle inside the shaded pair you're in; from any other mode, enter the smooth pair.
        if (this.displayMode === "flat-shaded") this.setDisplayMode("flat-wire");
        else if (this.displayMode === "flat-wire") this.setDisplayMode("flat-shaded");
        else if (this.displayMode === "smooth-shaded") this.setDisplayMode("smooth-wire");
        else if (this.displayMode === "smooth-wire") this.setDisplayMode("smooth-shaded");
        else if (this.displayMode === "unlit-shaded") this.setDisplayMode("unlit-wire");
        else if (this.displayMode === "unlit-wire") this.setDisplayMode("unlit-shaded");
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
    for (const g of [this.inputGroup, this.outputGroup, this.referenceGroup, this.nodeResultGroup]) {
      applyDisplayModeToGroup(g, this.displayMode);
    }
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
    this.preRenderFlush?.();
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
    this.toolbar.remove();
    this.renderer.domElement.remove();
  }
}