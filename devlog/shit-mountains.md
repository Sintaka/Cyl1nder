# 屎山代码（legacy spaghetti）标注

> 日期 2026-08-13 · 目的：给超长单文件 / 神级函数标出来，纳入持续改进计划，按域拆分，降低 token 与心智负担。

## 判定
- 单文件 > 450 行，或单函数 > 80 行，或跨职责混合（渲染 + 状态 + 网络 + 手工 DOM 拼装）视为屎山。

## 当前屎山（按行数，2026-08-13 统计）
| 文件 | 行数 | 主要职责混杂 | 建议拆法 | 优先级 |
|---|---|---|---|---|
| web/src/nodes2/graph.ts | 290（外壳） | 已拆 2.2：graph-model(354) / graph-interact(954) / graph-undo(149) + 外壳 barrel | ✅ 2026-08-13 完成 | - |
| web/src/main.ts | 1144 | 启动 / 连接 / 网络 / 视口 / gizmo / 菜单 / 快捷键 / 自动保存 | boot / session-connect / shortcuts / autosave / gizmo | P1 |
| web/src/app/color.ts | 1073 | 色彩数学 / 色轮 / SV / 和谐 / 调色板 / 最近色 / 撤销 / 浮窗 | color-math / wheel-sv / harmony / palette / picker-shell | P2 |
| hda/src/cyl1nder_hda.py | 782 | cook / 推拉 / 流循环 / 几何应用 / 缓存 / 启动 | sync / geometry / cache / lifecycle | P1 |
| web/src/viewport/renderer.ts | 499（外壳） | 已拆 2.3：scene(45)/camera(57)/gizmo(258)/picking(115)/modes(63)/state(11) + 外壳 barrel | ✅ 2026-08-13 完成 | - |
| web/src/app/dock.ts | 498 | dockview 布局 / 标签 / 菜单 / 持久化 | layout / tabs / persistence | P3 |
| web/src/nodes2/groups.ts | 495 | 组解析 / 选择 / 高亮 / 成员 | parser / selection | P3 |

## 持续改进计划入口
- 拆分路线图与架构优化分析见 `devlog/refactor-plan.md`（持续更进，每轮挑 1-2 项做）。