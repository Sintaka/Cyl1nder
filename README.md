# Cyl1nder

Cyl1nder 是「数据进 → 可视化/编辑 → 数据出」的**中间站**，用于打通 Houdini SOP HDA 与 WebGL 前端：
Houdini 里的 Cyl1nder HDA（4 输入/4 输出）把几何推到本地桥（127.0.0.1:8375），浏览器里用 Three.js
视口 + rete.js 节点图查看/编辑，再把结果拉回 Houdini 继续处理。Cyl1nder 不做成 DCC，剩下工作交给 Houdini。

版本：`0.1.00089`（x.xxx.xxxxx，每次 commit dailybuild++，规范见 devlog/development-standards.md）。当前架构：HDA 事件驱动 /stream 长轮询 ⇄ 本地桥（8375）⇄ WebGL 前端（Three.js 视口 + rete.js 节点图）；数据流 = 节点图编辑 → core/network 计算 → viewport 展示（由 core/dataflow 装配）；按域拆薄（nodes2/ viewport/ color/ core/ + hda 的 lifecycle/cache/geometry/sync）。详见 devlog/README.md 与 devlog/refactor-retrospective.md。

**许可证**：Cyl1nder Source-Available Non-Commercial License（禁止商用，个人学习/非商业可用；最终使用者负全责，与作者无关；详见根 LICENSE）。

## 快速开始

### 1) 桥（Python 3.12，端口 8375）
```powershell
cd bridge
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m bridge
```

### 2) 前端（Vite + TS）
```powershell
cd web
npm install
npm run dev
```

### 3) Houdini HDA
把 `hda/package/cyl1nder.json` 复制到 `%USERPROFILE%\Documents\houdini22.0\packages\`（首次需重启 Houdini），
Tab 搜索 **Cyl1nder** 创建节点（4 输入 / 4 输出）。免重启迭代见 hda/README.md。

### 4) MCP
见 mcp/README.md（Houdini MCP 补全 + Cyl1nder 桥 MCP）。

## 目录
| 路径 | 说明 |
|---|---|
| `bridge/` | Python 本地桥：registry / workspace / logs / REST / WS / MCP / compute 接口 |
| `hda/` | Subnet HDA（4 进 4 出）+ 序列化器 + 桥客户端 + hython 冒烟 |
| `web/` | Vite + TS：Three.js 视口 + rete.js 节点图 + 编辑工具 |
| `mcp/` | Houdini MCP 启动器 + 桥 MCP 启动器 + 安装脚本 |
| `scripts/` | 函数索引 / 依赖图 / API 索引生成器 |
| `devlog/` | 规范、决策、协议、改动标注 |
