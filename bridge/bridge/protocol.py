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

VERSION = "0.1.00119"
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
    """吊牌 HDA 通道注册条目（关联注册大全，见 devlog/tag-hda-plan.md P1）；
    kind="data" 时 adapter 指定 bridge 侧读写器（如 "apex-anim"，见 P4）。"""
    kind: str                       # "tag" | "hda" | "param" | "data"
    serial: str | None = None       # kind=tag/hda: C1- serial；kind=param: 归属吊牌 serial
    nodePath: str | None = None     # kind=tag/hda: 节点绝对路径；kind=param: 归属吊牌节点路径
    absolutePath: str | None = None # kind=param: 参数绝对路径（/obj/geo1/transform1/tx）
    hip: str = ""
    label: str = ""
    registeredAt: float = 0.0       # 服务端权威：首次注册写 now，重复注册保留
    lastSeen: float = 0.0           # 注册/心跳/探测成功时刷新 now
    adapter: str | None = None      # kind="data"：bridge 侧读写器名（如 "apex-anim"）
    # 映射系统字段（v0.1.00114）：吊牌注册时带出，桥据此建「逻辑名 -> 相对地址」条目。
    rel: str | None = None          # 相对**吊牌所在网络**的地址（兄弟节点语义）；逻辑名默认取它
    type: str = "float"             # MAPPING_TYPES 之一（geo|float|vec3）
    mode: str | None = None         # 归属吊牌的标记模式（"parm" | "apex"）


PROJECT_SERIAL_RE = re.compile(r"^P1-[0-9a-z]{8,}-[0-9a-z]{4}$")


def generate_project_serial() -> str:
    """项目 serial：P1-<base36 毫秒>-<4位base36随机>（镜像 generate_serial 只换前缀）。"""
    ms = int(time.time() * 1000)
    rnd = random.randrange(36**4)
    return f"P1-{_b36(ms)}-{_b36(rnd).zfill(4)}"


def is_valid_project_serial(pid: str) -> bool:
    return bool(PROJECT_SERIAL_RE.match(pid or ""))


class ProjectRef(BaseModel):
    """项目 = 一个 hip 文件（v0.1.00116 起）。

    身份模型（关键）：
    - **key 仍是 `projectSerial`（P1-…）**，创建即不可变。不能用 hip 路径或文件名当 key：
      不同位置的同名文件会撞（`a/scene.hip` 与 `b/scene.hip`），路径本身又会因另存为而变。
    - `hip` = 当前绑定的 hip 绝对路径（另存为后由迁移更新）。
    - `label` 为空时 UI 显示 hip 文件名 + 简短路径；用户显式改名后才用 label。
    - 同一 hip 只应有一个项目：HDA/吊牌 cook 上报 hip 时，桥按 hip 找到项目并**自动登记**
      成员，因此「一个文件下的节点自动注册在一起」，不再出现两个项目共享同一成员。

    另存为迁移：节点上报的 hip 与所属项目的 `hip` 不一致 → 该 hip 已另存为新文件。
    pid/端口不变（同一个 Houdini 进程），所以迁移只需换绑文件并逐一核对旧成员在**新
    文件里**是否还存在（旧文件此刻已不可达，只能从新文件核对）。见 SaveAsMigration。
    """
    projectSerial: str
    label: str = ""               # 空 = 用 hip 文件名显示（用户改名后才有值）
    hip: str = ""                 # 当前绑定的 hip 绝对路径（另存为迁移会更新）
    hipName: str = ""             # hip 文件名（服务端派生，便于前端直接显示）
    createdAt: float = 0.0        # 服务端权威：创建时写 now，不可变
    updatedAt: float = 0.0        # 成员增删 / 迁移时刷 now
    migratedAt: float = 0.0       # 最近一次另存为迁移的时刻（0 = 从未迁移）
    previousHip: str = ""         # 迁移前的 hip（审计用；只留最近一次）
    members: list[ChannelRef] = Field(default_factory=list)   # 通道引用快照（live 状态以 /api/channels 大全为准）


class SaveAsMigration(BaseModel):
    """另存为迁移结果（POST /api/projects/migrate）。

    触发：某成员 cook 时上报的 hip ≠ 项目当前 `hip`。
    语义：**换绑文件 + 按新文件核对成员**——在新 hip 里仍存在的成员留下（重新登记），
    找不到的移出（它属于旧文件，那份关系已经断了）。pid/端口不变，不重新发现实例。
    快照目录随项目 serial 走，所以迁移**不动快照**，只改绑定。
    """
    projectSerial: str
    fromHip: str = ""
    toHip: str = ""
    kept: list[str] = Field(default_factory=list)      # 新文件里仍存在 -> 保留的成员 key
    dropped: list[str] = Field(default_factory=list)   # 新文件里找不到 -> 移出的成员 key
    migrated: bool = False
    reason: str = ""


# ---------------------------------------------------------------------------
# 映射系统（v0.1.00114，见 devlog/project-mapping-design.md）
#
# 目的：node 侧只引用**相对地址（逻辑名）**，绝对 Houdini 路径只存在于映射系统。
# 锚点 = 吊牌 serial（创建即不可变，移动/改名不变——铁律 1），吊牌每次 cook 上报
# 自身 nodePath；锚点移动只改 anchors 一处，其下全部 entry 自动跟随。
#
# 解析规则：absolutePath = <锚点 nodePath 的所在网络> + "/" + entry.rel
#   （rel 以吊牌**所在网络**为基准 = 兄弟节点语义，不是吊牌自身路径）
# ---------------------------------------------------------------------------

# 端口/值类型：geo 走几何数据流；float/vec3 走映射系统按逻辑名读写。
MAPPING_TYPES = ("geo", "float", "vec3")


class AnchorRef(BaseModel):
    """映射锚点：一个吊牌的当前位置。serial 不可变，nodePath 可变（移动/改名）。

    pid / mcpPort（v0.1.00114）：吊牌 cook 时连自身 `os.getpid()` 与已发现的 MCP 端口
    一起上报，用于**降级前实证**。心跳只能证明「最近 cook 过」——吊牌长期不 cook 是
    正常的，所以心跳超时不等于失联。记下 pid+端口后，可直接 `mcp.health` 核对
    `pid == 记录的 pid`（铁律：pid 是唯一可靠判据），从而区分「只是没 cook」与「实例真没了」。
    """
    serial: str
    nodePath: str = ""
    hip: str = ""
    mode: str = "parm"            # 吊牌标记模式："parm" | "apex"
    lastSeen: float = 0.0         # 吊牌 cook 上报时刷新
    movedAt: float = 0.0          # nodePath 发生变化的最近时刻（0 = 从未移动）
    pid: int = 0                  # 该 Houdini 实例的进程号（0 = 未上报）
    mcpPort: int = 0              # 该实例的 fxhoudinimcp 端口（0 = 吊牌尚未发现）
    verifiedAt: float = 0.0       # 最近一次 pid 核对成功的时刻（探测刷新，非心跳）
    verifiedAlive: bool = False   # 最近一次探测结论（配合 verifiedAt 读）


class AnchorProbeResult(BaseModel):
    """锚点存活探测结果（GET /api/projects/{pid}/anchors/{serial}/probe）。

    alive=True 且 pidMatched=True 才是「确认活着」；alive=True 但 pidMatched=False
    说明该端口现在被**另一个** Houdini 占着（实例换了/重开了），不能当同一个实例用。"""
    serial: str
    alive: bool = False
    pidMatched: bool = False
    port: int = 0                 # 实际探到的端口（可能与记录的不同：按 hip 重新定位过）
    expectedPid: int = 0
    actualPid: int = 0
    hip: str = ""
    reason: str = ""


class MappingEntry(BaseModel):
    """一条逻辑名 -> 相对地址的映射（项目内唯一）。"""
    anchor: str                   # 锚点 serial（吊牌）
    rel: str                      # 相对锚点所在网络的地址，如 "transform1/tx"
    kind: str = "param"           # "param" | "data"
    adapter: str | None = None    # kind="data" 时的读写器名（如 "apex-ctrl"）
    type: str = "float"           # MAPPING_TYPES 之一
    label: str = ""


class MappingResolved(BaseModel):
    """解析结果：逻辑名 + 当前绝对路径（锚点缺失时 absolutePath 为空且 ok=False）。"""
    name: str
    absolutePath: str = ""
    kind: str = "param"
    adapter: str | None = None
    type: str = "float"
    anchor: str = ""
    ok: bool = True
    error: str = ""


class MappingsResponse(BaseModel):
    """GET /api/projects/{pid}/mappings 响应。"""
    projectSerial: str
    entries: dict[str, MappingEntry] = Field(default_factory=dict)
    anchors: dict[str, AnchorRef] = Field(default_factory=dict)
    resolved: dict[str, MappingResolved] = Field(default_factory=dict)


class AnchorMovedMsg(BaseModel):
    """WS 广播：锚点（吊牌）位置变化，其下逻辑名的绝对路径已改。
    web 侧无需改地址——逻辑名不变，仅用于提示与刷新。"""
    type: str = "anchor-moved"
    serial: str
    oldPath: str = ""
    newPath: str = ""
    names: list[str] = Field(default_factory=list)


class OutputsPut(BaseModel):
    """Web pushes edited output buffers."""
    outputs: list[OutputBuffer] = Field(default_factory=list)


class SyncEnabledPut(BaseModel):
    """PUT /api/hda/{serial}/sync-enabled body: manual two-way sync gate (web is source of truth)."""
    enabled: bool = True


# ---------------------------------------------------------------------------
# serial 能力查询（nodeview 单地址 + 下拉端口）
#
# 用户在 _input_/_output_ 节点只填**一个地址（serial）**，由桥回答「这个 serial 提供
# 什么端口」，UI 据此渲染下拉——不再把所有节点都画成固定 4 口。
# 同一个 serial 可能挂在多个 Houdini 节点上（用户有意为之，好让这些参数被集中管理），
# 所以「有什么端口」只能由桥的注册表回答，节点自己说不清。
# ---------------------------------------------------------------------------


class SerialPortOption(BaseModel):
    """下拉里的一个可选端口。

    key: 机器标识。hda = "in0".."in3" / "out0".."out3"（**0 基，与 web 图内部端口键
         一致，不能改**）；tag = 逻辑名（相对地址，如 "transform1/tx"）。
    label: 给人看的文本。hda 用 **1 基**（"In 1".."In 4"）——用户口语就是 in1-4。
    type: MAPPING_TYPES 之一；**"" = 类型未知**（脏值一律丢弃，不猜默认值：
          类型决定 UI 怎么连线与读写，猜一个等于对前端撒谎）。
    """
    key: str
    label: str = ""
    type: str = ""


class SerialCapabilities(BaseModel):
    """GET /api/serials/{serial}/capabilities 响应。

    known=False（kind=""、两个列表皆空）= 该 serial 未在任何注册表出现。这是**正常
    状态**而非错误：用户是逐字输入地址的，半截地址必然查不到，所以本端点恒返回
    200，绝不 404——否则每敲一个键都变成一次报错。
    """
    serial: str
    kind: str = ""              # "hda" | "tag" | "" = 未知/未注册
    known: bool = False
    nodePath: str = ""
    hip: str = ""
    inputs: list[SerialPortOption] = Field(default_factory=list)
    outputs: list[SerialPortOption] = Field(default_factory=list)
