# 下一功能周期实施计划：本地时间轴 → 手动同步开关 → IndexedDB 帧缓存

> 日期 2026-08-13 · 角色：主进程（Confucius 子智能体产出，主进程落盘）。目标用户原话：① 时间轴"基本上是本地工作"（scrub 不依赖 Houdini）；② 双向同步改手动开关（右下角，默认 OFF）；③ 只有前两者完成后才接 IndexedDB 帧缓存。分支遵循统一主线 `codex/develop`，每阶段一个 commit + 一条 devlog。**本文件是计划，供新对话执行；msgpack 轮（v0.1.00098）已完成，本计划在其之上。**
> **状态（v0.1.00100，2026-08-14）**：**Phase A 已实现并合并**——协议三处同步（`InputsPut.frame` / types.ts / protocol.md）+ HDA `(sig, frame)` 推送门 + web `core/timeline.ts` 逐帧快照 + 底部栏时间轴 UI（scrub/帧号/◀▶/播放/30fps/锚定灯○）+ store.frame 切片 + round21 E2E 骨架。验证：pytest 59 / tsc 0 / vitest 158 / hython SMOKE OK。**下一轮做 Phase B（手动双向同步开关，右下角默认 OFF）**；Phase C（IndexedDB 帧缓存）gate = A+B 完成。

## Phase A — 时间轴（本地优先，纯本地 scrub）
- **UI（底部栏新增，非 docking）**：scrub 滑条 + 当前帧显示/可键入 + 上一帧/下一帧（Shift ±10）+ 播放/停止（可选）+ 本地 fps=30 只读 + 锚定灯（●Houdini/○本地，v1 恒 ○）。帧范围 v1 = 本地自动扩展 `[min..max]`（默认 1..100）；读取 Houdini playbar range 留到 Phase B engaged 路径。
- **本地 scrub 机制（v1 最小闭环）**：web 持有逐帧 INPUT 快照。来源 = H→C 输入推送带上可选 `frame` 字段（HDA `_push_inputs_if_changed` 捎带 `hou.frame()`；bridge 透传；WS `inputs` 消息加 `frame?`）——Houdini 把范围 cook 一遍（拖 playbar / Force Cook），web 把每帧 inputs 收进 `timeline.frameInputs: Map<frame, InputPayload[]>`。之后 scrub 完全本地：`timeline.setFrame(f)` → `store.setFrame(f)` + `store.setInputs(frameInputs[f], store.inputRev+1)` + `scheduleNetwork()` → 走现有 `network.run()` → chain-cache 本地算 → `store.upsertOutputs` → 视口刷新。**零 /stream、零 pushOutputs、零 Houdini 往返**。帧未收集 → 时间轴照走，几何为空 + log 提示。
- **挂载点**：新 `web/src/core/timeline.ts` + `web/src/app/timeline-ui.ts`；`workspace.ts` 加 `frame` 切片；`session.ts` inputs handler 分流 `frame`；`main.ts` 接线。协议只加"可选 frame 字段"（铁律 3 三处同步）。
- **明确不做**：C→H `setFrame`、H→C 跟随播放头、engaged/锚定、fps 跟随、任何 /stream 依赖。

## Phase B — 手动双向同步开关（右下角，默认 OFF）
- **OFF（默认"本地模式"）**：/stream 循环不启动（HDA 侧）、WS outputs 回显不广播（bridge 侧）、HDA 收到 outputs 不 recook、web 不 pushOutputs、不 kick。H→C 输入推送保留（读 Houdini 状态供本地时间轴/视口，属"本地工作"）；HDA 显示分支照常 cook。
- **ON（=现状 engaged）**：web 推 outputs → bridge 去重/rev++ → WS 回显 + notify_stream → HDA /stream 事件 → recook → 回推 inputs → web autoRun。
- **gate 点（新状态 `syncEnabled`，web 单一事实源，persist 到 prefs）**：network.ts `pushOutputs` 包 `shouldPush()`；main.ts viewport edit 回调 gate + `updateMode` 语义改为"本地计算粒度"，推送一律由 syncEnabled 决定；session.ts OFF 时忽略 WS outputs echo；kick.ts OFF 不 kick；bridge routes `put_outputs` 的 stage_broadcast + notify_stream 按 serial `sync_enabled` gate；bridge state 新增 per-serial `sync_enabled`（默认 False）；hda `ensure_sync` 读 gate（OFF → 不启动）；**OFF→ON 发现用低配 /pending 控制探测（~1-2s），保证 OFF 期间 /stream 字面零请求**。
- **验证**：默认 OFF → 零 /stream + 无 outputs echo；toggle ON → round17/round19 原样通过；hython enabled=false 无循环 / true 起循环。

## Phase C — IndexedDB 帧缓存（gate = A+B 完成）
- 严格按 `timeline-frame-cache-design.md`：第一刀内存 LRU Map（键 serial/frame/inputContentSig/graphVersion/parmRev）+ `workspace.ts` 加 `parmRev`（param 提交/undo/gizmo mouseup bump）+ session inputs handler 命中判定（clean → load 不 run；dirty → run + write-through）；第二刀 `frame-cache-db.ts` IDB 双 store + LRU 清扫 + 启动预载（fake-indexeddb）。
- **与 toggle 交互**：OFF 时帧缓存是 scrub 帧输出的唯一来源；ON 时命中路径跳过 run ⇒ 也跳过 push。本阶段不碰 bridge/hda/protocol（web 私有层）。
- **验证**：同帧第二趟 scrub 零 run()（log/spy）；刷新后命中 IDB。

## 顺序 + 每阶段文件级写集
- **为什么 A→B→C**：A 提供帧身份（缓存键 + scrub 驱动器）与本地帧输入源；B 关掉噪声/往返，确立"OFF 时缓存是唯一输出源"不变量（C 的 skip-push 前提）；C 叠加零重算。
- **A 写集**：web=`timeline.ts`(新)/`timeline-ui.ts`(新)/`workspace.ts`/`layout.ts`/`session.ts`/`main.ts`/`protocol/types.ts` + `timeline.test.ts`(新)/`round21`(新)；hda=`cyl1nder_hda.py`(frame 捎带)/`hython_smoke.py`；bridge=`protocol.py`/`routes.py`/`ws.py`/`test_routes.py`；主进程=`protocol.md`/`timeline-design.md` 注记 + 版本。
- **B 写集**：web=`main.ts`/`network.ts`/`session.ts`/`kick.ts`/`layout.ts`/`protocol/types.ts` + e2e fixtures；bridge=`state.py`/`routes.py`/`ws.py`/`test_routes.py`；hda=`cyl1nder_sync.py`/`cyl1nder_hda.py`/`build_hda.py`(可选 parm)/冒烟。
- **C 写集**：纯 web=`frame-cache.ts`(新)/`frame-cache-db.ts`(新)/`workspace.ts`/`session.ts`/`main.ts`/`dataflow.ts`/`param-undo.ts`/`gizmo.ts` + vitest/e2e；无 bridge/hda 写集。
