"""Cyl1nder wire protocol - single source of truth.

Keep in sync with:
- web/src/protocol/types.ts (TS mirror)
- devlog/protocol.md (human-readable spec)
"""
from __future__ import annotations

import random
import re
import time

from pydantic import BaseModel, Field

VERSION = "0.1.00044"
HOST = "127.0.0.1"
PORT = 8375
BASE_URL = f"http://{HOST}:{PORT}"
# Web frontend (Vite dev server) - NOT the bridge. The bridge is data-only (REST/WS).
WEB_UI_URL = "http://127.0.0.1:8376"

# serial: C1-<base36(ms) 8+ chars>-<4 base36 random>
_SERIAL_RE = re.compile(r"^C1-[0-9a-z]{8,}-[0-9a-z]{4}$")


def _b36(n: int) -> str:
    if n == 0:
        return "0"
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    out: list[str] = []
    while n:
        n, r = divmod(n, 36)
        out.append(chars[r])
    return "".join(reversed(out))


def generate_serial() -> str:
    """Create-once immutable serial.

    Caller MUST persist it (HDA hidden parm cyl1nder_serial). Never derive at cook time.
    Kept identical to hda/src/cyl1nder_bridge.py generate_serial - change both together.
    """
    ms = int(time.time() * 1000)
    rnd = random.randrange(36**4)
    return f"C1-{_b36(ms)}-{_b36(rnd).zfill(4)}"


def is_valid_serial(serial: str) -> bool:
    return bool(_SERIAL_RE.match(serial or ""))


class AttributeData(BaseModel):
    type: str = "float"
    count: int = 1
    values: list[float] = Field(default_factory=list)


class CurveData(BaseModel):
    pointIndices: list[int] = Field(default_factory=list)
    widths: list[float] | None = None


class InputPayload(BaseModel):
    index: int = 0
    name: str = ""
    pointCount: int = 0
    primCount: int = 0
    points: list[list[float]] = Field(default_factory=list)
    curves: list[CurveData] = Field(default_factory=list)
    faces: list[list[int]] = Field(default_factory=list)
    attributes: dict[str, AttributeData] = Field(default_factory=dict)


class OutputBuffer(BaseModel):
    index: int = 0
    rev: int = 0
    pointCount: int = 0
    primCount: int = 0
    points: list[list[float]] = Field(default_factory=list)
    curves: list[CurveData] = Field(default_factory=list)
    faces: list[list[int]] = Field(default_factory=list)
    attributes: dict[str, AttributeData] = Field(default_factory=dict)


class InputsPut(BaseModel):
    """HDA pushes its 4 inputs (+ identity metadata)."""
    inputs: list[InputPayload] = Field(default_factory=list)
    hip: str = ""
    nodePath: str = ""
    label: str = ""


class OutputsPut(BaseModel):
    """Web pushes edited output buffers."""
    outputs: list[OutputBuffer] = Field(default_factory=list)
