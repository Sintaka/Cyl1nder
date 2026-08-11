import { describe, expect, it, vi } from "vitest";
import { createUndoManager, type UndoAction } from "../src/nodes2/undo";

const cut = (target: string): UndoAction => ({
  type: "cut",
  connection: { source: "A", sourceOutput: "out0", target, targetInput: "in0" },
});

describe("createUndoManager", () => {
  it("push enables undo but not redo", () => {
    const mgr = createUndoManager(vi.fn());
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(false);
    mgr.push(cut("B"));
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(false);
  });

  it("undo pops in LIFO order and passes correct direction", () => {
    const apply = vi.fn();
    const mgr = createUndoManager(apply);
    mgr.push(cut("B"));
    mgr.push(cut("C"));
    mgr.undo();
    mgr.undo();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(1, cut("C"), "undo");
    expect(apply).toHaveBeenNthCalledWith(2, cut("B"), "undo");
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(true);
  });

  it("push after undo clears the redo stack", () => {
    const apply = vi.fn();
    const mgr = createUndoManager(apply);
    mgr.push(cut("B"));
    mgr.push(cut("C"));
    mgr.undo();
    expect(mgr.canRedo()).toBe(true);
    mgr.push(cut("D"));
    expect(mgr.canRedo()).toBe(false);
    // old branch is gone: redo no longer replays the undone C
    mgr.redo();
    expect(apply).not.toHaveBeenCalledWith(cut("C"), "redo");
  });

  it("redo replays the action and restores undo state", () => {
    const apply = vi.fn();
    const mgr = createUndoManager(apply);
    mgr.push(cut("B"));
    mgr.push(cut("C"));
    mgr.undo(); // C -> redo
    mgr.undo(); // B -> redo
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(true);
    mgr.redo(); // B replayed
    expect(apply).toHaveBeenLastCalledWith(cut("B"), "redo");
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(true);
    mgr.redo(); // C replayed
    expect(apply).toHaveBeenLastCalledWith(cut("C"), "redo");
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(false);
  });

  it("limit drops the oldest entries (limit=2)", () => {
    const apply = vi.fn();
    const mgr = createUndoManager(apply, 2);
    mgr.push(cut("B"));
    mgr.push(cut("C"));
    mgr.push(cut("D"));
    mgr.undo(); // D
    mgr.undo(); // C
    expect(mgr.canUndo()).toBe(false);
    // B was evicted — no third undo
    mgr.undo();
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("undo/redo are no-ops when their stacks are empty", () => {
    const apply = vi.fn();
    const mgr = createUndoManager(apply);
    mgr.undo();
    mgr.redo();
    expect(apply).not.toHaveBeenCalled();
  });

  it("clear empties both stacks", () => {
    const apply = vi.fn();
    const mgr = createUndoManager(apply);
    mgr.push(cut("B"));
    mgr.undo();
    expect(mgr.canRedo()).toBe(true);
    mgr.clear();
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(false);
    mgr.undo();
    mgr.redo();
    expect(apply).toHaveBeenCalledTimes(1); // only the earlier undo
  });

  it("onStateChange fires on push/undo/redo/clear and unsubscribing stops it", () => {
    const mgr = createUndoManager(vi.fn());
    const cb = vi.fn();
    const unsubscribe = mgr.onStateChange(cb);
    mgr.push(cut("B"));
    mgr.undo();
    mgr.redo();
    mgr.clear();
    expect(cb).toHaveBeenCalledTimes(4);
    unsubscribe();
    mgr.push(cut("C"));
    expect(cb).toHaveBeenCalledTimes(4);
  });

  it("default limit is 100 and keeps only the most recent entries", () => {
    const apply = vi.fn();
    const mgr = createUndoManager(apply);
    for (let i = 0; i < 105; i++) mgr.push(cut(`n${i}`));
    for (let i = 0; i < 100; i++) mgr.undo();
    expect(apply).toHaveBeenCalledTimes(100);
    expect(mgr.canUndo()).toBe(false);
  });
});
