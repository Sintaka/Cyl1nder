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