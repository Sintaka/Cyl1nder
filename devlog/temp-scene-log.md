# 临时开发场景日志 / Temp scene log

> ⚠️ 本文件记录**临时**信息：临时 dev 项目/文件名可能随时间换名、迁移或失效。
> 新会话先读这里确认当前现场，但**不要把这些路径当永久事实**——以 fxhoudinimcp 的
> `get_scene_info` / `houdini_health` 实时值为准。

## 2026-08-10
- Houdini hip：`D:/Animation_Project/Houdini/Test/Cyl1nder/dev/beginTest-1/beginTest-1.hip`
- Cyl1nder HDA 实例：`/obj/geo1/Cyl1nder1`，serial `C1-msm006pg-8fz7`
- 输入：null1-4 → HDA 4 输入（点数随场景变化）
- bridge：`http://127.0.0.1:8375`（REST/WS，数据桥，不是网页）
- Web UI：`http://127.0.0.1:8376/?serial=<serial>`
- fxhoudinimcp：`http://127.0.0.1:8100`（Houdini 内 HTTP MCP，被占自动 8101+）

## 2026-08-11（已更新：serial 已换）
- ⚠️ 旧 serial `C1-msm006pg-8fz7` 已过时（lastSeen 2026-08-10 02:32，是早期实例；其快照只剩 `_input_` 一个节点——曾在 00037 被当作"当前"误用，勿再引用）。
- **当前** Cyl1nder HDA 实例：`/obj/geo1/Cyl1nder1`，serial **`C1-msm6dsp7-ob6t`**（lastSeen 2026-08-11 01:49，同一 node path 的新实例；nodeview 5 节点/7 连接：`_input_`、`_output_`、null1[D]、null2、null3）。
- 快照目录：`D:/Animation_Project/Houdini/Test/Cyl1nder/dev/beginTest-1/Cyl1nder/C1-msm6dsp7-ob6t/`（scene/node-graph.json 等）。
- 判断"当前 serial"的正确方法：读 `bridge/data/registry.json` 按 `lastSeen` 取最新且 nodePath 匹配的实例，**不要**直接信 devlog 里的旧 serial。