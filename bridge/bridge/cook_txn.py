"""Cook 事务：读快照 + 写缓冲 + 末尾统一 flush（v0.1.00126）。

用户的设计要求：桥**自动处理 input/output 的区别**，学 wrangle ——
「输入不会在执行中改变，输出统一推到最后执行」。

## 实测得到的真语义（不是凭记忆）

在真 Houdini 里跑 grid(4 点) + attribwrangle：

    vector t1 = @P;  @P = set(99,99,99);  vector t2 = @P;
    v@probe_cross = point(0, "P", (@ptnum+1) % @Numpt);

- `t2 == (99,99,99)`：**同元素**的写，后续读**看得见**；
- `probe_cross == (-1,0,-1)` 对每个点都成立：**跨元素**读看到的是**输入快照**。

所以不变量是「写对自己可见、对别人不可见，全部写在跑完之后统一落地」，
而**不是**「读永远不变」。本模块照这个语义实现。

## 三条规则

1. **读快照冻结**：`begin()` 之后同一个逻辑名的 `read()` 恒定 —— 即使中途有人 `write()`。
   这让「一趟 cook 里读到的输入」有确定值，重放/重算结果一致。
2. **写缓冲 + last-wins**：`write()` 只记账不落盘；同名多写保留最后一个
   （与 Houdini 参数赋值语义一致）。
3. **`read_own()` 看得见自己的写**：这就是 `t2` 那条实测。**默认的 `read()` 不看**，
   因为跨节点读必须是快照 —— 两个方法分开，调用方按语义选，别让一个方法两种行为。
"""
from __future__ import annotations

from typing import Any, Callable

# --- 用户 A/B 实测更正（v0.1.00126）：VEX 有**两种**写入语义，取决于写法 ----------
#
# 我最初只测 `@P` 就下了通用结论，用户用两个 point wrangle 做了干净的 A/B
# （`/obj/geo1/execting_test1` 与 `execting_test2`，同一段代码只换写入方式）：
#
#   v@P = {4.4,5.5,6.6}                  -> t1=1.1,2.2,3.3   t2=**4.4,5.5,6.6**
#   setpointattrib(0,'P',0,set(...),'set') -> t1=1.1,2.2,3.3   t2=**1.1,2.2,3.3**
#   （两者最终 P 都是 4.4,5.5,6.6）
#
# - **绑定属性 `v@P`**：写进本元素的局部寄存器，同趟后续读立刻可见，元素跑完提交。
# - **set 类函数**：几何级**排队**写，整趟跑完才落地，期间任何读（**含自己**）都看不见。
#
# 本类两个读方法正好对上这两种机制，实现不用改，只需明确对应：
# - `read()`（快照）= `setpointattrib` 语义 → **参数写回走这条**
#   （写回是场景级副作用，对本趟不可见才不会自我影响）
# - `read_own()` = `v@P` 语义 → 仅当同一个写者要复读自己刚写的值
# ---------------------------------------------------------------------------

__all__ = ["CookTxn", "FlushResult"]


class FlushResult(dict):
    """`{written, skipped, errors}`；用 dict 子类是为了直接进 JSON 响应。"""


class CookTxn:
    """一趟 cook 的读写事务。

    `reader(name) -> value` 与 `writer(name, value) -> None` 由调用方注入
    （桥侧就是映射端点的 get/put）—— 本类**不认识 HTTP、也不认识 Houdini**，
    因此可以纯单测，且将来换成 python runtime 写回时**不用改这里**
    （用户说「还不一定是通过 hda 传回去, 也可能是 python runtime」，
    所以注入点必须留在外面）。
    """

    def __init__(
        self,
        reader: Callable[[str], Any],
        writer: Callable[[str, Any], None],
    ) -> None:
        self._reader = reader
        self._writer = writer
        self._snapshot: dict[str, Any] = {}
        self._pending: dict[str, Any] = {}
        self._open = False

    def begin(self) -> None:
        """开一趟事务：清空快照与写缓冲。重复 begin 视为重开（丢弃未 flush 的写）。"""
        self._snapshot.clear()
        self._pending.clear()
        self._open = True

    def read(self, name: str) -> Any:
        """读**输入快照**：首次读时向 Houdini 取一次并冻结，之后恒定。

        **刻意不看本趟的写**（那是 `read_own`）：跨节点读必须是快照，否则同一张图的
        计算结果会依赖节点求值顺序 —— 那正是 wrangle 用 `point()` 读到输入的原因。
        """
        if name in self._snapshot:
            return self._snapshot[name]
        v = self._reader(name)
        self._snapshot[name] = v
        return v

    def read_own(self, name: str) -> Any:
        """读**自己刚写的值**（写过就返回它，否则退回快照）。

        对应实测里的 `t2`：同元素的写对后续读可见。只有"同一个写者再读自己"才该用它。
        """
        if name in self._pending:
            return self._pending[name]
        return self.read(name)

    def write(self, name: str, value: Any) -> None:
        """缓冲一次写（**不落盘**）。同名多写 last-wins，与参数赋值语义一致。"""
        self._pending[name] = value

    @property
    def pending(self) -> dict[str, Any]:
        """待落地的写（只读副本，便于日志/测试断言）。"""
        return dict(self._pending)

    def flush(self) -> FlushResult:
        """把缓冲的写**统一落地**，这是「输出统一推到最后执行」那一步。

        三条纪律：
        - **按名字排序落地**：同一张图两次 cook 的写入顺序一致，便于复现与比对日志。
        - **值没变就跳过**（与快照比）：避免把参数反复写成同一个值 —— 那会刷掉用户的
          撤销栈，也会让 Houdini 反复重算。
        - **单个失败不中断其余**：错误收集起来一起报。一个参数写不进去不该让另外
          十个也丢掉。
        """
        written: list[str] = []
        skipped: list[str] = []
        errors: dict[str, str] = {}
        for name in sorted(self._pending):
            value = self._pending[name]
            if name in self._snapshot and self._snapshot[name] == value:
                skipped.append(name)  # 值未变
                continue
            try:
                self._writer(name, value)
                written.append(name)
                self._snapshot[name] = value  # 落地后快照跟进，下一趟读到的是新值
            except Exception as exc:  # noqa: BLE001 - 逐条归一，不中断其余
                errors[name] = str(exc)[:200]
        self._pending.clear()
        self._open = False
        return FlushResult(written=written, skipped=skipped, errors=errors)
