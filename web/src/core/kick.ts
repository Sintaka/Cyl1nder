export interface KickDeps {
  kick(serial: string): Promise<{ ok: boolean }>;
  log(msg: string): void;
  isSyncEnabled(): boolean;
  hasInputs(): boolean;
  runNetwork(): void;
}

/** One-shot HDA kick controller: only the first connect to a serial in this page
 *  session kicks the HDA; auto-reconnects don't, a per-serial 5s rate limit stops
 *  reconnect churn, and only a real WS drop re-arms the kick. */
export function createKickController(deps: KickDeps): {
  onHello(serial: string): void;
  onStatus(open: boolean, serial: string): void;
} {
  const kickedSerials = new Set<string>();
  const lastKickAt = new Map<string, number>();
  let wsWasUp = false;
  const KICK_MIN_INTERVAL_MS = 5000;

  const kickOnce = async (serial: string): Promise<void> => {
    const res = await deps.kick(serial);
    if (!res.ok) return;
    deps.log("[bridge] kick HDA (first connect)");
    if (deps.hasInputs()) void deps.runNetwork();
  };

  const onHello = (serial: string): void => {
    if (deps.isSyncEnabled() && !kickedSerials.has(serial) && (lastKickAt.get(serial) ?? 0) + KICK_MIN_INTERVAL_MS <= Date.now()) {
      kickedSerials.add(serial);
      lastKickAt.set(serial, Date.now());
      void kickOnce(serial);
    }
  };

  const onStatus = (open: boolean, serial: string): void => {
    if (open) {
      wsWasUp = true;
    } else if (wsWasUp) {
      wsWasUp = false;
      kickedSerials.delete(serial);
    }
  };

  return { onHello, onStatus };
}