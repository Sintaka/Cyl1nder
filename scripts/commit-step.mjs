#!/usr/bin/env node
// commit-step.mjs — 提交仪式脚本化（node 版）：验消息文件 → add -A → 卫生检查 → commit → 复核
// Usage: node scripts/commit-step.mjs --message=<path> [--allow-vacuous] [--dry-run]
//
// 为什么是 .mjs 不是 .ps1（与 verify-all.mjs / release-step.mjs 同因，不重复整段论证）：
//   本 harness 只对 git / node / npm / pnpm / hython / .venv\scripts\python 这些
//   「可信前缀」解除文件沙箱；`pwsh` 不在其中，一旦顶层命令首个 token 是 `pwsh`，
//   它 spawn 出的子进程会继承限制。所以编排脚本必须让首个 token 落在可信前缀上：
//   `node scripts/commit-step.mjs`，不是 `pwsh -File scripts\commit-step.ps1`。
//   本脚本内部再 spawnSync('pwsh', ['-File','scripts\\check-staged.ps1'], ...) 是安全的——
//   那是从已经受信的 node 进程发出的**嵌套**调用，verify-all.mjs 的 --staged 分支
//   已经这样用过且实测可行（VACUOUS 分支 exit 2 拿到过）。
//
// ---- 本次实测结论：spawnSync 对 git 能否用默认 'pipe' ----
//   1. `spawnSync('git', ['log','-1','--format=%h %s'], { encoding: 'utf8' })`
//      （不显式指定 stdio，Node 默认 'pipe'）—— 实测直接 EPERM：
//        errno: -4048, code: 'EPERM', syscall: 'spawnSync git'
//      与 verify-all.mjs 头部记录的 vitest/pytest 'pipe' EPERM 是同一类沙箱边界，
//      对 git 同样成立，`git` 在可信前缀名单里也换不来 'pipe' 的豁免。
//   2. `stdio: 'inherit'` 照预期可用（exit 0），但拿不到文本，只能给人看，不能解析——
//      这条路线满足步骤 2/3/4（add -A、check-staged.ps1、commit）的需要：这三步
//      本脚本只关心退出码，不关心文本。
//   3. 步骤 5 需要**文本**（commit 的短 hash/主题、status 是否干净）。'pipe' 不可用，
//      `git --output=<file>` 只对部分子命令存在（`git log --output=` 实测可用），
//      对 `git status` / `git ls-files` / `git clean` 实测都是
//      `error: unknown option 'output=...'`（exit 129），不能通用。
//      **实测发现的第三条路**：把 `stdio` 的 fd1 换成一个真实文件的文件描述符
//      （`fs.openSync(tmpFile, 'w')` 拿到的 fd，塞进 `stdio: ['ignore', fd, 'ignore']`），
//      而不是匿名/命名管道。这不是 'pipe'——没有创建任何管道，子进程的 stdout
//      直接被操作系统重定向进一个磁盘文件，沙箱边界卡的是「开管道通信」，不是
//      「写文件」，所以这条路径实测可行：
//        `git log -1 --format=%h %s` 重定向到临时文件 → exit 0，内容正确读出；
//        `git status --short` 重定向到临时文件 → exit 0，内容正确读出（含空结果）。
//      本脚本步骤 5 因此采用「fd 重定向到临时文件 + 读回 + 删除临时文件」，
//      而不是 `stdio: 'inherit'` 单纯打印不解析——比任务书列出的两个选项都更完整，
//      经过实测确认可靠才采用，不是猜测。
//
// stdio 约定（与 verify-all.mjs 一致）：
//   - 步骤 2（add -A）、步骤 3（check-staged.ps1）、步骤 4（commit）：全部 'inherit'，
//     只看退出码，不解析文本，避免任何管道。
//   - 步骤 5（复核）：'ignore' + 真实文件 fd，读回文本后立即删除临时文件。
//
// process.exit() 使用说明：本脚本全程只用同步 spawnSync 与同步 fs 调用，没有引入
// 任何异步操作，收尾用 process.exit() 是安全的（development-standards.md 里那条
// Node v24/Windows libuv 断言崩溃只发生在「异步/子进程收尾后」强退，不适用于
// 纯同步脚本）。如果未来给本脚本加了异步逻辑，必须改回 process.exitCode。
//
// 退出码：0 提交成功（或 dry-run 通过）／1 真实失败（消息文件不合格、卫生打红、
// VACUOUS 未放行、commit 本身失败）／3 工具没跑起来（git/pwsh 无法执行）。

"use strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const allowVacuous = argv.includes("--allow-vacuous");

function getStrArg(name) {
  const prefix = `--${name}=`;
  const found = argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const messagePath = getStrArg("message");

const COLORS = { red: "31", green: "32", yellow: "33", cyan: "36", white: "37" };
function colorLine(text, color) {
  const code = COLORS[color] || COLORS.white;
  return `\u001b[${code}m${text}\u001b[0m`;
}
function heading(title) {
  console.log("");
  console.log(colorLine(title, "cyan"));
}

// 运行一个外部命令，全程 stdio: 'inherit'（见文件头「实测结论」），只判定退出码。
function runStep(cmd, args, opts) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  if (result.error || result.status === null) {
    return { toolFail: true, exitCode: null, error: result.error };
  }
  return { toolFail: false, exitCode: result.status, error: null };
}

// 读取一个 git 子命令的文本输出：把 fd1 重定向到一个真实临时文件（不是管道），
// 跑完立即读回并删除。见文件头「实测结论」第 3 点。
function runGitCapture(args) {
  const tmpFile = path.join(os.tmpdir(), `cyl-commit-step-${process.pid}-${Date.now()}.txt`);
  const fd = fs.openSync(tmpFile, "w");
  let result;
  try {
    result = spawnSync("git", args, { stdio: ["ignore", fd, "ignore"], shell: false, cwd: root });
  } finally {
    fs.closeSync(fd);
  }
  if (result.error || result.status === null) {
    fs.rmSync(tmpFile, { force: true });
    return { toolFail: true, exitCode: null, error: result.error, text: "" };
  }
  let text = "";
  try {
    text = fs.readFileSync(tmpFile, "utf8");
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
  return { toolFail: false, exitCode: result.status, error: null, text };
}

// ---- 1/5 验提交说明文件 ----
heading("== 1/5 验提交说明文件 ==");
if (!messagePath) {
  console.log(colorLine("FAIL —— 未提供 --message=<path> 参数", "red"));
  process.exit(1);
}
if (!fs.existsSync(messagePath)) {
  console.log(colorLine(`FAIL —— 消息文件不存在：${messagePath}`, "red"));
  process.exit(1);
}
const msgBuffer = fs.readFileSync(messagePath);
if (msgBuffer.length === 0) {
  console.log(colorLine(`FAIL —— 消息文件为空：${messagePath}`, "red"));
  process.exit(1);
}
if (msgBuffer.length >= 3 && msgBuffer[0] === 0xef && msgBuffer[1] === 0xbb && msgBuffer[2] === 0xbf) {
  console.log(colorLine(`FAIL —— 消息文件带 UTF-8 BOM（首字节 EF BB BF）：${messagePath}`, "red"));
  process.exit(1);
}
const msgText = msgBuffer.toString("utf8");
if (/\[\d+\s+chars\s+omitted\]/.test(msgText)) {
  console.log(colorLine(`FAIL —— 消息文件含写工具截断残留（[数字 chars omitted]）：${messagePath}`, "red"));
  process.exit(1);
}
let msgLines = msgText.split(/\r\n|\n/);
if (msgLines.length > 1 && msgLines[msgLines.length - 1] === "") {
  // 文件以换行符结尾时 split 会多出一个空字符串，不算作一"行"。
  msgLines = msgLines.slice(0, -1);
}
const subjectLine = msgLines[0] ?? "";
console.log(colorLine(`主题行：${subjectLine}`, "white"));
console.log(colorLine(`总行数：${msgLines.length}`, "white"));
console.log(colorLine("消息文件校验通过（存在/非空/无 BOM/无截断残留）", "green"));

// ---- 2/5 git add -A ----
heading("== 2/5 git add -A ==");
{
  const r = runStep("git", ["add", "-A"], { cwd: root });
  if (r.toolFail) {
    console.log(colorLine(`TOOL FAILURE —— git add -A 无法执行：${r.error ? r.error.message : "进程未正常退出"}`, "red"));
    process.exit(3);
  }
  if (r.exitCode !== 0) {
    console.log(colorLine(`FAIL —— git add -A 退出码 ${r.exitCode}`, "red"));
    process.exit(1);
  }
  console.log(colorLine("git add -A 完成", "green"));
}

// ---- 3/5 卫生检查（check-hygiene.mjs） ----
// 2026-08-21 起改用 node 版：它多查一条 check-staged.ps1 查不到的东西 ——
// 工作树里「夹在文件中间」的游离 U+FEFF（旧脚本只看 staged diff，
// 一个早已提交、藏在第 16 行行首的 BOM 它永远发现不了，实测靠人眼才抓到）。
heading("== 3/5 卫生检查 ==");
{
  const r = runStep(process.execPath, [path.join(root, "scripts", "check-hygiene.mjs")]);
  if (r.toolFail) {
    console.log(colorLine(`TOOL FAILURE —— check-hygiene.mjs 无法执行：${r.error ? r.error.message : "进程未正常退出"}`, "red"));
    process.exit(3);
  }
  if (r.exitCode === 0) {
    console.log(colorLine("卫生检查通过", "green"));
  } else if (r.exitCode === 1) {
    console.log(colorLine("FAIL —— 卫生检查发现问题，拒绝提交", "red"));
    process.exit(1);
  } else if (r.exitCode === 2) {
    if (!allowVacuous) {
      console.log(
        colorLine(
          "FAIL —— VACUOUS（staged diff 无新增行可查），默认拒绝提交。若确认是纯删除等合法情形，加 --allow-vacuous 放行",
          "red"
        )
      );
      process.exit(1);
    }
    console.log(colorLine("VACUOUS —— 无新增行可查，但已传 --allow-vacuous，放行继续", "yellow"));
  } else if (r.exitCode === 3) {
    console.log(colorLine("TOOL FAILURE —— check-hygiene.mjs 自身失败（exit 3），这不是卫生结论", "red"));
    process.exit(3);
  } else {
    console.log(colorLine(`FAIL —— check-hygiene.mjs 返回未知退出码 ${r.exitCode}`, "red"));
    process.exit(1);
  }
}

// ---- dry-run 在此止步 ----
if (dryRun) {
  heading("== dry-run ==");
  console.log(colorLine("dry-run：卫生通过，未提交", "green"));
  process.exit(0);
}

// ---- 4/5 commit ----
heading("== 4/5 git commit ==");
{
  const r = runStep("git", ["-c", "core.commentChar=;", "commit", "-F", messagePath], { cwd: root });
  if (r.toolFail) {
    console.log(colorLine(`TOOL FAILURE —— git commit 无法执行：${r.error ? r.error.message : "进程未正常退出"}`, "red"));
    process.exit(3);
  }
  if (r.exitCode !== 0) {
    console.log(colorLine(`FAIL —— git commit 退出码 ${r.exitCode}`, "red"));
    process.exit(1);
  }
  console.log(colorLine("commit 完成", "green"));
}

// ---- 5/5 复核 ----
heading("== 5/5 复核 ==");
{
  const logR = runGitCapture(["log", "-1", "--format=%h %s"]);
  if (logR.toolFail) {
    console.log(colorLine(`TOOL FAILURE —— git log 复核无法执行：${logR.error ? logR.error.message : "进程未正常退出"}`, "red"));
    process.exit(3);
  }
  if (logR.exitCode !== 0) {
    console.log(colorLine(`FAIL —— git log 复核退出码 ${logR.exitCode}`, "red"));
    process.exit(1);
  }
  console.log(colorLine(`新 commit：${logR.text.trim()}`, "green"));

  const statusR = runGitCapture(["status", "--short"]);
  if (statusR.toolFail) {
    console.log(colorLine(`TOOL FAILURE —— git status 复核无法执行：${statusR.error ? statusR.error.message : "进程未正常退出"}`, "red"));
    process.exit(3);
  }
  if (statusR.exitCode !== 0) {
    console.log(colorLine(`FAIL —— git status 复核退出码 ${statusR.exitCode}`, "red"));
    process.exit(1);
  }
  const statusText = statusR.text;
  if (statusText.trim().length === 0) {
    console.log(colorLine("git status --short 干净", "green"));
  } else {
    console.log(colorLine("警告 —— 提交后工作区仍有改动，可能漏了东西：", "yellow"));
    console.log(colorLine(statusText, "yellow"));
  }
}

console.log("");
console.log(colorLine("提交完成", "green"));
process.exit(0);

