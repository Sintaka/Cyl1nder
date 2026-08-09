"""Compute executor interface - reserved for JS/Python/DLL backends.

v1 ships a passthrough executor + a ctypes demo stub showing how a native
pyd/dll backend plugs in later. The bridge does NOT run compute in v1
(web edits + Houdini pulls); this is the reserved interface.
"""
from __future__ import annotations

from typing import Protocol

from ..protocol import InputPayload, OutputBuffer


class ComputeContext:
    __slots__ = ("serial", "nodePath", "params")

    def __init__(self, serial: str = "", nodePath: str = "", params: dict | None = None) -> None:
        self.serial = serial
        self.nodePath = nodePath
        self.params = params or {}


class ComputeExecutor(Protocol):
    name: str

    def run(self, ctx: ComputeContext, inputs: list[InputPayload]) -> list[OutputBuffer]: ...


_REGISTRY: dict[str, ComputeExecutor] = {}


def register_executor(executor: ComputeExecutor) -> None:
    _REGISTRY[executor.name] = executor


def list_executors() -> list[str]:
    return sorted(_REGISTRY)


def run_node(node_type: str, ctx: ComputeContext, inputs: list[InputPayload]) -> list[OutputBuffer]:
    executor = _REGISTRY.get(node_type)
    if executor is None:
        raise KeyError(f"unknown executor: {node_type}")
    return executor.run(ctx, inputs)


# register built-in executors (imports at the end to avoid partial-package cycles)
from . import ctypes_stub, passthrough  # noqa: E402,F401
