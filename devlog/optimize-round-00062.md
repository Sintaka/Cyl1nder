# 优化轮 v0.1.00062：HDA 崩溃/恢复根治 + UI/字体/颜色大改造 / Polish round 4

> 版本 0.1.00062 候选 · 日期 2026-08-12 · 角色：主进程（设计 + 契约 + 合并 + 文档）

## 一、任务（用户反馈，按严重性排序）
### 0. HDA 崩溃 + bridge 重启后仍无几何（关键）
- 每次 commit 后重启 bridge，Cyl1nder 仍无几何数据；此时回 Houdini 按 Reload HDA **大概率崩溃**，被迫重启。
- 已定位两大根因：
  1. **崩溃**：`_stream_loop` 后台线程每轮调 `hou.node(node_path)`（HOM 非线程安全），与 `hou.hda.reloadFile` / `reload(module)` 并发 → 崩溃。
  2. **reload 流程**：`reload_hda.py` 在活线程（`_SYNC` 线程仍在轮询）下 `importlib.reload(mod)` / 重建定义。
  3. **恢复**：reset 分支已清缓存+调度 recook（v0.1.00060），但 HDA 没跑到新代码就崩了 / `_schedule_recook` 若 hdefereval 不可用会静默失败。

### 1. UI
- File/Edit 菜单按钮高度太矮（字顶底没预留）→ 与其他组件等高。
- dock tab 底部圆角：外部正常，内部两个黑点扩大（第 4 轮了）→ **根除**：用户建议直接把内部 notch 挖空区填成活动标签蓝色（去掉 #141518 挖空），不再做内凹。
- Sync Max FPS 数字输入右侧默认浏览器白色上下箭头很丑 → 改成 Layout 菜单那种 ▲▼ 深色装饰（在右侧）。
- 首选项新增「UI」分类 + 字体选项（英文 Fira Code，中文 fallback 思源黑体/Noto Sans SC，代码风格优先），hex 字体同步；字体文件内嵌到项目（`web/public/fonts/` + @font-face）。

### 2. 颜色调色盘
- Recent Color：右键删除单个 + 一键清空。
- 圆环 → 全圆（中间饱和度为 0）；三角/矩形组件尺寸统一（切换不跳动）；切换按钮放基础/高级切换旁。
- RGB/HSL/HSV 增加可拖动横条；PALETTE 十几个预设 = 简单模式；基础/高级滑动按钮（整体、两态单击切换）；高级模式用更通用的色盘分类。
- 拾色器按钮：用现成方案（Chrome/Edge 原生 `EyeDropper` API，全屏兼容，不支持时优雅降级）。
- Adobe Color Wheel 借鉴：色相环 + 4-5 个联动点（拖一个带其余）、Color harmonies 预设、4-5 个联动色块；基础明度关联 HSL 明度。
- 首选项/调色板浮动面板可移动（拾色器 `.cyl-cp` 可拖动；Preference 面板已可拖）。
- 首选项背景色支持 Ctrl+中键重置；**颜色/属性操作在 float/vector/color3 等所有属性类型通用**（统一属性系统理念写入 devlog）。

### 3. viewport
- transform pivot 不显示绿色正方体框，保留红蓝黄三轴小指示。
- 修复调整背景颜色后不生效（根因：`viewport.setBackgroundColor` 从未被 main.ts 调用）；默认色=Ctrl+中键重置色（#1A1A1A）。

## 二、落地分工（并行 agent，写集不相交）
- **A（HDA 崩溃/恢复根治）**：hda/src/cyl1nder_hda.py、hda/scripts/reload_hda.py、hda/scripts/hython_smoke.py。
- **B（CSS 壳 + 字体 + fps 步进）**：web/src/styles/dock.css、web/src/styles/base.css、web/src/app/layout.ts、web/src/styles/fonts.css（新建）、web/public/fonts/*（新增字体文件）。
- **C1（首选项系统 + viewport 背景/轴标 + 字体选项）**：web/src/app/preference.ts、web/src/main.ts、web/src/viewport/renderer.ts、web/src/styles/preference-plus.css（新建）、web/e2e/round13-preference.spec.ts。
- **C2（颜色拾取器大改造 + 属性重置）**：web/src/app/color.ts、web/src/styles/colorpicker.css、web/src/app/param.ts、web/e2e/round15-color.spec.ts。

## 三、关键契约
- **A**：`_stream_loop` 禁止在后台线程调 `hou.*`；新增 `stop_sync(serial)`/`stop_all_sync()`（主进程可调）；`reload_hda.py` reload 前 stop 所有线程、reload 后 force recook 重启；hython 冒烟适配（去掉 hou.node 相关断言，加 stop_all_sync 断言）。
- **B**：`.cyl-sync-fps` 隐藏原生 spinner + 右侧 ▲▼ 步进按钮（样式同 Layout 框）；菜单 label 加高；dock 去掉 `background-image` #141518 内凹 notch（底角纯活动蓝）；字体下载 Fira Code(woff2) + Noto Sans SC(woff2, 控制体积) → web/public/fonts/ + fonts.css @font-face + `--cyl-font-code`/`--cyl-font-ui` + body 类 `.cyl-font-code`/`.cyl-font-system` + hex 字体用代码字体。
- **C1**：`viewport.setBackgroundColor(prefs.viewport_bg)` 在 preference onSave / applyLoadedPreference / 初始加载调用（V2）；renderer `makeTranslateMarker` 去掉绿色线框盒保留三轴（V1）；preference 单实例（P6）、背景色 Ctrl+中键重置（P8）、新「UI」标签 + 字体选项（切换 body 类 + 存 `ui_font`）。
- **C2**：recents 右键删/清空（P1）；全圆盘+中心去饱和、三角/矩形同尺寸、切换按钮放基础/高级旁（P2）；RGB/HSL/HSV 滑块 + 基础/高级模式（P3）；原生 EyeDropper 拾色器（P4）；Adobe 和谐色轮 + 预设 + 联动点/色块 + 明度关联（P5）；`.cyl-cp` 可拖动（P7）；param.ts Ctrl+中键重置扩展到 vector/color3 等所有类型（P8）。
- **主进程**：devlog（统一属性系统理念 P8 + annotations-web + README + 本设计文档）+ 版本 bump 0.1.00062 + 合并验证 + 单 commit。

## 四、验证
- web：tsc 0 + vitest 82 + e2e（round13/15 更新、round6/12/16 + smoke 回归，--workers=1）。
- hda：hython 冒烟（stop_all_sync / reload 安全 / reset 恢复）+ 真桥。
- bridge：pytest 50（无改动）。
- 视觉：dock 底角无黑点、菜单高度、fps 步进、字体应用、色轮/滑块/联动点（截图对比）。