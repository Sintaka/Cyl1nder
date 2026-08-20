import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";
import { gotoMember } from "./fixtures";

test("Cyl1nder page loads and connects to a live serial", async ({ page }) => {
  const client = new BridgeClient();
  const bridgeOk = await client
    .health()
    .then(() => true)
    .catch(() => false);
  test.skip(!bridgeOk, "bridge not running on 127.0.0.1:8375");

  const serial = process.env.CYL1NDER_E2E_SERIAL || "C1-e2etest0001-aaaa" || "";
  test.skip(!serial, "no serial registered in bridge");

  await gotoMember(page, serial);
  await expect(page.locator(".cyl-graph .cyl-rp-title").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".cyl-viewport canvas")).toBeVisible();
  await expect(page.locator(".cyl-status")).toHaveClass(/ok/, { timeout: 15000 });
  // Connection proof via the FULL store log (the panel only renders the last 40
  // lines, and viewport refresh logs can push "hello" out of that window).
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const st: any = (window as any).__cylStore;
          return st ? st.logs.some((l: string) => l.includes("hello")) : false;
        }),
      { timeout: 15000 },
    )
    .toBe(true);
  // dockview lazily mounts inactive tab content: activate the Log tab to surface .cyl-log
  await page.locator(".dv-tab", { hasText: "Log" }).first().click({ timeout: 15000 });
  await expect(page.locator(".cyl-log")).toBeVisible();
});