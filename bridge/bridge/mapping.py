"""映射注册表：逻辑名 -> 相对地址 + 锚点（见 devlog/project-mapping-design.md）。

node 侧只引用**逻辑名**，绝对 Houdini 路径只存在于本注册表。
锚点 = 吊牌 serial（创建即不可变，移动/改名不变——铁律 1），吊牌每次 cook 上报
自身 nodePath；锚点移动只改 anchors 一处，其下全部 entry 自动跟随。

解析规则：absolutePath = <锚点 nodePath 的所在网络> + "/" + entry.rel
  （rel 以吊牌**所在网络**为基准 = 兄弟节点语义，不是吊牌自身路径）

落盘 bridge/data/mappings.json，结构照 ChannelRegistry：
threading.Lock + _dirty + 1.0s debounce + tmp+replace + 容错 load。
与 channels.json 不同：顶层是 dict（{"anchors": {...}, "entries": {...}}）。
"""
from __future__ import annotations

import json
import posixpath
import threading
import time
from pathlib import Path

from .protocol import MAPPING_TYPES

# lastSeen 刷新写盘 debounce：吊牌 cook 上报高频，最多每秒落一次盘。
_SAVE_DEBOUNCE = 1.0  # seconds


def resolve_path(anchor_node_path: str, rel: str) -> str:
    """兄弟节点语义：剥掉锚点自身末段（吊牌节点名）再接 rel，posixpath 归一（支持 ../）。"""
    network = posixpath.dirname(anchor_node_path.rstrip("/"))
    if not network:
        return ""
    return posixpath.normpath(posixpath.join(network, rel))


class MappingRegistry:
    def __init__(self, path: Path | None = None, clock=None) -> None:
        self._path = path
        self._anchors: dict[str, dict] = {}                  # serial -> AnchorRef
        self._entries: dict[str, dict[str, dict]] = {}       # projectSerial -> {name: MappingEntry}
        self._lock = threading.Lock()
        self._dirty = False
        self._last_saved = 0.0
        self._clock = clock if clock is not None else time.time
        if path is not None and path.exists():
            self._load(path)

    # --- 锚点 ---------------------------------------------------------------

    def upsert_anchor(
        self,
        serial: str,
        node_path: str,
        hip: str = "",
        mode: str = "parm",
        pid: int = 0,
        mcp_port: int = 0,
    ) -> dict:
        """吊牌上报自身位置。moved=True 仅当**原有非空** nodePath 真的变了。

        返回 {"anchor", "moved", "old", "names", "pid_changed", "old_pid"}；moved 时
        names 列出（跨项目）引用该锚点的全部逻辑名，供 WS anchor-moved 广播提示 web
        （逻辑名不变）。

        pid / mcp_port 只在非零时记录：旧 HDA 构建根本不报这两项，把已知的好值清成 0
        会让后续探测彻底失去判据（铁律：pid 是识别 Houdini 实例的唯一可靠依据）。
        pid 变了 = 同一路径下换了**另一个进程**（Houdini 重开），旧的核对结论作废，
        所以连带清空 verifiedAlive/verifiedAt。
        """
        if not serial:
            raise ValueError("empty anchor serial")
        now = time.time()
        with self._lock:
            existing = self._anchors.get(serial)
            old = (existing.get("nodePath") or "") if existing else ""
            moved = bool(old) and old != node_path
            rec = dict(existing) if existing else {
                "serial": serial, "movedAt": 0.0,
                "pid": 0, "mcpPort": 0, "verifiedAt": 0.0, "verifiedAlive": False,
            }
            old_pid = int(rec.get("pid") or 0)
            old_port = int(rec.get("mcpPort") or 0)
            rec["nodePath"] = node_path
            rec["hip"] = hip
            rec["mode"] = mode
            rec["lastSeen"] = now
            if moved:
                rec["movedAt"] = now
            new_pid = int(pid or 0)
            pid_written = bool(new_pid) and new_pid != old_pid   # 首次记录或换了进程
            pid_changed = pid_written and bool(old_pid)          # 换了进程（重开）
            # `or old_*`：缺省/零值退回原值，绝不把已知好值覆盖成 0
            rec["pid"] = new_pid or old_pid
            rec["mcpPort"] = int(mcp_port or 0) or old_port
            rec.setdefault("verifiedAt", 0.0)          # 旧盘文件没这两个键
            rec.setdefault("verifiedAlive", False)
            if pid_changed:                   # 换进程了：上次核对不再能证明任何事
                rec["verifiedAlive"] = False
                rec["verifiedAt"] = 0.0
            self._anchors[serial] = rec
            names = [n for _, n in self._entries_for_anchor(serial)] if moved else []
            port_changed = int(rec.get("mcpPort") or 0) != old_port
            self._dirty = True
            self._save(force=moved or existing is None or pid_written or port_changed)
            return {
                "anchor": dict(rec),
                "moved": moved,
                "old": old,
                "names": names,
                "pid_changed": pid_changed,
                "old_pid": old_pid,          # 供 trace 写出 pid 迁移（换进程时才有意义）
            }

    def mark_verified(self, serial: str, alive: bool, port: int = 0, actual_pid: int = 0) -> dict | None:
        """记录一次探测结论（探测端点调用）。未知 serial -> None。

        port 非零时同时更新 mcpPort：实例可能重开到了别的端口（按 hip 重新定位过）。

        actual_pid 只作探测回执**记录**，不写进 rec["pid"]：pid 的唯一权威来源是吊牌
        自报（它就在那个进程里，`os.getpid()` 不会错）。从一个端口探来的 pid 只能证明
        「此刻这个端口上是那个进程」——端口在重开后可能已属于别的实例，拿它当期望值
        等于凭空造出一个判据，正是铁律要防的那种猜。
        """
        with self._lock:
            rec = self._anchors.get(serial)
            if rec is None:
                return None
            rec = dict(rec)
            rec["verifiedAt"] = time.time()
            rec["verifiedAlive"] = bool(alive)
            rec["mcpPort"] = int(port or 0) or int(rec.get("mcpPort") or 0)
            self._anchors[serial] = rec
            self._dirty = True
            self._save(force=True)
            return dict(rec)

    def get_anchor(self, serial: str) -> dict | None:
        with self._lock:
            rec = self._anchors.get(serial)
            return dict(rec) if rec is not None else None

    def list_anchors(self) -> dict[str, dict]:
        with self._lock:
            return {k: dict(v) for k, v in self._anchors.items()}

    # --- 条目 ---------------------------------------------------------------

    def put_entry(self, project: str, name: str, entry: dict) -> dict:
        """upsert 一条逻辑名映射（项目内唯一）；非法 type / 空 anchor / 空 rel -> ValueError。"""
        if not project or not name:
            raise ValueError("empty project or name")
        rec = dict(entry)
        if not (rec.get("anchor") or ""):
            raise ValueError("empty anchor")
        if not (rec.get("rel") or ""):
            raise ValueError("empty rel")
        if rec.get("type", "float") not in MAPPING_TYPES:
            raise ValueError(f"invalid type {rec.get('type')!r}")
        with self._lock:
            self._entries.setdefault(project, {})[name] = rec
            self._save(force=True)
            return dict(rec)

    def del_entry(self, project: str, name: str) -> bool:
        with self._lock:
            names = self._entries.get(project)
            if not names or name not in names:
                return False
            del names[name]
            if not names:
                del self._entries[project]
            self._save(force=True)
            return True

    def get_entry(self, project: str, name: str) -> dict | None:
        with self._lock:
            rec = self._entries.get(project, {}).get(name)
            return dict(rec) if rec is not None else None

    def list_entries(self, project: str) -> dict[str, dict]:
        with self._lock:
            return {k: dict(v) for k, v in self._entries.get(project, {}).items()}

    # --- 解析 ---------------------------------------------------------------

    def resolve(self, project: str, name: str) -> dict:
        """MappingResolved 形状的 dict。锚点缺失/nodePath 为空 -> ok=False，绝不抛。"""
        with self._lock:
            entry = self._entries.get(project, {}).get(name)
            anchor = self._anchors.get(entry.get("anchor") or "") if entry else None
            anchor = dict(anchor) if anchor is not None else None
            entry = dict(entry) if entry is not None else None
        return self._resolve_one(name, entry, anchor)

    def resolve_all(self, project: str) -> dict[str, dict]:
        with self._lock:
            entries = {k: dict(v) for k, v in self._entries.get(project, {}).items()}
            anchors = {k: dict(v) for k, v in self._anchors.items()}
        return {
            name: self._resolve_one(name, entry, anchors.get(entry.get("anchor") or ""))
            for name, entry in entries.items()
        }

    @staticmethod
    def _resolve_one(name: str, entry: dict | None, anchor: dict | None) -> dict:
        out = {
            "name": name,
            "absolutePath": "",
            "kind": (entry or {}).get("kind", "param"),
            "adapter": (entry or {}).get("adapter"),
            "type": (entry or {}).get("type", "float"),
            "anchor": (entry or {}).get("anchor", "") or "",
            "ok": False,
            "error": "",
        }
        if entry is None:
            out["error"] = "unknown mapping name"
            return out
        if anchor is None:
            out["error"] = f"unknown anchor {out['anchor']}"
            return out
        node_path = anchor.get("nodePath") or ""
        if not node_path:
            out["error"] = f"anchor {out['anchor']} has no nodePath"
            return out
        absolute = resolve_path(node_path, entry.get("rel") or "")
        if not absolute:
            out["error"] = f"cannot resolve anchor path {node_path!r}"
            return out
        out["absolutePath"] = absolute
        out["ok"] = True
        return out

    # --- 清理 ---------------------------------------------------------------

    def entries_for_anchor(self, serial: str) -> list[tuple[str, str]]:
        with self._lock:
            return self._entries_for_anchor(serial)

    def _entries_for_anchor(self, serial: str) -> list[tuple[str, str]]:
        """调用方持有 _lock。"""
        return [
            (project, name)
            for project, names in self._entries.items()
            for name, entry in names.items()
            if (entry.get("anchor") or "") == serial
        ]

    def prune_anchor(self, serial: str) -> int:
        """删锚点 + 其下全部 entry；返回被删 entry 数。"""
        with self._lock:
            doomed = self._entries_for_anchor(serial)
            for project, name in doomed:
                del self._entries[project][name]
            for project in {p for p, _ in doomed}:
                if not self._entries[project]:
                    del self._entries[project]
            self._anchors.pop(serial, None)
            self._save(force=True)
            return len(doomed)

    def drop_project(self, project: str) -> bool:
        """删除该项目的整个 entries 分区（项目被删时调用）。"""
        with self._lock:
            if project not in self._entries:
                return False
            del self._entries[project]
            self._save(force=True)
            return True

    # --- 落盘 ---------------------------------------------------------------

    def save_now(self) -> None:
        with self._lock:
            self._save(force=True)

    def _save(self, force: bool = False) -> None:
        """原子落盘（tmp + replace）；非 force 走 debounce。调用方持有 _lock。"""
        if self._path is None:
            return
        now = self._clock()
        if not force:
            if not self._dirty:
                return
            if now - self._last_saved < _SAVE_DEBOUNCE:
                return
        self._dirty = False
        self._last_saved = now
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"anchors": self._anchors, "entries": self._entries}
        tmp = self._path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp.replace(self._path)

    def _load(self, path: Path) -> None:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if not isinstance(data, dict):
            return  # 旧格式/畸形：当空表处理
        anchors = data.get("anchors")
        if isinstance(anchors, dict):
            for serial, rec in anchors.items():
                if serial and isinstance(rec, dict):
                    self._anchors[serial] = rec
        entries = data.get("entries")
        if isinstance(entries, dict):
            for project, names in entries.items():
                if not project or not isinstance(names, dict):
                    continue
                part = {n: e for n, e in names.items() if n and isinstance(e, dict)}
                if part:
                    self._entries[project] = part
