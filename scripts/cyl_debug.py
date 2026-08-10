"""Cyl1nder debug access tool (python = universal language, talks to the local APIs).

Usage:
  python scripts/cyl_debug.py status          # bridge + UI health, serials
  python scripts/cyl_debug.py layout          # current docking-layout.json
  python scripts/cyl_debug.py snapshot <serial>  # snapshot summary for a serial
  python scripts/cyl_debug.py browser         # detect Chrome windows via CDP (if remote-debugging enabled)
  python scripts/cyl_debug.py probe           # one-line watchdog (bridge/ui/hda heartbeat)

Design notes (devlog/development-standards.md):
- Always read UI state from the bridge file (docking-layout.json), never from a
  headless browser instance - the user's real Chrome is the source of truth.
- CDP browser detection is best-effort: requires Chrome launched with
  --remote-debugging-port=9222 (optionally set CYL1NDER_CDP_PORT).
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

BRIDGE = "http://127.0.0.1:8375"
UI = "http://127.0.0.1:8376"
BRIDGE_ROOT = Path(__file__).resolve().parent.parent / "bridge"
UI_LAYOUT_FILE = BRIDGE_ROOT / "data" / "ui-layout.json"


def _get(url: str, timeout: float = 3.0):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


def status() -> str:
    h = _get(f"{BRIDGE}/api/health")
    ui = _get(f"{UI}/", timeout=1.5)
    serials = _get(f"{BRIDGE}/api/serials")
    return (
        f"bridge={h.get('status', 'down')} v{h.get('version', '?')} serials={h.get('serials', '?')} | "
        f"ui={'up' if isinstance(ui, dict) and ui.get('service') else ui.get('error', 'down')} | "
        f"known serials: {len(serials) if isinstance(serials, list) else 0}"
    )


def layout() -> str:
    if UI_LAYOUT_FILE.exists():
        try:
            data = json.loads(UI_LAYOUT_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return "ui-layout.json corrupt"
        grid = data.get("grid", {})
        root = grid.get("root", {})
        # flatten leaves: which panels live in which group
        leaves: list[str] = []

        def walk(n):
            if not isinstance(n, dict):
                return
            if n.get("type") == "leaf":
                leaves.append(",".join(n.get("data", {}).get("views", [])))
            for c in n.get("data", []) or []:
                walk(c)

        walk(root)
        return f"docking-layout.json: {len(leaves)} groups | w={grid.get('width')} h={grid.get('height')} | {leaves}"
    return "no ui-layout.json (programmatic Desk1 in use)"


def snapshot(serial: str) -> str:
    data = _get(f"{BRIDGE}/api/hda/{serial}/snapshot")
    snap = data.get("snapshot")
    if not snap:
        return f"{serial}: no snapshot"
    parts = list(snap.keys())
    summary = []
    if "meta" in snap:
        m = snap["meta"]
        summary.append(f"meta v{m.get('schemaVersion')} revs {m.get('inputRev')}/{m.get('outputRev')}")
    if "inputs" in snap:
        summary.append(f"io/inputs {len(snap['inputs'])}")
    if "outputs" in snap:
        summary.append(f"io/outputs {len(snap['outputs'])}")
    if "graph" in snap:
        g = snap["graph"]
        summary.append(f"scene/node-graph {len(g.get('nodes', []))} nodes / {len(g.get('connections', []))} conns")
    if "docking" in snap:
        summary.append("docking-layout.json present")
    return f"{serial}: {parts} | {' '.join(summary)}"


def browser() -> str:
    port = 9222
    try:
        import os
        port = int(os.environ.get("CYL1NDER_CDP_PORT", "9222"))
    except ValueError:
        pass
    try:
        data = _get(f"http://127.0.0.1:{port}/json", timeout=1.5)
        if isinstance(data, list):
            lines = [f"{t.get('type')}: {t.get('title','')[:40]} | {t.get('url','')[:60]}" for t in data if t.get("type") in ("page",)]
            return f"CDP {port}: {len(lines)} page(s)\n" + "\n".join(lines[:8])
        return f"CDP {port}: {data}"
    except Exception as exc:  # noqa: BLE001
        return f"CDP {port}: not reachable ({exc}) - launch Chrome with --remote-debugging-port={port}"


def probe() -> str:
    h = _get(f"{BRIDGE}/api/health", timeout=0.8)
    ui_up = _get(f"{UI}/", timeout=0.8)
    return f"bridge={'up' if h.get('status')=='ok' else 'down'} ui={'up' if not isinstance(ui_up, dict) or ui_up.get('service') else 'down'}"


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    fn = {"status": status, "layout": layout, "snapshot": lambda: snapshot(sys.argv[2] if len(sys.argv) > 2 else ""), "browser": browser, "probe": probe}.get(cmd, status)
    print(fn())