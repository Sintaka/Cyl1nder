import "./styles.css";
import { buildLayout } from "./app/layout";
import { DEFAULT_LAYOUT, DEFAULT_LAYOUT_NAME } from "./app/layouts";
import { createChannelBindManager } from "./core/channel-bind";
import { applyLayout, channelPanelRef, setChannelValuesSink, setupDock } from "./app/dock";
import { renderSpreadsheet, type SpreadsheetFocus } from "./app/spreadsheet";
import { renderParams } from "./app/param";
import { store } from "./stores/workspace";
import { BridgeClient } from "./bridge/client";
// connectWs 直接取用：session 的 connectWsFn 注入口在此包一层，截 anchor-moved 刷新映射缓存。
import { connectWs } from "./bridge/client";
import { createReteGraph, getNodeParamBindings, listNodeParamBindings, setNodeBindings, type ReteGraphHandlers } from "./nodes2/graph";
// obj/sop 层级导航（v0.1.00119）：模块级层级 API（graph.ts 下方实现），地址栏按名下沉用。
import { enterNode, exitNode, getCurrentNetKind, getNetPath, setNetPathChangedHandler } from "./nodes2/graph";
import { isEnterableKind, type CylNode } from "./nodes2/graph-model";
// task #8 映射类型缓存：_input_/_output_ 端口类型的唯一真源，生命周期由本文件驱动
//（进项目 prime / anchor-moved 与切项目 invalidate）——不接就永远报「映射表未加载」。
import { invalidateMappingTypes, primeMappingTypes } from "./nodes2/mapping-types";
import { computeOutputsDetailed } from "./nodes2/network";
import type { ActiveChains } from "./core/network";
import { Viewport } from "./viewport/renderer";
import { APP_VERSION } from "./app/app-config";
import { inputsEqual } from "./protocol/compare";
import { PROJECT_SERIAL_RE } from "./protocol/types";
import type { InputPayload, OutputBuffer, ProjectRef, UpdateMode } from "./protocol/types";
import {
  applyPreferences,
  clampSyncFps,
  loadPreferences,
  openPreferenceDialog,
  savePreferences,
  type Preferences,
} from "./app/preference";
import { createDataflow } from "./core/dataflow";
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
/** P2b 项目模式状态（模块级）：currentProjectId 由 enterProjectMode 设置、?serial= boot /
 *  Connect / 1 段 C1- 导航清空；getAddress / navigate / 保存路径据此分流。
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
      if (currentProjectId === segs[0] && isProjectModeActive()) {
        // 已在目标项目：直接激活成员（避免重载图覆盖未保存编辑）。
        sessionCtl?.activateSession(segs[1]);
        graphScope = { kind: "member", projectId: segs[0], serial: segs[1] };
        updateGraphAddress();
      } else {
        void enterProjectMode(segs[0]).then(() => {
          sessionCtl?.activateSession(segs[1]);
          graphScope = { kind: "member", projectId: segs[0], serial: segs[1] };
          updateGraphAddress();
        });
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
      if (sessionCtl) {
        layout.serialInput.value = segs[0];
        if (currentProjectId !== null) invalidateMappingTypes(); // 离开项目 → 映射缓存作废
        currentProjectId = null; // 1 段 C1- 导航 = 退出项目模式（serial 模式）
        graphScope = { kind: "serial", serial: segs[0] };
        sessionCtl.activateSession(segs[0]); // 跳转到另一个 serial（页面级导航）
        return true;
      }
      return false;
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
// Initial serial may already be set (?serial=...); paint address + panel title now.
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
  if (currentProjectId) {
    saveProjectGraph(); // 项目模式：Save As = 保存项目图快照
    store.pushLog("[file] project graph saved");
    return;
  }
  const serial = store.serial;
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
      location.href = `?serial=${encodeURIComponent(serial)}`;
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
      if (r.ok && r.serial) location.href = `?serial=${encodeURIComponent(r.serial)}`;
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
const graph = await createReteGraph(layout.graphContainer, dataflow.handlers);
graphReady = true; // updateGraphAddress / isProjectModeActive 现可安全引用 graph
// 层级变化（双击进入 / Tab-U 退出 / 地址栏按名导航）**换完之后**才回调 —— 地址栏据此
// 跟随。刻意不在 enterNode 调用点自己刷地址：那又会变成"地址先变、图后换"（task #7）。
setNetPathChangedHandler(onNetPathChanged);

const autosave = createAutosave({
  getPrefs: () => prefs,
  getSerial: () => store.serial,
  saveSnapshot: () => {
    if (currentProjectId) {
      saveProjectGraph(); // 项目模式：图快照存项目，不写 per-serial snapshot
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
          invalidateMappingTypes();
          // 重取：只作废不重取的话，缓存会一直停在未加载态，直到下次切项目才恢复。
          if (currentProjectId) void primeMappingTypes(currentProjectId);
          store.pushLog(`[mapping] anchor-moved → 映射类型缓存已刷新 (${serial})`);
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
          renderedParams = params;
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
  );
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
 *  （仅清空活动成员回项目根，不重载图以免覆盖未保存编辑）。 */
async function enterProjectMode(projectId: string): Promise<void> {
  if (currentProjectId === projectId && graphReady && graph.isProjectMode()) {
    store.setSerial("");
    // 回到项目根：图确实是项目根图（isProjectMode 已确认），scope 必须跟着回来，
    // 否则残留的 member scope 会让 Save 一直拒写项目图。
    // path 不带：isProjectMode() 为真即说明当前就是项目根那一层（子网络里 project 节点不在）。
    graphScope = { kind: "project", projectId };
    store.pushLog(`[project] 项目模式 ${projectId}（已在，回到项目根）`);
    updateGraphAddress();
    return;
  }
  store.setSerial("");
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
  if (currentProjectId !== null && currentProjectId !== projectId) invalidateMappingTypes();
  currentProjectId = projectId;
  currentProject = project;
  graphScope = { kind: "project", projectId }; // 图即将被换成项目根图
  // 进项目模式时地址栏同步成 ?project=（此处模式与地址一致，改写是诚实的；
  // 对比 ?serial= 分支：那条不改地址，见该处注释）。
  syncProjectInAddress(projectId);
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
  graph.loadProjectGraph(
    { projectSerial: project.projectSerial, label: project.label, members: project.members },
    graphJson,
  );
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


/** 把地址栏的 ?serial= 同步成当前连接的 serial（不重载、不新增历史条目）。
 *  Connect 是原地换会话（无跳转），此前地址栏会一直留着旧的 / 空的 ?serial=，
 *  刷新或复制链接就回到错的目标。project 参数在 serial 模式下一并清掉。 */
function syncSerialInAddress(serial: string): void {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get("serial") === serial) return;
    url.searchParams.delete("project");
    url.searchParams.set("serial", serial);
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* 地址同步失败不影响连接本身 */
  }
}

/** 把地址栏换成 ?project=（不重载、不新增历史条目）。
 *
 *  项目优先（v0.1.00114）：`?serial=` 进来时 ensure 出所属项目后调用本函数，
 *  地址栏统一成项目形态；`serial` 参数一并清掉，避免刷新时又走回 serial 分支。 */
function syncProjectInAddress(projectId: string): void {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get("project") === projectId) return;
    url.searchParams.delete("serial");
    url.searchParams.set("project", projectId);
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* 地址同步失败不影响会话本身 */
  }
}

const connectSerial = () => {
  // 离开项目模式 = 映射表所属的命名空间没了 → 缓存作废（留着会被下一个项目误命中）。
  if (currentProjectId !== null) invalidateMappingTypes();
  currentProjectId = null; // Connect = serial 模式动作（退出项目模式）
  const v = layout.serialInput.value.trim();
  if (!v) return;
  graphScope = { kind: "serial", serial: v };
  // 显式重连语义（对齐旧 connect()：先拆旧 WS 再开新 WS）——round10 依赖每次
  // Connect 点击都产生一条新 WebSocket（kick 速率限流断言）。
  sessionMgr.closeSession(v);
  sessionMgr.activateSession(v);
  syncSerialInAddress(v);
};
layout.connectBtn.addEventListener("click", connectSerial);
layout.serialInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") connectSerial();
});

const qs = new URLSearchParams(location.search).get("serial");
const qp = new URLSearchParams(location.search).get("project");
if (qs) {
  layout.serialInput.value = qs;
  currentProjectId = null; // ?serial= 路径 = serial 模式（退出项目模式）
  graphScope = { kind: "serial", serial: qs };
  sessionMgr.activateSession(qs); // 原 session.connect(qs) 语义（ensure + activate + loadSnapshot）
  syncSerialInAddress(qs);
  // P2a 隐式项目：后台 ensure（无含该 serial 通道的项目则自动建 P1- 单成员项目）。
  //
  // 刻意**不**把地址栏改写成 ?project=（v0.1.00114 一度这么做过，是错的）：
  // 这条分支跑的是 serial 模式（currentProjectId=null、会话 = 该 serial），
  // 改成 ?project= 会让地址栏与实际模式不符——刷新后进的是项目模式，看到的东西不一样。
  // 「项目优先」由 overview 的入口（打开 -> ?project=）实现；`?serial=` 保持旧语义，
  // 老书签行为不变。
  void client.ensureProject(qs).catch(() => undefined);
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
    if (currentProjectId) {
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
