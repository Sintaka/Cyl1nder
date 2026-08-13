# 重构复盘与后续建议 / Refactor retrospective & next steps

> 日期 2026-08-13 · 记录 refactor-plan 阶段 1/2/3 全量完成后的经验与后续方向。
> 关联：refactor-plan.md（路线图/状态）、shit-mountains.md（屎山清单）、development-standards.md（并行/分支/验证铁律）。

## 一、已完成（一句话总览）
把 5 座「屎山」按域拆薄，主进程全程「建契约骨架 → 并行子智能体按不相交写集实现 → 主进程合并/全量验证/更新 devlog/单 commit」：

| 阶段 | 拆分前 → 后 | 分支 |
|---|---|---|
| 2.1 | main.ts 抽 core 八子刀（lifecycle/shortcuts/params/param-undo/gizmo/network/kick/session） | codex/0.1.00075-refactor-gizmo-session |
| 2.2 | graph.ts 1666 → graph-model(354)/graph-interact(954)/graph-undo(149)/graph.ts(290 外壳) | codex/0.1.00080-refactor-graph |
| 2.3 | viewport/renderer.ts 784 → scene/camera/gizmo/picking/modes/state + renderer(499) | codex/0.1.00083-refactor-viewport |
| 3.1 | hda/cyl1nder_hda.py 881 → lifecycle/cache/geometry/sync + 外壳(172) | codex/0.1.00084-refactor-hda |
| 3.2 | app/color.ts 1007 → color/{color-math,harmony,palette,wheel-sv,picker} + barrel | codex/0.1.00085-refactor-color |
| 3.3 | main.ts 抽 core/dataflow.ts（编辑→网络→视口数据流） | codex/0.1.00087-refactor-dataflow |

行为零变化：tsc 0 + vitest 101 + vite build + 对应 e2e 全绿；hython smoke 全绿。

## 二、有效打法（可复用）
1. **契约锚点**：主进程先写带精确签名的骨架文件（函数签名 + `throw` 占位），子智能体只填 body，杜绝导出名漂移。
2. **写集不相交**：评估同文件=不能并行，不同文件=可并行；先由主进程调结构（建骨架）再 spawn。
3. **barrel 保 API**：对外公开名不变（`nodes2/graph`、`viewport/renderer`、`app/color`、`cyl1nder_hda`），调用方零改动或只改调用点。
4. **破环三板斧**（循环依赖）：
   - 共享态按引用传：`ViewportState { enterActive, selectedLine }`（2.3）。
   - late-bound ref：`setColorRef`/`pickHarmonyRef`（3.2 wheel-sv）。
   - late-bound getter：`getGraph/getNetwork/getViewport/getGizmo`（3.3 dataflow，graph 需 handlers、handlers 需 graph 的鸡生蛋）。
5. **纯函数优先**：color-math / harmony / palette / graph-model / network 先拆纯函数（可单测），DOM 控制器后拆。
6. **机器验证字节级**：子智能体用 AST/char 比对确认 body 与原文一致；主进程跑 tsc/vitest/build/e2e/hython smoke。
7. **调用点同步**：Python 侧 reload_hda 的 MODULES 顺序（依赖先于被依赖）+ hython_smoke 的 `_schedule_recook` monkeypatch 目标（`cyl1nder_hda` → `cyl1nder_sync`）必须随拆分一起改，否则热重载/冒烟会静默失效。

## 三、剩余「屎山」（按行数，2026-08-13 复核）
仍 >450 行，但已从「跨职责混」收敛为「单一职责的长控制器/DOM 装配」：

| 文件 | 行数 | 现状 | 建议再拆 |
|---|---|---|---|
| nodes2/graph-interact.ts | 954 | 交互层（Tab 搜索/Y 剪切/flags 菜单/插入/框选/摇一摇/tooltip/state·rename handler） | 每类交互一个模块，`createGraphInteract(deps)` 装配 |
| main.ts | 793 | UI 装配 + 布局/会话/菜单/快捷键 | 抽 `core/layout-session.ts`（布局持久化 + 会话接线） |
| color/picker.ts | 712 | openColorPicker DOM 外壳 | 拆 `fields.ts` / `harmony-swatches.ts` / `recents-palette.ts` 子控制器 |
| app/dock.ts | 540 | dockview 布局/标签/菜单/持久化 | layout / tabs / persistence |
| viewport/renderer.ts | 499 | 视口外壳（构造 DOM + 装配） | 已薄，可维持 |

判定：**没有新的大混合体**；上述是可选的进一步拆薄，优先级低于功能/修 bug。

## 四、后续开发建议（P0→P2）
- **P0 测试基建**
  1. e2e 默认串行（playwright `--workers=1` 或按 serial 隔离）：当前多个 spec 共享同一 bridge serial，并行 8 worker 会互相污染 fixture（2.3 已踩）。
  2. 修 `round6-nodeview` 2 项 flake：`nodeResultVisible` 单次断言改 `expect.poll`（根因：session 在 WS open 即置 `ok`，inputs 消息随后才到）。
  3. 修 bridge pytest 环境：`bridge/.venv/Scripts/python.exe` 的 launcher 找不到基解释器（`py` 也报 No installed Python found），需重建 venv 或对齐 Python 312 安装。
- **P1 补单测**：`core/dataflow.refreshNodeFlags`、`color/wheel-sv` 的纯几何（wheelFromPointer/svFromPointer）、`nodes2/graph-interact` 的 distToSegment/hitTestConnection 等纯函数补 vitest。
- **P2 再拆**：见上表「建议再拆」；graph-interact.ts 是当前最大单文件，优先。
- **P2 索引纳入检查**：`scripts/gen-{index,graph,api-index}.mjs` 建议并入 commit 前/CI（本次已手工重跑）。
- **P2 协议演进**：路由/WS 已稳定；后续新增服务沿用 routes.py 现有模式，不新建大文件。

## 五、踩坑速记
- PowerShell 写中文/非 ASCII 一律 `[System.IO.File]::WriteAllText($path, $text, UTF8 no BOM)`；禁止 here-string 管道给 python stdin（中文会变 `?`）。
- PowerShell `git show`/`Get-Content` 返回 string[]，当文本用先 `-join "`n"`。
- `.git` 在沙箱只读：`git add/commit/checkout -b` 需 require_escalated。
- 子智能体并行时若读同一源文件，统一从 `git show HEAD:<path>` 取原文，避免互相覆盖中间态。