import http from "node:http";
import { BRIDGE_URL } from "../src/protocol/types";

/** 合成 e2e serial 的形状：`C1-e2e…`。只有 spec 会造这种号（真 HDA 的号是时间戳基）。 */
const E2E_SERIAL = /^C1-e2e/i;

/**
 * 用 `node:http` + `agent: false` 发一次请求，**不留连接池**。
 *
 * 为什么不用 `fetch`：Node 的 fetch（undici）保持 keep-alive socket，而 globalTeardown
 * 跑在**进程即将退出**的时刻 —— 那些还活着的句柄和 libuv 关句柄撞车，实测报
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c, line 76`，
 * 于是**全绿的 suite 以 exit code 1 收场**（103 passed 却判失败，CI 上最坏的一种噪音）。
 *
 * 我先以为是 `AbortSignal.timeout` 排的定时器，改掉后断言照旧 —— 说明真凶是连接池。
 * `agent: false` 每次用一条新连接并即时关闭，退出时没有悬着的 socket。
 */
function request(method: string, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, agent: false },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.setTimeout(8000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * 全量跑完后**扫一次**：删掉「无 hip 且成员全是合成 e2e serial」的项目（v0.1.00140）。
 *
 * 为什么必须在 globalTeardown 而不是 fixtures 的 `test.afterAll`：那个注册在模块顶层，
 * 而 Node 缓存模块 —— 一个 worker 连着跑多个 spec 文件时它只挂到**第一个** import 的
 * 文件上，后面每个文件新建的项目照样漏在桥里。实测过：旧的 4 个被删了，同一轮又留下 4 个。
 *
 * 为什么要清：每个残留项目都让 `hello` 多做一份活，全量 e2e 的 `.cyl-status → ok`
 * 握手（15s 超时）因此越来越慢。本会话 round12 因此挂了**三次**，我第一次还当 flake 放过了。
 *
 * 判据是**它是什么**（无 hip + 成员全是 `C1-e2e…`），不是**谁造的** —— 于是历史遗留的、
 * 以及被打断的运行留下的，都能一并收拾。带 hip 的项目（用户真项目）绝不碰。
 */
export default async function globalTeardown(): Promise<void> {
  try {
    const res = await request("GET", `${BRIDGE_URL}/api/projects`);
    if (res.status !== 200) return;
    // 成员的号在 **`serial`** 字段上（实测 member 形状：
    // `{kind, serial, nodePath, absolutePath, hip, label, registeredAt, lastSeen}`）。
    // 我第一版写的是 `channelId`：每个成员都读成 ""、正则全不匹配、一个都没删，而且**静默**。
    const body = JSON.parse(res.body) as {
      projects?: Array<{ projectSerial?: string; hip?: string; members?: Array<{ serial?: string }> }>;
    };
    // 先扫注册表，拿到**这一轮我确实删掉的** serial 集合。
    // 顺序很重要：项目判据要用到它（见下面第二个条件）。
    await sweepChannels();
    const removedSerials = await sweepScenes();
    const doomed = (body.projects ?? []).filter((p) => {
      if (!p.projectSerial || p.hip) return false; // 有 hip = 用户真项目
      const ms = p.members ?? [];
      if (ms.length === 0) return false;
      // 两类都算 e2e 垃圾：
      // 1. 成员全是固定合成号（`C1-e2e…`）；
      // 2. 成员全是**我刚在本次 teardown 里删掉登记的号** —— round8 建场景时桥会顺手
      //    给它兜底建一个项目，而那个号是**桥现铸的**（`C1-mt1s…`），不匹配 `C1-e2e` 前缀，
      //    于是登记被扫掉了、项目还留着（实测每轮留 1 个，跑三轮攒 3 个）。
      //
      // **不用「成员不在注册表里」当判据**：吊牌只注册通道、从不推 inputs，本来就不在
      // 注册表里（实测用户那三个吊牌都不在），那条判据会误伤用户的纯吊牌项目。
      // 「我刚删的」是自证的：只删我自己这一轮制造出来的孤儿。
      return (
        ms.every((m) => E2E_SERIAL.test(m.serial ?? "")) ||
        ms.every((m) => removedSerials.has(m.serial ?? ""))
      );
    });
    for (const p of doomed) {
      const r = await request("DELETE", `${BRIDGE_URL}/api/projects/${encodeURIComponent(p.projectSerial as string)}`);
      if (r.status !== 200) console.warn(`[teardown] DELETE ${p.projectSerial} -> HTTP ${r.status}`);
    }
    if (doomed.length > 0) console.log(`[teardown] swept ${doomed.length} synthetic e2e project(s)`);
  } catch (err) {
    // 清理失败绝不把通过的 suite 判成失败
    console.warn(`[teardown] sweep failed: ${String(err)}`);
  }
}

/**
 * 扫掉 e2e 自己注册的**通道行**（v0.1.00158）。
 *
 * `sweepScenes` 只清*场景登记*，通道行没人管 —— round23 的 vec3 参数端口用例要自己往桥
 * 注册 tag+param 行，实测一跑就从 11 涨到 13。本会话已因这类泄漏把 `.cyl-status` 握手
 * 挤掉三次，每次都先被我当成 flake，所以见到就堵。
 *
 * 判据同样是**它是什么**：serial 匹配 `C1-e2e…`（只有 spec 造这种号）。
 */
async function sweepChannels(): Promise<void> {
  const res = await request("GET", `${BRIDGE_URL}/api/channels`);
  if (res.status !== 200) return;
  const body = JSON.parse(res.body) as { channels?: Array<{ serial?: string }> };
  const doomed = [...new Set((body.channels ?? []).map((c) => c.serial ?? "").filter((s) => E2E_SERIAL.test(s)))];
  for (const s of doomed) {
    const r = await request("DELETE", `${BRIDGE_URL}/api/channels/by-serial/${encodeURIComponent(s)}`);
    if (r.status !== 200) console.warn(`[teardown] DELETE channels ${s} -> HTTP ${r.status}`);
  }
  if (doomed.length > 0) console.log(`[teardown] swept ${doomed.length} e2e channel serial(s)`);
}

/** e2e 造出来的注册表登记：spec 专用的 nodePath，或 round8 建的场景标签。 */
const E2E_NODEPATH = "/obj/test/Cyl1nder1";
const E2E_SCENE_LABEL = /^e2e-overview-/;
/** 各 spec 共用的固定夹具号 —— **保留**，删了 spec 下一轮还得重建。 */
const FIXTURE_SERIAL = "C1-e2etest0001-aaaa";

/**
 * 扫掉 e2e 留在**注册表**里的孤儿登记（v0.1.00142）。
 *
 * 为什么 `POST /api/scenes/cleanup` 不够：它只清「无数据且无快照」的条目，而 e2e 把
 * CANONICAL_INPUTS 推进去的号带着 `inputRev=38`，于是**永远**清不掉 ——
 * 实测桥里攒了 37 条 `nodePath=/obj/test/Cyl1nder1` 的孤儿，加上每轮 round8 新建的
 * `e2e-overview-<ts>` 场景。注册表 39→42 一路涨，每条都让 `hello` 多做一份活，
 * 全量 e2e 的握手（15s）因此越来越慢 —— round10/round12 的偶发失败正是这么攒出来的。
 *
 * 判据是**它是什么**：
 * - `nodePath === "/obj/test/Cyl1nder1"` —— 这个路径只出现在 spec 里，真 HDA 不会用；
 * - 或 label 以 `e2e-overview-` 开头 —— round8 的新建场景。
 *
 * **保留固定夹具号**（删了 spec 下一轮还得重建），**绝不按「无数据」推断** ——
 * 那会误删用户刚建、还没 cook 的真 HDA。只删登记，节点下次 cook 会自行重注册。
 */
async function sweepScenes(): Promise<Set<string>> {
  const removed = new Set<string>();
  const res = await request("GET", `${BRIDGE_URL}/api/scenes`);
  if (res.status !== 200) return removed;
  const body = JSON.parse(res.body) as {
    active?: Array<{ serial?: string; label?: string; nodePath?: string }>;
  };
  const doomed = (body.active ?? []).filter((s) => {
    if (!s.serial || s.serial === FIXTURE_SERIAL) return false;
    return s.nodePath === E2E_NODEPATH || E2E_SCENE_LABEL.test(s.label ?? "");
  });
  for (const s of doomed) {
    const r = await request("DELETE", `${BRIDGE_URL}/api/scenes/${encodeURIComponent(s.serial as string)}`);
    if (r.status !== 200) console.warn(`[teardown] DELETE scene ${s.serial} -> HTTP ${r.status}`);
    // 只把**确实删掉的**记进集合：项目判据靠它自证「这是我这一轮制造的孤儿」，
    // 把删失败的也记进去就会去删一个我没资格删的项目。
    else removed.add(s.serial as string);
  }
  if (removed.size > 0) console.log(`[teardown] swept ${removed.size} orphan e2e registration(s)`);
  return removed;
}
