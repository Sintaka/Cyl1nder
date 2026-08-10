export interface Layout {
  root: HTMLElement;
  serialInput: HTMLInputElement;
  connectBtn: HTMLButtonElement;
  statusDot: HTMLSpanElement;
  autoRunCheck: HTMLInputElement;
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
      <div class="cyl-body">
        <aside class="cyl-left">
          <div class="cyl-panel-title">Node Graph</div>
          <div id="cyl-graph" class="cyl-graph"></div>
        </aside>
        <div class="cyl-splitter splitter-v" data-splitter="left" title="拖动调整宽度"></div>
        <main class="cyl-center">
          <div id="cyl-viewport" class="cyl-viewport">
            <div id="cyl-hda-offline" class="cyl-hda-offline hidden" title="Houdini 未在运行或该 HDA 已停止 cook">
              <span class="off-icon">⚠</span><span class="off-text">HDA 离线</span>
            </div>
          </div>
          <div id="cyl-hint" class="cyl-hint hidden"></div>
        </main>
        <div class="cyl-splitter splitter-v" data-splitter="right" title="拖动调整宽度"></div>
        <aside class="cyl-right">
          <div class="cyl-panel-title">Inspector</div>
          <div id="cyl-inspector" class="cyl-inspector"></div>
        </aside>
      </div>
      <div class="cyl-splitter splitter-h" data-splitter="log" title="拖动调整高度"></div>
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
    hdaOffline: $("#cyl-hda-offline"),
    hintEl: $("#cyl-hint"),
    inspectorEl: $("#cyl-inspector"),
    logEl: $("#cyl-log"),
  };
}

/** Drag splitters to resize the left/right panels and the bottom log.
 *  Minimal, dependency-free docking-ready sizing (floating windows deferred to v0.2). */
export function attachSplitters(root: HTMLElement): () => void {
  const handles = Array.from(root.querySelectorAll<HTMLElement>(".cyl-splitter"));
  const offs: (() => void)[] = [];

  for (const handle of handles) {
    const key = handle.dataset.splitter ?? "";
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const body = root.querySelector<HTMLElement>(".cyl-body")!;
      const log = root.querySelector<HTMLElement>(".cyl-log")!;
      const left = root.querySelector<HTMLElement>(".cyl-left")!;
      const right = root.querySelector<HTMLElement>(".cyl-right")!;
      const startLeft = left.getBoundingClientRect().width;
      const startRight = right.getBoundingClientRect().width;
      const startLog = log.getBoundingClientRect().height;

      const onMove = (ev: PointerEvent) => {
        if (key === "left") {
          const w = Math.min(560, Math.max(140, startLeft + (ev.clientX - startX)));
          left.style.flex = `0 0 ${w}px`;
        } else if (key === "right") {
          const w = Math.min(480, Math.max(160, startRight - (ev.clientX - startX)));
          right.style.flex = `0 0 ${w}px`;
        } else if (key === "log") {
          const h = Math.min(360, Math.max(48, startLog - (ev.clientY - startY)));
          log.style.height = `${h}px`;
        }
        body.style.userSelect = "none";
      };
      const onUp = () => {
        body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
    handle.addEventListener("pointerdown", onDown);
    offs.push(() => handle.removeEventListener("pointerdown", onDown));
  }

  return () => offs.forEach((off) => off());
}
