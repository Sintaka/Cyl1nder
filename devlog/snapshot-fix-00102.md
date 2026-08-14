# 快照系统修复：重启后场景数据丢失 / Snapshot fix v0.1.00102

> 2026-08-14 · 主管合并记录（实现由并行子智能体 A 完成）。
> 问题原话：「每次电脑重启后都找不到之前的场景更改，变成空的。」

## 0 根因（三重，均已修复）

| # | 根因 | 证据 | 修复 |
|---|---|---|---|
| 1 | **WS edit 通道从不落盘**：web 的主编辑通道是 WS `{"type":"edit"}`（60Hz 拖拽），`ws.py` accept 后从不触发快照 → `io/outputs.json` 长期为空 `[]`（实盘 2 字节） | 桥重启后 workspace 内存归零，磁盘又没有 outputs → 编辑全部蒸发 | ws.py edit 分支 accept 后 `await maybe_snapshot(serial)`（复用 5s 节流 + 内容比对） |
| 2 | **桥启动无恢复**：设计「场景 B：一键从快照恢复」从未实现（无 /snapshot/restore 端点，无启动回填） | workspace 重启即空，web 打开只见空场景 | ① lifespan 启动 `restore_all_workspaces()`（仅回填空 workspace）；② 新增 `POST /api/hda/{serial}/snapshot/restore`；③ shutdown `flush_all_workspaces()` 兜住 ≤5s 末窗 |
| 3 | **双根分家**：registry.hip 暂时为空时快照写进回退根 `bridge/data/snapshots/<serial>/`，与 hip 旁 `Cyl1nder/<serial>/` 各读各的 | hip 恢复后只读一处漏掉另一处 | `read_snapshot` 双根合并读（hip 根优先、回退根补缺；两处都兼容 v1 legacy 文件名） |

## 1 实现要点（bridge/bridge/snapshot.py + snapshot_routes.py + ws.py + main.py）

- `restore_workspace(serial, hip) -> bool`：**仅当 workspace 完全空**才恢复（绝不覆盖运行态）；逐条 `InputPayload/OutputBuffer.model_validate`，坏条目跳过 + error 日志；成功 info 日志。
- `restore_all_workspaces()`（启动）/ `flush_workspace` + `flush_all_workspaces()`（关闭）：同步写盘，空 workspace 跳过。
- `POST /api/hda/{serial}/snapshot/restore`：恢复成功后 WS 广播 inputs/outputs（已开标签页即时刷新）。
- `maybe_snapshot` 从 routes.py 迁入 snapshot.py（REST put 与 WS edit 共用；put 路径行为不变）。

## 2 时序自愈（重启电脑后的完整链路）

```
电脑重启 → bridge 启动 → lifespan restore：registry 各 serial 的空 workspace 从磁盘快照回填
→ web 打开 → WS hello 回放（已有 inputs/outputs，非空）
→ Houdini 打开 hip → HDA 轮询 /pending since>rev → reset → 清缓存、从 0 全量拉回（outputs 即恢复的编辑）
→ HDA 重推 inputs（(sig,frame) 门）→ 后续编辑经 WS edit → maybe_snapshot 5s 内落盘 → 下次重启依旧无损
```

## 3 验证

| 项 | 结果 |
|---|---|
| bridge pytest | 106 passed（新增 test_snapshot_restore.py 7 例：round-trip / 双根合并 / 空才恢复 / 坏条目跳过 / WS edit 落盘 / restore 端点） |
| 实机（真实 serial，桥重启） | 日志实证 `workspace restored from disk snapshot (inputs=4 outputs=4)`；REST status 与 geometry 摘要一致 |
| 既有测试修复 | `test_registry.py::test_save_debounced_touch_and_mark_activity` 时间分辨率 flake（lastSeen 用真实时钟，30 次循环未跨 tick）→ 循环内 `time.sleep(0.02)` |

## 4 边界（明示）

- 快照是 workspace 的磁盘镜像（非权威），恢复永远只填空、不覆盖——语义与 snapshot-design.md §1.7/R5 一致。
- 硬关机仍可能丢最后一窗（≤5s）内未落盘的编辑（5s 节流代价）；优雅停桥有 shutdown flush。
- registry.hip 长期为空（HDA 从未成功 register）时快照落在回退根，双根合并读已兼容。
