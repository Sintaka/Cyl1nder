import "../styles/widgets.css";

/** Shared custom form controls matching the menubar "Layout" dropdown and the
 * bottom-bar "Sync Max FPS" stepper look. Pure DOM, zero deps.
 *
 * - createDropdown: rounded trigger box (▲▼ caret + value name) + a dark popup
 *   panel. Replaces native <select> so the trigger AND popup both match the
 *   Layout menu style.
 * - createStepper: number input + ▲▼ step column (same as Sync Max FPS).
 */

export interface DropdownOption {
  value: string;
  label: string;
}

export interface DropdownHandle {
  element: HTMLElement;
  getValue(): string;
  setValue(value: string): void;
  /** value getter/setter so existing `el.value = ...` call sites keep working. */
  get value(): string;
  set value(value: string);
  onChange(cb: (value: string) => void): void;
  destroy(): void;
}

export interface StepperHandle {
  element: HTMLElement;
  input: HTMLInputElement;
  getValue(): number;
  setValue(value: number): void;
  get value(): number;
  set value(value: number);
  onChange(cb: (value: number) => void): void;
}

function createPopupAnchor(container: HTMLElement, pop: HTMLElement): () => void {
  const onDoc = (e: Event): void => {
    if (!container.contains(e.target as Node)) pop.classList.remove("open");
  };
  document.addEventListener("pointerdown", onDoc, true);
  return () => document.removeEventListener("pointerdown", onDoc, true);
}

export function createDropdown(opts: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  dropUp?: boolean;
}): DropdownHandle {
  const root = document.createElement("div");
  root.className = "cyl-dd" + (opts.dropUp ? " cyl-dd-drop-up" : "");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cyl-menu-layout-box";
  if (opts.ariaLabel) btn.setAttribute("aria-label", opts.ariaLabel);

  const caret = document.createElement("span");
  caret.className = "cyl-menu-layout-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.innerHTML = "<span>▲</span><span>▼</span>";

  const name = document.createElement("span");
  name.className = "cyl-menu-layout-name";

  const pop = document.createElement("div");
  pop.className = "cyl-menu-drop";

  btn.appendChild(caret);
  btn.appendChild(name);
  root.appendChild(btn);
  root.appendChild(pop);

  let current = opts.value;
  let handler = opts.onChange;
  const removeAnchor = createPopupAnchor(root, pop);

  const labelOf = (v: string): string => opts.options.find((o) => o.value === v)?.label ?? v;
  const render = (): void => {
    name.textContent = labelOf(current);
    pop.innerHTML = "";
    for (const o of opts.options) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cyl-dd-item" + (o.value === current ? " active" : "");
      item.textContent = o.label;
      item.addEventListener("click", () => {
        current = o.value;
        render();
        pop.classList.remove("open");
        handler(o.value);
      });
      pop.appendChild(item);
    }
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.classList.toggle("open");
  });

  render();

  return {
    element: root,
    getValue: () => current,
    setValue: (v: string) => {
      current = v;
      render();
    },
    get value() {
      return current;
    },
    set value(v: string) {
      current = v;
      render();
    },
    onChange: (cb) => {
      handler = cb;
    },
    destroy: () => {
      removeAnchor();
    },
  };
}

export function createStepper(opts: {
  value: number;
  min: number;
  max: number;
  step: number;
  inputId?: string;
  ariaLabel?: string;
  onChange: (value: number) => void;
}): StepperHandle {
  const root = document.createElement("div");
  root.className = "cyl-fps-stepper";

  const input = document.createElement("input");
  input.type = "number";
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.className = "cyl-sync-fps";
  if (opts.inputId) input.id = opts.inputId;
  if (opts.ariaLabel) input.setAttribute("aria-label", opts.ariaLabel);

  const col = document.createElement("div");
  col.className = "cyl-fps-step-col";
  for (const step of [opts.step, -opts.step]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cyl-fps-step";
    b.dataset.step = String(step);
    b.setAttribute("aria-label", step > 0 ? "increase" : "decrease");
    b.textContent = step > 0 ? "▲" : "▼";
    col.appendChild(b);
  }

  root.appendChild(input);
  root.appendChild(col);

  let handler = opts.onChange;
  let current = Number.isFinite(opts.value) ? opts.value : opts.min;
  const clamp = (n: number): number => Math.min(opts.max, Math.max(opts.min, n));
  const render = (): void => {
    const s = String(current);
    if (input.value !== s) input.value = s;
  };

  const commit = (next: number, fire: boolean): void => {
    current = clamp(Number.isFinite(next) ? next : opts.min);
    render();
    if (fire) handler(current);
  };

  input.addEventListener("change", () => {
    commit(parseFloat(input.value), true);
  });
  input.addEventListener("input", () => {
    const n = parseFloat(input.value);
    if (Number.isFinite(n)) current = clamp(n);
  });
  col.querySelectorAll<HTMLButtonElement>(".cyl-fps-step").forEach((b) => {
    b.addEventListener("click", () => {
      commit(current + Number(b.dataset.step || 0), true);
    });
  });

  render();

  return {
    element: root,
    input,
    getValue: () => current,
    setValue: (v: number) => commit(v, false),
    get value() {
      return current;
    },
    set value(v: number) {
      commit(v, false);
    },
    onChange: (cb) => {
      handler = cb;
    },
  };
}