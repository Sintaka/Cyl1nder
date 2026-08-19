/**
 * Graph undo layer (2.2 split): topology replay (applyUndoAction) + the chained
 * graph undo manager wiring (notifyParamsApplied / undoChain). Reuses the pure
 * stack state machine in ./undo.
 */
import { ClassicPreset, NodeEditor } from "rete";
import { AreaPlugin } from "rete-area-plugin";
import { notifyNodeChanged } from "./NodeView";
import { createUndoManager, type ConnectionRef, type UndoAction, type UndoManager } from "./undo";
import { CylNode, log } from "./graph-model";
import type { AreaExtra, ReteGraphHandlers, Schemes } from "./graph-model";

/** Does an action contain a params edit (recursively through group children)?
 *  Group undo/redo refreshes the network once at the end when a child is a params
 *  edit, instead of re-running per sub-action. */
export function actionContainsParams(action: UndoAction): boolean {
  if (action.type === "params") return true;
  if (action.type === "group") return action.actions.some(actionContainsParams);
  return false;
}

/** Find a live connection matching a ConnectionRef (stable across add/remove cycles). */
function findConnectionByRef(editor: NodeEditor<Schemes>, ref: ConnectionRef): { id: string } | undefined {
  return editor.getConnections().find(
    (c) =>
      c.source === ref.source &&
      c.sourceOutput === ref.sourceOutput &&
      c.target === ref.target &&
      c.targetInput === ref.targetInput,
  );
}

/** Replay/reverse a recorded topology edit for undo/redo (ref-based, id-stable). */
export async function applyUndoAction(
  editor: NodeEditor<Schemes>,
  action: UndoAction,
  direction: "undo" | "redo",
  area?: AreaPlugin<Schemes, AreaExtra>,
): Promise<void> {
  const addConn = async (ref: ConnectionRef) => {
    const src = editor.getNode(ref.source) as CylNode | undefined;
    const tgt = editor.getNode(ref.target) as CylNode | undefined;
    if (!src || !tgt || src.id === tgt.id) return;
    await editor.addConnection(
      new ClassicPreset.Connection(src, ref.sourceOutput, tgt, ref.targetInput) as unknown as Schemes["Connection"],
    );
  };
  const delConn = async (ref: ConnectionRef) => {
    const c = findConnectionByRef(editor, ref);
    if (c) await editor.removeConnection(c.id);
  };
  const lbl = (ref: ConnectionRef) => {
    const s = (editor.getNode(ref.source) as CylNode | undefined)?.label ?? ref.source;
    const t = (editor.getNode(ref.target) as CylNode | undefined)?.label ?? ref.target;
    return `${s} -> ${t}`;
  };
  if (action.type === "cut") {
    if (direction === "undo") await addConn(action.connection);
    else await delConn(action.connection);
    log(`${direction} cut connection ${lbl(action.connection)}`);
  } else if (action.type === "insert") {
    const a2n: ConnectionRef = {
      source: action.connection.source,
      sourceOutput: action.connection.sourceOutput,
      target: action.nodeId,
      targetInput: "in0",
    };
    const n2b: ConnectionRef = {
      source: action.nodeId,
      sourceOutput: "out0",
      target: action.connection.target,
      targetInput: action.connection.targetInput,
    };
    if (direction === "undo") {
      await delConn(a2n);
      await delConn(n2b);
      await addConn(action.connection);
      if (action.prevConnection) await addConn(action.prevConnection);
    } else {
      await delConn(action.connection);
      if (action.prevConnection) await delConn(action.prevConnection);
      await addConn(a2n);
      await addConn(n2b);
    }
    log(`${direction} insert ${action.nodeLabel} into ${lbl(action.connection)}`);
  } else if (action.type === "cut-many") {
    if (direction === "undo") {
      for (const ref of action.connections) await addConn(ref);
    } else {
      for (const ref of action.connections) await delConn(ref);
    }
    log(`${direction} cut ${action.connections.length} connection(s) via polyline`);
  } else if (action.type === "reconnect") {
    if (direction === "undo") {
      await delConn(action.after);
      if (action.prevConnection) await addConn(action.prevConnection);
      await addConn(action.before);
    } else {
      await delConn(action.before);
      if (action.prevConnection) await delConn(action.prevConnection);
      await addConn(action.after);
    }
    log(`${direction} reconnect ${lbl(action.before)} -> ${lbl(action.after)}`);
  } else if (action.type === "params") {
    const n = editor.getNode(action.nodeId) as CylNode | undefined;
    if (n) {
      n.params = direction === "undo" ? action.before : action.after;
      notifyNodeChanged();
    }
    log(`${direction} params on ${n ? n.label : action.nodeId}`);
  } else if (action.type === "group") {
    // Batch: undo applies children in REVERSE order, redo in FORWARD order.
    // Nested groups recurse; params children notify the caller once at the end
    // via the createUndoManager apply wrapper (actionContainsParams).
    const ordered = direction === "undo" ? [...action.actions].reverse() : action.actions;
    for (const sub of ordered) await applyUndoAction(editor, sub, direction, area);
    log(`${direction} group (${action.actions.length} actions)`);
  } else if (action.type === "shake") {
    if (direction === "undo") {
      for (const ref of action.added) await delConn(ref);
      for (const ref of action.cut) await addConn(ref);
    } else {
      for (const ref of action.cut) await delConn(ref);
      for (const ref of action.added) await addConn(ref);
    }
    log(`${direction} shake (${action.cut.length} cut / ${action.added.length} added)`);
  }
}

export function createGraphUndoManager(
  editor: NodeEditor<Schemes>,
  handlers: ReteGraphHandlers,
  area?: AreaPlugin<Schemes, AreaExtra>,
): UndoManager {
  // param undo/redo applied -> notify the affected node(s) so the caller can
  // refresh the Enter gizmo position + panels (params AFTER the mutation).
  const notifyParamsApplied = (action: UndoAction): void => {
    if (action.type === "params") {
      const n = editor.getNode(action.nodeId);
      if (n) handlers.onParamsApplied?.(action.nodeId, (n as any).params);
    } else if (action.type === "group") {
      for (const sub of action.actions) notifyParamsApplied(sub);
    }
  };

  // Undo/redo stack for topology edits (cut / insert / shake); apply is chained so
  // rapid Ctrl+Z/Y cannot interleave the async rete connection mutations.
  let undoChain: Promise<void> = Promise.resolve();
  return createUndoManager((action, direction) => {
    undoChain = undoChain
      .then(() => applyUndoAction(editor, action, direction, area))
      .then(() => {
        if (actionContainsParams(action)) {
          // param undo/redo re-runs the network and refreshes the panels; a group
          // fires both ONCE at the end (no per-sub-action repeats)
          handlers.onNetworkChanged?.();
          handlers.onSelectionChanged?.();
          notifyParamsApplied(action);
        }
      })
      .catch(() => undefined);
  }, 100);
}