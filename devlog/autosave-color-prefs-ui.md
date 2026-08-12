# 自动保存 + 颜色系统 + 首选项浮动窗 + UI 微调 / AutoSave, color system, floating Preferences & UI polish

> 版本 0.1.00058 候选 · 日期 2026-08-12 · 角色：主进程（设计 + 契约 + 合并）
> 关联：`sync-rate-limit-and-preference.md`（v0.1.00057 首选项起步）、`development-standards.md`（并行规范）

## 一、任务分解（用户需求）
1. **保存系统**：平常不写盘（移除 1.5s 防抖自动写 scene/node-graph.json）；Ctrl+S 才写；新增**定时自动保存**（默认每 5 分钟一次）；General 首选项里用分隔符做「Auto Save」大块（启用 toggle + 间隔分钟）。
2. **Enter 模式**：取消选择时不再丢 gizmo——暂时挂在**上一个选中的 transform 节点**并保持 enter 状态；只有主动选另一个节点/显式退出才改变。
3. **UI**：
   a. 菜单顺序 **File / Edit / Layout**。
   b. Preference 改**浮动窗口（非模态）**：打开不阻止背后工作；加 **Apply**（应用但不关闭）。
   c. Preference **分类标签页**：现有两项进 General；新增 **Viewport** 标签（viewport 默认背景颜色，用共享颜色拾取器）。
   d. **统一颜色属性系统**：param 系统（现 float/int/string/class/enum）新增 **color3**（vector float normalize，存储 rgb [0..1]）；Params 面板 color3 渲染色块，左键弹出**现代颜色拾取器**（色相轮盘 + SV 面板 + 色块系统，支持 RGB / HSL / HSV 三模式 + 直接输入 #hex String，编辑时字符串实时同步）。
   e. **dock 标签角标 bug**：活跃 tab 底部两圆角蓝色渲染对，但后面有个深蓝背景挡住不活跃标签角落（绘制错误/旧改动残留排查）。
   f. Layout 菜单直接显示当前布局名（如 Desk1），固定 15 字符宽，不再显示 "Layout"。

## 二、契约（跨 agent 锚点）
### 2.1 preference.ts（Agent B 拥有，Agent A 只读使用）
- `Preferences` 扩展：`autosave_enabled: boolean`（默认 true）、`autosave_interval_min: number`（默认 5，**允许小数** ≥0.1，便于 e2e 用小间隔）、`viewport_bg: string`（hex，默认 "#1a1a1a"）。
- 既有导出保持稳定：`loadPreferences / savePreferences / applyPreferences / clampSyncFps / openPreferenceDialog(current, onSave)`（签名不变；**Apply 也调 onSave 但不关闭**）。
- `openPreferenceDialog` 改非模态浮动面板（含 ✕/Cancel/Apply/Save；分类标签 General / Viewport）。

### 2.2 color.ts（Agent C 新建，Agent B 消费）
```ts
export interface RGB { r: number; g: number; b: number }        // 0..255
export function rgbToHex(rgb: RGB): string;                     // "#rrggbb"
export function hexToRgb(hex: string): RGB | null;
export function openColorPicker(opts: {
  initial: RGB;
  onColor: (rgb: RGB, hex: string) => void;                     // 实时回调（拖动/输入时）
  title?: string;
}): () => void;                                                 // 返回关闭函数；非模态浮动弹窗
```

### 2.3 renderer.ts（Agent B）
- 新增 `setBackgroundColor(hex: string): void`（`scene.background = new THREE.Color(hex)`）；main.ts（Agent A）在加载/应用 prefs 时调用。

### 2.4 保存语义（Agent A）
- 删除 `scheduleSaveGraph` 的 1.5s 自动写盘（保留 dirty 标记即可）。
- 显式保存路径（Ctrl+S / Save Scene / Save As / 自动保存）写 `putSnapshot({graph, docking, preference})`。
- 自动保存：读 `prefs.autosave_enabled` / `prefs.autosave_interval_min`（分钟，`*60_000` ms），定时执行；prefs 变化（Edit→Preference 的 onSave 回调、applyLoadedPreference）时重启定时器。

## 三、落地分工（并行 agent，写集不相交）
- **Agent A（web 保存/菜单/Enter）**：`web/src/main.ts`、`web/src/app/layout.ts`、`web/e2e/round14-autosave.spec.ts`（新建）。
- **Agent B（web 首选项浮动窗 + 标签页 + Viewport 背景色）**：`web/src/app/preference.ts`、`web/src/viewport/renderer.ts`、`web/src/styles/base.css`（仅首选项浮动窗/标签/AutoSave 块样式）、`web/e2e/round13-preference.spec.ts`（适配浮动窗/Apply/标签）。
- **Agent C（web 颜色系统）**：`web/src/app/color.ts`（新建）、`web/src/app/param.ts`（color3 色块 + 弹窗）、`web/src/protocol/types.ts`（类型文档）、`web/src/styles/colorpicker.css`（新建）、`web/e2e/round15-color.spec.ts`（新建）。
- **Agent D（web dock 角标 bug）**：`web/src/styles/dock.css`、`web/src/app/dock.ts`（如需要）。
- **主进程**：devlog（protocol.md 无需动——纯 web；annotations-web / README / 本设计文档）+ 版本 bump 0.1.00058 + 合并验证 + 单 commit。

## 四、验证
- web：tsc 0 + vitest 82 不回归 + e2e（round13 适配 / round14 自动保存 / round15 颜色 / round12 回归 / smoke）。
- Agent D：dock 标签角标视觉验证（headless 截图对比活跃/非活跃标签角落）。
- 跨端：hython 冒烟不受影响（无 bridge/hda 改动）；pytest 50 不回归（无 bridge 改动）。