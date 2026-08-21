#!/usr/bin/env node
// retro-count.mjs — 固化「产品文件 vs 元文件」提交分类计数，供止损判据
// （devlog/agent-calibration.md：「连续两轮 product=0 → 下一轮必须做产品工作」）使用。
//
// 为什么是 .mjs 而不是 .ps1（与 verify-all.mjs / commit-step.mjs 同因，不重复整段论证）：
//   本 harness 只对少数「可信前缀」命令解除文件沙箱：git / node / npm / pnpm /
//   hython / .venv\scripts\python，`pwsh` 不在名单里。一旦顶层命令首个 token 是
//   `pwsh`，它 spawn 出的子进程会继承沙箱限制。编排脚本必须让首个 token 落在
//   可信前缀上：`node scripts/retro-count.mjs`。
//
// 分类判据的定义（这是判据本身，不是实现细节；改判据要同步
// devlog/agent-calibration.md 里的止损条款，不能只改这里）：
//   product：路径以 bridge/ web/src/ web/tests/ web/e2e/ hda/ 开头，
//            但排除两个纯版本号文件：bridge/bridge/protocol.py、
//            web/src/app/app-config.ts —— 它们几乎每个提交都变（版本号 + 索引），
//            计入会让每一轮都显得有产品改动，把止损判据废掉。
//            已知偏差（宁可低估 product，不要高估）：protocol.py 有时确实携带
//            真实协议改动，本脚本无法区分“这次只改了版本号”和“版本号 + 协议
//            改动同框”，所以一律排除，不做区分。
//   meta：路径以 devlog/ scripts/ 开头，或等于 AGENTS.md。
//   other：其余（如 web/package.json、web/vendor/，以及被排除的两个版本号文件），
//          单独一列，不参与 meta/product 的 ratio 计算。
//
// git 输出读取方式（照抄 commit-step.mjs 的 runGitCapture，实测结论见该文件头部，
// 不重复整段论证）：spawnSync 对 git 用默认 'pipe' 会 EPERM；必须把 stdio 的 fd1
// 换成一个真实文件的文件描述符（fs.openSync 打开 os.tmpdir() 下的临时文件），
// 读完立即 fs.rmSync 删除——临时文件绝不放仓库内，否则会被 git add -A 扫进提交。
//
// pathspec 陷阱：`--` 之后的一切都是 pathspec，`--output=` 放在 `--` 后面会被当
// 路径静默失效。本脚本所有 git 选项都在潜在的 `--` 之前给出，且不使用
// `--output=`（那只对少数子命令有效），改用上面的 fd 重定向读文本。
//
// 退出码：0 streak<2（未触发止损）／1 streak>=2（触发止损，打印止损结论，
// 故意用 exit 1 让它可当门禁用：`node scripts/retro-count.mjs && ...`）／
// 3 工具自身失败（git 跑不起来、拿不到提交列表）。
//
// 全程只用同步 spawnSync 与同步 fs 调用，没有引入任何异步操作，收尾用
// process.exit() 是安全的。如果未来给本脚本加了异步逻辑，必须改回
// process.exitCode（理由见 commit-step.mjs 同一条注释，不重复）。
//
// Usage: node scripts/retro-count.mjs [--last=N] [--since=<git-ref>]
//   缺省 --last=10；--since 给了就用 <ref>..HEAD 的全部提交；两者都给时以
//   --since 为准并打印提示。

"use strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);

function getStrArg(name) {
  const prefix = `--${name}=`;
  const found = argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const lastArg = getStrArg("last");
const sinceArg = getStrArg("since");

const COLORS = { red: "31", green: "32", yellow: "33", cyan: "36", white: "37" };
function colorLine(text, color) {
  const code = COLORS[color] || COLORS.white;
  return `\u001b[${code}m${text}\u001b[0m`;
}

// 读取一个 git 子命令的文本输出：把 fd1 重定向到一个真实临时文件（不是管道），
// 跑完立即读回并删除。照抄 commit-step.mjs 的 runGitCapture，实测结论见该
// 文件头部，这里不重复整段论证。
function runGitCapture(args) {
  const tmpFile = path.join(
    os.tmpdir(),
    `cyl-retro-count-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  );
  const fd = fs.openSync(tmpFile, "w");
  let result;
  try {
    result = spawnSync("git", args, { stdio: ["ignore", fd, "ignore"], shell: false });
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

function toolFailExit(step, r) {
  console.log(
    colorLine(
      `TOOL FAILURE —— ${step} 无法执行：${r.error ? r.error.message : `git 退出码 ${r.exitCode}`}`,
      "red"
    )
  );
  process.exit(3);
}

// ---- 分类判据（见文件头「分类判据的定义」，这里只是实现） ----
const PRODUCT_PREFIXES = ["bridge/", "web/src/", "web/tests/", "web/e2e/", "hda/"];
const META_PREFIXES = ["devlog/", "scripts/"];
const META_EXACT = new Set(["AGENTS.md"]);
const VERSION_FILE_EXCLUSIONS = new Set([
  "bridge/bridge/protocol.py",
  "web/src/app/app-config.ts",
]);

function classifyFile(filePath) {
  if (VERSION_FILE_EXCLUSIONS.has(filePath)) return "other";
  if (PRODUCT_PREFIXES.some((p) => filePath.startsWith(p))) return "product";
  if (META_PREFIXES.some((p) => filePath.startsWith(p))) return "meta";
  if (META_EXACT.has(filePath)) return "meta";
  return "other";
}

// 提交主题行截断：按码点数（Array.from 按 Unicode 码点迭代，不是 UTF-16 code
// unit），中文/多字节字符各算 1 个单位；超出用 … 结尾。
function truncateSubject(subject, maxCodepoints = 40) {
  const codepoints = Array.from(subject);
  if (codepoints.length <= maxCodepoints) return subject;
  return codepoints.slice(0, maxCodepoints).join("") + "…";
}

// ---- 1. 确定提交范围 ----
let rangeArgs;
let rangeNotice = null;
if (sinceArg && lastArg) {
  rangeNotice = `--since 与 --last 同时给出，以 --since=${sinceArg} 为准，忽略 --last=${lastArg}`;
}
if (sinceArg) {
  rangeArgs = [`${sinceArg}..HEAD`];
} else {
  const n = lastArg !== undefined ? Number(lastArg) : 10;
  if (!Number.isInteger(n) || n <= 0) {
    console.log(colorLine(`FAIL —— --last 必须是正整数，收到：${lastArg}`, "red"));
    process.exit(3);
  }
  rangeArgs = ["-n", String(n)];
}

if (rangeNotice) {
  console.log(colorLine(rangeNotice, "yellow"));
}

// ---- 2. 取提交列表（hash + subject） ----
const SEP = "\u001f"; // Unit Separator，提交主题里几乎不可能出现
const logR = runGitCapture(["log", `--format=%h${SEP}%s`, ...rangeArgs]);
if (logR.toolFail || logR.exitCode !== 0) {
  toolFailExit("git log（取提交列表）", logR);
}

const logLines = logR.text.split(/\r\n|\n/).filter((l) => l.length > 0);
if (logLines.length === 0) {
  console.log(colorLine("FAIL —— 指定范围内没有提交", "red"));
  process.exit(3);
}

const commits = logLines.map((line) => {
  const idx = line.indexOf(SEP);
  return { hash: line.slice(0, idx), subject: line.slice(idx + 1) };
});

// ---- 3. 逐提交取改动文件名并分类 ----
console.log("");
console.log(colorLine(`== 逐提交（${commits.length} 个，最新在前） ==`, "cyan"));

let totalProduct = 0;
let totalMeta = 0;
let totalOther = 0;
const rows = [];

for (const c of commits) {
  const showR = runGitCapture(["show", "--name-only", "--format=", c.hash]);
  if (showR.toolFail || showR.exitCode !== 0) {
    toolFailExit(`git show --name-only（提交 ${c.hash}）`, showR);
  }
  const files = showR.text.split(/\r\n|\n/).filter((l) => l.length > 0);

  let product = 0;
  let meta = 0;
  let other = 0;
  for (const f of files) {
    const kind = classifyFile(f);
    if (kind === "product") product++;
    else if (kind === "meta") meta++;
    else other++;
  }

  totalProduct += product;
  totalMeta += meta;
  totalOther += other;
  rows.push({ hash: c.hash, subject: c.subject, product, meta, other });

  const shortSubject = truncateSubject(c.subject, 40);
  console.log(`  ${c.hash}  product=${product} meta=${meta} other=${other}  ${shortSubject}`);
}

// ---- 4. streak：从最新提交（rows[0]）往回数，连续 product=0 的条数 ----
let streak = 0;
for (const row of rows) {
  if (row.product === 0) streak++;
  else break;
}

// ---- 5. 汇总 ----
console.log("");
console.log(colorLine("== 汇总 ==", "cyan"));
console.log(`  product 总数：${totalProduct}`);
console.log(`  meta    总数：${totalMeta}`);
const ratio = totalProduct === 0 ? "∞" : (totalMeta / totalProduct).toFixed(2) + "x";
console.log(`  ratio (meta/product)：${ratio}`);
console.log(`  other   总数：${totalOther}（不参与 ratio）`);
console.log(
  colorLine(
    "  已知偏差：bridge/bridge/protocol.py 与 web/src/app/app-config.ts 一律排除出 product" +
      "（即使 protocol.py 本次确实携带真实协议改动，也无法与纯版本号改动区分，宁可低估）。",
    "yellow"
  )
);
console.log("");
console.log(
  colorLine(
    `streak（从最新提交往回连续 product=0 的条数）：${streak}`,
    streak >= 2 ? "red" : "green"
  )
);

// ---- 6. 退出码 ----
if (streak >= 2) {
  console.log("");
  console.log(
    colorLine(
      `止损线触发：最近 ${streak} 个提交没有产品改动。下一轮必须做产品工作，固化/文档想法进待办队列排队。`,
      "red"
    )
  );
  process.exit(1);
} else {
  console.log("");
  console.log(colorLine("streak < 2，未触发止损", "green"));
  process.exit(0);
}
