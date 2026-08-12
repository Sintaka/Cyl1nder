# 浮动面板跳出浏览器页面（pop-out）可行性调研

> 日期 2026-08-13 · 角色：主进程（调研）· 关联：viewport-interrupt-redesign.md（v0.1.00064 曾记录「浮动面板跳出页面=大改，本轮不做」）

## 背景
用户希望 Preference 面板与调色板这类浮动窗口能「拖出标签页面」成为独立窗口，而不是局限在浏览器标签内。

## 结论
- 浏览器 DOM 无法直接变成原生 OS 窗口；可行方案有三档：
  1. **Document Picture-in-Picture API**（`documentPictureInPicture.requestWindow({width,height})`）：把现有 DOM 节点移动到 PiP 窗口，常驻置顶、独立于标签页。**Chromium/Edge 113+ 支持；Firefox/Safari 不支持**。本项目默认 Edge，可用。最贴近「拖出标签页」。
  2. **`window.open` + `postMessage` 同步**：开一个独立浏览器窗口跑一份面板，主窗口与弹窗通过 postMessage 同步状态。跨浏览器可用，但需要单独页面/状态同步，改动最大。
  3. **Chrome/Edge 自带「标签页弹出」**：浏览器菜单可把当前标签独立成窗口，但不是 web 能编程控制的，无法作为功能交付。

## 推荐与工作量
- 推荐 **Document PiP**：Edge 可用、效果最符合需求、无需额外页面。需要：
  - 把 color.ts / preference.ts 里 `document.addEventListener(...)` 改为 `panel.ownerDocument.addEventListener(...)`（否则移到 PiP 后 Esc / 拖动 / 键盘失效）。
  - 把主文档的 `<style>`/`<link rel=stylesheet>` 复制进 PiP 文档 head（Vite 注入的样式不自动跟随）。
  - PiP 关闭时把面板节点移回主文档（或销毁），并处理 PiP 单实例限制。
- 工作量：中等（约 150-250 行 + 两个面板各加一个 pop-out 按钮）。因涉及 color.ts 与 preference.ts 的文档级监听重构，建议单独开一轮实现，避免与调色板 UI 迭代并发。

## 落地（v0.1.00067）
- 新增 `web/src/app/popout.ts`：`isPopoutSupported()`（检测 `'documentPictureInPicture' in window`）+ `popoutElement(panel, {width,height,onClose})`——请求 PiP 窗口、克隆主文档 `<style>`/`<link>` 样式与 body 字体 class 进 PiP 文档、把面板节点移入 PiP、PiP 内 Escape / 原生关闭回调 onClose，返回 `{closePip}`（幂等关闭）。
- 调色板与 Preference 面板 header 各加一个 **⧉ pop-out 按钮**：`isPopoutSupported()` 为 false 时自动隐藏（主动判断支持）；点击即弹出为 PiP 窗口；面板 `close()` 会连带 `closePip()`。
- 拖拽监听（色轮 / 标题栏）从 `document` 改为 `root.ownerDocument` / `panel.ownerDocument`，保证在 PiP 文档里拖拽仍可用；Esc 由 popout.ts 在 PiP 文档内单独处理。

## 撤销（v0.1.00068）
- 实测「PiP 弹回主文档时调色板会被直接 close」+ 拖拽/跨文档复杂度高 → **取消 popup 功能**：删除 `popout.ts`、两个面板的 ⧉ 按钮与相关 import/session，恢复纯页内浮动面板。
- 替代方案：新增 `fitInViewport()` 位置兜底——拖拽时把面板钳在视口内，retarget/重新召唤时若面板越界则回默认位置，避免「被拖出屏 / 分辨率变化后找不到面板」。

## 状态
- 已取消（v0.1.00068）。若要再上，建议仍用 Document PiP，但先解决「弹回即关」与文档级监听迁移，单独开分支。