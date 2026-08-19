"""项目根只允许 geo 类节点（v0.1.00123，用户 bug #1）。

用户报的现象：「打开 beginTest2 又看见了 4 个遗留的节点, 根目录下只能有 geo 类的,
我删了 reload 又会回来」。

两个成因叠在一起：
1. `GET /api/projects/{id}/graph` 的单成员**迁移读**把旧成员图原样当项目图返回，
   而旧成员图装的是 `_input_`/`_output_`/`null`/`transform` —— 那些属于 sop 层。
2. 迁移读**只读不写**，所以删掉再保存也没用：下一次读又重跑迁移，节点"又回来了"。
"""
from __future__ import annotations

from bridge.project_routes import _project_root_only


def test_legacy_sop_nodes_become_no_graph() -> None:
    """用户看到的那 4 个节点 → None（= 没有图 → 前端画空项目提示）。"""
    legacy = {
        "schemaVersion": 2,
        "nodes": [
            {"id": "a", "kind": "input", "label": "_input_"},
            {"id": "b", "kind": "output", "label": "_output_"},
            {"id": "c", "kind": "null", "label": "null1"},
            {"id": "e", "kind": "transform", "label": "transform1"},
        ],
        "connections": [{"source": "a", "target": "c"}],
    }
    assert _project_root_only(legacy) is None


def test_project_and_geo_survive() -> None:
    """obj 层合法的两种（project / geo）保留，其余剔除。"""
    out = _project_root_only(
        {
            "schemaVersion": 5,
            "nodes": [
                {"id": "p", "kind": "project"},
                {"id": "g", "kind": "geo"},
                {"id": "n", "kind": "null"},
            ],
            "connections": [{"source": "p", "target": "g"}, {"source": "g", "target": "n"}],
        }
    )
    assert out is not None
    assert [n["kind"] for n in out["nodes"]] == ["project", "geo"]
    assert out["connections"] == [{"source": "p", "target": "g"}]


def test_dangling_connection_to_dropped_node_is_removed() -> None:
    """指向被删节点的连接必须一并删掉，否则留下半截线。"""
    out = _project_root_only(
        {
            "nodes": [{"id": "p", "kind": "project"}, {"id": "g", "kind": "geo"}, {"id": "n", "kind": "null"}],
            "connections": [{"source": "g", "target": "n"}],
        }
    )
    assert out is not None
    assert out["connections"] == []


def test_non_dict_input_is_none() -> None:
    assert _project_root_only(None) is None
    assert _project_root_only([]) is None  # type: ignore[arg-type]
