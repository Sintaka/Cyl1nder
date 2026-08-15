# HDA 子系统改动标注 / HDA annotations

## v0.1.00102（2026-08-14）· fxhoudinimcp 端口发现 + 上报
- **cyl1nder_houdini_mcp.py（新）**：纯 stdlib（零 `import hou`，后台线程安全/重载安全）——`probe/discover_port`（扫 8100..8115，`mcp.health.pid == os.getpid()` 唯一判据 + hip 二次比对）、`get_frame/set_frame`（带主线程死锁警示注释）、`start_discovery`（短命 daemon 线程 + `on_found` 回调当场上报）。
- **cyl1nder_bridge.py**：`report_houdini_mcp(port)` → `PUT /api/hda/{serial}/houdini`（直接、不起线程、失败只记 last_error）。
- **cyl1nder_hda.py**：cook 主线程钩子 `_maybe_report_houdini_mcp`（10s 节流；hou 调用仅 cook 线程；发现成功经 `on_found` 上报 + `mark_reported`，60s 重报）。
- **scripts/reload_hda.py**：MODULES 加 `cyl1nder_houdini_mcp`（无长生命周期线程，无需额外停线程步骤）。
- 实机：热重载 ×2 无崩溃；`known_port()=8100, is_reported()=True`；SMOKE OK。

## v0.1.00101（2026-08-14）· Phase B 手动双向同步开关（HDA 自适应循环）
- **cyl1nder_bridge.py**：新增 `probe_once()`（GET `/pending`，返回 dict 含 `sync_enabled`，异常 None）。
- **cyl1nder_sync.py**：`_stream_loop` 自适应——OFF 时 ~1.5s `/pending` 探测 gate（**零 /stream 请求**、兼心跳），ON 才跑 `/stream`；进入 stream 模式才 warm ready buffer；事件 `sync_enabled=false` 立即切回探测且不 recook；`ensure_sync` state 初始 `sync_enabled=False`。
- **hython_smoke.py**：`_test_sync_enabled_gate()` 三态（OFF 仅 probe / probe=True 进 stream / 事件 false 回 probe）。SMOKE OK。

## v0.1.00100（2026-08-14）· 本地时间轴 Phase A：push_inputs 捎带帧号
- **cyl1nder_bridge.py**：`push_inputs(inputs, hip="", frame=None)`——pending 元组带 frame，HTTP body 加 `"frame"`。
- **cyl1nder_hda.py**：`_push_inputs_if_changed` 缓存键改为 `(sig, frame)`；cook 主线程采样 `hou.frame()`，**帧号变（内容不变）也重新推送**——web 才能逐帧收 inputs；sig+frame 都不变照旧跳过（无回声）。
- **hython_smoke.py**：`_test_push_inputs_frame()` 三分支（sig 变推送 / 仅 frame 变推送 / 都不变跳过）。hython SMOKE OK。

## v0.1.0-cyl1nder.1
- 形态：Subnet HDA（SOP），**4 输入 / 4 输出**（4 个 Output SOP `outputidx` 0-3）。
- 内部：4 个 Python SOP（role 0..3）；Pull Now 回调对内部 python SOP `cook(force=True)` 强制重跑。
- 序列号：首次 cook 生成 `C1-<base36ms>-<4rand>` 写入隐藏参数 `cyl1nder_serial`，之后永不变；**Regenerate Serial** 按钮手动换新号（复制/粘贴节点用）。
- 数据流：role0 序列化 4 输入 → 防抖线程 POST；各 role GET `outputs?since=rev` → 构建输出几何。
- 运行时逻辑在 `hda/src/*.py`（package 的 PYTHONPATH 注入，**热更新免重建 HDA**）。
- 构建：`hython hda/scripts/build_hda.py` → `hda/otls/Cyl1nder_1.0.hda`（create_backup=False）。
- 关键坑（已解决）：python SOP 默认缓存（`cook()` 不重跑）→ `cook(force=True)`；H22 Button parm 用 `pressButton()`/回调；压缩内容默认锁定内部参数（已 setLockContents False）。
- 冒烟：`hython hda/scripts/hython_smoke.py` 全绿（serial 不可变、4 输入推送、编辑→pull→out0 几何）。
## v0.1.0-cyl1nder.2（2026-08-10）
- **空输入修复**：`min_num_inputs=0`（原 4 会让空输入报 `Not enough sources specified.`）。
- **maintainstate=0**：4 个内部 Python SOP 每次 HDA recook 都重跑 → Houdini 一更新（改参数/输入/手动 cook）就推输入给桥，不再受 python SOP 缓存影响。
- **Open in Browser 按钮**：`open_web` 参数回调 `webbrowser.open(bridge_url + '/?serial=' + cyl1nder_serial)`，默认浏览器打开对应工作区。
- 热重载：`hou.hda.reloadFile(path)` 可直接替换活动会话中的定义，实例保留 serial 等参数值。
## v0.1.0-cyl1nder.3（2026-08-10）
- **web_url 参数**：Open in Browser 按钮改开前端地址（默认 `http://127.0.0.1:8376`，参数 `web_url`），不再误开数据桥 8375。
- **Shelf 工具架**：`hda/shelf/Cyl1nder.shelf`（Reload HDA / Reload Bridge，python 图标），装入 `Documents\houdini22.0\toolbar\`，Houdini 下次启动出现（或右键工具架手动加）。
## v0.1.00002（2026-08-10）
- **Force Cook**：`pull_now` 改名 `force_cook`（label "Force Cook"），回调对内部 python SOP `cook(force=True)`。
- **双向同步（30fps 上限）**：新增 `sync_fps` 参数（默认 30，1-60）。role0 cook 时启动守护轮询线程，按 1/sync_fps 间隔调 `GET /api/hda/{serial}/pending?since=`；检测到待拉输出（web 在 Cyl1nder 里改过）→ `hdefereval.executeDeferred` 主线程安全地把 HDA `status` 标记为 `dirty` 并强制重跑 python SOP → 拉回结果 → status 回 `ok`。headless hython 无 hdefereval 时退化为手动 Force Cook。
- 实测：web 推编辑 → ~0.6s 内 Houdini 自动拉回 out0（P=[0,0,0]/[1.5,1.5,0]/[3,3,0]）。
## v0.1.00003（2026-08-10）
- **修复 Force Cook 触发疯狂刷新（反馈回路）**：HDA 重算→推输入→web auto-run 把输入原样回推成输出→桥 outputRev++→30fps 同步又检测到 pending→再重算→…死循环。
  - 桥侧：`put_outputs` 内容去重（相同 points/curves/attrs 不 bump rev、不广播）——从数据层打断回显循环。
  - web 侧：auto-run 仅在**输入内容变化**时跑（`inputsEqual`）；连接时首次 inputs 视为**回放**不触发网络（防重连把用户编辑覆盖成 passthrough）。
  - HDA 侧：仅当拉到本 role 的新 buffer 才 clear+重建，否则**保留现有几何**（Force Cook 不再清空输出）；同步轮询加 `scheduled` 标志避免重复排队。
- **桥重启自愈**：`get_outputs_since` 检测 `since > rev` 视为重置并返回全部；`/pending` 返回 `reset` 标志，轮询线程检测到重置后重拉全部（否则桥重启后 HDA 因 last_rev 大于新 rev 永远不同步）。
## v0.1.00004（2026-08-10）
- **HDA 自动拉起桥**：`bridge_autostart`（默认开）——cook 时若桥不可达，HDA 用 subprocess 拉起 bridge（5s 内最多一次）；已有在线桥则直接复用。
- **脏几何根治（内容对比）**：`_same_as_buffer` 每次 cook 对比当前输出几何与桥最新 buffer，不同才重建；不再用 last_rev/存储哈希做重建决策 → 任何脏写入下次 cook 自动纠正（实测 266 脏几何被 [100,100,100] 覆盖）。
## v0.1.00005（2026-08-10）
- **UI 端口 8376**：`web_url` 默认 `http://127.0.0.1:8376`（与桥 8375 相邻）；Open in Browser 自动开新端口。
- **参数布局同行**：`auto_push|auto_pull|bridge_autostart` 一行（setJoinWithNext）；`force_cook|open_web|cyl1nder_regenerate` 一行。
## v0.1.00007（2026-08-10）
- **Shelf 工具改造**：新增纯 Python 桥控制模块 `hda/scripts/bridge_control.py`（stdlib：`netstat -ano` 找 PID、`taskkill /F` 停、`subprocess.Popen(DETACHED|CREATE_NO_WINDOW)` 起，与 HDA autostart 同一启动方式）。三个按钮全部改为 exec 该模块，**彻底移除 PowerShell**。
  - `Reload Bridge` = `restart_bridge()`（kill + start + 等 /api/health）。
  - 新增 `Toggle Bridge` = `toggle_bridge()`（在线则停、离线则起）。
  - 新增 `Status Bridge` = `status_bridge()`（报版本/序列号数；端口被占但 health 不通时提示 PID）。
  - shelf 已同步到 `%USERPROFILE%\Documents\houdini22.0\toolbar\Cyl1nder.shelf`。按钮逻辑 exec 磁盘文件→热更；**新按钮需 Houdini 重启/shelf 刷新一次才出现**。
- **实测**：status→OFFLINE、toggle 起→ONLINE v0.1.00006 serials=26、toggle 停→OFFLINE、restart→healthy；桥最终由 restart 拉起（HDA autostart 兜底）。
- **决策（Q4）**：前端 vite **不需要** Toggle/Status 按钮——桥生命周期由 Houdini 侧独占（HDA `bridge_autostart` + shelf），web 是被动消费者（状态点 + WS 重连 + 离线提示已覆盖"看状态"）；两方争抢启停同一进程会制造竞态。

## v0.1.00009（2026-08-10）
- **修复 shelf BOM 崩溃**：`bridge_control.py` 曾被 PowerShell `Set-Content -Encoding UTF8`（5.1）写入 UTF-8 BOM，shelf 按钮 `exec(open(...).read())` 报 `SyntaxError: invalid non-printable character U+FEFF`。
  - 已字节级剥离全部 `.py` 的 BOM（bridge/ 18 个 + hda/scripts），统一 UTF-8 no BOM。
  - **经验**：shelf/exec 脚本一律 `exec(open(path, encoding="utf-8-sig").read())`——`utf-8-sig` 自动剥 BOM，杜绝复发。
- **reload_hda 输出去中文**：docstring + `[reload_hda] done...` 改为纯英文（bridge 重启提示：`cd bridge; .venv\Scripts\python -m bridge`）；reload_hda.py 现为 ASCII-only。
- **验证**：模拟 shelf exec（`encoding="utf-8-sig"`）→ `status_bridge()` 正常返回 ONLINE；`reload_hda.py` py_compile 通过；bridge pytest 19 passed；shelf XML 合法且已同步到 Houdini toolbar。
- **fxhoudinimcp HTTP 直连验证**（官方 bridge 后门）：`mcp.health` OK（pid 56768, Houdini 22.0.368, 188 commands），发现 `shelf.run_shelf_tool` 可触发按钮；但 Houdini 主线程对 HOM 调用（execute_python / scene_info）超时——疑似有模态对话框（先前点按钮的错误弹窗/displayMessage）或正在 cook 阻塞主线程，等用户确认空闲后可再触发。

## v0.1.00010（2026-08-10）
- **根因修复：从 Houdini 拉不起桥 = PYTHONHOME/PYTHONPATH 污染**。
  - Houdini 环境导出 `PYTHONHOME=C:/PROGRA~1/SIDEEF~1/HOUDIN~1.368/python311`、`PYTHONPATH=<另一venv>;D:/code/dev/Cyl1nder/hda/src`。
  - 被拉起的 venv Python 3.12 继承后，site 初始化从 **Houdini 的 3.11 stdlib** 导入 pathlib/re → `SRE module mismatch` → 进程启动即崩（exit code 1）。shelf 里 `bridge_healthy` 轮询永远失败 → "failed to start"。
  - 修复：`start_bridge()` 与 HDA `_ensure_bridge()` spawn 时 `env={k:v for k,v in os.environ.items() if not k.upper().startswith("PYTHON")}`（剥离 PYTHONHOME/PYTHONPATH）。
- **桥改为独立可见控制台**：`subprocess.CREATE_NEW_CONSOLE`（不再是隐藏窗口）——与你手动 `cd bridge; python -m bridge` 的体验一致；kill 时窗口随之关闭。
- **shelf 非阻塞**：Toggle/Reload Bridge 在后台线程执行（Houdini 主线程立即返回），结果写 `bridge/bridge_control.log` + 状态栏（`hou.severityType.Message`；注意 Houdini 枚举**没有** `Info`，用 `Message`）+ `hdefereval.executeInMainThread` 安全投递。
- **失败可诊断**：start_bridge 区分 "spawn 异常" / "进程提前退出(code N)" / "10s 未健康"，并返回 pid；窗口本身可见可查。
- **验证（fxhoudinimcp HTTP 直连 Houdini）**：`shelf.run_shelf_tool cyl1nder::toggle_bridge` 从 Houdini 内触发——stop→DOWN ✓、start→2s ok ✓；新版脚本（severityType.Message）在 Houdini 内执行无错 ✓。
- ⚠️ 当前 Houdini 会话内存里的 shelf 仍是旧脚本（主线程那行 severityType.Info 会报一次 Python 错，但不影响 toggle 逻辑）；**重启 Houdini（或刷新 shelf）后彻底干净**。
- 坑记录：`cmd /c start` 在本环境无法启动新进程（所有变体 NOT RUN）；`CREATE_NEW_CONSOLE` 直接 Popen 才有效。

## v0.1.00011（2026-08-10）
- **确认 bridge 轮询行为 = 正常（设计内）**：日志里大量 `GET /api/hda/<serial>/pending?since=0` 是 HDA 的 **sync_fps=30 双向同步轮询器**（每 ~33ms 查一次 web 是否推了新 outputs，dirty 才拉取）；`/api/health` 是 shelf Status/启动确认在查。新 serial `C1-msm6dsp7-ob6t` = 当前场景新建的 HDA 实例。此 30fps 轮询流量正是方案B流式（snapshot+delta / WS / 长轮询，见 streaming-plan-b.md）要消除的，v1 轮询架构下属预期。
- **确认桥单实例**：netstat 8375 仅一个 LISTENING（venv 启动器 + 基础 python 属同一逻辑桥）；此前多次验证测试会短暂出现多个控制台窗口属正常测试现象。
- **弹窗来源说明**：用户看到的 "Windows cannot find ..." 弹窗来自调试阶段 `cmd /c start` 引号错误（会触发 Windows 错误框），已彻底移除该启动方式（改 `CREATE_NEW_CONSOLE`），并写入规范：禁止用会弹 Windows 消息框的方式调试，调试输出走文件/日志。
- **规范补充**：使用 fxhoudinimcp 前必须读官方手册；记录工具参数坑（run_shelf_tool 用 tool_name、execute_python 无顶层 return、severityType 无 Info、HTTP 直连 body 格式）。

## v0.1.00012（2026-08-10）
- **前端生命周期绑定到桥（8375+8376 双端口统一管理）**：
  - `bridge_control.py` 升级为双进程管理器：`start/toggle/restart/status` 同时管理桥(8375) 与 vite(8376)。启动桥后自动确保 UI（8376 没监听则 `node vite` 独立控制台拉起）；停桥同时杀 8376；status 同时显示两者。
  - HDA autostart（`cyl1nder_hda.py _ensure_frontend`）：cook 时若 8376 没起则静默拉起 vite（DETACHED|NO_WINDOW，10s 节流），与 `_ensure_bridge` 同步。
  - `Open in Browser` 回调（build_hda.py）改为：后台线程先 `ensure_frontend()` 再 `webbrowser.open`——不再直接跳到死链接。
  - 已通过 fxhoudinimcp 在 Houdini 内重建 HDA（`reload_cyl1nder(definition=True)`），实例 `/obj/geo1/Cyl1nder1` serial `C1-msm6dsp7-ob6t` 保留，`open_web` 回调已更新。
- **实测**：status 双显（bridge ONLINE | ui ONLINE）；toggle stop 双关（8375+8376 各杀）；toggle start → bridge OK + "ui OK (spawned vite on 8376)"；8376 返回 200。桥版本已到 v0.1.00011。
- **端口决策**：应用数据路径仅 8375+8376；8100 是 fxhoudinimcp 控制通道非数据路径；dev 不合并端口（vite HMR 需要），发行版可让桥托管 dist 静态文件合并为单端口（见 decisions.md）。

## v0.1.00013（2026-08-10）
- **可见性可配（默认可见）**：`bridge_control.py` 增加 `CYL1NDER_CONSOLE=0` 时隐藏（DETACHED|NO_WINDOW），默认 `CREATE_NEW_CONSOLE` 可见。评估结论：**开发期保持可见**（错误/日志即时可见、Ctrl+C 可停、不会像这次桥静默死亡），发行版再隐藏。
- **外部监控"壳"**：新增 `bridge_control.py probe` —— 超快单行看门狗（netstat 端口检查 + fxhoudinimcp `mcp.health` 0.4s 上限，不碰重计算），**可在 Houdini 外运行**，Houdini 重度计算/无响应时也能给出反馈（bridge/ui/houdini-fxmcp 三态）。
- **status 提速**：`status_bridge()` 改为先 netstat 瞬时判端口，HTTP 只取详情（0.3s 上限）+ houdini-fxmcp 探测；单次 ~0.5s（含 python 启动）。
- **shelf 全部触发式**：Toggle/Reload/Status 三个按钮均后台线程执行 + 状态栏 + `bridge_control.log`，主线程零阻塞。
- ⚠️ **Houdini 需重启一次**：当前会话内存里的 shelf 仍是启动时加载的**旧同步版**（`displayMessage(restart_bridge())` 会阻塞主线程数秒 → 用户遇到的"卡死"）；磁盘/toolbar 已是线程版。重启后生效。
- ⚠️ **fxhoudinimcp 8100 当前 502**（插件 hwebserver 对所有请求报错，含 mcp.health）——非桥问题，Houdini 重启可恢复。

## v0.1.00015（2026-08-10）
- **修复「4 个输出口都输出第一个输入」bug**：`hou.Node.geometry()` 的参数是**输出索引**，多输入 Python SOP 上 `node.geometry()` 永远返回 input0 副本；bridge 无该 role 数据时旧代码保持这个 input0 副本 → 4 口全变第一个输入。修复：无数据时 passthrough **该 role 自己的输入**（`node.inputs()[role].geometry()`），内容对比后重建（`_same_geo`）。已加 hython 冒烟断言 `out_i = in_i`。
- **HDA runtime 优化（方案 A，调研结论落地）**：Subnet 内从「4 个 Python SOP」改为「**1 个 Python SOP（cyl1nder_core）+ 4 个 blast**」：
  - `cook_core()` 一次 cook 完成：推 4 输入（1 次 HTTP）+ 拉 4 路 outputs（1 次 HTTP）→ 合并写入 detail，每 polyline prim 带 `cyl1nder_role`(0..3) prim 属性 → `_CORE_CACHE` 内容对比（per serial）防视口频闪。
  - 4 个 blast（grouptype=prims, group=`@cyl1nder_role=N`, negate=1）把合并 detail 拆到 out0..3（本地 C++ 快速，无 Python 无网络）。
  - 效果：重活（序列化/HTTP/全量重建）从 4 次收敛为 1 次；blast 拆分路径零 Python。
  - 保留 `cook(role)` 兼容旧 .hda（4 Python SOP 版）。
- **build_hda.py 同步**：PY_CODE 改 `cook_core()`；FORCE_COOK_CALLBACK 遍历 python/blast/output 子节点；内部连线 core+blast+output。
- **验证**：hython_smoke.py 全过（serial 不可变 / 4 输入 push / 4 输出 fallback 映射 out_i=in_i / web edit out0 → pull 回 out0）；HDA 已重建（`Cyl1nder_1.0.hda` 6.5KB）。
- **调研依据**：`devlog/hda-runtime-optimization.md`（Einstein 子智能体：HDK maxoutputs>1 非典型路径不采用；方案 A/B 纯 Python 可做；`geometry()`=输出索引是 bug API 根源）。

## v0.1.00016（2026-08-10）
- **HDA 回退 4-Python + 方案 B 缓存**（否决 v0.1.00015 的 blast 方案）：用户指出 blast 按 prim 属性 `cyl1nder_role` 分组，**无 prim 只有点的数据流走不通**。回退 build_hda.py 到 4 个 Python SOP（各接全部 4 输入，role 参数 0..3），cyl1nder_hda.py 新增 `_role_buffer()`（`_OUT_CACHE` + `_OUT_LOCK`）：任意 role 首次 cook 拉全量 4 路 outputs 一次，其余 role 从缓存读——**4 次询问只 1 次网络**（Houdini SOP 缓存语义）。`_force_cook_node` 清缓存，dirty→recook 重新拉。
- 输出口映射：python SOP 的 `node.inputs()[role].geometry()` 读第 role 个输入，bridge outputs 按 index 0..3 对应 out0..3（**从 0 开始**）。
- 验证：HDA 重建 + hython 冒烟全过（serial 不可变 / 4 输入 push / 4 输出 fallback out_i=in_i / edit out0 pull 回）。
- HDK 多输出论坛调研：子智能体 Ohm 进行中（hdk-multi-output-forum.md 待落库）。

## v0.1.00023（2026-08-10）
- HDA 输入侧加 **4 个 Convert 节点**（`fromtype=all, totype=poly`）：程序化 prim（Sphere/Tube 等）→ polygon mesh（faces 可序列化）；开口 polyline 保持开口（hair 无损）。python SOP 输入改接 convert。
- `_build_detail` 支持重建 faces（闭合 polygon prim）。
## v0.1.00056（2026-08-12）
- **同步从自适应 /pending 轮询改为事件驱动 /stream 长轮询**（devlog/sync-heartbeat-redesign.md）：
  - `_sync_loop` → `_stream_loop`；`BridgeClient.stream_once(since, hold=60.0)`（urllib 读一行 NDJSON，连接错误返回 None，与 timeout 事件 dict 区分）。
  - 循环语义：error → 0.5s 退避重连；`timeout` 事件 → 立即重连（空闲 keep-alive，1 req/min）；`outputs`/`kick` → `_refresh_ready` + scheduled 门控 recook（kick 即使 rev 未变也 recook；`last_error` 时弹 push cache self-heal）；`reset` → 从 0 全量重拉 + recook；**node 消失/stop → 干净退出线程**（RequestSourceShutdown 语义，消灭孤儿轮询）。
  - 删除自适应常量（`_SYNC_IDLE_INTERVAL`/`_SYNC_ACTIVE_AFTER`）；`sync_fps` 参数保留但不再驱动轮询（历史参数）。[已过时：v0.1.00057 起 `sync_fps` 重新启用为 HDA 接收端速率上限]
  - 验证：hython 冒烟全绿（stream timeout / outputs / kick / reset / clean-exit / self-heal，连真实新桥）。
## v0.1.00057（2026-08-12）
- **HDA 接收端 Sync Max FPS 防守**（devlog/sync-rate-limit-and-preference.md）：
  - `sync_fps` 参数（默认 30，clamp 1..60）重新启用为**接收端速率上限**：`_stream_loop` 对 outputs/kick/reset 的「拉取 + recook 调度」≤ fps（latest-wins：窗口内事件只推进 last_seen，到点后下一次事件拉最新；`scheduled` 门控保留）。
  - `/stream` 事件 `fps` 字段可覆盖运行时上限（bridge 转发 web 的 Sync Max FPS）；无 web 时用 HDA 本地参数兜底。
  - 验证：hython 冒烟全绿（背靠背突发 5 连发 → 1 拉取/1 recook、窗口后拉最新 since=24、fps=10 事件更新运行时上限并节流、既有 stream/kick/cache/fast-path 不回归）。
## v0.1.00106（2026-08-15）——吊牌 HDA Cyl1nderTag P1
- **新资产 Cyl1nderTag**（`hda/otls/Cyl1nderTag_1.0.hda`）：纯侧挂 Subnet（**1 输入/0 输出**，无 output null），内层单个 python SOP `import cyl1nder_tag\ncyl1nder_tag.cook()`（maintainstate=0）；隐藏 parm `cyl1nder_serial`/`bridge_url`（复数 `setTags`），多行 parm `entries`（parm tag `editor:"1"`——H22 无 `stringParmType.Multiline`）。**外形 = `slash`（形状菜单第 22 号，实机 30 项序实测）**：`setDefaultShape` 仅会话内生效，跨进程持久化靠 `setUserData("nodeshape")` + `d.updateFromNode(hda_node)`（build 两者都做）。
- **新模块 `hda/src/cyl1nder_tag.py`**：纯 stdlib+hou、零线程；cook 解析 entries（行/`;`/`#` 注释）→ `_resolve`（绝对直通；相对以第 0 输入上游为基准 posix normpath）→ 指纹 sha1[:16]（entries+upstream）→ 首次/变化 `register_channels`（1 tag + N param channelRef，registeredAt/lastSeen=0 服务端写），否则 ≥5s 节流心跳；无上游/无条目写 subnet userData 状态。param ref 的 `nodePath` = 吊牌自身路径（探测语义，合并期修正）。
- **`cyl1nder_bridge.py`** +`put_channel`/`heartbeat_channels`（同步 urllib、timeout=2、吞异常记 last_error；channelId = lstrip("/") + quote(safe="/")）。
- **`build_hda.py`** +`build_tag()`/`_tag_parm_group()`；顺手修既有 `_parm_group` 的 `setTag`→`setTags`（H22 复数才是真 API，原 serial 隐藏实为无效——既有问题顺手修）。
- `reload_hda.py` MODULES +`cyl1nder_tag`；`hython_smoke.py` +吊牌 E2E（进程内 stub 随机端口，不碰真桥）+4 纯逻辑测试。
- 验证：hython 冒烟全绿；实机 8100（beginTest-1.hip）热重载模块后搭 demo（null→xform→吊牌）：注册 tag+tx+ty 三通道、cook 心跳刷新 lastSeen、探测 alive+matched、runtime 改参 tx=3.5 落地。实机教训：改 hda/src 后必须先 `reload_cyl1nder()`，否则 HDA SOP 仍持旧模块（AttributeError put_channel）。
## v0.1.00110（2026-08-15）——data 通道注册语法（吊牌 HDA P4v1）
- **`cyl1nder_tag.py`**：新增 `_parse_entry(entry, upstream)`——param 条目原语义不变；data 条目 `@<adapter>:<nodePath>:<parmName>`（仅绝对节点路径）→ `("data", {"absolutePath": "<node>/<parm>", "adapter": …})`，非法 → None（状态写 `bad-entry: …`）。`register_channels` 拆 param/data 两列表（data 注册带 `adapter` 字段）；指纹载荷改为**原样条目文本**（条目文本变才重注册）。
- `hython_smoke.py`：+`_test_tag_parse_entry`（param 原语义/data 解析/非法→None）+ `_test_tag_hda` 加 `@apex-anim:` 条目断言（kind=data + adapter 字段 + channelId 路径）。
- 验证：hython SMOKE OK；实机 8100 data 通道注册与值读写往返通过。
## v0.1.00111（2026-08-15）——心跳捎带参数值（P5a 参数同步极致化）
- **`cyl1nder_tag.py`**：`_read_param_values(param_paths)`（`hou.parm(absPath).eval()`，str/int/float/bool/None 直传、其它 str() 化、读失败跳过）；`heartbeat` 签名 +第 5 参 `param_paths`，**节流通过后才读值**（节流期零轮询开销），payload +`"values"`。
- `hython_smoke.py`：节流单测断言 `values` 键 + 真实 tx 值 0.0 + 坏路径跳过；E2E 第二次 cook 断言 heartbeat body 含 `values[transform1/tx]`。
- 验证：hython SMOKE OK；实机 8100 心跳捎带 tx 值经 bridge WS 广播 → web 面板即时回显。
