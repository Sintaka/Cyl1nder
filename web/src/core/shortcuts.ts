export interface ShortcutsDeps {
  frameGraph(): void;
  frameViewport(): void;
  toggleDebug(): void;
  toggleEnter(): void;
  quickSave(): void;
  saveAs(): void;
  isGraphHovered(): boolean;
  isEnterHovered(): boolean;
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
  // B = toggle debug reference boxes.
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "b" || e.repeat) return;
    if (isEditable(document.activeElement)) return;
    deps.toggleDebug();
  });
  // Enter = viewport edit activation (same as the toolbar icon).
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.repeat) return;
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
