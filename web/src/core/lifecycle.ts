export interface AutosaveDeps {
  getPrefs: () => { autosave_enabled: boolean; autosave_interval_min: number };
  getSerial: () => string | null;
  saveSnapshot: () => void;
  log: (msg: string) => void;
}
export function createAutosave(deps: AutosaveDeps): { restart(): void; stop(): void } {
  let timer: number | undefined;
  const restart = (): void => {
    if (timer !== undefined) { window.clearInterval(timer); timer = undefined; }
    const p = deps.getPrefs();
    if (p.autosave_enabled === false) return;
    const minutes = Math.max(0.1, Number(p.autosave_interval_min) || 5);
    timer = window.setInterval(() => {
      if (!deps.getSerial()) return;
      try {
        deps.saveSnapshot();
        deps.log(`[file] autosaved (${minutes}min)`);
      } catch { /* ignore */ }
    }, minutes * 60_000);
  };
  const stop = (): void => { if (timer !== undefined) { window.clearInterval(timer); timer = undefined; } };
  return { restart, stop };
}

export interface HdaWatchdogDeps {
  getStatus: (serial: string) => Promise<{ registry: { lastSeen?: number } | null }>;
  setOfflineVisible: (visible: boolean) => void;
  log: (msg: string) => void;
}
export function createHdaWatchdog(deps: HdaWatchdogDeps): { start(serial: string): void; stop(): void } {
  let timer: number | undefined;
  let wasStale = false;
  const stop = (): void => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    wasStale = false;
    deps.setOfflineVisible(false);
  };
  const start = (serial: string): void => {
    stop();
    const check = async () => {
      try {
        const st = await deps.getStatus(serial);
        const lastSeen = st.registry?.lastSeen ?? 0;
        const stale = Date.now() / 1000 - lastSeen > 150;
        deps.setOfflineVisible(stale);
        if (stale !== wasStale) { wasStale = stale; deps.log(`HDA ${stale ? "OFFLINE (Houdini not cooking)" : "online"}`); }
      } catch {
        deps.setOfflineVisible(true);
      }
    };
    void check();
    timer = window.setInterval(check, 60000);
  };
  return { start, stop };
}
