export interface ShortcutsDeps {
  frameGraph(): void;
  frameViewport(): void;
  toggleDebug(): void;
  toggleEnter(): void;
  quickSave(): void;
  saveAs(): void;
  isGraphHovered(): boolean;
  isEnterHovered(): boolean;
  /** Toggle bypass on the currently-selected connection (returns true when it
   *  consumed the key). B falls back to toggleDebug when this is absent/returns false. */
  tryWireBypass?(): boolean;
}

const isEditable = (el: Element | null): boolean =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

export function bindShortcuts(deps: ShortcutsDeps): void {
  // F = frame: graph -> frame selection, viewport -> frame geometry.
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "f" || e.repeat) return;
    if (isEditable(document.activeElement)) return;
    e.preventDefault();
    if (deps.isGraphHovered()) deps.frameGraph();
    else deps.frameViewport();
  });
  // B = toggle bypass on the selected connection (wire), else debug reference boxes.
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "b" || e.repeat) return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return; // bare B only
    if (isEditable(document.activeElement)) return;
    if (deps.tryWireBypass?.()) {
      e.preventDefault();
      return;
    }
    deps.toggleDebug();
  });
  // Enter = viewport edit activation (same as the toolbar icon).
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.repeat) return;
    // Shift+Enter 是**另一个手势**（图里的 `_input_` -> `_output_` 镜像连线，见
    // nodes2/graph-interact.ts 的 attachShiftEnterWire），不是视口枢轴。在按键层面就
    // 分开、而不是靠"谁先注册 / 谁 stopPropagation"：两个监听器都挂在 window 上，
    // 顺序是建图与绑快捷键的先后运气，靠它必然在某次重构里翻车。
    if (e.shiftKey) return;
    const el = document.activeElement;
    if (isEditable(el)) return;
    if (el instanceof HTMLButtonElement) return;
    if (!deps.isEnterHovered()) return;
    e.preventDefault();
    deps.toggleEnter();
  });
  // Ctrl/Cmd+S = quick save; Ctrl/Cmd+Alt+S = Save Scene As.
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
    e.preventDefault();
    if (e.altKey) {
      deps.saveAs();
      return;
    }
    deps.quickSave();
  });
}
