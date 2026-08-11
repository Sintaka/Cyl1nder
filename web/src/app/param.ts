/**
 * Param panel (v1): shows the currently selected node's editable input
 * attributes (name / type / value table). In v1 the null / input / output
 * nodes expose no attributes, so the panel mostly shows empty states.
 * Pure DOM string rendering - no imports, no framework.
 */

export interface ParamInfo {
  name: string;
  type: string;
  value: unknown;
}

export interface ParamPanelInfo {
  label: string | null;
  kind: string | null;
  params: ParamInfo[];
}

/** HTML-escape helper for cell/header text (mirrors spreadsheet.ts). */
function esc(s: unknown): string {
  return String(s ?? "");
}

/** Format a param value: objects/arrays via JSON, primitives via String(). */
function fmtValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Render the param panel into `el`.
 * - info === null -> no selected node -> "未选择节点" empty state.
 * - info.params empty -> v1 reserved empty state.
 * - otherwise -> dark table with name / type / value columns.
 */
export function renderParams(el: HTMLElement, info: ParamPanelInfo | null): void {
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
        `<tr><td>${esc(p.name)}</td><td>${esc(p.type)}</td><td>${esc(fmtValue(p.value))}</td></tr>`,
    )
    .join("");
  el.innerHTML = `<div class="cyl-param">
    <div class="cyl-param-head">${head}</div>
    <table class="cyl-param-table">
      <thead><tr><th>name</th><th>type</th><th>value</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
