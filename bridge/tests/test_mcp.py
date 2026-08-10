from pathlib import Path

from bridge.mcp_server import (
    cyl1nder_get_errors,
    cyl1nder_get_geometry_summary,
    cyl1nder_get_status,
    cyl1nder_index_query,
    cyl1nder_list_serials,
    cyl1nder_nodeview_connected,
    cyl1nder_nodeview_connections,
    cyl1nder_nodeview_nodes,
    cyl1nder_nodeview_status,
    cyl1nder_ping,
    cyl1nder_read_logs,
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

    # write a graph snapshot and re-check
    from bridge.snapshot import write_snapshot
    write_snapshot(
        serial,
        "",
        graph={
            "schemaVersion": 2,
            "viewport": {"k": 1, "x": 0, "y": 10},
            "nodes": [
                {"id": "n1", "kind": "input", "label": "_input_", "baseLabel": "_input_", "flags": {"display": True}, "x": 0, "y": 0},
                {"id": "n2", "kind": "output", "label": "_output_", "baseLabel": "_output_", "flags": {"display": False}, "x": 100, "y": 0},
            ],
            "connections": [{"source": "n1", "sourceOutput": "in0", "target": "n2", "targetInput": "out0"}],
        },
    )
    assert [n["id"] for n in cyl1nder_nodeview_nodes(serial)] == ["n1", "n2"]
    conns = cyl1nder_nodeview_connections(serial)
    assert conns[0]["sourceLabel"] == "_input_" and conns[0]["targetLabel"] == "_output_"
    status = cyl1nder_nodeview_status(serial)
    assert status["nodeCount"] == 2 and status["connectionCount"] == 1
    assert status["displayNodes"] == ["n1"]
    conn = cyl1nder_nodeview_connected(serial, "n1")
    assert len(conn["predecessors"]) == 0 and len(conn["successors"]) == 1
