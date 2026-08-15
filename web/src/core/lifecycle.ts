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
export function createHdaWatchdog(deps: HdaWatchdogDeps): { start(serial: string): () => void; stop(): void } {
  // 多槽（P2b 多会话）：每 serial 一个轮询 slot；start 返回该 slot 的 stop 函数，
  // 重复 start 同 serial 先停旧 slot 再起。轮询语义不变（60s 间隔 / 150s 离线阈值）。
  const slots = new Map<string, () => void>();
  const stop = (): void => {
    for (const serial of [...slots.keys()]) slots.get(serial)?.();
  };
  const start = (serial: string): () => void => {
    slots.get(serial)?.(); // 重复 start：先停旧 slot
    let timer: number | undefined;
    let wasStale = false;
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
    const stopSlot = (): void => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      wasStale = false;
      deps.setOfflineVisible(false);
      slots.delete(serial);
    };
    slots.set(serial, stopSlot);
    return stopSlot;
  };
  return { start, stop };
}
