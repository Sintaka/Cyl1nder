import type { UpdateMode } from "../protocol/types";
import type { Layout } from "./layout";
import { hexToRgb, openColorPicker } from "./color";

/** Preferences persisted to localStorage ("cyl1nder.prefs") + Preference.json v1.
 *  sync_max_fps caps the kick bridge (receive/forward + HDA recook, 1..60, default
 *  30) - Auto Update web pushes are NOT rate-limited; update_mode picks when
 *  Enter-gizmo drags refresh geometry ("auto" | "mouseup"); autosave_* drive the
 *  timed auto-save (default 5 min, toggleable); viewport_bg is the 3D viewport
 *  default background color (#rrggbb). */
export interface Preferences {
  sync_max_fps: number;
  update_mode: UpdateMode;
  autosave_enabled: boolean;
  autosave_interval_min: number;
  viewport_bg: string;
}

export const SYNC_FPS_MIN = 1;
export const SYNC_FPS_MAX = 60;
export const SYNC_FPS_DEFAULT = 30;
export const PREFS_STORAGE_KEY = "cyl1nder.prefs";
/** Legacy pre-round-13 key: read once and migrated to cyl1nder.prefs.update_mode. */
export const LEGACY_UPDATE_MODE_KEY = "cyl1nder.updateMode";
/** Auto-save interval floor in minutes (decimals allowed, e.g. 0.1 for e2e). */
export const AUTOSAVE_INTERVAL_MIN = 0.1;
export const AUTOSAVE_INTERVAL_DEFAULT = 5;
export const VIEWPORT_BG_DEFAULT = "#1A1A1A";

export const DEFAULT_PREFS: Preferences = {
  sync_max_fps: SYNC_FPS_DEFAULT,
  update_mode: "auto",
  autosave_enabled: true,
  autosave_interval_min: AUTOSAVE_INTERVAL_DEFAULT,
  viewport_bg: VIEWPORT_BG_DEFAULT,
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

/** Auto-save interval in minutes: invalid -> default 5; sub-0.1 clamped to the 0.1 floor. */
function parseAutosaveInterval(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return AUTOSAVE_INTERVAL_DEFAULT; // empty/zero -> 5min
  return Math.max(AUTOSAVE_INTERVAL_MIN, n); // tiny positive clamps to the 0.1min floor
}

/** Hex #rrggbb (case-insensitive) or the default viewport background. */
function parseViewportBg(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : VIEWPORT_BG_DEFAULT;
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
        autosave_enabled: p.autosave_enabled !== false,
        autosave_interval_min: parseAutosaveInterval(p.autosave_interval_min),
        viewport_bg: parseViewportBg(p.viewport_bg),
      };
    }
  } catch {
    /* corrupt JSON -> fall through to defaults / migration */
  }
  const legacy = localStorage.getItem(LEGACY_UPDATE_MODE_KEY);
  if (legacy === "auto" || legacy === "mouseup") {
    return { ...DEFAULT_PREFS, update_mode: legacy };
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

// Viewport background color picker (Agent C's color.ts) - see contract §2.3.
// Clicking the swatch opens openColorPicker; hexToRgb seeds its initial color.


/** Non-modal floating preference panel (no fullscreen overlay, the app behind
 *  stays interactive). Tabs: General (Sync Max FPS / Update Mode / Auto Save)
 *  and Viewport (default background color). Drag the header to move the panel.
 *  Cancel / ✕ / Escape close without saving; Apply calls onSave and stays open;
 *  Accept calls onSave then closes. */
export function openPreferenceDialog(current: Preferences, onSave: (prefs: Preferences) => void): void {
  const initial = {
    sync_max_fps: clampSyncFps(current.sync_max_fps),
    update_mode: parseUpdateMode(current.update_mode),
    autosave_enabled: current.autosave_enabled !== false,
    autosave_interval_min: parseAutosaveInterval(current.autosave_interval_min),
    viewport_bg: parseViewportBg(current.viewport_bg),
  };

  const panel = document.createElement("div");
  panel.className = "cyl-pref-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-label", "Preference");
  panel.innerHTML = `
    <div class="cyl-pref-header">
      <span class="cyl-pref-title">Preference</span>
      <button type="button" class="cyl-pref-close" aria-label="Close" title="Close">✕</button>
    </div>
    <div class="cyl-pref-tabs" role="tablist">
      <button type="button" class="cyl-pref-tab is-active" data-pref-tab="general" role="tab" aria-selected="true">General</button>
      <button type="button" class="cyl-pref-tab" data-pref-tab="viewport" role="tab" aria-selected="false">Viewport</button>
    </div>
    <div class="cyl-pref-body">
      <section class="cyl-pref-section is-active" data-pref-pane="general">
        <div class="cyl-pref-row">
          <label for="cyl-pref-fps">Sync Max FPS</label>
          <input type="number" id="cyl-pref-fps" class="cyl-pref-fps" min="${SYNC_FPS_MIN}" max="${SYNC_FPS_MAX}" step="1" value="${initial.sync_max_fps}" />
        </div>
        <div class="cyl-pref-row">
          <label for="cyl-pref-mode">Update Mode</label>
          <select id="cyl-pref-mode" class="cyl-pref-mode">
            <option value="auto"${initial.update_mode === "auto" ? " selected" : ""}>Auto Update</option>
            <option value="mouseup"${initial.update_mode === "mouseup" ? " selected" : ""}>On Mouse Up</option>
          </select>
        </div>
        <div class="cyl-pref-sep"></div>
        <div class="cyl-pref-autosave">
          <div class="cyl-pref-autosave-head">
            <label for="cyl-pref-autosave">Auto Save</label>
            <input type="checkbox" id="cyl-pref-autosave"${initial.autosave_enabled ? " checked" : ""} />
          </div>
          <div class="cyl-pref-row">
            <label for="cyl-pref-autosave-interval">Interval (minutes)</label>
            <input type="number" id="cyl-pref-autosave-interval" min="${AUTOSAVE_INTERVAL_MIN}" step="0.1" value="${initial.autosave_interval_min}" />
          </div>
        </div>
      </section>
      <section class="cyl-pref-section" data-pref-pane="viewport" hidden>
        <div class="cyl-pref-row cyl-pref-viewport">
          <label>Default Background Color</label>
          <div class="cyl-pref-color">
            <span class="cyl-pref-swatch" id="cyl-pref-bg-swatch" style="background:${initial.viewport_bg}" role="button" tabindex="0" title="Click to change color" aria-label="Change default background color"></span>
            <span class="cyl-pref-hex" id="cyl-pref-bg-hex">${initial.viewport_bg}</span>
          </div>
        </div>
      </section>
    </div>
    <div class="cyl-pref-actions">
      <button type="button" class="cyl-pref-cancel">Cancel</button>
      <button type="button" class="cyl-pref-apply">Apply</button>
      <button type="button" class="cyl-pref-save">Accept</button>
    </div>`;

  // Drag the panel by its title bar: position:fixed follows the pointer, release
  // drops it in place; text selection is suppressed during the drag and the ✕
  // close button never starts one.
  const headerEl = panel.querySelector<HTMLElement>(".cyl-pref-header")!;
  headerEl.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".cyl-pref-close")) return;
    e.preventDefault(); // stop text-selection / native drag while moving
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    const offX = startX - rect.left;
    const offY = startY - rect.top;
    const onMove = (ev: PointerEvent): void => {
      panel.style.left = `${Math.max(0, ev.clientX - offX)}px`;
      panel.style.top = `${Math.max(0, ev.clientY - offY)}px`;
      panel.style.right = "auto";
    };
    const onUp = (): void => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  const fpsInput = panel.querySelector<HTMLInputElement>("#cyl-pref-fps")!;
  const modeSelect = panel.querySelector<HTMLSelectElement>("#cyl-pref-mode")!;
  const autosaveCheck = panel.querySelector<HTMLInputElement>("#cyl-pref-autosave")!;
  const intervalInput = panel.querySelector<HTMLInputElement>("#cyl-pref-autosave-interval")!;
  const swatch = panel.querySelector<HTMLSpanElement>("#cyl-pref-bg-swatch")!;
  const hexEl = panel.querySelector<HTMLSpanElement>("#cyl-pref-bg-hex")!;
  let viewportBg = initial.viewport_bg;

  const renderViewportBg = (hex: string): void => {
    viewportBg = parseViewportBg(hex);
    swatch.style.background = viewportBg;
    hexEl.textContent = viewportBg;
  };

  /** Validate + read the panel into a Preferences object (null when invalid). */
  const collect = (): Preferences | null => {
    const interval = Number(intervalInput.value);
    if (!Number.isFinite(interval) || interval < AUTOSAVE_INTERVAL_MIN) return null;
    return {
      sync_max_fps: clampSyncFps(fpsInput.value),
      update_mode: parseUpdateMode(modeSelect.value),
      autosave_enabled: autosaveCheck.checked,
      autosave_interval_min: Math.round(interval * 10) / 10,
      viewport_bg: viewportBg,
    };
  };

  // tab switching (General / Viewport)
  const tabs = panel.querySelectorAll<HTMLButtonElement>(".cyl-pref-tab");
  const panes = panel.querySelectorAll<HTMLElement>(".cyl-pref-section");
  const activateTab = (name: string): void => {
    tabs.forEach((tab) => {
      const active = tab.dataset.prefTab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    panes.forEach((pane) => {
      const active = pane.dataset.prefPane === name;
      pane.classList.toggle("is-active", active);
      pane.hidden = !active;
    });
  };
  tabs.forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.prefTab ?? "general")));

  // Viewport tab: clicking the swatch opens the shared color picker (Agent C);
  // the Change… button was removed (0.1.00061) - the swatch IS the control.
  // cursor:pointer is set inline (base.css belongs to Agent A).
  const openBgPicker = (): void => {
    openColorPicker({
      initial: hexToRgb(viewportBg) ?? { r: 26, g: 26, b: 26 },
      onColor: (_rgb, hex) => renderViewportBg(hex),
      title: "Viewport Background",
    });
  };
  swatch.style.cursor = "pointer";
  swatch.addEventListener("click", openBgPicker);
  swatch.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openBgPicker();
    }
  });

  let onKey: (e: KeyboardEvent) => void;
  const close = (): void => {
    panel.remove();
    document.removeEventListener("keydown", onKey);
  };
  onKey = (e: KeyboardEvent) => {
    // while a color picker is open, Escape closes the picker, not the panel
    if (e.key === "Escape" && document.querySelector(".cyl-cp")) return;
    if (e.key === "Escape") close();
  };

  panel.querySelector<HTMLButtonElement>(".cyl-pref-close")!.addEventListener("click", close);
  panel.querySelector<HTMLButtonElement>(".cyl-pref-cancel")!.addEventListener("click", close);
  panel.querySelector<HTMLButtonElement>(".cyl-pref-apply")!.addEventListener("click", () => {
    const next = collect();
    if (next) onSave(next); // apply without closing
  });
  panel.querySelector<HTMLButtonElement>(".cyl-pref-save")!.addEventListener("click", () => {
    const next = collect();
    if (!next) return;
    close();
    onSave(next);
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(panel);
  fpsInput.focus();
}