/**
 * Undo/redo manager for the node graph (pure stack logic, DOM-free, testable).
 * graph.ts owns the actual editor mutations via the apply callback.
 *
 * v1 covers graph-topology operations: cut connection, insert node into a
 * connection, shake-disconnect. Node moves / node add-remove are future work.
 */
export interface ConnectionRef {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

export type UndoAction =
  | { type: "cut"; connection: ConnectionRef }
  | { type: "cut-many"; connections: ConnectionRef[] }
  | {
      type: "insert";
      nodeId: string;
      nodeLabel: string;
      /** the original connection that was split (A->B) */
      connection: ConnectionRef;
      /** existing connection into the inserted node's in0 that was dropped (if any) */
      prevConnection: ConnectionRef | null;
    }
  | { type: "shake"; cut: ConnectionRef[]; added: ConnectionRef[] };

export interface UndoManager {
  push(action: UndoAction): void;
  /** pops undo stack, invokes apply(action, "undo"), pushes onto redo stack */
  undo(): void;
  /** pops redo stack, invokes apply(action, "redo"), pushes onto undo stack */
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
  /** subscribe to stack-state changes (for UI/log); returns unsubscribe */
  onStateChange(cb: () => void): () => void;
}

/**
 * createUndoManager(apply, limit?)
 * - apply: performs the editor mutation for a direction. undo = reverse the
 *   action; redo = replay it.
 * - limit: max undo entries (default 100); oldest entries drop first.
 * - push() clears the redo stack (new branch after undo).
 */
export function createUndoManager(
  apply: (action: UndoAction, direction: "undo" | "redo") => void,
  limit?: number,
): UndoManager {
  const max = limit ?? 100;
  const undoStack: UndoAction[] = [];
  const redoStack: UndoAction[] = [];
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const cb of listeners) cb();
  };

  return {
    push(action: UndoAction): void {
      undoStack.push(action);
      if (undoStack.length > max) undoStack.shift();
      redoStack.length = 0; // new branch: discard the previous redo history
      notify();
    },

    undo(): void {
      const action = undoStack.pop();
      if (!action) return;
      apply(action, "undo");
      redoStack.push(action);
      notify();
    },

    redo(): void {
      const action = redoStack.pop();
      if (!action) return;
      apply(action, "redo");
      undoStack.push(action);
      notify();
    },

    canUndo(): boolean {
      return undoStack.length > 0;
    },

    canRedo(): boolean {
      return redoStack.length > 0;
    },

    clear(): void {
      undoStack.length = 0;
      redoStack.length = 0;
      notify();
    },

    onStateChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
