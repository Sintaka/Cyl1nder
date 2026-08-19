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

import json
import threading
import time
from pathlib import Path
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

__all__ = [
    "CookTxn",
    "FlushResult",
    "WritebackTargets",
    "get_writeback_targets",
    "is_tag_serial",
    "resolve_target",
    "passthrough_outputs",
]


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


# --- 写回指向（writeback pointer）-------------------------------------------
#
# 用户的原话：「output 节点被修改目的地时需要更新在桥中指向的对象, 然后 cook 请求发出
# 时桥去找有没有指向, 如果是类似空指针的东西就直接把 input 塞回去给 hda」。
#
# 所以桥要存的是**每个 HDA 的每个 output 端口指向哪个逻辑名**，不是几何、不是值：
#
#     {serial: {port_index: {"project": "P1-…", "name": "apex/point_1", "updatedAt": ts}}}
#
# 为什么按 `serial -> 端口序号 -> {project,name}` 这个形状：
#
# - **serial 在最外层**：cook 是按 serial 进来的（`PUT /api/hda/{serial}/inputs`），
#   热路径上要 O(1) 拿到「这个 HDA 有没有指向」，不能扫全表。
# - **端口序号是键**：HDA 是 4 输入/4 输出，写回是**逐端口**的。`_output_` 2 号被
#   重指向不该动 0 号。用 dict 而不是 list：稀疏（只有 1 号有指向很正常），
#   而且不必为了填 0 号造占位。JSON 的 key 只能是字符串，落盘/读回统一转 int。
# - **只存 (project, name)，不存解析结果**：逻辑名解析要经 MappingRegistry（锚点可能
#   移动、条目可能被删）。存快照就会拿着过期的绝对路径写错节点——那正是映射系统
#   用「锚点 + 相对地址」而不是绝对路径的原因。指向是**引用**，每次 cook 现解析。
# - **`project` 必须一起存**：逻辑名只在项目内唯一（`MappingRegistry` 按 pid 分桶），
#   单存 name 就没法解析。
#
# 悬空（dangling）= 有指向、但解析不出来（项目没了 / 条目被删 / 锚点失效）。
# 它和「压根没指向」在 cook 里走**同一条**路：passthrough。这就是用户说的「空指针」。


class WritebackTargets:
    """per-serial 的 output 端口写回指向表，落盘 `writeback.json`。

    并发/落盘纪律照 `ChannelRegistry`：`threading.Lock` + tmp+replace 原子写 +
    容错 load（坏文件当空表，绝不让桥起不来）。写指向是低频的用户操作
    （拖一次线才一次），所以每次都 force 落盘，不做 debounce。
    """

    def __init__(self, path: Path | None = None) -> None:
        self._path = path
        self._targets: dict[str, dict[int, dict]] = {}
        self._lock = threading.Lock()
        if path is not None and path.exists():
            self._load(path)

    def get_all(self, serial: str) -> dict[int, dict]:
        """这个 serial 的全部指向（深拷贝，调用方改不坏内部状态）。无指向 -> `{}`。"""
        with self._lock:
            return {p: dict(t) for p, t in self._targets.get(serial, {}).items()}

    def get(self, serial: str, port: int) -> dict | None:
        with self._lock:
            t = self._targets.get(serial, {}).get(int(port))
            return dict(t) if t is not None else None

    def set(self, serial: str, port: int, project: str, name: str) -> dict:
        """指向某个项目里的逻辑名。空 project/name -> ValueError（那是 clear 的活）。"""
        if not serial:
            raise ValueError("empty serial")
        if not project or not name:
            raise ValueError("empty project or name")
        rec = {"project": project, "name": name, "updatedAt": time.time()}
        with self._lock:
            self._targets.setdefault(serial, {})[int(port)] = rec
            self._save()
            return dict(rec)

    def clear(self, serial: str, port: int) -> bool:
        """撤掉一个端口的指向 -> 该端口回到 passthrough。没指向过返回 False。"""
        with self._lock:
            ports = self._targets.get(serial)
            if not ports or int(port) not in ports:
                return False
            del ports[int(port)]
            if not ports:
                del self._targets[serial]
            self._save()
            return True

    def clear_serial(self, serial: str) -> int:
        """撤掉整个 serial 的指向，返回撤掉的端口数（节点被删/重指向时用）。"""
        with self._lock:
            ports = self._targets.pop(serial, {})
            if ports:
                self._save()
            return len(ports)

    def serials(self) -> list[str]:
        with self._lock:
            return sorted(self._targets)

    # --- 落盘 ---------------------------------------------------------------

    def _save(self) -> None:
        """原子落盘（tmp + replace）。调用方持有 `_lock`。

        端口序号在 JSON 里是字符串（JSON 规范只允许字符串 key），读回时转 int。
        落盘失败**吞掉**：指向已经在内存里生效了，不该让一次磁盘错误把用户刚拖的
        线回滚掉；下一次 set/clear 会再试。
        """
        if self._path is None:
            return
        payload = {
            s: {str(p): t for p, t in ports.items()}
            for s, ports in self._targets.items()
        }
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(self._path)
        except OSError:
            pass

    def _load(self, path: Path) -> None:
        """容错读回：坏 JSON / 非法端口号一律跳过，绝不让桥起不来。"""
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if not isinstance(raw, dict):
            return
        for serial, ports in raw.items():
            if not isinstance(serial, str) or not isinstance(ports, dict):
                continue
            bucket: dict[int, dict] = {}
            for port, target in ports.items():
                if not isinstance(target, dict):
                    continue
                try:
                    idx = int(port)
                except (TypeError, ValueError):
                    continue
                if target.get("project") and target.get("name"):
                    bucket[idx] = dict(target)
            if bucket:
                self._targets[serial] = bucket


# 单例 + 绑定的 data_dir。**不放进 `BridgeState`** 因为 `state.py` 不属本写集；
# 用 data_dir 作为身份标识，于是 `reset_state(tmp)` 后第一次访问会自动换成新表——
# 测试之间不串味，也不需要额外的 reset 钩子。
_targets_store: WritebackTargets | None = None
_targets_dir: Path | None = None
_targets_lock = threading.Lock()


def get_writeback_targets() -> WritebackTargets:
    """当前 state 的 data_dir 对应的指向表（data_dir 变了就重建）。"""
    global _targets_store, _targets_dir
    from .state import get_state  # 局部 import：避免与 state 形成模块级循环

    data_dir = get_state().data_dir
    with _targets_lock:
        if _targets_store is None or _targets_dir != data_dir:
            _targets_store = WritebackTargets(Path(data_dir) / "writeback.json")
            _targets_dir = data_dir
        return _targets_store


# --- 吊牌排除 ----------------------------------------------------------------


def is_tag_serial(serial: str) -> bool:
    """这个 serial 是**吊牌**吗？只认 `channels` 里 `kind=="tag"` 的正面证据。

    用户的原话：「如果是 tag 类那就更简单了, 因为完全不用同步」。吊牌是**标记**，
    写回是 Cyl1nder 经 python runtime 单向推过去的；Cyl1nder 不说话时 Houdini
    就当它不存在。所以吊牌**绝不能**进 passthrough/几何路径——把输入几何塞回一个
    吊牌是无意义的写。

    **不能拿 registry 当判据**：`SerialRegistry.touch()` 会给任何合法 serial 自动
    建行，registry 里有记录**不证明**它是 HDA，更不证明它不是吊牌。只有
    `channels.list()` 里那条 `kind:"tag"` 是吊牌自己注册时留下的正面证据。
    """
    if not serial:
        return False
    try:
        from .state import get_state

        rows = get_state().channels.list()
    except Exception:  # noqa: BLE001 - 判不出来就当不是吊牌（走正常 HDA 路径）
        return False
    return any(
        (r or {}).get("kind") == "tag" and (r or {}).get("serial") == serial
        for r in rows
    )


# --- 指向解析 ----------------------------------------------------------------


def resolve_target(port: int, target: dict | None) -> dict:
    """把一个端口的指向解析成 `{port, ok, reason, project, name, resolved}`。

    `ok=False` 就是用户说的「空指针」，cook 时该端口走 passthrough。三种成因分开报，
    因为它们对用户的意思完全不同：
      - `no-pointer`  没指向过（还没搭链路）——**正常状态**，不是错误
      - `dangling`    指向的逻辑名在项目里查不到（条目被删/项目没了）
      - `unresolved`  条目在，但解析失败（锚点失效、nodePath 空）
    """
    out: dict[str, Any] = {
        "port": int(port), "ok": False, "reason": "no-pointer",
        "project": "", "name": "", "resolved": None,
    }
    if not target:
        return out
    project = str(target.get("project") or "")
    name = str(target.get("name") or "")
    out["project"], out["name"] = project, name
    if not project or not name:
        out["reason"] = "dangling"
        return out
    try:
        from .state import get_state

        mappings = get_state().mappings
        if mappings.get_entry(project, name) is None:
            out["reason"] = "dangling"
            return out
        resolved = mappings.resolve(project, name)
    except Exception as exc:  # noqa: BLE001 - 解析失败归一成 unresolved，绝不抛
        out["reason"] = f"unresolved: {str(exc)[:120]}"
        return out
    out["resolved"] = resolved
    if not resolved.get("ok"):
        out["reason"] = f"unresolved: {str(resolved.get('error') or 'resolve failed')[:120]}"
        return out
    out["ok"], out["reason"] = True, "ok"
    return out


# --- passthrough --------------------------------------------------------------
#
# 「用户要是没搭建对应的链路, hda cook 就直接把 input 搬回去就好, 这一部分由桥负责」。
#
# 触发条件（三个**同时**成立才把某个端口的 input 搬回去）：
#
#   1. 这个 serial **不是吊牌**（吊牌完全不用同步，见 `is_tag_serial`）；
#   2. 该端口的指向 `resolve_target(...)["ok"]` 为假 —— 没指向或悬空（空指针）；
#   3. 该端口**还没有存过 output** —— 已经有 output 说明 web/gizmo 真的编辑过它，
#      passthrough 绝不能盖掉用户的编辑（这是三条里唯一不在用户原话里、但必须有的
#      一条：否则每次 cook 都会把编辑结果打回原形）。
#
# 走 `CookTxn` 而不是直接塞 workspace：写「统一推到最后落地」是既有契约，
# 而且 writer 是注入的 —— 用户说写回「还不一定是通过 hda 传回去, 也可能是
# python runtime」，注入点留在外面，这里就不用为了换通道改代码。


def _input_to_output(payload: Any) -> Any:
    """`InputPayload` -> `OutputBuffer`（同构字段照搬；rev 交给 workspace 定）。"""
    from .protocol import OutputBuffer

    return OutputBuffer(
        index=int(getattr(payload, "index", 0)),
        rev=0,
        pointCount=int(getattr(payload, "pointCount", 0)),
        primCount=int(getattr(payload, "primCount", 0)),
        points=list(getattr(payload, "points", []) or []),
        curves=list(getattr(payload, "curves", []) or []),
        faces=list(getattr(payload, "faces", []) or []),
        attributes=dict(getattr(payload, "attributes", {}) or {}),
    )


def passthrough_outputs(
    serial: str,
    inputs: list,
    *,
    existing_ports: set[int] | None = None,
    targets: WritebackTargets | None = None,
) -> dict:
    """决定并生成本趟 cook 要「搬回去」的 outputs。

    返回 `{skipped, reason, ports, buffers, resolved, flush}`：
    `buffers` 是待交给 workspace 的 `OutputBuffer` 列表（调用方负责落 workspace，
    因为 workspace 不在本模块的职责里）；`resolved` 带上每个端口的判定原因，便于
    UI/日志照实说「2 号口没搭链路，已回填输入」。**任何情况都不抛**：cook 不能失败。
    """
    result: dict[str, Any] = {
        "skipped": False, "reason": "", "ports": [],
        "buffers": [], "resolved": [], "flush": None,
    }
    if is_tag_serial(serial):
        # 吊牌：连指向都不必查，直接退出（用户：「完全不用同步」）
        result["skipped"], result["reason"] = True, "tag: no geometry sync"
        return result
    store = targets if targets is not None else get_writeback_targets()
    stored = store.get_all(serial)
    have = existing_ports or set()
    staged: dict[int, Any] = {}
    txn = CookTxn(reader=lambda k: None, writer=lambda k, v: staged.__setitem__(int(k), v))
    txn.begin()
    for payload in inputs or []:
        port = int(getattr(payload, "index", 0))
        info = resolve_target(port, stored.get(port))
        result["resolved"].append(info)
        if info["ok"]:
            continue                      # 链路搭好了：写回走映射，不 passthrough
        if port in have:
            info["reason"] += " (kept existing output)"
            continue                      # 已有编辑结果：绝不覆盖
        txn.write(str(port), _input_to_output(payload))
    flush = txn.flush()
    result["flush"] = dict(flush)
    result["ports"] = sorted(staged)
    result["buffers"] = [staged[p] for p in sorted(staged)]
    if not result["ports"]:
        result["reason"] = "nothing to passthrough"
    return result
