# 优化轮 v0.1.00059：dock 角标重做 + File 菜单 + Sync 语义修正 + Layout 菜单框 / Polish round

> 版本 0.1.00059 候选 · 日期 2026-08-12 · 角色：主进程（设计 + 契约 + 合并 + 文档）
> 关联：`autosave-color-prefs-ui.md`（v0.1.00058）、`sync-rate-limit-and-preference.md`（v0.1.00057）

## 一、任务（用户反馈）
1. **dock 活跃 tab 底部两角标改错了**：v0.1.00058 Round 8 把「正常的蓝色强调部分」改掉了（改成栏色凹口），且「蓝色后面不正常的背景阴影」没动——底部两圆角完全是错的。要求：**恢复蓝色强调 + 消除蓝色背后挡住不活跃标签角落的深色背景/阴影**，底部两圆角正确。
2. **File 菜单**：Save Scene 右侧加灰小字 `Ctrl+S`、Save Scene As 加 `Ctrl+Alt+S`；**移除 File 菜单里的 Overview**（仅左上角 brand 点击触发，已存在 `href="/overview.html"`）。
3. **Sync Max FPS 语义修正**：它不是 Cyl1nder 本体运作上限——**Auto Update 推流越快越好、不设上限**（移除 web 端 `throttledPush` 对 runNetwork/viewport 编辑的限流）；Sync Max FPS 是 **kick bridge 的上限**（bridge 接收/转发 + HDA recook，由 `PUT /sync` 下发给 bridge，HDA 经 /stream fps 字段执行）。
4. **Layout 菜单标签**：现在是纯文本（"Default"）→ 改成**圆角矩形框**：框内左侧 ▲▼（竖排组合、仅装饰），右侧**深色背景 + 固定 15 字符宽度**显示当前 layout 名称（不足补空格）。
6. **Preference 浮动面板**：支持**拖动**（按标题栏拖移，面板自由定位）；底部按钮 **Save 改名为 Accept**（应用并关闭；Apply 仍为应用不关闭）。
5. **更新 README + devlog 过时内容**（主进程）：v0.1.00057/00058 文档里「web 推流节流 ≤fps」的说法已过时，需同步为「Auto Update 无上限、Sync Max FPS = kick bridge 上限」。

## 二、契约
### 2.1 dock 角标（Agent A）
- 目标渲染：活跃 tab 保持 Chrome 式轮廓（顶凸角 7px、底边与内容区齐平），**底部两圆角保留蓝色强调**（蓝色 crescent 贴住实际角点），且**任何深色/蓝色块不得覆盖相邻不活跃标签的角落**（背景阴影消除）。
- 参考：`%TEMP%\cyl1nder-dock-agent\` 有 harness（harness-{first,mid,last}-{orig,fixed}.html）+ 分析脚本（analyze/regionmap/livecheck.mjs）可复用做视觉迭代与像素验证；验收指标沿用「活跃 tab 矩形之外无蓝色覆盖」+「活跃 tab 底角蓝色强调存在」。

### 2.2 web（Agent B）
- 推流：删除 `throttledPush`/`lastPushAt`/`pushFlushTimer`/`pendingPushFn`；runNetwork 与 viewport 编辑回调**直接** `client.pushOutputs`（无节流）。保留 `syncMaxFps` 值（底部栏 + prefs）用于 `client.putSyncFps`（bridge/HDA 上限）。更新注释/标题：Sync Max FPS = kick bridge 上限，Auto Update 无上限。
- File 菜单：Save Scene / Save Scene As 按钮内右侧加 `.cyl-menu-kbd` 灰小字（Ctrl+S / Ctrl+Alt+S）；移除 main.ts overviewBtn 注入与 `data-act="overview"` 分支。
- Layout 菜单：`#cyl-menu-layout-label` 外层包 `.cyl-menu-layout-box`（圆角矩形，保留 `.cyl-menu-label` 类供菜单开合绑定），内含 `.cyl-menu-layout-caret`（▲▼ 竖排装饰）+ `.cyl-menu-layout-name`（深色背景、固定 15ch、名称不足补空格）；main.ts `updateLayoutMenuLabel` 用 `padEnd(15)` 补空格。
- base.css：菜单快捷键灰字、layout 菜单框/箭头/名称块样式；preference.ts/layout.ts 的 Sync Max FPS tooltip/说明改「kick bridge 上限」。

## 三、落地分工（并行 agent + 主进程）
- **Agent A（dock 角标重做）**：`web/src/styles/dock.css`、`web/src/app/dock.ts`（如需要）。
- **Agent B（web UI/语义）**：`web/src/main.ts`、`web/src/app/layout.ts`、`web/src/styles/base.css`、`web/src/app/preference.ts`（仅 tooltip/说明）、`web/e2e/round8-main.spec.ts`（File 菜单断言适配）。
- **主进程**：devlog（protocol.md / annotations-web / 设计文档 / README）+ 版本 bump 0.1.00059 + 合并验证 + 单 commit。

## 四、验证
- web：tsc 0 + vitest 82 + e2e（round8 适配、round12/13/14 回归、smoke）。
- dock：视觉迭代（截图 + 像素采样：蓝色强调存在、活跃 tab 矩形外无蓝色/阴影覆盖）。
- bridge：pytest 50（无 bridge 代码改动）；hython 冒烟不受影响。