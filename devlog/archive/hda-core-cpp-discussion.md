> ⚠️ 状态注记（v0.1.00104 归档）：已定案——HDA 核心纯 Python（不引入 C++ core），本文仅历史讨论。

# HDA Core 方案讨论：CPP 发行 vs 本地原生（流式传输前提）

> 版本 0.1.00005 起。**只讨论，不执行**。背景：流式传输是必要的（见 livelink-roadmap.md）；是否用 C++ 写 HDA core 作为发行版、dev 版继续 Python 热更新，或把大头放本地。

## 一、先定事实：瓶颈在哪
- livelink-roadmap 已分析：瓶颈不是 Python 本身（本地 HTTP 毫秒级），而是 **① 全量重建几何（视口频闪）② 轮询粒度 ③ cook 主线程内做同步/序列化**。
- HDA（python SOP）本身只做：推输入、拉输出、反序列化几何——**不是性能热点**。
- 真正的热点在：**几何序列化/反序列化、渲染流式更新（只改 P 位置）、协议带宽**。

## 二、三个候选方案
### 方案 A：HDK C++ SOP 作为发行版，dev 用 Python 热更新
- 优点：最终分发无 Python 依赖、原生性能。
- 缺点：
  - **双实现维护**：Python dev 版 + C++ release 版两套代码，行为/边界极易漂移。
  - **C++ 迭代 = 编译重启**（Houdini 锁 DLL；Live++ 可热重载但 Windows 上痛苦，正是你被 HDK 折磨的原因）。
  - HDA 频繁重建，违背"热更新优先"理念。
- 结论：**不推荐**作为默认路线，除非发行版要极致单文件。

### 方案 B（推荐）：大头放本地，HDA 保持薄 Python 壳
- 形态：HDA 仍是薄 Python 壳（现状，几乎不改）；**本地原生 core**（C++/Rust 进程或 DLL）承载几何序列化/流式更新/协议，经 `compute/` 执行器接口（已有 `register_executor` + `ctypes_stub` 预留）+ IPC（WS/HTTP/ctypes）被 HDA 与 bridge 调用。
- 优点：
  - **HDA 极少更新**（Python 壳热更新不变）——满足"不用频繁更新 hda"。
  - **后端（bridge + native core）高频热更新**（独立进程，重启用 shelf 一键）。
  - **单实现**：native core 同时服务 dev/release，无双实现漂移。
  - 性能热点（序列化/流式）在原生侧，WebGL 前端 + bridge 不变。
- 缺点：多一个本地原生组件（构建/打包复杂度），需要 IPC 协议。
- 路径：先做 **B1 位置流式**（协议/几何层，纯 Python 可先行验证）→ 再 **B2 把序列化/流式热点迁入 native core**（compute/ 接口 + ctypes 桩已验证可行）→ release 打包 = bridge + native core + Vite dist。

### 方案 C：C++ 热更新（Live++/hot-reload）
- 可探索，但受 Windows DLL 锁 + Houdini 加载机制限制，工程复杂度高，**列为远期**，不阻塞当前路线。

## 三、结论与建议
1. **HDA 保持薄 Python 壳**（现状即最佳）：热更新、几乎不改。
2. **大头放本地原生**（方案 B）：流式同步/几何处理下沉到 native core，通过 `compute/` 注册表 + ctypes 接口接入；bridge 与 native core 同进程或就近，可高频热更新。
3. 下一步（按 livelink-roadmap 顺序）：**先做位置流式更新（B1）**——收益最大、纯 Python 先行、HDA/桥/前端三端都可热更新验证；C++/Rust core 作为其后的性能增强，不改变架构。
4. 发行版 = 打包 bridge + native core + Vite dist + 薄壳 HDA，**不需要把 HDA 本身换成 C++**。