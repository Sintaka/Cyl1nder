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

test("first connect kicks; reconnects within 5s do NOT re-kick, after 5s they do (rate limit)", async ({ page }) => {
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
  // The Log panel only renders the LAST 40 lines and viewport logs scroll
  // markers out, so the POST count is the authoritative signal; this flag only
  // proves the marker was rendered at least once.
  let kickMarkerSeen = false;
  const kickMarkerVisible = async (): Promise<boolean> => {
    const t = (await page.locator(".cyl-log").textContent()) ?? "";
    if (t.includes("kick HDA (first connect)")) kickMarkerSeen = true;
    return kickMarkerSeen;
  };
  const wsConnects = () => wsConnections;

  await expect(page.locator(".cyl-graph .cyl-rp-title").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".cyl-status")).toHaveClass(/ok/, { timeout: 15000 });

  // First hello must kick exactly once (POST count is authoritative).
  await expect.poll(() => kickRequests, { timeout: 15000 }).toBe(1);
  await expect.poll(kickMarkerVisible, { timeout: 15000 }).toBe(true);

  // New kick policy (round 17): per-serial 5s rate limit + no re-kick on plain
  // reconnects. Clicking Connect again closes + reopens the WS, but the fresh
  // hello must NOT re-kick while inside the 5s window (still 1 kick).
  const kicksBeforeReconnect = kickRequests;
  await page.locator("#cyl-connect").click();
  await expect.poll(wsConnects, { timeout: 15000 }).toBeGreaterThanOrEqual(2); // a new WS connection landed
  await page.waitForTimeout(1000); // well inside the 5s rate-limit window
  expect(kickRequests).toBe(kicksBeforeReconnect); // rate-limited: no immediate re-kick

  // After the 5s window passes, a reconnect re-kicks again (rate limit allowed).
  await page.waitForTimeout(5500);
  await page.locator("#cyl-connect").click();
  await expect.poll(wsConnects, { timeout: 15000 }).toBeGreaterThanOrEqual(3); // another new WS connection landed
  await expect.poll(() => kickRequests, { timeout: 15000 }).toBe(kicksBeforeReconnect + 1); // re-kick (POST = truth)
});
