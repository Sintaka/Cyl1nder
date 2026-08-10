# 关键决策 / Decisions & Why

| 决策 | 内容 | 为什么 |
|---|---|---|
| 图形栈 | 浏览器 WebGL2/WebGPU（Three.js r180+，WebGPURenderer 可切），不碰原生 Vulkan | 2026 WebGPU 全浏览器 Baseline；原生 Vulkan 开发成本高、无热更新；浏览器零安装持续更新 |
| 端口模型（grill 纠正） | 单桥进程独占 8375，REST 按 `/api/hda/<serial>/...`、WS 按 `?serial=` 分桶 | 端口 = 一个监听 socket；每 HDA 一端口会造成端口管理爆炸 |
| 序列号 | 节点实例级；创建瞬间生成 `C1-<base36ms>-<4rand>` 持久化到隐藏参数；复制节点生成新号；绝不 cook 时现算 | cook 时现算每次都会变；时间戳必须落盘才"一次确定、永不变" |
| HDA 形态 | SOP HDA 编辑节点 = Subnet；内部 1 个 Python SOP + 4 个 Output SOP(0-3) | SOP 节点原生单输出；Subnet 才能暴露多输出（Vellum 同款做法） |
| v1 实现语言 | Houdini 侧用 Python SOP（免重启热重载）；C++ 只在热路径需要时上 | 避开 C++ DLL 锁定 / 重启；桥是 I/O 型不是计算型 |
| 数据流 | HDA cook → 推 4 输入 JSON（防抖线程）→ 桥存 rev buffers → 前端编辑 → 桥 → HDA pull | 解耦生命周期；Houdini 重启不影响桥状态 |
| 几何格式 | v1 紧凑 JSON（points/曲线/width/P）；二进制/glTF 后置 | 简单、可调试、够原型 |
| Houdini MCP | 直接用官方 fxhoudinimcp（pip 包 `python -m fxhoudinimcp`，默认端口 8100/8101+ 自动探测）；不用自己写的桥、不用 oculairmedia fork / rpyc 18811 | 官方维护、工具齐全（约 188 个）；自写桥重复造轮子且易过时 |
| 前端地基 | Vite + TypeScript，无 UI 框架；X6 节点图；Three 视口 | 类型即文档省 token；X6 可自定义 Houdini 竖排样式 |

| Houdini MCP | 直接用官方 fxhoudinimcp（pip 包，`python -m fxhoudinimcp`，默认端口 8100/8101+）；不用自己写的桥、不用 oculairmedia fork / rpyc 18811 | 官方维护、工具齐全（约 188 个）、自动探测端口；自写桥重复造轮子且易过时 |
| 前端/桥生命周期 | 前端(8376 vite) 生命绑定到桥(8375)：shelf 工具与 HDA autostart 一起起停双进程；`Open in Browser` 先确保 UI 起来再打开 | 避免"桥开着但 UI 没起"；单入口管理，不再依赖用户手动起 vite |
| 端口占用 | 应用数据路径只有 8375(桥) + 8376(web dev)；8100 是 agent↔Houdini 控制通道（fxhoudinimcp），不是应用数据路径 | dev 需要 vite HMR 不能合并；发行版可让桥托管 `web/dist` 静态文件合并为单端口（v0.2 再做） |