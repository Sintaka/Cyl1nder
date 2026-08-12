# no-geometry 诊断（serial C1-msm6dsp7-ob6t）

> 2026-08-12 · 分支 codex/cyl1nder-v0 · 通道：bridge 8375 + fxhoudinimcp 8100（官方 Houdini MCP）· 只写本文档，未动任何代码。

## 用户问题
浏览器视口显示 "no geometry"。

## 诊断结论（为什么 no geometry）
- bridge v0.1.00054 已重启。registry 里该 serial `lastSeen` 新鲜（HDA 在轮询 /pending = 活着），但 `lastActivity=0.0`、workspace inputs/outputs 全空；bridge 日志只有两次 "kick armed for C1-msm6dsp7-ob6t"，没有任何 push → **HDA 活着但从不推数据**。
- 根因：运行中的 HDA 是**旧代码**（内存加载版本 ≠ 磁盘 hda/src 新代码）。铁证（execute_python 内省 Houdini 内存模块）：
  - `BridgeClient.pending_outputs` 签名 `(self, since) -> tuple[bool,int,bool]`（3 元组，**无 force 字段**）；磁盘新代码是 `(pending, rev, reset, force)` 4 元组。
  - 内存模块无 `last_error` 自愈、无 force 感知的同步轮询。
- 旧代码不处理 /pending 的 `force` 字段：web 已 POST /kick（日志 "kick armed"），但 bridge 的 force 是**一次性**标记（`take_kick` 消费即清）。旧 HDA 每次轮询把它消费掉却忽略 → 永不强制 recook → 不 push inputs → bridge workspace 空 → web 默认渲染 `store.inputs`（web/src/main.ts）为空 → 视口 "no geometry"。

## 恢复动作
1. fxhoudinimcp（8100）`mcp.health` 正常：{"status":"ok","pid":84044,"houdini_version":"22.0.368"}。
2. 调用格式要点：8100 的 HTTP 入口是 `POST /api`（x-www-form-urlencoded，`json=...`），**函数名不是裸 `execute_python`**，而是 `["mcp.execute",[],{"command":"code.execute_python","params":{...}}]`（v2.10.0）。
3. 执行文档化热重载（hda/scripts/reload_hda.py）：
   `exec(open(r"D:/code/dev/Cyl1nder/hda/scripts/reload_hda.py").read()); reload_cyl1nder()`
   → 重载 3 个 hda/src 模块 + force recook 4 个内部 python SOP（cyl1nder_py0..3）。无参版，未动 HDA 定义。
4. 重载后首次 recook：role 0 push 路径 `_PUSH_CACHE` 为空 → 必 `client.push_inputs` 推 4 个 inputs；`ensure_sync` 启动 force 感知的新轮询线程（旧 `_sync_loop` 因模块重载重置 `_SYNC` 而自然退出，最终只剩一个 poller）。

## 结果（恢复成功）
- `/api/hda/C1-msm6dsp7-ob6t/status`：`lastActivity` 0.0 → 1786516794.10；`inputRev` 0 → 1；workspace inputs 4 个：in0 266pt/288prim、in1 8pt/6prim、in2 4pt/1prim、in3 48pt/26prim。`lastSeen` 持续更新（poller 活着）。
- bridge 日志：`inputs pushed (4), rev=1`（serial 匹配）。
- 内存模块复核：`pending_outputs` 现为 4 元组；`_SYNC` 含该 serial；线程仅剩一个 `_sync_loop`。
- outputs 仍为空属正常：当前 web 无待同步的编辑输出（outputRev=0）。
- 浏览器侧：web 默认渲染 inputs；inputs 已就位，**刷新页面**（或等 WS 推送 inputRev=1）后应显示几何体。

## 给用户的后续建议（避免再犯）
- 改过 hda/src 或 HDA 定义后必须热重载，否则 Houdini 内存里跑的还是旧代码：
  - 只改运行时：`exec(open(r"D:/code/dev/Cyl1nder/hda/scripts/reload_hda.py").read()); reload_cyl1nder()`
  - 改了 .hda 定义：`reload_cyl1nder(definition=True)`
- 或在 Houdini 里对该 HDA 节点 dirty 一次（改任意参数 / 点 Force Cook / Pull Now）。
- 快速自检"活着但旧代码"：看 bridge status `lastActivity` 是否为 0 且 `inputs` 为空；内省内存模块 `pending_outputs` 签名是否 4 元组。
- 重载后仍不推数据时：先 `POST /api/hda/{serial}/kick` 再等 1-2s（force 一次性，须等 HDA 用新代码轮询后再 kick）。
