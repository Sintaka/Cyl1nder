# 石山代码（monolith）标注

> 日期 2026-08-13 · 目的：给超长单文件 / 神级函数标出来，后续按域拆分，降低 token 与心智负担。

## 判定
- 单文件 > 450 行，或单函数 > 80 行，或跨职责混合（渲染 + 状态 + 网络 + 手工 DOM 拼装）视为石山。

## 当前石山（按行数，2026-08-13 统计）
| 文件 | 行数 | 主要职责混杂 | 建议拆法 |
|---|---|---|---|
| web/src/nodes2/graph.ts | 1564 | 节点渲染 / 连线 / 拖拽 / 撤销 / 参数 / 选择 / 事件 | 拆 nodes-renderer / edges / undo / params / selection |
| web/src/main.ts | 1144 | 启动 / 连接 / 网络 / 视口 / gizmo / 菜单 / 快捷键 / 自动保存 | 拆 boot / session-connect / shortcuts / autosave / gizmo |
| web/src/app/color.ts | 1073 | 色彩数学 / 色轮 / SV / 和谐 / 调色板 / 最近色 / 撤销 / 浮窗 | 拆 color-math / wheel-sv / harmony / palette / picker-shell |
| hda/src/cyl1nder_hda.py | 782 | cook / 推拉 / 流循环 / 几何应用 / 缓存 / 启动 | 拆 sync / geometry / cache / lifecycle |
| web/src/viewport/renderer.ts | 729 | Three 场景 / 相机 / gizmo / 拾取 / 显示模式 / 事件 | 拆 scene / camera / gizmo / picking / modes |
| web/src/app/dock.ts | 498 | dockview 布局 / 标签 / 菜单 / 持久化 | 拆 layout / tabs / persistence |
| web/src/nodes2/groups.ts | 495 | 组解析 / 选择 / 高亮 / 成员 | 拆 parser / selection |

## 不做本轮
- 本轮只标注；真正拆分建议按 devlog/development-standards.md 的并行写集规则，逐文件开独立分支处理，避免与 UI 迭代并发。