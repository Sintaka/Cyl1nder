"""无环 cook 判定（v0.1.00125，用户要求）。

用户原话：「回环这个问题在桥接映射系统解决掉, 做到无环 cook, 而不是让现有的 node
连接兼容」。所以判定在桥侧、拒绝在写入口，不靠 web 的节点连接自觉。

实测触发过的真实形状：`_input_` 与 `_output_` 都填 `C1-mt09nkms-bwxp` + `transform1/tx`。
"""
from __future__ import annotations

from bridge.cook_cycle import cycle_message, find_cycles, graph_io_names, logical_key


def _io_node(kind: str, address: str, port: str) -> dict:
    return {
        "id": f"{kind}-{address}-{port}",
        "kind": kind,
        "params": [
            {"name": "address", "value": address},
            {"name": "port", "value": port},
        ],
    }


S = "C1-mt09nkms-bwxp"


def test_user_real_cycle_is_detected() -> None:
    """用户实机那张图：读写同一个 serial+逻辑名 → 报环。"""
    graph = {"nodes": [_io_node("input", S, "transform1/tx"), _io_node("output", S, "transform1/tx")]}
    assert find_cycles(graph) == [f"{S}::transform1/tx"]


def test_cycle_inside_geo_children_is_detected() -> None:
    """**必须递归 children**：v0.1.00119 起 io 节点都在 geo 子网络里，
    只扫顶层会永远返回"无环" —— 看着有防护、实际没有，比不做更坏。"""
    graph = {
        "nodes": [
            {"id": "p", "kind": "project"},
            {
                "id": "g",
                "kind": "geo",
                "children": {
                    "nodes": [
                        _io_node("input", S, "transform1/tx"),
                        _io_node("output", S, "transform1/tx"),
                    ]
                },
            },
        ]
    }
    assert find_cycles(graph) == [f"{S}::transform1/tx"]


def test_read_and_write_different_names_is_acyclic() -> None:
    graph = {"nodes": [_io_node("input", S, "transform1/tx"), _io_node("output", S, "transform1/ty")]}
    assert find_cycles(graph) == []


def test_same_name_different_serial_is_not_a_cycle() -> None:
    """不同吊牌各自的 `transform1/tx` 是**两个东西**：只按逻辑名比会报出不存在的环。"""
    graph = {
        "nodes": [
            _io_node("input", "C1-aaaaaaaa-1111", "transform1/tx"),
            _io_node("output", "C1-bbbbbbbb-2222", "transform1/tx"),
        ]
    }
    assert find_cycles(graph) == []


def test_unfilled_address_or_port_does_not_participate() -> None:
    """没填完不算读写：否则每个新建的空 io 节点都会互相"成环"。"""
    graph = {"nodes": [_io_node("input", S, ""), _io_node("output", "", "transform1/tx")]}
    assert find_cycles(graph) == []
    assert logical_key(S, "") == ""
    assert logical_key("", "x") == ""


def test_io_sets_and_message() -> None:
    graph = {"nodes": [_io_node("input", S, "a"), _io_node("output", S, "b")]}
    reads, writes = graph_io_names(graph)
    assert reads == {f"{S}::a"} and writes == {f"{S}::b"}
    assert cycle_message([]) == ""
    msg = cycle_message([f"{S}::a"])
    assert "成环" in msg and f"{S}::a" in msg  # 必须点名，"有环"而不说哪个等于没说


def test_malformed_graph_is_acyclic_not_crash() -> None:
    for bad in (None, [], {}, {"nodes": None}, {"nodes": [None, 3, "x"]}):
        assert find_cycles(bad) == []
