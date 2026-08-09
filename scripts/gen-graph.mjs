// gen-graph.mjs — web/src module dependency graph -> devlog/MODULE_GRAPH.md
// Run: node scripts/gen-graph.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "web", "src");
const OUT = path.join(ROOT, "devlog", "MODULE_GRAPH.md");

function collect(dir, out = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) collect(full, out);
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function importsOf(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const rel = (p) => {
    let abs = path.resolve(path.dirname(filePath), p);
    abs = abs.replace(/\.(ts|tsx)$/, "");
    return path.relative(SRC, abs).replace(/\\/g, "/");
  };
  const out = [];
  for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (spec.startsWith(".")) out.push(rel(spec));
    else out.push(spec); // bare package
  }
  for (const m of src.matchAll(/import\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (spec.startsWith(".")) out.push(rel(spec));
    else out.push(spec);
  }
  return [...new Set(out)].sort();
}

const files = collect(SRC).sort();
const rows = [];
for (const f of files) {
  const rel = path.relative(SRC, f).replace(/\\/g, "/");
  const deps = importsOf(f);
  rows.push(`- \`${rel}\``);
  for (const d of deps) rows.push(`  - ${d}`);
}

const md = [
  "# 模块依赖图 / MODULE GRAPH (web/src)",
  "",
  `> 机器生成（${new Date().toISOString().slice(0, 10)}），由 \`node scripts/gen-graph.mjs\` 产出。`,
  "",
  ...rows,
  "",
];
fs.writeFileSync(OUT, md.join("\n"));
console.log(`OK: ${files.length} modules -> MODULE_GRAPH.md`);