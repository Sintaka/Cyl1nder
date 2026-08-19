"""吊牌 HDA 项目路由（项目 = 一个 hip 文件，见 devlog/protocol.md「项目 = hip 文件」）。

- POST   /api/projects                         建项目（body {label?, hip?}）-> {ok, project}
- GET    /api/projects                         项目列表（按 createdAt 升序；**列前先扫测试残留**）
- GET    /api/projects/{projectId}             单项目
- PATCH  /api/projects/{projectId}             改名（body {label}）-> {ok, project}
- DELETE /api/projects/{projectId}             删项目（级联映射分区 + 项目图）-> {ok, removed}
- POST   /api/projects/cleanup                 删所有 0 成员项目 -> {ok, removed:[pid…]}
- POST   /api/projects/{projectId}/members     加成员（body = channelRef，按通道 key 去重）
- DELETE /api/projects/{projectId}/members     ?channelId= 移成员（query 而非 path，param 通道 key 含 "/"）
- POST   /api/projects/ensure                  body {serial, hip?}：按 hip 归拢成员（hip 缺省退回按 serial 查）
- POST   /api/projects/migrate                 body {projectSerial, toHip} -> SaveAsMigration（另存为换绑）
- GET    /api/projects/{projectId}/graph       项目图读（缺省迁移：单成员 -> 其 serial 快照 graph 部分，纯读）
- PUT    /api/projects/{projectId}/graph       项目图写（body {graph: dict}）-> {ok}

main.py 由主进程挂载本 router（本文件不改 main.py）。
"""
from __future__ import annotations

import asyncio
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import houdini_mcp, snapshot
from .channel_routes import _resolve_port
from .houdini_mcp import normalize_hip
from .projects import ProjectRegistry
from .protocol import ChannelRef, is_valid_project_serial, is_valid_serial
from .state import get_state

router = APIRouter()


def _check_project_serial(pid: str) -> None:
    if not is_valid_project_serial(pid):
        raise HTTPException(status_code=400, detail="invalid project serial")


def _drop_graph_dir(root: Path) -> None:
    """删掉一个项目图目录里的 graph.json(+tmp)，目录随之空了才删目录本身。

    只碰这两个文件名、只在目录**确实空了**时 rmdir：项目图目录与 per-serial 快照目录
    同住 `<hip目录>/Cyl1nder/` 之下，一个 rmtree 写错就会连带端掉兄弟快照。
    失败一律吞掉——清理附属物绝不能阻断项目记录本身的删除。

    v0.1.00122 起成员快照嵌在 `<项目目录>/members/<serial>/`，于是删项目后**目录通常
    不空、rmdir 不再发生**，只有 graph.json 被删掉。这是**刻意的**：成员的 io/scene
    快照是用户的几何与参数数据，不该随「删项目记录」被连带清掉（项目可以重建并按 hip
    重新归拢，见 `bind_serial_to_hip`）——**绝不在这里 rmtree**。

    附带说清楚谁也清不掉它：`POST /api/scenes/cleanup`（`scenes.cleanup_scenes`）只扫
    `_snapshot_base()`（`CYL1NDER_SNAPSHOT_ROOT` 或 `bridge/data/snapshots/`），
    **从不走 hip 同侧**，也不递归进 `members/`。所以 hip 旁的成员快照目前只能由用户
    手工删。要做「删项目连带删成员快照」得是显式新端点 + 用户确认，不在这里偷偷做。
    """
    try:
        (root / "graph.json").unlink(missing_ok=True)
        (root / "graph.json.tmp").unlink(missing_ok=True)
        if root.exists() and not any(root.iterdir()):
            root.rmdir()
    except OSError:
        pass


def _cascade_delete(pid: str, hip: str = "") -> None:
    """删项目的附属物：映射分区 + 项目图文件及其目录。

    mappings 由主进程在合并时挂到 state 上，未挂载时 no-op；
    删附属物失败不应阻断项目记录本身的删除。

    `hip` 必须由调用方在 `projects.delete()` **之前**取好：记录一删，hip 就再也查不到，
    hip 侧目录会变成永久垃圾。两处都删（hip 侧 + legacy `data_dir/projects/<pid>/`）是
    因为迁移是尽力而为的（目标已存在/目录被占用时 legacy 目录会留在原地），两边都得清。
    """
    st = get_state()
    mappings = getattr(st, "mappings", None)
    if mappings is not None and hasattr(mappings, "drop_project"):
        try:
            mappings.drop_project(pid)
        except Exception:  # noqa: BLE001 - 清理失败不阻断删除
            pass
    roots = {snapshot.project_graph_root(st.data_dir, pid, hip), snapshot.project_graph_root(st.data_dir, pid)}
    for root in roots:
        _drop_graph_dir(root)


def _member_probe_serial(member: dict) -> str:
    return (member.get("serial") or "").strip()


async def _probe_port_for(members: list[dict]) -> int:
    """拿任一成员的 serial 解析 MCP 端口（同一 hip = 同一个 Houdini 进程 = 同一端口）。
    解析本身失败也当「探测不到」（返回 0），绝不让它抛穿迁移。"""
    serial = next((s for s in (_member_probe_serial(m) for m in members) if s), "")
    if not serial:
        return 0
    try:
        return int(await asyncio.to_thread(_resolve_port, serial) or 0)
    except Exception:  # noqa: BLE001 - 端口解析失败 = 不可达，成员一律保留
        return 0


async def _verify_member_in_hip(member: dict, port: int) -> bool | None:
    """成员在**新 hip** 里是否还是它自己 -> True 存在且 serial 相符 / False 确认不在 / None 探测不到。

    三态是这个函数的全部意义：**只有 False 才允许移出成员**。探测不到（端口没解析出来、
    传输异常）返回 None，调用方必须保留——否则「Houdini 没开」会把用户的注册关系抹掉。
    复用 channel_routes 的探测口径（_resolve_port + houdini_mcp.rpc/nodes.get_node_info）。
    判据只看 cyl1nder_serial 是否仍相符（铁律 1：serial 不可变、复制即换号），不看节点类型——
    少一条依赖 MCP 返回形状的移出路径。
    """
    node_path = (member.get("nodePath") or "").strip()
    serial = _member_probe_serial(member)
    if not port or not node_path or not serial:
        return None
    try:
        result = await asyncio.to_thread(
            houdini_mcp.rpc, port, "nodes.get_node_info", {"node_path": node_path}, 4.0
        )
    except Exception:  # noqa: BLE001 - 传输失败 = 探测不到，绝不据此判定不存在
        return None
    if not isinstance(result, dict):
        return None
    if result.get("status") == "error" or result.get("error"):
        return False  # Houdini 答了「没这个节点」——这是确认，不是失败
    try:
        parm = await asyncio.to_thread(
            houdini_mcp.rpc, port, "parameters.get_parameter",
            {"node_path": node_path, "parm_name": "cyl1nder_serial"}, 4.0,
        )
    except Exception:  # noqa: BLE001 - 同上：读不到不等于不匹配
        return None
    if not isinstance(parm, dict) or parm.get("status") == "error" or parm.get("error"):
        return False  # 节点在，但没有 serial 参数 = 不是这块吊牌
    pdata = parm.get("data")
    value = pdata.get("value") if isinstance(pdata, dict) else pdata
    return str(value or "").strip() == serial


async def migrate_project_hip(pid: str, to_hip: str) -> dict:
    """另存为迁移（migrate 路由与心跳共用的唯一实现）-> SaveAsMigration dict。

    项目不存在返回 migrated=False + reason。目标 hip 与当前绑定归一后相同 -> 直接
    no-op（cook 每次心跳都报 hip，这条幂等路径必须便宜）。否则逐一按**新 hip** 核对
    成员：确认不在的移出（dropped），其余保留（kept）——包含探测不到的，见
    _verify_member_in_hip。
    """
    st = get_state()
    project = st.projects.get(pid)
    if project is None:
        return {
            "projectSerial": pid, "fromHip": "", "toHip": to_hip,
            "kept": [], "dropped": [], "migrated": False, "reason": "project not found",
        }
    from_hip = project.get("hip") or ""
    members = list(project.get("members") or [])
    keys = [ProjectRegistry._channel_key(m) for m in members]
    if normalize_hip(from_hip) == normalize_hip(to_hip):
        return {
            "projectSerial": pid, "fromHip": from_hip, "toHip": to_hip,
            "kept": keys, "dropped": [], "migrated": False,
            "reason": "already bound to this hip",
        }
    port = await _probe_port_for(members)
    kept: list[str] = []
    dropped: list[str] = []
    unverified = 0
    for member, key in zip(members, keys):
        verified = await _verify_member_in_hip(member, port)
        if verified is False:
            dropped.append(key)
            st.projects.remove_member(pid, key)
        else:
            kept.append(key)
            if verified is None:
                unverified += 1
    rebound = st.projects.rebind_hip(pid, to_hip)
    reason = f"save-as: rebound to {to_hip}"
    if unverified:
        reason += f"; {unverified} member(s) kept unverified (houdini unreachable)"
    st.trace.add(
        actor="bridge",
        action="register",
        channel=pid,
        target=to_hip,
        digest=f"save-as {from_hip or '(unbound)'} -> {to_hip}; kept {len(kept)}, dropped {len(dropped)}",
    )
    return {
        "projectSerial": pid,
        "fromHip": from_hip,
        "toHip": (rebound or {}).get("hip", to_hip),
        "kept": kept,
        "dropped": dropped,
        "migrated": True,
        "reason": reason,
    }


# --- 测试残留项目的自动清理（用户需求：「除了 begintest2 其它都是残留的测试场景」）---
#
# 残留是怎么来的：`ensure` 在 hip 查不到时会**建一个 label=serial 的无 hip 项目**
# （见 ensure_project 末尾那条兜底）。web/e2e 的 `projectForSerial()` 每个 spec 都会
# 对合成 serial 调一次 ensureProject，而合成 serial 在 registry 里没有 hip，
# 于是每跑一轮 e2e 就沉淀一批「hip 为空 + 单个占位成员」的项目。
# 实测 13 个项目里 12 个是这么来的。
#
# 为什么不能复用 /cleanup（0 成员）：残留**恰好各有 1 个成员**，0 成员判据一个都抓不到。

# 残留项目的保护期（秒）：更新时间在这个窗口内的一律不动。
#
# 这条不是保守起见，是**正确性必需**：新建项目（POST /api/projects）在成员加入之前，
# 形态与残留完全一致（hip 空、label 空/序列号、成员是占位或没有）。没有年龄门，
# 自动清理会把用户刚点「新建项目」的那个、以及 e2e 正在用的那个当场删掉
# （round9 的 `/?project=&member=` 用例就是先 ensure 再打开页面，中间隔着导航）。
RESIDUE_GRACE_S = 600.0


def _is_placeholder_member(member: dict) -> bool:
    """这个成员是 `member_ref_for` 的占位 ref，而不是真的通道成员吗？

    真成员来自 `channels.list()`，必然带 nodePath 或非零 registeredAt
    （`channels.register` 里 `rec["registeredAt"] = registered_at or now`，恒 > 0）。
    占位 ref 则是 member_ref_for 末尾那个字面量：路径全空、两个时间戳都是 0。
    """
    if (member.get("nodePath") or "").strip():
        return False
    if (member.get("absolutePath") or "").strip():
        return False
    return not (member.get("registeredAt") or 0.0) and not (member.get("lastSeen") or 0.0)


def is_residue_project(project: dict, registry=None, now: float | None = None) -> bool:
    """这个项目是「测试残留」吗 —— 下列条件**全部**满足才算，缺一不可。

    1. `hip` 为空：项目 = hip 文件（铁律/身份模型），没绑过文件的项目**不可能**是
       用户在 Houdini 里开的场景。这一条就是护住真项目的那道墙：`beginTest-2.hip`
       的 hip 非空，从第一条起就出局。
    2. 成员非空且**全是**占位 ref：0 成员的壳交给 `/cleanup`（用户显式点按钮），
       自动清理只碰「ensure 兜底合成出来的」那种。任何一个真通道成员 = 有真东西，
       立刻保留。
    3. label 没有人味：空串、或就是个序列号（C1-/P1- 尾巴）。用户改过名 = 有意图，
       改过名的一律留着。
    4. 更新时间早于保护期（见 RESIDUE_GRACE_S）。

    第 5 条（作为 1 的独立复核）：任一成员在 registry 里有非空 hip -> 保留。
    真项目的成员**也是**占位 ref（实测 `C1-msm6dsp7-ob6t` 的 nodePath 为空、
    registeredAt 为 0），所以条件 2 对它没有保护作用；而它在 registry 里带着
    `beginTest-2.hip`。这一条让「误删真项目」需要同时突破两道彼此独立的判据。
    传 registry=None 时跳过（纯判据可单测）。
    """
    if (project.get("hip") or "").strip():
        return False
    members = list(project.get("members") or [])
    if not members or not all(_is_placeholder_member(m) for m in members):
        return False
    label = (project.get("label") or "").strip()
    if label and not (is_valid_serial(label) or is_valid_project_serial(label)):
        return False
    stamp = max(float(project.get("updatedAt") or 0.0), float(project.get("createdAt") or 0.0))
    if (now if now is not None else time.time()) - stamp < RESIDUE_GRACE_S:
        return False
    if registry is not None:
        for m in members:
            serial = _member_probe_serial(m)
            if not serial:
                continue
            rec = registry.get(serial)
            if rec is not None and (getattr(rec, "hip", "") or "").strip():
                return False   # registry 说这个成员有真 hip -> 不是残留
    return True


def sweep_residue_projects() -> list[str]:
    """删掉所有残留项目 -> 被删的 pid 列表。级联与 DELETE 完全一致。

    best-effort：单个删除抛异常只吞掉（照 `_cascade_delete` 的先例——清理绝不能
    把调用方（项目列表）搞挂）。每次真删都埋 trace：自动删除用户可见记录这件事
    必须留痕，否则「我的项目怎么没了」无从追查。
    """
    st = get_state()
    registry = getattr(st, "registry", None)
    now = time.time()
    removed: list[str] = []
    for project in st.projects.list():
        pid = project.get("projectSerial") or ""
        if not pid or not is_residue_project(project, registry, now):
            continue
        try:
            hip = (st.projects.get(pid) or {}).get("hip") or ""   # 同 DELETE：删记录前取 hip
            if st.projects.delete(pid):
                _cascade_delete(pid, hip)
                removed.append(pid)
                st.trace.add(
                    actor="bridge",
                    action="register",
                    channel=pid,
                    target="residue-sweep",
                    digest=(
                        f"auto-removed residue project {pid} "
                        f"(label={project.get('label') or '(empty)'}, no hip, "
                        f"{len(project.get('members') or [])} placeholder member(s))"
                    ),
                )
        except Exception:  # noqa: BLE001 - 清理失败绝不能让项目列表挂掉
            pass
    return removed


def is_transient_hip(hip: str) -> bool:
    """这个 hip 是「用户没选过的临时文件」吗？—— 是则不许触发另存为换绑。

    Houdini 崩溃后恢复会话时，`hou.hipFile.path()` 会先报 `<名字>_recovered.hip`
    （崩溃恢复产物），未命名场景则报 `untitled.hip`。这两者都**不是用户执行的另存为**，
    但形态上与另存为完全一样（同一进程、hip 变了），迁移会把项目悄悄换绑到
    一个用户从未选择的文件上。

    实测踩到：Houdini 崩溃重启后，项目自动绑到 `beginTest-1_recovered.hip`，
    而用户的真实工作文件是 `beginTest-1.hip`。此后所有映射解析都指向恢复文件。

    只做保守判断（文件名形态），不碰内容：宁可漏判一次真的另存为（用户可手动迁移），
    也不能把崩溃产物当成用户意图。
    """
    name = (hip or "").replace("\\", "/").rsplit("/", 1)[-1].lower()
    if not name:
        return True
    if name == "untitled.hip":
        return True
    stem = name[:-4] if name.endswith(".hip") else name
    return stem.endswith("_recovered") or stem.endswith("_bak") or stem.endswith(".autosave")


def member_ref_for(serial: str, hip: str = "") -> dict:
    """给 serial 造成员 ref：通道大全里 kind=tag 优先、其次 hda（按 registeredAt 升序取首个），
    都没有则 hda 占位。心跳自动登记与 ensure 共用，避免两处口径漂移。"""
    channels = get_state().channels.list()  # 已按 registeredAt 升序
    tags = [c for c in channels if c.get("kind") == "tag" and c.get("serial") == serial]
    hdas = [c for c in channels if c.get("kind") == "hda" and c.get("serial") == serial]
    pool = tags if tags else hdas
    if pool:
        return dict(pool[0])
    return {
        "kind": "hda",
        "serial": serial,
        "nodePath": "",
        "absolutePath": None,
        "hip": hip,
        "label": serial,
        "registeredAt": 0.0,
        "lastSeen": 0.0,
    }


async def bind_serial_to_hip(serial: str, hip: str) -> tuple[dict | None, bool]:
    """把 serial 归到「hip 这个文件」的项目里；必要时先迁移旧项目 -> (project, created)。

    顺序是关键：**先查另存为再 ensure**。若该 serial 现在挂在另一个 hip 不同的项目下，
    那就是这个文件被另存为了——先把旧项目换绑过来，ensure 随后即命中同一个项目，
    不会另建一个（否则又回到「两个项目共享同一成员」的老毛病）。
    唯一例外：目标 hip 已经有主了，此时旧记录只是过期，把成员从旧项目摘掉即可。
    """
    st = get_state()
    for project in st.projects.list():
        pid = project.get("projectSerial") or ""
        if not pid or not any(_member_probe_serial(m) == serial for m in project.get("members") or []):
            continue
        if normalize_hip(project.get("hip") or "") == normalize_hip(hip):
            continue
        if is_transient_hip(hip):
            # 崩溃恢复 / untitled：形态像另存为，但不是用户意图。保持原绑定不动，
            # 成员照旧留在原项目里（见 is_transient_hip 的实测案例）。
            return st.projects.get(pid), False
        if st.projects.find_by_hip(hip) is not None:
            # 目标 hip 已有主 -> 旧项目这份登记只是过期，按各自通道 key 摘掉
            # （param 成员的 key 是 absolutePath，不是 serial）。
            # 先把 key 收集成独立列表：list() 是浅拷贝，members 与实表同一个 list，
            # 边删边遍历会漏项。
            stale_keys = [
                ProjectRegistry._channel_key(m)
                for m in list(project.get("members") or [])
                if _member_probe_serial(m) == serial
            ]
            for key in stale_keys:
                st.projects.remove_member(pid, key)
        else:
            await migrate_project_hip(pid, hip)
    if is_transient_hip(hip):
        # 崩溃恢复 / untitled 不建项目：否则每次崩溃重启都多出一个用户没选过的
        # `*_recovered.hip` 项目，正是「项目列表很乱」的来源之一。
        existing = next(
            (
                p for p in st.projects.list()
                if any(_member_probe_serial(m) == serial for m in p.get("members") or [])
            ),
            None,
        )
        return existing, False
    project, created = st.projects.ensure_for_hip(hip)
    return st.projects.add_member(project["projectSerial"], member_ref_for(serial, hip)), created


class ProjectCreateBody(BaseModel):
    label: str = ""
    hip: str = ""


class ProjectPatchBody(BaseModel):
    label: str


class EnsureBody(BaseModel):
    serial: str
    hip: str = ""      # 给了就按 hip 归拢；缺省（旧 HDA / 旧前端）退回按 serial 查


class MigrateBody(BaseModel):
    projectSerial: str
    toHip: str = ""


class GraphPutBody(BaseModel):
    graph: dict


@router.post("/api/projects")
async def create_project(body: ProjectCreateBody) -> dict:
    project = get_state().projects.create(body.label, body.hip)
    return {"ok": True, "project": project}


@router.get("/api/projects")
async def list_projects() -> dict:
    """项目列表（按 createdAt 升序）；**列之前先扫掉测试残留**（见 is_residue_project）。

    为什么挂在这个 GET 上（而不是心跳/cook 侧）：用户的抱怨是「打开列表看到一堆垃圾」，
    而这里是所有 UI（overview 项目区、nodeview 项目根、e2e）取项目的唯一入口——
    在此扫，残留就再也没机会露面，且不依赖 Houdini 是否开着（挂在 cook 路径上的话，
    Houdini 关着时列表永远是脏的）。

    代价与取舍要说明白：GET 因此**有副作用**。可接受的理由是判据只读内存里的项目表
    （项目数量级个位数到几十）、稳态下一个都不匹配时零写入，且删除是幂等的
    （删完再列还是同一份结果）。RESIDUE_GRACE_S 的年龄门保证「刚新建/正在用」的项目
    绝不会被这条读路径吃掉。
    """
    sweep_residue_projects()
    return {"projects": get_state().projects.list()}


@router.get("/api/projects/{projectId}")
async def get_project(projectId: str) -> dict:
    _check_project_serial(projectId)
    project = get_state().projects.get(projectId)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return {"ok": True, "project": project}


@router.patch("/api/projects/{projectId}")
async def rename_project(projectId: str, body: ProjectPatchBody) -> dict:
    """改项目名（刷 updatedAt）。"""
    _check_project_serial(projectId)
    project = get_state().projects.set_label(projectId, body.label)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return {"ok": True, "project": project}


@router.delete("/api/projects/{projectId}")
async def delete_project(projectId: str) -> dict:
    """删项目（级联：映射分区 + 项目图文件）；项目不存在 -> removed False。"""
    _check_project_serial(projectId)
    st = get_state()
    # 先取 hip 再删记录：删完就查不到 hip，hip 侧目录会变成永久垃圾。
    hip = (st.projects.get(projectId) or {}).get("hip") or ""
    removed = st.projects.delete(projectId)
    if removed:
        _cascade_delete(projectId, hip)
    return {"ok": True, "removed": removed}


@router.post("/api/projects/cleanup")
async def cleanup_projects() -> dict:
    """清空壳项目：删掉所有 0 成员项目（有成员的一律保留），级联同 DELETE。"""
    st = get_state()
    removed: list[str] = []
    for pid in st.projects.list_empty():
        hip = (st.projects.get(pid) or {}).get("hip") or ""  # 同 DELETE：删记录前取 hip
        if st.projects.delete(pid):
            _cascade_delete(pid, hip)
            removed.append(pid)
    return {"ok": True, "removed": removed}


@router.post("/api/projects/{projectId}/members")
async def add_member(projectId: str, ref: ChannelRef) -> dict:
    _check_project_serial(projectId)
    project = get_state().projects.add_member(projectId, ref.model_dump())
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return {"ok": True, "project": project}


@router.delete("/api/projects/{projectId}/members")
async def remove_member(projectId: str, channelId: str) -> dict:
    """channelId 是 query 参数（param 通道 key = absolutePath 含 "/"），成员不存在也 ok。"""
    _check_project_serial(projectId)
    st = get_state()
    if st.projects.get(projectId) is None:
        raise HTTPException(status_code=404, detail="project not found")
    st.projects.remove_member(projectId, channelId)
    return {"ok": True, "project": st.projects.get(projectId)}


@router.post("/api/projects/ensure")
async def ensure_project(body: EnsureBody) -> dict:
    """按 hip 归拢：找到该 hip 的项目（没有则建，label 留空由 UI 显示 hipName）并登记成员。
    同一个 hip 下的多个 serial 因此落进**同一个**项目，不再各建一个。

    hip 缺省时保持旧语义：成员里已含该 serial -> 命中；否则按通道大全造成员并新建项目。
    """
    if not is_valid_serial(body.serial):
        raise HTTPException(status_code=400, detail="invalid serial")
    st = get_state()
    hip = body.hip or ""
    if not hip:
        # 调用方没带 hip 时**回退到注册表里那条记录的 hip**（v0.1.00119）。
        #
        # 为什么必须回退：web 侧 `ensureProject(serial)` 从来不带 hip（它手上只有 serial，
        # `listSerials()` 只回字符串数组），于是 `?serial=` 启动一路走到下面
        # `projects.create(label=serial)` —— 建出一个 **hip 为空** 的项目。而项目的 hip
        # **没有任何回填路径**：成员后来 push 时刷的是 registry，不会补项目那一栏。
        # 实测后果：重建后的 `P1-mszskx8f-0yf2` 的 hip 一直是空串，即使成员 registry 里
        # 已经有正确的 hip；nodeview 的项目根因此无地址可显（task #6 直接失去数据来源），
        # overview 也只能显示序列号。
        #
        # 注册表的 hip 是 HDA cook 时自报的（`put_inputs` 带 hip），是可信来源；
        # 拿它归拢等于让「同一个 hip 只有一个项目」这条既有语义真的生效。
        rec = st.registry.get(body.serial)
        hip = (getattr(rec, "hip", "") or "") if rec is not None else ""
    if hip:
        project, created = await bind_serial_to_hip(body.serial, hip)
        return {"ok": True, "project": project, "created": created}
    for project in st.projects.list():
        for m in project.get("members", []):
            if m.get("serial") == body.serial:
                return {"ok": True, "project": project, "created": False}
    created = st.projects.create(label=body.serial)
    project = st.projects.add_member(created["projectSerial"], member_ref_for(body.serial))
    return {"ok": True, "project": project, "created": True}


@router.post("/api/projects/migrate")
async def migrate_project(body: MigrateBody) -> dict:
    """另存为迁移：换绑 hip + 按新 hip 核对成员（见 migrate_project_hip）。

    hip 未变 -> migrated=False 的便宜 no-op；探测不到的成员一律保留（不因 Houdini
    不可达而误删注册关系）。
    """
    _check_project_serial(body.projectSerial)
    if get_state().projects.get(body.projectSerial) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return await migrate_project_hip(body.projectSerial, body.toHip)


@router.get("/api/projects/{projectId}/graph")
async def get_project_graph(projectId: str) -> dict:
    """项目图读。缺省迁移读（纯读不写回）：无项目图文件且项目恰 1 个 kind∈{tag,hda}
    成员（serial/hip 均非空）时，取该成员 serial 快照的 graph 部分（P2b）。"""
    _check_project_serial(projectId)
    st = get_state()
    project = st.projects.get(projectId)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    # 带上项目自己的 hip：图落在 hip 旁（`<hip目录>/Cyl1nder/<hip名>_<pid>/`）。
    # 尚未绑定 hip 的项目传空串，自动退回旧位置 `data_dir/projects/<pid>/`。
    graph = snapshot.read_project_graph(st.data_dir, projectId, project.get("hip") or "")
    if graph is None:
        members = [m for m in project.get("members", []) if m.get("kind") in ("tag", "hda")]
        if len(members) == 1 and members[0].get("serial") and members[0].get("hip"):
            snap = snapshot.read_snapshot(members[0]["hip"], members[0]["serial"])
            legacy = snap.get("graph") if snap is not None else None
            graph = _project_root_only(legacy)
    return {"ok": True, "graph": graph}


def _project_root_only(graph: dict | None) -> dict | None:
    """把迁移读到的旧成员图**过滤成项目根合法的形状**（v0.1.00123）。

    用户报的 bug：「打开 beginTest2 又看见了 4 个遗留的节点，根目录下只能有 geo 类的，
    我删了 reload 又会回来」。成因是这条迁移读把旧成员图**原样**当项目图返回，
    而旧成员图里装的是 `_input_`/`_output_`/`null`/`transform` —— 那些是 **sop 层**的
    东西，项目根（obj 层）只能有 geo 类容器。
    而且它**只读不写**：用户删掉再保存，写进去的是删后的图；但只要那份图为空或读不到，
    下一次读又会重跑迁移，节点就"又回来了"。删不掉的根因就在这里。

    过滤规则：只保留 `project` 与 `geo`（obj 层唯一合法的两种），连接一并按保留下来的
    节点 id 过滤（否则会留下指向已删节点的半截连接）。过滤后若一个 geo 都没有，
    返回 None —— 与「没有图」等价，让前端按空项目渲染那行黄色提示，
    而不是把一张只剩根节点的图硬塞回去。
    """
    if not isinstance(graph, dict):
        return None
    nodes = [n for n in (graph.get("nodes") or []) if isinstance(n, dict)]
    kept = [n for n in nodes if n.get("kind") in ("project", "geo")]
    dropped = len(nodes) - len(kept)
    if dropped == 0:
        return graph if kept else None
    kept_ids = {n.get("id") for n in kept}
    conns = [
        c
        for c in (graph.get("connections") or [])
        if isinstance(c, dict) and c.get("source") in kept_ids and c.get("target") in kept_ids
    ]
    if not any(n.get("kind") == "geo" for n in kept):
        # 只剩根节点（或什么都不剩）→ 当作"没有图"：前端会画空项目提示。
        return None
    out = dict(graph)
    out["nodes"] = kept
    out["connections"] = conns
    return out


@router.put("/api/projects/{projectId}/graph")
async def put_project_graph(projectId: str, body: GraphPutBody) -> dict:
    """项目图写（原子 tmp+replace + 内容对比，见 snapshot.write_project_graph）。"""
    _check_project_serial(projectId)
    st = get_state()
    project = st.projects.get(projectId)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    # 同读那侧：带 hip 写到 hip 旁，无 hip 退回旧位置（见 snapshot.write_project_graph）。
    snapshot.write_project_graph(st.data_dir, projectId, body.graph, project.get("hip") or "")
    return {"ok": True}
