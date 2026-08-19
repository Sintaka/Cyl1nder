import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { BridgeClient } from "../src/bridge/client";
import { BRIDGE_URL } from "../src/protocol/types";

/** 主应用基址（dev server）。所有 spec 统一从这里取，不再各自硬编码。 */
export const APP_BASE = "http://127.0.0.1:8376";

/** serial → 所属项目号 的解析缓存（同一个 serial 在一个 spec 文件里往往要开多次页面，
 *  没必要每次都往桥打一趟 ensure）。 */
const projectOfSerial = new Map<string, string>();

/** **本文件自己 ensure 出来的**项目号（created=true 那些）→ 触发它的 serial。
 *  只登记新建的：命中已有项目（用户的真项目）时绝不进这张表，afterAll 因此不可能
 *  删到用户的东西。 */
const createdProjects = new Map<string, string>();

/** 删一个项目（裸 fetch，不经 src/stores/projects.ts——e2e 不该依赖页面 store）。
 *  失败只警告不抛：清理失败不该把一个本来通过的 spec 判成失败。 */
async function deleteProject(pid: string): Promise<void> {
  try {
    const res = await fetch(`${BRIDGE_URL}/api/projects/${encodeURIComponent(pid)}`, { method: "DELETE" });
    if (!res.ok) console.warn(`[fixtures] cleanup: DELETE ${pid} -> HTTP ${res.status}`);
  } catch (err) {
    console.warn(`[fixtures] cleanup: DELETE ${pid} failed: ${String(err)}`);
  }
}

// e2e 自清理：**每个 import 本文件的 spec 文件**跑完后，删掉自己 ensure 出来的项目。
//
// 为什么放在模块顶层：Playwright 在收集阶段 require 每个 spec 文件，此时 import 本模块
// 会把这个 afterAll 注册到**当前正在收集的那个文件**的根 suite 上——于是每个用了
// projectForSerial 的 spec 文件都自动带上清理，不需要改任何 spec、也不需要改
// playwright.config（两者都不在本次写集里）。
//
// 为什么必须顺手清 projectOfSerial：一个 worker 会连着跑多个 spec 文件，缓存是模块级
// 的。删完不清缓存，下一个文件会拿着已删的 pid 去开页面，撞上入口守卫 —— 这个坑
// 比它修的问题更难查。
test.afterAll(async () => {
  const pids = [...createdProjects.keys()];
  if (pids.length === 0) return;
  for (const serial of createdProjects.values()) projectOfSerial.delete(serial);
  createdProjects.clear();
  await Promise.all(pids.map(deleteProject));
});

/**
 * 把一个 serial 解析成它所属的项目号（桥的 serial→项目映射；没有归属时桥会隐式建一个
 * 单成员项目）。
 *
 * v0.1.00120：`?serial=` 页面入口已删除，spec 不能再直接用 serial 当页面地址；
 * 这一步**刻意走桥的真实映射**（而不是在 spec 里拼一个假项目号），于是 e2e 顺带覆盖了
 * "打开一个 HDA = 打开它所属项目并激活它"这条新语义本身。
 *
 * 合成 serial（`C1-e2eround9-0001` 之类）在 registry 里没有 hip，桥只能给它兜底建一个
 * 无 hip 项目 —— 这正是「项目列表里 13 个有 12 个是垃圾」的来源。所以**新建的项目在此
 * 登记，跑完由 afterAll 删掉**：e2e 自己产生的垃圾自己收拾，不留给桥的自动清理去猜。
 */
export async function projectForSerial(serial: string): Promise<string> {
  const cached = projectOfSerial.get(serial);
  if (cached) return cached;
  const r = await new BridgeClient().ensureProject(serial);
  const pid = r.ok ? r.project?.projectSerial : "";
  if (!pid) throw new Error(`bridge could not resolve a project for ${serial}`);
  projectOfSerial.set(serial, pid);
  // created=true 才登记：命中已有项目（可能是用户的真项目）时绝不碰它。
  if (r.created) createdProjects.set(pid, serial);
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
