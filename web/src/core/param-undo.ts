import type { ParamLike } from "./params";

export interface ParamUndoDeps {
  pushUndo(entry: { type: "params"; nodeId: string; before: ParamLike[]; after: ParamLike[] }): void;
}

/** Session-scoped param edit undo: consecutive edits on the SAME node within
 *  600ms merge into one { type: "params" } undo entry (before = pre-session
 *  params, after = latest). flush() commits the pending session early. */
export function createParamUndo(deps: ParamUndoDeps): {
  startOrMerge(nodeId: string, before: ParamLike[], after: ParamLike[]): void;
  flush(): void;
} {
  let pending: { nodeId: string; before: ParamLike[]; after: ParamLike[]; timer: number } | null = null;

  const flush = (): void => {
    if (!pending) return;
    const p = pending;
    pending = null;
    if (p.timer) window.clearTimeout(p.timer);
    deps.pushUndo({ type: "params", nodeId: p.nodeId, before: p.before, after: p.after });
  };

  const startOrMerge = (nodeId: string, before: ParamLike[], after: ParamLike[]): void => {
    if (!pending || pending.nodeId !== nodeId) pending = { nodeId, before, after, timer: 0 };
    else pending.after = after;
    if (pending.timer) window.clearTimeout(pending.timer);
    pending.timer = window.setTimeout(flush, 600);
  };

  return { startOrMerge, flush };
}
