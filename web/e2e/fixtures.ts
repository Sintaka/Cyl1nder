import type { Page } from "@playwright/test";

/** Turn the manual two-way sync gate ON/OFF via the bottom-bar toggle (Phase B).
 *  Round specs that assume engaged sync (round17/19) must call toggleSyncEnabled(page, true) first. */
export async function toggleSyncEnabled(page: Page, enabled: boolean): Promise<void> {
  const cur = await page.evaluate(() => (window as any).__cylSync?.isEnabled?.() ?? false);
  if (cur !== enabled) {
    await page.evaluate((v) => (window as any).__cylSync?.setEnabled?.(v), enabled);
    await page.waitForTimeout(100);
  }
}
