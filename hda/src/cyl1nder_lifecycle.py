"""Bridge/frontend lifecycle + serial/parm helpers for the Cyl1nder HDA (3.1 split)."""
from __future__ import annotations

import os
import subprocess
import time
import urllib.request

import hou

from cyl1nder_bridge import generate_serial

BRIDGE_PY = r"D:\code\dev\Cyl1nder\bridge\.venv\Scripts\python.exe"
BRIDGE_CWD = r"D:\code\dev\Cyl1nder\bridge"
NODE = r"C:\Program Files\nodejs\node.exe"
VITE_JS = r"D:\code\dev\Cyl1nder\web\node_modules\vite\bin\vite.js"
WEB_CWD = r"D:\code\dev\Cyl1nder\web"
_BRIDGE_LAST_SPAWN = 0.0
_UI_LAST_SPAWN = 0.0
_AUTOSTART_CHECK_INTERVAL = 2.0
_BRIDGE_LAST_CHECK = 0.0
_UI_LAST_CHECK = 0.0


def _ui_healthy() -> bool:
    """True when the web UI (vite on 8376) answers."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:8376/", timeout=0.4):
            return True
    except Exception:  # noqa: BLE001
        return False


def _ensure_frontend(root: hou.Node) -> None:
    """Bind the web UI lifecycle to the bridge: if 8376 is down, start vite (1 attempt / 10s)."""
    global _UI_LAST_SPAWN, _UI_LAST_CHECK
    if not bool(_parm(root, "bridge_autostart", 1)):
        return
    now = time.time()
    if now - _UI_LAST_CHECK < _AUTOSTART_CHECK_INTERVAL:
        return  # recently probed: skip the HTTP round-trip on this cook
    _UI_LAST_CHECK = now
    if _ui_healthy():
        return
    if now - _UI_LAST_SPAWN < 10.0:
        return
    _UI_LAST_SPAWN = now
    try:
        subprocess.Popen(
            [NODE, VITE_JS],
            cwd=WEB_CWD,
            env={k: v for k, v in os.environ.items() if not k.upper().startswith("PYTHON")},
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
        )
    except Exception:  # noqa: BLE001
        pass


def _bridge_healthy(bridge_url: str) -> bool:
    try:
        with urllib.request.urlopen(bridge_url.rstrip("/") + "/api/health", timeout=0.3):
            return True
    except Exception:  # noqa: BLE001
        return False


def _ensure_bridge(root: hou.Node) -> None:
    """If the bridge is unreachable, start it (one attempt per 5s)."""
    global _BRIDGE_LAST_SPAWN, _BRIDGE_LAST_CHECK
    if not bool(_parm(root, "bridge_autostart", 1)):
        return
    now = time.time()
    if now - _BRIDGE_LAST_CHECK < _AUTOSTART_CHECK_INTERVAL:
        return  # recently probed: skip the HTTP round-trip on this cook
    _BRIDGE_LAST_CHECK = now
    bridge_url = _parm(root, "bridge_url", "http://127.0.0.1:8375")
    if _bridge_healthy(bridge_url):
        return
    if now - _BRIDGE_LAST_SPAWN < 5.0:
        return
    _BRIDGE_LAST_SPAWN = now
    try:
        subprocess.Popen(
            [BRIDGE_PY, "-m", "bridge"],
            cwd=BRIDGE_CWD,
            env={k: v for k, v in os.environ.items() if not k.upper().startswith("PYTHON")},
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
        )
        _set_status(root, "starting bridge...")
    except Exception:  # noqa: BLE001
        pass


def _root(node: hou.Node) -> hou.Node:
    return node.parent()  # the HDA subnet root


def _ensure_serial(node: hou.Node) -> str:
    """Create-once immutable serial persisted in the hidden parm cyl1nder_serial."""
    root = _root(node)
    parm = root.parm("cyl1nder_serial")
    if parm is None:
        return ""
    val = parm.eval()
    if not val:
        val = generate_serial()
        parm.set(val)
    return val


def _parm(root: hou.Node, name: str, default):
    p = root.parm(name)
    if p is None:
        return default
    try:
        return p.eval()
    except Exception:  # noqa: BLE001
        return default


def _set_status(root: hou.Node, text: str) -> None:
    p = root.parm("status")
    if p is not None and p.eval() != text:
        try:
            p.set(text)
        except Exception:  # noqa: BLE001
            pass
