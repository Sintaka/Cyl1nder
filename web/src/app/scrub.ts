/**
 * Houdini-style middle-drag scrubbing for number params (used by param.ts).
 *
 * Hold the middle mouse button on a number input -> a 1-column popup with 7
 * multiplier rows (100 .. 0.0001) appears, its rows strip vertically centered
 * on the cursor so the middle row 0.1 sits right under the mouse (initial
 * multiplier = 0.1, highlighted). While the cursor stays inside the popup's
 * horizontal box, vertical motion only switches the highlighted multiplier row
 * and never changes the value. Once the cursor crosses the popup's left or
 * right edge the multiplier locks and the value scrubs position-normalized:
 * value = start + (x - exitX) * multiplier * 0.5 (halved sensitivity; total dx
 * from the exit point, so the trajectory is stable and free of jumps). The
 * popup footer shows the current value formatted to at most 4 decimals.
 * Releasing the middle button closes the popup.
 *
 * Pure helpers (MULTIPLIERS / format4 / pickMultiplier / scrubValue /
 * accumulatedScrub / scrubPopupTop / isScrubOutOfBounds / createScrubState /
 * scrubPointerMove) are exported for unit tests; attachScrub wires the DOM.
 */

/** Multiplier rows, top to bottom (100 -> 0.0001). */
export const MULTIPLIERS: readonly number[] = [100, 10, 1, 0.1, 0.01, 0.001, 0.0001];

/** Initial multiplier: the middle row (0.1), which sits right under the cursor. */
export const DEFAULT_MULTIPLIER = MULTIPLIERS[3];

/** Horizontal sensitivity is halved: value += totalDx * multiplier * 0.5. */
export const SCRUB_SENSITIVITY = 0.5;

/** Format to at most 4 decimals, omitting trailing zeros (1.2000 -> "1.2"). */
export function format4(v: number): string {
  return v.toFixed(4).replace(/\.?0+$/, "");
}

/** Multiplier for the row under mouseY inside the vertical rows strip. */
export function pickMultiplier(
  rowsRect: { top: number; bottom: number },
  mouseY: number,
): number {
  const h = rowsRect.bottom - rowsRect.top;
  if (!(h > 0)) return MULTIPLIERS[0];
  const idx = Math.floor(((mouseY - rowsRect.top) / h) * MULTIPLIERS.length);
  return MULTIPLIERS[Math.min(MULTIPLIERS.length - 1, Math.max(0, idx))];
}

/** value += dx * multiplier (pure so the scrub math is unit-testable). */
export function scrubValue(value: number, dx: number, multiplier: number): number {
  return value + dx * multiplier;
}

/**
 * Normalized scrub: value = start + totalDx * multiplier * sensitivity.
 * totalDx is the accumulated horizontal displacement from the exit point, so
 * the value is a stable function of pointer position (no per-event drift).
 */
export function accumulatedScrub(
  start: number,
  totalDx: number,
  multiplier: number,
  sensitivity: number = SCRUB_SENSITIVITY,
): number {
  return start + totalDx * multiplier * sensitivity;
}

/**
 * Popup top so the rows strip center (middle multiplier row) sits at clientY,
 * clamped to keep the whole popup inside the viewport (margin px padding).
 */
export function scrubPopupTop(
  clientY: number,
  popupHeight: number,
  rowsTop: number,
  rowsHeight: number,
  viewportHeight: number,
  margin = 4,
): number {
  const rowsCenter = rowsTop + rowsHeight / 2;
  const top = clientY - rowsCenter;
  return Math.max(margin, Math.min(viewportHeight - popupHeight - margin, top));
}

/** True when the pointer X has crossed the popup's left/right edge. */
export function isScrubOutOfBounds(left: number, right: number, x: number): boolean {
  return x < left || x > right;
}

/** Pure scrub gesture state (DOM-free so the interaction is unit-testable). */
export interface ScrubState {
  /** value at scrub start (before any horizontal scrubbing). */
  startValue: number;
  /** currently highlighted multiplier (locked after exiting the box). */
  multiplier: number;
  /** true once the cursor crossed the popup edge; value scrubbing is live. */
  locked: boolean;
  /** cursor X where the box was left - the normalization origin. */
  exitX: number;
  /** current value (== startValue until locked). */
  value: number;
}

export function createScrubState(startValue: number): ScrubState {
  return {
    startValue,
    multiplier: DEFAULT_MULTIPLIER,
    locked: false,
    exitX: 0,
    value: startValue,
  };
}

/**
 * Advance the gesture on one pointermove.
 * - inside the box (not locked): vertical motion only switches the multiplier.
 * - crossing the left/right edge locks the multiplier and records exitX.
 * - locked: value = accumulatedScrub(start, x - exitX, multiplier, sensitivity).
 */
export function scrubPointerMove(
  state: ScrubState,
  bounds: { left: number; right: number } | null,
  rowsRect: { top: number; bottom: number } | null,
  x: number,
  y: number,
  sensitivity: number = SCRUB_SENSITIVITY,
): ScrubState {
  const next = { ...state };
  if (bounds && !next.locked && isScrubOutOfBounds(bounds.left, bounds.right, x)) {
    next.locked = true;
    next.exitX = x;
  }
  if (next.locked) {
    next.value = accumulatedScrub(next.startValue, x - next.exitX, next.multiplier, sensitivity);
  } else if (rowsRect) {
    next.multiplier = pickMultiplier(rowsRect, y);
  }
  return next;
}

/** Attach middle-drag scrubbing to a number input. Returns a detach function. */
export function attachScrub(
  inputEl: HTMLInputElement,
  getValue: () => number,
  onChange: (next: number) => void,
): () => void {
  let popup: HTMLElement | null = null;
  let rows: HTMLElement[] = [];
  let rowsRect: { top: number; bottom: number } | null = null;
  let bounds: { left: number; right: number } | null = null;
  let valueRow: HTMLElement | null = null;
  let state: ScrubState | null = null;
  let prevCursor = "";

  const setActive = (m: number): void => {
    const i = MULTIPLIERS.indexOf(m);
    rows.forEach((r, ri) => r.classList.toggle("active", ri === i));
  };

  const renderValue = (): void => {
    if (valueRow && state) valueRow.textContent = format4(state.value);
  };

  const close = (): void => {
    if (popup) {
      popup.remove();
      popup = null;
    }
    rows = [];
    rowsRect = null;
    bounds = null;
    valueRow = null;
    state = null;
    inputEl.style.cursor = prevCursor;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("blur", close);
  };

  const open = (clientX: number, clientY: number): void => {
    if (!state) return;
    popup = document.createElement("div");
    popup.className = "cyl-scrub";
    const rowsWrap = document.createElement("div");
    rowsWrap.className = "cyl-scrub-rows";
    rows = MULTIPLIERS.map((m) => {
      const row = document.createElement("div");
      row.className = "cyl-scrub-row";
      row.textContent = String(m);
      rowsWrap.appendChild(row);
      return row;
    });
    const sep = document.createElement("div");
    sep.className = "cyl-scrub-sep";
    const val = document.createElement("div");
    val.className = "cyl-scrub-value";
    valueRow = val;
    popup.append(rowsWrap, sep, val);
    document.body.appendChild(popup);

    // Horizontal: keep next to the input (clamped to the viewport).
    const r = inputEl.getBoundingClientRect();
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let left = r.left;
    if (left + pw > window.innerWidth - 4) left = Math.max(4, window.innerWidth - pw - 4);
    // Vertical: center the rows strip (middle multiplier row) on the cursor.
    const top = scrubPopupTop(clientY, ph, rowsWrap.offsetTop, rowsWrap.offsetHeight, window.innerHeight);
    popup.style.left = left + "px";
    popup.style.top = top + "px";

    const rr = rowsWrap.getBoundingClientRect();
    rowsRect = { top: rr.top, bottom: rr.bottom };
    const pr = popup.getBoundingClientRect();
    bounds = { left: pr.left, right: pr.right };

    state.multiplier = pickMultiplier(rowsRect, clientY);
    if (isScrubOutOfBounds(bounds.left, bounds.right, clientX)) {
      // Cursor already outside the box: lock immediately so scrubbing works.
      state.locked = true;
      state.exitX = clientX;
    }
    setActive(state.multiplier);
    renderValue();
  };

  const onPointerMove = (e: PointerEvent): void => {
    e.preventDefault();
    if (!state || !rowsRect) return;
    const prevValue = state.value;
    state = scrubPointerMove(state, bounds, rowsRect, e.clientX, e.clientY);
    if (state.locked) {
      if (state.value !== prevValue) {
        inputEl.value = format4(state.value);
        onChange(state.value);
      }
    } else {
      setActive(state.multiplier);
    }
    renderValue();
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (e.type === "pointercancel" || e.button === 1) close();
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 1 || e.ctrlKey || e.metaKey) return; // Ctrl+MMB = restore default (param.ts)
    e.preventDefault(); // suppress middle-click autoscroll
    const v = getValue();
    state = createScrubState(Number.isFinite(v) ? v : 0);
    prevCursor = inputEl.style.cursor;
    inputEl.style.cursor = "ew-resize";
    open(e.clientX, e.clientY);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("blur", close);
  };

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault(); // belt-and-braces for autoscroll
  };

  inputEl.addEventListener("pointerdown", onPointerDown);
  inputEl.addEventListener("mousedown", onMouseDown);
  return () => {
    inputEl.removeEventListener("pointerdown", onPointerDown);
    inputEl.removeEventListener("mousedown", onMouseDown);
    close();
  };
}