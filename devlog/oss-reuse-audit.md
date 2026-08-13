# 开源库可借鉴审计（OSS reuse audit）

> 日期 2026-08-13 · 角色：主进程（Socrates 子智能体调研产出，主进程落盘）。范围：**不动显示端包**（three.js 保持），只审计非显示模块；浏览器支持按 cache-browser-support-eval.md 分层（A 层通用 / B 层推迟）。

## 结论速览（Top 5 值得引入）
| # | 候选 | 替换 | 成本 | 收益 | 结论 |
|---|---|---|---|---|---|
| 1 | **fast-deep-equal**（MIT, ~1KB, tier A） | `web/src/protocol/compare.ts` 的 JSON.stringify 深比较（session 热路径每次输入到达都跑） | 小（单文件 ~50 行，无协议/显示影响） | 快（无字符串分配） | **现在可做** |
| 2 | **msgpack**（`@msgpack/msgpack` Apache-2.0 + Python msgpack） | 整个 bridge⇄web wire（JSON→二进制） | 中/大（铁律 3 三处同步 + e2e + hython） | 消灭延迟链大头（stringify/parse）、体积减半 | **下一轮随协议化做** |
| 3 | **orjson**（MIT，drop-in `loads`/`dumps`） | bridge snapshot.py / HDA JSON 序列化 | 小（drop-in，无协议改动） | 几何 payload 序列化加速 | **并入 msgpack 轮** |
| 4 | **floating-ui**（MIT, vanilla, tier A） | widgets/picker 的手写 popup 定位 + outside-click | 小（widgets.ts + picker.ts 定位处） | 自动 flip/碰撞，省 ~150 行手搓边界逻辑 | **后续/出现定位 bug 再上** |
| 5 | **culori**（MIT, tier A） | `color/color-math.ts` 色彩转换 | 小-中（重接 picker/param 调用点） | 现在 ≈0；换来 OKLCH/gamut/contrast | **仅当新增色彩需求时**（seam 已留好） |

## 逐项结论（其余保持手搓）
- **groups 表达式解析/匹配**（`nodes2/groups/*`）：**无成熟 OSS 等价**（Houdini group 语法无独立 npm 包；社区都是 DCC 内嵌一次性实现）；且现有实现刻意与标准 Houdini `!`/`&`/glob 语义有差异。**保持**。
- **undo/redo**（`param-undo.ts` + `undo.ts` + `graph-undo.ts`）：通用库（zundo/use-undo）只快照状态，**无法回放 rete 编辑器变更**（连线引用/插入打散/dot 节点）；领域逻辑 100% 自定义。**保持**。
- **数据流/链缓存**（`core/network.ts` + `nodes2/network.ts` + `chain-cache.ts`）：rete-engine 是通用图执行器，没有本项目编码的 Houdini 显示驱动语义（active 焦点/delta 快路径/@P 依赖重 trace）。**保持**。
- **bridge client**（`bridge/client.ts`）：socket.io/ws 包装属过度设计（本地单客户端 + FastAPI WS 已干净）。**保持**；真正升级点是 wire 格式（见 msgpack）。
- **bridge logs/snapshot**：LogRing 是 /api/logs 的 API 数据模型，不是应用日志（structlog/loguru 无替换价值）；snapshot 可换 orjson。**日志保持，snapshot 并入 msgpack 轮**。
- **hda**：stdlib urllib 保持（Houdini 环境零依赖；可注入测）；orjson/msgpack 仅随 wire 改动一起。**保持**。
- **UI widgets/spreadsheet/param/menus**：无 UI 框架是既定决策（parm-system-design.md）；floating-ui 是唯一值得的 vanilla 补充；Radix 违反无框架约束。**仅 floating-ui 列入候选**。

## 原则
- 已手搓且被单测覆盖（groups/color-math/compare/undo/chain-cache/network 均有 vitest）= 可以「保持」；引入库的收益必须 > 引入的依赖/间接层成本。
- 协议类改动（msgpack）永远按铁律 3 走独立完整轮。
