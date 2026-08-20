"""吊牌 HDA 通道注册表（关联注册大全，见 devlog/tag-hda-plan.md P1）。

key 规则：kind ∈ {"tag","hda"} -> serial；kind == "param" -> absolutePath。
落盘 bridge/data/channels.json（路径由 state 传入），结构照 SerialRegistry：
threading.Lock + _dirty + 1.0s debounce + tmp+replace + 容错 load。
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from .protocol import is_valid_serial

# touch 写盘 debounce：最多每秒落一次盘（心跳/探测会高频刷新 lastSeen）。
_SAVE_DEBOUNCE = 1.0  # seconds


class ChannelRegistry:
    def __init__(self, path: Path | None = None, clock=None) -> None:
        self._path = path
        self._records: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._dirty = False
        self._last_saved = 0.0
        self._clock = clock if clock is not None else time.time
        if path is not None and path.exists():
            self._load(path)

    @staticmethod
    def _key_of(ref: dict) -> str:
        if ref.get("kind") in ("param", "data"):
            return ref.get("absolutePath") or ""
        return ref.get("serial") or ""

    def register(self, ref: dict) -> dict:
        """upsert by key：已有 -> 保留 registeredAt；lastSeen=now；返回落库 ref。

        **serial 必须过桥自己的校验**（v0.1.00143）：此前只检查 key 非空，从不看 serial，
        于是一条 `serial:"c"` 的 tag 行进了注册表（实测；`is_valid_serial("c")` 是 False）。
        单字符看着像"取了首字符"之类的截断事故 —— 一次性写坏，但没有任何东西拦住它。
        铁律说 serial 是识别节点的唯一依据，那么**写入口就该是它的守门人**。
        """
        now = time.time()
        with self._lock:
            key = self._key_of(ref)
            if not key:
                raise ValueError("empty channel key")
            serial = ref.get("serial") or ""
            if not is_valid_serial(serial):
                raise ValueError(f"invalid serial: {serial!r}")
            existing = self._records.get(key)
            registered_at = existing.get("registeredAt") if existing else 0.0
            rec = dict(ref)
            rec["registeredAt"] = registered_at or now
            rec["lastSeen"] = now
            self._records[key] = rec
            self._save(force=True)
            return dict(rec)

    def get(self, key: str) -> dict | None:
        with self._lock:
            rec = self._records.get(key)
            return dict(rec) if rec is not None else None

    def list(self) -> list[dict]:
        with self._lock:
            items = [dict(r) for r in self._records.values()]
        items.sort(key=lambda r: r.get("registeredAt", 0.0))
        return items

    def touch(self, key: str, ts: float) -> bool:
        """刷新 lastSeen；未知 key 返回 False（不自动注册）。"""
        with self._lock:
            rec = self._records.get(key)
            if rec is None:
                return False
            rec["lastSeen"] = ts
            self._dirty = True
            self._save()
            return True

    def retire_except(self, serial: str, kind: str, keep_rels: set[str]) -> list[str]:
        """删掉该 serial 下**不再被声明**的通道行，返回被删的 rel 列表（v0.1.00131）。

        为什么需要它：吊牌把 `entries` 从 `tx` 改成 `t` 之后，旧的 `tx` 行**永远留着** ——
        注册只有 upsert、没有退役，心跳也只 touch 不删。于是映射表里同时存在 `transform1/tx`
        与 `transform1/t`，用户看到的就是"过时的注册参数"。

        只删**同 serial 同 kind 且 rel 非空**的行：
        - 跨 serial 不碰（别的吊牌自己管自己）；
        - `rel` 为空的行是吊牌自身那条 `kind:"tag"` 标记，不是条目产物，删了会让吊牌"消失"；
        - `keep_rels` 为空时**什么都不删**（视为"这次没声明"，而不是"声明了空集"）——
          否则一个旧 HDA 发来的不带 names 的心跳会把所有条目清空。
        """
        if not serial or not keep_rels:
            return []
        removed: list[str] = []
        with self._lock:
            for key, rec in list(self._records.items()):
                if rec.get("serial") != serial or rec.get("kind") != kind:
                    continue
                rel = (rec.get("rel") or "").strip()
                if not rel or rel in keep_rels:
                    continue
                del self._records[key]
                removed.append(rel)
            if removed:
                self._dirty = True
                self._save(force=True)
        return removed

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

    def _drop_stale_tag_collisions(self) -> list[str]:
        """同一 `(hip, nodePath)` 上有多个 tag 行时，只留**心跳最新**的那个（v0.1.00145）。

        为什么这条判据是自证的、不必问 Houdini：serial 创建时生成、持久化、不可变，
        所以一个节点在一个 hip 里**只能有一个** serial —— 同 `(hip, nodePath)` 出现两个
        就必然有一个是旧的（复制/删除节点留下的）。而心跳**只来自那个节点自己 cook 时**，
        于是"最近还在心跳的那个"就是当前那个。

        实测撞到的就是这个：`/obj/geo1/Cyl1nderTag2` 同时挂着
        `C1-mt09nkms-bwxp`（lastSeen 08-20）与 `C1-mt07aw69-cvtl`（lastSeen 08-19），
        而用 MCP 读活节点得到的是前者 —— 与本判据一致。

        **刻意不按心跳年龄单独判死**：devlog 记过实测有活吊牌 2938s 未 cook，
        "很久没心跳"只说明"最近没 cook"。这里用的是**相对**比较（同一个坑位谁更新），
        不是绝对阈值，所以不会误杀一个安静但活着的吊牌。

        跨 hip 的同名节点**不算冲突**：那是另一个文件里的登记，用户重开那个文件就该用它。
        """
        groups: dict[tuple[str, str], list[str]] = {}
        for key, rec in self._records.items():
            if rec.get("kind") != "tag":
                continue
            node = (rec.get("nodePath") or "").strip()
            if not node:
                continue
            groups.setdefault(((rec.get("hip") or "").strip(), node), []).append(key)
        dropped: list[str] = []
        for (hip, node), keys in groups.items():
            if len(keys) < 2:
                continue
            keys.sort(key=lambda k: float(self._records[k].get("lastSeen") or 0.0), reverse=True)
            for stale in keys[1:]:
                del self._records[stale]
                dropped.append(f"{stale}(stale tag for {node} in {hip[-24:]})")
        return dropped

    def _load(self, path: Path) -> None:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        dropped: list[str] = []
        for item in data if isinstance(data, list) else []:
            if not isinstance(item, dict):
                continue
            key = self._key_of(item)
            if not key:
                continue
            # **载入时自愈**（v0.1.00143）：磁盘上已有的坏行在这里被丢掉，
            # 于是重启一次就干净，不需要手工改 channels.json（改了也会被内存态覆写）。
            if not is_valid_serial(item.get("serial") or ""):
                dropped.append(f"{key}(bad serial {item.get('serial')!r})")
                continue
            # param/data 行没有 `rel` = v0.1.00114 之前的遗留：逻辑名/锚点体系诞生前的产物，
            # 端口下拉里显示成 `rel: (none) type: -`，点了也解析不出东西。
            # tag 行的 `rel` 本来就是空（它是吊牌自身的标记行），所以只筛 param/data。
            if item.get("kind") in ("param", "data") and not (item.get("rel") or "").strip():
                dropped.append(f"{key}(no rel)")
                continue
            self._records[key] = item
        dropped.extend(self._drop_stale_tag_collisions())
        if dropped:
            # 用 print 而非 logs：`_load` 在 state 装配期间跑，此时 LogRing 还不一定就绪。
            print(f"[channels] dropped {len(dropped)} invalid row(s) on load: {', '.join(dropped)}")
