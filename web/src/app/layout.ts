export interface Layout {
  root: HTMLElement;
  serialInput: HTMLInputElement;
  connectBtn: HTMLButtonElement;
  statusDot: HTMLSpanElement;
  autoRunCheck: HTMLInputElement;
  dockContainer: HTMLElement;
  graphContainer: HTMLElement;
  viewportContainer: HTMLElement;
  hdaOffline: HTMLElement;
  hintEl: HTMLElement;
  inspectorEl: HTMLElement;
  logEl: HTMLElement;
}

/** DOM shell: left node graph / center viewport / right inspector / bottom log. */
export function buildLayout(app: HTMLElement): Layout {
  app.innerHTML = `
    <div class="cyl-app">
      <header class="cyl-header">
        <span class="cyl-brand">Cyl1nder <small>0.1</small></span>
        <input id="cyl-serial" class="cyl-serial-input" placeholder="C1-xxxxxxxx-xxxx" spellcheck="false" />
        <button id="cyl-connect" class="cyl-connect" type="button">Connect</button>
        <label class="cyl-autorun" title="Houdini 更新输入后自动跑网络并推回结果">
          <input id="cyl-autorun" type="checkbox" checked /> auto-run
        </label>
        <span id="cyl-status" class="cyl-status connecting" title="bridge status"></span>
      </header>
      <div id="cyl-dock" class="cyl-dock"></div>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string): T => app.querySelector(sel) as T;

  // Content containers are created here and handed to the docking system; dockview
  // moves them into panels (drag tabs to re-layout, float, resize).
  const graphContainer = document.createElement("div");
  graphContainer.id = "cyl-graph";
  graphContainer.className = "cyl-graph";

  const viewportContainer = document.createElement("div");
  viewportContainer.id = "cyl-viewport";
  viewportContainer.className = "cyl-viewport";
  viewportContainer.innerHTML = `
    <div id="cyl-hda-offline" class="cyl-hda-offline hidden" title="Houdini 未在运行或该 HDA 已停止 cook">
      <span class="off-icon">⚠</span><span class="off-text">HDA 离线</span>
    </div>
    <div id="cyl-hint" class="cyl-hint hidden"></div>`;

  const inspectorEl = document.createElement("div");
  inspectorEl.id = "cyl-inspector";
  inspectorEl.className = "cyl-inspector";

  const logEl = document.createElement("div");
  logEl.id = "cyl-log";
  logEl.className = "cyl-log";

  return {
    root: app,
    serialInput: $("#cyl-serial"),
    connectBtn: $("#cyl-connect"),
    statusDot: $("#cyl-status"),
    autoRunCheck: $("#cyl-autorun"),
    dockContainer: $("#cyl-dock"),
    graphContainer,
    viewportContainer,
    hdaOffline: viewportContainer.querySelector("#cyl-hda-offline") as HTMLElement,
    hintEl: viewportContainer.querySelector("#cyl-hint") as HTMLElement,
    inspectorEl,
    logEl,
  };
}

/** Legacy flex+splitters layout (kept for reference / fallback). */
export function buildLayoutLegacy(app: HTMLElement): Layout {
  app.innerHTML = `
    <div class="cyl-app">
      <header class="cyl-header">
        <span class="cyl-brand">Cyl1nder <small>0.1</small></span>
        <input id="cyl-serial" class="cyl-serial-input" placeholder="C1-xxxxxxxx-xxxx" spellcheck="false" />
        <button id="cyl-connect" class="cyl-connect" type="button">Connect</button>
        <label class="cyl-autorun" title="Houdini 更新输入后自动跑网络并推回结果">
          <input id="cyl-autorun" type="checkbox" checked /> auto-run
        </label>
        <span id="cyl-status" class="cyl-status connecting" title="bridge status"></span>
      </header>
      <div class="cyl-body">
        <aside class="cyl-left">
          <div class="cyl-panel-title">Node Graph</div>
          <div id="cyl-graph" class="cyl-graph"></div>
        </aside>
        <div class="cyl-splitter splitter-v" data-splitter="left"></div>
        <main class="cyl-center">
          <div id="cyl-viewport" class="cyl-viewport">
            <div id="cyl-hda-offline" class="cyl-hda-offline hidden"><span class="off-icon">⚠</span><span class="off-text">HDA 离线</span></div>
            <div id="cyl-hint" class="cyl-hint hidden"></div>
          </div>
        </main>
        <div class="cyl-splitter splitter-v" data-splitter="right"></div>
        <aside class="cyl-right">
          <div class="cyl-panel-title">Inspector</div>
          <div id="cyl-inspector" class="cyl-inspector"></div>
        </aside>
      </div>
      <div class="cyl-splitter splitter-h" data-splitter="log"></div>
      <footer id="cyl-log" class="cyl-log"></footer>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string): T => app.querySelector(sel) as T;
  return {
    root: app,
    serialInput: $("#cyl-serial"),
    connectBtn: $("#cyl-connect"),
    statusDot: $("#cyl-status"),
    autoRunCheck: $("#cyl-autorun"),
    dockContainer: app,
    graphContainer: $("#cyl-graph"),
    viewportContainer: $("#cyl-viewport"),
    hdaOffline: $("#cyl-hda-offline"),
    hintEl: $("#cyl-hint"),
    inspectorEl: $("#cyl-inspector"),
    logEl: $("#cyl-log"),
  };
}

