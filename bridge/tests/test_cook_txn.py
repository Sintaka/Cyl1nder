"""Cook 事务：读快照 + 写缓冲 + 末尾统一 flush（v0.1.00126）。

用户要求桥自动处理 input/output 的区别，学 wrangle：「输入不会在执行中改变，
输出统一推到最后执行」。

**语义来自真 Houdini 实测**（grid 4 点 + attribwrangle），不是凭记忆：
    vector t1 = @P;  @P = set(99,99,99);  vector t2 = @P;
    v@probe_cross = point(0, "P", (@ptnum+1) % @Numpt);
结果 `t2 == (99,99,99)`（同元素的写自己看得见），
而 `probe_cross` 对每个点都是未修改的输入（跨元素读看到输入快照）。
所以不变量是「写对自己可见、对别人不可见，全部写在跑完后统一落地」。
"""
from __future__ import annotations

from bridge.cook_txn import CookTxn


def _txn(store: dict) -> tuple[CookTxn, list[str]]:
    reads: list[str] = []

    def reader(name: str):
        reads.append(name)
        return store.get(name)

    def writer(name: str, value) -> None:
        store[name] = value

    return CookTxn(reader, writer), reads


def test_read_is_frozen_and_write_is_deferred() -> None:
    """对应实测：read 恒为输入快照；写在 flush 之前不落地。"""
    hou = {"tx": 1.0}
    t, _ = _txn(hou)
    t.begin()
    t1 = t.read("tx")
    t.write("tx", 99.0)
    t2 = t.read("tx")
    assert (t1, t2) == (1.0, 1.0)  # 跨节点读看不到本趟的写
    assert hou["tx"] == 1.0  # 还没落地
    t.flush()
    assert hou["tx"] == 99.0  # 统一推到最后


def test_two_vex_write_mechanisms_map_to_the_two_read_methods() -> None:
    """用户 A/B 实测（execting_test1/2）：VEX 有**两种**写入语义，本类两个读方法各对一种。

        v@P = {...}          -> t2 看得见（局部寄存器）      = read_own()
        setpointattrib(...)  -> t2 看不见（几何级排队写）    = read()

    参数写回走 `read()` 那条：写回是场景级副作用，对本趟不可见才不会自我影响。
    """
    hou = {"P": 1.1}
    t, _ = _txn(hou)
    t.begin()
    t1 = t.read("P")
    t.write("P", 4.4)
    assert t.read("P") == t1  # setpointattrib 语义：自己也看不见
    assert t.read_own("P") == 4.4  # v@P 语义：自己看得见
    t.flush()
    assert hou["P"] == 4.4  # 两种写法最终落地值相同


def test_read_own_sees_its_own_write() -> None:
    """对应实测里的 `t2`：同一个写者再读自己，看得见 99。"""
    hou = {"tx": 1.0}
    t, _ = _txn(hou)
    t.begin()
    t.write("tx", 99.0)
    assert t.read_own("tx") == 99.0  # 自己的写可见
    assert t.read("tx") == 1.0  # 但快照读仍是输入


def test_snapshot_reads_houdini_once() -> None:
    """快照只向 Houdini 取一次 —— 一趟 cook 里反复读同名不该反复打桥。"""
    hou = {"tx": 1.0}
    t, reads = _txn(hou)
    t.begin()
    for _ in range(5):
        t.read("tx")
    assert reads == ["tx"]


def test_last_write_wins() -> None:
    hou = {"tx": 0.0}
    t, _ = _txn(hou)
    t.begin()
    t.write("tx", 1.0)
    t.write("tx", 2.0)
    t.flush()
    assert hou["tx"] == 2.0


def test_unchanged_value_is_skipped_not_rewritten() -> None:
    """值没变就不写：反复写同一个值会刷掉用户的撤销栈、让 Houdini 白重算。"""
    hou = {"a": 1.0}
    t, _ = _txn(hou)
    t.begin()
    t.read("a")  # 先建快照，flush 才有得比
    t.write("a", 1.0)
    res = t.flush()
    assert res["written"] == [] and res["skipped"] == ["a"]
    assert hou["a"] == 1.0 and t.pending == {}


def test_one_failure_does_not_drop_the_others() -> None:
    hou = {"a": 0.0, "bad": 0.0, "b": 0.0}

    def writer(name: str, value) -> None:
        if name == "bad":
            raise RuntimeError("parm is locked")
        hou[name] = value

    t = CookTxn(lambda n: hou.get(n), writer)
    t.begin()
    for k in ("a", "bad", "b"):
        t.write(k, 5.0)
    res = t.flush()
    assert res["written"] == ["a", "b"]
    assert list(res["errors"]) == ["bad"]
    assert hou["a"] == 5.0 and hou["b"] == 5.0  # 一个坏的没连累其余
