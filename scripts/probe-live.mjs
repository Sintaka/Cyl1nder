#!/usr/bin/env node
// probe-live.mjs —— 活体巡检（只读，只发 HTTP 请求，不 spawn 子进程）
//
// 这是一份**只读巡检脚本**：只会发起 GET/POST 请求读取桥、vite、Houdini MCP 的
// 当前状态，**绝不重启任何服务、绝不写任何文件**。桥（8375）和 vite（8376）此刻
// 可能正在服务用户尚未保存的工作，重启或占用这两个端口会导致用户丢数据——本脚本
// 从设计上就不具备这个能力：它只 fetch，不 spawn 子进程，不写盘。
//
// 为什么这是 .mjs 不是 .ps1（详见 devlog/development-standards.md「编排脚本必须是
// .mjs，不能是 .ps1」一节）：本 harness 只对 git / node / npm / pnpm / hython /
// .venv\scripts\python 这几个可信前缀解除文件沙箱，`pwsh` 不在名单里，
// `pwsh -File` 起的子进程会继承沙箱限制。本脚本其实根本不 spawn 子进程（只发
// HTTP 请求），选 .mjs 纯粹是为了跟 scripts/verify-all.mjs、
// scripts/release-step.mjs 保持一致：用内置 `fetch`（Node 18+ 自带），不引依赖，
// 不掉进 PowerShell 中文/管道编码的坑。
//
// 为什么 Houdini MCP 探测用 form-urlencoded 而不是 JSON body：
// 官方 fxhoudinimcp 的 `/api` 端点吃的是
// `Content-Type: application/x-www-form-urlencoded`，body 是 `json=` 后面跟着
// 一个 URL 编码过的 JSON 数组字面量（如 `["mcp.health",[],{}]`）——这是它自己的
// 线格式约定，不是我们能改的；发 JSON body 会被它当成参数解析失败。
//
// Usage:
//   node scripts/probe-live.mjs
//   node scripts/probe-live.mjs --value=<url> [--value=<url> ...]
//   node scripts/probe-live.mjs --projects=<N> --serials=<N> --channels=<N>
//
// 退出码：
//   0 —— 全部 OK（若给了基线参数，也一致）
//   1 —— 至少一项 FAIL，或基线数量不符
//   3 —— 环境级问题：连一个请求都没能发出去（例如全局 fetch 不可用）

const BRIDGE_BASE = "http://127.0.0.1:8375";
const VITE_URL = "http://127.0.0.1:8376/";
const MCP_URL = "http://127.0.0.1:8100/api";
const TIMEOUT_MS = 5000;

const argv = process.argv.slice(2);

function getRepeatedArg(name) {
  const prefix = `--${name}=`;
  return argv.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length));
}

function getIntArg(name) {
  const prefix = `--${name}=`;
  const found = argv.find((a) => a.startsWith(prefix));
  if (!found) return undefined;
  const raw = found.slice(prefix.length);
  const v = Number.parseInt(raw, 10);
  if (!Number.isFinite(v)) {
    console.error(`用法错误 —— --${name} 不是合法整数：${raw}`);
    process.exit(1);
  }
  return v;
}

const valueUrls = getRepeatedArg("value");
const expectProjects = getIntArg("projects");
const expectSerials = getIntArg("serials");
const expectChannels = getIntArg("channels");

// 中文字符在等宽终端里占 2 列，直接用 String.length 对齐会歪。这里粗暴地把常见
// CJK / 全角区间按宽度 2 计，其余按 1 计，凑出一张看起来对齐的表。
function displayWidth(str) {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function padDisplay(str, width) {
  const w = displayWidth(str);
  return str + " ".repeat(Math.max(0, width - w));
}

function describeErr(err) {
  if (!err) return "未知错误";
  const parts = [String(err.message || err)];
  if (err.cause && err.cause.message) parts.push(`cause: ${err.cause.message}`);
  return parts.join(" | ");
}

// 发一个请求，解析 JSON body（解析失败则 data 为 null，交给调用方按需报错）。
// 5 秒超时用 AbortSignal.timeout 实现，不额外引依赖。
async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

// 环境级检查：本脚本完全依赖 Node 18+ 内置的全局 fetch / AbortSignal.timeout。
// 如果这两者中的任何一个不存在，说明运行环境本身不满足前提——这时**连第一个
// 请求都不该尝试发出去**，直接报告环境问题并以 exit 3 退出，不要把它伪装成某一项
// 检查的 FAIL（那会误导用户去查桥/vite/MCP 本身，而根因其实是 node 版本）。
if (typeof fetch !== "function" || typeof AbortSignal?.timeout !== "function") {
  console.error(
    "环境问题 —— 全局 fetch 或 AbortSignal.timeout 不可用（需要 Node 18+），一个请求都没有发出去。"
  );
  process.exit(3);
}

const results = [];
let hasFail = false;

function addResult(name, status, detail = "") {
  results.push({ name, status, detail });
  if (status === "FAIL") hasFail = true;
}

// ---- 1. 桥健康 GET /api/health ----
let bridgeVersion = null;
let bridgeSerials = null;
try {
  const r = await fetchJson(`${BRIDGE_BASE}/api/health`);
  if (!r.ok || !r.data || typeof r.data.version !== "string" || typeof r.data.serials !== "number") {
    addResult("桥/health", "FAIL", `响应不符合预期：status=${r.status} body=${JSON.stringify(r.data)}`);
  } else {
    bridgeVersion = r.data.version;
    bridgeSerials = r.data.serials;
    addResult("桥/health", "OK", `version=${bridgeVersion} serials=${bridgeSerials}`);
  }
} catch (err) {
  addResult("桥/health", "FAIL", describeErr(err));
}

// ---- 2. 桥项目 GET /api/projects ----
let projectsCount = null;
try {
  const r = await fetchJson(`${BRIDGE_BASE}/api/projects`);
  if (!r.ok || !r.data || !Array.isArray(r.data.projects)) {
    addResult("桥/projects", "FAIL", `响应不符合预期：status=${r.status} body=${JSON.stringify(r.data)}`);
  } else {
    projectsCount = r.data.projects.length;
    addResult("桥/projects", "OK", `projects=${projectsCount}`);
  }
} catch (err) {
  addResult("桥/projects", "FAIL", describeErr(err));
}

// ---- 3. 桥场景 GET /api/scenes ----
let activeCount = null;
try {
  const r = await fetchJson(`${BRIDGE_BASE}/api/scenes`);
  if (!r.ok || !r.data || !Array.isArray(r.data.active)) {
    addResult("桥/scenes", "FAIL", `响应不符合预期：status=${r.status} body=${JSON.stringify(r.data)}`);
  } else {
    activeCount = r.data.active.length;
    addResult("桥/scenes", "OK", `active=${activeCount}`);
  }
} catch (err) {
  addResult("桥/scenes", "FAIL", describeErr(err));
}

// ---- 4. 桥通道 GET /api/channels ----
let channelsCount = null;
try {
  const r = await fetchJson(`${BRIDGE_BASE}/api/channels`);
  if (!r.ok || !r.data || !Array.isArray(r.data.channels)) {
    addResult("桥/channels", "FAIL", `响应不符合预期：status=${r.status} body=${JSON.stringify(r.data)}`);
  } else {
    channelsCount = r.data.channels.length;
    addResult("桥/channels", "OK", `channels=${channelsCount}`);
  }
} catch (err) {
  addResult("桥/channels", "FAIL", describeErr(err));
}

// ---- 5. vite（只看 HTTP 状态码）----
let viteStatus = null;
try {
  const res = await fetch(VITE_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  viteStatus = res.status;
  if (res.status !== 200) {
    addResult("vite", "FAIL", `status=${res.status}`);
  } else {
    addResult("vite", "OK", `status=${res.status}`);
  }
} catch (err) {
  addResult("vite", "FAIL", describeErr(err));
}

// ---- 6. Houdini MCP（POST form-urlencoded，线格式见文件头注释）----
let mcpPid = null;
try {
  const body = "json=" + encodeURIComponent(JSON.stringify(["mcp.health", [], {}]));
  const r = await fetchJson(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok || !r.data || typeof r.data.pid !== "number") {
    addResult("Houdini MCP", "FAIL", `响应不符合预期：status=${r.status} body=${JSON.stringify(r.data)}`);
  } else {
    mcpPid = r.data.pid;
    addResult("Houdini MCP", "OK", `pid=${mcpPid}`);
  }
} catch (err) {
  addResult("Houdini MCP", "FAIL", describeErr(err));
}

// ---- 可选：基线断言（给了期望值才判定，没给只报告数字）----
function checkBaseline(label, expected, actual) {
  if (expected === undefined) return;
  if (actual === null) {
    addResult(`基线:${label}`, "FAIL", `期望 ${expected}，但该项检查本身已失败，无法比对`);
    return;
  }
  if (actual !== expected) {
    addResult(`基线:${label}`, "FAIL", `期望 ${expected}，实测 ${actual}`);
  } else {
    addResult(`基线:${label}`, "OK", `期望 ${expected} = 实测 ${actual}`);
  }
}
checkBaseline("projects", expectProjects, projectsCount);
checkBaseline("serials", expectSerials, bridgeSerials);
checkBaseline("channels", expectChannels, channelsCount);

// ---- 可选：通道值延迟采样（--value=<url>，可重复；默认不带则跳过）----
const valueSamples = [];
if (valueUrls.length > 0) {
  for (const url of valueUrls) {
    const timingsMs = [];
    let lastValue;
    let sampleError = null;
    for (let i = 0; i < 4; i++) {
      const t0 = Date.now();
      try {
        const r = await fetchJson(url);
        timingsMs.push(Date.now() - t0);
        if (r.data && typeof r.data === "object" && "value" in r.data) {
          lastValue = r.data.value;
        } else {
          lastValue = r.data;
        }
      } catch (err) {
        timingsMs.push(Date.now() - t0);
        sampleError = describeErr(err);
      }
    }
    valueSamples.push({ url, timingsMs, lastValue, sampleError });
    if (sampleError) {
      addResult(`采样:${url}`, "FAIL", sampleError);
    } else {
      addResult(
        `采样:${url}`,
        "OK",
        `耗时=[${timingsMs.join(", ")}]ms value=${JSON.stringify(lastValue)}`
      );
    }
  }
}

// ---- 汇总表 ----
console.log("");
console.log("== 活体巡检汇总 ==");
const nameWidth = Math.max(...results.map((r) => displayWidth(r.name)), displayWidth("项目"));
const statusWidth = 6;
console.log(`${padDisplay("项目", nameWidth)}  ${padDisplay("状态", statusWidth)}  关键信息`);
console.log("-".repeat(nameWidth + statusWidth + 40));
for (const r of results) {
  console.log(`${padDisplay(r.name, nameWidth)}  ${padDisplay(r.status, statusWidth)}  ${r.detail}`);
}
console.log("");
console.log(
  `桥版本=${bridgeVersion ?? "?"}  serials=${bridgeSerials ?? "?"}  projects=${projectsCount ?? "?"}  ` +
    `scenes.active=${activeCount ?? "?"}  channels=${channelsCount ?? "?"}  vite状态码=${viteStatus ?? "?"}  ` +
    `MCP pid=${mcpPid ?? "?"}`
);

// 用 process.exitCode 而不是 process.exit()：这里已经发过若干个
// AbortSignal.timeout() 请求，Node 在 Windows 上对「还有定时器 handle 尚未走完
// 关闭流程时调用 process.exit() 强制退出」有一个已知的 libuv 断言崩溃
// （`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c`，
// 实测 Node v24.14.0 上必现）。设置 exitCode 后让事件循环自然耗尽，不强行斩断，
// 就不会触发这个竞态；本脚本到这里之后确实没有更多异步工作要做，进程会自己退出。
if (hasFail) {
  console.log("");
  console.log("HAS FAILURES —— 至少一项检查失败或基线不符");
  process.exitCode = 1;
} else {
  console.log("");
  console.log("ALL GREEN");
  process.exitCode = 0;
}
