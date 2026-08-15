// gen-api-index.mjs — scan bridge for REST routes / WS / MCP tools -> devlog/API_INDEX.md
// Run: node scripts/gen-api-index.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const B = path.join(ROOT, "bridge", "bridge");
const OUT = path.join(ROOT, "devlog", "API_INDEX.md");

const md = ["# API 索引 / API INDEX", ""];
md.push(`> 机器生成（${new Date().toISOString().slice(0, 10)}），由 \`node scripts/gen-api-index.mjs\` 产出。单源：bridge/bridge/*.py`);
md.push("");

// REST
md.push("## REST (127.0.0.1:8375)");
md.push("");
for (const f of ["routes.py", "houdini_routes.py", "snapshot_routes.py", "channel_routes.py", "project_routes.py", "ws.py"]) {
  const p = path.join(B, f);
  if (!fs.existsSync(p)) continue;
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/@router\.(get|put|post|delete|websocket)\(\s*["']([^"']+)["']/);
    if (m) md.push(`- \`${m[1].toUpperCase()}\` \`${m[2]}\` (${f}:${i + 1})`);
  }
}
md.push("");

// MCP
md.push("## MCP tools (bridge.mcp_server)");
md.push("");
const mcp = path.join(B, "mcp_server.py");
if (fs.existsSync(mcp)) {
  const lines = fs.readFileSync(mcp, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/def\s+(cyl1nder_\w+)\s*\(/);
    if (m) md.push(`- \`${m[1]}\` (mcp_server.py:${i + 1})`);
  }
}
md.push("");
md.push("## WS 消息");
md.push("");
md.push("- server->client: `hello` / `inputs` / `outputs` / `pong`");
md.push("- client->server: `ping` / `edit`");
md.push("");
fs.writeFileSync(OUT, md.join("\n"));
console.log("OK -> API_INDEX.md");