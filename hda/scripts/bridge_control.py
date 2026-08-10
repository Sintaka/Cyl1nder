"""Bridge process control for Cyl1nder shelf tools (pure Python, no PowerShell).

Runs in Houdini's Python 3.11 (stdlib only).
- find PID: netstat -ano (terminal util)
- kill PID: taskkill /F (terminal util)
- start: subprocess.Popen DETACHED | CREATE_NO_WINDOW (same as HDA autostart)
Keep ASCII-only: this file is exec()'d by Houdini shelf scripts.
"""
from __future__ import annotations

import json
import subprocess
import time
import urllib.request

BRIDGE_URL = "http://127.0.0.1:8375"
PORT = 8375
BRIDGE_PY = r"D:\code\dev\Cyl1nder\bridge\.venv\Scripts\python.exe"
BRIDGE_CWD = r"D:\code\dev\Cyl1nder\bridge"


def bridge_healthy(url: str = BRIDGE_URL, timeout: float = 0.5):
    """Return /api/health JSON dict, or None when unreachable."""
    try:
        with urllib.request.urlopen(url.rstrip("/") + "/api/health", timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def find_pids(port: int = PORT):
    """PIDs listening on the port via netstat -ano."""
    try:
        out = subprocess.run(
            ["netstat", "-ano"], capture_output=True, text=True, timeout=10
        ).stdout
    except Exception:
        return []
    pids = []
    needle = ":%d" % port
    for line in out.splitlines():
        if "LISTENING" not in line or needle not in line:
            continue
        parts = line.split()
        if parts and parts[-1].isdigit():
            pid = int(parts[-1])
            if pid and pid not in pids:
                pids.append(pid)
    return pids


def stop_bridge(port: int = PORT):
    """Kill all PIDs on the port via taskkill /F. Returns count killed."""
    killed = 0
    for pid in find_pids(port):
        try:
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, timeout=10)
            killed += 1
        except Exception:
            pass
    if killed:
        time.sleep(0.3)  # let the port release
    return killed


def start_bridge(url: str = BRIDGE_URL):
    """Start the bridge detached (no console window). True when healthy after launch."""
    try:
        subprocess.Popen(
            [BRIDGE_PY, "-m", "bridge"],
            cwd=BRIDGE_CWD,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
        )
    except Exception:
        return False
    for _ in range(20):  # wait up to ~4s for /api/health
        time.sleep(0.2)
        if bridge_healthy(url):
            return True
    return False


def restart_bridge(url: str = BRIDGE_URL):
    killed = stop_bridge()
    ok = start_bridge(url)
    h = bridge_healthy(url)
    if ok and h:
        return "bridge restarted (killed %d) v%s serials=%s" % (killed, h.get("version", "?"), h.get("serials", "?"))
    return "bridge restarted but NOT healthy yet (killed %d) - check 8375" % killed


def toggle_bridge(url: str = BRIDGE_URL):
    if bridge_healthy(url):
        n = stop_bridge()
        return "bridge stopped (killed %d pid(s))" % n
    ok = start_bridge(url)
    return "bridge started" if ok else "bridge failed to start"


def status_bridge(url: str = BRIDGE_URL):
    h = bridge_healthy(url, timeout=1.0)
    if not h:
        pids = find_pids()
        if pids:
            return "port 8375 occupied by pid(s) %s but /api/health unreachable" % pids
        return "bridge OFFLINE (nothing on 8375)"
    return "bridge ONLINE v%s serials=%s" % (h.get("version", "?"), h.get("serials", "?"))


if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    fn = {"status": status_bridge, "toggle": toggle_bridge, "restart": restart_bridge}.get(cmd, status_bridge)
    print(fn())
