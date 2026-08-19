"""Unified path system + file snapshot (schema v2).

Rules (devlog/snapshot-design.md + scene-snapshot-research.md):
- Logical path: cyl://<serial>/<domain>, physical paths fully derivable from
  registry[serial].hip (the ONLY context variable) - never parse .hda/.hip.
- Snapshot root (v0.1.00122): <hip-dir>/Cyl1nder/<hipstem>_<P1-pid>/members/<serial>/
  成员**嵌在项目目录里**，不再与项目目录并列。解析不出 project id 时退回
  v0.1.00117 的兄弟目录 <hip-dir>/Cyl1nder/<hipstem>_<serial>/；无 hip 时
  fallback bridge/data/snapshots/<serial>/。
- Fixed file names (NO serial prefix) under per-domain folders:
    io/inputs.json          geometry input cache
    io/outputs.json         geometry output cache
    scene/meta.json         identity + rev metadata
    scene/node-parm.json    per-node parameters (absolute path keyed)
    scene/node-graph.json   **只读不写**（v0.1.00122）：成员图归项目所有
                            （项目目录的 graph.json）。旧存档仍读得到。
    docking-layout.json     dockview desktop layout
    Preference.json         web preferences ({"schemaVersion":1,"sync_max_fps":30,"update_mode":"auto"})
- Single writer (bridge only); atomic tmp+replace; content-compare before write (R5).
"""
from __future__ import annotations

import asyncio
import orjson
import os
import time
from pathlib import Path
from typing import Any

from .protocol import VERSION, InputPayload, OutputBuffer

DEFAULT_ROOT = Path(__file__).resolve().parent.parent / "data" / "snapshots"

# throttled workspace -> disk mirror (moved from routes.py; >=5s cadence, R5 content-compare)
_SNAP_LAST: dict[str, float] = {}
_SNAP_THROTTLE = 5.0

# 每 serial 只提示一次的两个 set（v0.1.00122）。cook 每次心跳都会走写快照这条路，
# 无节制地 log 会把日志淹掉；完全不 log 又会让「行为变了」不可见。
_GRAPH_IGNORED: set[str] = set()   # graph 部分被忽略（成员图归项目所有）
_ORPHAN_LOGGED: set[str] = set()   # 解析不出 project id，退回旧的兄弟目录

# fixed file names per part (no serial prefix - the serial is the folder)
#
# `graph` **仍留在这张表里**，因为它还要被**读**：既有存档里有 node-graph.json，
# 且 `GET /api/projects/{id}/graph` 的单成员缺省迁移读正是从这里取图（那是把旧成员图
# 接进项目的唯一通路）。写那侧在 `write_snapshot` 里显式跳过它。
_PARTS: dict[str, tuple[str, str]] = {
    "meta": ("scene", "meta.json"),
    "graph": ("scene", "node-graph.json"),
    "parm": ("scene", "node-parm.json"),
    "inputs": ("io", "inputs.json"),
    "outputs": ("io", "outputs.json"),
    "docking": (".", "docking-layout.json"),
    "preference": (".", "Preference.json"),
}


def scene_dir_name(hip: str, serial: str) -> str:
    """快照目录名：`<场景名>_<serial>`（v0.1.00117）。

    为什么带场景名：原来只有 `<serial>`，用户在文件管理器里看到一排
    `C1-msm6dsp7-ob6t` / `C1-msm006pg-8fz7`，无法分辨哪个属于哪个场景，也就无法
    安全地手工清理。加上 hip 名即可一眼归属。

    **serial 仍是唯一身份**，场景名只是给人看的前缀：hip 改名/另存为后目录名会变，
    但读取按 serial 兜底（见 `_legacy_roots`），所以旧目录仍然找得到。
    拿不到 hip 名时退回纯 serial（与旧格式一致）。
    """
    stem = _sanitize_dir_part(Path(hip).stem if hip else "")
    return f"{stem}_{serial}" if stem else serial


_UNSAFE_DIR_CHARS = '<>:"/\\|?*'


def _sanitize_dir_part(name: str) -> str:
    """把 hip 名清成可安全做目录名的片段。

    只保留可打印字符，替换 Windows 非法字符与控制字符为 `_`，去掉首尾空白与点
    （Windows 不允许目录名以点/空格结尾），并限长 64 以免路径超长。
    清理后为空则返回空串，由调用方退回纯 serial。
    """
    out = []
    for ch in (name or "").strip():
        out.append("_" if (ch in _UNSAFE_DIR_CHARS or ord(ch) < 32) else ch)
    return "".join(out).strip(" .")[:64]


def _log_once(bucket: set[str], serial: str, message: str) -> None:
    """每 serial 一次的 info 日志。取 state 失败一律吞掉：日志绝不能让写快照失败。"""
    if serial in bucket:
        return
    bucket.add(serial)
    try:
        from .state import get_state  # local import: avoids a module-level cycle

        get_state().logs.info("snapshot", message, serial)
    except Exception:  # noqa: BLE001 - 日志失败不能阻断快照读写
        pass


def resolve_project_id(hip: str, serial: str) -> str:
    """这个成员该挂在哪个项目下 -> `P1-…`，解析不出返回 `""`。

    **绝不编造 project id**（用户明令）：查不到就返回空串，由调用方退回旧路径。

    两条依据，都要求 hip 一致，顺序是刻意的：
    ① `find_by_hip(hip)` —— 目录是按 hip 落的，「拥有这个 hip 文件的项目」正是
       它旁边那个 `<hipstem>_<P1-…>/`。这是主依据。
    ② 成员表里含该 serial、且项目 hip 归一后与传入 hip 相同（或项目 hip 为空，
       即尚未回填的旧记录）。补上 ① 漏掉的情况。

    为什么 ② 必须校验 hip：否则一个 serial 在别的 hip 下的项目里当过成员，就会把
    快照写进「另一个场景旁边的目录」——那比不迁移更糟。
    取不到 state / 任何异常 -> `""`：路径解析绝不能抛（读路径也走这里）。
    """
    if not hip or not serial:
        return ""
    try:
        from .houdini_mcp import normalize_hip
        from .state import get_state  # local import: avoids a module-level cycle

        st = get_state()
        owner = st.projects.find_by_hip(hip)
        if owner is not None and owner.get("projectSerial"):
            return str(owner["projectSerial"])
        norm = normalize_hip(hip)
        for project in st.projects.list():
            pid = project.get("projectSerial") or ""
            if not pid:
                continue
            phip = normalize_hip(project.get("hip") or "")
            if phip and phip != norm:
                continue
            for m in project.get("members") or []:
                if (m.get("serial") or "").strip() == serial:
                    return str(pid)
    except Exception:  # noqa: BLE001 - 解析不出就退回旧路径，绝不抛穿
        return ""
    return ""


MEMBERS_DIR = "members"


def member_root(hip: str, serial: str, project_id: str) -> Path:
    """成员快照目录：`<hip目录>/Cyl1nder/<hipstem>_<pid>/members/<serial>/`（v0.1.00122）。

    成员**嵌在项目里**，不再是项目目录的兄弟——用户原话：「它应该被包含在项目中而不是
    单独一个节点的 serial 出现，这是早期的设计而且应该被根除了」。

    目录名与项目图共用 `project_scene_dir_name`（同一个项目目录，别算出两个名字）。
    hip 为空/非绝对 -> 退回 `DEFAULT_ROOT/<serial>`（无 hip 时本就没有项目目录可挂）。
    """
    if not hip or not project_id:
        return DEFAULT_ROOT / serial
    hip_dir = Path(hip).parent
    if not hip_dir.is_absolute():
        return DEFAULT_ROOT / serial
    return hip_dir / "Cyl1nder" / project_scene_dir_name(hip, project_id) / MEMBERS_DIR / serial


def snapshot_root(hip: str, serial: str, project_id: str | None = None) -> Path:
    """成员快照目录。v0.1.00122 起嵌在项目目录下（见 member_root）。

    `project_id` 缺省时自行解析（`resolve_project_id`）；**解析不出就退回
    v0.1.00117 的兄弟目录 `<hipstem>_<serial>/` 并 log 一次**，绝不编造 pid。
    退回不是摆设：`put_inputs` 第一次写快照时项目可能还没 ensure 出来（web 的
    ensureProject / 心跳 bind_serial_to_hip 都在之后），此时只能落旧路径，
    下一次写入解析到 pid 后再由 `migrate_member_snapshot_dir` 迁进去。

    环境变量覆盖仍是**扁平 `<root>/<serial>`**（测试隔离目录不需要项目层次，
    且既有测试逐字依赖这个形状）。
    """
    env = os.environ.get("CYL1NDER_SNAPSHOT_ROOT")
    if env:
        return Path(env) / serial
    if hip:
        hip_dir = Path(hip).parent
        if hip_dir.is_absolute():
            pid = resolve_project_id(hip, serial) if project_id is None else project_id
            if pid:
                return member_root(hip, serial, pid)
            _log_once(
                _ORPHAN_LOGGED,
                serial,
                "no project bound yet; member snapshot stays at the legacy sibling dir "
                f"({scene_dir_name(hip, serial)}) until a project owns this hip",
            )
            return hip_dir / "Cyl1nder" / scene_dir_name(hip, serial)
    return DEFAULT_ROOT / serial


def _part_path(root: Path, part: str) -> Path:
    folder, name = _PARTS[part]
    return (root / folder / name) if folder != "." else (root / name)


def _read_root(root: Path, serial: str) -> dict[str, Any]:
    """Read every snapshot part present under one root (schema v2 fixed names, v1 legacy fallback)."""
    out: dict[str, Any] = {}
    if not root.exists():
        return out
    for part in _PARTS:
        p = _part_path(root, part)
        if p.exists():
            try:
                out[part] = orjson.loads(p.read_text(encoding="utf-8"))
                continue
            except (OSError, ValueError):
                pass
        # v1 legacy: <serial>.<part>.json in the root folder
        legacy = root / f"{serial}.{part}.json"
        if legacy.exists():
            try:
                out[part] = orjson.loads(legacy.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
    return out


def read_snapshot(hip: str, serial: str) -> dict[str, Any] | None:
    """Dual-root merge read: the hip-derived root wins, DEFAULT_ROOT/serial fills missing parts.

    This reconciles the split that happens when the registry's hip is temporarily
    empty at write time (snapshot lands in the fallback root) but is later set
    (snapshot lands next to the .hip): reading only one root used to miss the other.
    Both roots keep the schema-v2 fixed names + v1 legacy filename fallback.
    """
    primary = snapshot_root(hip, serial)
    merged = _read_root(primary, serial)
    # 旧目录兜底：v0.1.00117 把目录名从 `<serial>` 改成 `<场景名>_<serial>`，
    # 不兜底的话所有既有快照会在改名当天全部读不到（等于凭空造一次数据丢失）。
    # 另存为后场景名变了、旧名目录仍在，同样靠这条找回。
    for legacy in _legacy_roots(hip, serial):
        if legacy == primary:
            continue
        for part, value in _read_root(legacy, serial).items():
            merged.setdefault(part, value)
    return merged if merged else None


def migrate_snapshot_dir(hip: str, serial: str) -> str:
    """把该 serial 的旧命名目录**就地改名**成 `<场景名>_<serial>`。

    返回值仅供日志/测试：`""` 无事可做、`"renamed"` 已迁移、`"skipped:<原因>"`。

    纪律：
    - 目标已存在 → 不动（`skipped:target-exists`）。不合并、不覆盖——两边都可能有
      用户数据，合并语义得由人来定。
    - 改名失败（占用/权限）→ 吞掉返回 `skipped:oserror`。**绝不因此阻断写入**：
      新目录照常创建，读取那侧有 `_legacy_roots` 兜底，最坏情况只是多一个旧目录。
    - 只改名 hip 同侧的目录；`bridge/data/snapshots` 回退根不动（那是无 hip 时的落点，
      本就没有场景名可用）。

    v0.1.00122：这一步只负责 **裸 `<serial>` → 兄弟 `<场景名>_<serial>`**。目标路径
    显式传 `project_id=""` 求得，**不允许**它随 pid 解析漂到 `members/` 里去——
    「兄弟目录 → 项目内」是 `migrate_member_snapshot_dir` 的职责。两个函数各管一段，
    否则同一个名字在有无项目时做两件不同的事，下一轮没人说得清它到底迁到哪。
    """
    if not hip:
        return ""
    hip_dir = Path(hip).parent
    if not hip_dir.is_absolute():
        return ""
    target = snapshot_root(hip, serial, "")
    legacy = hip_dir / "Cyl1nder" / serial
    if target == legacy or not legacy.is_dir():
        return ""
    if target.exists():
        return "skipped:target-exists"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        legacy.rename(target)
        return "renamed"
    except OSError:
        return "skipped:oserror"


def migrate_member_snapshot_dir(hip: str, serial: str, project_id: str) -> str:
    """把成员快照从**兄弟目录**就地改名进 `<项目目录>/members/<serial>/`（v0.1.00122）。

    返回值仅供日志/测试：`""` 无事可做、`"renamed"` 已迁移、`"skipped:<原因>"`。
    纪律逐条照 `migrate_project_graph_dir`（同一套语义，别另造一套）：
    - 无 hip / 无 pid / hip 非绝对 -> `""`
    - 目标已存在 -> `skipped:target-exists`。**不合并、不覆盖**——两边都可能有用户数据。
    - 改名失败（占用/权限）-> 吞掉返回 `skipped:oserror`，**绝不阻断写入**：
      读那侧有 `_legacy_roots` 兜底，最坏情况只是多留一个旧目录。

    源目录优先级：`<场景名>_<serial>`（v0.1.00117）→ 裸 `<serial>`（v0.1.00116 及更早）。
    两个都在时只迁第一个，另一个留给下一次调用——一次只做一件可解释的事。
    """
    if not hip or not project_id:
        return ""
    hip_dir = Path(hip).parent
    if not hip_dir.is_absolute():
        return ""
    base = hip_dir / "Cyl1nder"
    target = member_root(hip, serial, project_id)
    source = next(
        (d for d in (base / scene_dir_name(hip, serial), base / serial) if d != target and d.is_dir()),
        None,
    )
    if source is None:
        return ""
    if target.exists():
        return "skipped:target-exists"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        source.rename(target)
        return "renamed"
    except OSError:
        return "skipped:oserror"


def _legacy_roots(hip: str, serial: str) -> list[Path]:
    """该 serial 可能存在的历史快照目录（按优先级）。

    ① hip 同侧的纯 `<serial>` 目录（v0.1.00116 及更早的命名）
    ② hip 同侧任何以 `_<serial>` 结尾的目录（v0.1.00117 的 `<场景名>_<serial>` 兄弟目录）
    ③ **任意项目目录下的 `members/<serial>/`**（v0.1.00122 起的新位置）——
       含「项目被删/重建后 pid 变了」的情况：解析到的 pid 与盘上那个不同时，
       不扫这一条就会把一份好快照读成 None（穿着迁移外衣的数据丢失）。
    ④ bridge/data/snapshots/<serial>（hip 为空时写入的回退根）
    """
    roots: list[Path] = []
    if hip:
        hip_dir = Path(hip).parent
        if hip_dir.is_absolute():
            base = hip_dir / "Cyl1nder"
            roots.append(base / serial)
            try:
                suffix = f"_{serial}"
                for d in base.iterdir():
                    if not d.is_dir():
                        continue
                    if d.name.endswith(suffix):
                        roots.append(d)
                    nested = d / MEMBERS_DIR / serial
                    if nested.is_dir():
                        roots.append(nested)
            except OSError:
                pass
    roots.append(DEFAULT_ROOT / serial)
    return roots


def write_snapshot(
    serial: str,
    hip: str,
    *,
    meta: dict[str, Any] | None = None,
    graph: dict[str, Any] | None = None,
    parm: dict[str, Any] | None = None,
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    docking: dict[str, Any] | None = None,
    preference: dict[str, Any] | None = None,
) -> bool:
    """Atomically write snapshot parts under io/ scene/ + docking-layout.json + Preference.json.
    Returns True if anything changed on disk.

    v0.1.00122 两处变化：
    - 目录嵌进项目：`<项目目录>/members/<serial>/`（见 snapshot_root / member_root）；
      解析不出 project id 时退回旧的兄弟目录，行为与 v0.1.00117 逐字相同。
    - **`graph` 一律不写**（accept-but-ignore + 每 serial 一条 log）：成员图归项目所有。
      仍接受该参数、仍返回 200 —— 老版 web 还在发它，硬报错会打断 cook 推送。
    """
    pid = resolve_project_id(hip, serial)
    if pid:
        migrate_member_snapshot_dir(hip, serial, pid)   # 兄弟目录 -> 项目内（best-effort）
    else:
        migrate_snapshot_dir(hip, serial)               # 无项目时仍做 v0.1.00117 那步改名
    root = snapshot_root(hip, serial, pid)   # 传 pid 本身（"" = 无项目），不要再解析一次
    try:
        root.mkdir(parents=True, exist_ok=True)
        (root / "io").mkdir(exist_ok=True)
        (root / "scene").mkdir(exist_ok=True)
    except OSError:
        return False
    if graph is not None:
        # accept-but-ignore：收下、不写、每 serial 提示一次（见本函数 docstring）。
        _log_once(
            _GRAPH_IGNORED,
            serial,
            "graph part ignored (member graphs are project-owned since v0.1.00122)",
        )
    wrote = False
    parts: dict[str, Any] = {
        "meta": meta,
        "parm": parm,
        "inputs": inputs,
        "outputs": outputs,
        "docking": docking,
        "preference": preference,
    }
    for part, payload in parts.items():
        if payload is None:
            continue
        target = _part_path(root, part)
        # content compare (R5): skip write when unchanged
        try:
            if target.exists() and orjson.loads(target.read_text(encoding="utf-8")) == payload:
                continue
        except (OSError, ValueError):
            pass
        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(orjson.dumps(payload, option=orjson.OPT_INDENT_2).decode("utf-8"), encoding="utf-8")
        tmp.replace(target)
        wrote = True
    return wrote


def build_meta(serial: str, hip: str, node_path: str, version: str, input_rev: int, output_rev: int) -> dict[str, Any]:
    return {
        "schemaVersion": 2,
        "serial": serial,
        "hip": hip,
        "nodePath": node_path,
        "version": version,
        "inputRev": input_rev,
        "outputRev": output_rev,
        "savedAt": time.time(),
        "snapshotId": f"{serial}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}",
    }


async def maybe_snapshot(serial: str) -> None:
    """Persist inputs/outputs snapshot on data change, throttled to avoid cook storms.

    Shared by the REST put paths (routes.py) and the WS edit path (ws.py): the WS
    branch is the web's primary edit channel, so it MUST snapshot too, otherwise
    io/outputs.json stays empty and a bridge restart loses every edit.
    """
    from .state import get_state  # local import: avoids a module-level cycle

    st = get_state()
    rec = st.registry.get(serial)
    if rec is None:
        return
    now = time.time()
    if now - _SNAP_LAST.get(serial, 0.0) < _SNAP_THROTTLE:
        return
    _SNAP_LAST[serial] = now
    ws = st.workspaces.get_or_create(serial)
    # disk I/O off the event loop: blocks would delay WS broadcast / stream wake
    await asyncio.to_thread(
        write_snapshot,
        serial,
        rec.hip,
        meta=build_meta(serial, rec.hip, rec.nodePath, VERSION, ws.input_rev, ws.output_rev()),
        inputs=[i.model_dump() for i in ws.inputs],
        outputs=[o.model_dump() for o in ws.all_outputs()],
    )


def restore_workspace(serial: str, hip: str) -> bool:
    """Restore inputs/outputs into a workspace that is completely empty.

    Only ever touches a workspace with no inputs AND no outputs, so a live
    workspace is never overwritten. Reads the merged disk snapshot and validates
    each entry (bad entries are skipped + logged, never raise). Returns True when
    any data was restored.
    """
    from .state import get_state  # local import: avoids a module-level cycle

    st = get_state()
    existing = st.workspaces.get(serial)
    if existing is not None and (existing.inputs or existing.all_outputs()):
        return False
    snap = read_snapshot(hip, serial)
    if snap is None:
        return False

    valid_inputs: list[InputPayload] = []
    raw_inputs = snap.get("inputs")
    if isinstance(raw_inputs, list):
        for item in raw_inputs:
            try:
                valid_inputs.append(InputPayload.model_validate(item))
            except Exception as exc:  # noqa: BLE001 - one bad entry must not kill the restore
                st.logs.error("snapshot", f"skip invalid input snapshot entry: {exc}", serial)

    valid_outputs: list[OutputBuffer] = []
    raw_outputs = snap.get("outputs")
    if isinstance(raw_outputs, list):
        for item in raw_outputs:
            try:
                valid_outputs.append(OutputBuffer.model_validate(item))
            except Exception as exc:  # noqa: BLE001 - one bad entry must not kill the restore
                st.logs.error("snapshot", f"skip invalid output snapshot entry: {exc}", serial)

    if not valid_inputs and not valid_outputs:
        return False
    ws = st.workspaces.get_or_create(serial)
    if valid_inputs:
        ws.set_inputs(valid_inputs)
    if valid_outputs:
        ws.put_outputs(valid_outputs)
    st.logs.info(
        "snapshot",
        f"workspace restored from disk snapshot (inputs={len(valid_inputs)} outputs={len(valid_outputs)})",
        serial,
    )
    return True


def restore_all_workspaces() -> int:
    """Restore every registry serial whose workspace is empty (startup scenario B).

    Returns the number of serials that were actually restored.
    """
    from .state import get_state  # local import: avoids a module-level cycle

    st = get_state()
    restored = 0
    for rec in st.registry.list():
        if restore_workspace(rec.serial, rec.hip):
            restored += 1
    return restored


def flush_workspace(serial: str) -> bool:
    """Synchronously force-write the current workspace inputs/outputs + meta to disk.

    Empty workspaces are skipped. Returns True when anything was written.
    """
    from .state import get_state  # local import: avoids a module-level cycle

    st = get_state()
    rec = st.registry.get(serial)
    if rec is None:
        return False
    ws = st.workspaces.get(serial)
    if ws is None:
        return False
    if not ws.inputs and not ws.all_outputs():
        return False
    return write_snapshot(
        serial,
        rec.hip,
        meta=build_meta(serial, rec.hip, rec.nodePath, VERSION, ws.input_rev, ws.output_rev()),
        inputs=[i.model_dump() for i in ws.inputs],
        outputs=[o.model_dump() for o in ws.all_outputs()],
    )


def flush_all_workspaces() -> None:
    """Flush every registry serial's workspace to disk (shutdown catch-up)."""
    from .state import get_state  # local import: avoids a module-level cycle

    st = get_state()
    for rec in st.registry.list():
        flush_workspace(rec.serial)


# --- 项目图（P2b，见 devlog/tag-hda-plan.md P2b）-------------------------------
# 原子写模式照 write_snapshot（tmp+replace + 内容对比）。
#
# v0.1.00120 起**落在 hip 旁**：`<hip目录>/Cyl1nder/<hip名>_<P1-…>/graph.json`。
# 旧注释写「项目无单一 hip 上下文」——自 v0.1.00116「项目 = 一个 hip 文件」之后那句
# 就不成立了：项目有且只有一个当前绑定的 hip。放回 hip 旁的理由是用户能在文件管理器里
# 按场景归属清理（此前 `bridge/data/projects/<pid>/` 里一排 P1- 目录，看不出属于哪个场景）。
# 无 hip 绑定（尚未 cook 过的空项目）时退回 `data_dir/projects/<pid>/`。


def project_scene_dir_name(hip: str, project_id: str) -> str:
    """项目图目录名：`<hip名>_<P1-…>`。与 per-serial 的 scene_dir_name 同款命名，
    但用**项目** serial —— 用户要看到的是 `beginTest-2_P1-…`，不是成员的 `C1-…`。"""
    stem = _sanitize_dir_part(Path(hip).stem if hip else "")
    return f"{stem}_{project_id}" if stem else project_id


def project_graph_root(data_dir, project_id: str, hip: str = "") -> Path:
    """项目图目录。hip 非空 → `<hip目录>/Cyl1nder/<hip名>_<pid>/`；否则退回 data_dir。

    退回分支不是兜底摆设：项目可以先被建出来（`POST /api/projects`）、之后才由成员
    cook 带上 hip，那段时间它确实没有 hip 上下文可依。
    """
    if hip:
        hip_dir = Path(hip).parent
        if hip_dir.is_absolute():
            return hip_dir / "Cyl1nder" / project_scene_dir_name(hip, project_id)
    return data_dir / "projects" / project_id


def project_graph_path(data_dir, project_id: str, hip: str = "") -> Path:
    """项目图文件路径（见 project_graph_root）。`hip` 缺省保持旧路径，
    因此所有尚未传 hip 的既有调用点行为逐字不变。"""
    return project_graph_root(data_dir, project_id, hip) / "graph.json"


def migrate_project_graph_dir(data_dir, project_id: str, hip: str) -> str:
    """把项目图从旧位置 `data_dir/projects/<pid>/` **就地改名**到 hip 旁的新位置。

    返回值仅供日志/测试：`""` 无事可做、`"renamed"` 已迁移、`"skipped:<原因>"`。
    纪律逐条照 `migrate_snapshot_dir`（同一套语义，别另造一套）：
    - 无 hip / hip 非绝对路径 → `""`（新旧位置相同，没有迁移可言）
    - 目标已存在 → `skipped:target-exists`。**不合并、不覆盖**——两边都可能有用户数据，
      合并语义得由人来定。
    - 改名失败（占用/权限）→ 吞掉返回 `skipped:oserror`，**绝不阻断读写**：
      读那侧有旧位置兜底，最坏情况只是多留一个旧目录。
    """
    if not hip:
        return ""
    legacy = data_dir / "projects" / project_id
    target = project_graph_root(data_dir, project_id, hip)
    if target == legacy or not (legacy / "graph.json").exists():
        return ""
    if target.exists():
        return "skipped:target-exists"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        legacy.rename(target)
        return "renamed"
    except OSError:
        return "skipped:oserror"


def read_project_graph(data_dir, project_id: str, hip: str = "") -> dict | None:
    """读项目图；文件缺失/损坏（OSError/ValueError）→ None。

    `hip` 非空时先尝试把旧位置的图迁到 hip 旁（best-effort），再读新位置；新位置没有
    则回落旧位置。**迁移与 hip 感知必须同时落地**：只迁不改读会把一张好图变成 API
    报 null 的图——那是穿着迁移外衣的数据丢失。
    """
    if hip:
        migrate_project_graph_dir(data_dir, project_id, hip)
    for candidate in _project_graph_candidates(data_dir, project_id, hip):
        try:
            data = orjson.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(data, dict):
            return data
    return None


def _project_graph_candidates(data_dir, project_id: str, hip: str) -> list[Path]:
    """读取候选路径：hip 旁优先，旧位置兜底（去重且保序）。"""
    paths = [project_graph_path(data_dir, project_id, hip)]
    legacy = project_graph_path(data_dir, project_id)
    if legacy not in paths:
        paths.append(legacy)
    return paths


def write_project_graph(data_dir, project_id: str, graph: dict, hip: str = "") -> None:
    """原子写（tmp+replace）+ 内容对比（与现文件相同则跳过）；mkdir parents。

    `hip` 非空 → 写 hip 旁的新位置（并先尽力迁移旧目录，避免两处各留半份）。
    缺省 `""` 保持旧路径，故既有调用点行为逐字不变。
    """
    if hip:
        migrate_project_graph_dir(data_dir, project_id, hip)
    target = project_graph_path(data_dir, project_id, hip)
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        if target.exists() and orjson.loads(target.read_text(encoding="utf-8")) == graph:
            return
    except (OSError, ValueError):
        pass
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(orjson.dumps(graph, option=orjson.OPT_INDENT_2).decode("utf-8"), encoding="utf-8")
    tmp.replace(target)
