# Web 子系统改动标注 / Web annotations

## v0.1.0-cyl1nder.1
- 地基：Vite 7 + TypeScript（strict），无 UI 框架；@antv/x6 节点图；three r180（WebGLRenderer 默认，`RENDER_MODE` 预留 WebGPU）。
- 布局：左节点图 / 中视口 / 右 inspector / 底日志。
- 节点：Houdini 竖排紧凑样式，固定 4 进 4 出 socket（空输入显示 `—`）；`Graph.registerNode` 注册。
- 视口：Houdini 导航（Alt+拖拽）、射线拾取（Line threshold）、TransformControls 平移编辑 → 推 bridge outputs。
- 数据流：WS 实时收 inputs/outputs；store 订阅驱动节点统计与视口重建。
- 测试：vitest 9 通过（协议 / 编辑数学 / store）；Playwright e2e 1 通过（连真实桥）。
- 关键坑：three r180 `TransformControls extends Controls`（非 Object3D）→ 用 `getHelper()` 加入场景；X6 `Node.define` 不自动注册 → `Graph.registerNode`。
## v0.1.0-cyl1nder.2（2026-08-10）
- **节点图改为数据流**：`input_`（4 输出 in0..3）+ `output_`（4 输入 out0..3）+ 4 条边（in_i→out_i），取代单一 HDA 节点。
- **auto-run**：收到 Houdini 输入更新（WS inputs）后自动跑网络（v1 = passthrough，output_i=input_i）并推回桥；结果经 WS 回显到 output_ 节点。可开关。
- **视口漂移修复**：左面板 X6 图把 flex 列撑爆（canvas 每 1.5s 变窄右移）；`.cyl-left/.cyl-graph` 加 `min-width:0; overflow:hidden`。
- **CORS**：bridge 加 CORSMiddleware（浏览器 REST 从 8376→8375 不再被拦）。
- **空态引导**：未连接/桥离线时视口中央显示提示。
## v0.1.00004（2026-08-10）
- **WS 自动重连**：指数退避（0.5s→5s 封顶），桥重启后旧标签页自动恢复，不再"一直显示桥离线"。
- **回放跳过加固**：每次收到 `hello`（含重连）都重置 replayPending——重连回放的 inputs 永不触发 auto-run（防覆盖用户编辑）。
## v0.1.00005（2026-08-10）
- **UI 端口 8376**（vite strictPort；e2e/playwright 同步；桥 307 重定向指向 8376）。