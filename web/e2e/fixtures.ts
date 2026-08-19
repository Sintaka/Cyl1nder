import type { Page } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";

/** 主应用基址（dev server）。所有 spec 统一从这里取，不再各自硬编码。 */
export const APP_BASE = "http://127.0.0.1:8376";

/** serial → 所属项目号 的解析缓存（同一个 serial 在一个 spec 文件里往往要开多次页面，
 *  没必要每次都往桥打一趟 ensure）。 */
const projectOfSerial = new Map<string, string>();

/**
 * 把一个 serial 解析成它所属的项目号（桥的 serial→项目映射；没有归属时桥会隐式建一个
 * 单成员项目）。
 *
 * v0.1.00120：`?serial=` 页面入口已删除，spec 不能再直接用 serial 当页面地址；
 * 这一步**刻意走桥的真实映射**（而不是在 spec 里拼一个假项目号），于是 e2e 顺带覆盖了
 * "打开一个 HDA = 打开它所属项目并激活它"这条新语义本身。
 */
export async function projectForSerial(serial: string): Promise<string> {
  const cached = projectOfSerial.get(serial);
  if (cached) return cached;
  const r = await new BridgeClient().ensureProject(serial);
  const pid = r.ok ? r.project?.projectSerial : "";
  if (!pid) throw new Error(`bridge could not resolve a project for ${serial}`);
  projectOfSerial.set(serial, pid);
  return pid;
}

/**
 * 打开「某个成员的工作区」页面 —— 取代所有 `page.goto("…/?serial=" + serial)`。
 *
 * 先解析项目，再跳 `?project=<P1-…>&member=<C1-…>`（这是 v0.1.00120 之后唯一的成员
 * 页面入口形态）。返回项目号，方便 spec 断言两段地址 `/P1-…/C1-…/`。
 */
export async function gotoMember(page: Page, serial: string): Promise<string> {
  const pid = await projectForSerial(serial);
  await page.goto(`${APP_BASE}/?project=${encodeURIComponent(pid)}&member=${encodeURIComponent(serial)}`);
  return pid;
}

/** Turn the manual two-way sync gate ON/OFF via the bottom-bar toggle (Phase B).
 *  Round specs that assume engaged sync (round17/19) must call toggleSyncEnabled(page, true) first. */
export async function toggleSyncEnabled(page: Page, enabled: boolean): Promise<void> {
  const cur = await page.evaluate(() => (window as any).__cylSync?.isEnabled?.() ?? false);
  if (cur !== enabled) {
    await page.evaluate((v) => (window as any).__cylSync?.setEnabled?.(v), enabled);
    await page.waitForTimeout(100);
  }
}
