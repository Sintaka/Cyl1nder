> ⚠️ 状态注记（v0.1.00104 归档）：已落地（web/src/nodes2/），本文仅早期调研。

# 节点网格 Houdini 化（node-graph-houdini）

> 状态：v0.1.00006 已落地第一版；本文记录"先调研再实现"的结论，后续升级以本文为基线。
> 关联：`web/src/nodes/*`（flags.ts / cyl1nderNode.ts / palette.ts / cutMode.ts / contextMenu.ts）、`web/src/viewport/renderer.ts`（联动）。

## 一、调研：有没有现成的类 Houdini 节点网格？

结论：**没有直接可复刻的"开箱即用 Houdini 风节点网格"库**，但有三类接近物：

| 项目 | 技术 | 像 Houdini 的程度 | 结论 |
|---|---|---|---|
| [@fbp/graph-editor](https://github.com/emilwidlund/fbp-graph-editor) | React + SVG | 中等：可拖线、端口，但横向 flow（ComfyUI 风），非 Houdini 竖排紧凑 | ❌ 不换 |
| Cytoscape.js（Houdini Web Preview 内部在用） | Canvas | 图论导向，节点样式自由度低，端口/磁吸要手搓 | ❌ 不换 |
| @procgeo/lib | WASM 几何 | 不是节点网格，是 SOP 启发的几何库 | 仅参考 |

**决策：继续用 @antv/x6 自建 Houdini 化**。X6 已具备竖排端口 / 边 / 事件 / 磁吸 / snap，欠缺的是"Houdini 语义"（flags、Tab 搜索、剪切模式、紧凑外观）——这些都是薄封装，不值得为换库引入 React 或 Canvas 复杂度。

## 二、v1 实现的 Houdini 语义

- **紧凑竖排节点**：`input_`（绿，4 输出 in0..3 在右）/ `output_`（红，4 输入 out0..3 在左）/ `null`（灰，4+4 直通）。`wfBadge`（⛶）显示 wireframe 态。
- **Flags（右键节点菜单）**：
  - `display`：该节点几何是否在 3D 视口显示（input_ 控制 inputs 组、output_ 控制 outputs 组）→ 高亮描边（`cyl-glow` 预留）。
  - `bypass`：虚线描边 + 灰化（v1 数据仍直通，语义占位）。
  - `freeze`：锁定 🔒，标题变灰（数据不可变占位）。
  - `wireframe`：该节点几何以半透明线框叠加到 3D 视口作为**参考**（input_=原始输入、output_=Houdini 结果、null=直通输入）。
  - Flag 持久化在 X6 `node.setData({flags})`，`applyFlags()` 负责样式派生。
- **Tab 搜索**：`Fuse.js`（成熟模糊搜索，threshold 0.4 / ignoreLocation / 关键词含中文）→ `cyl-palette` 浮层，↑↓ 导航 / Enter 创建 / Esc 关闭。`searchPalette()` 为纯函数可单测。
- **Y 剪切模式**：按住 Y → `.cut-mode` 剪刀光标；点边删边、点 null 节点删节点（input_/output_ 主干保护）。Escape 关闭 palette 后需 blur 释放焦点，否则 Y 被误判为"正在输入"。
- **节点 ↔ 3D 视口联动**：点 input_ 的端口 i → 视口选中 input_i 曲线（`viewport.pickByNode`）。

## 三、下一步（未做，设计占位）
- 真正的"线框参考"还可在节点体内画 SVG 缩略预览（Houdini 中键预览）；v1 用视口叠加线框，语义已通。
- 节点执行语义（bypass/freeze 真正影响 runNetwork）等 v0.2 网络引擎再做。
- Null 节点实际接线（in_i → null.in_i → null.out_i → output.in_i）参与数据流。
