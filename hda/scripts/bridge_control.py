"""Bridge process control for Cyl1nder shelf tools (pure Python, no PowerShell).

Runs in Houdini's Python 3.11 (stdlib only) or standalone.
- find PID: netstat -ano (terminal util)
- kill PID: taskkill /F (terminal util)
- start: subprocess.Popen(CREATE_NEW_CONSOLE) -> opens an INDEPENDENT VISIBLE
  console window running the bridge (same as the user's manual
  `cd bridge; .venv\\Scripts\\python -m bridge` workflow).
Non-blocking usage from Houdini: callers run start/stop/restart/toggle on a
background thread (see shelf scripts) so Houdini's main thread never waits;
results are appended to bridge_control.log.

CRITICAL: Houdini exports PYTHONHOME/PYTHONPATH pointing at ITS Python 3.11
stdlib. A spawned venv Python 3.12 inherits them and dies at startup
("Fatal Python error: init_import_site ... SRE module mismatch"). Always spawn
with PYTHON* env vars stripped (see _clean_env).
Keep ASCII-only: this file is exec()'d by Houdini shelf scripts.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.request

BRIDGE_URL = "http://127.0.0.1:8375"
PORT = 8375
BRIDGE_PY = r"D:\code\dev\Cyl1nder\bridge\.venv\Scripts\python.exe"
BRIDGE_CWD = r"D:\code\dev\Cyl1nder\bridge"
RESULT_LOG = os.path.join(BRIDGE_CWD, "bridge_control.log")


def _clean_env():
    """Child env without Houdini's PYTHONHOME/PYTHONPATH (they corrupt a venv 3.12)."""
    return {k: v for k, v in os.environ.items() if not k.upper().startswith("PYTHON")}


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


def _wait_port_free(port: int = PORT, seconds: float = 3.0) -> bool:
    """Wait until nothing LISTENING on the port (release after taskkill)."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        if not find_pids(port):
            return True
        time.sleep(0.2)
    return not find_pids(port)


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
        _wait_port_free(port)
    return killed


def start_bridge(url: str = BRIDGE_URL):
    """Open an independent visible console window running the bridge.

    CREATE_NEW_CONSOLE gives the bridge its own window (the user's manual
    workflow). Returns 'OK <version>' or a reason on failure.
    """
    _wait_port_free(PORT)
    try:
        proc = subprocess.Popen(
            [BRIDGE_PY, "-m", "bridge"],
            cwd=BRIDGE_CWD,
            env=_clean_env(),  # strip PYTHONHOME/PYTHONPATH from Houdini
            creationflags=subprocess.CREATE_NEW_CONSOLE,
        )
    except Exception as exc:  # noqa: BLE001
        return "FAILED to spawn: %s" % exc

    # confirm health for up to ~10s (background thread in the shelf, so Houdini
    # is never blocked by this poll)
    for i in range(50):
        time.sleep(0.2)
        h = bridge_healthy(url)
        if h:
            return "OK v%s serials=%s (independent console, pid=%s)" % (
                h.get("version", "?"), h.get("serials", "?"), proc.pid)
        if proc.poll() is not None:
            return "FAILED: bridge process exited early (code %s) - see console window / bridge.err.log" % proc.returncode
    return "spawned console (pid=%s) but bridge not healthy in 10s - check the console window" % proc.pid


def restart_bridge(url: str = BRIDGE_URL):
    killed = stop_bridge()
    return "restart: killed %d pid(s); %s" % (killed, start_bridge(url))


def toggle_bridge(url: str = BRIDGE_URL):
    if bridge_healthy(url):
        n = stop_bridge()
        return "stopped (killed %d pid(s)); console window closed" % n
    return "start: " + start_bridge(url)


def status_bridge(url: str = BRIDGE_URL):
    h = bridge_healthy(url, timeout=1.0)
    if not h:
        pids = find_pids()
        if pids:
            return "port 8375 occupied by pid(s) %s but /api/health unreachable" % pids
        return "OFFLINE (nothing on 8375)"
    return "ONLINE v%s serials=%s" % (h.get("version", "?"), h.get("serials", "?"))


def log_result(msg: str) -> None:
    """Append a timestamped result line (called from the background thread)."""
    try:
        with open(RESULT_LOG, "a", encoding="utf-8") as fh:
            fh.write("%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg))
    except Exception:
        pass


if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    fn = {"status": status_bridge, "toggle": toggle_bridge, "restart": restart_bridge}.get(cmd, status_bridge)
    msg = fn()
    print(msg)
    log_result("[%s] %s" % (cmd, msg))
