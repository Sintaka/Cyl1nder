import { cloneParams, paramsEqual, readParamFloats, type ParamLike } from "./params";

export type GizmoUpdateMode = "auto" | "mouseup";

export interface GizmoNode {
  id: string;
  kind: string;
  params?: ParamLike[];
}

export interface GizmoViewport {
  isEnterActive(): boolean;
  setEnterActive(active: boolean): void;
  beginTransformGizmo(
    id: string,
    tx: number,
    ty: number,
    tz: number,
    px: number,
    py: number,
    pz: number,
    onChange: (x: number, y: number, z: number) => void,
    onEnd: () => void,
  ): void;
  endTransformGizmo(opts?: { keepActive?: boolean }): void;
  setEnterPosition(x: number, y: number, z: number): void;
  /** Local drag-preview: nudge the visible geometry group by (dx,dy,dz) so it follows
   *  the gizmo on the SAME frame without a rebuild. Cleared by endDragPreview(). */
  updateDragPreview(dx: number, dy: number, dz: number): void;
  /** Clear any in-flight drag preview offset (idempotent). */
  endDragPreview(): void;
}

export interface GizmoGraph {
  getSelectedNode(): GizmoNode | null;
  getNetworkSnapshot(): { nodes: GizmoNode[] };
  setNodeParams(id: string, params: ParamLike[]): void;
  pushUndo(entry: { type: "params"; nodeId: string; before: ParamLike[]; after: ParamLike[] }): void;
}

export interface GizmoDeps {
  viewport: GizmoViewport;
  graph: GizmoGraph;
  runNetwork(): void;
  log(msg: string): void;
  getUpdateMode(): GizmoUpdateMode;
}

/** Enter-gizmo controller: owns the drag session state (pendingTransform +
 *  drag undo before/after + last bound transform) and the viewport/graph glue.
 *  main.ts only wires toggle / bindToSelection / onParamsApplied. */
export function createGizmoController(deps: GizmoDeps): {
  toggle(): void;
  bindToSelection(): void;
  onParamsApplied(nodeId: string, params: ParamLike[]): void;
} {
  let pendingTransform: { id: string; tx: number; ty: number; tz: number } | null = null;
  let dragNodeId: string | null = null;
  let dragBefore: ParamLike[] | null = null;
  let dragAfter: ParamLike[] | null = null;
  let lastTransformId: string | null = null;
  let dragStart: { tx: number; ty: number; tz: number } | null = null;
  let lastCommitted: { tx: number; ty: number; tz: number } | null = null;

  /** setNodeParams + runNetwork for a gizmo translate value (both update modes). */
  const applyTransformDrag = (id: string, x: number, y: number, z: number): void => {
    const node = deps.graph.getNetworkSnapshot().nodes.find((n) => n.id === id);
    if (!node) return; // node deleted mid-edit
    const next = (node.params ?? []).map((q) =>
      q.name === "tx" ? { ...q, value: x } : q.name === "ty" ? { ...q, value: y } : q.name === "tz" ? { ...q, value: z } : q,
    );
    deps.graph.setNodeParams(id, next);
    if (dragNodeId === id) dragAfter = cloneParams(next);
    void deps.runNetwork();
  };

  /** Attach the translate gizmo to a transform node (bound at its tx/ty/tz). */
  const bindToTransform = (node: GizmoNode): void => {
    const v = readParamFloats(node.params ?? []);
    pendingTransform = null; // a stale buffered drag must never commit to a re-bound gizmo
    dragNodeId = node.id;
    dragBefore = cloneParams(node.params ?? []);
    dragAfter = null;
    dragStart = { tx: v.tx ?? 0, ty: v.ty ?? 0, tz: v.tz ?? 0 };
    lastCommitted = { ...dragStart };
    deps.viewport.beginTransformGizmo(
      node.id,
      v.tx ?? 0,
      v.ty ?? 0,
      v.tz ?? 0,
      v.px ?? 0,
      v.py ?? 0,
      v.pz ?? 0,
      (x, y, z) => {
        // Delta from the last committed value: the preview offset points the currently
        // displayed geometry at the gizmo position (committed + delta = current), so
        // the rebuilt geometry never double-stacks with a stale offset.
        const dx = x - (lastCommitted?.tx ?? 0);
        const dy = y - (lastCommitted?.ty ?? 0);
        const dz = z - (lastCommitted?.tz ?? 0);
        if (deps.getUpdateMode() === "mouseup") {
          // On Mouse Up: buffer only the latest value - zero network + zero rebuild during
          // the drag; the local preview still makes the geometry follow the gizmo live.
          pendingTransform = { id: node.id, tx: x, ty: y, tz: z };
          deps.viewport.updateDragPreview(dx, dy, dz);
          return;
        }
        applyTransformDrag(node.id, x, y, z);
        lastCommitted = { tx: x, ty: y, tz: z };
        deps.viewport.updateDragPreview(dx, dy, dz);
      },
      () => {
        // drag ended: clear the preview offset first (the committed rebuild takes over),
        // then mouseup commits the single buffered value once; BOTH modes close the drag
        // session as ONE undo entry (one drag = one undo step).
        deps.viewport.endDragPreview();
        if (deps.getUpdateMode() === "mouseup" && pendingTransform) {
          const p = pendingTransform;
          pendingTransform = null;
          applyTransformDrag(p.id, p.tx, p.ty, p.tz);
          lastCommitted = { tx: p.tx, ty: p.ty, tz: p.tz }; // keep later drag deltas honest
        }
        if (dragNodeId && dragBefore && dragAfter && !paramsEqual(dragBefore, dragAfter)) {
          deps.graph.pushUndo({ type: "params", nodeId: dragNodeId, before: dragBefore, after: dragAfter });
        }
        dragNodeId = null;
        dragBefore = null;
        dragAfter = null;
      },
    );
  };

  /** Bind the Enter gizmo to the selection (or the last transform when idle). */
  const bindToSelection = (): void => {
    const sel = deps.graph.getSelectedNode();
    if (sel && sel.kind === "transform") {
      lastTransformId = sel.id;
      bindToTransform(sel);
      return;
    }
    if (lastTransformId) {
      const node = deps.graph.getNetworkSnapshot().nodes.find((n) => n.id === lastTransformId && n.kind === "transform");
      if (node) {
        bindToTransform(node);
        return;
      }
    }
    deps.viewport.endTransformGizmo({ keepActive: true });
  };

  /** Enter node viewport edit activation (toolbar icon + Enter key). */
  const toggle = (): void => {
    if (deps.viewport.isEnterActive()) {
      lastTransformId = null;
      deps.viewport.endTransformGizmo();
      return;
    }
    const sel = deps.graph.getSelectedNode();
    if (!sel || sel.kind !== "transform") {
      deps.viewport.setEnterActive(true); // enter mode on, gizmo idle until a transform is selected
      deps.log("[viewport] enter: no transform selected - gizmo idle");
      return;
    }
    bindToSelection();
  };

  /** param undo/redo applied -> snap the Enter gizmo back to the reverted node. */
  const onParamsApplied = (nodeId: string, params: ParamLike[]): void => {
    if (deps.viewport.isEnterActive() && nodeId === lastTransformId) {
      const v = readParamFloats(params);
      deps.viewport.setEnterPosition(v.tx ?? 0, v.ty ?? 0, v.tz ?? 0);
      lastCommitted = { tx: v.tx ?? 0, ty: v.ty ?? 0, tz: v.tz ?? 0 }; // preview deltas stay honest after undo/redo
    }
  };

  return { toggle, bindToSelection, onParamsApplied };
}