# 同步速率上限 + bridge 阻塞修复 + 首选项系统 / Sync rate cap & bridge blocking fix & Preferences

> 版本 0.1.00057 候选 · 日期 2026-08-12 · 角色：主进程（调研 + 设计 + 契约 + 合并）
> 关联：`sync-heartbeat-redesign.md`（v0.1.00056 /stream）、`sync-architecture.md`、`snapshot-design.md`、`development-standards.md`（并行规范）

## 一、调研结论（用户反馈：长时间拖动 → bridge 卡住 → HDA 不同步 → 之后高 CPU 处理过期请求）

### 1.1 根因：registry 同步写盘阻塞事件循环（已压测实锤）
- `registry.touch()` / `mark_activity()` / `register()` 每次都同步调用 `_save()`：把整个 `registry.json` 写盘（tmp+replace）。
- 拖动链路每帧：web PUT outputs → `mark_activity`（~0.82ms 写盘）→ `notify_stream` → HDA 重连 /stream → `touch`（~0.78ms 写盘）→ HDA 拉 /outputs。
- 压测（bridge/tests/test_probe_save.py，跑完已删）：`touch` 0.78ms、`mark_activity` 0.82ms、`_save` 0.84ms、`put_outputs` 仅 0.004ms（不是瓶颈）。**60Hz 拖动 = 事件循环上 ~96ms/s 同步磁盘 I/O（~10% CPU/秒）** → 事件循环延迟尖峰（bridge 卡住）→ HDA 心跳/stream 响应延迟（不同步）→ 拖动结束后积压请求集中处理（高 CPU 且无新数据）。
- 次要因素：web Auto Update 每帧推流无速率上限；HDA `_stream_loop` 每个事件都 `_refresh_ready`（拉 /outputs）不节流（scheduled 只防 recook 重叠，不防频率）；bridge WS 广播/notify 每事件一次。

### 1.2 30fps 现状：单向（历史）
- v0.1.00055 及以前：HDA `sync_fps`（默认 30）只约束 **HDA→bridge 轮询 /pending 的频率（单向：HDA 拉取）**；web→bridge 推流、bridge→HDA 事件唤醒、HDA recook 频率都**无速率上限**（recook 只有 `scheduled` 门控防重叠）。
- v0.1.00056（/stream 事件驱动）后 `sync_fps` 被标为「历史参数」，不再参与任何限速。
- 结论：**缺每端防守型速率上限**。用户要求：Web 底部栏 Sync Max FPS + 每端上限（发送端 cap + 接收端 cap）。

## 二、设计：每端 Sync Max FPS（默认 30，1..60）

| 端 | 速率上限作用 | 来源 |
|---|---|---|
| Web（发送端） | **Auto Update 推流不设上限（v0.1.00059 修正：越快越好）** | 底部栏 Sync Max FPS = kick bridge 上限（存 Preference.json） |
| Bridge（接收+转发端） | `registry._save` 防抖（≤1次/秒，消灭事件循环阻塞）；`notify_stream` 合帧 ≤ fps；WS broadcast 合帧 ≤ fps | `PUT /api/hda/{serial}/sync {fps}`（web 下发，默认 30） |
| HDA（接收端） | `_refresh_ready` 拉取 + recook 调度 ≤ fps（latest-wins；`scheduled` 门控保留） | HDA `sync_fps` 参数（默认 30，重新启用）+ /stream 事件 `fps` 字段（bridge 转发，运行时更新） |

闭环：web 改 Sync Max FPS → 存 Preference.json + `PUT /sync` → bridge 以 fps 节流转发，并在 /stream 事件里带 `fps` → HDA 更新运行时接收上限。HDA 本地 `sync_fps` 参数为无 web 时的默认防守。

### 2.1 协议（三处同步：protocol.py / types.ts / protocol.md）
- 新端点 `PUT /api/hda/{serial}/sync`，body `{"fps": int}`（1..60，默认 30）→ 存每-serial 内存配置（无需落盘，web Preference.json 为持久源），返回 `{ok, fps}`。
- `/stream` 事件全部附加 `"fps": <当前每-serial fps>`（HDA 用它更新接收上限）。
- `putSnapshot` 新增 `preference` 部件 → bridge 写入 `<serial>/Preference.json`（snapshot `_PARTS` 加 `("preference", (".", "Preference.json"))`）；`save_scene` copytree 自动包含；`read_snapshot` 返回。
- 常量：`SYNC_FPS_DEFAULT=30`、`SYNC_FPS_MIN=1`、`SYNC_FPS_MAX=60`。

### 2.2 Preference.json（v1 schema）
```json
{ "schemaVersion": 1, "sync_max_fps": 30, "update_mode": "auto" }
```
- `update_mode`：enum `"auto" | "mouseup"`（localStorage key 同步改 `cyl1nder.update_mode`，旧 `cyl1nder.updateMode` 读一次迁移）。
- 保存点：① Edit→Preference 对话框 Save → 本地 + `putSnapshot({preference})`；② Save Scene / Save Scene As / Ctrl+S / Ctrl+Alt+S 时一并保存；③ 打开场景（FS Access 或桥路径）时读取并应用。

### 2.3 Web UI
- 底部栏：删除 "Update" 灰字 label，仅保留下拉框；右侧新增 `Sync Max FPS`（Int number input，1..60，默认 30，v0.1.00062 起为 ▲▼ 步进样式）→ 输入即存 Preference.json + `PUT /sync`（kick bridge / HDA 接收上限；web 推流本身不设上限，见 v0.1.00059 修正）。
- 菜单栏新增 **Edit** 菜单 → **Preference…** 打开偏好浮动面板（v0.1.00058 起非模态 + 分类标签 General/Viewport/UI + Cancel/Apply/Accept + 可拖动 + 单实例）。
- 快捷键：`Ctrl+S` = 快速保存（当前 serial：putSnapshot graph+docking+preference + 日志）；`Ctrl+Alt+S` = 另存为（saveSceneAs）；均 `preventDefault()`，阻止 Chrome 保存网页。
- 推流（v0.1.00059 起无上限）：Auto Update 越快越好，移除 throttledPush；Sync Max FPS 仅限 kick bridge（bridge 接收/转发 + HDA recook）。

### 2.4 Bridge 阻塞修复
- `registry._save` 防抖：`_dirty` + `_last_saved`，距上次保存 <1s 则跳过（register/remove 立即保存保证持久，touch/mark_activity 走防抖）。
- `notify_stream` 合帧：每-serial 距上次唤醒 <1/fps 时挂 dirty，到点统一 set（事件循环内 `call_later` 或等价）。
- WS broadcast 合帧：每-serial 窗口内多笔编辑合并为一次广播（最新 outputs 集合 + rev）。

### 2.5 HDA
- `sync_fps` 参数重新启用为接收上限（默认 30）；`_SYNC[serial]["fps"]` 启动时取参数，/stream 事件 `fps` 变化时更新。
- `_stream_loop`：outputs/kick 事件后 `_refresh_ready` + recook 调度受 fps 节流（距上次动作 <1/fps → 只更新 last_seen 不拉不调度，latest-wins；到点拉最新并调度）。

## 三、落地分工（并行 agent + 主进程合并）
- **Agent A（bridge）**：registry.py（save 防抖）、state.py（sync fps 存储 + notify 合帧 + broadcast 合帧）、routes.py（PUT /sync + put_outputs 转发节流 + /stream 带 fps + put_snapshot preference）、ws.py（edit 走合帧广播）、snapshot.py（_PARTS 加 preference）、protocol.py（常量/注释，**不动 VERSION**）、tests（test_routes/test_registry）。
- **Agent B（hda）**：cyl1nder_hda.py（fps 节流 + sync_fps 重新启用 + 事件 fps 更新）、hython_smoke.py。
- **Agent C（web）**：app/layout.ts、main.ts、app/preference.ts（新建）、bridge/client.ts、protocol/types.ts、styles/base.css（仅底部栏+偏好对话框样式）、e2e/round12-updatemode.spec.ts、e2e/round13-preference.spec.ts（新建）。
- **主进程**：devlog（protocol.md / annotations-* / README）+ 版本号 bump + 合并验证 + 单 commit。

## 四、验证
- bridge：pytest（registry save 防抖、/sync 端点、stream 带 fps、notify/broadcast 合帧 ≤fps、preference 部件读写、既有测试不回归）。
- hda：hython 冒烟（fps 节流：事件密集时 recook/pull 不超 fps、latest-wins、stream fps 更新运行时值、既有 stream 测试不回归）。
- web：tsc 0 + vitest + e2e（round12 更新：update_mode/去灰字/Sync Max FPS；round13 新增：Preference 对话框 + Ctrl+S/Ctrl+Alt+S + Preference.json 保存读取）。
- 跨端：三处协议一致 + 实桥 hython + e2e 全绿。