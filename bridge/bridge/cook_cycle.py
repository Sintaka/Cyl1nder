"""无环 cook 判定（v0.1.00125）。

**为什么放在桥侧而不是让节点连接去兼容**（用户要求）：环的成因是「哪个逻辑名被读、
哪个被写」，那份事实只有桥手上全 —— 项目图（谁读谁写）与映射表（逻辑名解析到哪个
绝对路径）都在这里。让 web 的节点连接去"兼容"环，等于把一个数据流不变量降级成
UI 的自觉，而且每个入口都要各自实现一遍。

判据只有一条：**同一个 cook 里，一个逻辑名不能既被读又被写。**
- `_input_` 的 address+port = 一次**读**（把 Houdini 的值取进图）
- `_output_` 的 address+port = 一次**写**（把图算出的值送回 Houdini）

## v0.1.00126 起这条判据**被 wrangle 语义取代**（保留本模块只为诊断）

用户提出学 VEX/wrangle 的做法，我在真 Houdini 里实测了他给的例子，结论**修正了他的
细节、但支持他的架构**（探针：grid 4 点 + attribwrangle）：

    vector t1 = @P;  @P = set(99,99,99);  vector t2 = @P;
    v@probe_cross = point(0, "P", (@ptnum+1) % @Numpt);

- `t2` == `(99,99,99)` —— **同元素**的写对后续读**是可见的**（不是他说的 t1==t2）；
- `probe_cross` 对每个点都是**未被修改的输入**（`-1,0,-1`）—— 跨元素读看到的是
  **输入快照**，永远看不到别人的写。

所以真正的不变量是：**写对自己可见、对别人不可见；所有写在整趟跑完之后才统一落地。**
把它搬到桥上 = 「cook 开始时冻结读快照 + 写入缓冲到最后统一 flush」，于是
**读写同一个逻辑名不再是环**（那正是 `t1=@P; @P=v` 这个合法形状）。

因此 `find_cycles` 不再挂在写入口上做拒绝（见 mapping_routes 的 `put_mapping_value`），
只作为**诊断信息**由 `GET /api/projects/{pid}/cook-cycles` 暴露 —— 让 UI 能提示
「这个名字既读又写，值会在本趟结束后才变」，而不是拦住用户。
真正的执行顺序保证在 `cook_txn.py`。
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
