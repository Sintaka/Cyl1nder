// check-hygiene.mjs — 统一卫生检查（取代 check-staged.ps1）
//
// 用法：
//   node scripts/check-hygiene.mjs            # 默认：staged + 工作树 BOM，静默通过
//   node scripts/check-hygiene.mjs --verbose   # 通过时也打印扫描量
//
// 退出码（与本仓其他脚本一致）：
//   0 = 干净   1 = 发现问题   2 = VACUOUS（无内容可查，不构成通过）   3 = 工具自身失败
//
// 为什么是 .mjs：`pwsh` 不在 harness 可信前缀名单里（只有 git/node/npm/pnpm/hython/
// .venv\scripts\python），`.ps1` 里 spawn 子进程会继承沙箱限制。详见 sandbox-env-facts.md。
//
// 为什么默认静默：这个检查每轮收尾都要跑，通过时它的输出对主脑毫无信息量，
// 只是白烧上下文。**有问题就报，没问题不吭声** —— 退出码是给机器看的，
// 文字是给人看的，通过时没有人需要读任何东西。
//
// 判据必须精确到「红了就一定有事」，否则会被训练成可以忽略 ——
// 手搓版曾三次误报，最后一次我在它打红后照样提交了。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// 默认查本仓（从脚本位置推出来，这样从任何 cwd 调用都对）。
// `--repo=<dir>` 只为**可测性**存在：判据里「暂存区有改动但零新增行」这一支
// 在本仓根本造不出来（本轮改动一直挂在暂存区，addedCount 恒 >0），
// 必须能指向一次性临时仓库才验得了。一个测不了的判据 = 一个不可信的判据。
const ROOT = (() => {
  const flag = process.argv.slice(2).find((a) => a.startsWith("--repo="));
  return flag ? path.resolve(flag.slice("--repo=".length)) : path.resolve(import.meta.dirname, "..");
})();
const SELF = "scripts/check-hygiene.mjs";
const BOM = "\uFEFF";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");

// 读取外部命令输出：必须用真实文件 fd，默认的 'pipe' 在本沙箱会 EPERM。
function gitCapture(gitArgs) {
  const tmp = path.join(os.tmpdir(), `cyl-hyg-${process.pid}-${Date.now()}.txt`);
  const fd = fs.openSync(tmp, "w");
  let r;
  try {
    r = spawnSync("git", ["-C", ROOT, ...gitArgs], { stdio: ["ignore", fd, "ignore"] });
  } finally {
    fs.closeSync(fd);
  }
  if (r.error || r.status === null) {
    fs.rmSync(tmp, { force: true });
    return { fail: true, text: "" };
  }
  const text = fs.readFileSync(tmp, "utf8");
  fs.rmSync(tmp, { force: true });
  return { fail: false, status: r.status, text };
}

const problems = [];

// ---- 检查 1：staged diff 的新增行 ----
// 只看新增行：移除一个坏字符不该报红。
const diff = gitCapture(["diff", "--cached"]);
if (diff.fail || diff.status !== 0) {
  console.error("TOOL FAILURE —— git diff --cached 没跑成；这不是卫生结论");
  process.exit(3);
}

let addedCount = 0;
// 暂存区是否真的有内容（区分「什么都没暂存」与「暂存了但全是删除」）
const hasStagedDiff = diff.text.trim() !== "";
// BOM 删除行怎么判：**只有「文件首行的 BOM 消失」才可疑**。
//
// 第一版我把「任何以 BOM 开头的删除行」都报红，结果它对我自己刚做的正确修复
// （删掉 development-standards.md 第 16 行行首的游离 BOM）报了红。
// 第二版改成「找不到去掉 BOM 后内容相同的新增行才报红」，仍然误报 ——
// 因为我同时还重写了那一行的文字，精确匹配匹配不上。
//
// 真正的判据来自检查 2 的断言：**夹在文件中间的 BOM 本身就是问题**，
// 所以删掉它永远是对的，不该报红。会被工具悄悄吃掉、且吃掉就有害的，
// 只有**文件开头**那个 BOM（它决定编码识别）。所以判据是位置，不是内容比对。
// diff 里 `@@` 之后的第一个 hunk 若从第 1 行开始，删除行才可能是首行。
const bomDeleted = [];
{
  let file = "";
  let isProse = false;
  let isSelf = false;
  let oldLine = -1; // 当前删除/上下文行对应的「原文件行号」，-1 = 尚未进入 hunk
  for (const ln of diff.text.split(/\r?\n/)) {
    if (ln.startsWith("+++ b/")) {
      file = ln.slice(6);
      oldLine = -1;
      isProse = file.startsWith("devlog/") || file.endsWith(".md");
      // 本文件必须自我豁免：判据字符串必然含有它要找的形态。
      isSelf = file.endsWith("check-hygiene.mjs") || file.endsWith("check-staged.ps1");
      continue;
    }
    if (isSelf || ln.startsWith("--- ")) continue;
    // hunk 头：取出「这一段对应原文件的起始行号」，逐行推进算出每个删除行的真实行号。
    // 不能只看 `@@ -1` 就认定删除行是首行 —— 一个从第 1 行开始的 hunk 可能覆盖几十行，
    // 里面第 16 行的删除也会落在其中（实测就是这样误报的，同类误报第三次）。
    if (ln.startsWith("@@")) {
      const m = /^@@ -(\d+)/.exec(ln);
      oldLine = m ? Number(m[1]) : -1;
      continue;
    }
    if (new RegExp(`^-${BOM}`).test(ln)) {
      // 只有「原文件第 1 行」的 BOM 消失才可疑；中间的游离 BOM 删掉是正确修复。
      if (oldLine === 1) bomDeleted.push({ file });
      oldLine++;
      continue;
    }
    // 删除行与上下文行都消耗一个「原文件行」，新增行不消耗
    if (ln.startsWith("-") || ln.startsWith(" ")) {
      if (oldLine > 0) oldLine++;
    }
    if (!ln.startsWith("+") || ln.startsWith("+++")) continue;
    addedCount++;
    const body = ln.slice(1);
    // 散文里带反引号/引言/表格/缩进的行是在「谈论」这些形态，不是犯了它们。
    const quoted =
      isProse && (/`/.test(body) || /^\s*[>|]/.test(body) || /^\s{4,}/.test(body) || /←/.test(body));

    if (!quoted && /\[\d+\s+chars\s+omitted\]/.test(body)) {
      problems.push(`写工具截断残留: ${file} :: ${body.trim()}`);
    }
    if (!isProse && /MUTATION[- ]?TEST|MUTATION ONLY/.test(body)) {
      problems.push(`变异测试标记残留: ${file} :: ${body.trim()}`);
    }
    if (!quoted && /\?{3,}/.test(body)) {
      problems.push(`疑似中文乱码: ${file} :: ${body.trim()}`);
    }
  }
}

// ---- 裁决 BOM 删除行 ----
// 走到这里的都是「文件首行 BOM 消失」，那是工具悄悄吃掉编码标记的典型形态。
for (const d of bomDeleted) {
  problems.push(`文件首行 BOM 被移除（疑似工具吃掉）: ${d.file}`);
}

// ---- 检查 2：工作树里「夹在文件中间」的 U+FEFF ----
// 这条是 check-staged.ps1 没有的能力：它只看 staged diff，所以一个早已提交、
// 夹在第 16 行中间的 BOM 它永远查不到（2026-08-21 实测：development-standards.md
// 第 16 行行首有一个游离 U+FEFF，靠人眼在渲染出的乱码里发现的）。
// 文件开头的 BOM 不算问题（部分文件历史如此），只报「中间」的。
const tracked = gitCapture(["ls-files", "*.md", "*.ts", "*.py", "*.mjs", "*.json"]);
if (tracked.fail || tracked.status !== 0) {
  console.error("TOOL FAILURE —— git ls-files 没跑成；这不是卫生结论");
  process.exit(3);
}
const files = tracked.text.split(/\r?\n/).filter((f) => f.trim() !== "");
let scanned = 0;
for (const rel of files) {
  if (rel === SELF) continue; // 自我豁免：本文件必须提到 U+FEFF 才能检查它
  const abs = path.join(ROOT, rel);
  let text;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    continue; // 已删除/不可读：不是卫生问题
  }
  scanned++;
  const body = text.startsWith(BOM) ? text.slice(1) : text; // 首个 BOM 合法
  const at = body.indexOf(BOM);
  if (at >= 0) {
    const line = body.slice(0, at).split("\n").length;
    problems.push(`文件中间有游离 BOM(U+FEFF): ${rel} 第 ${line} 行`);
  }
}

// ---- 结论 ----
if (problems.length > 0) {
  console.error(`发现 ${problems.length} 个卫生问题：`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
// 空扫描不许报绿：什么都没看就说 OK 是撒谎，正是本脚本要防的那种谎报。
//
// 但「空」要分两种，否则这条判据会变成死代码或噪音：
//   - 什么都没暂存（standalone 收尾自查的常态）：检查 2 仍实扫了几百个文件，
//     结论是有效的 → 照常 exit 0（静默）。
//   - 暂存里有改动、却一行新增都没有（纯删除）：新增行判据这次确实什么都没看，
//     不能替它发合格证 → exit 2，由 commit-step 的 --allow-vacuous 显式放行。
// 第一版写成 `addedCount === 0 && scanned === 0`，而 scanned 恒 >0，
// 于是 exit 2 永远到不了 —— 一个永远不会触发的判据等于没有判据。
if (hasStagedDiff && addedCount === 0) {
  console.error("VACUOUS —— 暂存区有改动但无新增行可查（纯删除？），本次不构成通过");
  process.exit(2);
}
// 通过时默认不输出任何东西（--verbose 才打印），退出码 0 已经说完了。
if (verbose) {
  console.log(`卫生检查通过：暂存新增 ${addedCount} 行，工作树扫描 ${scanned} 个文件，BOM 干净`);
}
process.exit(0);
