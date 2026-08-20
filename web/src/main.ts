import "./styles.css";
import { buildLayout } from "./app/layout";
import { DEFAULT_LAYOUT, DEFAULT_LAYOUT_NAME } from "./app/layouts";
import { createChannelBindManager } from "./core/channel-bind";
import { applyLayout, channelPanelRef, setChannelValuesSink, setupDock } from "./app/dock";
import { renderSpreadsheet, type SpreadsheetFocus } from "./app/spreadsheet";
import {
  renderParams,
  isParamEditorFocused,
  paramValuesEqual,
  shouldDeferParamRender,
  type ParamInfo,
} from "./app/param";
import { store } from "./stores/workspace";
import { BridgeClient } from "./bridge/client";
// connectWs 直接取用：session 的 connectWsFn 注入口在此包一层，截 anchor-moved 刷新映射缓存。
import { connectWs } from "./bridge/client";
import { createReteGraph, getNodeParamBindings, listNodeParamBindings, setNodeBindings, type ReteGraphHandlers } from "./nodes2/graph";
// obj/sop 层级导航（v0.1.00119）：模块级层级 API（graph.ts 下方实现），地址栏按名下沉用。
import { enterNode, exitNode, getCurrentNetKind, getNetPath, setNetPathChangedHandler } from "./nodes2/graph";
import { REF_PARAM_PREFIX, isEnterableKind, type CylNode, type ParamSpec } from "./nodes2/graph-model";
// task #8 映射类型缓存：_input_/_output_ 端口类型的唯一真源，生命周期由本文件驱动
//（进项目 prime / anchor-moved 与切项目 invalidate）——不接就永远报「映射表未加载」。
import { invalidateMappingTypes, primeMappingTypes } from "./nodes2/mapping-types";
// _input_/_output_ 地址下拉的端口清单缓存。与 mapping-types 一样以「当前项目上下文」为键，
// 因此**总是与 invalidateMappingTypes 成对作废**（见各调用点注释）。
// 刻意不做 prime：端口清单只在用户打开带 address 的 param 面板时才需要，模块内已
// debounce + single-flight，按需取比进项目就预取全部成员划算。
import { cachedCapabilities, invalidateCapabilities, loadCapabilities } from "./nodes2/serial-capabilities";
import { computeOutputsDetailed } from "./nodes2/network";
import type { ActiveChains } from "./core/network";
import { Viewport } from "./viewport/renderer";
import { APP_VERSION } from "./app/app-config";
import { inputsEqual } from "./protocol/compare";
import { PROJECT_SERIAL_RE, SERIAL_RE } from "./protocol/types";
import type { InputPayload, OutputBuffer, ProjectRef, UpdateMode } from "./protocol/types";
import {
  applyPreferences,
  clampSyncFps,
  loadPreferences,
  openPreferenceDialog,
  savePreferences,
  type Preferences,
} from "./app/preference";
import {
  collectExternRefAddresses,
  collectWritebackTargets,
  createDataflow,
  resolveWritebackValue,
} from "./core/dataflow";
import { createAutosave, createHdaWatchdog } from "./core/lifecycle";
import { bindShortcuts } from "./core/shortcuts";
import { cloneParams, paramsEqual, readParamFloats, type ParamLike } from "./core/params";
import { createParamUndo } from "./core/param-undo";
import { createNetworkRunner } from "./core/network";
import { createGizmoController } from "./core/gizmo";
import { createKickController } from "./core/kick";
import { createSessionManager, type SessionManager } from "./core/session";
import { createTimelineController } from "./core/timeline";
import { createTimelineUI } from "./app/timeline-ui";
import { createAddressBar } from "./app/address-bar";
import { buildGraphAddress } from "./app/graph-address";
import {
  addressOf,
  canWriteProjectGraph,
  isInSubNetwork,
  snapshotSerialOf,
  withPath,
  type GraphScope,
} from "./app/graph-scope";

/** Log categories: geo data / viewport / ui / bridge(python runtime). */
let logFilter = "all";
const logCategories: [string, string][] = [
  ["all", "All"],
  ["geo", "Geo"],
  ["viewport", "Viewport"],
  ["param", "Parameter"],
  ["ui", "UI"],
  ["bridge", "Bridge"],
];
const categorize = (m: string): string => {
  if (/\[param\]/.test(m)) return "param"; // param edits + their undo/redo (before ui/geo)
  if (/\[viewport\]/.test(m)) return "viewport";
  if (/inputs rev=|outputs|\[mesh\]|\[path\]|pushed|rev=/i.test(m)) return "geo";
  if (/\[layout\]|\[node\]|\[file\]|display|visibility/i.test(m)) return "ui";
  if (/\[bridge\]|python|runtime/i.test(m)) return "bridge";
  return "ui";
};
const matchLogFilter = (m: string) => logFilter === "all" || categorize(m) === logFilter;
const renderLog = () => {
  const body = layout.logEl.querySelector(".cyl-log-body");
  if (body) body.textContent = store.logs.filter(matchLogFilter).slice(-40).join("\n");
};

const layout = buildLayout(document.getElementById("app")!);
const client = new BridgeClient();
const hdaWatchdog = createHdaWatchdog({
  getStatus: (serial) => client.getStatus(serial),
  setOfflineVisible: (visible) => layout.hdaOffline.classList.toggle("hidden", !visible),
  log: (msg) => store.pushLog(msg),
});
/** Preferences (cyl1nder.prefs localStorage + Preference.json v1): sync_max_fps caps
 *  the kick bridge (receive/forward + HDA recook) rate (1..60); Auto Update web
 *  pushes are NOT rate-limited. update_mode picks Enter-gizmo refresh timing. */
let prefs: Preferences = loadPreferences();
/** Phase B: manual two-way sync gate. Web is the single source of truth; default OFF
 *  (local mode: zero /stream, zero push, no outputs echo). Persisted to prefs. */
let syncEnabled = prefs.sync_enabled === true;
layout.syncToggle.checked = syncEnabled;
/** localStorage key remembering which scene's Preference.json was last applied: a plain
 *  reload of the SAME scene keeps the local (working) prefs; only opening/connecting
 *  to a DIFFERENT scene re-applies that scene's Preference.json. */
const LAST_SERIAL_KEY = "cyl1nder.lastSceneSerial";
applyPreferences(prefs, layout);
// log filter bar (inserted above the log content inside the dock panel)
const logFilterBar = document.createElement("div");
logFilterBar.className = "cyl-log-filter";
logFilterBar.innerHTML = logCategories
  .map(([k, label]) => `<button data-filter="${k}" class="${k === "all" ? "active" : ""}">${label}</button>`)
  .join("");
logFilterBar.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest?.("button");
  if (!btn) return;
  logFilter = (btn as HTMLElement).dataset.filter ?? "all";
  logFilterBar.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
  renderLog();
});
layout.logEl.classList.add("cyl-log-panel");
layout.logEl.innerHTML = "";
const logBody = document.createElement("pre");
logBody.className = "cyl-log-body";
layout.logEl.appendChild(logFilterBar);
layout.logEl.appendChild(logBody);
const spreadsheetEl = document.createElement("div");
spreadsheetEl.id = "cyl-spreadsheet";
spreadsheetEl.className = "cyl-spreadsheet";
const paramEl = document.createElement("div");
paramEl.id = "cyl-param";
paramEl.className = "cyl-param";
// Graph panel shell: Houdini node-view style address bar above the rete graph.
// setupDock gets the SHELL as the graph panel's content element; createReteGraph
// still renders into layout.graphContainer (the inner .cyl-graph) below the bar.
const graphShell = document.createElement("div");
graphShell.className = "cyl-graph-shell";
const graphAddr = document.createElement("div");
graphAddr.className = "cyl-graph-addr";
graphShell.appendChild(graphAddr);
graphShell.appendChild(layout.graphContainer);

// explorer.exe 式地址栏：分段按钮（点击跳转/复制）+ 点击空白处变输入框 + Tab 补全。
// 输入态 Tab 由地址栏独占（graph-interact 的 Tab 处理器有 activeElement input 守卫）。
let sessionCtl: SessionManager | null = null; // late-bound（sessionMgr 声明在后）
/** P5b 通道引用绑定管理器（创建于 syncMaxFps 声明后；调用点均 late-bound 引用）。 */
let bindMgr: ReturnType<typeof createChannelBindManager> | null = null;
let lastAddress = "";
/** P2b 项目模式状态（模块级）：currentProjectId 由 enterProjectMode 设置；
 *  getAddress / navigate / 保存路径据此分流。
 *
 *  v0.1.00120 起**不再有清空它的路径**：serial 页面入口删除后，"serial 模式"这个
 *  概念也没了 —— Connect / 1 段 C1- 导航都会解析出所属项目再进成员工作区，
 *  于是它一旦设上就始终指向"当前在哪个项目里"。
 *
 *  注意：**它只表示「归属哪个项目」，不表示「当前图就是项目根图」**。进入成员工作区后
 *  它依然非空。判定"图是谁的"一律用 `graphScope`（见 app/graph-scope.ts）——
 *  混用这两件事曾把成员图写进项目槽位、覆盖掉项目根结构（v0.1.00117 修）。 */
let currentProjectId: string | null = null;
/** 当前图的归属（保存/读取/地址栏的唯一事实来源，见 app/graph-scope.ts）。 */
let graphScope: GraphScope = { kind: "none" };
/** 当前项目详情缓存（成员列表供地址栏项目模式第二段补全）。 */
let currentProject: ProjectRef | null = null;
/** graph 在 setupDock 之后才创建（createReteGraph）：项目模式查询必须等它就绪（TDZ 保护）。 */
let graphReady = false;
const addressBar = createAddressBar(graphAddr, {
  getAddress: () => projectAddress(),
  navigate: (addr) => {
    const segs = addr.split("/").filter(Boolean);
    const isSerial = (s: string) => /^C1-[0-9a-z]{8,}-[0-9a-z]{4}$/.test(s);
    const isProject = (s: string) => PROJECT_SERIAL_RE.test(s);
    // 2 段 /<P1-…>/<C1-…>/：确保项目模式 + 激活成员 + 地址显示两段。
    if (segs.length === 2 && isProject(segs[0]) && isSerial(segs[1])) {
      // 与 channel display 点击**共用同一套 pending 机制**（v0.1.00119 收口）：
      // 先登记待兑现归属，等 loadSnapshotIntoStore 里 restoreGraph 真的落地后
      // 才由 commitPendingMemberScope 写 scope + 刷地址。
      //
      // 为什么这条也要收口：`activateSession` **不保证任何事**（它 `void
      // loadSnapshot(serial)` 即返回，图交换发生在 loadSnapshotIntoStore 内部，
      // 且仅当该成员有存图）。原先这里立刻写 member scope + 刷地址，于是成员没有
      // 存图时地址会指向一个 nodeview 从未去过的地方——正是用户报的那个症状，
      // 只是入口不同（那次是 display chip）。两个入口用同一套机制，就不会一个诚实
      // 一个乐观。
      const activateMember = (): void => {
        pendingMemberScope = { projectId: segs[0], serial: segs[1] };
        sessionCtl?.activateSession(segs[1]);
      };
      if (currentProjectId === segs[0] && isProjectModeActive()) {
        activateMember(); // 已在目标项目：不重载项目图，避免覆盖未保存编辑
      } else {
        void enterProjectMode(segs[0]).then(activateMember);
      }
      return true;
    }
    // 层级导航（v0.1.00119）：第 1 段起若不是 C1- 成员，就按**节点名**在当前网络里下沉。
    // 顺序刻意如此——先试成员语义（上面那条 2 段分支逐字保留旧行为，多条 e2e 依赖它），
    // 名字语义只在"不是 serial"时才接手，于是 `/P1-…/C1-…/` 永远不会被当成节点名。
    if (segs.length >= 2) return navigateByName(segs);
    if (segs.length !== 1) return false;
    if (isSerial(segs[0])) {
      if (segs[0] === store.serial) {
        // 身处子网络时，`/C1-…/` 表示的是**顶层**，先退回去再 frame —— 不退的话
        // 「点面包屑第一段回不到顶层」（实机实测：地址停在 /C1-…/geoA 不动）。
        if (isInSubNetwork(graphScope)) {
          void exitToDepth(0);
          return true;
        }
        graph.frameSelection(); // 当前地址：跳到本图
        return true;
      }
      // 1 段 `/C1-…/`：**v0.1.00122 起直接拒绝**。
      //
      // 用户要求：「项目中不要再出现 /P1-…/C1-…/ 这个东西了」「把老 hda 会直接按照
      // serial 创建项目的问题清理掉, 这个入口必须 ban」。serial 是**成员身份**，
      // 不是一个可以被当作地址打开的东西；成员的内容属于项目图里那个 geo 子网络。
      // 留着这条分支就等于把刚拆掉的 `?serial=` 暗门原样搬进地址栏。
      store.pushLog(
        `[nav] 拒绝按 serial 打开：${segs[0]} 是成员身份而不是地址——` +
          `请打开它所属的项目（/P1-…/），在项目里建 geo 并进入 sop 层级`,
      );
      return false; // 地址栏据此走「无法解析 → 复制」的既有降级
    }
    if (isProject(segs[0])) {
      // 已在该项目**且身处子网络**时：只是往上退层，绝不重进项目模式。
      // 为什么必须特判：子网络里 graph.isProjectMode() 是 false（project 根节点不在这一层），
      // enterProjectMode 的 fast path 判不出来，会走慢路径 loadProjectGraph 从桥重载整张图——
      // 未保存的子网络编辑被丢掉，且 graph.ts 的层级栈还留在原深度，图与栈就此错位。
      if (currentProjectId === segs[0] && graphScope.kind === "project" && isInSubNetwork(graphScope)) {
        void exitToDepth(0);
        return true;
      }
      void enterProjectMode(segs[0]); // 已在目标项目时内部走 fast path（回到项目根）
      return true;
    }
    store.pushLog(`[addr] 无法解析地址: ${addr}`); // 其它 → 忽略 + log
    return false;
  },
  getCompletions: async (prefix, fullAddress) => {
    try {
      const segs = fullAddress.split("/").filter(Boolean);
      // 正在编辑第几段：地址以 "/" 收尾（或为空）时光标在一个**新的空段**上，
      // 段号即 segs.length；否则在最后一个已有段上。旧代码用 `segs.length >= 2` 近似，
      // 于是 `/P1-…/` + Tab（第 1 段、segs.length===1）漏掉了成员补全。
      const editingIndex =
        fullAddress.length === 0 || fullAddress.endsWith("/") ? segs.length : Math.max(0, segs.length - 1);
      // 第 1 段起：成员 serial ∪ 当前网络里可进入的节点名（层级导航按名下沉）。
      if (editingIndex >= 1) {
        const members =
          segs[0] === currentProjectId
            ? (currentProject?.members ?? [])
                .filter((m) => (m.kind === "tag" || m.kind === "hda") && m.serial)
                .map((m) => m.serial)
                .filter((s): s is string => !!s)
            : [];
        return [...members, ...enterableNodeNames()].filter((s) => s.startsWith(prefix));
      }
      // 首段：serials ∪ projectSerials。
      const [serials, projects] = await Promise.all([
        client.listSerials().catch(() => [] as string[]),
        client.listProjects().catch(() => ({ projects: [] as ProjectRef[] })),
      ]);
      return [...serials, ...projects.projects.map((p) => p.projectSerial)].filter((s) => s.startsWith(prefix));
    } catch {
      return [];
    }
  },
  log: (m) => store.pushLog(m),
});
(window as unknown as Record<string, unknown>).__cylDv = null; // debug hook (MCP debug access)
const dv = setupDock(layout.dockContainer, {
  graph: graphShell,
  viewport: layout.viewportContainer,
  inspector: layout.inspectorEl,
  log: layout.logEl,
  spreadsheet: spreadsheetEl,
  param: paramEl,
});
(window as unknown as Record<string, unknown>).__cylDv = dv;
// Initial serial may already be set (?project=&member=...); paint address + panel title now.
updateGraphAddress();
// dockview lazily mounts inactive tab content: the Log panel's .cyl-log element is NOT in
// the DOM until its tab is activated. Re-render accumulated logs when it comes on screen.
(dv as unknown as { api?: { onDidActiveChange?: (fn: (e: { panel: { id: string } }) => void) => unknown } }).api
  ?.onDidActiveChange?.((e) => {
    if (e.panel.id === "log") renderLog();
  });

// ---------------- menu bar (File / Layout) ----------------
layout.root.querySelectorAll(".cyl-menu").forEach((menu) => {
  const label = menu.querySelector(".cyl-menu-label") as HTMLElement;
  const drop = menu.querySelector(".cyl-menu-drop") as HTMLElement;
  const toggle = (open?: boolean) => {
    drop.classList.toggle("open", open ?? !drop.classList.contains("open"));
  };
  label.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    toggle();
  });
  // close other menus when one opens
  document.addEventListener("pointerdown", (ev) => {
    if (!drop.contains(ev.target as Node)) toggle(false);
  }, { capture: true });
  // clicking any menu ITEM closes this menu's drop (File / Layout)
  drop.addEventListener("click", () => toggle(false));
});

// File menu markup lives in app/layout.ts: rename the old "Open Scene…" (reload)
// and add the real folder->serial "Open Scene…" entry here. Overview is only
// reachable through the top-left brand (href="/overview.html"), not this menu.
{
  const file = layout.menuFile;
  const reloadBtn = file.querySelector<HTMLButtonElement>('button[data-act="open"]');
  if (reloadBtn) reloadBtn.textContent = "Reload Scene";
  const openSceneBtn = document.createElement("button");
  openSceneBtn.type = "button";
  openSceneBtn.dataset.act = "open-scene";
  openSceneBtn.textContent = "Open Scene…";
  file.insertBefore(openSceneBtn, reloadBtn ?? file.firstElementChild);
}

let currentLayoutName = DEFAULT_LAYOUT_NAME;
/** Layout menu shows the CURRENT layout name inside the box's name block, padded
 *  to the fixed 15ch width (trailing spaces render via white-space: pre). */
function updateLayoutMenuLabel(): void {
  layout.menuLayoutLabel.textContent = currentLayoutName.padEnd(15);
}
const getDockJson = () => ({
  ...(dv as unknown as { toJSON(): Record<string, unknown> }).toJSON(),
  displaySettings: viewport.getDisplaySettings(),
});
const saveCurrentLayout = (name: string) => {
  void client.saveLayout(name, getDockJson()).then((r) => {
    if (r.ok) {
      currentLayoutName = name;
      updateLayoutMenuLabel();
      store.pushLog(`[layout] saved "${name}"`);
    }
  });
};
const refreshLayoutPresets = () => {
  void client.listLayouts().then((names) => {
    layout.layoutPresets.innerHTML = names.length
      ? names.map((n) => `<button class="cyl-layout-preset" data-name="${n}">${n}</button>`).join("")
      : `<div class="cyl-menu-empty">no saved layouts</div>`;
    layout.layoutPresets.querySelectorAll(".cyl-layout-preset").forEach((b) => {
      b.addEventListener("click", () => {
        const name = (b as HTMLElement).dataset.name ?? "";
        void client.loadLayout(name).then((r) => {
          if (r.layout) {
            applyLayout(dv, r.layout, {
              graph: layout.graphContainer,
              viewport: layout.viewportContainer,
              inspector: layout.inspectorEl,
              log: layout.logEl,
              spreadsheet: spreadsheetEl,
              param: paramEl,
            });
            applyLayoutSettings(r.layout);
            currentLayoutName = name;
            updateLayoutMenuLabel();
            store.pushLog(`[layout] loaded "${name}"`);
          }
        });
      });
    });
  });
};
void refreshLayoutPresets();

layout.menuFile.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    const act = (b as HTMLElement).dataset.act;
    if (act === "save") {
      if (currentProjectId) {
        saveProjectGraph();
        store.pushLog("[file] project graph saved");
        return;
      }
      if (!store.serial) return;
      void client.putSnapshot(store.serial, { graph: graph.serializeGraph(), docking: getDockJson(), preference: prefs });
      store.pushLog("[file] scene saved");
    } else if (act === "open") {
      // Reload Scene: re-read the current serial's disk snapshot.
      if (!store.serial) return;
      void loadSnapshotIntoStore(store.serial);
    } else if (act === "open-scene") {
      void openSceneFromDir();
    } else if (act === "saveas") {
      if (!store.serial && !currentProjectId) return; // 项目模式无 serial，放行给 saveSceneAs 项目分支
      void saveSceneAs();
    }
  });
});
layout.menuLayout.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    const act = (b as HTMLElement).dataset.act;
    if (act === "save-layout") saveCurrentLayout(currentLayoutName);
    else if (act === "save-layout-as") {
      const name = window.prompt("Layout name (same name overwrites):", currentLayoutName);
      if (name) saveCurrentLayout(name.trim());
    } else if (act === "reload-layout") {
      // re-apply the saved layout, else fall back to the bundled Default.json
      void client.loadLayout(currentLayoutName).then((r) => {
        const json = r.layout ?? DEFAULT_LAYOUT;
        applyLayout(dv, json, {
          graph: layout.graphContainer,
          viewport: layout.viewportContainer,
          inspector: layout.inspectorEl,
          log: layout.logEl,
          spreadsheet: spreadsheetEl,
          param: paramEl,
        });
        applyLayoutSettings(json);
        updateLayoutMenuLabel();
        store.pushLog(`[layout] reloaded "${currentLayoutName}"${r.layout ? "" : " (bundled default)"}`);
      });
    }
  });
});
layout.menuEdit.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    const act = (b as HTMLElement).dataset.act;
    if (act === "preference") {
      openPreferenceDialog(prefs, (saved) => {
        prefs = saved;
        autosave.restart();
        syncMaxFps = saved.sync_max_fps;
        updateMode = saved.update_mode;
        savePreferences(prefs);
        applyPreferences(prefs, layout);
        viewport.setBackgroundColor(prefs.viewport_bg);
        store.pushLog(`[pref] saved: sync_max_fps=${saved.sync_max_fps} update_mode=${saved.update_mode} viewport_bg=${prefs.viewport_bg} ui_font=${prefs.ui_font}`);
        if (store.serial) {
          void client.putSnapshot(store.serial, { preference: prefs }).catch(() => undefined);
          void client.putSyncFps(store.serial, saved.sync_max_fps).catch(() => undefined);
        }
      });
    }
  });
});

// ---- File System Access API scene save/open (Chromium) with prompt fallback ----
// showDirectoryPicker is Chromium-only and not in the TS DOM lib yet.
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }
}

/** Write a JSON file into a directory handle (creates parent subdirs). */
async function writeJsonToDir(dir: FileSystemDirectoryHandle, relPath: string, data: unknown): Promise<void> {
  const parts = relPath.split("/");
  let cur = dir;
  for (const part of parts.slice(0, -1)) cur = await cur.getDirectoryHandle(part, { create: true });
  const fh = await cur.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(data, null, 2));
  await w.close();
}

/** Read a JSON file from a directory handle (null when missing/unreadable). */
async function readJsonFromDir(dir: FileSystemDirectoryHandle, relPath: string): Promise<unknown | null> {
  try {
    const parts = relPath.split("/");
    let cur = dir;
    for (const part of parts.slice(0, -1)) cur = await cur.getDirectoryHandle(part);
    const fh = await cur.getFileHandle(parts[parts.length - 1]);
    return JSON.parse(await (await fh.getFile()).text());
  } catch {
    return null;
  }
}

/** Save Scene As: File System Access first (write <serial>/ under the picked dir,
 *  overwrite confirm when the serial folder exists), falls back to the bridge path. */
async function saveSceneAs(): Promise<void> {
  // 分流判据是 `graphScope`（**不是** `currentProjectId`）：v0.1.00120 起成员工作区也
  // 有 currentProjectId（serial 页面入口删除后，成员一律在项目下打开），拿它判就会把
  // 「另存这个成员的场景文件夹」误判成「保存项目图」——Save As 于是一个文件都不写。
  // 这正是 graph-scope.ts 头部警告的那种混用：「归属哪个项目」≠「这张图是项目根」。
  if (canWriteProjectGraph(graphScope)) {
    saveProjectGraph(); // 项目根：Save As = 保存项目图快照
    store.pushLog("[file] project graph saved");
    return;
  }
  const serial = snapshotSerialOf(graphScope) ?? store.serial;
  if (!serial) return;
  try {
    await client.putSnapshot(serial, { graph: graph.serializeGraph(), docking: getDockJson(), preference: prefs });
  } catch (e) {
    store.pushLog(`[file] scene snapshot failed: ${String(e)}`);
  }
  const picker = window.showDirectoryPicker;
  if (picker) {
    try {
      const dir = await picker({ mode: "readwrite" });
      let exists = false;
      try {
        await dir.getDirectoryHandle(serial);
        exists = true;
      } catch {
        /* not present yet */
      }
      if (exists && !window.confirm("同名文件夹已存在，覆盖？")) return;
      const nodes = (graph.serializeGraph() as { nodes?: Array<{ id: string; params?: unknown[] }> }).nodes ?? [];
      const parm: Record<string, unknown[]> = {};
      for (const n of nodes) if (n.params?.length) parm[n.id] = n.params;
      await writeJsonToDir(dir, `${serial}/io/inputs.json`, store.inputs);
      await writeJsonToDir(dir, `${serial}/io/outputs.json`, store.outputs);
      await writeJsonToDir(dir, `${serial}/scene/node-graph.json`, graph.serializeGraph());
      if (Object.keys(parm).length) await writeJsonToDir(dir, `${serial}/scene/node-parm.json`, parm);
      await writeJsonToDir(dir, `${serial}/Preference.json`, prefs);
      await writeJsonToDir(dir, `${serial}/docking-layout.json`, getDockJson());
      store.pushLog(`[file] scene saved to ${dir.name}/${serial}`);
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // user cancelled
      store.pushLog(`[file] folder save failed (${String(e)}) - falling back to server path`);
    }
  }
  // Fallback: bridge server path (prompt for a target dir).
  const targetDir = window.prompt("输入保存目标目录");
  if (!targetDir) return;
  const dir = targetDir.trim();
  try {
    let r = await client.saveSceneFolder(serial, dir);
    if (!r.ok && r.exists) {
      if (window.confirm("同名文件夹已存在，覆盖？")) r = await client.saveSceneFolder(serial, dir, true);
    }
    if (r.ok) store.pushLog(`[file] scene saved to ${r.path ?? dir}`);
    else store.pushLog(`[file] scene save failed: ${r.error ?? "unknown"}`);
  } catch (e) {
    store.pushLog(`[file] scene save error: ${String(e)}`);
  }
}

/** 跳转到「该成员的页面」：先问桥这个 serial 属于哪个项目，再整页导航到
 *  `?project=<P1>&member=<C1>`（v0.1.00120 取代 `location.href = "?serial=…"`）。
 *
 *  这里保留**整页导航**（而不是就地 openProjectMember）：Open Scene 刚把一整套
 *  inputs/graph/docking 推给桥，换的是整个场景，重新 boot 一次最干净——也让地址栏、
 *  prefs（LAST_SERIAL_KEY 比对）与会话都从同一个起点重建。
 *
 *  解析不出项目时不跳转，只 log：宁可停在原地并说清原因，也不跳到一个 serial 形状的
 *  地址（那条入口已经不存在，跳过去只会被入口守卫弹回 Overview，用户看不懂）。 */
async function navigateToMemberPage(serial: string): Promise<void> {
  try {
    const r = await client.ensureProject(serial);
    const pid = r.ok ? r.project?.projectSerial : "";
    if (pid) {
      location.href = `?project=${encodeURIComponent(pid)}&member=${encodeURIComponent(serial)}`;
      return;
    }
    store.pushLog(`[file] 无法解析 ${serial} 所属项目——请从 Overview 打开`);
  } catch (e) {
    store.pushLog(`[file] 解析 ${serial} 所属项目失败: ${String(e)}`);
  }
}

/** Open Scene: File System Access first (pick a serial-named folder, read io +
 *  graph + docking, push to the bridge), falls back to the bridge server path. */
async function openSceneFromDir(): Promise<void> {
  const picker = window.showDirectoryPicker;
  if (picker) {
    try {
      const dir = await picker({ mode: "read" });
      const serial = dir.name;
      if (!/^C1-[0-9a-z]{8,}-[0-9a-z]{4}$/.test(serial)) {
        store.pushLog(`[file] open scene failed: folder name is not a serial: ${serial}`);
        return;
      }
      const [inputs, graphJson, docking, prefJson] = await Promise.all([
        readJsonFromDir(dir, "io/inputs.json"),
        readJsonFromDir(dir, "scene/node-graph.json"),
        readJsonFromDir(dir, "docking-layout.json"),
        readJsonFromDir(dir, "Preference.json"),
      ]);
      if (prefJson && typeof prefJson === "object") {
        applyLoadedPreference(prefJson);
        localStorage.setItem(LAST_SERIAL_KEY, serial);
      }
      if (Array.isArray(inputs) && inputs.length > 0) {
        await client
          .pushInputs(serial, inputs as InputPayload[])
          .catch((e) => store.pushLog(`[file] push inputs failed: ${String(e)}`));
      }
      await client
        .putSnapshot(serial, {
          graph: graphJson && typeof graphJson === "object" ? graphJson : undefined,
          docking: docking && typeof docking === "object" ? docking : undefined,
          preference: prefs,
        })
        .catch((e) => store.pushLog(`[file] push snapshot failed: ${String(e)}`));
      await navigateToMemberPage(serial);
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // user cancelled
      store.pushLog(`[file] folder open failed (${String(e)}) - falling back to server path`);
    }
  }
  // Fallback: bridge server path (prompt for a folder path).
  const folderPath = window.prompt("输入场景文件夹路径（文件夹名=序列号，如 D:/scenes/C1-xxxxxxxx-xxxx）");
  if (!folderPath) return;
  void client
    .openSceneFolder(folderPath.trim())
    .then((r) => {
      if (r.ok && r.serial) void navigateToMemberPage(r.serial);
      else store.pushLog(`[file] open scene failed: ${r.error ?? "no serial returned"}`);
    })
    .catch((e) => store.pushLog(`[file] open scene error: ${String(e)}`));
}

let activeChains: ActiveChains = { outputs: [true, true, true, true], node: null };
const dataflow = createDataflow({
  getGraph: () => graph,
  getNetwork: () => network,
  getViewport: () => viewport,
  getGizmo: () => gizmo,
  flushParamUndo: () => paramUndo.flush(),
  refreshSelectionPanels,
  setActiveChains: (next) => {
    activeChains = next;
  },
});
// 默认 `_input_`/`_output_` 对建不建，**由 boot 形态显式决定**（v0.1.00120）。
//
// 为什么必须显式传：graph.ts 的自动判定 `wantsEmptyRootGraph()` 只看 URL 里有没有
// `?project=`，而"项目根"曾经与"带 project 参数"是同一件事。加了 `&member=` 之后这条
// 等价关系断了——成员工作区也带 `?project=`，却**需要**默认对（成员没有存图时，图必须
// 是那张默认 in/out 图，否则 nodeview 一片空白，正是这次迁移最先撞上的回归）。
// 判据因此收敛到这里：只有"项目根"（有 project、无 member）才要空图。
const bootIsMemberEntry = (() => {
  try {
    const p = new URLSearchParams(location.search);
    return PROJECT_SERIAL_RE.test(p.get("project") ?? "") && SERIAL_RE.test(p.get("member") ?? "");
  } catch {
    return false;
  }
})();
const graph = await createReteGraph(layout.graphContainer, dataflow.handlers, {
  emptyRootGraph: bootIsMemberEntry ? false : undefined, // 成员入口 → 保留默认对；其余沿用自动判定
});
graphReady = true; // updateGraphAddress / isProjectModeActive 现可安全引用 graph
// 层级变化（双击进入 / Tab-U 退出 / 地址栏按名导航）**换完之后**才回调 —— 地址栏据此
// 跟随。刻意不在 enterNode 调用点自己刷地址：那又会变成"地址先变、图后换"（task #7）。
setNetPathChangedHandler(onNetPathChanged);

const autosave = createAutosave({
  getPrefs: () => prefs,
  getSerial: () => store.serial,
  saveSnapshot: () => {
    // 同 saveSceneAs / quickSave：判据用 graphScope（成员工作区的自动保存必须写它自己的
    // snapshot，而不是把成员图写进项目槽位）。
    if (canWriteProjectGraph(graphScope)) {
      saveProjectGraph(); // 项目根：图快照存项目，不写 per-serial snapshot
      return;
    }
    const serial = store.serial;
    if (!serial) return;
    void client.putSnapshot(serial, { graph: graph.serializeGraph(), docking: getDockJson(), preference: prefs });
  },
  log: (msg) => store.pushLog(msg),
});

const paramUndo = createParamUndo({ pushUndo: (entry) => graph.pushUndo(entry) });

/** Late-bound Enter-gizmo handle (createGizmoController runs AFTER the network
 *  runner in this file): the runner queries it each frame for the edited-node id
 *  (editing keeps ALL chains live) and main.ts for the display override. */
let gizmoRef: { getEditNodeId(): string | null } | null = null;

const network = createNetworkRunner({
  getSerial: () => store.serial,
  getInputs: () => store.inputs,
  getNetworkSnapshot: () => graph.getNetworkSnapshot(),
  getGraphVersion: () => graph.getGraphVersion(),
  getInputsRev: () => store.inputRev,
  computeOutputs: (inputs, snap, ctx) => computeOutputsDetailed(inputs, snap, ctx),
  // While a transform is being edited (Enter gizmo), ALL chains stay active so
  // the edited chain remains live even when it feeds a non-displayed port.
  getActiveChains: () => ({
    ...activeChains,
    outputs: gizmoRef?.getEditNodeId() ? [true, true, true, true] : activeChains.outputs,
  }),
  getEditedNodeId: () => gizmoRef?.getEditNodeId() ?? null,
  getOutputRev: () => store.outputRev,
  upsertOutputs: (outputs, rev) => store.upsertOutputs(outputs, rev),
  setOutputRev: (rev) => store.setOutputRev(rev),
  pushOutputs: (serial, outputs) => client.pushOutputs(serial, outputs),
  shouldPush: () => syncEnabled,
  // 运行时流动虚线：网络计算耗时 ≥120ms 时点亮显示链线段的流动动画（graph 内 120ms 阈值）。
  onRunTiming: (ms) => graph.markRuntimeActivity(ms),
  log: (msg) => store.pushLog(msg),
});
const kicker = createKickController({
  kick: (serial) => client.kick(serial),
  log: (msg) => store.pushLog(msg),
  isSyncEnabled: () => syncEnabled,
  hasInputs: () => store.inputs.length > 0,
  runNetwork: () => { void network.run(); },
});

const timeline = createTimelineController({
  getInputs: () => store.inputs,
  getInputRev: () => store.inputRev,
  setInputs: (inputs, rev) => store.setInputs(inputs, rev),
  setFrame: (f) => store.setFrame(f),
  scheduleNetwork,
  log: (msg) => store.pushLog(msg),
  // C→H: 本地帧改动（linkEnabled 门控 + 1000/syncFps 节流在 controller 内，拖动期同样
  // 节流提交）→ 经 bridge 代理 fxhoudinimcp animation.set_frame 写回 Houdini playhead。
  onFrameCommit: (f) => {
    const serial = store.serial;
    if (!serial) return;
    void client.putTimeline(serial, f).catch(() => undefined);
  },
});
timeline.setSyncFps(prefs.sync_max_fps); // syncMaxFps let 变量声明在后（TDZ），此处用 prefs
createTimelineUI(layout.timelineEl, { timeline });

// H→C 兜底轮询（1s）：bridge 常驻轮询器已通过 WS {type:"timeline"} 实时推送（session
// applyTimeline），本循环只做链接探测（mcpPort>0 点亮锚定灯）与 WS 断线兜底。
setInterval(() => {
  const serial = store.serial;
  if (!serial || document.visibilityState !== "visible") return;
  void client
    .getTimeline(serial)
    .then((t) => {
      timeline.setLinkEnabled((t.mcpPort ?? 0) > 0);
      if (typeof t.frame === "number" && Number.isFinite(t.frame)) {
        timeline.applyRemote(t.frame, t.fps);
      }
    })
    .catch(() => undefined);
}, 1000);

const sessionMgr = createSessionManager({
  getPrefsSyncMaxFps: () => syncMaxFps,
  putSyncFps: (serial, fps) => client.putSyncFps(serial, fps),
  isSyncEnabled: () => syncEnabled,
  putSyncEnabled: (serial, enabled) => client.putSyncEnabled(serial, enabled),
  getSerial: () => store.serial,
  setSerial: (serial) => store.setSerial(serial),
  setStatus: (s) => store.setStatus(s),
  log: (msg) => store.pushLog(msg),
  getInputs: () => store.inputs,
  setInputs: (inputs, rev) => store.setInputs(inputs, rev),
  captureFrame: (frame, inputs) => { if (frame != null) timeline.captureFrame(frame, inputs); },
  inputsEqual,
  getOutputRev: () => store.outputRev,
  applyOutputs: (outputs, rev) => store.applyOutputs(outputs, rev),
  network,
  startHdaWatch: (serial) => hdaWatchdog.start(serial),
  kicker,
  loadSnapshot: (serial) => loadSnapshotIntoStore(serial),
  getAutoRun: () => layout.autoRunCheck.checked,
  // WS {type:"timeline"}（bridge 轮询器推送）：即时应用 Houdini 帧并点亮链接。
  applyTimeline: (frame, fps) => {
    timeline.setLinkEnabled(true);
    timeline.applyRemote(frame, fps);
  },
  // WS {type:"channel-values"}（吊牌心跳捎带）：即时刷新通道参数面板（P5a）+ 回显绑定节点（P5b）。
  applyChannelValues: (values) => {
    channelPanelRef.current?.applyValues(values);
    bindMgr?.applyIncoming(values);
  },
  // task #8：`anchor-moved`（吊牌被挪了）→ 映射解析结果可能变，类型缓存必须作废并**立刻重取**，
  // 否则端口类型会停在「不知道」上（每个填了 address 的节点一路红三角）。
  //
  // 为什么在这里包一层而不是加 session.ts 的分支：session.ts 是别人的写集，且它的
  // SessionMessage 分派链根本没有 anchor-moved 这一支。connectWsFn 是它自己留的注入口，
  // 在这里先看一眼消息再原样转交，语义上不改动它的任何一条既有分支。
  connectWsFn: (serial, onMessage, onStatus) =>
    connectWs(
      serial,
      (msg) => {
        if ((msg as { type?: unknown } | null)?.type === "anchor-moved") {
          // 这两个缓存**成对作废**：都以「当前项目上下文」为键（映射类型表是项目内的
          // 逻辑名命名空间，端口清单是这些 serial 在本次 Houdini 会话里的解析结果）。
          // 吊牌一挪，同一个逻辑名可能解析到另一个 serial，两者同时过期——只清一个，
          // 另一个就会拿旧项目/旧解析的数据继续作答。别把其中一句"顺手清理"掉。
          invalidateMappingTypes();
          invalidateCapabilities();
          // 重取：只作废不重取的话，缓存会一直停在未加载态，直到下次切项目才恢复。
          // 端口清单刻意**不**在此预取：只有用户打开填了 address 的 param 面板才需要，
          // 模块自身已 debounce + single-flight，按需取即可（预取 = N 次无人看的往返）。
          if (currentProjectId) void primeMappingTypes(currentProjectId);
          store.pushLog(`[mapping] anchor-moved → 映射类型 + 端口清单缓存已作废 (${serial})`);
        }
        onMessage(msg);
      },
      onStatus,
    ),
});
sessionCtl = sessionMgr;

layout.autoRunCheck.addEventListener("change", () => {
  const v = layout.autoRunCheck.checked;
  sessionMgr.setAutoRun(v);
  store.pushLog(`auto-run ${v ? "on" : "off"}`);
});

/** Enter gizmo update mode: auto = realtime per drag frame; mouseup = geometry
 *  refreshes only when the mouse is released (gizmo still follows the pointer).
 *  Source of truth: the preference store (cyl1nder.prefs.update_mode). */
let updateMode: UpdateMode = prefs.update_mode;
/** Sync Max FPS caps the KICK BRIDGE (bridge receive/forward + HDA recook): sent
 *  to the bridge via PUT /sync and executed over the HDA /stream fps field. It is
 *  NOT a cap on the web Auto Update push path - runNetwork and viewport edits
 *  push outputs as fast as possible. */
let syncMaxFps: number = prefs.sync_max_fps;

// P5b 通道引用绑定管理器：param 面板/gizmo 编辑 → 节流直写 Houdini；H→C 值回显 → 绑定节点（值对比防回环）。
bindMgr = createChannelBindManager({
  getSerial: () => store.serial,
  getSyncMaxFps: () => syncMaxFps,
  client,
  listNodeParamBindings: () => listNodeParamBindings(),
  applyNodeParamPatch: (id, patch) => {
    const view = getNodeParamBindings(id);
    if (!view) return false;
    const changed = Object.entries(patch).some(
      ([k, v]) => !Object.is(view.params.find((p) => p.name === k)?.value, v),
    );
    if (!changed) return false;
    const merged = view.params.map((p) => (patch[p.name] !== undefined ? { ...p, value: patch[p.name] } : p));
    graph.setNodeParams(id, merged);
    void network.run(); // H→C 值变化 → 视口几何跟手
    return true;
  },
});
setChannelValuesSink((v) => bindMgr?.applyIncoming(v));
// P5b 调试钩子（headless/实机驱动绑定管理器与节点绑定 API）。
(window as unknown as { __cylBindMgr?: unknown }).__cylBindMgr = bindMgr;
(window as unknown as { __cylSetNodeBindings?: unknown }).__cylSetNodeBindings = setNodeBindings;

layout.updateModeSelect.onChange((v) => {
  updateMode = v === "mouseup" ? "mouseup" : "auto";
  prefs = { ...prefs, update_mode: updateMode };
  savePreferences(prefs);
  store.pushLog(`update mode: ${updateMode === "auto" ? "Auto Update" : "On Mouse Up"}`);
});
layout.syncFpsInput.addEventListener("change", () => {
  syncMaxFps = clampSyncFps(layout.syncFpsInput.value);
  prefs = { ...prefs, sync_max_fps: syncMaxFps };
  savePreferences(prefs);
  applyPreferences(prefs, layout);
  timeline.setSyncFps(syncMaxFps); // 时间轴 C→H 提交节流跟随 Sync Max FPS
  store.pushLog(`sync max fps: ${syncMaxFps}`);
  if (store.serial) void client.putSyncFps(store.serial, syncMaxFps).catch(() => undefined);
});
layout.syncToggle.addEventListener("change", () => {
  syncEnabled = layout.syncToggle.checked;
  prefs = { ...prefs, sync_enabled: syncEnabled };
  savePreferences(prefs);
  if (store.serial) void client.putSyncEnabled(store.serial, syncEnabled).catch(() => undefined);
  store.pushLog(`[sync] 双向同步 ${syncEnabled ? "ON（engaged）" : "OFF（本地模式）"}`);
});

(window as unknown as Record<string, unknown>).__cylViewport = null; // debug hook
const viewport = await Viewport.create(layout.viewportContainer, (out: OutputBuffer) => {
  if (!store.serial) return;
  const serial = store.serial;
  if (syncEnabled) {
    client
      .pushOutputs(serial, [out])
      .then((r) => store.pushLog(`edit out${out.index} pushed rev=${r.rev}`))
      .catch((e) => store.pushLog(`edit failed: ${String(e)}`));
  } else {
    store.pushLog(`edit out${out.index} local only (sync OFF)`);
  }
});
(window as unknown as Record<string, unknown>).__cylViewport = viewport;
// Pre-render pump: every animation frame, first drain any network re-run requested
// by a gizmo drag (latest-wins, at most one runNetwork per frame), then flush the
// store -> viewport refresh. Running BEFORE renderer.render() makes the geometry
// and the gizmo land on the same frame.
viewport.setPreRenderFlush(() => {
  if (networkDirty) {
    networkDirty = false;
    void network.run();
  }
  if (pendingFlush) {
    pendingFlush = false;
    flushStoreView();
  }
});
(window as unknown as Record<string, unknown>).__cylGraph = graph; // debug hook (MCP debug access)
(window as unknown as Record<string, unknown>).__cylStore = store; // debug hook (full logs for tests)
(window as unknown as Record<string, unknown>).__cylTimeline = timeline; // debug hook (E2E 时间轴)
(window as unknown as Record<string, unknown>).__cylSync = {
  isEnabled: () => syncEnabled,
  setEnabled: (v: boolean) => {
    layout.syncToggle.checked = !!v;
    layout.syncToggle.dispatchEvent(new Event("change", { bubbles: true }));
  },
};
// debug hook（obj/sop 层级，E2E 可观测性）：层级 API 全是 nodes2/graph 的**模块级**状态
// （activeGraph / netStack），而浏览器里 `await import("/src/nodes2/graph.ts")` 拿到的是
// **另一个模块实例**——函数都在，但它的 activeGraph/netStack 是空的，于是
// serializeGraphFromRoot() 返回 null、getNetPath() 恒为 []，层级行为在浏览器里根本测不到。
// 这里把**应用自己那份实例**挂出来，测试观察的就是用户实际跑的那条路径（不是平行实现）。
//
// enter/exitTo 刻意用本文件的 await 包装（等层级回调落地）而不是裸 enterNode/exitNode：
// 后者同步返回、真正的图交换在其内部 async IIFE 里，测试就只能 sleep 猜时机。
(window as unknown as Record<string, unknown>).__cylHier = {
  /** 按节点 id 进入，resolve 时图**已换完**；不可进入/不存在 → false。 */
  enter: (nodeId: string) => enterNodeAwaited(nodeId),
  /** 按节点标签进入（同上）。 */
  enterByName: (name: string) => enterByName(name),
  /** 退到指定深度（缺省 0 = 顶层），逐层等换完。 */
  exitTo: (depth = 0) => exitToDepth(depth),
  /** 退一层：**直接暴露裸 exitNode 的返回值**（顶层时 false 是被断言的契约），
   *  但仍等交换落地后才 resolve。 */
  exitOnce: async (): Promise<boolean> => {
    if (getNetPath().length === 0) return exitNode(); // 顶层：false，且无回调可等
    const ok = exitNode();
    if (ok) await waitNetPath();
    return ok;
  },
  /** 当前层级标签栈（`[]` = 顶层）。 */
  getNetPath: () => getNetPath(),
  /** 当前层级种类（深度 0 → "obj"，否则 "sop"）。 */
  getNetKind: () => getCurrentNetKind(),
  /** 顶层完整图（serializeGraphFromRoot 折叠后的结果；在子网络里也给出父图）。
   *  刻意不再提供"当前层不折叠"的变体：main.ts 手上没有这样的入口，为测试新造一个
   *  就成了平行实现。要看当前层，直接读 `__cylGraph.editor` 的节点即可。 */
  serializeFromRoot: () => graph.serializeGraph(),
};
const gizmo = createGizmoController({
  viewport,
  graph: {
    getSelectedNode: () => graph.getSelectedNode(),
    getNetworkSnapshot: () => graph.getNetworkSnapshot(),
    setNodeParams: (id, params) => {
      graph.setNodeParams(id, params);
      bindMgr?.onNodeParamsCommitted(id, params); // P5b：gizmo 拖动经绑定管理器节流直写 Houdini
    },
    pushUndo: (entry) => graph.pushUndo(entry),
  },
  scheduleNetwork,
  log: (msg) => store.pushLog(msg),
  getUpdateMode: () => updateMode,
});
gizmoRef = gizmo; // late bind: gizmo is created AFTER the network runner
viewport.setEnterEditHandler(gizmo.toggle); // left toolbar Enter icon -> activation
dataflow.wireSelection();
viewport.setBackgroundColor(prefs.viewport_bg); // V2: apply loaded viewport background at startup

// Default startup layout: bundled Default.json (the user's Desk1 arrangement, versioned in the
// project). Applied AFTER graph + viewport are created so dockview fromJSON moves panels that
// already own their content (fixes the load-timing / collapsed-panel cascade).
applyLayout(dv, DEFAULT_LAYOUT, {
  graph: layout.graphContainer,
  viewport: layout.viewportContainer,
  inspector: layout.inspectorEl,
  log: layout.logEl,
  spreadsheet: spreadsheetEl,
  param: paramEl,
});
applyLayoutSettings(DEFAULT_LAYOUT);
currentLayoutName = DEFAULT_LAYOUT_NAME;
updateLayoutMenuLabel();
store.pushLog(`[layout] default layout "${DEFAULT_LAYOUT_NAME}" applied`);
autosave.restart();

/** Apply viewport display settings persisted inside a layout JSON (if any). */
function applyLayoutSettings(json: unknown): void {
  viewport.setDisplaySettings((json as { displaySettings?: { mode?: unknown } } | null)?.displaySettings);
}

/** Spreadsheet + Params follow the SELECTED node (multi-select -> first), not the
 *  display flag. null -> its in0 source port (header "in0"); _input_ -> all inputs;
 *  _output_ -> outputs; no selection -> fall back to the display-flag behaviour.
 *  Deselection HOLDS the last rendered node: once a node has been rendered,
 *  clearing the selection keeps the spreadsheet + params content instead of
 *  clearing to "no geometry"; the panels refresh only when a DIFFERENT node is
 *  selected. heldSelectionId drives the params onChange guard so post-deselect
 *  edits still commit to the held node (viewport Enter mode already holds the
 *  last transform the same way). */
let heldSelectionId: string | null = null;
let selectionPanelRendered = false;

// ---------------------------------------------------------------------------
// 聚焦保护（v0.1.00128）：param 面板正在被打字时不重渲染
//
// refreshSelectionPanels 每次 store flush / cook / WS 消息都跑（dataflow.flush →
// 每帧），而 renderParams 是整块 `innerHTML =` 重写。于是"输入框里打一个字"会走：
//   input → onChange → network.run() → store 通知 → 下一帧 flush → 面板重建
// 正在聚焦的 <input> 被连根丢掉，焦点退回 body，后续字符没有收件人 —— 这就是
// 「必须极短时间内按回车」的真因（两个按键挤进同一帧才侥幸成功）。
//
// 门控只包住 renderParams 这**一个**调用：spreadsheet 仍逐帧更新（它没有编辑态，
// 打字时看着几何/表格实时变正是想要的）。推迟的重渲染在焦点离开参数表时补上，
// 所以打字期间被外部改掉的别的行（undo / H→C 同步）不会永久停在旧值。
// ---------------------------------------------------------------------------

/** 当前 param 面板渲染的是哪个节点（聚焦门控要用它区分"同节点刷新"与"换节点"）。 */
let paramRenderedNodeId: string | null = null;
/** 打字期间被推迟掉的重渲染（焦点离开后补）。 */
let paramRenderPending = false;
/** 面板**当前正在显示**的那份 params：渲染时记一次，之后每次自己提交都前进。
 *
 *  它是"这次刷新是我的编辑回声，还是外部改值"的判据：
 *    - 打字/提交 → onChange 把同一个数组交给 setNodeParams 并更新这里 → 引用相等 → 推迟；
 *    - undo/redo / H→C 同步 / 通道回写 → 节点 params 变成**另一个**数组且值不同 → 放行重画。
 *  null = 还没渲染过任何节点。 */
let paramDisplayedParams: ParamInfo[] | null = null;

// focusout 挂在**常驻容器** paramEl 上（不是表里的控件）：renderParams 只换它的
// innerHTML，挂在这里的监听不随重渲染消失，也就不会每次渲染叠一个。
// 延到下一个微任务再判：focusout 触发时 activeElement 还没落到新元素上，立刻读会
// 把"从 tx 跳到 ty"误判成"离开面板"，那样 Tab 换格就又被重渲染打断了。
paramEl.addEventListener("focusout", () => {
  setTimeout(() => {
    if (isParamEditorFocused(paramEl, document.activeElement)) return; // 还在表里（Tab 换格）
    if (!paramRenderPending) return;
    paramRenderPending = false;
    refreshSelectionPanels();
  }, 0);
});

function refreshSelectionPanels(): void {
  const sel = graph.getSelectedNode();
  if (sel) {
    heldSelectionId = sel.id;
  } else if (selectionPanelRendered) {
    // deselected: keep the last selected node's content (no re-render, no clear)
    return;
  }
  let payloads: Array<InputPayload | OutputBuffer> = store.inputs;
  let source: "inputs" | "outputs" = "inputs";
  let focus: SpreadsheetFocus = { kind: null, index: null, label: null };
  if (sel) {
    if (sel.kind === "null" || sel.kind === "transform") {
      focus =
        sel.port !== null
          ? { kind: "null", index: sel.port, label: "in0" }
          : { kind: null, index: null, label: null };
      payloads = store.inputs;
      source = "inputs";
    } else if (sel.kind === "output") {
      focus = { kind: null, index: null, label: null };
      payloads = store.outputs;
      source = "outputs";
    } else if (sel.kind === "project" || sel.kind === "channel") {
      // 项目根节点：本身不携带几何。Spreadsheet 给空表而不是沿用上一次的输入数据——
      // 显示别的节点的几何会让人以为这是当前选中项的数据（比空表更糟）。
      focus = { kind: null, index: null, label: null };
      payloads = [];
      source = "inputs";
    } else {
      focus = { kind: null, index: null, label: null }; // _input_ -> all source inputs
      payloads = store.inputs;
      source = "inputs";
    }
  } else {
    // first-time fallback (only before any node has been rendered): display flag
    const disp = graph.getDisplayNode();
    const kind = disp?.kind ?? null;
    const index = kind === "null" ? graph.getDisplayPortIndex() : kind === "input" ? 0 : null;
    focus =
      kind === "null" && index !== null ? { kind, index, label: "in0" } : { kind, index, label: null };
    payloads = store.inputs;
    source = "inputs";
  }
  selectionPanelRendered = true;
  renderSpreadsheet(spreadsheetEl, payloads, source, focus);
  const selId = sel?.id ?? null;
  // 聚焦保护：同一节点 + 有人在打字 + **值还是面板自己提交的那一份** → 推迟重渲染。
  //
  // 第三个条件是关键：undo/redo（以及 H→C 同步、通道回写）把 params 换成**另一个数组**，
  // paramValuesEqual 立刻为假 → 照常重画。所以撤销永远看得见，不需要为 undo 开特例。
  // 打字时 onChange 刚把同一个数组交给 setNodeParams，sel.params === paramDisplayedParams，
  // 引用相等直接命中快路径 → 推迟，焦点保住。
  if (
    shouldDeferParamRender({
      renderedNodeId: paramRenderedNodeId,
      nextNodeId: selId ?? heldSelectionId,
      editorFocused: isParamEditorFocused(paramEl, document.activeElement),
      valuesUnchanged: !!paramDisplayedParams && paramValuesEqual(sel?.params ?? [], paramDisplayedParams),
    })
  ) {
    paramRenderPending = true;
    return;
  }
  paramRenderPending = false;
  paramRenderedNodeId = selId ?? heldSelectionId;
  // 重画之后，"面板正在显示的值"就是这一份。**必须在这里也记一次**，否则光标停在
  // 输入框里但一个字都没打时，门控会认为"没有可保护的编辑"而每帧重画，焦点照样丢。
  paramDisplayedParams = sel?.params ?? null;
  const renderedLabel = sel?.label ?? null;
  let renderedParams = sel?.params ?? null;
  renderParams(
    paramEl,
    sel ? { label: sel.label, kind: sel.kind, params: sel.params } : null,
    selId
      ? (params) => {
          // commit only while the ACTIVE target is still the rendered node: the
          // current selection, or the held node when nothing is selected (deselect
          // keeps the panel). Selection may change mid-edit.
          const cur = graph.getSelectedNode();
          const activeId = cur?.id ?? heldSelectionId;
          if (!activeId || activeId !== selId) return;
          const prevParams = cur?.params ?? renderedParams ?? [];
          // session undo: the first edit on this node captures the PRE-edit params
          // as `before`; later edits update `after`; 600ms debounce merges them into
          // a single { type: "params" } undo entry (selection switch flushes early)
          paramUndo.startOrMerge(selId, prevParams, params);
          graph.setNodeParams(selId, params);
          bindMgr?.onNodeParamsCommitted(selId, params); // P5b：绑定参数节流直写 Houdini
          // `_output_` 改了目的地 → **同步桥里的写回指针**（v0.1.00129，用户 #2）。
          // 桥 cook 时按这个指针决定：有指向就等 Cyl1nder 写回，没有就把 input 原样搬回。
          // 不登记的话桥永远以为"用户还没搭链路"，写回永远不会发生。
          if (sel?.kind === "output") void syncWritebackPointer(params);
          renderedParams = params;
          paramDisplayedParams = params; // 门控据此认出"这只是我自己编辑的回声"
          const prevValue = new Map(prevParams.map((q) => [q.name, q.value]));
          const changed = params.find((q) => prevValue.get(q.name) !== q.value);
          store.pushLog(`[param] ${renderedLabel ?? selId} ${changed ? `${changed.name} = ${changed.value}` : "params updated"}`);
          // pivot edits move the Enter reference marker live (the gizmo stays on tx/ty/tz)
          if (viewport.isEnterActive()) {
            const v = readParamFloats(params);
            viewport.setEnterPivot(v.px ?? 0, v.py ?? 0, v.pz ?? 0);
          }
          void network.run();
        }
      : undefined,
    sel && selId
      ? {
          // P5b 通道引用绑定 ctx：⛓ 链接按钮 → 当前 serial 的 param 通道列表。
          bindings: getNodeParamBindings(selId)?.bindings ?? {},
          listChannels: async () => {
            const { channels } = await client.listChannels();
            return channels
              .filter((c) => c.kind === "param" && c.serial === store.serial && c.absolutePath)
              .map((c) => ({ path: c.absolutePath ?? "", label: (c.absolutePath ?? "").split("/").pop() ?? "" }));
          },
          onBind: (name, channelPath) => {
            const view = getNodeParamBindings(selId);
            if (!view) return;
            const next = { ...view.bindings };
            if (channelPath) next[name] = channelPath;
            else delete next[name];
            setNodeBindings(selId, next);
            refreshSelectionPanels(); // 重渲染 param 面板显示 ⛓ 徽标
          },
        }
      : undefined,
    sel && selId
      ? {
          // 引用 ctx（v0.1.00121，需求 #5/#6）：右键菜单的「粘贴相对/绝对地址」靠它落地。
          //
          // netPath = 锚点吊牌所在的 Houdini 网络。**必须由桥来答**：相对地址是
          // 「相对锚点所在网络」的（兄弟节点语义），web 侧自己拼不出来。拿不到就留空 —— 
          // param.ts 会把「绝对地址」项禁用并把原因写进 title，而不是拼半截路径。
          netPath: anchorNetPathOf(store.serial),
          nodeLabel: renderedLabel ?? undefined,
          // 落地：相对形式存进节点自己的 refs（跟着图走、改名由 ref-registry 重写），
          // 绝对形式仍走 P5b bindings（那是既有的通道引用通路）。
          //
          // 为什么相对不转成绝对再存：那会**丢掉相对引用唯一的价值** —— 锚点移动后
          // 自动跟随。子智能体正确地拒绝了「悄悄解析成绝对再报告成功」这条捷径。
          onPasteRef: (target, clip, form) => {
            const names = target.kind === "vec3" && target.members?.length
              ? target.members
              : [target.name];
            if (form === "absolute") {
              const abs = clip.absolute;
              if (!abs) return;
              const view = getNodeParamBindings(selId);
              if (!view) return;
              const next = { ...view.bindings };
              // vec3 目标逐分量绑：bindings 的键是**真实 parm 名**，一个键一个值。
              names.forEach((nm, i) => {
                next[nm] = names.length > 1 ? `${abs}.${"xyz"[i] ?? "x"}` : abs;
              });
              setNodeBindings(selId, next);
              store.pushLog(`[param] 粘贴绝对引用 ${names.join(",")} <- ${abs}`);
            } else {
              // 相对：写进节点的 refs 参数（每个分量一条），并登记进 ref-registry，
              // 这样改名时它会被自动重写（Houdini 的登记制语义）。
              const cur = renderedParams ?? [];
              // **引用槽参数（`ref_slot{k}`）把地址写进 `value`，其余写进 `ref`**
              // （v0.1.00129 修「无法把 transform.tx 粘到 null 的 float 槽」）。
              //
              // 差别是本质的：`ref_slot0` **本身就是那个地址输入框** —— 用户手打的就是
              // 它的 value，`resolveWritebackValue` 读的也是 value。往它的 `.ref` 上写
              // 等于把地址存进一个没人读、界面也不显示的位置：粘贴"成功"了却什么都没发生。
              // 普通参数（tx/ty）反过来：value 是数值，引用只能挂在 `.ref` 上。
              const next = cur.map((p) => {
                if (!names.includes(p.name)) return p;
                return p.name.startsWith(REF_PARAM_PREFIX)
                  ? { ...p, value: clip.relative }
                  : { ...p, ref: clip.relative };
              });
              graph.setNodeParams(selId, next);
              renderedParams = next;
              store.pushLog(`[param] 粘贴相对引用 ${names.join(",")} <- ${clip.relative}`);
            }
            refreshSelectionPanels();
          },
        }
      : undefined,
  );
}

// --- 写回执行（v0.1.00129，用户需求 #2）------------------------------------
// 已发过的值，按 `<pid>:<逻辑名>` 记账。**只推变化的**：反复写同一个值会刷掉用户在
// Houdini 里的撤销栈、让它白重算（与 CookTxn.flush 的"值未变则跳过"同一个理由）。
const writebackSent = new Map<string, unknown>();
/**
 * 被拒的名字 → **当时那个值**。同一个值不重试，值一变就再试一次。
 *
 * 为什么按「值」而不是按「图版本」记（v0.1.00131 第二次修）：`graphVersion` 只在
 * `connectioncreate/remove` 与 `nodecreate/remove` 时自增（graph.ts:599），
 * **改参数不算**。而这里的拒绝恰恰几乎总是改参数就能修好（改引用表达式、改端口），
 * 所以拿图版本当判据等于永不重试 —— 我第一版就是这么写的，探针实测填对 `ch()` 之后
 * 仍然只看到旧的拒绝日志。
 *
 * 按值记则天然正确：拒绝的理由是「**这个值**的形状不对」或「**这个名字**没有映射」，
 * 值变了就说明前提变了，值没变就说明重试也只会得到同一条错误。
 */
const writebackRefused = new Map<string, unknown>();
let writebackTimer: number | null = null;

/** 写回值是否与上次发过的相同。**数组逐元素比**：vec3 用 `===` 恒为 false，
 *  会导致每帧重推、刷掉用户在 Houdini 的撤销栈。 */
function sameWritebackValue(prev: unknown, next: number | number[]): boolean {
  if (Array.isArray(next)) {
    return (
      Array.isArray(prev) && prev.length === next.length && next.every((v, i) => prev[i] === v)
    );
  }
  return prev === next;
}

/** 推一次写回（去抖 120ms）。fire-and-forget：flush 是同步热路径，绝不 await。
 *  已排队时直接返回（**latest-wins**：值在定时器触发的那一刻才读，所以不必续期）。 */
function scheduleWriteback(): void {
  if (writebackTimer !== null) return;
  writebackTimer = window.setTimeout(() => {
    writebackTimer = null;
    void runWritebackGuarded();
  }, 120);
}

let writebackRunning = false;
let writebackRerun = false;

/**
 * 单飞（single-flight）包一层（v0.1.00139）：同一时刻只允许一轮写回在跑。
 *
 * 为什么需要：去抖计时器在 **await 之前**就把自己置空了，而一轮 vec3 写回要 ~1s
 * （桥逐分量打 3 次 MCP）。那段时间里 TTL 轮询再调一次 `scheduleWriteback()`，
 * 120ms 后**第二轮并发开跑** —— 此时第一轮还没执行到 `writebackSent.set(...)`，
 * 于是两轮都认为"这个值没发过"，同一个值被推两次。
 * 实测日志里就是连着两行 `transform1/t = [7,8,9]`。
 *
 * 重复写同值会刷掉用户在 Houdini 的撤销栈、让它白重算 —— 正是 `writebackSent`
 * 想避免的事，只是它挡不住**并发**。
 *
 * 期间来的请求不丢：置 `writebackRerun`，当前这轮结束后再补跑一次（latest-wins）。
 */
async function runWritebackGuarded(): Promise<void> {
  if (writebackRunning) {
    writebackRerun = true;
    return;
  }
  writebackRunning = true;
  try {
    await pushWritebackOnce();
  } finally {
    writebackRunning = false;
    if (writebackRerun) {
      writebackRerun = false;
      scheduleWriteback();
    }
  }
}

/** 图外引用的值缓存，键 `<pid>:<逻辑名>`。 */
const externRefCache = new Map<string, number | number[]>();
/** 每个键上次取到值的时刻（配合 TTL 判定该不该重取）。 */
const externRefAt = new Map<string, number>();
/**
 * 图外引用的重取间隔（毫秒）。
 *
 * v0.1.00133 时这里是**永不重取** —— 理由是那条读要 15.2s，经不起轮询。
 * v0.1.00134 把它降到 85ms（首读 1.1s）之后那个理由就不成立了，而"永不重取"是个真 bug：
 * 用户在 Houdini 里改了被引用的参数，写回会**永远推旧值**。
 *
 * 2s 是取舍：足够跟上手动改参数，又不至于把桥打满（85ms 一次读，占空比约 4%）。
 */
const EXTERN_REF_TTL_MS = 2000;

/**
 * 去桥取「图外」引用的当前值，填进 `externRefCache`（v0.1.00133）。
 *
 * 为什么要预取而不是让解析器自己 await：`resolveWritebackValue` 跑在同步热路径上
 * （flush 每帧都跑），改成异步会让整条取值链变成 Promise，且顺序不再可预测。
 * 预取 + 同步查表把「异步」限制在这一处。
 *
 * 取不到的一律**不写进缓存** —— 于是解析器查不到、这次就不写。
 * 绝不塞 0 占位：那会把「读不到」变成「值是 0」，静默清零用户的参数。
 */
/** 正在取的键，避免同一地址被每帧重复请求（15s 一次，重复请求会堆成灾）。 */
const externRefInFlight = new Set<string>();

/** TTL 轮询计时器；只在**确实有图外引用**时存活。 */
let externRefPollTimer: number | null = null;

/**
 * 图外引用的 TTL 轮询（v0.1.00135）。
 *
 * 为什么必须有它：`prefetchExternRefs` 只能从 `pushWritebackOnce` 进来，而后者只在
 * `scheduleWriteback()` 被调用时才跑（store flush、或某个值到达）。**TTL 到期本身
 * 谁也叫不醒** —— 实测 14s 内只重取了 1 次（期望约 6 次）。
 * 所以「有图外引用」这件事必须自己维持一个心跳。
 *
 * **没有图外引用就不轮询**：空图/纯图内引用的场景一次请求都不该发。
 */
function armExternRefPoll(): void {
  if (externRefPollTimer !== null) return;
  externRefPollTimer = window.setTimeout(() => {
    externRefPollTimer = null;
    scheduleWriteback(); // 让 pushWritebackOnce 再跑一轮，TTL 到期的键会被重取
  }, EXTERN_REF_TTL_MS);
}

function prefetchExternRefs(pid: string, addresses: string[]): void {
  // 有图外引用 → 维持轮询；没有 → 自然停下（不 arm，上一轮的 timer 跑完即止）。
  if (addresses.length > 0) armExternRefPoll();
  for (const addr of addresses) {
    const key = `${pid}:${addr}`;
    // 值还新鲜（TTL 内）或正在取 → 跳过。TTL 的理由见 EXTERN_REF_TTL_MS：
    // v0.1.00133 是「永不重取」，那会让写回永远推旧值；读降到 85ms 后已无须将就。
    const at = externRefAt.get(key);
    if (externRefInFlight.has(key)) continue;
    if (at !== undefined && Date.now() - at < EXTERN_REF_TTL_MS) continue;
    externRefInFlight.add(key);
    void client
      .getMappingValue(pid, addr)
      .then((r) => {
        if (!r.ok) {
          store.pushLog(`[writeback] 图外引用读取失败 ${addr}: ${r.error ?? "未知"}`);
          return;
        }
        const v = r.value;
        const prev = externRefCache.get(key);
        if (typeof v === "number" && Number.isFinite(v)) externRefCache.set(key, v);
        else if (Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x))) {
          externRefCache.set(key, v as number[]);
        } else {
          // dict 形状（APEX ctrl 的 `{ctrl,t,r}`）等无法写进参数的值：如实说，别静默。
          store.pushLog(`[writeback] 图外引用 ${addr} 的值不是数值/矢量，跳过`);
          return;
        }
        externRefAt.set(key, Date.now()); // TTL 计时从**取到值**起算
        // **值没变就不记日志、不重跑**：TTL 到期后每 2s 都会重取一次，
        // 每次都刷一条「就绪」会把日志淹掉，也会让写回白跑一轮。
        const now = externRefCache.get(key);
        if (sameWritebackValue(prev, now as number | number[])) return;
        store.pushLog(`[writeback] 图外引用就绪 ${addr} = ${JSON.stringify(now)}`);
        scheduleWriteback(); // 值到了才重跑一轮 —— 否则要等下一次 flush 才用上
      })
      .finally(() => externRefInFlight.delete(key));
  }
}

/** 扫一遍当前图的 `_output_`，把有值的推到桥的映射端点。 */
async function pushWritebackOnce(): Promise<void> {
  const pid = currentProjectId;
  if (!pid) return; // 逻辑名只在项目内唯一，没项目无从解析
  let snap: ReturnType<typeof graph.getNetworkSnapshot>;
  try {
    snap = graph.getNetworkSnapshot();
  } catch {
    return; // 图还没就绪
  }

  // 预取图外引用的值（v0.1.00133）。`resolveWritebackValue` 是同步的（flush 是热路径），
  // 所以「问桥」这一步必须发生在它**之前**，把结果填进缓存供它同步查。
  // **不 await**：这条读实测 15.2s，await 会把每帧的 flush 卡死 15 秒。
  // 改成即发即忘 —— 值到了它自己再调一次 scheduleWriteback，下一轮就用上。
  prefetchExternRefs(pid, collectExternRefAddresses(snap));

  for (const t of collectWritebackTargets(snap)) {
    const key = `${pid}:${t.port}`;
    const value = resolveWritebackValue(snap, t, (addr) => externRefCache.get(`${pid}:${addr}`));
    if (value === undefined) continue; // 没算出值 ≠ 值是 0，绝不兜底写 0
    // 被拒过**且前提没变** → 跳过。判据必须放在算出值**之后**：
    // 拒绝的理由是「这个值的形状不对」或「这个名字没有映射」，前提变了就该重试。
    // 放在前面（只看 key）等于永久钉死，用户改对也不再试。
    //
    // **前提 = 端口类型 + 值**（v0.1.00140）。此前只记值：于是「引用给的是标量、
    // 端口是 vec3」被拒之后，用户把**端口类型**改成 float（值一个字没动）仍然不重试 ——
    // 明明已经改对了，却永远不写。这是 e2e 的差分断言抓出来的（先断言 vec3 不写、
    // 再改回 float 断言必须写），只断言"没有 PUT"的测试抓不到它。
    const refuseKey = `${t.type}|${JSON.stringify(value)}`;
    if (writebackRefused.get(key) === refuseKey) continue;
    // **逐元素比**（v0.1.00131）：vec3 是数组，`===` 恒为 false ——
    // 那会让 vec3 每帧都重推一次，刷掉用户在 Houdini 的撤销栈。
    // 这与 param.ts 里 `paramValuesEqual` 要与 `core/params.paramsEqual` 区分开
    // 是同一个陷阱：引用相等不是值相等。
    if (sameWritebackValue(writebackSent.get(key), value)) continue;
    // **形状必须与目标类型一致**（v0.1.00131）：vec3 目标收数组、float 目标收标量。
    //
    // 不拦的话错形状会一路送到 Houdini，报出的是**看不懂的**错：给 vec3 目标写标量时
    // `set_parameter` 走 `node.parm("t")`（元组参数为 None）→
    // 「Parameter 't' not found ... Did you mean: tz, ty, tx」。实测撞到过，
    // 那条消息完全指不出真因（真因是「引用给的是数字 2，而端口是 vec3」）。
    const wantVec = t.type === "vec3";
    if (wantVec !== Array.isArray(value)) {
      writebackRefused.set(key, refuseKey);
      // **把实际值写进消息**：原来只说「单个数值」，不说是哪个值 —— 于是
      // 「引用取到了 0.150023」与「引用其实还是字面量 2」长得一模一样，
      // 用户（和我自己排查时）都无从判断引用到底解析到了什么。
      store.pushLog(
        `[writeback] 停止重试 ${t.port}：端口是 ${t.type}，但引用给出的是` +
          `${Array.isArray(value) ? `${value.length} 个分量` : "单个数值"} ${JSON.stringify(value)}` +
          `（vec3 请引用 vec3 组名，如 ch("../transform1/t")）`,
      );
      continue;
    }
    const r = await client.putMappingValue(pid, t.port, value);
    if (r.ok) {
      writebackSent.set(key, value);
      store.pushLog(`[writeback] ${t.port} = ${JSON.stringify(value)}`);
    } else if (r.cycle || /not found|dangling|unresolved/i.test(r.error ?? "")) {
      // **终态失败不重试**：环不会因为再发一次消失，「映射不存在」也不会。
      // 不停手的话每帧刷一条日志（实测撞到：`失败 transform1/tx: mapping not found`
      // 连刷四条），把真正有用的日志淹掉。
      writebackRefused.set(key, refuseKey);
      store.pushLog(`[writeback] 停止重试 ${t.port}：${r.error ?? "桥拒绝"}`);
    } else {
      // 其余（网络抖动/桥重启）是**瞬时**失败，留给下一帧重试。
      store.pushLog(`[writeback] 失败 ${t.port}: ${r.error ?? "未知"}`);
    }
  }
}

/**
 * 把 `_output_` 的目的地同步成桥里的写回指针（v0.1.00129，用户需求 #2）。
 *
 * 指针的键是**当前 cook 的那个 HDA 的 serial + 输出槽序号**，值是「写到哪个项目的哪个
 * 逻辑名」。所以：
 * - `store.serial` = 正在 cook 的 HDA（指针的主人，不是目的地）；
 * - `address` = 目的地所在的**吊牌** serial，它只用来查项目，不进指针；
 * - `port` = 目的地逻辑名（`transform1/tx`），这才是要写的东西。
 *
 * 目的地填不全（address 或 port 为空）→ **删指针**，让桥回落 passthrough。
 * 「清空目的地」与「从未设过」在语义上必须一样，否则删掉地址之后桥还在等一个永远
 * 不会来的写回。
 *
 * 失败只记日志：登记指针是编辑的副作用，桥离线不该让改图看起来失败。
 */
async function syncWritebackPointer(params: ParamSpec[]): Promise<void> {
  const serial = store.serial;
  if (!serial) return;
  const val = (n: string): string => {
    const v = params.find((p) => p.name === n)?.value;
    return typeof v === "string" ? v.trim() : "";
  };
  const port = val("port");
  const address = val("address");
  // 单端口形态：槽序号恒 0。多输出槽真正落地后这里要改成读该节点的槽序号。
  const slot = 0;
  if (!address || !port) {
    const r = await client.deleteWritebackTarget(serial, slot);
    if (!r.ok && r.error) store.pushLog(`[writeback] 清指针失败: ${r.error}`);
    else store.pushLog(`[writeback] 目的地为空 → 清指针（桥回落 passthrough）`);
    return;
  }
  const pid = currentProjectId;
  if (!pid) {
    store.pushLog(`[writeback] 未在项目模式，无法登记指针（逻辑名只在项目内唯一）`);
    return;
  }
  const r = await client.putWritebackTarget(serial, slot, pid, port);
  store.pushLog(
    r.ok
      ? `[writeback] 指针已登记 ${serial}#${slot} → ${pid}:${port}`
      : `[writeback] 登记失败: ${r.error ?? "未知原因"}`,
  );
}

/** 某 serial（锚点吊牌）所在的 Houdini 网络绝对路径 —— 相对地址的基准。
 *
 *  取自通道大全里该 serial 的 `nodePath` 去掉最后一段（**兄弟节点语义**，与
 *  `mapping.py` 的解析规则一致：`absolutePath = <锚点所在网络> + "/" + rel`）。
 *  取不到就返回 undefined，让 param 面板禁用「绝对地址」项而不是拼半截路径。 */
function anchorNetPathOf(serial: string | null): string | undefined {
  if (!serial) return undefined;
  // 复用 serial-capabilities 的同步缓存（它取 capabilities 时已经带回 nodePath），
  // 不另开一份缓存：两份缓存必然漂移，而这里要的正是它已经有的那个事实。
  const caps = cachedCapabilities(serial);
  const p = caps?.nodePath ?? "";
  if (p === "") {
    // **缓存未命中就去取一次**（v0.1.00127 修 bug #4「不能粘贴绝对地址」）。
    //
    // 此前只读缓存：而缓存只在「打开 _input_/_output_ 的端口下拉」时才被填。
    // 用户右键的是 transform 的 tx —— 那条路径从不碰下拉，于是 netPath 永远是空，
    // 「粘贴绝对 param 地址」永远禁用（菜单 title 实录：「该引用没有绝对地址
    // （网络路径未知）」—— 提示是对的，缺的是有人去取）。
    //
    // fire-and-forget + 取回后刷新面板：本函数在同步渲染路径上，不能 await。
    // loadCapabilities 自带去抖与单飞，所以每帧调用不会打爆桥。
    void loadCapabilities(serial).then((caps2) => {
      if (caps2?.nodePath) refreshSelectionPanels();
    });
    return undefined; // 这一帧仍然禁用（诚实：现在确实还不知道）
  }
  const cut = p.lastIndexOf("/");
  return cut > 0 ? p.slice(0, cut) : undefined;
}

function inputStatsText(): string {
  const lines: string[] = [];
  for (let i = 0; i < 4; i++) {
    const inp = store.inputs.find((x) => x.index === i);
    lines.push(`in${i}: ${inp ? `${inp.pointCount}pt ${inp.curves.length}crv` : "—"}`);
  }
  return lines.join("\n");
}

function outputStatsText(): string {
  const lines: string[] = [];
  for (let i = 0; i < 4; i++) {
    const out = store.outputs.find((x) => x.index === i);
    lines.push(`out${i}: ${out ? `${out.pointCount}pt r${out.rev}` : "—"}`);
  }
  return lines.join("\n");
}

function renderInspector(): void {
  const rows: string[] = [
    `<div class="insp-row"><b>serial</b> ${store.serial || "—"}</div>`,
    `<div class="insp-row"><b>status</b> ${store.status}</div>`,
    `<div class="insp-row"><b>inputRev</b> ${store.inputRev}</div>`,
    `<div class="insp-row"><b>outputRev</b> ${store.outputRev}</div>`,
  ];
  for (const inp of store.inputs) {
    rows.push(`<div class="insp-row inp"><b>in${inp.index}</b> ${inp.pointCount}pt / ${inp.curves.length}crv</div>`);
  }
  for (const out of store.outputs) {
    rows.push(`<div class="insp-row out"><b>out${out.index}</b> ${out.pointCount}pt / ${out.curves.length}crv r${out.rev}</div>`);
  }
  rows.push(`<div class="insp-row hint">Alt+拖拽 = Houdini 导航 · 点选曲线拖拽 = 编辑→out · Tab 搜索节点 · 按住 Y 剪切 · 右键节点=flags</div>`);
  layout.inspectorEl.innerHTML = rows.join("");
}

/** P2b 项目模式：当前是否处于项目根（graph 就绪后才可查询；boot 早期必为 false）。 */
function isProjectModeActive(): boolean {
  return graphReady && currentProjectId !== null && graph.isProjectMode();
}

/** 当前地址。以 `graphScope` 为准（与保存共用同一状态，两者不可能再对不上）；
 *  scope 尚未建立时退回 buildGraphAddress（纯逻辑与单测在 app/graph-address.ts）。 */
function projectAddress(): string {
  if (graphScope.kind !== "none") return addressOf(graphScope);
  return buildGraphAddress(currentProjectId, store.serial);
}

// ---------------------------------------------------------------------------
// obj/sop 层级导航（v0.1.00119）：地址栏按**节点名**下沉/上浮。
//
// 事实来源只有一处：nodes2/graph 的层级栈（getNetPath()）。本文件**不记**深度，只在
// 层级真的换完之后把 getNetPath() 抄进 graphScope.path —— 于是"地址显示的层"与"编辑器
// 里那一层"不可能各说各话（这正是 app/graph-scope.ts 头部那场事故的形状）。
// ---------------------------------------------------------------------------

/** 等待「层级已换完」的待办队列。`enterNode`/`exitNode` 同步返回 true，但真正的图交换
 *  在它们内部的 async IIFE 里完成；要按名连下两层就必须等上一层落地（否则编辑器里还是
 *  父图，第二个名字必然找不到）。 */
let netPathWaiters: Array<() => void> = [];

/** 层级变化的**唯一**汇合点：抄一次 getNetPath() 进 scope、刷地址、放行等待者。 */
function onNetPathChanged(): void {
  if (graphScope.kind !== "none") graphScope = withPath(graphScope, getNetPath());
  updateGraphAddress();
  const waiters = netPathWaiters;
  netPathWaiters = [];
  for (const fn of waiters) fn();
}

/** 等下一次层级变化落地。**带超时兜底**：`restoreGraph` 若在 async 里抛，回调永远不来，
 *  没有兜底的 await 会把整条导航永久挂住（用户看到的是"地址栏点了没反应"）。 */
function waitNetPath(timeoutMs = 2000): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    netPathWaiters.push(finish);
    setTimeout(finish, timeoutMs);
  });
}

/** 当前网络里**可进入**节点的标签（地址栏补全用）。图未就绪 → []。 */
function enterableNodeNames(): string[] {
  if (!graphReady) return [];
  return (graph.editor.getNodes() as CylNode[])
    .filter((n) => isEnterableKind(n.kind))
    .map((n) => n.label)
    .filter((s) => !!s);
}

/** 按 id 进入某节点，**等图换完**才返回（enterNode 本身同步返回、交换在其内部 async 里）。
 *  节点不存在 / 不可进入 / enterNode 拒绝 → false 且**不留等待者**（否则那个 promise 会被
 *  下一次无关的层级变化误唤醒）。 */
async function enterNodeAwaited(nodeId: string): Promise<boolean> {
  if (!graphReady) return false;
  const node = graph.editor.getNode(nodeId) as CylNode | undefined;
  if (!node || !isEnterableKind(node.kind)) return false;
  // 先调用再登记等待者是安全的：waitNetPath() 同步入队，而层级回调最早也要等一个
  // microtask（enterNode 内部是 async IIFE），不可能在这两行之间就触发。
  if (!enterNode(node.id)) return false;
  await waitNetPath();
  return true;
}

/** 按标签进入当前网络里的某节点；成功 = 图**已经**换完（await 过层级回调）。
 *  找不到该名字 / 不可进入 → false（调用方据此走"无法解析地址"）。 */
async function enterByName(name: string): Promise<boolean> {
  if (!graphReady) return false;
  const node = (graph.editor.getNodes() as CylNode[]).find((n) => n.label === name);
  return node ? enterNodeAwaited(node.id) : false;
}

/** 退到指定深度（层级栈长度）。每层都等换完才退下一层，理由同 enterByName。 */
async function exitToDepth(depth: number): Promise<void> {
  let guard = 0;
  while (getNetPath().length > depth && guard < 64) {
    guard += 1;
    const pending = waitNetPath();
    if (!exitNode()) break; // 已在顶层：exitNode 返回 false，别空等回调
    await pending;
  }
}

/**
 * 按名导航到任意深度（地址栏第 1 段起的节点名路径）。
 *
 * 先与当前路径求**公共前缀**，只退到分叉处再往下走：从 `/P1/geo1/geo2/` 点面包屑
 * `/P1/geo1/` 只退一层，而不是"退到顶再重进 geo1"——后者会多做两次整图 restore，
 * 且每次 restore 都可能丢掉尚未写回的编辑。
 * 任一段解析不出 → 记一行 log 后返回 false（保持既有"无法解析地址"语义，绝不抛）。
 */
function navigateByName(segs: string[]): boolean {
  const names = segs.slice(1);
  const current = getNetPath();
  let common = 0;
  while (common < current.length && common < names.length && current[common] === names[common]) common += 1;
  const todo = names.slice(common);
  // **能同步判死的就同步判死**：不需要先退层时，第一跳的节点就在当前编辑器里，查得到。
  // 于是 `/P1-…/不存在的名字/` 能如实返回 false，地址栏才会走它既有的"不可跳转 → 复制"
  // 兜底；只有更深的段（要先换层才知道）才不得不异步报错。
  if (todo.length > 0 && common === current.length && !enterableNodeNames().includes(todo[0])) {
    store.pushLog(`[addr] 无法解析地址: /${segs.join("/")}/（节点「${todo[0]}」不存在或不可进入）`);
    return false;
  }
  void (async () => {
    await exitToDepth(common);
    for (const name of todo) {
      if (!(await enterByName(name))) {
        store.pushLog(`[addr] 无法解析地址: /${segs.join("/")}/（节点「${name}」不存在或不可进入）`);
        return;
      }
    }
  })();
  return true;
}

/** P2b 项目模式保存：图快照 → PUT /api/projects/{id}/graph。
 *  项目模式不写 per-serial snapshot（store.serial 为空会 400）；docking/preference 在
 *  项目模式下跳过 —— 布局沿用全局 ui-layout 文件与 localStorage，偏好沿用 localStorage。 */
function saveProjectGraph(): void {
  if (!currentProjectId) return;
  // **任意层级保存都是安全的**：`graph.projectGraphSnapshot()` 走 nodes2/graph.ts 的
  // `serializeGraphFromRoot()`，它把当前图沿层级栈向外折叠（当前图 → 最近父层的
  // children → 再往上，直到顶层），因此拿到的始终是顶层那张完整的图；栈不被修改，
  // 所以定时自动保存不会把用户从当前层挪走。深度 0 时它退化成 serializeGraph，输出字节不变。
  // 此处曾有一条「在子网络内拒绝保存」的分支：那是在 fold 存在之前的止损，现在它只会
  // 让本该正确落盘的子网络编辑被静默丢弃，故删除。
  // 只有当前图**确实是项目根图**才允许写项目槽位。
  // 事故根因：进入成员后 currentProjectId 仍非空、图已换成成员图，旧代码据此把成员图
  // 写进 projects/<pid>/graph.json，项目根（project + channel 节点）被覆盖成 2 节点
  // v2 默认图，且因为图里已无 project 节点，projectGraphSnapshot() 还"优雅降级"到 v2、
  // 连报错都没有。用户看到的是「save 后 load 变默认场景」——load 是无辜的。
  if (!canWriteProjectGraph(graphScope)) {
    store.pushLog(
      `[file] 拒绝写项目图：当前图不是项目根（scope=${graphScope.kind}）——` +
        `成员图写进项目槽位会覆盖项目根结构`,
    );
    const serial = snapshotSerialOf(graphScope);
    if (serial) {
      // 成员工作区：写它自己的 snapshot 才是正确归属
      void client
        .putSnapshot(serial, { graph: graph.serializeGraph(), docking: getDockJson(), preference: prefs })
        .then(() => store.pushLog(`[file] 已保存成员图 ${serial}`))
        .catch((e) => store.pushLog(`[file] 成员图保存失败: ${String(e)}`));
    }
    return;
  }
  void client
    .putProjectGraph(currentProjectId, graph.projectGraphSnapshot())
    .then((r) => store.pushLog(r.ok ? "[file] project graph saved" : "[file] project graph save failed"))
    .catch((e) => store.pushLog(`[file] project graph save failed: ${String(e)}`));
}

/** P2b 项目模式入口（?project= boot / 地址栏 1 段 P1- / 2 段 /<P1>/<C1>/ 导航）：
 *  1. store.serial 置空（项目模式无单一活动成员镜像）；2. 取项目；3. 取图快照（失败当 null）；
 *  4. loadProjectGraph；5. 对全部 tag/hda 成员 ensureSession（不激活）；6. 挂 channel display
 *  点击 → 激活成员 + 地址刷新；7. 地址更新。失败 log 提示不崩。已在目标项目时走 fast path
 *  （仅清空活动成员回项目根，不重载图以免覆盖未保存编辑）。
 *
 *  `opts.loadGraph === false`：**只建立项目上下文，不把图换成项目根**（v0.1.00120
 *  `?project=&member=` 直达成员用）。为什么需要这个开关：直达某个成员时，用户要的是
 *  **那个成员的工作区**，项目根图只会一闪而过再被成员图盖掉；更要紧的是 `graphScope`
 *  会先落成 `project`，而成员没有存图时 pending 不兑现、scope 就**留在** project —— 此后
 *  Ctrl+S 走 putProjectGraph，把成员的编辑写进项目槽位（正是 graph-scope.ts 头部那场
 *  数据丢失事故的形状）。跳过换图，scope 从一开始就是 member，保存永远落在成员自己的
 *  snapshot 上。 */
async function enterProjectMode(projectId: string, opts?: { loadGraph?: boolean }): Promise<void> {
  const loadGraph = opts?.loadGraph !== false;
  // fast path 只在"要回项目根"时成立：loadGraph=false 的调用方（直达成员）绝不能被
  // 这里把 scope 拽回 project —— 那正是它要避免的事。
  if (loadGraph && currentProjectId === projectId && graphReady && graph.isProjectMode()) {
    store.setSerial("");
    // 回到项目根：图确实是项目根图（isProjectMode 已确认），scope 必须跟着回来，
    // 否则残留的 member scope 会让 Save 一直拒写项目图。
    // path 不带：isProjectMode() 为真即说明当前就是项目根那一层（子网络里 project 节点不在）。
    graphScope = { kind: "project", projectId };
    store.pushLog(`[project] 项目模式 ${projectId}（已在，回到项目根）`);
    updateGraphAddress();
    return;
  }
  // 项目根无单一活动成员 → 清空镜像；直达成员（loadGraph=false）不清：紧随其后的
  // activateSession 会把它设成该成员，中间清一次只会让视口白闪一帧。
  if (loadGraph) store.setSerial("");
  store.pushLog(`[project] 项目模式 ${projectId} …`);
  let project: ProjectRef | null = null;
  try {
    const r = await client.getProject(projectId);
    if (r.ok) project = r.project;
    else store.pushLog(`[project] 读取项目失败: ${projectId}`);
  } catch (e) {
    store.pushLog(`[project] 读取项目失败: ${String(e)}`);
  }
  if (!project) {
    store.setStatus("offline");
    return;
  }
  // 切项目 = 映射表换了一整张（逻辑名是项目内的命名空间）→ 旧缓存必须先作废，
  // 否则新项目的第一批查表会命中上一个项目的类型，静默算错（比报「未加载」糟得多）。
  // 成对作废（务必保持相邻）：两个缓存都以「当前项目上下文」为键——映射类型表是项目内的
  // 逻辑名命名空间，端口清单是成员 serial 的端口解析结果。换项目时两者同时过期；只清一个
  // 的话，另一个会用**上一个项目**的数据继续作答（端口下拉里冒出前一个项目的端口，正是
  // 这次要堵的洞），而且是静默错答，比报「未加载」难查得多。
  if (currentProjectId !== null && currentProjectId !== projectId) {
    invalidateMappingTypes();
    invalidateCapabilities();
  }
  currentProjectId = projectId;
  currentProject = project;
  if (loadGraph) {
    graphScope = { kind: "project", projectId }; // 图即将被换成项目根图
    // 进项目模式时地址栏同步成 ?project=（此处模式与地址一致，改写是诚实的）。
    syncProjectInAddress(projectId);
  }
  // task #8：映射类型缓存与项目图**并发**取，然后一起 await。
  //
  // 为什么要 await（而不是 fire-and-forget）：端口类型的唯一真源就是这张表，第一次 cook
  // 若表还没到，每个填了 address 的节点都会挂上「映射表未加载」红三角，然后在表到达后
  // 才消失——用户看到的是一图红叉再自己好，像个 bug。
  // 为什么不额外卡时间：它与 getProjectGraph 并发跑，总耗时 = max(两者) 而不是相加；
  // 且 primeMappingTypes 绝不抛/绝不 reject（桥离线时静默保持未加载态），await 它不会
  // 把进项目这条路径变脆。
  const primed = primeMappingTypes(projectId);
  let graphJson: unknown = null;
  try {
    const g = await client.getProjectGraph(projectId);
    if (g.ok) graphJson = g.graph;
  } catch {
    graphJson = null; // 读取失败当 null（如新项目尚无图快照）
  }
  await primed;
  // loadGraph=false：图留给调用方（直达成员时由 activateSession 的 loadSnapshot 决定，
  // 无存图则保持默认 in/out 对——与旧 `?serial=` 启动逐字同形）。
  if (loadGraph) {
    graph.loadProjectGraph(
      { projectSerial: project.projectSerial, label: project.label, members: project.members },
      graphJson,
    );
  }
  for (const m of project.members) {
    if ((m.kind === "tag" || m.kind === "hda") && m.serial) {
      sessionMgr.ensureSession(m.serial); // 不激活：仅确保该成员 workspace/轮询存在
    }
  }
  graph.setChannelDisplayHandler((serial: string) => {
    // **只登记意图，不改地址**（v0.1.00119 修 task #7 的地址 bug）。
    //
    // 旧代码在这里就把 scope 设成 member 并立刻刷地址，但真正的图交换发生在
    // activateSession 内部：它是 fire-and-forget（`void deps.loadSnapshot(serial)`，
    // 无返回值、无完成信号），而 loadSnapshotIntoStore 只在快照**真的带图**时才
    // restoreGraph。于是「点了 obj 层的 display flag，地址变成 /P1-…/C1-…/ 但 nodeview
    // 纹丝不动」——用户报的正是这个。
    // 现在：pending 由 commitPendingMemberScope() 在 restoreGraph 落地之后才兑现，
    // 图没换 → 地址不动，地址栏因此永远描述**眼前这张图**。
    pendingMemberScope = { projectId, serial };
    sessionMgr.activateSession(serial); // channel display 点击 = 激活成员
  });
  updateGraphAddress();
}

/**
 * 「打开某个 HDA 成员」的**唯一**入口（v0.1.00120 删除 `?serial=` 页面入口后新增）。
 *
 * ## 为什么存在
 *
 * serial 不再是页面地址：成员只作为**项目的成员**可达。于是「打开这个 HDA」必须先问桥
 * 「它属于哪个项目」（`ensureProject` = 桥的 serial→项目映射，没有则隐式建单成员项目），
 * 再进那个项目、激活该成员。这条解析**只有桥说得准**，前端不猜、也不自己拼项目号。
 *
 * ## 为什么用 `loadGraph:false` 而不是「进项目根再激活成员」
 *
 * 直达成员时用户要的是**那个成员的工作区**。若先换成项目根图：
 *  - 成员**有**存图 → 项目根图一闪而过再被盖掉（白闪一帧，纯浪费）；
 *  - 成员**没有**存图 → pending 不兑现，`graphScope` 留在 `project`，此后 Ctrl+S 会把
 *    这张（其实是默认 in/out 对的）图 `putProjectGraph` 写进**项目槽位**，覆盖项目根
 *    结构 —— graph-scope.ts 头部记的那场真实数据丢失，换个入口重演。
 * 跳过换图后 scope 一开始就是 `member`，保存必然落在成员自己的 snapshot 上。
 *
 * 与地址栏 2 段 `/P1-…/C1-…/` 分支的差别是**故意的**：那条分支眼前已有一张项目根图
 * （可能带未保存编辑），所以必须走 pending、等图真的换了才改地址；而本函数跑在页面
 * 启动/显式跳转时，手上只有一张空的默认图，没有"图没换"的歧义，可以直接写 scope。
 *
 * @returns 解析到的 projectId；桥不可达/解析失败则 null（调用方据此回退）。
 */
async function openProjectMember(serial: string): Promise<string | null> {
  let projectId: string | null = null;
  try {
    const r = await client.ensureProject(serial);
    if (r.ok && r.project?.projectSerial) projectId = r.project.projectSerial;
  } catch (e) {
    store.pushLog(`[project] 解析 ${serial} 所属项目失败: ${String(e)}`);
  }
  if (!projectId) {
    // 桥不可达时不能假装进了项目：serial 模式已不存在，诚实地停在"未连接"并说清原因，
    // 比伪造一个项目号更好——后者会让地址栏指向一个并不存在的地方。
    store.pushLog(`[project] 无法解析 ${serial} 所属项目（桥离线？）——请从 Overview 进入`);
    store.setStatus("offline");
    return null;
  }
  const ok = await enterMemberWorkspace(projectId, serial);
  return ok ? projectId : null;
}

/** 进入「项目 P 下成员 C 的工作区」——`openProjectMember`（serial 已解析出项目）与
 *  `?project=&member=` 启动**共用**这一段，两条入口因此不可能行为漂移。
 *  @returns 是否真的进去了（读项目失败 → false，调用方不再激活会话）。 */
async function enterMemberWorkspace(projectId: string, serial: string): Promise<boolean> {
  layout.serialInput.value = serial;
  // scope 先落 member：enterProjectMode(loadGraph:false) 不碰 scope，图也不换，
  // 因此这里写下的归属从第一帧起就描述眼前这张图。
  graphScope = { kind: "member", projectId, serial };
  syncMemberInAddress(projectId, serial);
  await enterProjectMode(projectId, { loadGraph: false });
  // enterProjectMode 失败（读项目失败）时 currentProjectId 不会被设上 → 不再激活，
  // 避免"会话连上了但项目上下文是空的"这种半吊子状态。
  if (currentProjectId !== projectId) return false;
  sessionMgr.activateSession(serial);
  return true;
}

/** 待兑现的成员归属（channel display 点击登记 → 图确实换成该成员图后才落地）。 */
let pendingMemberScope: { projectId: string; serial: string } | null = null;

/** 图**已经**换成 `serial` 的成员图 —— 此刻才把 scope/地址切到 member。
 *  loadSnapshotIntoStore 在 restoreGraph 成功后调用；serial 不匹配（期间又切了成员）
 *  则丢弃这次兑现，绝不把地址写成一个已经过期的目标。 */
function commitPendingMemberScope(serial: string): void {
  const pending = pendingMemberScope;
  if (!pending || pending.serial !== serial) return;
  pendingMemberScope = null;
  // path 不带：换的是**另一张图**，层级栈的旧深度对新图没有意义（顶层起算）。
  graphScope = { kind: "member", projectId: pending.projectId, serial };
  updateGraphAddress();
}

/** Graph panel chrome: address bar text + dock panel title follow the current
 *  serial ("/<serial>/", Houdini node-view style); without a serial the bar shows
 *  "/" and the panel keeps its "Node Graph" title. Idempotent - safe to run on
 *  every store flush and once right after setupDock. */
function updateGraphAddress(): void {
  const address = projectAddress();
  if (address !== lastAddress) {
    lastAddress = address;
    addressBar.setAddress(address);
  }
  const title = store.serial ? address : "Node Graph";
  // dockview panel title via type assertion (no dockview type dependency): prefer
  // api.getPanel("graph"), fall back to scanning api.panels for the graph panel.
  const dock = dv as unknown as {
    api: {
      getPanel?(id: string): { api: { setTitle(t: string): void } } | undefined;
      panels?: Array<{ id: string; api: { setTitle(t: string): void } }>;
    };
  };
  const panel = dock.api.getPanel?.("graph") ?? dock.api.panels?.find((p) => p.id === "graph");
  panel?.api.setTitle(title);
}

/** Store emit -> ONE viewport/UI refresh pass per animation frame. The heavy body
 *  (viewport rebuild + node flags + selection panels + inspector + log + dirty
 *  marker) runs at most once per rAF, batching every emit within a frame (drag
 *  bursts, pushLog spam, echo dedup). Initial render still happens on the next
 *  frame; tests poll so timing is fine. */
let pendingFlush = false;
/** Network re-run requested by a gizmo drag frame: latest-wins, executed at most
 *  once per animation frame by the viewport pre-render pump (setPreRenderFlush). */
let networkDirty = false;
function scheduleNetwork(): void {
  networkDirty = true;
}
function flushStoreView(): void {
  updateGraphAddress();
  graph.setStats("input", inputStatsText());
  graph.setStats("output", outputStatsText());
  renderInspector();
  renderLog();
  layout.statusDot.className = `cyl-status ${store.status}`;
  dataflow.flush();
  scheduleWriteback(); // 非 geo `_output_` 的值 → 桥 → Houdini（去抖，见该函数）
  markGraphDirty();
  const showHint = !store.serial || store.status === "offline";
  layout.hintEl.classList.toggle("hidden", !showHint);
  layout.hintEl.textContent = !store.serial
    ? isProjectModeActive()
      ? `项目模式 ${currentProjectId}：点击通道显示节点进入成员工作区，或从地址栏跳转。`
      : "未连接：在 Houdini 的 Cyl1nder 节点上点 Open in Browser，或在上方输入序列号后 Connect。"
    : store.status === "offline"
      ? "桥离线（127.0.0.1:8375）——请启动 bridge。"
      : "";
}
store.subscribe(() => {
  // Only flag the flush - the viewport pre-render pump drains it (network + store
  // view) at the start of the next animation frame, BEFORE the geometry renders.
  pendingFlush = true;
});

/** Viewport display path: fall back to the unified path system (disk snapshot)
 *  when the live workspace has no geometry yet (Houdini not cooking / bridge restarted). */
async function loadSnapshotIntoStore(serial: string): Promise<void> {
  try {
    const { snapshot } = await client.getSnapshot(serial);
    if (!snapshot) return;
    const inputs = snapshot.inputs as unknown[] | undefined;
    const outputs = snapshot.outputs as unknown[] | undefined;
    if (Array.isArray(inputs) && inputs.length > 0 && store.inputs.length === 0) {
      store.setInputs(inputs as never, store.inputRev + 1); // bump rev so viewport rebuilds
      store.pushLog(`[path] restored ${inputs.length} inputs from snapshot`);
    }
    const g = snapshot.graph as { nodes?: unknown[] } | undefined;
    if (g?.nodes?.length) {
      try {
        await graph.restoreGraph(snapshot.graph);
        store.pushLog(`[path] restored node graph (${g.nodes.length} nodes)`);
        // 图**确实**换成了这个成员的图 → 现在（且仅现在）把地址切到 /P1-…/C1-…/。
        // 这是 task #7 地址 bug 的落地点：activateSession 本身给不出完成信号。
        commitPendingMemberScope(serial);
      } catch (e) {
        store.pushLog(`[path] graph restore failed: ${String(e)}`);
      }
    } else if (pendingMemberScope?.serial === serial) {
      // 会话激活了，但这个成员没有存过图 → nodeview 没动，地址就不该动。
      // 不静默：说清楚"为什么点了 display 地址没变"，否则又变成一个查不出来的怪现象。
      store.pushLog(`[path] ${serial} 无已存图：会话已激活但 nodeview 未切换，地址保持不变`);
      pendingMemberScope = null;
    }
    if (Array.isArray(outputs) && outputs.length > 0 && store.outputs.length === 0) {
      store.upsertOutputs(outputs as never, store.outputRev + 1);
      store.pushLog(`[path] restored ${outputs.length} outputs from snapshot`);
    }
    const pref = snapshot.preference as { sync_max_fps?: unknown; update_mode?: unknown } | undefined;
    // Scene Preference.json applies only when connecting/opening a DIFFERENT scene than
    // the one already loaded in this browser (lastSceneSerial); a plain reload of the
    // same scene keeps the local working prefs (localStorage cyl1nder.prefs).
    if (pref && typeof pref === "object" && localStorage.getItem(LAST_SERIAL_KEY) !== serial) {
      applyLoadedPreference(pref);
      localStorage.setItem(LAST_SERIAL_KEY, serial);
    }
  } catch (e) {
    store.pushLog(`[path] snapshot read failed: ${String(e)}`);
  }
}

/** Apply a Preference.json (from open-scene / snapshot) and push the new rate cap. */
function applyLoadedPreference(json: unknown): void {
  const p = (json ?? {}) as {
    sync_max_fps?: unknown;
    sync_enabled?: unknown;
    update_mode?: unknown;
    autosave_enabled?: unknown;
    autosave_interval_min?: unknown;
    viewport_bg?: unknown;
    ui_font?: unknown;
  };
  const next: Preferences = {
    sync_max_fps: clampSyncFps(p.sync_max_fps),
    sync_enabled: p.sync_enabled === true,
    update_mode: p.update_mode === "mouseup" ? "mouseup" : p.update_mode === "auto" ? "auto" : prefs.update_mode,
    autosave_enabled: p.autosave_enabled !== false,
    autosave_interval_min: Math.max(0.1, Number(p.autosave_interval_min) || 5),
    viewport_bg:
      typeof p.viewport_bg === "string" && /^#[0-9a-fA-F]{6}$/.test(p.viewport_bg) ? p.viewport_bg : "#1a1a1a",
    ui_font: p.ui_font === "system" ? "system" : "code",
  };
  prefs = next;
  syncMaxFps = next.sync_max_fps;
  updateMode = next.update_mode;
  syncEnabled = next.sync_enabled;
  layout.syncToggle.checked = syncEnabled;
  savePreferences(prefs);
  applyPreferences(prefs, layout);
  viewport.setBackgroundColor(prefs.viewport_bg); // V2: loaded Preference.json background applies
  store.pushLog(`[pref] loaded: sync_max_fps=${next.sync_max_fps} sync_enabled=${next.sync_enabled} update_mode=${next.update_mode} viewport_bg=${next.viewport_bg} ui_font=${next.ui_font}`);
  if (store.serial) {
    void client.putSyncFps(store.serial, next.sync_max_fps).catch(() => undefined);
    void client.putSyncEnabled(store.serial, next.sync_enabled).catch(() => undefined);
  }
  autosave.restart();
}


/** 把地址栏同步成 `?project=<P1>&member=<C1>`（不重载、不新增历史条目）。
 *
 *  v0.1.00120 取代 `syncSerialInAddress`：serial 不再是页面地址，成员只在项目下可达，
 *  所以"当前正连着谁"这件事也必须两段都写——只写 member 就又造出一个 serial 形状的
 *  页面入口，刷新时无从得知它属于哪个项目。 */
function syncMemberInAddress(projectId: string, serial: string): void {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get("project") === projectId && url.searchParams.get("member") === serial) return;
    url.searchParams.delete("serial"); // 清掉遗留的旧参数（老书签/老标签页）
    url.searchParams.set("project", projectId);
    url.searchParams.set("member", serial);
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* 地址同步失败不影响连接本身 */
  }
}



/** 把地址栏换成 `?project=`（项目根，不重载、不新增历史条目）。
 *
 *  `member` 必须一并清掉：回到项目根后还留着 member= 的话，刷新会又跳进成员工作区，
 *  地址与眼前的图就对不上了（地址栏永远描述眼前这张图，见 graph-scope.ts）。
 *  `serial` 同理清掉——老书签留下的遗留参数。 */
function syncProjectInAddress(projectId: string): void {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get("project") === projectId && !url.searchParams.has("member")) return;
    url.searchParams.delete("serial");
    url.searchParams.delete("member");
    url.searchParams.set("project", projectId);
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* 地址同步失败不影响会话本身 */
  }
}

const connectSerial = () => {
  const v = layout.serialInput.value.trim();
  if (!v) return;
  // 成对作废（务必保持相邻）：显式 Connect = 「重新从桥读一遍」。用户会去点它，通常正是
  // 因为 Houdini 那边重启/换了 hip/挪了吊牌——此刻两个以项目上下文为键的缓存都可能已经
  // 过期（映射类型表 + 端口清单）。serial-capabilities 自己的文档也把「桥重连」列为作废
  // 时机之一。只清一个 → 另一个继续用上一次会话的解析结果静默作答。
  //
  // 放在分支**之前**、且都是 fire-and-forget：下面那条快路径必须保持"close → 立刻
  // activate"的同步性（round10 的 kick 速率断言踩在这上面），所以这里不 await 任何东西。
  invalidateMappingTypes();
  invalidateCapabilities();
  // 映射类型表重取（端口清单不预取：按需 + 已 debounce/single-flight，见 import 处注释）。
  if (currentProjectId) void primeMappingTypes(currentProjectId);
  // 显式重连语义（对齐旧 connect()：先拆旧 WS 再开新 WS）——round10 依赖每次
  // Connect 点击都产生一条新 WebSocket（kick 速率限流断言）。
  sessionMgr.closeSession(v);
  // 已经在这个成员的工作区里 → **纯重连**：项目归属早就知道了，不必再问桥一次。
  // 这条快路径不只是省一次往返，它保证「重连」仍是同步动作（close → 立刻 activate）：
  // 走下面的解析路径会在拆掉 WS 与建新 WS 之间插进 3 次 HTTP 往返，把"点一次 Connect
  // 立刻换一条 WS"这个语义拖成异步，round10 的 kick 速率断言正是踩在这上面。
  if (graphScope.kind === "member" && graphScope.serial === v && currentProjectId === graphScope.projectId) {
    sessionMgr.activateSession(v);
    return;
  }
  // v0.1.00120：Connect 不再是"serial 模式"动作 —— 换成另一个 serial 时同样经桥的
  // serial→项目映射解析，落到该成员的工作区（地址 /P1-…/C1-…/）。
  void openProjectMember(v);
};
layout.connectBtn.addEventListener("click", connectSerial);
layout.serialInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") connectSerial();
});

// ---------------------------------------------------------------------------
// 页面入口（v0.1.00120）：**只认 `?project=`**。
//
// `?serial=` 页面入口已删除 —— serial 不再是网页地址，它只是「HDA 成员的身份」，
// 只在所属项目下可达。于是入口只有两种形态：
//   `?project=P1-…`              → 项目根
//   `?project=P1-…&member=C1-…`  → 该项目下这个成员的工作区（地址 /P1-…/C1-…/）
// 老的 `?serial=…` 书签会被 index.html 的入口守卫送回 Overview（那里能查到它属于
// 哪个项目再进）——刻意不在这里做兼容跳转：留一条 serial→页面的暗门，等于没删。
//
// 注意：桥的**数据通道**仍然按 serial 路由（`ws://…/ws?serial=`、
// `PUT /api/hda/<serial>/…`）。删掉的只是"页面地址按 serial 寻址"这件事。
// ---------------------------------------------------------------------------
const bootParams = new URLSearchParams(location.search);
const qp = bootParams.get("project");
const qm = bootParams.get("member");
if (qp && PROJECT_SERIAL_RE.test(qp) && qm && SERIAL_RE.test(qm)) {
  // `&member=` 的**地址语义**已废弃（v0.1.00122），但**会话仍要激活**（v0.1.00124 修回）。
  //
  // 用户要求的是「cook 之后地址只出现 `/P1-…`、图里只有项目根 + 黄色提示」——那是
  // **地址栏与节点图**的要求，不是「不要连这个成员的数据」。
  //
  // 上一版把整条分支改成只 `enterProjectMode(qp)`、完全不激活会话，结果**没有 hello**
  // → `session.ts` 永不 `setStatus("ok")` → `.cyl-status` 停在 connecting，
  // 76 个 e2e 全挂（几何也永远不来）。教训：删「按 serial 寻址」时别把
  // 「按 serial 取数据」一起删了——后者是 WS 数据通道，本来就该按 serial 走。
  //
  // 现在：进项目根（地址就是 `/P1-…/`，符合要求），**同时**激活该成员会话拿几何。
  store.pushLog(`[nav] member= 仅作数据通道：地址进项目根 ${qp}，会话激活 ${qm}`);
  // **复用 `enterMemberWorkspace`**，只把地址覆盖成项目根。
  //
  // 为什么不自己拼 `enterProjectMode + activateSession`：我试过，`#cyl-serial` 是空的
  // （探针实录 `input="" store="C1-e2eround9-0001"`）——会话确实激活了、store 也对，
  // 但**画输入框那一步在 enterMemberWorkspace 里**（`layout.serialInput.value = serial`）。
  // 绕开它就等于把「激活成员」这件事做了一半，两条入口从此各自漂移。
  //
  // 地址语义的差异只在最后一步：`enterMemberWorkspace` 会写两段
  // `/P1-…/C1-…/`，而用户要求只到项目根，所以落地后把 scope 与地址改回项目根。
  // 数据通道（WS 按 serial）不受影响 —— 那本来就该按 serial 走。
  void enterMemberWorkspace(qp, qm).then((ok) => {
    if (!ok) return;
    // **只改地址显示，绝不改 graphScope**。
    //
    // 我先前把 scope 也改成 project，于是 `canWriteProjectGraph` 变真 —— Ctrl+S 走进
    // 「保存项目图」分支、**再也不发 snapshot PUT**（5 个 e2e 因此挂掉：Ctrl+S / 自动保存 /
    // Save Scene As）。scope 回答的是「这张图属于谁、该写哪个槽位」，
    // 地址回答的是「给人看什么」——正是 graph-scope.ts 头部警告过的那种混用。
    // 用户要的是**地址**只到项目根，不是把这张成员图当成项目图去写。
    // 地址那一半已经由 `addressOf(member)` 统一处理（graph-scope.ts），这里无事可做。
  });
} else if (qp && PROJECT_SERIAL_RE.test(qp)) {
  // P2b 项目模式：?project=P1-… 直接进入项目根（index.html 已放行，不重定向 overview）。
  void enterProjectMode(qp);
} else {
  client
    .listSerials()
    .then((serials) => {
      if (serials.length > 0 && !store.serial) {
        layout.serialInput.value = serials[serials.length - 1];
        store.pushLog(`found serials: ${serials.join(", ")}`);
      }
    })
    .catch((e) => store.pushLog(`bridge unreachable: ${String(e)}`));
}

bindShortcuts({
  frameGraph: () => graph.frameSelection(),
  frameViewport: () => viewport.frame(),
  toggleDebug: () => viewport.toggleDebugBoxes(),
  toggleEnter: () => gizmo.toggle(),
  // B 键优先级：有选中线段 → 切换 bypass（返回 true 吃掉按键）；否则保持 debug 盒行为。
  tryWireBypass: () => graph.toggleSelectedConnectionBypass(),
  quickSave: () => {
    // 同 saveSceneAs：判据用 graphScope，不用 currentProjectId（见那里的注释）。
    // 走到这条 else 时 scope 是 member/serial → 存该成员自己的 snapshot。
    if (canWriteProjectGraph(graphScope)) {
      saveProjectGraph();
      store.pushLog("[file] project graph saved (Ctrl+S)");
      return;
    }
    if (!store.serial) return;
    void client.putSnapshot(store.serial, {
      graph: graph.serializeGraph(),
      docking: getDockJson(),
      preference: prefs,
    });
    store.pushLog("[file] scene saved (Ctrl+S)");
  },
  saveAs: () => { void saveSceneAs(); },
  isGraphHovered: () => layout.graphContainer.matches(":hover"),
  isEnterHovered: () => viewport.isHovered(),
});

/** Graph dirty marker: store.subscribe flags changes here, but NOTHING is written to
 *  disk automatically. Explicit saves (Ctrl+S / Save Scene / Save As) and the timed
 *  auto-save are the only paths that call putSnapshot. */
var graphDirty = false; // var: store.subscribe may fire before this line (TDZ-safe)
function markGraphDirty(): void {
  if (graphDirty) return;
  graphDirty = true;
  store.pushLog("[file] graph dirty - use Ctrl+S to save");
}

store.pushLog(`Cyl1nder web v${APP_VERSION} · Tab=搜索 Y=剪切 右键=flags F=frame`);
