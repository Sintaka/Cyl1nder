/**
 * explorer.exe-style address bar for the graph panel: a segmented breadcrumb
 * (split on "/") plus an inline input for direct entry, with Tab completion.
 *
 * Self-contained: pure DOM + inline styles only. No store / bridge / nodes2 /
 * main imports. The host element (`.cyl-graph-addr`) already owns its layout
 * chrome (padding / font / background / border); this module only manages the
 * content inside it.
 */

export interface AddressBarDeps {
  /** Current full address, e.g. "/C1-xxxx-xxxx/". */
  getAddress(): string;
  /** Attempt to navigate/apply an address; false = not navigable. */
  navigate(address: string): boolean;
  /** Tab-completion candidates for a (partial) path segment. `address` is the full
   *  in-progress input value so the caller can tell WHICH segment is being edited
   *  (multi-segment paths: first segment vs. second segment of a project address). */
  getCompletions(segmentPrefix: string, address: string): Promise<string[]>;
  /** Optional log sink. */
  log?(msg: string): void;
}

export interface AddressBarHandle {
  /** Refresh the displayed address; ignored while the input is open. */
  setAddress(addr: string): void;
  /** Remove all listeners and clear the host's content. */
  destroy(): void;
}

/** Split an address on "/", dropping empty segments. */
export function splitAddress(address: string): string[] {
  return address.split("/").filter((s) => s.length > 0);
}

/**
 * Replace the segment the cursor is editing with the first candidate that
 * differs from the current segment text. Returns the full address (leading
 * slash), or null when there is nothing to apply.
 *
 * - `cursorAtEnd`: the cursor sits in the trailing segment. A trailing slash
 *   (or empty address) means the cursor is in a fresh empty segment, so the
 *   candidate is appended; otherwise the last existing segment is replaced.
 * - `cursorAtEnd === false`: the middle segment is located by `prefix` (exact
 *   text match preferred, then the first segment whose text starts with it).
 * - Candidates equal to the current segment are ignored; if none remain, null.
 */
export function completeSegment(
  address: string,
  cursorAtEnd: boolean,
  prefix: string,
  candidates: string[],
): string | null {
  if (candidates.length === 0) return null;
  const segs = splitAddress(address);

  let idx: number;
  if (cursorAtEnd) {
    idx = address.length === 0 || address.endsWith("/") ? -1 : segs.length - 1;
  } else {
    if (prefix === "") return null;
    idx = segs.findIndex((s) => s === prefix);
    if (idx === -1) idx = segs.findIndex((s) => s.startsWith(prefix));
    if (idx === -1) return null;
  }

  const current = idx >= 0 ? segs[idx] : "";
  const candidate = candidates.find((c) => c !== current);
  if (candidate === undefined) return null;

  if (idx >= 0) segs[idx] = candidate;
  else segs.push(candidate);

  return `/${segs.join("/")}`;
}

// ---- inline style tokens (match base.css / nodeview.css) ----
const FONT = "font:inherit;";
const SEG_BASE =
  "display:inline-flex;align-items:center;flex-shrink:0;border:1px solid transparent;" +
  "background:transparent;color:#d8dae0;cursor:pointer;padding:0 4px;border-radius:4px;outline:none;";
const SEG_HOVER = { borderColor: "#2b6cb0", background: "rgba(43,108,176,.18)", color: "#e6e9ef" };
const SEG_CURRENT =
  "display:inline-flex;align-items:center;flex-shrink:0;border:1px solid transparent;" +
  "background:transparent;color:#e6e9ef;font-weight:700;padding:0 4px;border-radius:4px;outline:none;";
const SEP_CSS = "flex-shrink:0;color:#8f959e;padding:0 1px;";
const INPUT_CSS =
  "width:100%;box-sizing:border-box;border:1px solid #2b6cb0;border-radius:4px;" +
  "background:#1b1e24;color:#e6e9ef;padding:1px 6px;outline:none;";

export function createAddressBar(host: HTMLElement, deps: AddressBarDeps): AddressBarHandle {
  let address = deps.getAddress();
  let editing = false;
  let inputEl: HTMLInputElement | null = null;
  let completion: { segStart: number; candidates: string[]; index: number } | null = null;

  const log = (msg: string): void => deps.log?.(msg);

  const root = document.createElement("div");
  root.style.cssText = "display:flex;align-items:center;width:100%;" + FONT;
  host.innerHTML = "";
  host.appendChild(root);

  const sep = (): HTMLSpanElement => {
    const el = document.createElement("span");
    el.textContent = "/";
    el.style.cssText = SEP_CSS;
    return el;
  };

  const bindHover = (el: HTMLButtonElement): void => {
    const base = { borderColor: el.style.borderColor, background: el.style.background, color: el.style.color };
    el.addEventListener("mouseenter", () => {
      el.style.borderColor = SEG_HOVER.borderColor;
      el.style.background = SEG_HOVER.background;
      el.style.color = SEG_HOVER.color;
    });
    el.addEventListener("mouseleave", () => {
      el.style.borderColor = base.borderColor;
      el.style.background = base.background;
      el.style.color = base.color;
    });
  };

  const prefixFor = (segments: string[], i: number): string => `/${segments.slice(0, i + 1).join("/")}`;

  const onSegmentClick = (target: string): void => {
    if (deps.navigate(target)) return;
    const cb = navigator.clipboard;
    if (cb) {
      void cb
        .writeText(target)
        .then(() => log(`[addr] ${target} 不可跳转，已复制地址`))
        .catch(() => log(`[addr] ${target} 不可跳转`));
    } else {
      log(`[addr] ${target} 不可跳转`);
    }
  };

  const renderSegments = (): void => {
    editing = false;
    const segs = splitAddress(address);
    root.innerHTML = "";
    root.appendChild(sep()); // leading "/" (Houdini node-view style)
    segs.forEach((seg, i) => {
      const isLast = i === segs.length - 1;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = seg;
      if (isLast) {
        btn.disabled = true;
        btn.setAttribute("aria-current", "page");
        btn.style.cssText = SEG_CURRENT + FONT;
      } else {
        btn.style.cssText = SEG_BASE + FONT;
        bindHover(btn);
        btn.addEventListener("click", () => onSegmentClick(prefixFor(segs, i)));
      }
      root.appendChild(btn);
      if (!isLast) root.appendChild(sep());
    });
  };

  const onInputKeydown = (e: KeyboardEvent): void => {
    const input = inputEl;
    if (!input) return;
    if (e.key === "Tab") {
      // Address bar owns Tab while it is focused; never let it reach the nodeview.
      e.preventDefault();
      e.stopPropagation();
      void onTabComplete(input);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const value = input.value;
      try {
        deps.navigate(value);
      } finally {
        exitInput(true); // always return to segment mode, success or not
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      exitInput(false);
      return;
    }
    // ArrowLeft/Right/Home/End: not intercepted — let the caret move freely.
  };

  const onInputBlur = (): void => {
    exitInput(false);
  };

  const onInputChange = (): void => {
    completion = null; // user typed: reset the completion cycle
  };

  const enterInput = (): void => {
    if (editing) return;
    editing = true;
    completion = null;
    root.innerHTML = "";
    const input = document.createElement("input");
    input.type = "text";
    input.value = address;
    input.setAttribute("aria-label", "Graph address");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    input.style.cssText = INPUT_CSS + FONT;
    root.appendChild(input);
    inputEl = input;
    input.addEventListener("keydown", onInputKeydown);
    input.addEventListener("blur", onInputBlur);
    input.addEventListener("input", onInputChange);
    input.focus();
    input.select();
  };

  const exitInput = (refreshFromDeps: boolean): void => {
    if (!editing) return;
    editing = false;
    completion = null;
    const input = inputEl;
    if (input) {
      input.removeEventListener("keydown", onInputKeydown);
      input.removeEventListener("blur", onInputBlur);
      input.removeEventListener("input", onInputChange);
    }
    inputEl = null;
    if (refreshFromDeps) address = deps.getAddress();
    renderSegments();
  };

  const onTabComplete = async (input: HTMLInputElement): Promise<void> => {
    const value = input.value;
    const pos = input.selectionEnd ?? input.selectionStart ?? value.length;
    const segStart = value.lastIndexOf("/", pos - 1) + 1;
    const cursorAtEnd = pos === value.length;
    const prefix = value.slice(segStart, pos);

    let candidates: string[];
    if (completion && completion.segStart === segStart) {
      // Still cycling the same segment: advance to the next candidate.
      completion.index = (completion.index + 1) % completion.candidates.length;
      candidates = completion.candidates;
    } else {
      try {
        candidates = await deps.getCompletions(prefix, value);
      } catch (err) {
        log(`[addr] completion failed: ${String(err)}`);
        return;
      }
      if (!inputEl || !editing || inputEl !== input) return; // blurred/destroyed while awaiting
      if (candidates.length === 0) {
        completion = null;
        return;
      }
      completion = { segStart, candidates, index: 0 };
    }

    if (!editing || inputEl !== input) return;

    const candidate = candidates[completion.index];
    const next = completeSegment(value, cursorAtEnd, prefix, [candidate]);
    if (next !== null) {
      input.value = next;
      const caret = segStart + candidate.length;
      input.setSelectionRange(caret, caret);
    }
  };

  const onRootClick = (e: MouseEvent): void => {
    if (editing) return;
    if (e.target !== root) return; // button (has its own handler) or separator
    enterInput();
  };

  const onRootDblClick = (): void => {
    enterInput();
  };

  root.addEventListener("click", onRootClick);
  root.addEventListener("dblclick", onRootDblClick);

  renderSegments();

  return {
    setAddress(addr: string): void {
      if (editing) return; // protect in-flight user input
      address = addr;
      renderSegments();
    },
    destroy(): void {
      if (inputEl) {
        inputEl.removeEventListener("keydown", onInputKeydown);
        inputEl.removeEventListener("blur", onInputBlur);
        inputEl.removeEventListener("input", onInputChange);
        inputEl = null;
      }
      root.removeEventListener("click", onRootClick);
      root.removeEventListener("dblclick", onRootDblClick);
      editing = false;
      completion = null;
      host.innerHTML = "";
    },
  };
}
