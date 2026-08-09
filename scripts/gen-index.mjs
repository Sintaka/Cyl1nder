// gen-index.mjs — scan web/src (.ts) + bridge + hda/src (.py), emit devlog/FUNCTION_INDEX.md/.json
// Run: node scripts/gen-index.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_MD = path.join(ROOT, "devlog", "FUNCTION_INDEX.md");
const OUT_JSON = path.join(ROOT, "devlog", "FUNCTION_INDEX.json");

const fnRe = /^\s*(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const constArrowRe = /^\s*(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/;
const constFnRe = /^\s*(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/;
const classRe = /^\s*(export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const pyDefRe = /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/;
const pyClassRe = /^\s*class\s+([A-Za-z_][\w]*)/;

function scanFile(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const lines = src.split(/\r?\n/);
  const funcs = [];
  const seen = new Set();
  lines.forEach((line, i) => {
    let m, kind = null, exported = false;
    if (filePath.endsWith(".py")) {
      if ((m = pyDefRe.exec(line))) kind = "def";
      else if ((m = pyClassRe.exec(line))) kind = "class";
      if (!m) return;
    } else {
      if ((m = fnRe.exec(line))) kind = "function";
      else if ((m = constArrowRe.exec(line))) kind = "arrow";
      else if ((m = constFnRe.exec(line))) kind = "const-fn";
      else if ((m = classRe.exec(line))) kind = "class";
      if (!m) return;
      exported = !!m[1];
    }
    const name = m[1] || m[2];
    if (seen.has(name)) return;
    seen.add(name);
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const calls = (src.match(new RegExp("\\b" + esc + "\\s*\\(", "g")) || []).length;
    funcs.push({ name, line: i + 1, kind, exported, calls });
  });
  return {
    file: path.relative(ROOT, filePath).replace(/\\/g, "/"),
    lineCount: lines.length,
    functions: funcs,
  };
}

function collect(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".venv" || name === "dist") continue;
      collect(full, exts, out);
    } else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const files = [];
collect(path.join(ROOT, "web", "src"), [".ts"], files);
collect(path.join(ROOT, "bridge", "bridge"), [".py"], files);
collect(path.join(ROOT, "mcp"), [".py"], files);
collect(path.join(ROOT, "hda", "src"), [".py"], files);
files.sort((a, b) => a.localeCompare(b));
const scanned = files.map(scanFile);

const total = scanned.reduce((n, f) => n + f.functions.length, 0);
const data = { generatedAt: new Date().toISOString(), totalFunctions: total, files: scanned };
fs.writeFileSync(OUT_JSON, JSON.stringify(data, null, 2));

const md = [];
md.push("# 函数索引 / FUNCTION INDEX");
md.push("");
md.push(`> 机器生成（${data.generatedAt.slice(0, 10)}），由 \`node scripts/gen-index.mjs\` 产出。共 **${total}** 个函数/类。`);
md.push("> 用途：agent 先 grep 函数名定位，再跳读对应文件/行号；`calls` = 文件内 `name(` 出现次数（hub 指标，越大越核心）。");
md.push("");
for (const f of scanned) {
  md.push(`## ${f.file}（${f.lineCount} 行）`);
  md.push("");
  md.push("| 函数 | 行号 | 类型 | 导出 | calls |");
  md.push("|---|---|---|---|---|");
  for (const fn of f.functions) {
    md.push(`| \`${fn.name}\` | ${fn.line} | ${fn.kind} | ${fn.exported ? "export" : ""} | ${fn.calls} |`);
  }
  md.push("");
}
fs.writeFileSync(OUT_MD, md.join("\n"));
console.log(`OK: ${total} functions from ${files.length} files -> FUNCTION_INDEX.md/.json`);