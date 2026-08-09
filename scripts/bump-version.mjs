// bump-version.mjs — x.xxx.xxxxx dailybuild++ (run on every commit).
// Usage: node scripts/bump-version.mjs [build|minor|major]   (default: build)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FILES = [
  path.join(ROOT, "bridge", "bridge", "protocol.py"),
  path.join(ROOT, "web", "src", "app", "app-config.ts"),
];

function readVersion() {
  const s = fs.readFileSync(FILES[0], "utf8");
  const m = s.match(/VERSION = "([^"]+)"/);
  if (!m) throw new Error("VERSION not found in protocol.py");
  return m[1].split(".").map((x) => parseInt(x, 10));
}

function next(v, kind) {
  const [major, minor, daily] = v;
  if (kind === "major") return [major + 1, 0, 1];
  if (kind === "minor") return [major, minor + 1, 1];
  return [major, minor, (daily ?? 0) + 1];
}

const kind = process.argv[2] ?? "build";
const n = next(readVersion(), kind);
const ver = `${n[0]}.${n[1]}.${String(n[2]).padStart(5, "0")}`;
for (const f of FILES) {
  let s = fs.readFileSync(f, "utf8");
  s = s.replace(/VERSION = "[^"]+"/, `VERSION = "${ver}"`);
  s = s.replace(/APP_VERSION = "[^"]+"/, `APP_VERSION = "${ver}"`);
  fs.writeFileSync(f, s);
}
console.log(`bumped to ${ver}`);