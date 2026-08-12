# 优化轮 v0.1.00061：dock 内侧残留 + 菜单居中 + 颜色拾取器体验 / Polish round 3

> 版本 0.1.00061 候选 · 日期 2026-08-12 · 角色：主进程（设计 + 契约 + 合并 + 文档）

## 一、任务（用户反馈）
**UI**
1. dock 活跃 tab 底部圆角：**外部完全正常**，但**内侧有残留的镜像显示 / 残留小黑点**（Round 10 的 6×4 `background-image` 内凹 notch 渐变或 ::before/::after 外翻 crescent 在内侧留下残影）。
2. 菜单栏 **File / Edit 高度居中**：现在偏高了（Layout 菜单是圆角框 + ▲▼ 竖排图标，比 File/Edit 高 → menubar 默认 stretch，文字顶对齐）。

**颜色类属性**
1. **点击颜色矩形（色块）就直接打开调色板**，不需要单独 Change 按钮（当前 Viewport 首选项里是「色块 + hex + Change… 按钮」）。
2. **hex 用大写**，且**小写输入自动转大写**（当前 rgbToHex 输出小写）。
3. **色轮升级**：参考 [Adobe Color wheel](https://color.adobe.com/create/color-wheel)——色相环 + 内部 SV（三角形或方形）选色；「可以让用户选一个」→ 提供 SV 方形/三角形切换（或等效的选色增强），纯体验小组件、零新依赖。

## 二、契约
### 2.1 dock 内侧残留（Agent A）
- 现状：active tab `background-image` 两个 6×4 `#141518` 径向渐变（内凹 notch，软边 `rgba(20,21,24,.5) 4px → rgba(46,79,125,0) 4.5px`）+ ::before/::after 4×4 外翻 crescent（`transparent 0 2.5px → rgba(46,79,125,.4) 3px → #2e4f7d 3.5px`）。
- 目标：**内侧无残留镜像/小黑点**（外翻 crescent 与内凹 notch 交界、或渐变软边处的小黑点/残影清除）；外部外翻蓝色保持正常。用 Playwright/harness 截图对比定位残留像素（%TEMP%\cyl1nder-dock-agent\ 可复用），修复后截图确认内侧干净。
- 只改 dock.css（必要时 dock.ts）；禁止新建/改 e2e。

### 2.2 菜单标签垂直居中（Agent A）
- `.cyl-menubar`（flex）默认 `align-items: stretch` → File/Edit 文字被拉高后顶对齐。改为 `.cyl-menubar { align-items: center }`（必要时配合 `.cyl-menu-label { line-height: 1 }`），让 File/Edit/Layout 全部垂直居中。只改 base.css 的菜单栏相关规则（`cyl-menubar`/`cyl-menu-label`），不碰其他。

### 2.3 颜色（Agent B）
- preference.ts：Viewport 背景色行——**点色块即开 `openColorPicker`**（色块加 cursor:pointer，内联 style 即可），**移除 Change… 按钮**（标记 `.cyl-pref-change` 为死规则可留）；hex 文本仍显示。
- color.ts：`rgbToHex` 输出**大写** hex（`#RRGGBB`）；`hexToRgb` 兼容大小写；hex 输入框**小写自动转大写**（input 事件 toUpperCase）；预览/回调的 hex 同步用大写。
- color.ts + colorpicker.css：**色轮升级为 Adobe 风格**——色相环（可保留现有 conic 环）+ **内部 SV 三角形**（或方形/三角形可切换），选色更直观；保留色块/最近色/RGB-HSL-HSV/hex；零新依赖、非模态、Esc/✕/点外部关闭。
- 避免改 base.css（归 Agent A）；如需 cursor 用内联 style。

## 三、落地分工（并行 agent，写集不相交）
- **A（dock 内侧残留 + 菜单居中）**：web/src/styles/dock.css、web/src/styles/base.css（仅菜单栏 `cyl-menubar`/`cyl-menu-label` 居中相关）。
- **B（颜色体验）**：web/src/app/preference.ts、web/src/app/color.ts、web/src/styles/colorpicker.css。
- **主进程**：devlog（annotations-web / README / 本设计文档）+ 版本 bump 0.1.00061 + 合并验证 + 单 commit。

## 四、验证
- web：tsc 0 + vitest 82 + e2e（round13 preference、round15 color、smoke，--workers=1）。
- dock：截图确认内侧无小黑点/残留 + 外部外翻蓝正常。
- bridge/hda：无改动，pytest 50 / hython 冒烟不受影响。