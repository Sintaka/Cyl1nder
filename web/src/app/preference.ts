import type { UpdateMode } from "../protocol/types";
import type { Layout } from "./layout";

/** Preferences persisted to localStorage ("cyl1nder.prefs") + Preference.json v1.
 *  sync_max_fps caps web->bridge push rate (1..60, default 30); update_mode picks
 *  when Enter-gizmo drags refresh geometry ("auto" | "mouseup"). */
export interface Preferences {
  sync_max_fps: number;
  update_mode: UpdateMode;
}

export const SYNC_FPS_MIN = 1;
export const SYNC_FPS_MAX = 60;
export const SYNC_FPS_DEFAULT = 30;
export const PREFS_STORAGE_KEY = "cyl1nder.prefs";
/** Legacy pre-round-13 key: read once and migrated to cyl1nder.prefs.update_mode. */
export const LEGACY_UPDATE_MODE_KEY = "cyl1nder.updateMode";

export const DEFAULT_PREFS: Preferences = {
  sync_max_fps: SYNC_FPS_DEFAULT,
  update_mode: "auto",
};

/** Clamp + int-ify a sync fps value into 1..60 (invalid -> default 30). */
export function clampSyncFps(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return SYNC_FPS_DEFAULT;
  return Math.min(SYNC_FPS_MAX, Math.max(SYNC_FPS_MIN, Math.round(n)));
}

function parseUpdateMode(value: unknown): UpdateMode {
  return value === "mouseup" ? "mouseup" : value === "auto" ? "auto" : DEFAULT_PREFS.update_mode;
}

/** Read preferences from localStorage (JSON "cyl1nder.prefs"); falls back to
 *  defaults, migrating the legacy "cyl1nder.updateMode" key on first read. */
export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Preferences>;
      return {
        sync_max_fps: clampSyncFps(p.sync_max_fps),
        update_mode: parseUpdateMode(p.update_mode),
      };
    }
  } catch {
    /* corrupt JSON -> fall through to defaults / migration */
  }
  const legacy = localStorage.getItem(LEGACY_UPDATE_MODE_KEY);
  if (legacy === "auto" || legacy === "mouseup") {
    return { sync_max_fps: SYNC_FPS_DEFAULT, update_mode: legacy };
  }
  return { ...DEFAULT_PREFS };
}

/** Persist preferences to localStorage (drops the legacy key once migrated). */
export function savePreferences(prefs: Preferences): void {
  localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  localStorage.removeItem(LEGACY_UPDATE_MODE_KEY);
}

/** Sync the bottom bar controls (#cyl-sync-fps value + #cyl-update-mode selection). */
export function applyPreferences(prefs: Preferences, layout: Layout): void {
  layout.syncFpsInput.value = String(prefs.sync_max_fps);
  layout.updateModeSelect.value = prefs.update_mode;
}

/** Dark modal preference dialog (overlay + card, reuses the app's dark palette).
 *  Cancel / overlay click / Escape closes without saving; Save calls onSave(prefs). */
export function openPreferenceDialog(current: Preferences, onSave: (prefs: Preferences) => void): void {
  const overlay = document.createElement("div");
  overlay.className = "cyl-pref-overlay";
  overlay.innerHTML = `
    <div class="cyl-pref-card" role="dialog" aria-modal="true" aria-label="Preference">
      <h2>Preference</h2>
      <div class="cyl-pref-row">
        <label for="cyl-pref-fps">Sync Max FPS</label>
        <input type="number" id="cyl-pref-fps" class="cyl-pref-fps" min="${SYNC_FPS_MIN}" max="${SYNC_FPS_MAX}" value="${current.sync_max_fps}" />
      </div>
      <div class="cyl-pref-row">
        <label for="cyl-pref-mode">Update Mode</label>
        <select id="cyl-pref-mode" class="cyl-pref-mode">
          <option value="auto"${current.update_mode === "auto" ? " selected" : ""}>Auto Update</option>
          <option value="mouseup"${current.update_mode === "mouseup" ? " selected" : ""}>On Mouse Up</option>
        </select>
      </div>
      <div class="cyl-pref-actions">
        <button type="button" class="cyl-pref-cancel">Cancel</button>
        <button type="button" class="cyl-pref-save">Save</button>
      </div>
    </div>`;
  let onKey: (e: KeyboardEvent) => void;
  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  overlay.querySelector<HTMLButtonElement>(".cyl-pref-cancel")!.addEventListener("click", close);
  overlay.querySelector<HTMLButtonElement>(".cyl-pref-save")!.addEventListener("click", () => {
    const fpsInput = overlay.querySelector<HTMLInputElement>("#cyl-pref-fps")!;
    const modeSelect = overlay.querySelector<HTMLSelectElement>("#cyl-pref-mode")!;
    const prefs: Preferences = {
      sync_max_fps: clampSyncFps(fpsInput.value),
      update_mode: parseUpdateMode(modeSelect.value),
    };
    close();
    onSave(prefs);
  });
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  overlay.querySelector<HTMLInputElement>("#cyl-pref-fps")?.focus();
}
