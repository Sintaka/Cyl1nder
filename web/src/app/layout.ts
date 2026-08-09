export interface Layout {
  root: HTMLElement;
  serialInput: HTMLInputElement;
  connectBtn: HTMLButtonElement;
  statusDot: HTMLSpanElement;
  autoRunCheck: HTMLInputElement;
  graphContainer: HTMLElement;
  viewportContainer: HTMLElement;
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
      <div class="cyl-body">
        <aside class="cyl-left">
          <div class="cyl-panel-title">Node Graph</div>
          <div id="cyl-graph" class="cyl-graph"></div>
        </aside>
        <main class="cyl-center">
          <div id="cyl-viewport" class="cyl-viewport"></div>
          <div id="cyl-hint" class="cyl-hint hidden"></div>
        </main>
        <aside class="cyl-right">
          <div class="cyl-panel-title">Inspector</div>
          <div id="cyl-inspector" class="cyl-inspector"></div>
        </aside>
      </div>
      <footer id="cyl-log" class="cyl-log"></footer>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string): T => app.querySelector(sel) as T;
  return {
    root: app,
    serialInput: $("#cyl-serial"),
    connectBtn: $("#cyl-connect"),
    statusDot: $("#cyl-status"),
    autoRunCheck: $("#cyl-autorun"),
    graphContainer: $("#cyl-graph"),
    viewportContainer: $("#cyl-viewport"),
    hintEl: $("#cyl-hint"),
    inspectorEl: $("#cyl-inspector"),
    logEl: $("#cyl-log"),
  };
}