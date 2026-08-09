# 开发规范 / Development guidelines

- **所有代码最简化**：能简单就不复杂，避免过度设计。
- **仅必要注释**：只写必要注释，不堆砌说明文字。
- **尽量复用成熟开源库**，避免重复造轮子；少写自制半成品。
- **分支管理**：禁止直接 merge main；大改（重构/新功能/修 bug）独立分支 `codex/<版本>-<操作>`（如 `codex/0.1.0-cyl1nder.2-feature`）；小改（文档/版本号/单点修复）可直接在当前分支提交。
- **协议单源**：`bridge/bridge/protocol.py` 是 REST/WS/MCP 的机器可读单源；改动必须同步 `web/src/protocol/types.ts` 与 `devlog/protocol.md`。
- **序列号**：`C1-<base36毫秒>-<4位随机>`，创建时生成写入隐藏参数 `cyl1nder_serial`，不可变；复制节点生成新号。
- **端口**：桥独占 8375，按 serial 路由；绝不为每个 HDA 开新端口。
- **JS/TS 改动标注**：在 devlog 对应专题文件记录与既有代码的差别。
- **版本号**：`0.1.0-cyl1nder.<dailybuild>`；dailybuild 可递增到 5 位；写入 `web/src/app/app-config.ts` 与 devlog「最近版本」。
- **Codex 子智能体**：适当时候可以直接使用子智能体（并行调研 / 独立小改动）。
- **许可证**：本项目计划 MIT；引入第三方代码时确保许可兼容；Animehairstudio 代码一律不复制（source-available 许可）。
