import { expect, test } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";

test("Cyl1nder page loads and connects to a live serial", async ({ page }) => {
  const client = new BridgeClient();
  const bridgeOk = await client
    .health()
    .then(() => true)
    .catch(() => false);
  test.skip(!bridgeOk, "bridge not running on 127.0.0.1:8375");

  const serials = await client.listSerials();
  const serial = process.env.CYL1NDER_E2E_SERIAL || serials[serials.length - 1] || "";
  test.skip(!serial, "no serial registered in bridge");

  await page.goto(`http://127.0.0.1:8376/?serial=${serial}`);
  await expect(page.locator(".cyl-graph .cyl-rp-title").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".cyl-viewport canvas")).toBeVisible();
  await expect(page.locator(".cyl-status")).toHaveClass(/ok/, { timeout: 15000 });
  await expect(page.locator(".cyl-log")).toContainText("hello", { timeout: 15000 });
});