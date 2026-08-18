"""吊牌 HDA 项目路由（多 HDA 绑定，见 devlog/tag-hda-plan.md P2a）。

- POST   /api/projects                         建项目（body {label?}）-> {ok, project}
- GET    /api/projects                         项目列表（按 createdAt 升序）
- GET    /api/projects/{projectId}             单项目
- PATCH  /api/projects/{projectId}             改名（body {label}）-> {ok, project}
- DELETE /api/projects/{projectId}             删项目（级联映射分区 + 项目图）-> {ok, removed}
- POST   /api/projects/cleanup                 删所有 0 成员项目 -> {ok, removed:[pid…]}
- POST   /api/projects/{projectId}/members     加成员（body = channelRef，按通道 key 去重）
- DELETE /api/projects/{projectId}/members     ?channelId= 移成员（query 而非 path，param 通道 key 含 "/"）
- POST   /api/projects/ensure                  body {serial}：隐式项目（无含该 serial 的项目则自动建）
- GET    /api/projects/{projectId}/graph       项目图读（缺省迁移：单成员 -> 其 serial 快照 graph 部分，纯读）
- PUT    /api/projects/{projectId}/graph       项目图写（body {graph: dict}）-> {ok}

main.py 由主进程挂载本 router（本文件不改 main.py）。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import snapshot
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


class ProjectCreateBody(BaseModel):
    label: str = ""


class ProjectPatchBody(BaseModel):
    label: str


class EnsureBody(BaseModel):
    serial: str


class GraphPutBody(BaseModel):
    graph: dict


@router.post("/api/projects")
async def create_project(body: ProjectCreateBody) -> dict:
    project = get_state().projects.create(body.label)
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
    """隐式项目：项目成员里已含该 serial -> 命中；否则找通道大全（kind tag 优先，其次 hda，
    按 registeredAt 升序取第一个）构造成员 ref，找不到通道则 fallback hda 占位成员，自动建项目。"""
    if not is_valid_serial(body.serial):
        raise HTTPException(status_code=400, detail="invalid serial")
    st = get_state()
    for project in st.projects.list():
        for m in project.get("members", []):
            if m.get("serial") == body.serial:
                return {"ok": True, "project": project, "created": False}
    channels = st.channels.list()  # 已按 registeredAt 升序
    tags = [c for c in channels if c.get("kind") == "tag" and c.get("serial") == body.serial]
    hdas = [c for c in channels if c.get("kind") == "hda" and c.get("serial") == body.serial]
    pool = tags if tags else hdas
    if pool:
        ref = dict(pool[0])
    else:
        ref = {
            "kind": "hda",
            "serial": body.serial,
            "nodePath": "",
            "absolutePath": None,
            "hip": "",
            "label": body.serial,
            "registeredAt": 0.0,
            "lastSeen": 0.0,
        }
    created = st.projects.create(label=body.serial)
    project = st.projects.add_member(created["projectSerial"], ref)
    return {"ok": True, "project": project, "created": True}


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
