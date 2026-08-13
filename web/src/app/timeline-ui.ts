import type { TimelineController } from "../core/timeline";

export interface TimelineUiDeps {
  timeline: TimelineController;
}

/** 底部栏时间轴 UI：scrub 滑条 / 帧号输入 / 上下一帧 / 播放停止 / fps 只读 / 锚定灯。
 *  纯 DOM 组件，只消费 TimelineController，不 import store。 */
export function createTimelineUI(container: HTMLElement, deps: TimelineUiDeps): { destroy(): void } {
  const { timeline } = deps;
  let playing = false;
  let raf: number | null = null;
  let lastTs: number | null = null;

  container.innerHTML = `
    <span class="tl-anchor" title="本地模式（v1 恒为本地）">○</span>
    <button type="button" class="tl-btn" data-act="prev" aria-label="上一帧" title="上一帧（Shift 快退 10 帧）">◀</button>
    <button type="button" class="tl-btn" data-act="play" aria-label="播放" title="播放 / 停止">⏵</button>
    <button type="button" class="tl-btn" data-act="next" aria-label="下一帧" title="下一帧（Shift 快进 10 帧）">▶</button>
    <input type="range" class="tl-scrub" min="1" max="100" step="1" value="1" aria-label="时间轴游标" />
    <input type="number" class="tl-frame" step="1" value="1" aria-label="当前帧" />
    <span class="tl-fps">30fps</span>`;

  const scrub = container.querySelector<HTMLInputElement>(".tl-scrub")!;
  const frameInput = container.querySelector<HTMLInputElement>(".tl-frame")!;
  const playBtn = container.querySelector<HTMLButtonElement>('button[data-act="play"]')!;
  const prevBtn = container.querySelector<HTMLButtonElement>('button[data-act="prev"]')!;
  const nextBtn = container.querySelector<HTMLButtonElement>('button[data-act="next"]')!;

  const stop = (): void => {
    playing = false;
    lastTs = null;
    if (raf != null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    render();
  };

  /** 简单本地播放：每 1/30s 前进一帧，到 max 停止。 */
  const play = (): void => {
    playing = true;
    lastTs = null;
    const tick = (ts: number): void => {
      if (!playing) return;
      if (lastTs == null) lastTs = ts;
      const stepMs = 1000 / timeline.fps;
      let next = lastTs;
      while (ts - next >= stepMs) {
        timeline.step(1);
        next += stepMs;
        if (timeline.frame >= timeline.max) {
          stop();
          return;
        }
      }
      lastTs = next;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    render();
  };

  const render = (): void => {
    scrub.min = String(timeline.min);
    scrub.max = String(timeline.max);
    scrub.value = String(timeline.frame);
    frameInput.value = String(timeline.frame);
    playBtn.textContent = playing ? "⏸" : "⏵";
    playBtn.setAttribute("aria-label", playing ? "停止" : "播放");
  };

  const commitFrame = (raw: string): void => {
    if (raw.trim() === "") return; // 空白输入视为非法，忽略
    const f = Number(raw);
    if (!Number.isFinite(f)) return;
    timeline.setFrame(f);
  };

  scrub.addEventListener("input", () => {
    timeline.setFrame(Number(scrub.value));
  });

  frameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commitFrame(frameInput.value);
  });
  frameInput.addEventListener("blur", () => commitFrame(frameInput.value));

  prevBtn.addEventListener("click", (e) => {
    timeline.step(e.shiftKey ? -10 : -1);
  });
  nextBtn.addEventListener("click", (e) => {
    timeline.step(e.shiftKey ? 10 : 1);
  });

  playBtn.addEventListener("click", () => {
    if (playing) stop();
    else play();
  });

  const unsubscribe = timeline.subscribe(() => render());
  render();

  return {
    destroy(): void {
      unsubscribe();
      stop();
      container.innerHTML = "";
    },
  };
}