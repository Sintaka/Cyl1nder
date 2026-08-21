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
// 做什么（步骤编号已从旧版的 1/7~7/7 调整为 1/8~8/8，因为加入了「7/8 磁盘落地
// 自检」这一步——见该步骤上方的详细注释与 verifyVersionLanded 函数）：
//   1. node scripts/bump-version.mjs build（daily++）
//   2. 回读 bridge/bridge/protocol.py 与 web/src/app/app-config.ts 的新版本号，断言一致
//   3. 除非 --no-index：重生成三份索引（gen-index / gen-api-index / gen-graph）
//   4. 就地改写 devlog/AGENT_QUICKSTART.md 的「当前焦点」标题行与「测试基线」行版本号
//      （若提供 --pytest=<N>/--vitest=<N>，同时替换该行内的这两个数字，其余字符原样保留），
//      写回 UTF-8 无 BOM 并校验
//   5. 就地改写 devlog/in-progress.md 的「进行中任务与剩余评估」标题行版本号，
//      写回 UTF-8 无 BOM 并校验（各自探测行尾，不与 quickstart 共用——in-progress.md
//      是 bare LF，quickstart 是 CRLF，两者独立保留）
//   6. 打印本版本对应的提交说明文件路径（约定：$TEMP\cyl1nder-commit-<NNNNN>.txt），
//      提示该文件是否已存在
//   7. 磁盘落地自检：重新从磁盘读取上面四个位置的版本号，断言与本次新版本一致；
//      除非 --no-index，还会检查三份索引文件的 mtime 是否不早于本次脚本启动时刻，
//      确认它们真的被重生成过（而不是 gen-index 等步骤报告 exit 0 但没有实际写盘）
//   8. 全部成功 exit 0
//
// 不做什么：不写提交说明正文，不 git commit —— 那句话是人/主智能体的事。
//
// 退出码：0 成功 / 1 真实失败（版本号不一致、找不到目标行、BOM 检查失败、
//         磁盘落地自检 MISMATCH）/
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
const inProgressPath = path.join(root, "devlog", "in-progress.md");
const functionIndexPath = path.join(root, "devlog", "FUNCTION_INDEX.md");
const apiIndexPath = path.join(root, "devlog", "API_INDEX.md");
const moduleGraphPath = path.join(root, "devlog", "MODULE_GRAPH.md");

// 自检第 4 条（索引重写）要判定「索引文件的 mtime 有没有晚于本次脚本启动」，
// 所以必须在跑任何步骤之前就把启动时刻记下来——记在 main() 内部会晚于模块加载，
// 记在这里（模块顶层，import 时就执行）才能保证比第一步 bump-version 还早。
const startedAt = Date.now();

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

// 就地改写 in-progress.md 的标题行版本号。与 rewriteQuickstartLines 同一套思路：
// 抽成不碰文件系统的纯函数，方便在隔离副本上单独测试行替换逻辑。
//
// lines: string[]（不含行尾换行符）
// version: 完整版本号字符串，如 "0.1.00172"
// 返回：{ lines: string[], headerIdx: number, oldHeaderLine, newHeaderLine }
// 找不到目标行时抛错（由调用方决定如何 exit）——不能静默跳过。
export function rewriteInProgressHeader(lines, version) {
  const dailyNum = version.split(".")[2];

  const headerPattern = /^# 进行中任务与剩余评估（v0\.1\.\d+/;
  const headerIdx = lines.findIndex((l) => headerPattern.test(l));
  if (headerIdx < 0) {
    throw new Error(
      `在 in-progress.md 中找不到「进行中任务与剩余评估」标题行（模式：${headerPattern})`
    );
  }
  const oldHeaderLine = lines[headerIdx];
  const newHeaderLine = oldHeaderLine.replace(/v0\.1\.\d+/, `v0.1.${dailyNum}`);

  const newLines = lines.slice();
  newLines[headerIdx] = newHeaderLine;

  return {
    lines: newLines,
    headerIdx,
    oldHeaderLine,
    newHeaderLine,
  };
}

// 诚实说明（写在自检段上方，中文，针对的是下面这个具体函数）：
// 这段自检解决的是旧版 release-step.ps1 那个具体失败模式——工具报告成功
//（exit 0、打印「N/N 完成」），但磁盘上什么都没变（本文件头注释里那个
// `$Args` 被自动变量遮蔽、`& node @Args` 退化成裸 `& node` 的故事）。
// 它能接住的是「写入步骤本身没有发生」：bump-version 没跑、write 没落盘、
// 半路 crash 但没人看 exit code 之类。
// 它接不住的是「工具系统性地写错」：本函数用来读取四个位置版本号的正则，
// 与 main() 里写入时用的是**同一套**正则/同一批文件路径常量。如果哪天
// protocol.py 的 VERSION 声明格式变了、或者写入逻辑本身的替换规则错了
// （比如把 dailyNum 算错），自检和写入会用同一个错误假设去读/写同一处，
// 结果是「自检也认为一致」——两边同错，同错则同盲，不是独立见证。
// 换句话说：这是「确认写入这一步真的执行了」的自检，不是「确认写入的内容
// 逻辑正确」的自检，更不是能替代人工 review diff 的万能保险。
export function verifyVersionLanded(paths, expectedVersion) {
  const results = [];

  function pushResult(label, filePath, actual) {
    results.push({
      label,
      path: filePath,
      actual,
      expected: expectedVersion,
      ok: actual === expectedVersion,
    });
  }

  // 从形如 "v0.1.176" 或 "0.1.00176" 的片段里抽出 daily 号，拼回完整版本号
  // "0.1.<daily>"——与 rewriteQuickstartLines/rewriteInProgressHeader 里
  // 构造新行时的逻辑保持同一套假设（major.minor 恒为 0.1）。
  function dailyToVersion(dailyNum) {
    return `0.1.${dailyNum}`;
  }

  // 1. protocol.py 的 VERSION
  try {
    const content = fs.readFileSync(paths.protocolPy, "utf8");
    const m = content.match(/VERSION = "([^"]+)"/);
    pushResult("bridge/bridge/protocol.py VERSION", paths.protocolPy, m ? m[1] : null);
  } catch (err) {
    pushResult("bridge/bridge/protocol.py VERSION", paths.protocolPy, `<读取失败：${err.message}>`);
  }

  // 2. app-config.ts 的 APP_VERSION
  try {
    const content = fs.readFileSync(paths.appConfigTs, "utf8");
    const m = content.match(/APP_VERSION = "([^"]+)"/);
    pushResult("web/src/app/app-config.ts APP_VERSION", paths.appConfigTs, m ? m[1] : null);
  } catch (err) {
    pushResult("web/src/app/app-config.ts APP_VERSION", paths.appConfigTs, `<读取失败：${err.message}>`);
  }

  // 3. AGENT_QUICKSTART.md 的「当前焦点」标题行
  try {
    const content = fs.readFileSync(paths.quickstartPath, "utf8");
    const lines = content.split(/\r\n|\n/);
    const focusLine = lines.find((l) => /^## 当前焦点（v0\.1\.\d+/.test(l));
    const m = focusLine ? focusLine.match(/v0\.1\.(\d+)/) : null;
    pushResult(
      "devlog/AGENT_QUICKSTART.md 「当前焦点」标题行",
      paths.quickstartPath,
      m ? dailyToVersion(m[1]) : null
    );
  } catch (err) {
    pushResult(
      "devlog/AGENT_QUICKSTART.md 「当前焦点」标题行",
      paths.quickstartPath,
      `<读取失败：${err.message}>`
    );
  }

  // 4. AGENT_QUICKSTART.md 的「测试基线」项目符号行
  try {
    const content = fs.readFileSync(paths.quickstartPath, "utf8");
    const lines = content.split(/\r\n|\n/);
    const baselineLine = lines.find((l) => /^- 测试基线（v0\.1\.\d+/.test(l));
    const m = baselineLine ? baselineLine.match(/v0\.1\.(\d+)/) : null;
    pushResult(
      "devlog/AGENT_QUICKSTART.md 「测试基线」行",
      paths.quickstartPath,
      m ? dailyToVersion(m[1]) : null
    );
  } catch (err) {
    pushResult(
      "devlog/AGENT_QUICKSTART.md 「测试基线」行",
      paths.quickstartPath,
      `<读取失败：${err.message}>`
    );
  }

  // 5. in-progress.md 的「进行中任务与剩余评估」标题行
  try {
    const content = fs.readFileSync(paths.inProgressPath, "utf8");
    const lines = content.split(/\r\n|\n/);
    const headerLine = lines.find((l) => /^# 进行中任务与剩余评估（v0\.1\.\d+/.test(l));
    const m = headerLine ? headerLine.match(/v0\.1\.(\d+)/) : null;
    pushResult(
      "devlog/in-progress.md 「进行中任务与剩余评估」标题行",
      paths.inProgressPath,
      m ? dailyToVersion(m[1]) : null
    );
  } catch (err) {
    pushResult(
      "devlog/in-progress.md 「进行中任务与剩余评估」标题行",
      paths.inProgressPath,
      `<读取失败：${err.message}>`
    );
  }

  return results;
}

// 打印 verifyVersionLanded 的结果为一张对齐的小表，返回是否全部 OK。
// 抽成独立函数是因为 main() 与验证脚本都需要同样的打印格式。
export function printVerifyTable(results) {
  const labelWidth = Math.max(...results.map((r) => r.label.length), 10);
  heading("== 磁盘落地自检结果 ==");
  for (const r of results) {
    const status = r.ok ? colorLine("OK", "green") : colorLine("MISMATCH", "red");
    console.log(`${r.label.padEnd(labelWidth, "\u3000")}  读到：${String(r.actual)}  预期：${r.expected}  ${status}`);
  }
  return results.every((r) => r.ok);
}

// 主流程包进 main()，用「是否被直接执行」而不是「是否被 import」来决定是否跑，
// 这样验证脚本可以 `import { rewriteQuickstartLines } from "./release-step.mjs"`
// 而不会顺带触发 bump-version / gen-index 等副作用步骤。
function main() {
// ---- 1/8 bump-version ----
heading("== 1/8 bump-version ==");
runNodeStep("bump-version", ["scripts/bump-version.mjs", "build"], { cwd: root });

// ---- 2/8 校验版本号一致 ----
heading("== 2/8 校验版本号一致 ==");
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

// ---- 3/8 重生成索引 ----
if (!noIndex) {
  heading("== 3/8 重生成索引 ==");
  runNodeStep("gen-index", ["scripts/gen-index.mjs"], { cwd: root });
  runNodeStep("gen-api-index", ["scripts/gen-api-index.mjs"], { cwd: root });
  runNodeStep("gen-graph", ["scripts/gen-graph.mjs"], { cwd: root });
} else {
  heading("== 3/8 跳过索引重生成（--no-index） ==");
}

// ---- 4/8 更新 AGENT_QUICKSTART.md ----
heading("== 4/8 更新 AGENT_QUICKSTART.md ==");
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

// ---- 5/8 更新 devlog/in-progress.md ----
heading("== 5/8 更新 devlog/in-progress.md ==");
// in-progress.md 与 quickstart 是两个独立文件，各自读取、各自探测行尾，不共用
// 上面探测出的 eol —— 这两个文件实测行尾风格不同（in-progress.md 是 bare LF，
// quickstart 是 CRLF），共用会把其中一个文件的行尾整体改写，在 diff 里造成
// 与本次改动无关的全量行变动，淹掉真实改动。
const inProgressRaw = fs.readFileSync(inProgressPath, "utf8");
const inProgressEol = inProgressRaw.includes("\r\n") ? "\r\n" : "\n";
const inProgressLines = inProgressRaw.split(/\r\n|\n/);

let inProgressRewrite;
try {
  inProgressRewrite = rewriteInProgressHeader(inProgressLines, version);
} catch (err) {
  console.log(colorLine(`FAIL —— ${err.message}`, "red"));
  process.exit(1);
}

console.log(colorLine(`in-progress 标题行  旧：${inProgressRewrite.oldHeaderLine}`, "white"));
console.log(colorLine(`in-progress 标题行  新：${inProgressRewrite.newHeaderLine}`, "white"));

const newInProgressText = inProgressRewrite.lines.join(inProgressEol);
fs.writeFileSync(inProgressPath, newInProgressText, "utf8");

const writtenInProgressBytes = fs.readFileSync(inProgressPath);
if (
  writtenInProgressBytes.length >= 3 &&
  writtenInProgressBytes[0] === 0xef &&
  writtenInProgressBytes[1] === 0xbb &&
  writtenInProgressBytes[2] === 0xbf
) {
  console.log(colorLine("FAIL —— in-progress.md 写回后仍带 BOM", "red"));
  process.exit(1);
}
console.log(colorLine("in-progress.md 已写回，UTF-8 无 BOM 确认通过", "green"));

// ---- 6/8 提交说明文件路径 ----
heading("== 6/8 提交说明文件路径 ==");
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

// ---- 7/8 磁盘落地自检 ----
// 见上方 verifyVersionLanded 函数上的诚实说明注释：这一步只能接住「写入没
// 发生」，接不住「写入逻辑本身系统性写错」（自检与写入同源同正则）。
// 它专门对治旧版 release-step.ps1 的那个具体失败模式——报告成功、磁盘未变。
heading("== 7/8 磁盘落地自检 ==");
const verifyPaths = { protocolPy, appConfigTs, quickstartPath, inProgressPath };
const verifyResults = verifyVersionLanded(verifyPaths, version);
const verifyOk = printVerifyTable(verifyResults);
if (!verifyOk) {
  console.log(
    colorLine(
      "FAIL —— 磁盘落地自检发现不一致：脚本此前的每一步都打印了「成功」，" +
        "但重新从磁盘读回的版本号与本次 bump 出来的新版本号不符。" +
        "这正是旧版 release-step.ps1 那个 bug 的形状——" +
        "「脚本报告成功但磁盘未按预期改变」——不是本次改写内容有问题，" +
        "就是某一步的写入实际没有落盘。",
      "red"
    )
  );
  process.exit(1);
}
console.log(colorLine("磁盘落地自检通过：四处版本号均已写入磁盘并与本次新版本一致", "green"));

// 索引 mtime 自检：实测结论（连续跑两次 gen-index.mjs / gen-graph.mjs /
// gen-api-index.mjs，见验证记录）——三者的 generatedAt 都用 `new Date()`
// 现算并写进输出，从不比较旧内容是否相同，所以**从不跳过写入**，每次都会
// 真的 writeFileSync、mtime 每次都前进。因此这里按「MISMATCH 就 exit 1」的
// 硬性判定实现，不用降级为警告（若未来这三个脚本改成了内容不变即跳过写入，
// 这条判定需要跟着放宽为「文件存在且 mtime 不早于本次启动」或降级为警告）。
heading("== 索引 mtime 自检 ==");
if (!noIndex) {
  const indexPaths = [
    { label: "devlog/FUNCTION_INDEX.md", filePath: functionIndexPath },
    { label: "devlog/API_INDEX.md", filePath: apiIndexPath },
    { label: "devlog/MODULE_GRAPH.md", filePath: moduleGraphPath },
  ];
  let indexOk = true;
  for (const { label, filePath } of indexPaths) {
    if (!fs.existsSync(filePath)) {
      console.log(colorLine(`FAIL —— ${label} 不存在`, "red"));
      indexOk = false;
      continue;
    }
    const mtimeMs = fs.statSync(filePath).mtimeMs;
    const ok = mtimeMs >= startedAt;
    console.log(
      `${label.padEnd(28, "\u3000")}  mtime：${new Date(mtimeMs).toISOString()}  ` +
        `启动：${new Date(startedAt).toISOString()}  ${ok ? colorLine("OK", "green") : colorLine("MISMATCH", "red")}`
    );
    if (!ok) indexOk = false;
  }
  if (!indexOk) {
    console.log(
      colorLine(
        "FAIL —— 索引脚本报告成功但文件没被重写（mtime 早于本次 release-step 启动时刻）",
        "red"
      )
    );
    process.exit(1);
  }
  console.log(colorLine("三份索引 mtime 均不早于本次启动，确认已被重写", "green"));
} else {
  console.log(colorLine("--no-index 已传入，跳过索引 mtime 自检", "yellow"));
}

// ---- 8/8 完成 ----
heading("== 8/8 完成 ==");
console.log(colorLine("完成", "green"));
process.exit(0);
}

const isMain = path.resolve(process.argv[1] ?? "") === __filename;
if (isMain) {
  main();
}

