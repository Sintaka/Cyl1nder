# Zeno 调研文档索引（devlog/zeno）

> 本目录是 `D:\code\dev\zeno`（zenustech/zeno，MPL-2.0）的**算法级**调研沉淀，与既有文档互补：
> - 上级目录 `../zeno-legacy.md`：Zeno 2.0 架构综述（节点系统/求值模型/序列化/IPC/可迁移清单）。
> - 上级目录 `../zeno-guide.md`：代码检索导航字典（路径 → 一句话职责）。
> 本目录专注"算法"：数值/几何/渲染/编译器/数据结构/数学，含 git 历史中被删除或仅在分支中的实现。

## 本次新增（2026-08-10，git 历史 + 现状深挖）

| 文件 | 内容 |
|---|---|
| `algorithms.md`（本目录） | 10 节：ZFX 表达式编译器全管线、FastFLIP 数值求解器（多重网格 Poisson/变分粘性/外推/白水/体积分数/Morton）、LBVH 空间结构、GPU 拾取/增量对象/属性打包/高斯泼溅、AttrVector/PrimitiveObject/CurveObject 数据结构、vec/ONB/Wang RNG/SH 数学库、Euler WENO-LLF 气体 CFD、neo 网格算子、git 历史遗珠、Cyl1nder 落地优先级 |

## 调研方法

- 只读 + git 只读命令（`git -C D:\code\dev\zeno -c safe.directory=D:/code/dev/zeno ...`，未修改仓库）。
- 覆盖：`--all` 全分支日志、早期 commit、已删除文件（`--diff-filter=D`）、分支（FastFLIP/ZenoFX/XPBD/PrimitiveAOS/multiuv/ScreenSpaceProjectedGrid 等 200+ 分支）。
- 路径标注约定：未标 commit 的 = 当前工作树 HEAD（56c74cc3e）；标 `commit:` 的用 `git show <commit>:<path>` 读取。

## 算法清单（摘要，详见 algorithms.md）

- ZFX 表达式编译器：tokenizer→递归下降 parser→SSA 式寄存器 IR→常量折叠/DCE/CSE→线性扫描寄存器分配+spill→指令选择→文本汇编→x64 AVX SIMD JIT / CUDA PTX（多后端）
- FastFLIP：VDB 上的 SIMD 多重网格 Poisson（V/μ/K-cycle + RBGS/SRJ/SPAI0 + Eigen 粗层精确解）；变分粘性；速度外推；白水多判据发射；解析体积分数（tet/prism 分解）；fraction_inside；Morton 编码
- Euler 气体：WENO-LLF 无振荡重构 + TVD-RK 时间积分 + 反射/可穿透混合边界
- LBVH：level-order 线性存储 + skip 指针的 BVH（查询 O(logN+K)）；点/线/面距离 + 重心权重（Eberly）
- 渲染：GPU id 拾取（对象/顶点/图元 + 框选 + 深度）；MapStablizer 双缓冲增量对象 + stamp-change 四级；属性打包与 UV→切线；高斯泼溅 SH+conic（历史 commit）
- 数据结构：AttrVector SoA 属性容器（→ TypedArray）；PrimitiveObject 多拓扑；CurveObject 关键帧曲线（Bezier 二分求逆 + clamp/cycle/mirror）
- 数学：静态 vec（类型提升 trait）、Frisvad/pixarONB、Wang hash 确定性 RNG、SH 球谐求值
- 网格：对偶网格、简单细分、均匀网格哈希 Poisson 过滤撒点；xatlas UV 展开集成
- git 历史遗珠：早期 SIMD/LBM 试验、zeno1.x FlipSolver 子进程 IPC 模式、旧 ZFX VM 汇编、SPH ZFX 示例、ScreenSpaceProjectedGrid WIP

## 备注

- `projects/FastFLIP`、`projects/ZenoFX`、`projects/Euler` 源码在本地完整（FastFLIP 依赖 openvdb/partio 子模块缺失，无法编译但可读源码）；`projects/zenvdb`、`projects/Rigid` 等仅剩子模块目录。
- 授权：MPL-2.0（文件级 copyleft）；借鉴思想不受限，复制代码逻辑需保留对应文件声明。
- 输出位置说明：原定写入 `D:\code\dev\Cyl1nder\devlog\zeno\` 无写权限（沙箱限制），已按预案写入本目录并在此说明。
