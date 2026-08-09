"""Shared bridge state singleton used by REST / WS / MCP."""
from __future__ import annotations

import os
from pathlib import Path

from .logs import LogRing
from .registry import SerialRegistry
from .workspace import WorkspaceStore


class BridgeState:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.registry = SerialRegistry(data_dir / "registry.json")
        self.workspaces = WorkspaceStore()
        self.logs = LogRing()


_state: BridgeState | None = None


def default_data_dir() -> Path:
    env = os.environ.get("CYL1NDER_DATA_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "data"


def get_state() -> BridgeState:
    global _state
    if _state is None:
        _state = BridgeState(default_data_dir())
    return _state


def reset_state(data_dir: Path) -> BridgeState:
    """Test helper: fresh state bound to a temp data dir."""
    global _state
    _state = BridgeState(data_dir)
    return _state
