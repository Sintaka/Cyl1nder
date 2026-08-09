from pathlib import Path

from bridge.mcp_server import (
    cyl1nder_get_errors,
    cyl1nder_get_geometry_summary,
    cyl1nder_get_status,
    cyl1nder_index_query,
    cyl1nder_list_serials,
    cyl1nder_ping,
    cyl1nder_read_logs,
)
from bridge.protocol import generate_serial
from bridge.state import get_state, reset_state


def test_mcp_tools(tmp_path: Path) -> None:
    reset_state(tmp_path / "data")
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
