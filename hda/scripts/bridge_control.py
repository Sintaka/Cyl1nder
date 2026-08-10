"""Bridge + Web frontend process control for Cyl1nder shelf tools (pure Python).

Runs in Houdini's Python 3.11 (stdlib only) or standalone.
Lifecycle binding: the frontend (vite on 8376) is bound to the bridge (8375) -
start/stop/toggle/restart/status manage BOTH. Starting the bridge also starts
the frontend if it is down; stopping the bridge also stops the frontend.

- find PID: netstat -ano (terminal util)
- kill PID: taskkill /F (terminal util)
- start bridge: subprocess.Popen(CREATE_NEW_CONSOLE) -> INDEPENDENT VISIBLE
  console window (same as manual `cd bridge; python -m bridge`).
- start frontend: node vite in an independent console window.
CRITICAL: Houdini exports PYTHONHOME/PYTHONPATH pointing at ITS Python 3.11
stdlib; a spawned venv Python 3.12 inherits them and dies at startup
("SRE module mismatch"). Always spawn with PYTHON* stripped (see _clean_env).
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
UI_URL = "http://127.0.0.1:8376"
UI_PORT = 8376
BRIDGE_PY = r"D:\code\dev\Cyl1nder\bridge\.venv\Scripts\python.exe"
BRIDGE_CWD = r"D:\code\dev\Cyl1nder\bridge"
NODE = r"C:\Program Files\nodejs\node.exe"
VITE_JS = r"D:\code\dev\Cyl1nder\web\node_modules\vite\bin\vite.js"
WEB_CWD = r"D:\code\dev\Cyl1nder\web"
RESULT_LOG = os.path.join(BRIDGE_CWD, "bridge_control.log")


def _clean_env(extra=None):
    """Child env without Houdini's PYTHONHOME/PYTHONPATH (they corrupt a venv 3.12)."""
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith("PYTHON")}
    if extra:
        env.update(extra)
    return env


def _get(url, timeout=0.5):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.read().decode("utf-8", "replace")
    except Exception:
        return None


def bridge_healthy(url: str = BRIDGE_URL, timeout: float = 0.5):
    body = _get(url.rstrip("/") + "/api/health", timeout)
    if body is None:
        return None
    try:
        return json.loads(body)
    except Exception:
        return None


def frontend_healthy(url: str = UI_URL, timeout: float = 0.5) -> bool:
    """True when the web UI (vite) answers on 8376."""
    return _get(url + "/", timeout) is not None


def find_pids(port: int):
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


def _wait_port_free(port: int, seconds: float = 3.0) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if not find_pids(port):
            return True
        time.sleep(0.2)
    return not find_pids(port)


def _kill_port(port: int) -> int:
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


def ensure_frontend(url: str = UI_URL, wait_seconds: float = 10.0) -> str:
    """Start vite on 8376 if it is down (independent console). Returns status string."""
    if frontend_healthy(url):
        return "ui OK (already up)"
    _wait_port_free(UI_PORT, 2.0)
    try:
        subprocess.Popen(
            [NODE, VITE_JS],
            cwd=WEB_CWD,
            env=_clean_env(),
            creationflags=subprocess.CREATE_NEW_CONSOLE,
        )
    except Exception as exc:  # noqa: BLE001
        return "ui FAILED to spawn: %s" % exc
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        time.sleep(0.3)
        if frontend_healthy(url):
            return "ui OK (spawned vite on 8376)"
    return "ui spawned but not ready in %.0fs - check the vite console window" % wait_seconds


def start_bridge(url: str = BRIDGE_URL):
    """Open an independent visible console window running the bridge, then ensure the UI."""
    _wait_port_free(PORT)
    try:
        proc = subprocess.Popen(
            [BRIDGE_PY, "-m", "bridge"],
            cwd=BRIDGE_CWD,
            env=_clean_env(),
            creationflags=subprocess.CREATE_NEW_CONSOLE,
        )
    except Exception as exc:  # noqa: BLE001
        return "FAILED to spawn bridge: %s" % exc

    bridge_msg = "bridge not healthy in 10s - check console"
    for _ in range(50):  # up to ~10s
        time.sleep(0.2)
        h = bridge_healthy(url)
        if h:
            bridge_msg = "bridge OK v%s (pid=%s)" % (h.get("version", "?"), proc.pid)
            break
        if proc.poll() is not None:
            return "FAILED: bridge exited early (code %s) - see console" % proc.returncode

    ui_msg = ensure_frontend()
    return "%s; %s" % (bridge_msg, ui_msg)


def restart_bridge(url: str = BRIDGE_URL):
    killed = _kill_port(PORT) + _kill_port(UI_PORT)
    return "restart: stopped %d pid(s) on 8375/8376; %s" % (killed, start_bridge(url))


def toggle_bridge(url: str = BRIDGE_URL):
    if bridge_healthy(url):
        n = _kill_port(PORT) + _kill_port(UI_PORT)
        return "stopped %d pid(s) on 8375/8376; console windows closed" % n
    return "start: " + start_bridge(url)


def status_bridge(url: str = BRIDGE_URL):
    h = bridge_healthy(url, timeout=1.0)
    ui = frontend_healthy()
    if not h:
        pids = find_pids(PORT)
        bridge_txt = "port 8375 occupied by %s but health unreachable" % pids if pids else "bridge OFFLINE"
    else:
        bridge_txt = "bridge ONLINE v%s serials=%s" % (h.get("version", "?"), h.get("serials", "?"))
    ui_txt = "ui ONLINE" if ui else "ui OFFLINE"
    return "%s | %s" % (bridge_txt, ui_txt)


def log_result(msg: str) -> None:
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
