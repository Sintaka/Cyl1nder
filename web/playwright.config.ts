import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // e2e specs share the LIVE bridge and its per-serial state (sync_enabled /
  // outputs / revs) through one fixture serial - parallel workers cross-talk on
  // that shared state (v0.1.00103 fix), so the suite runs serially.
  workers: 1,
  fullyParallel: false,
  use: {
    channel: "msedge", // use installed Edge - no browser download needed
    headless: true,
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:8376",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});