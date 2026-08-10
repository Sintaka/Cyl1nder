"""Cyl1nder restart-free hot reload (run inside the Houdini Python Shell).

Usage:
    exec(open(r"D:/code/dev/Cyl1nder/hda/scripts/reload_hda.py").read())
    reload_cyl1nder()                  # 1) reload hda/src runtime modules + force recook all instances (fastest)
    reload_cyl1nder(definition=True)   # 2) also rebuild + hot-reload the .hda definition (network/parms/buttons)

Notes:
- Python SOPs cache by default; a plain cook() does NOT rerun the script -> use cook(force=True).
- Instances already have maintainstate=0: every later HDA recook (parm change / input / Pull Now)
  reruns the new code automatically.
- Bridge process code is NOT covered here: restart the bridge process (cd bridge; .venv\\Scripts\\python -m bridge).
"""
from __future__ import annotations

import importlib
import os
import subprocess
import sys

import hou

HDA_ROOT = r"D:\code\dev\Cyl1nder\hda"
SRC = os.path.join(HDA_ROOT, "src")
HDA_FILE = os.path.join(HDA_ROOT, "otls", "Cyl1nder_1.0.hda")
BUILD_SCRIPT = os.path.join(HDA_ROOT, "scripts", "build_hda.py")
HFS = os.environ.get("HFS", r"C:\Program Files\Side Effects Software\Houdini 22.0.368")
MODULES = ("cyl1nder_serializer", "cyl1nder_bridge", "cyl1nder_hda")


def _reload_modules() -> None:
    if SRC not in sys.path:
        sys.path.insert(0, SRC)
    for name in MODULES:
        try:
            mod = importlib.import_module(name)
        except ImportError:
            mod = None
        if mod is not None:
            importlib.reload(mod)
    print("[reload_hda] modules reloaded:", ", ".join(MODULES))


def _instances():
    nt = hou.nodeType(hou.sopNodeTypeCategory(), "Cyl1nder")
    return nt.instances() if nt is not None else []


def _force_recook_all() -> int:
    count = 0
    for n in _instances():
        for c in n.children():
            if c.type().name() == "python":
                try:
                    c.cook(force=True)
                    count += 1
                except Exception as e:  # noqa: BLE001
                    print(f"[reload_hda] recook {c.path()} failed: {e}")
    print(f"[reload_hda] force-recooked {count} python SOPs")
    return count


def _rebuild_hda() -> None:
    hython = os.path.join(HFS, "bin", "hython.exe")
    subprocess.run([hython, BUILD_SCRIPT], check=True)
    print("[reload_hda] rebuilt:", HDA_FILE)


def _reload_definition() -> None:
    if not os.path.exists(HDA_FILE):
        raise FileNotFoundError(HDA_FILE)
    hou.hda.reloadFile(HDA_FILE)
    print("[reload_hda] definition reloaded:", HDA_FILE)


def reload_cyl1nder(definition: bool = False) -> None:
    """Hot-reload without restarting Houdini.

    definition=False (default): reload hda/src modules + force recook all instances.
    definition=True: also rebuild the .hda and reloadFile (network/parms/buttons).
    """
    _reload_modules()
    _force_recook_all()
    if definition:
        _rebuild_hda()
        _reload_definition()
        _force_recook_all()
    print("[reload_hda] done. Bridge process code changes need a bridge restart (cd bridge; .venv\\Scripts\\python -m bridge)")
