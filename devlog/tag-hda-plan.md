# 吊牌 HDA + 项目绑定 + 轨迹页 —— 实施计划

> 2026-08-14 · 主进程起草 · 依据 `tag-hda-project-design.md`（提案，含 6 个待拍板点）。
> **本文件是下一阶段的主计划**：新会话/新 agent 接手时先读本文件 + 提案 + `development-standards.md`。
> 术语注记（2026-08-14）：原名「挂耳 HDA」，用户嫌「挂耳」难听，已改名**吊牌 HDA（Hang Tag）**——像商品吊牌挂在节点旁。
> 铁律不变：代码修改派并行 codex 子智能体、主进程合并、协议三处同步、每阶段一个 commit + devlog。

## 0 门禁（Gate）

**拍板记录（2026-08-14）：用户已拍板，6 个 ⚖️ 决策点全部按默认建议执行，P1 门禁解除。** 默认建议值（提案已给）：
1. 吊牌 = **纯侧挂**（只连线标识，不进几何数据流）——pass-through 版留作可选，不阻塞。
2. 参数条目 = **字符串路径列表**（`tx;ty;tz` / `../tx`，相对路径以吊牌第 0 输入的上游节点为基准），menu 生成留 P1.5。
3. 注册归宿 = **多对多**：通道全局唯一（入关联注册大全），项目只存引用。
4. 项目持久化 = bridge 注册表（`projects.json`），不做项目文件导出。
5. 轨迹 = 内存环形（10000）+ 可选按天 ndjson 落盘（默认关），先只做内存 + 页面。
6. 隐式项目 = 自动 `P1-…` 命名（打开 `?serial=` 时若无项目自动建单成员项目）。

## P1 — 吊牌 HDA 最小闭环（参数注册 + 心跳 + runtime 改参）

> **状态（v0.1.00106，2026-08-15）：已完成并实机验收（8100 实例）。** 详情见 annotations-{hda,bridge,web}.md v0.1.00106 节。遗留 P1.5：web 参数面板→runtime 改参 UI 接线、entries menu 生成、pass-through 可选版（纯侧挂不在 display 链时上游变化不自然 cook，探测为主路径、心跳为机会式）。

### 写集（拟定，实现时按并行规范再拆不相交）
- **hda**：`hda/scripts/build_hda.py`（新节点类型 `Cyl1nderTag`：Subnet、外形 = Z 菜单第 22 号、隐藏参数 `cyl1nder_serial`、参数列表多行 string parm、1 输入 N/1 输出或纯侧挂）；`hda/src/cyl1nder_tag.py`（新：薄壳 cook——首次/修改时把条目翻译成绝对路径并注册；心跳摘要节流 ≥5s；纯 stdlib 客户端复用 `cyl1nder_bridge` 模式）；`hda/scripts/reload_hda.py` MODULES 增 `cyl1nder_tag`（保持无长生命周期线程红线）。
- **bridge**：`bridge/bridge/channels.py`（新：通道注册表——内存 + `bridge/data/channels.json` 落盘，channelRef = `{kind:"tag"|"hda"|"param", serial?, nodePath?, absolutePath?, hip, label, registeredAt, lastSeen}`）；`bridge/bridge/channel_routes.py`（新路由：`PUT /api/channels/{channelId}` 注册、`GET /api/channels` 大全列表、`POST /api/hda/{serial}/channels/heartbeat` 心跳摘要、`GET /api/channels/{channelId}/probe` 经 houdini 代理做存活探测）；`main.py` 挂载（主进程粘合）。
- **web**：`web/src/stores/channels.ts`（新：大全 store 切片）；overview 或新面板展示「关联注册大全」（列表 + 状态灯）；`web/src/bridge/client.ts` 加通道端点方法。
- **协议**：channelRef 结构三处同步（protocol.py / types.ts / protocol.md）。

### 行为契约
- 注册：吊牌 cook 时把每行条目解析为绝对路径（相对 = 上游节点基准）→ `PUT /api/channels/...`（幂等覆盖）。
- 心跳：吊牌 cook 节流摘要（serial/nodePath/上游连接节点路径/参数值指纹）；主动探测 = `GET /probe` → bridge 经 fxhoudinimcp `nodes.get_node_info` 确认存活 + 类型 + serial 一致。
- 改参：**一律走 runtime**（`POST /api/hda/{serial}/houdini/cmd` `parameters.set_parameter`，现有代理已通），吊牌不参与。
- 试点验收：web 参数面板改一个 float → runtime 写 `transform1/tx` → Houdini 生效 → cook 心跳带回。

### 验证
pytest（channels 注册/心跳/探测 + 路由）/ tsc+vitest（store/面板）/ hython 冒烟（吊牌 cook 注册）/ 实机（8100 实例放吊牌 + runtime 改参往返）。

## P2 — 项目层（多 HDA 绑定）

> **拆分（2026-08-15，主进程拆结构）**：P2a（当前轮）= 项目注册表/端点 + `?project=` + 隐式项目兼容 + overview 项目面板与拖拽入项目；P2b（下轮）= nodeview 项目根 + 多 serial WS + 图快照按 project 存（web 核心手术，与 P2a 解耦）。

### P2a
- `bridge/data/projects.json`（`P1-…` serial + label + members: channelRef[]）；端点：`POST /api/projects`（建）、`GET /api/projects`（列表）、`GET /api/projects/{id}`、`POST /api/projects/{id}/members`（加成员，按通道 key 去重）、`DELETE /api/projects/{id}/members?channelId=`（移成员）、`POST /api/projects/ensure`（body {serial}：无含该 serial 通道的项目则自动建 `P1-…` 单成员隐式项目 → 返回 {project, created}）。
- 兼容：`?serial=X` 行为不变（照常开工作区），boot 后台 ensure 隐式项目；`?project=P1-…` overview 展开该项目（成员列表 + 每成员「打开工作区」= `?serial=` 跳转）。
- web：stores/projects.ts + client 端点方法 + overview「项目」区块（新建项目、HTML5 DnD 拖通道入项目、成员列表）。
- 协议：`P1-` 序列号正则 + ProjectRef + projects 端点三处同步（protocol.py / types.ts / protocol.md）。
- 语义：项目成员是 channelRef **引用快照**（live 状态以 /api/channels 大全为准）。

## P3 — 轨迹页（谁动了数据）

- bridge `TraceStore`（内存环形 10000，可选 ndjson）；埋点：put_inputs/put_outputs/WS edit/houdini cmd·python/吊牌注册与心跳；`/trace.html?project=` 过滤视图（时间/通道/actor/digest）。
- 验收：同一参数被两个项目引用时，改动来源/通道/新旧值可审计。

## P4 — 延伸（远期）

- apex scene animate 运行时修改、packfolder Animation Layer 同步（= 注册非 geo 数据源 + bridge 侧读写器）；时间轴互补通道（吊牌 cook 主线程捎带 frame，绕开 dispatcher 忙时延迟，见 `timeline-sync-lag-analysis.md` §4）。

## 每阶段收尾（主进程）
devlog 更新（README 字典/最近版本 + annotations-{bridge,hda,web} + 协议同步）→ 版本 bump → 索引再生成 → 单 commit。
