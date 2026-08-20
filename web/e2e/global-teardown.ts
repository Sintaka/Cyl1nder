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
    const doomed = (body.projects ?? []).filter((p) => {
      if (!p.projectSerial || p.hip) return false; // 有 hip = 用户真项目
      const ms = p.members ?? [];
      return ms.length > 0 && ms.every((m) => E2E_SERIAL.test(m.serial ?? ""));
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
