import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";

/**
 * Round 10: HDA kick on first connect.
 *
 * The bridge's POST /api/hda/{serial}/kick (one-shot force flag + lastSeen
 * touch) lands in parallel with this write set, so the running bridge may not
 * have it yet. A GET probe of the route returns 405 when the route exists and
 * 404 when it does not - skip the whole file when it is unavailable.
 *
 * Self-contained: reuses the live serial from the bridge (no fixtures needed -
 * the kick path only reads the WS hello + logs).
 */
const client = new BridgeClient();
let serial = "";

/** The kick route is POST-only; GET 404 = route missing (old bridge), anything
 *  else (405/200) = the endpoint exists. */
async function kickEndpointAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:8375/api/hda/${serial}/kick`);
    return res.status !== 404;
  } catch {
    return false;
  }
}

test.beforeAll(async () => {
  const bridgeOk = await client.health().then(() => true).catch(() => false);
  test.skip(!bridgeOk, "bridge not running on 127.0.0.1:8375");
  const serials = await client.listSerials();
  serial = process.env.CYL1NDER_E2E_SERIAL || serials.find((s) => s === "C1-e2etest0001-aaaa") || serials[serials.length - 1] || "";
  test.skip(!serial, "no serial registered in bridge");
  test.skip(!(await kickEndpointAvailable()), "kick endpoint 404 on running bridge - web kick not testable");
});

test("first connect kicks the HDA exactly once; reconnect does not re-kick", async ({ page }) => {
  // Ground truth: count the page's own POST /kick requests (the kick is a fetch
  // from page JS) - independent of the windowed log panel.
  let kickRequests = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes(`/api/hda/${serial}/kick`)) kickRequests += 1;
  });
  // Count WS connections to the bridge: every connect() opens a NEW WebSocket,
  // so a value >= 2 proves a reconnect happened (independent of log text).
  let wsConnections = 0;
  page.on("websocket", () => { wsConnections += 1; });

  await page.goto(`http://127.0.0.1:8376/?serial=${serial}`);

  // dockview lazily mounts inactive tab content: activate the Log tab to surface
  // .cyl-log. The panel only renders the LAST 40 lines, so accumulate every line
  // we ever observe across polls (old lines scroll out once viewport logs pile up).
  await page.locator(".dv-tab", { hasText: "Log" }).first().click({ timeout: 15000 });
  await expect(page.locator(".cyl-log")).toBeVisible({ timeout: 15000 });
  const seenLines: string[] = [];
  const collect = async (): Promise<string[]> => {
    const t = (await page.locator(".cyl-log").textContent()) ?? "";
    for (const line of t.split("\n")) {
      const l = line.trim();
      if (l && !seenLines.includes(l)) seenLines.push(l);
    }
    return seenLines;
  };
  const kickCount = async () => (await collect()).filter((l) => l.includes("kick HDA (first connect)")).length;
  const wsConnects = () => wsConnections;

  await expect(page.locator(".cyl-graph .cyl-rp-title").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".cyl-status")).toHaveClass(/ok/, { timeout: 15000 });

  // First hello must kick exactly once: one POST request + one log marker.
  await expect.poll(() => kickRequests, { timeout: 15000 }).toBe(1);
  await expect.poll(kickCount, { timeout: 15000 }).toBe(1);

  // Reconnect the SAME serial (Connect re-runs connect(): closes + reopens the
  // WS, so a fresh hello lands) - the kick must NOT repeat.
  await page.locator("#cyl-connect").click();
  await expect.poll(wsConnects, { timeout: 15000 }).toBeGreaterThanOrEqual(2); // a new WS connection landed
  await expect.poll(() => kickRequests, { timeout: 5000 }).toBe(1); // still exactly one kick POST
  await expect.poll(kickCount, { timeout: 5000 }).toBe(1); // and no second log marker
});
