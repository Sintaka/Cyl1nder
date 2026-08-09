# Web 子系统改动标注 / Web annotations

## v0.1.0-cyl1nder.1
- 地基：Vite 7 + TypeScript（strict），无 UI 框架；@antv/x6 节点图；three r180（WebGLRenderer 默认，`RENDER_MODE` 预留 WebGPU）。
- 布局：左节点图 / 中视口 / 右 inspector / 底日志。
- 节点：Houdini 竖排紧凑样式，固定 4 进 4 出 socket（空输入显示 `—`）；`Graph.registerNode` 注册。
- 视口：Houdini 导航（Alt+拖拽）、射线拾取（Line threshold）、TransformControls 平移编辑 → 推 bridge outputs。
- 数据流：WS 实时收 inputs/outputs；store 订阅驱动节点统计与视口重建。
- 测试：vitest 9 通过（协议 / 编辑数学 / store）；Playwright e2e 1 通过（连真实桥）。
- 关键坑：three r180 `TransformControls extends Controls`（非 Object3D）→ 用 `getHelper()` 加入场景；X6 `Node.define` 不自动注册 → `Graph.registerNode`。