/**
 * Houdini-style middle-drag scrubbing for number params (used by param.ts).
 *
 * Hold the middle mouse button on a number input -> a 1-column popup with 7
 * multiplier rows (100 .. 0.0001) appears next to the input. Before the first
 * horizontal drag the row under the cursor highlights and follows the mouse
 * vertically; once horizontal drag exceeds LOCK_DX px the multiplier locks and
 * the value scrubs by dx * multiplier (dynamic apply). The popup footer shows
 * the current value formatted to at most 4 decimals.
 *
 * Pure helpers (MULTIPLIERS / format4 / pickMultiplier / scrubValue) are
 * exported for unit tests; attachScrub wires the DOM.
 */

/** Multiplier rows, top to bottom (100 -> 0.0001). */
export const MULTIPLIERS: readonly number[] = [100, 10, 1, 0.1, 0.01, 0.001, 0.0001];

/** Lock the multiplier once horizontal drag exceeds this many px. */
export const LOCK_DX = 3;

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

/** Attach middle-drag scrubbing to a number input. Returns a detach function. */
export function attachScrub(
  inputEl: HTMLInputElement,
  getValue: () => number,
  onChange: (next: number) => void,
): () => void {
  let popup: HTMLElement | null = null;
  let rows: HTMLElement[] = [];
  let rowsRect: { top: number; bottom: number } | null = null;
  let valueRow: HTMLElement | null = null;
  let cur = 0;
  let multiplier = MULTIPLIERS[0];
  let locked = false;
  let lastX = 0;
  let prevCursor = "";

  const setActive = (m: number): void => {
    const i = MULTIPLIERS.indexOf(m);
    rows.forEach((r, ri) => r.classList.toggle("active", ri === i));
  };

  const renderValue = (): void => {
    if (valueRow) valueRow.textContent = format4(cur);
  };

  const close = (): void => {
    if (popup) {
      popup.remove();
      popup = null;
    }
    rows = [];
    rowsRect = null;
    valueRow = null;
    inputEl.style.cursor = prevCursor;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("blur", close);
  };

  const open = (clientY: number): void => {
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

    // Position next to the input (below; flip above when it would overflow).
    const r = inputEl.getBoundingClientRect();
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let left = r.left;
    let top = r.bottom + 2;
    if (top + ph > window.innerHeight - 4) top = Math.max(4, r.top - ph - 2);
    if (left + pw > window.innerWidth - 4) left = Math.max(4, window.innerWidth - pw - 4);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;

    const rr = rowsWrap.getBoundingClientRect();
    rowsRect = { top: rr.top, bottom: rr.bottom };
    multiplier = pickMultiplier(rowsRect, clientY);
    setActive(multiplier);
    renderValue();
  };

  const onPointerMove = (e: PointerEvent): void => {
    e.preventDefault();
    if (!rowsRect) return;
    if (!locked && Math.abs(e.clientX - lastX) > LOCK_DX) {
      locked = true;
      lastX = e.clientX;
    }
    if (locked) {
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      cur = scrubValue(cur, dx, multiplier);
      inputEl.value = format4(cur);
      renderValue();
      onChange(cur);
    } else {
      multiplier = pickMultiplier(rowsRect, e.clientY);
      setActive(multiplier);
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (e.type === "pointercancel" || e.button === 1) close();
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 1) return;
    e.preventDefault(); // suppress middle-click autoscroll
    const v = getValue();
    cur = Number.isFinite(v) ? v : 0;
    multiplier = MULTIPLIERS[0];
    locked = false;
    lastX = e.clientX;
    prevCursor = inputEl.style.cursor;
    inputEl.style.cursor = "ew-resize";
    open(e.clientY);
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
