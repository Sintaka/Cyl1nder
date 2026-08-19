from pathlib import Path

from bridge.mcp_server import (
    cyl1nder_get_errors,
    cyl1nder_get_geometry_summary,
    cyl1nder_get_status,
    cyl1nder_index_query,
    cyl1nder_list_serials,
    cyl1nder_node_params,
    cyl1nder_nodeview_connected,
    cyl1nder_nodeview_connections,
    cyl1nder_nodeview_nodes,
    cyl1nder_nodeview_status,
    cyl1nder_ping,
    cyl1nder_read_logs,
    cyl1nder_viewport_settings,
)
from bridge.protocol import generate_serial
from bridge.state import get_state, reset_state


def test_mcp_tools(tmp_path: Path, monkeypatch) -> None:
    reset_state(tmp_path / "data")
    monkeypatch.setenv("CYL1NDER_SNAPSHOT_ROOT", str(tmp_path / "snaps"))
    st = get_state()
    serial = generate_serial()
    st.registry.register(serial, nodePath="/obj/x", label="Cyl1nder")
    st.workspaces.get_or_create(serial).set_inputs([])

    assert cyl1nder_ping()["ok"] is True
    assert serial in cyl1nder_list_serials()
    status = cyl1nder_get_status(serial)
    assert status["registry"]["nodePath"] == "/obj/x"
    assert isinstance(cyl1nder_read_logs(), list)
    assert isinstance(cyl1nder_get_errors(), list)
    summary = cyl1nder_get_geometry_summary(serial, "inputs")
    assert "inputs" in summary and "outputs" not in summary
    res = cyl1nder_index_query("cyl1nder_ping")
    assert res["query"] == "cyl1nder_ping"
    assert isinstance(res["hits"], list)

    # nodeview tools: no snapshot -> None
    assert cyl1nder_nodeview_nodes(serial) is None
    assert cyl1nder_nodeview_connections(serial) is None
    assert cyl1nder_nodeview_status(serial) is None
    assert cyl1nder_nodeview_connected(serial, "n1") is None

    # 铺一个**旧存档**形状的成员图再查。
    #
    # v0.1.00122 起 `write_snapshot` 不再写 graph（成员图归项目所有），所以不能再用它造
    # 夹具——传 graph 进去只会被 accept-but-ignore，什么都不会落盘，四个 nodeview 工具
    # 于是全部返回 None（就是本测试原先的报错 `'NoneType' object is not iterable`）。
    # 这里直接写 `scene/node-graph.json`，正是 `_read_graph` 的第 2 条兜底来源，
    # 因此本测试同时也钉住了「旧存档仍然读得到」这条兼容承诺。
    import json as _json
    from bridge.snapshot import snapshot_root, write_snapshot
    write_snapshot(serial, "")  # 建出快照根与 scene/ 目录
    _scene = snapshot_root("", serial) / "scene"
    _scene.mkdir(parents=True, exist_ok=True)
    (_scene / "node-graph.json").write_text(
        _json.dumps({
            "schemaVersion": 2,
            "viewport": {"k": 1, "x": 0, "y": 10},
            "nodes": [
                {"id": "n1", "kind": "input", "label": "_input_", "baseLabel": "_input_", "flags": {"display": True}, "x": 0, "y": 0},
                {"id": "n2", "kind": "output", "label": "_output_", "baseLabel": "_output_", "flags": {"display": False}, "x": 100, "y": 0},
            ],
            "connections": [{"source": "n1", "sourceOutput": "in0", "target": "n2", "targetInput": "out0"}],
        }),
        encoding="utf-8",
    )
    assert [n["id"] for n in cyl1nder_nodeview_nodes(serial)] == ["n1", "n2"]
    conns = cyl1nder_nodeview_connections(serial)
    assert conns[0]["sourceLabel"] == "_input_" and conns[0]["targetLabel"] == "_output_"
    status = cyl1nder_nodeview_status(serial)
    assert status["nodeCount"] == 2 and status["connectionCount"] == 1
    assert status["displayNodes"] == ["n1"]
    conn = cyl1nder_nodeview_connected(serial, "n1")
    assert len(conn["predecessors"]) == 0 and len(conn["successors"]) == 1


def test_mcp_viewport_settings_and_node_params(tmp_path: Path, monkeypatch) -> None:
    reset_state(tmp_path / "data")
    monkeypatch.setenv("CYL1NDER_SNAPSHOT_ROOT", str(tmp_path / "snaps"))
    st = get_state()
    serial = generate_serial()
    st.registry.register(serial, nodePath="/obj/x", label="Cyl1nder")
    st.workspaces.get_or_create(serial).set_inputs([])

    from bridge.snapshot import write_snapshot

    # 无快照：两个工具都返回 None + note
    vp = cyl1nder_viewport_settings(serial)
    assert vp["displaySettings"] is None and vp["note"]
    np = cyl1nder_node_params(serial)
    assert np["params"] is None and np["note"]

    # 快照存在但缺对应部分：graph 在但无 parm；docking 在但无 displaySettings
    write_snapshot(serial, "", graph={"schemaVersion": 2, "nodes": [], "connections": []})
    assert cyl1nder_node_params(serial)["params"] is None
    write_snapshot(serial, "", docking={"grid": {"width": 100}})
    vp = cyl1nder_viewport_settings(serial)
    assert vp["displaySettings"] is None and "displaySettings" in vp["note"]

    # 写全：有 docking.displaySettings + 有 parm
    write_snapshot(
        serial,
        "",
        docking={
            "grid": {"root": {"type": "leaf", "data": {"views": ["viewport"], "id": "1"}}, "width": 100, "height": 100},
            "displaySettings": {"mode": "flat-wire"},
        },
        parm={
            "/obj/x/Cyl1nder1": {"label": "Cyl1nder1", "parms": {"scale": 1.0, "density": 100}},
            "Cyl1nder2": {"label": "Cyl1nder2", "parms": {"enabled": True}},
        },
    )
    assert cyl1nder_viewport_settings(serial)["displaySettings"] == {"mode": "flat-wire"}
    assert cyl1nder_node_params(serial)["params"] == {
        "/obj/x/Cyl1nder1": {"label": "Cyl1nder1", "parms": {"scale": 1.0, "density": 100}},
        "Cyl1nder2": {"label": "Cyl1nder2", "parms": {"enabled": True}},
    }

    # 成功返回不含 note 键（无快照 / 缺部分时才有 note）
    vp = cyl1nder_viewport_settings(serial)
    assert vp["displaySettings"] == {"mode": "flat-wire"} and "note" not in vp

