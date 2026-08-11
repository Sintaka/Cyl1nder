/**
 * Param panel (v1): shows the currently selected node's editable input
 * attributes (name / type / value table). v1: float/int -> number input,
 * class -> select, other strings -> text input; edits rebuild the params array
 * and fire onChange (the caller persists them + re-runs the network).
 * float/int number inputs also get middle-drag scrubbing (attachScrub).
 * Pure DOM string rendering - no imports, no framework.
 */

import { attachScrub, format4 } from "./scrub";

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

/** Editable control markup for one param row: float/int -> number input, class -> select, other strings -> text input. */
function controlHtml(p: ParamInfo): string {
  const name = attrEscape(p.name);
  if (p.type === "float" || p.type === "int") {
    return `<input type="number" step="any" data-name="${name}" value="${attrEscape(String(p.value))}">`;
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

/** Rebuild the params array with `name`'s value replaced by the raw control value (float/int -> number). */
function applyEdit(info: ParamPanelInfo, name: string, raw: string): ParamInfo[] {
  return info.params.map((p) => {
    if (p.name !== name) return p;
    if (p.type === "float" || p.type === "int") {
      const n = parseFloat(raw);
      return { ...p, value: Number.isNaN(n) ? 0 : n };
    }
    return { ...p, value: raw };
  });
}

/** Default value for a param: explicit `default` first, then a type fallback. */
export function paramDefault(p: ParamInfo): unknown {
  if (p.default !== undefined) return p.default;
  if (p.type === "float" || p.type === "int") return 0;
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
  }
}
