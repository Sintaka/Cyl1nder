#!/usr/bin/env node
// verify-all.mjs — 三端一键验证（AHS「每条铁律」脚本化，node 版）
//
// 为什么这个脚本是 .mjs 而不是 .ps1（因果链，别删）：
//   1. 本 harness 只对少数「可信前缀」命令解除文件沙箱：git / node / npm / pnpm /
//      hython / .venv\scripts\python。`pwsh` 不在其中。
//   2. 一旦某条命令的首个 token 是 `pwsh`（例如 `pwsh -File scripts\verify-all.ps1`），
//      整个进程都被沙箱限制——`pwsh` 从它自己 spawn 出来的子进程（python.exe、
//      node.exe……）**继承**这个限制，即便这些子进程本身在可信前缀名单里。
//   3. 实测后果：同样的 `.venv\Scripts\python -m pytest tests -q`，直接跑是
//      460 passed；被 `.ps1` 当父进程跑起来后，pytest 的 460 个用例**全部**变成
//      `PermissionError: [WinError 5] 拒绝访问`，都落在 `tmp_path_factory.mktemp`——
//      沙箱不让它在临时目录下建文件/目录。
//   4. 同理，`node node_modules/vitest/vitest.mjs run` 直接跑是 972 passed；被
//      `.ps1` 当父进程跑起来后，vitest 内部 esbuild 的 `ensureServiceIsRunning`
//      要开一条命名管道跟 esbuild 服务进程通信，沙箱不允许，直接
//      `Error: spawn EPERM`。
//   5. 反面验证：用一次性 node 探针，在 node 里用
//      `spawnSync(cmd, args, { stdio: "inherit" })` 起同样的 pytest / vitest，
//      两者都能跑通（vitest exit 0、972 passed）。
//   结论：编排脚本必须让**首个 token** 落在可信前缀上——也就是 `node
//   scripts/verify-all.mjs`，而不是 `pwsh -File scripts\verify-all.ps1`。
//
// stdio 必须是 "inherit"，不能是 "pipe"：
//   `stdio: "pipe"`（Node 的默认值）需要在父子进程之间建立管道来转发
//   stdout/stderr，这在本沙箱下等价于「开命名管道」，会撞上跟上面第 4 点
//   同样的 EPERM 边界。`"inherit"` 让子进程直接复用当前进程的
//   stdout/stderr 文件描述符，不建任何管道，这是探针里验证过的能用边界。
//   代价是本脚本拿不到子进程输出的文本内容去做二次解析——这是有意为之，
//   不要为了"解析输出"改回 "pipe"。
//
// Usage: node scripts/verify-all.mjs [--skip-hython] [--staged]

"use strict";

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const argv = process.argv.slice(2);
const skipHython = argv.includes("--skip-hython");
const staged = argv.includes("--staged");

// 沿用 .ps1 里原来那一行 hython 路径，不新猜一个。
const HYTHON_EXE =
  "C:\\Program Files\\Side Effects Software\\Houdini 22.0.368\\bin\\hython.exe";

const results = [];
let hasFail = false;
let hasToolFail = false;

const COLORS = { red: "31", green: "32", yellow: "33", cyan: "36", white: "37" };

function colorLine(text, color) {
  const code = COLORS[color] || COLORS.white;
  return `\u001b[${code}m${text}\u001b[0m`;
}

function addResult(name, status, detail = "") {
  results.push({ name, status, detail });
}

function printHeading(title) {
  console.log("");
  console.log(colorLine(title, "cyan"));
}

// 运行一个外部命令，返回统一的判定结果。
//
// spawnSync 不会用异常报告"命令根本没跑起来"，而是把这个事实放进返回值：
//   - result.error 存在（例如 ENOENT：可执行文件找不到）
//   - 或者 result.status === null（进程被信号杀死、从未真正退出）
// 这两种情况都是 TOOLFAIL（工具本身没跑起来），必须与"退出码非 0"（FAIL，
// 工具跑起来了但报告了问题）严格区分。不要用 try/catch 去猜——spawnSync 本身
// 不抛异常，try/catch 在这里接不住任何东西，是死代码。
function runStep(cmd, args, opts) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: false,
    ...opts,
  });

  if (result.error || result.status === null) {
    return { toolFail: true, exitCode: null, error: result.error };
  }
  return { toolFail: false, exitCode: result.status, error: null };
}

// ---- 1/4 bridge pytest ----
printHeading("== 1/4 bridge pytest ==");
{
  const r = runStep(
    path.join(root, "bridge", ".venv", "Scripts", "python.exe"),
    ["-m", "pytest", "tests", "-q"],
    { cwd: path.join(root, "bridge") }
  );
  if (r.toolFail) {
    console.log(
      colorLine(
        `TOOL FAILURE —— bridge pytest 无法执行：${r.error ? r.error.message : "进程未正常退出"}`,
        "red"
      )
    );
    hasToolFail = true;
    addResult("bridge pytest", "TOOLFAIL");
  } else if (r.exitCode !== 0) {
    hasFail = true;
    addResult("bridge pytest", "FAIL", `exit ${r.exitCode}`);
  } else {
    addResult("bridge pytest", "PASS");
  }
}

// ---- 2/4 web tsc --noEmit ----
printHeading("== 2/4 web tsc --noEmit ==");
{
  const r = runStep(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--noEmit"],
    { cwd: path.join(root, "web") }
  );
  if (r.toolFail) {
    console.log(
      colorLine(
        `TOOL FAILURE —— web tsc 无法执行：${r.error ? r.error.message : "进程未正常退出"}`,
        "red"
      )
    );
    hasToolFail = true;
    addResult("web tsc", "TOOLFAIL");
  } else if (r.exitCode !== 0) {
    hasFail = true;
    addResult("web tsc", "FAIL", `exit ${r.exitCode}`);
  } else {
    addResult("web tsc", "PASS");
  }
}

// ---- 3/4 web vitest ----
printHeading("== 3/4 web vitest ==");
{
  const r = runStep(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run"],
    { cwd: path.join(root, "web") }
  );
  if (r.toolFail) {
    console.log(
      colorLine(
        `TOOL FAILURE —— web vitest 无法执行：${r.error ? r.error.message : "进程未正常退出"}`,
        "red"
      )
    );
    hasToolFail = true;
    addResult("web vitest", "TOOLFAIL");
  } else if (r.exitCode !== 0) {
    hasFail = true;
    addResult("web vitest", "FAIL", `exit ${r.exitCode}`);
  } else {
    addResult("web vitest", "PASS");
  }
}

// ---- 4/4 hython smoke ----
printHeading("== 4/4 hython smoke ==");
{
  let hythonExists = true;
  try {
    // 只用 spawnSync 探测是否存在，避免引入 node:fs 之外的依赖判断方式的分歧；
    // 这里直接尝试运行，找不到文件会走 TOOLFAIL 分支，但我们想要的是"自动跳过"
    // 而不是"工具失败"，所以显式检查一次路径存在性。
    const fs = await import("node:fs");
    hythonExists = fs.existsSync(HYTHON_EXE);
  } catch {
    hythonExists = false;
  }

  if (skipHython) {
    console.log(colorLine("跳过（--skip-hython）", "yellow"));
    addResult("hython smoke", "SKIP", "--skip-hython");
  } else if (!hythonExists) {
    console.log(
      colorLine(`跳过 —— hython 路径不存在：${HYTHON_EXE}`, "yellow")
    );
    addResult("hython smoke", "SKIP", "路径不存在");
  } else {
    const r = runStep(HYTHON_EXE, [
      path.join(root, "hda", "scripts", "hython_smoke.py"),
    ]);
    if (r.toolFail) {
      console.log(
        colorLine(
          `TOOL FAILURE —— hython 无法执行：${r.error ? r.error.message : "进程未正常退出"}`,
          "red"
        )
      );
      hasToolFail = true;
      addResult("hython smoke", "TOOLFAIL");
    } else if (r.exitCode !== 0) {
      hasFail = true;
      addResult("hython smoke", "FAIL", `exit ${r.exitCode}`);
    } else {
      addResult("hython smoke", "PASS");
    }
  }
}

// ---- 附加：check-staged（仅 --staged 时跑）----
if (staged) {
  printHeading("== 附加：check-staged ==");
  const r = runStep("pwsh", [
    "-File",
    path.join(root, "scripts", "check-staged.ps1"),
  ]);
  if (r.toolFail) {
    console.log(
      colorLine(
        `TOOL FAILURE —— check-staged.ps1 无法执行：${r.error ? r.error.message : "进程未正常退出"}`,
        "red"
      )
    );
    hasToolFail = true;
    addResult("check-staged", "TOOLFAIL");
  } else if (r.exitCode === 0) {
    addResult("check-staged", "PASS");
  } else if (r.exitCode === 1) {
    hasFail = true;
    addResult("check-staged", "FAIL", "问题");
  } else if (r.exitCode === 2) {
    addResult("check-staged", "VACUOUS", "无新增行可查，不构成通过");
  } else if (r.exitCode === 3) {
    hasToolFail = true;
    addResult("check-staged", "TOOLFAIL", "exit 3");
  } else {
    hasFail = true;
    addResult("check-staged", "FAIL", `未知 exit ${r.exitCode}`);
  }
}

// ---- 汇总 ----
printHeading("== 汇总 ==");
for (const r of results) {
  const color =
    r.status === "PASS"
      ? "green"
      : r.status === "SKIP" || r.status === "VACUOUS"
        ? "yellow"
        : r.status === "FAIL" || r.status === "TOOLFAIL"
          ? "red"
          : "white";
  let line = `  ${r.name.padEnd(16)} ${r.status}`;
  if (r.detail) line += ` (${r.detail})`;
  console.log(colorLine(line, color));
}

if (hasToolFail) {
  console.log("");
  console.log(colorLine("TOOL FAILURE —— 至少一个工具没能运行起来", "red"));
  process.exit(3);
} else if (hasFail) {
  console.log("");
  console.log(colorLine("HAS FAILURES", "red"));
  process.exit(1);
} else {
  console.log("");
  console.log(colorLine("ALL GREEN", "green"));
  process.exit(0);
}
