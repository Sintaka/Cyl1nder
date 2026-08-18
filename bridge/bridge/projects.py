"""吊牌 HDA 项目注册表（项目 = 一个 hip 文件，见 devlog/protocol.md「项目 = hip 文件」）。

落盘 bridge/data/projects.json（路径由 state 传入），结构照 ChannelRegistry：
threading.Lock + _dirty + 1.0s debounce + tmp+replace + 容错 load。
成员是 channelRef 引用快照（live 状态以 /api/channels 大全为准），
key 规则同 channels._key_of：kind=tag/hda -> serial；kind=param -> absolutePath。

身份模型：key 恒为 projectSerial（P1-…，不可变），`hip` 只是**当前绑定**的文件路径
（另存为后由迁移换绑）。绝不用 hip 路径/文件名当 key：不同目录的同名文件会撞。
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from .houdini_mcp import normalize_hip
from .protocol import generate_project_serial

# 成员增删写盘防抖：最多每秒落一次盘。
_SAVE_DEBOUNCE = 1.0  # seconds


def hip_name_of(hip: str) -> str:
    """hip 路径 -> 文件名。手工切分而非 Path().name：桥可能跑在 posix 上而路径来自
    Windows Houdini（反斜杠此时不是分隔符），两种分隔符必须一视同仁。"""
    s = (hip or "").strip().strip("\"'").replace("\\", "/").rstrip("/")
    return s.rpartition("/")[2]


class ProjectRegistry:
    def __init__(self, path: Path | None = None, clock=None) -> None:
        self._path = path
        self._records: dict[str, dict] = {}  # projectSerial -> project dict
        self._lock = threading.Lock()
        self._dirty = False
        self._last_saved = 0.0
        self._clock = clock if clock is not None else time.time
        if path is not None and path.exists():
            self._load(path)

    @staticmethod
    def _channel_key(ref: dict) -> str:
        if ref.get("kind") in ("param", "data"):
            return ref.get("absolutePath") or ""
        return ref.get("serial") or ""

    @staticmethod
    def _new_record(label: str, hip: str) -> dict:
        now = time.time()
        return {
            "projectSerial": generate_project_serial(),
            "label": label,
            "hip": hip,
            "hipName": hip_name_of(hip),
            "createdAt": now,
            "updatedAt": now,
            "migratedAt": 0.0,
            "previousHip": "",
            "members": [],
        }

    def create(self, label: str = "", hip: str = "") -> dict:
        """建项目：P1- serial + createdAt/updatedAt=now + members=[]，立即落盘（force）。

        hip 缺省为空（旧调用方不变）；给了就派生 hipName 一并存下。
        """
        rec = self._new_record(label, hip)
        with self._lock:
            self._records[rec["projectSerial"]] = rec
            self._save(force=True)
        return dict(rec)

    def _find_by_hip_locked(self, norm: str) -> dict | None:
        if not norm:
            return None
        for rec in self._records.values():
            if normalize_hip(rec.get("hip") or "") == norm:
                return rec
        return None

    def find_by_hip(self, hip: str) -> dict | None:
        """按 hip 找项目（同一文件只应有一个）。比较前先归一：斜杠统一 + casefold，
        所以 `D:\\a\\x.hip` 与 `d:/a/x.hip` 是同一个项目。hip 为空恒不命中——
        空 hip 不是身份，否则所有未绑定项目会被并成一个。"""
        norm = normalize_hip(hip)
        with self._lock:
            rec = self._find_by_hip_locked(norm)
            return dict(rec) if rec is not None else None

    def ensure_for_hip(self, hip: str, label: str = "") -> tuple[dict, bool]:
        """按 hip 找项目，没有就建 -> (project, created)。

        查与建在**同一把锁**里完成：心跳并发时不会为同一个 hip 建出两个项目
        （这正是此前重复项目的成因）。
        """
        norm = normalize_hip(hip)
        with self._lock:
            rec = self._find_by_hip_locked(norm)
            if rec is not None:
                return dict(rec), False
            rec = self._new_record(label, hip)
            self._records[rec["projectSerial"]] = rec
            self._save(force=True)
            return dict(rec), True

    def rebind_hip(self, pid: str, new_hip: str) -> dict | None:
        """另存为换绑：写 hip/hipName，记 previousHip + migratedAt，刷 updatedAt。"""
        with self._lock:
            rec = self._records.get(pid)
            if rec is None:
                return None
            now = time.time()
            rec["previousHip"] = rec.get("hip") or ""
            rec["hip"] = new_hip
            rec["hipName"] = hip_name_of(new_hip)
            rec["migratedAt"] = now
            rec["updatedAt"] = now
            self._save(force=True)
            return dict(rec)

    def get(self, pid: str) -> dict | None:
        with self._lock:
            rec = self._records.get(pid)
            return dict(rec) if rec is not None else None

    def list(self) -> list[dict]:
        with self._lock:
            items = [dict(r) for r in self._records.values()]
        items.sort(key=lambda r: r.get("createdAt", 0.0))
        return items

    def add_member(self, pid: str, ref: dict) -> dict | None:
        """按 _channel_key 去重：已存在 -> 整体替换该成员；updatedAt=now；项目不存在返回 None。"""
        with self._lock:
            rec = self._records.get(pid)
            if rec is None:
                return None
            key = self._channel_key(ref)
            members = rec["members"]
            for i, m in enumerate(members):
                if self._channel_key(m) == key:
                    members[i] = dict(ref)
                    break
            else:
                members.append(dict(ref))
            rec["updatedAt"] = time.time()
            self._save(force=True)
            return dict(rec)

    def remove_member(self, pid: str, channel_key: str) -> bool:
        """按通道 key 移除成员（成员不存在/项目不存在 -> False）；移除成功刷 updatedAt。"""
        with self._lock:
            rec = self._records.get(pid)
            if rec is None:
                return False
            members = rec["members"]
            for i, m in enumerate(members):
                if self._channel_key(m) == channel_key:
                    del members[i]
                    rec["updatedAt"] = time.time()
                    self._save(force=True)
                    return True
            return False

    def set_label(self, pid: str, label: str) -> dict | None:
        """改名：刷 updatedAt 并立即落盘；项目不存在返回 None。"""
        with self._lock:
            rec = self._records.get(pid)
            if rec is None:
                return None
            rec["label"] = label
            rec["updatedAt"] = time.time()
            self._save(force=True)
            return dict(rec)

    def delete(self, pid: str) -> bool:
        """删项目记录（不存在 -> False）；删除成功立即落盘。"""
        with self._lock:
            if self._records.pop(pid, None) is None:
                return False
            self._save(force=True)
            return True

    def list_empty(self) -> list[str]:
        """0 成员项目的 projectSerial 列表（按 createdAt 升序，与 list() 同序）。"""
        return [p["projectSerial"] for p in self.list() if not p.get("members")]

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
        payload = list(self._records.values())
        tmp = self._path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp.replace(self._path)

    def _load(self, path: Path) -> None:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        for item in data if isinstance(data, list) else []:
            if not isinstance(item, dict):
                continue
            pid = item.get("projectSerial")
            if not pid:
                continue
            # 旧记录（v0.1.00116 之前）没有 hip 相关字段，补默认值后再入表。
            item.setdefault("hip", "")
            item.setdefault("migratedAt", 0.0)
            item.setdefault("previousHip", "")
            item.setdefault("members", [])
            if not item.get("hipName"):
                item["hipName"] = hip_name_of(item.get("hip") or "")
            self._records[pid] = item
