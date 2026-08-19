"""无环 cook 判定（v0.1.00125）。

**为什么放在桥侧而不是让节点连接去兼容**（用户要求）：环的成因是「哪个逻辑名被读、
哪个被写」，那份事实只有桥手上全 —— 项目图（谁读谁写）与映射表（逻辑名解析到哪个
绝对路径）都在这里。让 web 的节点连接去"兼容"环，等于把一个数据流不变量降级成
UI 的自觉，而且每个入口都要各自实现一遍。

判据只有一条：**同一个 cook 里，一个逻辑名不能既被读又被写。**
- `_input_` 的 address+port = 一次**读**（把 Houdini 的值取进图）
- `_output_` 的 address+port = 一次**写**（把图算出的值送回 Houdini）
读写同一个名字 → 这次写会改变下次读的输入 → cook 不收敛。用户图里的实例正是
`_input_` 与 `_output_` 都指向 `C1-mt09nkms-bwxp` 的 `transform1/tx`。

**不做的事**：不试图"自动打断环"（删哪一端都是替用户决定），也不静默降级成只读。
一律**拒绝写入并说清是哪个名字**，让用户改图。
"""
from __future__ import annotations

from typing import Any, Iterable

__all__ = [
    "logical_key",
    "graph_io_names",
    "find_cycles",
    "cycle_message",
]


def logical_key(address: str, port: str) -> str:
    """一次读/写的身份 = `<serial>::<逻辑名>`。

    两者都要：同一个逻辑名在不同 serial 下是不同的东西（不同吊牌各自的 transform1/tx），
    只按逻辑名比会把它们误判成同一个点，从而报出不存在的环。
    """
    a = (address or "").strip()
    p = (port or "").strip()
    if a == "" or p == "":
        return ""  # 没填完 = 还不构成读写，不参与判定
    return f"{a}::{p}"


def _params_of(node: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for p in node.get("params") or []:
        if isinstance(p, dict) and isinstance(p.get("name"), str):
            v = p.get("value")
            out[p["name"]] = v if isinstance(v, str) else ""
    return out


def graph_io_names(graph: Any) -> tuple[set[str], set[str]]:
    """递归收集整张图的（读集合, 写集合）。

    **必须递归 children**：v0.1.00119 起用户的 `_input_`/`_output_` 都在 geo 的子网络里
    （项目根只允许 geo 类），只扫顶层会得到两个空集合 —— 那样这个检查就永远不报警，
    是最坏的结果（看着有防护，实际没有）。
    """
    reads: set[str] = set()
    writes: set[str] = set()
    _walk(graph, reads, writes)
    return reads, writes


def _walk(graph: Any, reads: set[str], writes: set[str]) -> None:
    if not isinstance(graph, dict):
        return
    for n in graph.get("nodes") or []:
        if not isinstance(n, dict):
            continue
        kind = n.get("kind")
        if kind in ("input", "output"):
            ps = _params_of(n)
            key = logical_key(ps.get("address", ""), ps.get("port", ""))
            if key:
                (reads if kind == "input" else writes).add(key)
        _walk(n.get("children"), reads, writes)


def find_cycles(graph: Any) -> list[str]:
    """返回**既被读又被写**的逻辑名（排序稳定，便于测试与日志比对）。空列表 = 无环。"""
    reads, writes = graph_io_names(graph)
    return sorted(reads & writes)


def cycle_message(cycles: Iterable[str]) -> str:
    """给用户看的中文原因。列出具体名字 —— 「有环」而不说哪个名字等于没说。"""
    names = list(cycles)
    if not names:
        return ""
    listed = "、".join(f"「{n}」" for n in names[:4])
    more = f" 等 {len(names)} 个" if len(names) > 4 else ""
    return (
        f"cook 会成环：{listed}{more} 同时被 _input_ 读、又被 _output_ 写。"
        f"写回会改变下一次读到的值，cook 不收敛。请改掉其中一端的地址/端口。"
    )


def assert_acyclic(graph: Any) -> None:
    """有环则抛 `ValueError`（调用方转 4xx）。无环静默返回。"""
    cycles = find_cycles(graph)
    if cycles:
        raise ValueError(cycle_message(cycles))
