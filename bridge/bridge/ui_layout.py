"""UI layout store: single JSON file (bridge/data/ui-layout.json).
The web UI owns the dockview layout; bridge only persists the file so any
browser/session (including the agent's headless browser) can read it back.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class UiLayoutStore:
    def __init__(self, path: Path) -> None:
        self._path = path

    def read(self) -> Any | None:
        if not self._path.exists():
            return None
        try:
            return json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def write(self, layout: Any | None) -> None:
        if layout is None:
            return
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(layout), encoding="utf-8")
            tmp.replace(self._path)
        except OSError:
            pass

import os

# Named layouts live in the user Documents folder (shared across browsers).
_LAYOUT_DIR = Path(os.environ.get("CYL1NDER_LAYOUTS_DIR", str(Path.home() / "Documents" / "Cyl1nder" / "Layouts")))


def list_layouts() -> list[str]:
    """List named layouts (sorted by name)."""
    if not _LAYOUT_DIR.exists():
        return []
    return sorted(p.stem for p in _LAYOUT_DIR.glob("*.json"))


def save_layout(name: str, layout: Any) -> bool:
    """Save a named layout (overwrites same-name file). Returns True on success."""
    if not name or not name.strip():
        return False
    safe = "".join(c for c in name.strip() if c not in "/\\:*?\"<>|")
    if not safe:
        return False
    try:
        _LAYOUT_DIR.mkdir(parents=True, exist_ok=True)
        target = _LAYOUT_DIR / f"{safe}.json"
        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(layout, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(target)
        return True
    except OSError:
        return False


def load_layout(name: str) -> Any | None:
    """Load a named layout; returns None when missing."""
    target = _LAYOUT_DIR / f"{name.strip()}.json"
    if not target.exists():
        return None
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
