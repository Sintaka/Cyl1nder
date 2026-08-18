"""吊牌 HDA 项目路由（项目 = 一个 hip 文件，见 devlog/protocol.md「项目 = hip 文件」）。

- POST   /api/projects                         建项目（body {label?, hip?}）-> {ok, project}
- GET    /api/projects                         项目列表（按 createdAt 升序）
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


def _cascade_delete(pid: str) -> None:
    """删项目的附属物：映射分区 + 项目图文件及其目录。

    mappings 由主进程在合并时挂到 state 上，未挂载时 no-op；
    删附属物失败不应阻断项目记录本身的删除。
    """
    st = get_state()
    mappings = getattr(st, "mappings", None)
    if mappings is not None and hasattr(mappings, "drop_project"):
        try:
            mappings.drop_project(pid)
        except Exception:  # noqa: BLE001 - 清理失败不阻断删除
            pass
    graph = snapshot.project_graph_path(st.data_dir, pid)
    try:
        graph.unlink(missing_ok=True)
        graph.with_suffix(".json.tmp").unlink(missing_ok=True)
        if graph.parent.exists() and not any(graph.parent.iterdir()):
            graph.parent.rmdir()
    except OSError:
        pass


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
    removed = get_state().projects.delete(projectId)
    if removed:
        _cascade_delete(projectId)
    return {"ok": True, "removed": removed}


@router.post("/api/projects/cleanup")
async def cleanup_projects() -> dict:
    """清空壳项目：删掉所有 0 成员项目（有成员的一律保留），级联同 DELETE。"""
    st = get_state()
    removed: list[str] = []
    for pid in st.projects.list_empty():
        if st.projects.delete(pid):
            _cascade_delete(pid)
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
    if body.hip:
        project, created = await bind_serial_to_hip(body.serial, body.hip)
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
    graph = snapshot.read_project_graph(st.data_dir, projectId)
    if graph is None:
        members = [m for m in project.get("members", []) if m.get("kind") in ("tag", "hda")]
        if len(members) == 1 and members[0].get("serial") and members[0].get("hip"):
            snap = snapshot.read_snapshot(members[0]["hip"], members[0]["serial"])
            graph = snap.get("graph") if snap is not None else None
    return {"ok": True, "graph": graph}


@router.put("/api/projects/{projectId}/graph")
async def put_project_graph(projectId: str, body: GraphPutBody) -> dict:
    """项目图写（原子 tmp+replace + 内容对比，见 snapshot.write_project_graph）。"""
    _check_project_serial(projectId)
    st = get_state()
    if st.projects.get(projectId) is None:
        raise HTTPException(status_code=404, detail="project not found")
    snapshot.write_project_graph(st.data_dir, projectId, body.graph)
    return {"ok": True}
