/**
 * Param panel (v1): shows the currently selected node's editable input
 * attributes (name / type / value table). v1: float/int -> number input,
 * class -> select, other strings -> text input; color3 -> rounded swatch button
 * + hex text that opens the floating color picker. Edits rebuild the params
 * array and fire onChange (the caller persists them + re-runs the network).
 * float/int number inputs also get middle-drag scrubbing (attachScrub).
 * P8 unified property reset: Ctrl+MMB restores EVERY control type
 * (float/int/vector/color3/string/class) to param.default or a type fallback.
 * Pure DOM string rendering - no framework.
 */

import { attachScrub, format4 } from "./scrub";
import { openColorPicker, rgbToHex, hexToRgb, type RGB } from "./color";

export interface ParamInfo {
  name: string;
  type: string;
  value: unknown;
  /** code-side default value (Ctrl+MMB restore); type fallback when absent. */
  default?: unknown;
}

export interface ParamPanelInfo {
  label: string | null;
  kind: string | null;
  params: ParamInfo[];
}

/** Plain cell/header text helper (mirrors spreadsheet.ts). */
function esc(s: unknown): string {
  return String(s ?? "");
}

/** Escape text for safe interpolation into HTML attribute values (group expressions may contain quotes). */
function attrEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** color3 param value ([r,g,b] 0..1) -> RGB 0..255; null when malformed. */
function color3ToRgb(value: unknown): RGB | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const nums = value.map((x) => Number(x));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return {
    r: Math.max(0, Math.min(1, nums[0])) * 255,
    g: Math.max(0, Math.min(1, nums[1])) * 255,
    b: Math.max(0, Math.min(1, nums[2])) * 255,
  };
}

/** Hex display for a color3 param value (malformed -> gray fallback). */
function color3Hex(value: unknown): string {
  const rgb = color3ToRgb(value);
  return rgb ? rgbToHex(rgb) : "#888888";
}

/** Parse a color3 edit raw string: "r,g,b" (0..1) or "#rrggbb"/"#rgb" -> [r,g,b] 0..1; null when invalid. */
function parseColor3(raw: string): [number, number, number] | null {
  const hex = hexToRgb(raw);
  if (hex) return [hex.r / 255, hex.g / 255, hex.b / 255];
  const parts = raw.split(",").map((x) => parseFloat(x.trim()));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return [
      Math.max(0, Math.min(1, parts[0])),
      Math.max(0, Math.min(1, parts[1])),
      Math.max(0, Math.min(1, parts[2])),
    ];
  }
  return null;
}

/** Editable control markup for one param row: float/int -> number input, class -> select,
 *  color3 -> swatch button + hex text, other strings -> text input. */
function controlHtml(p: ParamInfo): string {
  const name = attrEscape(p.name);
  if (p.type === "float" || p.type === "int") {
    return `<input type="number" step="any" data-name="${name}" value="${attrEscape(String(p.value))}">`;
  }
  if (p.type.startsWith("vector")) {
    const cur = Array.isArray(p.value) ? p.value.join(",") : String(p.value);
    return `<input type="text" data-name="${name}" value="${attrEscape(cur)}">`;
  }
  if (p.type === "color3") {
    const hex = color3Hex(p.value);
    return `<span class="cyl-color3" data-name="${name}">
      <button type="button" class="cyl-color3-swatch" data-name="${name}" style="background:${hex}" title="pick color"></button>
      <input type="text" class="cyl-color3-hex" value="${hex}" spellcheck="false" autocomplete="off" aria-label="${name} hex" />
    </span>`;
  }
  if (p.type === "string" && p.name === "class") {
    const current = String(p.value);
    const opts = Array.from(new Set(["autoguess", "points", "vertices", "prim", "detail", current]))
      .map((o) => `<option value="${o}"${o === current ? " selected" : ""}>${o}</option>`)
      .join("");
    return `<select data-name="${name}">${opts}</select>`;
  }
  return `<input type="text" data-name="${name}" value="${attrEscape(String(p.value))}">`;
}

/** Rebuild the params array with `name`'s value replaced by the raw control value
 *  (float/int -> number; color3 -> [r,g,b] 0..1 parsed from "r,g,b" or "#rrggbb";
 *  invalid color3 keeps the previous value). */
function applyEdit(info: ParamPanelInfo, name: string, raw: string): ParamInfo[] {
  return info.params.map((p) => {
    if (p.name !== name) return p;
    if (p.type === "float" || p.type === "int") {
      const n = parseFloat(raw);
      return { ...p, value: Number.isNaN(n) ? 0 : n };
    }
    if (p.type === "color3") {
      const parsed = parseColor3(raw);
      return parsed ? { ...p, value: parsed } : p;
    }
    if (p.type.startsWith("vector")) {
      // "x,y,z" (whitespace tolerated) -> number array; malformed keeps old value
      const parts = raw.split(",").map((x) => parseFloat(x.trim()));
      if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
        return { ...p, value: parts };
      }
      return p;
    }
    return { ...p, value: raw };
  });
}

/** Default value for a param: explicit `default` first, then a type fallback. */
export function paramDefault(p: ParamInfo): unknown {
  if (p.default !== undefined) return p.default;
  if (p.type === "float" || p.type === "int") return 0;
  if (p.type === "color3") return [0.5, 0.5, 0.5];
  if (p.type.startsWith("vector")) return [0, 0, 0];
  if (p.type === "string" && p.name === "class") return "autoguess";
  return "";
}

/**
 * Render the param panel into `el`.
 * - info === null -> no selected node -> "未选择节点" empty state.
 * - info.params empty -> v1 reserved empty state.
 * - otherwise -> dark table with name / type / value columns; the value cell
 *   holds an editable control that fires onChange with the rebuilt params array.
 */
export function renderParams(
  el: HTMLElement,
  info: ParamPanelInfo | null,
  onChange?: (params: ParamInfo[]) => void,
): void {
  if (!info) {
    el.innerHTML = `<div class="cyl-param"><div class="cyl-param-empty">未选择节点</div></div>`;
    return;
  }

  const head = `${esc(info.label ?? "未命名节点")}${info.kind ? ` · ${esc(info.kind)}` : ""}`;

  if (!info.params.length) {
    el.innerHTML = `<div class="cyl-param">
      <div class="cyl-param-head">${head}</div>
      <div class="cyl-param-empty">该节点暂无可用参数（v1 预留）</div>
    </div>`;
    return;
  }

  const rows = info.params
    .map(
      (p) =>
        `<tr><td>${esc(p.name)}</td><td>${esc(p.type)}</td><td>${controlHtml(p)}</td></tr>`,
    )
    .join("");
  el.innerHTML = `<div class="cyl-param">
    <div class="cyl-param-head">${head}</div>
    <table class="cyl-param-table">
      <thead><tr><th>name</th><th>type</th><th>value</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;

  if (onChange) {
    const controls = Array.from(
      el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[data-name], select[data-name]"),
    );
    for (const ctrl of controls) {
      const name = ctrl.getAttribute("data-name") ?? "";
      const p = info.params.find((x) => x.name === name)!; // name always comes from controlHtml
      const commit = () => onChange(applyEdit(info, name, ctrl.value));
      ctrl.addEventListener("input", commit);
      ctrl.addEventListener("change", commit);
      // Ctrl + middle-click restores the default value (explicit default first,
      // otherwise a type fallback) through the normal commit path (undoable).
      ctrl.addEventListener("pointerdown", (e) => {
        const pe = e as PointerEvent;
        if (pe.button === 1 && (pe.ctrlKey || pe.metaKey)) {
          e.preventDefault();
          const dv = String(paramDefault(p));
          ctrl.value = dv;
          commit();
        }
      });
      if (ctrl instanceof HTMLInputElement && ctrl.type === "number") {
        attachScrub(
          ctrl,
          () => {
            const v = parseFloat(ctrl.value);
            return Number.isFinite(v) ? v : 0;
          },
          (next) => {
            const text = format4(next);
            ctrl.value = text;
            onChange(applyEdit(info, name, text));
          },
        );
      }
    }

    // color3 rows: swatch button opens the floating picker; the hex input commits
    // "r,g,b" / "#rrggbb" edits through applyEdit (invalid input is ignored while
    // typing and reverted on blur/Enter); Ctrl+MMB restores the default.
    el.querySelectorAll<HTMLElement>(".cyl-color3").forEach((ctl) => {
      const name = ctl.getAttribute("data-name") ?? "";
      const p = info.params.find((x) => x.name === name);
      if (!p) return;
      const swatch = ctl.querySelector<HTMLButtonElement>(".cyl-color3-swatch");
      const hexInput = ctl.querySelector<HTMLInputElement>(".cyl-color3-hex");
      if (!swatch || !hexInput) return;
      let currentValue: unknown = p.value;
      const sync = (value: unknown): void => {
        const hex = color3Hex(value);
        swatch.style.background = hex;
        if (hexInput.value !== hex) hexInput.value = hex;
      };
      swatch.addEventListener("click", () => {
        const rgb = color3ToRgb(currentValue) ?? { r: 128, g: 128, b: 128 };
        const rect = swatch.getBoundingClientRect();
        const pickerW = 320; // matches .cyl-cp width
        const left = Math.max(8, Math.min(rect.left - pickerW - 8, window.innerWidth - pickerW - 8));
        const top = Math.max(8, Math.min(rect.top, window.innerHeight - 360));
        openColorPicker({
          initial: rgb,
          title: `${p.name} color`,
          position: { left, top },
          onColor: (nrgb: RGB) => {
            const val: [number, number, number] = [nrgb.r / 255, nrgb.g / 255, nrgb.b / 255];
            currentValue = val;
            onChange(info.params.map((q) => (q.name === p.name ? { ...q, value: val } : q)));
            sync(val);
          },
        });
      });
      const commitRaw = (forceReset: boolean): void => {
        const parsed = parseColor3(hexInput.value);
        if (!parsed) {
          if (forceReset) sync(currentValue); // revert invalid on blur/Enter
          return;
        }
        currentValue = parsed;
        onChange(applyEdit(info, name, hexInput.value));
        sync(parsed);
      };
      hexInput.addEventListener("input", () => commitRaw(false));
      hexInput.addEventListener("change", () => commitRaw(true));
      const resetColor3 = (e: Event): void => {
        const pe = e as PointerEvent;
        if (pe.button === 1 && (pe.ctrlKey || pe.metaKey)) {
          e.preventDefault();
          const dv = paramDefault(p);
          currentValue = dv;
          hexInput.value = color3Hex(dv); // show the default as #RRGGBB, not "r,g,b"
          onChange(info.params.map((q) => (q.name === p.name ? { ...q, value: dv } : q)));
          sync(dv);
        }
      };
      hexInput.addEventListener("pointerdown", resetColor3);
      swatch.addEventListener("pointerdown", resetColor3);
    });
  }
}
