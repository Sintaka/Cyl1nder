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
 * #5/#6（v0.1.00121）：参数右键引用菜单（复制 / 粘贴相对 / 粘贴绝对）+ transform 的
 * tx/ty/tz 合成一行 vec3（行首 `T`）。两条需求共用同一套引用寻址，见下方「参数引用菜单」块。
 * Pure DOM string rendering - no framework.
 */

import { attachScrub, format4 } from "./scrub";
// parseParamRef 是 #4/#5/#6 共用的**唯一**引用解析器（web/src/nodes2/param-ref.ts）——
// 本面板不另写一套「什么算合法地址」，只调它。
import { parseParamRef } from "../nodes2/param-ref";
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

// ---------------------------------------------------------------------------
// vec3 成组（#6）：transform 的 tx/ty/tz 合成**一行**，行首标 `T`
//
// 用户要求：「三个 float 应该包含在一行, 前面是 T」，且「右键 tx 的输入框复制的是 tx
// 而不是 translate，右键那个 T 才是 vec3」。所以这是**纯显示层成组**：
//
//   - 底层 params 仍是三个独立 float（graph-model 的 makeTransformNode 一个字没动，
//     那是别人的写集）。成组只改 DOM 形状，不改数据形状 —— 于是序列化、undo、
//     chain-cache 的 tx/ty/tz 快路径、gizmo 的 readParamFloats 全部零影响。
//   - 每个分量**仍是自己的 `<input data-name="tx">`**。这一条是硬约束：8 个 e2e spec
//     用 `.cyl-param-table input[data-name="tx"]` 这个**后代选择器** + `.fill()` 驱动
//     （round2/7/12/15/19 等）。它们不关心中间套了几层 td/span，只要那个 input 还在表里
//     带着同名 data-name 就照常工作。把三个 float 塞进一个 text 框（"x,y,z" 形式）会
//     一次性打断这 8 个 spec，收益是零。
//
// 组名 `t` 而非 `translate`：映射系统的约定是「vec3 无分量后缀、float 带后缀」
// （devlog/project-mapping-design.md:81「有后缀 → float，无后缀 → vec3」），
// tx/ty/tz 的公共前缀就是 `t`，所以 vec3 地址 = `transform1/t`、分量 = `transform1/tx`。
// 显示标签用大写 `T`（用户原话「前面是 T」），机器标识仍是小写 `t`。
// ---------------------------------------------------------------------------

/** 一个 vec3 组：机器名（`t`）、显示标签（`T`）、按 x/y/z 顺序的三个分量参数名。 */
export interface VecGroup {
  name: string;
  label: string;
  members: [string, string, string];
}

/** 按 kind 声明哪些参数要成组。**只有 transform 的 t**：用户只要求包 t，
 *  px/py/pz（pivot）保持散开 —— 没被要求的事不顺手做，改了就得连带改 gizmo 的读法。 */
const VEC_GROUPS: Record<string, readonly VecGroup[]> = {
  transform: [{ name: "t", label: "T", members: ["tx", "ty", "tz"] }],
};

/**
 * 决定这个面板要不要成组，以及成组成什么样（**纯函数**，可直接单测）。
 *
 * 只有三个分量**全部存在且全是 float** 才成组。缺一个（旧图 / 别的 kind 复用了 tx 名）
 * 就退回三行散开：宁可显示得朴素，也不要渲染出一个只有两格的"vec3"骗人。
 */
export function planVecGroups(info: ParamPanelInfo): VecGroup[] {
  const declared = VEC_GROUPS[info.kind ?? ""] ?? [];
  const byName = new Map(info.params.map((p) => [p.name, p]));
  return declared.filter((g) =>
    g.members.every((m) => {
      const p = byName.get(m);
      return !!p && (p.type === "float" || p.type === "int");
    }),
  );
}

/**
 * 面板的行计划：每行要么是一个普通参数，要么是一个 vec3 组（**纯函数**，可直接单测）。
 *
 * 组行的位置 = 其**首个分量原来的位置**（transform 里就是 px/py/pz 之后），
 * 其余分量从流里摘掉。这样行序仍是用户熟悉的顺序，而不是把组一律甩到表尾。
 */
export type ParamRow = { kind: "param"; param: ParamInfo } | { kind: "vec"; group: VecGroup; params: ParamInfo[] };

export function planParamRows(info: ParamPanelInfo): ParamRow[] {
  const groups = planVecGroups(info);
  // 分量名 → 它属于哪个组；用于「首个分量出组行、其余跳过」
  const memberOf = new Map<string, VecGroup>();
  for (const g of groups) for (const m of g.members) memberOf.set(m, g);
  const byName = new Map(info.params.map((p) => [p.name, p]));
  const rows: ParamRow[] = [];
  const emitted = new Set<string>();
  for (const p of info.params) {
    const g = memberOf.get(p.name);
    if (!g) {
      rows.push({ kind: "param", param: p });
      continue;
    }
    if (emitted.has(g.name)) continue; // 该组的行已经出过（当前是第 2/3 个分量）
    emitted.add(g.name);
    rows.push({ kind: "vec", group: g, params: g.members.map((m) => byName.get(m)!) });
  }
  return rows;
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
// 参数引用菜单（#5）：右键一个 parm → 复制当前 param / 粘贴相对参考地址 / 粘贴绝对地址
//
// 用户原话：「我如果右键一个 parm, 出现复制当前 param, 粘贴相对参考 param 地址,
// 粘贴绝对 param 地址 三个选项」。设计对齐 Houdini 的 RMB Copy/Paste reference
// （devlog/tag-hda-plan.md:82 已把它记为 P5b 的设计参考）。
//
// ## 剪贴板为什么是模块级结构体，而不是系统剪贴板
//
// 复制的不只是一串文本，还有「它是 float 还是 vec3」「它的绝对形式是什么」——
// 粘贴到 tx 时要据此决定补不补 `.x`。系统剪贴板只能存文本，读还是异步 + 权限门，
// 在 node 环境的 vitest 里根本不存在。所以**结构化状态留在模块里**，同时
// best-effort 往系统剪贴板写一份文本（用户想粘到别处/发给别人时有东西可粘），
// 写失败静默忽略：那只是附加便利，不是本功能的通路。
//
// ## 相对 vs 绝对
//
// - **相对**（`transform1/t`）：映射系统的原生形态。桥侧 `rel` 就是「相对**吊牌所在
//   网络**的地址」（devlog/protocol.md:61），capabilities 给吊牌端口的 key 也正是这种
//   逻辑名（`transform1/tx`）。所以相对形式**不带 `../`**：它相对的是网络，不是节点。
// - **绝对**（`/obj/geo1/transform1/t`）：完整 Houdini 路径。只有在能拿到网络前缀时
//   才给得出——见 absoluteAddress 的两个来源。拿不到就把该菜单项**禁用并写明原因**，
//   绝不拼一个半截路径出去（半截路径会被当成合法输入存进图里，之后无声失效）。
// ---------------------------------------------------------------------------

/** 一次「复制当前 param」的产物。`kind` 决定粘到 float 槽时补不补分量后缀。 */
export interface ParamRefClip {
  /** 相对地址（`transform1/t` / `transform1/tx`）。 */
  relative: string;
  /** 绝对地址（`/obj/geo1/transform1/tx`）；拿不到网络前缀时 null。 */
  absolute: string | null;
  /** 被复制的是整个 vec3 还是单个 float。 */
  kind: "float" | "vec3";
  /** 源参数显示名（菜单文案回显用，如 `T` / `tx`）。 */
  label: string;
}

/** 引用上下文（renderParams 第 5 参，可选）。不传时：复制照常可用（相对形式不需要它），
 *  绝对形式因拿不到 netPath 而禁用，粘贴则退到 bindCtx 通路（见 resolvePasteSink）；
 *  每种降级的原因都写进菜单项 title，不静默。 */
export interface ParamRefCtx {
  /** 本节点所在的 Houdini 网络绝对路径（如 `/obj/geo1`），用于拼绝对地址。空/缺省 =
   *  未知 → 绝对相关菜单项禁用（而不是拼半截路径）。 */
  netPath?: string;
  /** 本节点标签（如 `transform1`）：相对地址的第一段。缺省时退回 info.label。 */
  nodeLabel?: string;
  /** 粘贴落地。**这是引用真正被持久化的地方**；不传则粘贴项禁用并说明原因。 */
  onPasteRef?: (target: ParamRefTarget, ref: ParamRefClip, form: "relative" | "absolute") => void;
}

/** 粘贴目标：哪个参数、它是 float 还是 vec3、若是 vec3 分量则它是第几个。 */
export interface ParamRefTarget {
  /** 参数名（`tx`）或组名（`t`）。 */
  name: string;
  kind: "float" | "vec3";
  /** vec3 组的三个分量参数名（kind==="vec3" 时有值），供落地方逐分量写入。 */
  members?: string[];
  /** 该参数在其 vec3 组里的下标（0=x）；不属于任何组时 null。 */
  componentIndex: number | null;
}

/** 复制时的当前剪贴板（模块级单例：面板重渲染 / 切换选中都不该清空它——
 *  跨节点粘贴正是这个功能的主要用途）。 */
let refClip: ParamRefClip | null = null;

/** 测试与调试用：读当前剪贴板（不导出 setter，写入只经 copyParamRef 一条路）。 */
export function currentParamRefClip(): ParamRefClip | null {
  return refClip;
}

/**
 * 拼相对地址：`<节点标签>/<参数或组名>`（**不带 `../`**，见上方块）。
 *
 * 节点标签缺失（未命名节点）时返回裸参数名：那仍是一个合法的相对地址（同网络内
 * 同名参数），比拼出 `undefined/tx` 诚实。
 */
export function relativeAddress(nodeLabel: string | null | undefined, member: string): string {
  const label = (nodeLabel ?? "").trim();
  return label ? `${label}/${member}` : member;
}

/**
 * 拼绝对地址：`<网络路径>/<相对地址>`。
 *
 * `netPath` 空 → null（调用方据此禁用菜单项）。末尾斜杠归一，避免 `/obj/geo1//transform1/tx`。
 */
export function absoluteAddress(netPath: string | null | undefined, relative: string): string | null {
  const base = (netPath ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/${relative}`;
}

/**
 * 把剪贴板里的引用**适配到粘贴目标**（纯函数，可直接单测）。
 *
 * 四种组合，只有一种要改写地址：
 *   - float → float：原样（`transform1/tx` 进 tx）。**这就是验收用例**「拿 transform
 *     节点去修改映射通道的那个 tx」走的那条路。
 *   - vec3 → vec3：原样（整个 vec3 跟整个 vec3）。
 *   - vec3 → float：**补目标自己的分量后缀**。右键 T 复制得到 `transform1/t`，粘到 ty
 *     应该是 `transform1/t.y` —— 分量取**目标的**下标，不是源的。
 *   - float → vec3：拒绝（返回 null + 原因）。一个标量填不满三个分量，Houdini 会把同一
 *     引用复制进三格，但那在这里是歧义操作（用户到底想 (v,v,v) 还是只改 x？），
 *     宁可禁用并说明，也不要猜。
 */
export function adaptRefToTarget(
  clip: ParamRefClip,
  target: ParamRefTarget,
  form: "relative" | "absolute",
): { ok: true; expression: string } | { ok: false; reason: string } {
  const base = form === "absolute" ? clip.absolute : clip.relative;
  if (!base) return { ok: false, reason: "该引用没有绝对地址（网络路径未知）" };
  if (clip.kind === "float" && target.kind === "vec3") {
    return { ok: false, reason: `「${clip.label}」是单个 float，填不满 vec3 的三个分量` };
  }
  if (clip.kind === "vec3" && target.kind === "float") {
    const idx = target.componentIndex ?? 0;
    const letter = "xyzw"[idx] ?? "x";
    return { ok: true, expression: `${base}.${letter}` };
  }
  return { ok: true, expression: base };
}

/**
 * 粘贴「落地」到哪条通路（**纯函数**，可直接单测）。
 *
 * 引用要能持久化才算粘贴成功。今天仓库里只有**一条**已接线的引用落地通路：P5b 的
 * `bindings`（paramName → 通道 **absolutePath**），main.ts 已经装配好 bindCtx.onBind。
 * 于是三种情况：
 *
 *   - `"paste-ref"`：refCtx.onPasteRef 已接线 → 走它（最完整，相对/绝对都能存）。
 *   - `"bind"`：没接 onPasteRef，但这次粘贴**恰好等价于一条 P5b 绑定** → 走 onBind。
 *     等价的条件很窄，三条全中才算：
 *       1. 绝对形式（bindings 存的就是 absolutePath，相对地址放进去会被 PUT 成
 *          一个不存在的 Houdini 路径）；
 *       2. 目标是单个 float（bindings 一个键一个参数，vec3 三分量不是一次 onBind 能表达的）；
 *       3. 表达式**不带分量后缀**（`/obj/geo1/transform1/tx` 是真 parm 路径；
 *          `…/t.x` 不是——分量形式只对 apex 控制器成立，见 annotations-bridge.md:163）。
 *     这一条正是验收用例「拿 transform 节点去修改映射通道的那个 tx」：float → float
 *     的绝对粘贴，今天就能落地。
 *   - `null`：没有可用通路 → 菜单项禁用 + 写明原因（绝不假装粘上了）。
 *
 * **相对形式为什么不降级成绝对再走 bind**：那会静默丢掉相对引用的全部意义（跟随改名 /
 * 复制子网指向副本自己）。用户要的是相对引用，给他一条绝对绑定却告诉他"粘好了"，
 * 是最坏的一种"成功"。
 */
export function resolvePasteSink(
  target: ParamRefTarget,
  form: "relative" | "absolute",
  expression: string,
  has: { onPasteRef: boolean; onBind: boolean },
): "paste-ref" | "bind" | null {
  if (has.onPasteRef) return "paste-ref";
  if (!has.onBind) return null;
  if (form !== "absolute") return null;
  if (target.kind !== "float") return null;
  const parsed = parseParamRef(expression);
  if (!parsed.ok || parsed.components.length > 0) return null;
  return "bind";
}

/** 落地通路缺失时的禁用原因（分开写：用户/装配者能做的事不同）。 */
export function pasteDisabledReason(target: ParamRefTarget, form: "relative" | "absolute"): string {
  if (form === "relative") {
    return "相对引用尚无落地通路：P5b bindings 只存绝对通道路径（需 refCtx.onPasteRef）";
  }
  if (target.kind !== "float") return "vec3 目标需 refCtx.onPasteRef（一次 onBind 只能绑一个参数）";
  return "带分量后缀的引用需 refCtx.onPasteRef（bindings 只接受真实 parm 路径）";
}

/** 菜单项的最终形态（禁用态带原因；**纯函数产物**，可直接单测）。 */
export interface RefMenuItem {
  id: "copy" | "paste-relative" | "paste-absolute";
  label: string;
  enabled: boolean;
  /** 禁用原因 / 启用时的目标表达式，都进 title。 */
  title: string;
  /** 启用且是粘贴项时，落地要写的表达式。 */
  expression?: string;
  /** 启用时走哪条落地通路（见 resolvePasteSink）。 */
  sink?: "paste-ref" | "bind";
}

/**
 * 构造三个菜单项（**纯函数**：不碰 DOM，可直接单测）。
 *
 * 禁用永远带原因。三条禁用来源各自独立，文案也分开——用户能做的事完全不同：
 *   - 还没复制过 → 去右键一个 parm 复制
 *   - 类型不匹配（float → vec3）→ 换个目标
 *   - 没有落地通路（onPasteRef 未接线）/ 网络路径未知 → 这是装配缺失，不是用户操作问题
 */
export function buildRefMenuItems(
  target: ParamRefTarget,
  clip: ParamRefClip | null,
  /** 有哪些落地通路（见 resolvePasteSink）。缺省 = 两条都有（纯 UI 测试用）。 */
  sinks: { onPasteRef: boolean; onBind: boolean } = { onPasteRef: true, onBind: true },
): RefMenuItem[] {
  const items: RefMenuItem[] = [
    {
      id: "copy",
      label: `复制当前 param（${target.name}）`,
      enabled: true,
      title: `复制 ${target.name} 的引用地址（${target.kind}）`,
    },
  ];
  for (const form of ["relative", "absolute"] as const) {
    const id = form === "relative" ? "paste-relative" : "paste-absolute";
    const label = form === "relative" ? "粘贴相对参考 param 地址" : "粘贴绝对 param 地址";
    if (!clip) {
      items.push({ id, label, enabled: false, title: "剪贴板为空：先右键某个 param「复制当前 param」" });
      continue;
    }
    // **不能粘给自己**（v0.1.00127，用户明确要求：「注意它不能粘贴给自己, 否则报错」）。
    //
    // 自引用是一条恒等依赖：这个参数的值等于它自己 —— 求值时要么原地不动、要么在
    // 「读快照 + 末尾 flush」语义下把自己写成上一趟的值，两种都只会让人困惑。
    // 判据用 `clip.relative === target.name`（同一节点同一参数），而不是比 kind 或
    // 绝对路径：绝对路径在 netPath 未知时是空的，拿它判会漏。
    if (clip.relative === target.name) {
      items.push({
        id,
        label,
        enabled: false,
        title: `不能把「${target.name}」粘贴给自己（自引用）——请选另一个参数`,
      });
      continue;
    }
    const adapted = adaptRefToTarget(clip, target, form);
    if (!adapted.ok) {
      items.push({ id, label, enabled: false, title: adapted.reason });
      continue;
    }
    // 落地前用共用解析器验一遍自己拼出来的串。拼错（分量混用 / 空地址）应该在这里
    // 就变成禁用 + 原因，而不是写进图里之后再被别处判非法。
    const parsed = parseParamRef(adapted.expression);
    if (!parsed.ok) {
      items.push({ id, label, enabled: false, title: `引用非法：${parsed.reason}` });
      continue;
    }
    const sink = resolvePasteSink(target, form, adapted.expression, sinks);
    if (!sink) {
      items.push({ id, label, enabled: false, title: pasteDisabledReason(target, form) });
      continue;
    }
    items.push({
      id,
      label,
      enabled: true,
      title: `${label} → ${adapted.expression}${sink === "bind" ? "（经 P5b 通道绑定落地）" : ""}`,
      expression: adapted.expression,
      sink,
    });
  }
  return items;
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
  closeRefMenu(); // #5 引用右键菜单也是弹层：两者互斥（否则点 ⛓ 会留下悬着的右键菜单）
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

/** 当前引用右键菜单（单例，照 link pop 的做法）。 */
let refMenuClose: (() => void) | null = null;

function closeRefMenu(): void {
  if (refMenuClose) {
    const close = refMenuClose;
    refMenuClose = null;
    close();
  }
}

/**
 * 从右键事件定位引用目标 —— **「右键 T」与「右键 tx 输入框」的分界就在这里**。
 *
 * 判据：从事件目标向上找**最近的** `[data-ref-name]`。锚点只挂在 name 单元格的 span
 * 与 vec3 行的轴标 span 上，两者互不嵌套：
 *   - 右键 `T` → 命中组锚点（`data-ref-kind="vec3"`）→ 目标是整个 vec3
 *   - 右键 `x` 轴标 → 命中该分量锚点（float）
 *   - 右键 tx 的 `<input>` → input **不在任何锚点内部**，closest 拿不到 → 回退到
 *     「按 input 自己的 data-name 找同名参数」，于是拿到的是 **tx（float）**，不是 T。
 * 这条回退是必需的：用户说的就是「右键 tx 的输入框应该复制的是 tx」，而输入框本身
 * 不该被包进组锚点里（包进去 = 右键输入框变成复制 vec3，正是要避免的那个错）。
 */
function refTargetFromEvent(ev: Event, info: ParamPanelInfo): ParamRefTarget | null {
  const el = ev.target as Element | null;
  if (!el) return null;
  const groups = planVecGroups(info);
  const indexOf = (name: string): number | null => {
    for (const g of groups) {
      const i = g.members.indexOf(name);
      if (i >= 0) return i;
    }
    return null;
  };
  const anchor = el.closest<HTMLElement>("[data-ref-name]");
  if (anchor) {
    const name = anchor.getAttribute("data-ref-name") ?? "";
    const kind = anchor.getAttribute("data-ref-kind") === "vec3" ? "vec3" : "float";
    const members = anchor.getAttribute("data-ref-members")?.split(",").filter(Boolean);
    return { name, kind, members, componentIndex: kind === "float" ? indexOf(name) : null };
  }
  // 控件本身（input/select）：按它的 data-name 当 float 目标
  const ctrl = el.closest<HTMLElement>("[data-name]");
  const name = ctrl?.getAttribute("data-name") ?? "";
  if (!name) return null;
  return { name, kind: "float", componentIndex: indexOf(name) };
}

/** 复制：写模块剪贴板 + best-effort 写系统剪贴板（失败静默，见上方设计块）。 */
function copyParamRef(target: ParamRefTarget, info: ParamPanelInfo, refCtx?: ParamRefCtx): void {
  const nodeLabel = refCtx?.nodeLabel ?? info.label;
  const relative = relativeAddress(nodeLabel, target.name);
  refClip = {
    relative,
    absolute: absoluteAddress(refCtx?.netPath, relative),
    kind: target.kind,
    label: target.name,
  };
  try {
    void navigator.clipboard?.writeText(refClip.absolute ?? relative);
  } catch {
    /* 系统剪贴板不可用（无权限 / 非安全上下文）→ 模块剪贴板照常可用，不打断流程 */
  }
}

/** 弹出引用右键菜单（三项；禁用项灰显且 title 写明原因）。 */
function openRefMenu(
  x: number,
  y: number,
  target: ParamRefTarget,
  info: ParamPanelInfo,
  refCtx: ParamRefCtx | undefined,
  sinks: { onPasteRef: boolean; onBind: boolean },
  onPaste: (item: RefMenuItem, form: "relative" | "absolute") => void,
): void {
  closeRefMenu();
  closeLinkPop(); // 两个弹层不同时存在（照 link pop 的单例约定）
  const items = buildRefMenuItems(target, refClip, sinks);
  const root = document.createElement("div");
  root.className = "cyl-param-ref-menu";
  root.setAttribute("role", "menu");
  root.setAttribute("aria-label", `${target.name} 引用操作`);
  root.innerHTML = items
    .map(
      (it) =>
        `<button type="button" role="menuitem" class="cyl-param-ref-item${it.enabled ? "" : " disabled"}" data-ref-item="${it.id}"${it.enabled ? "" : " disabled aria-disabled=\"true\""} title="${attrEscape(it.title)}">${esc(it.label)}</button>`,
    )
    .join("");
  document.body.appendChild(root);
  root.style.left = `${x}px`;
  root.style.top = `${y}px`;
  fitInViewport(root);
  const onDocPointer = (e: PointerEvent): void => {
    if (root.contains(e.target as Node)) return;
    closeRefMenu();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") closeRefMenu();
  };
  refMenuClose = () => {
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onKey);
    root.remove();
  };
  document.addEventListener("pointerdown", onDocPointer, true);
  document.addEventListener("keydown", onKey);
  for (const btn of root.querySelectorAll<HTMLButtonElement>(".cyl-param-ref-item")) {
    const id = btn.getAttribute("data-ref-item") ?? "";
    const item = items.find((it) => it.id === id);
    if (!item?.enabled) continue;
    btn.addEventListener("click", () => {
      closeRefMenu();
      if (item.id === "copy") {
        copyParamRef(target, info, refCtx);
        return;
      }
      onPaste(item, item.id === "paste-relative" ? "relative" : "absolute");
    });
  }
}

/**
 * 把引用右键菜单接到面板（#5）。整个表**一个** contextmenu 监听（事件委托）。
 *
 * **必须挂在 table 上，不能挂在 `el` 上**：`el` 是外部传进来的常驻容器，renderParams
 * 只替换它的 innerHTML —— 挂 el 上的监听不会随 innerHTML 消失，于是每次重渲染叠一个，
 * 切 10 次选中就有 10 个 handler（右键一次弹 10 次菜单）。table 是本函数每次新建的，
 * 随 innerHTML 一起被丢弃，监听自然随之消失。本文件其它 handler 也都挂在新建子元素上。
 */
function wireRefMenu(el: HTMLElement, info: ParamPanelInfo, refCtx?: ParamRefCtx, bindCtx?: ParamBindCtx): void {
  const table = el.querySelector<HTMLElement>(".cyl-param-table");
  if (!table) return; // 空状态面板（无参数）没有表 → 没有可右键的 parm
  const sinks = { onPasteRef: !!refCtx?.onPasteRef, onBind: !!bindCtx };
  table.addEventListener("contextmenu", (ev) => {
    const target = refTargetFromEvent(ev, info);
    if (!target) return; // 表格空白处右键 → 交给浏览器原生菜单
    ev.preventDefault();
    const me = ev as MouseEvent;
    openRefMenu(me.clientX, me.clientY, target, info, refCtx, sinks, (item, form) => {
      if (!item.expression || !refClip) return;
      if (item.sink === "bind") {
        // 绝对 + 单 float + 无分量后缀 → 等价于一条 P5b 通道绑定（见 resolvePasteSink）
        bindCtx?.onBind(target.name, item.expression);
        return;
      }
      refCtx?.onPasteRef?.(target, refClip, form);
    });
  });
}

// ---------------------------------------------------------------------------
// 聚焦保护（v0.1.00128）：**正在被编辑的输入框绝不能被重渲染冲掉**
//
// 病象（用户原话）：「我需要按下数字并且在极短的时间内按下回车才能把值写回 houdini」。
// 实测链路（e2e 探针：慢速输入 "123" → 框里只剩 "1"、焦点落在 BODY）：
//   keydown "1" → input 事件 → commit → onChange → graph.setNodeParams + network.run()
//   → store 通知 → pendingFlush → 下一帧 rAF → flushStoreView → dataflow.flush()
//   → refreshSelectionPanels() → renderParams() → `el.innerHTML = …`
// innerHTML 重写把**正在聚焦的那个 <input> 整个丢掉**，焦点退回 body，于是第 2、3 个
// 字符根本没有收件人。用户"极短时间内按回车"能成，只是因为两个按键挤在同一帧里、
// 抢在 rAF 之前落地 —— 那是撞运气，不是可用的交互。
//
// 为什么选「聚焦时不重渲染」而不是防抖：
//   防抖只是把窗口从 16ms 拉长到 N ms —— 打字慢一点、或某次 cook 卡一下，同样的丢字
//   照样发生，而且变成偶发（更难查）。焦点是一个**确定的信号**：这个控件里有用户尚未
//   离开的编辑意图，此刻面板的真源是 DOM 而不是 store。所以按焦点门控，不按时间。
// ---------------------------------------------------------------------------

/** 会承载「未离开的编辑意图」的控件标签。 */
const EDITABLE_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

/** 单个参数值是否相等（数组逐元素比；其余用 ===）。vector/color3 的值是数组，
 *  引用比会把"每次 applyEdit 都新建数组"误判成"值变了"，于是空提交永远拦不住。 */
function valueEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

/**
 * 两组参数在**值层面**是否完全相同（纯函数，可直接单测）。
 *
 * 用来丢弃空提交（见 commitParams）与判定"外部改值"（见 shouldDeferParamRender）。
 * 只比 name/value：`type` 由渲染决定、`default` 是代码侧常量，两者都不是"用户改了什么"
 * 的一部分；顺序按下标比，因为 applyEdit 是 map 出来的，恒定保序。
 *
 * **与 core/params.paramsEqual 的区别（别混用）**：那个用 `p.value === q.value`，对
 * vector/color3 是**引用比** —— 而 applyEdit 每次都新建值数组，所以它会把"值没变"判成
 * "变了"，空提交就永远拦不住。这里逐元素比，正是为了拦住它。
 */
export function paramValuesEqual(a: ParamInfo[], b: ParamInfo[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.name === b[i].name && valueEqual(p.value, b[i].value));
}

/**
 * 焦点此刻是否落在**这个面板的参数表**里的可编辑控件上（结构化入参，可直接单测）。
 *
 * 入参故意只要求 `contains` / `tagName` / `closest` 三个成员而不是 HTMLElement：
 * vitest 环境是 node 且没装 jsdom，真 DOM 类型进不来。判据仍是真的那一条 ——
 * 「标签可编辑」且「在 `.cyl-param-table` 内」且「那张表属于本面板」。
 * 第三条不能省：同页可能有第二个参数面板，别人的输入框不该冻结我的重渲染。
 */
export function isParamEditorFocused(
  panel: { contains(node: never): boolean } | null | undefined,
  active: { tagName?: string; closest?(sel: string): unknown } | null | undefined,
): boolean {
  if (!panel || !active) return false;
  if (!EDITABLE_TAGS.has(String(active.tagName ?? "").toUpperCase())) return false;
  const table = active.closest?.(".cyl-param-table") ?? null;
  if (!table) return false;
  return panel.contains(table as never);
}

/**
 * 这次重渲染该不该推迟（**纯函数**，可直接单测）。
 *
 * 三个条件**全中**才推迟。任一不中都必须照渲：
 *   - **换节点**（nextNodeId !== renderedNodeId）：宁可打断打字，也绝不让面板显示
 *     A 节点的标题配 B 节点的值 —— 那会让人把值改到错误的节点上。
 *   - **没有已渲染节点 / 目标为空**：没有"正在编辑的上下文"可保护。
 *   - **值被外部改了**（valuesUnchanged === false）：这是最要紧的一条，见下。
 *
 * ## 为什么"聚焦"单独一条不够（v0.1.00128 修正）
 *
 * 只看焦点会把 undo/redo 也一起推迟掉：Ctrl+Z 让图回到 tx=0，但输入框还聚焦着，于是
 * 面板不重画、框里仍显示 5 —— 图和界面公开地不一致，而且"撤销了但看不见"比原 bug 更
 * 难理解。实测（探针：保持 tx 聚焦再 undo）就是 `{graphTx: 0, domTx: "5"}`。
 *
 * 正确的判据是**这次刷新带来的值是不是面板自己刚提交的那一份**：
 *   - 是（valuesUnchanged）→ DOM 已经显示着这些值，重画只会白毁焦点 → 推迟；
 *   - 不是 → 值从别处来（undo/redo / H→C 同步 / 通道回写）→ **必须**照渲。
 * 这样 undo/redo 不需要任何特例：它天然带来不同的值。所有"外部改值"都同一条路径覆盖，
 * 而不是只修被 spec 抓到的那一种。
 */
export function shouldDeferParamRender(g: {
  renderedNodeId: string | null;
  nextNodeId: string | null;
  editorFocused: boolean;
  /** 本次刷新的值与面板最后一次自己提交的值相同吗（外部改值 = false）。 */
  valuesUnchanged: boolean;
}): boolean {
  if (!g.editorFocused) return false;
  if (!g.valuesUnchanged) return false; // 外部改了值 → 必须重画（undo/redo 走这条）
  if (!g.nextNodeId || !g.renderedNodeId) return false;
  return g.nextNodeId === g.renderedNodeId;
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
  refCtx?: ParamRefCtx,
): void {
  closeLinkPop(); // 面板重渲染（选中变化 / 绑定变化）时收起旧弹出，防孤立 DOM
  closeRefMenu(); // 同上：右键菜单也是弹层，重渲染必须收起
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

  // P5b：参数名旁 ⛓ 链接按钮（未绑定灰 / 已绑定绿 + title = absolutePath）
  const linkBtnHtml = (name: string): string => {
    const boundPath = bindCtx?.bindings[name] ?? null;
    return bindCtx
      ? `<button type="button" class="cyl-param-link${boundPath ? " bound" : ""}" data-link-name="${attrEscape(name)}" title="${boundPath ? attrEscape(boundPath) : "绑定到通道（channel reference）"}" aria-label="绑定 ${esc(name)} 到通道">⛓</button>`
      : "";
  };

  // #5：name 单元格里的可右键锚点。`data-ref-name` **只挂在这个 span 上**，
  // 不挂在 input 或其祖先上 —— 这正是「右键 T 得到 vec3、右键 tx 的输入框得到 float」
  // 的判据（见 refTargetFromEvent）。
  const refAnchor = (name: string, label: string, kind: "float" | "vec3", members?: string[]): string =>
    `<span class="cyl-param-ref-anchor" data-ref-name="${attrEscape(name)}" data-ref-kind="${kind}"${
      members ? ` data-ref-members="${attrEscape(members.join(","))}"` : ""
    } title="右键：复制 / 粘贴引用地址">${esc(label)}</span>`;

  const rows = planParamRows(info)
    .map((row) => {
      if (row.kind === "param") {
        const p = row.param;
        return `<tr><td>${linkBtnHtml(p.name)}${refAnchor(p.name, p.name, "float")}</td><td>${esc(p.type)}</td><td>${controlHtml(p, info)}</td></tr>`;
      }
      // #6 vec3 行：行首 `T` 是**组**的引用锚点（vec3），三个分量各自仍是独立 input，
      // 各自带自己的 float 锚点（轴标 x/y/z）——右键轴标 = 右键那个分量。
      //
      // **⛓ 挂在每个分量上，不挂在组名 `T` 上**：P5b 绑定是 paramName → 通道路径，而
      // channel-bind 的 applyIncoming 用 `node.params` 按名字查值（channel-bind.ts:151）。
      // `t` 不是真参数名，绑到它会生成一条**永远匹配不上**的死绑定（H→C 回显查不到、
      // C→H 提交也取不到值），且不报错——正是最难查的那种。所以 vec3 行保留三个 ⛓，
      // 每个绑各自的分量通道。
      const g = row.group;
      const cells = row.params
        .map(
          (p, i) =>
            // `data-ref-name` 挂在**整个分量格**上（v0.1.00129，用户 #1a）：
            // 此前只有那个极小的 `x` 标签带锚点，于是右键分量格的空白处
            // `closest("[data-ref-name]")` 什么都找不到 —— 用户被迫去点那个小 x。
            // 挂在**每个分量各自的**包裹 span 上是安全的：它解析出的仍是 `tx`，
            // 而组锚点（`T` → vec3）在另一个 `<td>` 里，两者不会互相吃掉。
            `<span class="cyl-param-vec-comp" data-ref-name="${attrEscape(p.name)}" data-ref-kind="float">` +
              `${linkBtnHtml(p.name)}${refAnchor(p.name, "xyz"[i], "float")}${controlHtml(p, info)}</span>`,
        )
        .join("");
      return `<tr class="cyl-param-vec-row"><td>${refAnchor(g.name, g.label, "vec3", g.members)}</td><td>vec3</td><td><span class="cyl-param-vec" data-vec-group="${attrEscape(g.name)}">${cells}</span></td></tr>`;
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
  // #5 引用右键菜单：**onChange 之外也要接**——「复制引用地址」是只读操作，
  // 只读面板（未传 onChange）同样该能复制。bindCtx 一并传入：它是「绝对 float 粘贴」
  // 今天唯一已接线的落地通路（见 resolvePasteSink）。
  wireRefMenu(el, info, refCtx, bindCtx);

  // 编辑基线（**活的**，不是渲染时那份快照）。
  //
  // 聚焦保护之后，面板可以在**不重渲染**的情况下连续接收多次编辑（在 tx 里打完 5 直接
  // Tab 到 ty 再打 7）。若每次 commit 都拿渲染时的 `info.params` 当基线，第二次编辑会把
  // 第一次的结果**按旧值写回去**（ty=7 的同时把 tx 退回 0）—— 一个只在"面板不重渲染"
  // 时才够得着的回归。所以基线随每次 commit 前进；`info` 本身保持不变（wirePortMenu /
  // wireRefMenu 用它读 kind/label，那些是渲染期事实，不该被编辑改写）。
  let live: ParamInfo[] = info.params;
  const baseInfo = (): ParamPanelInfo => ({ label: info.label, kind: info.kind, params: live });
  /** 提交一次编辑：前进基线，再交给外部（顺序要紧——onChange 可能同步回调进来）。 */
  const commitParams = (next: ParamInfo[]): void => {
    // 空提交直接丢弃（v0.1.00128）。
    //
    // 每个控件同时听 `input` 与 `change`。number input 的 `change` **在失焦时**才发，
    // 且值与最后一次 `input` 相同 —— 一次纯粹的空提交。以前它不存在，只是因为面板
    // 每帧重渲染已经把那个 input 连根换掉了（被销毁的元素不会再发 change）；聚焦保护
    // 让输入框活到失焦，于是这条早就存在的空提交第一次真的跑起来，代价是：
    //   1. 它落在 600ms undo 去抖**之后** → 生成一条 before === after 的空 undo 记录，
    //      于是用户按一次 Ctrl+Z 像是"没反应"（实际是撤销了那条空记录）；
    //   2. 白跑一次 network.run() + 推桥。
    // 判据用"值真的变了吗"，而不是"这是第几个事件"：事件序在不同浏览器/输入法下不
    // 保证，值相等则无事可做是恒真的。
    if (paramValuesEqual(live, next)) return;
    live = next;
    onChange?.(next);
  };

  if (onChange) {
    const controls = Array.from(
      el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[data-name], select[data-name]"),
    );
    for (const ctrl of controls) {
      const name = ctrl.getAttribute("data-name") ?? "";
      const p = info.params.find((x) => x.name === name)!; // name always comes from controlHtml
      const commit = () => commitParams(applyEdit(baseInfo(), name, ctrl.value));
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
            commitParams(applyEdit(baseInfo(), name, text));
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
            commitParams(live.map((q) => (q.name === p.name ? { ...q, value: val } : q)));
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
        commitParams(applyEdit(baseInfo(), name, hexInput.value));
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
          commitParams(live.map((q) => (q.name === p.name ? { ...q, value: dv } : q)));
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
