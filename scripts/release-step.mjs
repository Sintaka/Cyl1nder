#!/usr/bin/env node
// release-step.mjs — 每次 commit 前的版本号+索引+quickstart 仪式脚本化（node 版）
// Usage: node scripts/release-step.mjs [--no-index] [--pytest=<N>] [--vitest=<N>]
//
// 为什么是 .mjs 不是 .ps1（详见 devlog/development-standards.md
// 「编排脚本必须是 .mjs，不能是 .ps1（沙箱可信前缀，2026-08-21 实测）」一节）：
//   本 harness 只对少数「可信前缀」命令解除文件沙箱：git / node / npm / pnpm /
//   hython / .venv\scripts\python。`pwsh` 不在其中——一旦命令的首个 token 是
//   `pwsh`，整个进程受限，它 spawn 出的子进程（即便自身在可信前缀名单里）
//   继承这个限制。所以任何要 spawn 子进程的编排脚本必须让首个 token 落在
//   可信前缀上：`node scripts/release-step.mjs`，而不是
//   `pwsh -File scripts\release-step.ps1`。
//
// 为什么 runStep 里有「参数数组非空」这条断言：
//   旧版 scripts/release-step.ps1 的辅助函数写成
//     function Invoke-NodeStep([string]$Label, [string[]]$Args) { ... & node @Args ... }
//   `$Args` 是 PowerShell 的自动变量，当成参数名声明会被同名遮蔽成空数组，于是
//   `& node @Args` 实际变成裸 `& node`。裸 `node`（无参数、无 stdin）在非交互环境下
//   直接 exit 0——所以每一步都「成功」了，但版本号没变、索引一个都没重新生成，是一次
//   完整的「谎报成功」。本脚本的 runStep 因此把「参数数组非空」列为独立于 exitCode 的
//   判定条件：就算某天再手滑传出一个空数组，也会在还没 spawn 子进程之前就直接抛错，
//   而不是悄悄跑出一个 exit 0 的裸调用。
//
// 做什么（与旧 .ps1 同序）：
//   1. node scripts/bump-version.mjs build（daily++）
//   2. 回读 bridge/bridge/protocol.py 与 web/src/app/app-config.ts 的新版本号，断言一致
//   3. 除非 --no-index：重生成三份索引（gen-index / gen-api-index / gen-graph）
//   4. 就地改写 devlog/AGENT_QUICKSTART.md 的「当前焦点」标题行与「测试基线」行版本号
//      （若提供 --pytest=<N>/--vitest=<N>，同时替换该行内的这两个数字，其余字符原样保留），
//      写回 UTF-8 无 BOM 并校验
//   5. 打印本版本对应的提交说明文件路径（约定：$TEMP\cyl1nder-commit-<NNNNN>.txt），
//      提示该文件是否已存在
//   6. 全部成功 exit 0
//
// 不做什么：不写提交说明正文，不 git commit —— 那句话是人/主智能体的事。
//
// 退出码：0 成功 / 1 真实失败（版本号不一致、找不到目标行、BOM 检查失败）/
//         3 工具没跑起来（result.error、result.status===null，或参数数组为空）。

"use strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const protocolPy = path.join(root, "bridge", "bridge", "protocol.py");
const appConfigTs = path.join(root, "web", "src", "app", "app-config.ts");
const quickstartPath = path.join(root, "devlog", "AGENT_QUICKSTART.md");

const argv = process.argv.slice(2);
const noIndex = argv.includes("--no-index");

function getIntArg(name) {
  const prefix = `--${name}=`;
  const found = argv.find((a) => a.startsWith(prefix));
  if (!found) return undefined;
  const v = Number.parseInt(found.slice(prefix.length), 10);
  if (!Number.isFinite(v)) {
    console.error(`FATAL —— --${name} 参数不是合法整数：${found}`);
    process.exit(1);
  }
  return v;
}

const pytestCount = getIntArg("pytest");
const vitestCount = getIntArg("vitest");

const COLORS = { red: "31", green: "32", yellow: "33", cyan: "36", white: "37" };
function colorLine(text, color) {
  const code = COLORS[color] || COLORS.white;
  return `\u001b[${code}m${text}\u001b[0m`;
}
function heading(title) {
  console.log("");
  console.log(colorLine(title, "cyan"));
}

// 运行一个外部命令，返回统一的判定结果。判定成功必须同时满足三件事：
//   1. result.error 为空（可执行文件确实存在、能被 spawn）
//   2. result.status === 0（进程正常退出且返回码为 0）
//   3. args.length > 0（见文件头「为什么有这条断言」）——这一条独立检查，
//      不依赖 spawnSync 的返回值，因为空参数数组本身就是致命的调用错误，
//      不该等到跑完子进程才发现。
// 任何一条不满足都归为 TOOLFAIL（工具没跑起来/调用本身有错），与「跑起来了
// 但报告了失败」（exitCode !== 0，属于 FAIL）严格区分。
export function runStep(label, cmd, args, opts) {
  if (!Array.isArray(args) || args.length === 0) {
    console.log(
      colorLine(
        `TOOL FAILURE —— ${label} 的参数数组为空（很可能是变量名遮蔽之类的调用错误，` +
          `见文件头注释），拒绝以裸命令形式静默"成功"`,
        "red"
      )
    );
    return { toolFail: true, exitCode: null, error: new Error("empty args array") };
  }
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  if (result.error || result.status === null) {
    return { toolFail: true, exitCode: null, error: result.error };
  }
  return { toolFail: false, exitCode: result.status, error: null };
}

function runNodeStep(label, args, opts) {
  heading(`-- ${label} --`);
  const r = runStep(label, process.execPath, args, opts);
  if (r.toolFail) {
    console.log(
      colorLine(
        `TOOL FAILURE —— ${label} 无法执行：${r.error ? r.error.message : "进程未正常退出"}`,
        "red"
      )
    );
    process.exit(3);
  }
  if (r.exitCode !== 0) {
    console.log(colorLine(`TOOL FAILURE —— ${label} 退出码 ${r.exitCode}`, "red"));
    process.exit(3);
  }
}

// 就地改写「当前焦点」标题行与「测试基线」行的版本号（及可选的 pytest/vitest 数字）。
// 抽成可单独 import 的纯函数：不碰文件系统，方便在隔离副本上做行替换验证，不必真跑
// bump-version 就能测试这部分逻辑。
//
// lines: string[]（不含行尾换行符）
// version: 完整版本号字符串，如 "0.1.00172"
// pytest / vitest: number | undefined —— undefined 表示不替换该数字
// 返回：{ lines: string[], focusIdx: number, baselineIdx: number,
//         oldFocusLine, newFocusLine, oldBaselineLine, newBaselineLine }
// 找不到目标行时抛错（由调用方决定如何 exit）。
export function rewriteQuickstartLines(lines, version, pytest, vitest) {
  const dailyNum = version.split(".")[2];

  const focusPattern = /^## 当前焦点（v0\.1\.\d+/;
  const focusIdx = lines.findIndex((l) => focusPattern.test(l));
  if (focusIdx < 0) {
    throw new Error(
      `在 AGENT_QUICKSTART.md 中找不到「当前焦点」标题行（模式：${focusPattern})`
    );
  }
  const oldFocusLine = lines[focusIdx];
  const newFocusLine = oldFocusLine.replace(/v0\.1\.\d+/, `v0.1.${dailyNum}`);

  const baselinePattern = /^- 测试基线（v0\.1\.\d+/;
  const baselineIdx = lines.findIndex((l) => baselinePattern.test(l));
  if (baselineIdx < 0) {
    throw new Error(
      `在 AGENT_QUICKSTART.md 中找不到「测试基线」项目符号行（模式：${baselinePattern})`
    );
  }
  const oldBaselineLine = lines[baselineIdx];
  let newBaselineLine = oldBaselineLine.replace(/v0\.1\.\d+/, `v0.1.${dailyNum}`);
  if (pytest !== undefined) {
    newBaselineLine = newBaselineLine.replace(/pytest \*\*\d+\*\*/, `pytest **${pytest}**`);
  }
  if (vitest !== undefined) {
    newBaselineLine = newBaselineLine.replace(/vitest \*\*\d+\*\*/, `vitest **${vitest}**`);
  }

  const newLines = lines.slice();
  newLines[focusIdx] = newFocusLine;
  newLines[baselineIdx] = newBaselineLine;

  return {
    lines: newLines,
    focusIdx,
    baselineIdx,
    oldFocusLine,
    newFocusLine,
    oldBaselineLine,
    newBaselineLine,
  };
}

// 主流程包进 main()，用「是否被直接执行」而不是「是否被 import」来决定是否跑，
// 这样验证脚本可以 `import { rewriteQuickstartLines } from "./release-step.mjs"`
// 而不会顺带触发 bump-version / gen-index 等副作用步骤。
function main() {
// ---- 1/6 bump-version ----
heading("== 1/6 bump-version ==");
runNodeStep("bump-version", ["scripts/bump-version.mjs", "build"], { cwd: root });

// ---- 2/6 校验版本号一致 ----
heading("== 2/6 校验版本号一致 ==");
const protocolContent = fs.readFileSync(protocolPy, "utf8");
const appConfigContent = fs.readFileSync(appConfigTs, "utf8");
const mProtocol = protocolContent.match(/VERSION = "([^"]+)"/);
const mAppConfig = appConfigContent.match(/APP_VERSION = "([^"]+)"/);
if (!mProtocol) {
  console.log(colorLine("TOOL FAILURE —— protocol.py 中找不到 VERSION", "red"));
  process.exit(3);
}
if (!mAppConfig) {
  console.log(colorLine("TOOL FAILURE —— app-config.ts 中找不到 APP_VERSION", "red"));
  process.exit(3);
}
const verProtocol = mProtocol[1];
const verAppConfig = mAppConfig[1];
if (verProtocol !== verAppConfig) {
  console.log(
    colorLine(
      `FAIL —— 版本号不一致：protocol.py=${verProtocol} / app-config.ts=${verAppConfig}`,
      "red"
    )
  );
  process.exit(1);
}
const version = verProtocol;
console.log(colorLine(`版本号：${version}`, "green"));

// ---- 3/6 重生成索引 ----
if (!noIndex) {
  heading("== 3/6 重生成索引 ==");
  runNodeStep("gen-index", ["scripts/gen-index.mjs"], { cwd: root });
  runNodeStep("gen-api-index", ["scripts/gen-api-index.mjs"], { cwd: root });
  runNodeStep("gen-graph", ["scripts/gen-graph.mjs"], { cwd: root });
} else {
  heading("== 3/6 跳过索引重生成（--no-index） ==");
}

// ---- 4/6 更新 AGENT_QUICKSTART.md ----
heading("== 4/6 更新 AGENT_QUICKSTART.md ==");
const quickstartRaw = fs.readFileSync(quickstartPath, "utf8");
const eol = quickstartRaw.includes("\r\n") ? "\r\n" : "\n";
const quickstartLines = quickstartRaw.split(/\r\n|\n/);
// split 会在末尾多产生一个空字符串（若文件以换行符结尾），保留原状供 join 还原。

let rewrite;
try {
  rewrite = rewriteQuickstartLines(quickstartLines, version, pytestCount, vitestCount);
} catch (err) {
  console.log(colorLine(`FAIL —— ${err.message}`, "red"));
  process.exit(1);
}

console.log(colorLine(`焦点行  旧：${rewrite.oldFocusLine}`, "white"));
console.log(colorLine(`焦点行  新：${rewrite.newFocusLine}`, "white"));
console.log(colorLine(`基线行  旧：${rewrite.oldBaselineLine}`, "white"));
console.log(colorLine(`基线行  新：${rewrite.newBaselineLine}`, "white"));

const newQuickstartText = rewrite.lines.join(eol);
fs.writeFileSync(quickstartPath, newQuickstartText, "utf8");

const writtenBytes = fs.readFileSync(quickstartPath);
if (
  writtenBytes.length >= 3 &&
  writtenBytes[0] === 0xef &&
  writtenBytes[1] === 0xbb &&
  writtenBytes[2] === 0xbf
) {
  console.log(colorLine("FAIL —— 写回后仍带 BOM", "red"));
  process.exit(1);
}
console.log(colorLine("AGENT_QUICKSTART.md 已写回，UTF-8 无 BOM 确认通过", "green"));

// ---- 5/6 提交说明文件路径 ----
heading("== 5/6 提交说明文件路径 ==");
const dailyNum = version.split(".")[2];
const commitMsgPath = path.join(os.tmpdir(), `cyl1nder-commit-${dailyNum}.txt`);
if (fs.existsSync(commitMsgPath)) {
  console.log(colorLine(`提交说明文件已存在：${commitMsgPath}`, "yellow"));
} else {
  console.log(colorLine(`提交说明文件尚不存在，需要创建：${commitMsgPath}`, "yellow"));
}
console.log(
  colorLine("（本脚本不写正文，也不 commit —— 消息内容由操作者/主智能体撰写）", "white")
);

// ---- 6/6 完成 ----
heading("== 6/6 完成 ==");
console.log(colorLine("完成", "green"));
process.exit(0);
}

const isMain = path.resolve(process.argv[1] ?? "") === __filename;
if (isMain) {
  main();
}

