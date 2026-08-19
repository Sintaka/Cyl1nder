/**
 * Param panel (v1): shows the currently selected node's editable input
 * attributes (name / type / value table). v1: float/int -> number input,
 * class -> select, other strings -> text input; color3 -> rounded swatch button
 * + hex text that opens the floating color picker. Edits rebuild the params
 * array and fire onChange (the caller persists them + re-runs the network).
 * float/int number inputs also get middle-drag scrubbing (attachScrub).
 * P8 unified property reset: Ctrl+MMB restores EVERY control type
 * (float/int/vector/color3/string/class) to param.default or a type fallback.
 * P5b channel reference（可选 bindCtx 第 4 参）：参数行 ⛓ 链接按钮（未绑定灰 / 已绑定绿），
 * 弹出当前 serial 的 param 通道列表完成绑定；已绑定点击直接解除。不传 bindCtx 行为与旧版完全一致。
 * Pure DOM string rendering - no framework.
 */

import { attachScrub, format4 } from "./scrub";
import { openColorPicker, rgbToHex, hexToRgb, fitInViewport, type RGB } from "./color";
// PORT_PARAM 是跨写集契约（graph-model 序列化 / 本面板渲染下拉 / capabilities 回写
// 三处必须逐字一致）——**import 而不是重打一遍字面量**，拼错的可能性直接归零。
import { PORT_PARAM } from "../nodes2/graph-model";
import {
  cachedCapabilities,
  cachedPortType,
  cachedPorts,
  loadCapabilities,
  normalizeSerial,
  type PortSide,
} from "../nodes2/serial-capabilities";

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

/** P5b 通道引用绑定上下文（main.ts 经 renderParams 第 4 参注入；缺省 = 旧版行为）。 */
export interface ParamBindCtx {
  /** 当前节点 paramName -> 通道 absolutePath（如 tx -> "/obj/geo1/transform1/tx"）。 */
  bindings: Record<string, string>;
  /** 异步拉当前 serial 的 param 通道（path = absolutePath；label 供列表显示，按契约取尾段）。 */
  listChannels(): Promise<{ path: string; label: string }[]>;
  /** 绑定 / 解除：channelPath 非空 = 绑定到该通道；null = 解除链接。 */
  onBind(name: string, channelPath: string | null): void;
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

/** 按参数名固定的下拉选项（v0.1.00114）。
 *
 *  `type` 是单端口 _input_/_output_ 的端口类型（geo|float|vec3），必须是下拉而不是
 *  自由文本——手输错值会让端口类型静默回落 geo、连线校验跟着放行错配的线。
 *  当前值总被并入选项，所以旧图里的意外值不会在打开面板时被悄悄改掉。 */
const MENU_OPTIONS: Record<string, readonly string[]> = {
  type: ["geo", "float", "vec3"],
};

// ---------------------------------------------------------------------------
// `port` 动态下拉（v0.1.00120）：选项**来自桥**，不是写死的 in1..in4
//
// 端口不再是固定 4 个。用户只填**一个地址 = 一个 serial**（`address` 参数），桥的
// `GET /api/serials/{serial}/capabilities` 回答"它提供什么"：
//   - SOP HDA → `_input_` 给 in0..in3（显示 "In 1".."In 4"）、`_output_` 给 out0..out3
//   - 吊牌 tag → 该 tag 的逻辑名清单，每项带自己的类型（显示 `tx: float`）
// 为什么必须问桥：多个 HDA 可以**故意共用一个 serial**，好让参数被关联、由桥集中托管，
// 那"这个 serial 提供哪些端口"只有桥知道。
//
// 机制形状（三条，缺一不可）：
//   1. **同步渲染 + 异步补**：controlHtml 是同步的（整个面板一次 innerHTML），所以先用
//      缓存（可能没有）渲染，没缓存就渲染一个占位 option，再由 wirePortMenu 异步取回
//      并**原地重填** <select>。绝不为了等网络把面板渲染改成 async——那会让每次选中
//      节点都闪一下空白。
//   2. **地址改了就重取**：地址框与端口下拉在同一个面板里，但 main.ts 不会因为改
//      address 而重渲染面板。于是这里自己监听 address 的 input 事件 → 重新取 → 重填。
//   3. **当前值恒被并入选项**（与 MENU_OPTIONS 同一条性质，见上）：桥暂时给不出清单
//      （离线 / 半截地址 / 未注册）时，已选中的 port **不会被悄悄改掉**。这一条是硬要求：
//      静默改值 = 用户以为还连着原端口，实际图已经变了。
// ---------------------------------------------------------------------------

/** 地址参数名（与 graph-model 的 addressParams 同名；那边没导出常量，故就近定义）。 */
const ADDRESS_PARAM = "address";

/** 节点 kind → 查能力的哪一侧。`_input_` 从 serial **读**（inputs），`_output_` 往它**写**
 *  （outputs）。吊牌两侧同一份清单（参数双向），所以 tag 走哪侧都一样。
 *  其它 kind（null/transform/geo…）→ null：它们没有 port 参数，不该触发能力请求。 */
function portSideOf(kind: string | null): PortSide | null {
  if (kind === "input") return "inputs";
  if (kind === "output") return "outputs";
  return null;
}

/** 面板里 `address` 参数的当前值（归一后的 serial）。 */
function serialOf(info: ParamPanelInfo): string {
  return normalizeSerial(info.params.find((p) => p.name === ADDRESS_PARAM)?.value);
}

/** 一个 <option> 的显示文本：`label: type`（类型已知）或裸 label（类型未知）。
 *
 *  为什么把类型显示在选项里：用户明确要求"挑一个之后能看到它的类型（`tx: float`）"。
 *  而且类型决定连线合不合法，藏起来等于让人盲选——正是映射系统当初要修的病。
 *  HDA 侧 label 已是人话（"In 1"）且类型基本恒为 geo，同样带上：一致比省字重要。 */
export function portOptionText(o: { key: string; label: string; type: string }): string {
  return o.type ? `${o.label}: ${o.type}` : o.label;
}

/** `port` 下拉的 <option> 串。`ports === null` = 清单还不知道（未缓存/在途）。
 *
 *  当前值 `current` 不在清单里时**追加**在末尾（title 标注"不在桥给出的清单里"），
 *  绝不丢弃——见上方机制第 3 条。current 为空则给一个禁用占位（提示当前状态），
 *  占位 value="" 与"未选择"同值，所以不会把空值变成一个假端口。 */
export function portOptionsHtml(
  ports: { key: string; label: string; type: string }[] | null,
  current: string,
  placeholder: string,
): string {
  const opts: string[] = [];
  if (current === "") {
    // 未选择：占位不可选中（selected + disabled），避免"看起来选了个空端口"
    opts.push(`<option value="" selected disabled>${esc(placeholder)}</option>`);
  }
  for (const o of ports ?? []) {
    const sel = o.key === current ? " selected" : "";
    opts.push(
      `<option value="${attrEscape(o.key)}"${sel} title="${attrEscape(o.key)}">${esc(portOptionText(o))}</option>`,
    );
  }
  if (current !== "" && !(ports ?? []).some((o) => o.key === current)) {
    // 清单里没有当前值（桥离线 / 地址变了 / 端口被删）→ 保留它并说明，绝不静默改值
    const note = ports === null ? "端口清单加载中" : "不在桥给出的清单里";
    opts.push(`<option value="${attrEscape(current)}" selected title="${attrEscape(note)}">${esc(current)}</option>`);
  }
  return opts.join("");
}

/** 占位文案：区分"还没填地址"/"加载中"/"桥不认识这个 serial"/"该 serial 无端口"。
 *  四态分开说，因为用户能做的事完全不同（填地址 / 等 / 检查地址 / 检查 Houdini 侧）。 */
export function portPlaceholder(serial: string, ports: { key: string }[] | null): string {
  if (serial === "") return "先填 address（一个 serial）";
  if (ports === null) return "加载端口清单…";
  if (ports.length === 0) {
    return cachedCapabilities(serial)?.known ? "该 serial 未提供端口" : "桥未识别该 serial";
  }
  return "未选择端口";
}

/** `port` 的 <select> 标记（同步：只用缓存；没缓存时渲染占位，wirePortMenu 随后补）。 */
function portControlHtml(p: ParamInfo, info: ParamPanelInfo): string {
  const side = portSideOf(info.kind);
  const serial = serialOf(info);
  const ports = side && serial ? cachedPorts(serial, side) : null;
  const current = String(p.value ?? "");
  return `<select data-name="${attrEscape(p.name)}" data-port-menu="1">${portOptionsHtml(ports, current, portPlaceholder(serial, ports))}</select>`;
}

/** Editable control markup for one param row: float/int -> number input, class -> select,
 *  `port` -> **桥驱动的动态下拉**（见上方 `port` 动态下拉块），name-driven menu
 *  (see MENU_OPTIONS) -> select, color3 -> swatch button + hex text,
 *  other strings -> text input. */
function controlHtml(p: ParamInfo, info: ParamPanelInfo): string {
  const name = attrEscape(p.name);
  // port 先判：它也在 MENU_OPTIONS 之外，且选项来自桥而非常量表
  if (p.name === PORT_PARAM && portSideOf(info.kind)) return portControlHtml(p, info);
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
  const menu = MENU_OPTIONS[p.name];
  if (menu) {
    const current = String(p.value);
    const opts = Array.from(new Set([...menu, current]))
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
  const next = applyEditRaw(info, name, raw);
  // 选了端口 → 同时把该端口的类型写进 `type`。**类型的真源是桥**（capabilities），
  // 由"解析 capabilities 的这一侧"负责写入；graph-model 的 syncPortSocketType 随后读
  // `type` 换 socket（那条通路一个字没动）。查不到类型（未缓存 / 桥说 ""）→ **不动
  // type**：绝不猜默认 geo，静默补类型会让连线校验放行错配的线。
  if (name !== PORT_PARAM) return next;
  const side = portSideOf(info.kind);
  const serial = serialOf(info);
  if (!side || !serial || raw === "") return next;
  const t = cachedPortType(serial, side, raw);
  if (!t) return next;
  return next.map((p) => (p.name === "type" ? { ...p, value: t } : p));
}

/** applyEdit 的单参数核心（原 applyEdit 主体）：只改 `name` 那一行，不做联动。 */
function applyEditRaw(info: ParamPanelInfo, name: string, raw: string): ParamInfo[] {
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

/**
 * 把 `port` 下拉接到桥：渲染后取一次能力，并在 `address` 被编辑时重取 + 原地重填。
 *
 * 竞态处理（两道闸，都是必需的）：
 *   1. **DOM 还在吗**：`sel.isConnected` —— 面板可能已因切换选中而重渲染，往一个已被
 *      丢弃的 <select> 里填选项是无声的浪费，还会覆盖新面板的状态（如果引用串了）。
 *   2. **地址还是它吗**：回来时重读地址框，与请求时的 serial 比对；不同则丢弃。用户
 *      打字比网络快，先发的短地址后回来会把正确清单覆盖成空——latest-wins 靠这一句落地。
 * 请求本身的合并/防抖/纪元作废在 serial-capabilities.loadCapabilities 里，这里不重复做。
 *
 * **只重填选项，不改值**：重填后把 `sel.value` 设回原值（原值总在选项里，见
 * portOptionsHtml），且不派发 input/change ——重填是"看见更多可选项"，不是一次编辑，
 * 不该进 undo、不该触发 network.run()。
 */
function wirePortMenu(el: HTMLElement, info: ParamPanelInfo): void {
  const side = portSideOf(info.kind);
  if (!side) return;
  const sel = el.querySelector<HTMLSelectElement>("select[data-port-menu]");
  if (!sel) return;
  // ADDRESS_PARAM 是固定字面量（无需 CSS.escape：常量里没有选择器特殊字符）
  const addressInput = el.querySelector<HTMLInputElement>(`input[data-name="${ADDRESS_PARAM}"]`);

  const refresh = (serial: string): void => {
    if (serial === "") {
      // 地址被清空：回到"先填 address"占位（不发请求）
      repaint(sel, [], serial);
      return;
    }
    if (cachedPorts(serial, side)) {
      repaint(sel, cachedPorts(serial, side)!, serial);
      return;
    }
    repaint(sel, null, serial); // 先显示"加载端口清单…"
    void loadCapabilities(serial).then(() => {
      if (!sel.isConnected) return; // 闸 1：面板已重渲染
      const now = normalizeSerial(addressInput ? addressInput.value : serial);
      if (now !== serial) return; // 闸 2：地址已被改成别的，这份答案过期了
      repaint(sel, cachedPorts(serial, side) ?? [], serial);
    });
  };

  refresh(serialOf(info));
  // address 是普通 text input，main.ts 不会因为它变化而重渲染面板 → 自己听
  addressInput?.addEventListener("input", () => refresh(normalizeSerial(addressInput.value)));
}

/** 原地重填 `port` 下拉的选项，保持当前值不变（见 wirePortMenu 的"只重填不改值"）。 */
function repaint(
  sel: HTMLSelectElement,
  ports: { key: string; label: string; type: string }[] | null,
  serial: string,
): void {
  const current = sel.value;
  sel.innerHTML = portOptionsHtml(ports, current, portPlaceholder(serial, ports));
  if (sel.value !== current) sel.value = current; // 防浏览器把 selected 落在别处
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

// ---------------------------------------------------------------------------
// P5b 通道引用绑定弹出（内联小面板，纯 DOM 无框架）：点灰 ⛓ 打开 → listChannels()
// 异步加载（「加载中…」）→ 列表项 label = absolutePath 尾段（title = 全量）；
// 已绑定状态点绿 ⛓ = 直接解除（onBind(name, null)）并收起；点外部 / Esc / 再点 ⛓ 关闭。
// 单例模式（照 color picker）：同一时间只有一个弹出，打开新弹出先收起旧的。
// ---------------------------------------------------------------------------

interface ActiveLinkPop {
  name: string;
  root: HTMLElement;
}

let activeLinkPop: ActiveLinkPop | null = null;
let linkPopClose: (() => void) | null = null;

/** 收起当前通道引用弹出（无弹出时 no-op）。 */
function closeLinkPop(): void {
  if (linkPopClose) {
    const close = linkPopClose;
    linkPopClose = null;
    close();
  }
}

/** 列表项 label：absolutePath 尾段（/obj/geo1/transform1/tx -> tx）。 */
function tailOfPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function openLinkPop(btn: HTMLElement, name: string, ctx: ParamBindCtx): void {
  closeLinkPop(); // 单例：先收起旧的
  const root = document.createElement("div");
  root.className = "cyl-param-link-pop";
  root.setAttribute("role", "listbox");
  root.setAttribute("aria-label", `绑定 ${name} 到通道`);
  root.innerHTML = `
    <div class="cyl-param-link-pop-title">绑定 ${esc(name)} → 通道</div>
    <div class="cyl-param-link-pop-body"><div class="cyl-param-link-loading">加载中…</div></div>`;
  document.body.appendChild(root);
  // 定位：按钮正下方（固定定位；fitInViewport 防溢出视口，照 color picker）
  const rect = btn.getBoundingClientRect();
  root.style.left = `${rect.left}px`;
  root.style.top = `${rect.bottom + 4}px`;
  fitInViewport(root);
  activeLinkPop = { name, root };
  const onDocPointer = (e: PointerEvent): void => {
    const t = e.target as Node;
    if (root.contains(t) || btn.contains(t)) return; // 弹出内 / 按钮上不关
    closeLinkPop();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") closeLinkPop();
  };
  linkPopClose = () => {
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onKey);
    root.remove();
    if (activeLinkPop?.root === root) activeLinkPop = null;
  };
  document.addEventListener("pointerdown", onDocPointer, true); // capture：先于按钮 click 生效
  document.addEventListener("keydown", onKey);
  void loadChannelItems(root, name, ctx);
}

async function loadChannelItems(root: HTMLElement, name: string, ctx: ParamBindCtx): Promise<void> {
  const body = root.querySelector<HTMLElement>(".cyl-param-link-pop-body");
  if (!body) return;
  let items: { path: string; label: string }[];
  try {
    items = await ctx.listChannels();
  } catch {
    if (body.isConnected) body.innerHTML = `<div class="cyl-param-link-empty">通道列表加载失败</div>`;
    return;
  }
  if (!body.isConnected) return; // 弹出已关闭（Esc / 外部点击）→ 不再更新
  if (items.length === 0) {
    body.innerHTML = `<div class="cyl-param-link-empty">无 param 通道（吊牌注册后 cook 生效）</div>`;
    return;
  }
  body.innerHTML = items
    .map(
      (c) =>
        `<button type="button" class="cyl-param-link-item" data-path="${attrEscape(c.path)}" title="${attrEscape(c.path)}">${esc(c.label || tailOfPath(c.path))}</button>`,
    )
    .join("");
  // 绑定可能在弹出期间被外部更新（H→C 同步等）→ 追加「解除链接」入口
  if (ctx.bindings[name]) {
    const unlink = document.createElement("button");
    unlink.type = "button";
    unlink.className = "cyl-param-link-unlink";
    unlink.textContent = "解除链接";
    body.appendChild(unlink);
    unlink.addEventListener("click", () => {
      closeLinkPop();
      ctx.onBind(name, null);
    });
  }
  for (const item of body.querySelectorAll<HTMLButtonElement>(".cyl-param-link-item")) {
    item.addEventListener("click", () => {
      const path = item.getAttribute("data-path") ?? "";
      if (!path) return;
      closeLinkPop();
      ctx.onBind(name, path);
    });
  }
}

/**
 * Render the param panel into `el`.
 * - info === null -> no selected node -> "未选择节点" empty state.
 * - info.params empty -> v1 reserved empty state.
 * - otherwise -> dark table with name / type / value columns; the value cell
 *   holds an editable control that fires onChange with the rebuilt params array.
 * - bindCtx（可选，P5b）-> 参数名旁渲染 ⛓ 链接按钮：未绑定灰（点击弹出通道列表绑定），
 *   已绑定绿（title = absolutePath，点击直接解除）；不传时行为与旧版完全一致。
 */
export function renderParams(
  el: HTMLElement,
  info: ParamPanelInfo | null,
  onChange?: (params: ParamInfo[]) => void,
  bindCtx?: ParamBindCtx,
): void {
  closeLinkPop(); // 面板重渲染（选中变化 / 绑定变化）时收起旧弹出，防孤立 DOM
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
    .map((p) => {
      // P5b：参数名旁 ⛓ 链接按钮（未绑定灰 / 已绑定绿 + title = absolutePath）
      const boundPath = bindCtx?.bindings[p.name] ?? null;
      const linkBtn = bindCtx
        ? `<button type="button" class="cyl-param-link${boundPath ? " bound" : ""}" data-link-name="${attrEscape(p.name)}" title="${boundPath ? attrEscape(boundPath) : "绑定到通道（channel reference）"}" aria-label="绑定 ${esc(p.name)} 到通道">⛓</button>`
        : "";
      return `<tr><td>${linkBtn}${esc(p.name)}</td><td>${esc(p.type)}</td><td>${controlHtml(p, info)}</td></tr>`;
    })
    .join("");
  el.innerHTML = `<div class="cyl-param">
    <div class="cyl-param-head">${head}</div>
    <table class="cyl-param-table">
      <thead><tr><th>name</th><th>type</th><th>value</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;

  // `port` 动态下拉：接桥取端口清单（onChange 之外也要接——只读面板同样该显示真清单）
  wirePortMenu(el, info);

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

  // P5b：⛓ 链接按钮交互（bindCtx 注入时）。已绑定（绿）点击 = 直接解除并收起；
  // 未绑定（灰）点击 = 打开内联通道列表（同一参数再点 = 收起）。
  if (bindCtx) {
    const linkBtns = Array.from(el.querySelectorAll<HTMLButtonElement>(".cyl-param-link"));
    for (const btn of linkBtns) {
      const name = btn.getAttribute("data-link-name") ?? "";
      btn.addEventListener("click", () => {
        if (bindCtx.bindings[name]) {
          // 已绑定：直接解除链接并收起（「解除链接」快捷入口）
          closeLinkPop();
          bindCtx.onBind(name, null);
          return;
        }
        // 未绑定：打开通道列表弹出；同一参数已开则收起（toggle）
        if (activeLinkPop?.name === name) {
          closeLinkPop();
          return;
        }
        openLinkPop(btn, name, bindCtx);
      });
    }
  }
}
