"""两个吊牌声明同一个逻辑名时，退役不能删掉对方还在用的条目（v0.1.00143）。

映射条目按 `(项目, 逻辑名)` 唯一，而两个吊牌可以声明**同一个** rel —— 那时它们共用一条
条目，anchor 是最后注册的那个。v0.1.00131 的退役 sweep 只看"本吊牌这次声明了什么"，
于是本吊牌不再声明它时，会把**另一个吊牌还在用的**条目一起删掉。

实测后果（用户机器上就是这个状态）：`transform1/tx` 的通道行还在
（`C1-mst8wa94-8uz8` 声明着），映射条目却没了 —— 端口下拉里看得到这个名字，
一用就解析不出来。比"名字消失"更难查，因为界面显示得好好的。
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from bridge.main import create_app
from bridge.protocol import generate_serial
from bridge.state import get_state, reset_state


REL = "transform1/tx"


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    os.environ["CYL1NDER_SNAPSHOT_ROOT"] = str(tmp_path / "snapshots")
    reset_state(tmp_path / "data")
    yield TestClient(create_app())
    os.environ.pop("CYL1NDER_SNAPSHOT_ROOT", None)


def _register_param(serial: str, rel: str, node: str) -> None:
    """照 test_capabilities 的做法：吊牌的 param 行直接进通道表。"""
    get_state().channels.register(
        {"kind": "param", "serial": serial, "absolutePath": f"{node}/{rel}", "rel": rel,
         "type": "float", "label": rel}
    )


def _heartbeat(client: TestClient, serial: str, names: list[str]) -> dict:
    return client.post(
        f"/api/hda/{serial}/channels/heartbeat",
        json={"serial": serial, "nodePath": "/obj/geo1/tag", "upstreamNodePath": "",
              "fingerprint": "fp", "names": names},
    ).json()


def test_shared_rel_is_reanchored_not_deleted(client: TestClient) -> None:
    """A、B 都声明 `transform1/tx`；A 不再声明 → 条目**改挂到 B**，绝不删。"""
    a, b = generate_serial(), generate_serial()
    _register_param(a, REL, "/obj/geo1")
    _register_param(b, REL, "/obj/other")
    st = get_state()
    # 直接用字面项目号建条目：被测的是**退役逻辑**，不该把项目 API 的签名牵扯进来
    # （我第一版调了 `projects.create("P", [a, b])`，签名不对，测试挂在自己的脚手架上）。
    pid = "P1-aaaaaaaa-bbbb"
    st.mappings.put_entry(pid, REL, {"anchor": a, "rel": REL, "kind": "param",
                                     "adapter": None, "type": "float", "label": REL})

    _heartbeat(client, a, ["something/else"])  # A 不再声明 REL

    entry = st.mappings.get_entry(pid, REL)
    assert entry is not None, "条目被删了 —— B 还在声明它，这就是那个 bug"
    assert entry["anchor"] == b, "应改挂到仍在声明它的 B"


def test_unshared_rel_is_still_deleted(client: TestClient) -> None:
    """没有别人声明时照旧删 —— 改挂不能变成"永远不清理"。"""
    a = generate_serial()
    _register_param(a, REL, "/obj/geo1")
    st = get_state()
    pid = "P1-aaaaaaaa-bbbb"
    st.mappings.put_entry(pid, REL, {"anchor": a, "rel": REL, "kind": "param",
                                     "adapter": None, "type": "float", "label": REL})
    # 通道行也要退掉，否则 _other_declarer 会把 A 自己算进去 —— 不，它排除 serial 自身
    _heartbeat(client, a, ["something/else"])
    assert st.mappings.get_entry(pid, REL) is None
