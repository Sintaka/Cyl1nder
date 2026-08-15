"""Cyl1nder wire protocol - single source of truth.

Keep in sync with:
- web/src/protocol/types.ts (TS mirror)
- devlog/protocol.md (human-readable spec)

GET /api/hda/{serial}/stream (NDJSON long-poll, see devlog/sync-heartbeat-redesign.md §3.1):
- single-line JSON per poll, Content-Type: application/x-ndjson
- every event carries the current per-serial sync cap: {"fps": <1..60>} (HDA uses it to
  update its runtime receive cap; default 30)
- immediate hits: since > rev -> {"type":"reset","rev","fps"}; rev > since ->
  {"type":"outputs","rev","fps"}; kick armed -> {"type":"kick","force":true,"rev","fps"}
- otherwise hold up to `hold` seconds (default 60, max 60; HDA uses 60s); put_outputs accepted / kick
  armed wake the poll early; timeout -> {"type":"timeout","rev","fps"}
- request arrival touches the registry (liveness heartbeat, same auto-register as /pending)

PUT /api/hda/{serial}/sync (body {"fps": int}, 1..60, default 30):
- stores the per-serial bridge-side receive+forward cap (in-memory; the web Preference.json
  is the persistent source), returns {"ok":true,"serial","fps"}. Bridge throttles
  notify_stream + WS broadcast to <= fps, and registry disk saves are debounced to 1/s.

PUT /api/hda/{serial}/sync-enabled sets the per-serial manual two-way sync gate
(default False); /pending and /stream events carry `sync_enabled`, and /status
returns a `sync` block.

Msgpack negotiation (bridge <-> web; HDA stays NDJSON/JSON - see devlog/transport-tech-evaluation.md §B2):
- REST outputs: PUT /api/hda/{serial}/outputs accepts a msgpack body when
  Content-Type is application/msgpack (msgpack.unpackb then OutputsPut.model_validate);
  GET /api/hda/{serial}/outputs returns msgpack bytes when Accept is application/msgpack.
  All other REST endpoints stay JSON.
- WS: /ws?proto=msgpack opens a binary msgpack channel; no proto (or proto=json) keeps
  JSON text frames. Frames are msgpack of the same dict payloads as today (server->client:
  hello/inputs/outputs/log/pong; client->server: ping/edit - the client may also send a
  JSON/text {"type":"ping"}). Pack with use_bin_type=False so strings stay str.
- WS inputs messages carry an optional `frame` (float or null).
- /stream stays single-line NDJSON JSON and /inputs stays JSON (HDA unchanged).

Snapshot parts (see devlog/snapshot-design.md): io/inputs.json, io/outputs.json,
scene/meta.json, scene/node-graph.json, scene/node-parm.json, docking-layout.json and
Preference.json (web preferences: {"schemaVersion":1,"sync_max_fps":30,"update_mode":"auto"}).
"""
from __future__ import annotations

import random
import re
import time

from pydantic import BaseModel, Field

VERSION = "0.1.00108"
HOST = "127.0.0.1"
PORT = 8375
BASE_URL = f"http://{HOST}:{PORT}"
# Web frontend (Vite dev server) - NOT the bridge. The bridge is data-only (REST/WS).
WEB_UI_URL = "http://127.0.0.1:8376"

# GET /api/hda/{serial}/stream long-poll hold bounds (seconds)
STREAM_HOLD_DEFAULT = 60
STREAM_HOLD_MAX = 60

# per-serial Sync Max FPS bounds (web bottom bar -> PUT /sync -> bridge + HDA caps)
SYNC_FPS_DEFAULT = 30
SYNC_FPS_MIN = 1
SYNC_FPS_MAX = 60

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
    frame: float | None = None
    hip: str = ""
    nodePath: str = ""
    label: str = ""


class ChannelRef(BaseModel):
    """吊牌 HDA 通道注册条目（关联注册大全，见 devlog/tag-hda-plan.md P1）。"""
    kind: str                       # "tag" | "hda" | "param"
    serial: str | None = None       # kind=tag/hda: C1- serial；kind=param: 归属吊牌 serial
    nodePath: str | None = None     # kind=tag/hda: 节点绝对路径；kind=param: 归属吊牌节点路径
    absolutePath: str | None = None # kind=param: 参数绝对路径（/obj/geo1/transform1/tx）
    hip: str = ""
    label: str = ""
    registeredAt: float = 0.0       # 服务端权威：首次注册写 now，重复注册保留
    lastSeen: float = 0.0           # 注册/心跳/探测成功时刷新 now


PROJECT_SERIAL_RE = re.compile(r"^P1-[0-9a-z]{8,}-[0-9a-z]{4}$")


def generate_project_serial() -> str:
    """项目 serial：P1-<base36 毫秒>-<4位base36随机>（镜像 generate_serial 只换前缀）。"""
    ms = int(time.time() * 1000)
    rnd = random.randrange(36**4)
    return f"P1-{_b36(ms)}-{_b36(rnd).zfill(4)}"


def is_valid_project_serial(pid: str) -> bool:
    return bool(PROJECT_SERIAL_RE.match(pid or ""))


class ProjectRef(BaseModel):
    """吊牌 HDA 项目（多 HDA 绑定，见 devlog/tag-hda-plan.md P2a）。"""
    projectSerial: str
    label: str = ""
    createdAt: float = 0.0        # 服务端权威：创建时写 now，不可变
    updatedAt: float = 0.0        # 成员增删时刷 now
    members: list[ChannelRef] = Field(default_factory=list)   # 通道引用快照（live 状态以 /api/channels 大全为准）


class OutputsPut(BaseModel):
    """Web pushes edited output buffers."""
    outputs: list[OutputBuffer] = Field(default_factory=list)


class SyncEnabledPut(BaseModel):
    """PUT /api/hda/{serial}/sync-enabled body: manual two-way sync gate (web is source of truth)."""
    enabled: bool = True
