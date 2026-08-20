import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // 全量跑完扫掉合成 e2e 项目（v0.1.00140）。必须在这里而不是 fixtures 的
  // `test.afterAll`：那个注册在模块顶层，Node 缓存模块 → 一个 worker 只把它挂到
  // **第一个** import 的 spec 文件上，后面每个文件新建的项目都会漏在桥里（实测过）。
  globalTeardown: "./e2e/global-teardown.ts",
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