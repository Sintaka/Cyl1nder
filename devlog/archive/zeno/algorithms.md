# Zeno 算法深挖（git 历史 + 现状）

> 调研对象：`D:\code\dev\zeno`（zenustech/zeno，MPL-2.0）。只读 + `git` 只读命令完成，未修改仓库。
> 定位：本文只写**算法级**内容（数值 / 几何 / 渲染 / 编译器 / 数据结构 / 数学），与 `zeno-legacy.md`（架构综述）和 `zeno-guide.md`（代码导航）互补，不重复架构部分。
> 路径标注：默认指当前工作树 `HEAD`（56c74cc3e）；标注 `commit:` 的来自 git 历史（`git show <commit>:<path>` 可读，含已删除文件）。

## 0. 总览：本次挖到什么

| 领域 | 算法 | 位置 | 迁移性 |
|---|---|---|---|
| 表达式编译 | ZFX 全管线：tokenizer→AST→SSA 式 IR→十余道 pass→线性扫描寄存器分配→文本汇编→x64 SIMD JIT / CUDA PTX | `projects/ZenoFX/ZFX/` | ★★★★★ 纯逻辑，可直接移植 TS/WASM |
| 数值流体 | VDB 上的 SIMD 多重网格 Poisson（V/μ/K-cycle + RBGS/SRJ/SPAI0） | `projects/FastFLIP/simd_vdb_poisson*.{h,cpp}` | ★★☆ 概念可借鉴，依赖 OpenVDB |
| 数值流体 | 解析体积分数（tet/prism 分解）+ 1D/2D fraction_inside | `projects/FastFLIP/volume_fractions.cpp`、`levelset_util.cpp` | ★★★★ 纯公式，WASM/TS 可跑 |
| 数值流体 | 变分粘性、速度外推、白水（泡沫/气泡/水雾）发射 | `projects/FastFLIP/simd_viscosity3d.cpp`、`vdb_velocity_extrapolator.cpp`、`whitewater.cpp` | ★★★ 概念 + 部分纯逻辑 |
| 气体 CFD | WENO-LLF 重构 + TVD-RK 时间积分 + 混合边界 | `projects/Euler/Libs/{WENO,TVDRK,AdvectionOp}.h` | ★★★★★ 纯算术，TS 可直接实现 |
| 空间结构 | 线性 BVH（level-order + skip 指针）+ 点/线/面距离与重心权重 | `projects/ZenoFX/{LinearBvh.h,LinearBvh.cpp,SpatialUtils.hpp}` | ★★★★★ 极适合 TS 空间查询 |
| 空间结构 | Morton 编码（查表法 64 位交织） | `projects/FastFLIP/morton_encoding.h` | ★★★★ TS 位运算可做 |
| 渲染 | GPU 拾取（对象/顶点/图元 id 着色 + 框选 + 深度） | `zenovis/src/bate/FrameBufferPicker.cpp` | ★★★★★ three.js 同款思路 |
| 渲染 | 增量对象管理（双缓冲 Map + stamp-change 分级） | `zeno/include/zeno/utils/MapStablizer.h`、`zenovis/src/ObjectsManager.cpp` | ★★★★★ Map<key,Object3D> 增量更新 |
| 渲染 | 属性打包 + 由 UV 求切线 | `zenovis/src/bate/GraphicPrimitive.cpp` | ★★★★ BufferGeometry 打包 |
| 渲染 | 高斯泼溅（SH 球谐 + conic 矩阵） | commit `b993c3f47`: `zenovis/xinxinoptix/GassionSplatting.h` | ★★★★ 泼溅渲染/预览 |
| 数据结构 | SoA 属性容器 AttrVector | `zeno/include/zeno/types/AttrVector.h` | ★★★★★ Map<string,TypedArray> |
| 数据结构 | 多拓扑 PrimitiveObject（tris/quads/polys/loops/uvs） | `zeno/include/zeno/types/PrimitiveObject.h` | ★★★★ BufferGeometry 索引体系 |
| 数据结构 | 关键帧曲线求值（Bezier 二分求逆 + clamp/cycle/mirror） | `zeno/include/zeno/types/CurveObject.h` | ★★★★★ 曲线编辑器/求值 |
| 数学 | 静态 vec 库（类型提升 trait） | `zeno/include/zeno/utils/vec.h` | ★★★★ TS 泛型可仿 |
| 数学 | 正交基 ONB（Frisvad / pixarONB） | `zeno/include/zeno/utils/orthonormal.h` | ★★★★ 切线空间/采样 |
| 数学 | Wang hash 确定性 RNG | `zeno/include/zeno/utils/wangsrng.h` | ★★★★★ 并行安全随机 |
| 网格 | 对偶网格 / 简单细分 / 均匀网格 Poisson 过滤撒点 | `zeno/src/nodes/neo/{PrimDualMesh,PrimSubdiv,PrimScatter}.cpp` | ★★★★ 纯拓扑+哈希 |
| 历史 | 早期 SIMD/LBM 试验、zeno1.x FlipSolver 子进程模式 | git 历史 commit | ★★★ 思路借鉴 |

---

## 1. ZFX 表达式编译器（最值得搬的一块）

### 1.1 整体管线
**路径**：`projects/ZenoFX/ZFX/`（驱动 `zfx.cpp`；历史早期版在 `projects/.unusedTools/OldZFX/old/zfx/`）
**核心思想**：把"点 wrangle"表达式语言（`@attr`/`@@neighbor`/`$param`/三元/向量 swizzle/if-else）编译成寄存器式 IR，再经十几道优化 pass 后，由后端落为**运行时机器码**（x64 AVX SIMD JIT 或 CUDA PTX）。
**管线**（`compile_to_assembly`，`zfx.cpp`）：

```
parse(code) -> AST
  -> lower_ast -> IR(SSA 风格：每条语句一个 id 即虚拟寄存器，dim=向量宽度)
  -> ControlCheck / SymbolCheck / TypeCheck
  -> DetectNewSymbols（可选：发现新写入的属性）
  -> ExpandFunctions（函数内联展开）
  -> LowerMath（把复杂数学函数拆到指令集） / DemoteMathFuncs
  -> LowerAccess（@/@@/$ 访问降级为 ldl/stl/ldg/stg/ldp）
  -> ConstantFold（常量折叠）
  -> KillUnreachable（死代码消除，从全局写入反向传播）
  -> ReassignParameters（参数重排，去掉未用 uniform）
  -> ConstParametrize（常量参数化）/ RegisterAllocation（线性扫描 + spill）/ SaveMathRegisters
  -> MergeIdentical（等价语句合并 ≈ 公共子表达式消除）
  -> ReassignGlobals（属性通道重排）/ GlobalLocalize
  -> EmitAssembly（指令选择 -> 文本汇编 add/sub/mul/ldi/ldp/ldl/stl/...）
  -> 后端：x64 Assembler（vectorclass，AVX JIT）或 cuda Assembler（NVRTC/PTX）
```

**复杂度**：parse O(n)；lower O(n)；各 pass 一般 O(n)~O(n log n)；寄存器分配（线性扫描）O(n log n)（区间按起止点排序）。
**可借鉴到 Cyl1nder**：
- Cyl1nder 若要在前端跑"表达式/公式参数"（Houdini 通道引用、vex 子集），可**照搬这套前后端分离设计**：TS 实现 tokenizer→AST→IR→passes→emit 到 JS 函数 / WebGPU WGSL / WASM，比手写解释器快且可优化。
- `KillUnreachable` 用"从副作用（全局 store）反向依赖图"做 DCE，是通用技巧。
- `MergeIdentical` 的 `serialize_identity()` 字符串化做 CSE，实现简单（TS 用 `Map<string,reg>` 即可）。
**备注**：旧版（OldZFX）是 VM 解释式汇编（`#imm/$reg/@mem` + `bind` 通道指令，`assemble.cpp`），新版升级为 JIT——两版对比可见"先解释后编译"的演化路径，TS 原型可先做解释器再上编译。

### 1.2 Tokenizer + 递归下降 Parser
**路径**：`ZFX/Tokenizer.cpp`、`ZFX/Parser.cpp`、`ZFX/Lexical.h`
**核心思想**：手写词法（数字/标识符/符号）；递归下降 + 优先级爬升：`?:` → `|^` → `&&!` → 比较 → `+-` → `*/%` → 一元 → 原子/调用/括号/`.swizzle`。语句层只认 `if/elseif/else/endif` 与 `=`/`+=`/`-=`/`*=`/`/=`/`%=`。AST 是 s-表达式（`(token args...)`），带 token 迭代器做位置回溯。
**复杂度**：O(n)。
**可借鉴**：TS 里写表达式解析器可照抄这套分层结构（尤其 `&!`、三元、swizzle）；`AST{iter}` 的"游标即位置"设计便于报错定位。

### 1.3 AST→IR 降级（SSA 风格寄存器）
**路径**：`ZFX/LowerAST.cpp`、`ZFX/IR.h`、`ZFX/Stmts.h`
**核心思想**：
- 每个中间值一个 `Statement`，其 `id` 即虚拟寄存器号，`dim` 为向量宽度（float/vec2/vec3/vec4 统一建模，SIMD 友好）。
- 符号（属性）→ 按维度分配一串连续 reg；参数（uniform）同理；局部临时变量独立编号。
- 指令集：`UnaryOp/BinaryOp/TernaryOp/FunctionCall/VectorSwizzle/VectorCompose/Assign/Symbol/ParamSymbol/TempSymbol/Literal`；控制流用结构化 `FrontendIf/ElseIf/Else/EndIf`（不用 goto）。
- 低层 IR（LowerAccess 之后）出现 `AsmLocalStore/Load`（spill 内存）、`AsmGlobalStore/Load`（属性通道）、`AsmParamLoad`（uniform）、`AsmIf/ElseIf/Else/EndIf`（结构化分支）、`AsmJump/AsmJumpIf`（注释掉的 goto 变体）。
**复杂度**：O(n)。
**可借鉴**：TS 表达式 IR 直接抄这个结构——"每个表达式节点一个编号 + dim"，天然支持向量化/批量求值（一次跑 N 个点）。

### 1.4 优化 pass 样例
**路径**：`ZFX/ConstantFold.cpp`、`ZFX/KillUnreachable.cpp`、`ZFX/MergeIdentical.cpp`
**核心思想**：
- **ConstantFold**：遍历时维护 `reg->float` 值表；二元/一元/函数调用若操作数全为常量则求值并生成 `AsmLoadConst`；遇到控制流语句清空值表（保守）。
- **KillUnreachable**：先正向构建 `stmt->src` 依赖图 + `reg` 最近定义点 + `local/global mem` 最近写入点；种子 = 所有 `AsmGlobalStore`（副作用）；反向 DFS 标记可达语句；只克隆可达语句（控制流语句全保留）。
- **MergeIdentical**：把每条语句 `serialize_identity()` 序列化为字符串，`map<identity, reg>` 去重合并（含 SSA 化重写）。
**复杂度**：各 O(n)~O(n+m)。
**可借鉴**：TS 三个 pass 均 <50 行可移植；DCE 的"副作用种子"思路对前端公式系统很有用（只求值会写回属性/画布的表达式）。

### 1.5 线性扫描寄存器分配 + spill
**路径**：`ZFX/RegisterAllocation.cpp`（注释引用 UCLA linear scan 讲义）
**核心思想**：
- `UCLAScanner`：对每条语句收集用到的 reg → 每个 reg 的活跃区间 = 首末使用语句 id；`interval` 集合按 start 排序，`active` 集合按 end 排序；顺序扫描：先释放 `endpoint < 当前 start` 的活跃 reg，再从空闲池取最小号分配（池空则开新号）。
- 若 `maxregs >= 目标寄存器数 nregs`：`FixupMemorySpill` 把超限 reg 落内存——源操作数先 `AsmLocalLoad`，目标写回用 `call_on_dtor`（RAII 延迟）在指令后补 `AsmLocalStore`；保留 3 个寄存器给 load/store 临时（ternary 需要）。
**复杂度**：O(R log R + S log S)，R=reg 数，S=语句数。
**可借鉴**：Web 端若把公式编译成"寄存器上限"的 SIMD/WASM 本地代码（如 WASM 局部变量有限），这套线性扫描 + spill 直接可移植；TS 里约 200 行。

### 1.6 指令选择 + x64 SIMD JIT 后端
**路径**：`ZFX/EmitAssembly.cpp`、`ZFX/x64/{Assembler.cpp,SIMDBuilder.h,Executable.h,FuncTable.h}`
**核心思想**：
- `EmitAssembly` 是纯映射：IR op → 文本 opcode（`add/sub/mul/div/mod/and/or/xor/andnot`、比较 `cmpeq/cmpne/cmplt/...`、`mov/neg/not`、三元 `blend`、`ldi/ldp/ldl/stl/ldg/stg`、结构化 `.if/.elseif/.else/.endif`）。
- `x64::Assembler` 逐行解析文本，用 `SIMDBuilder`（vectorclass）生成 AVX 指令字节流：广播常量 `ldp`、`loadu/storeu`、二元 op、`blendv`（条件选择）、函数调用（把参数压栈、`call` 函数指针表 `FuncTable`、Win32 下额外 64 字节 shadow space）。
- 产出写入 `exec_page_allocate` 的可执行页并 `mark_executable` —— **运行时 JIT**。
**复杂度**：O(S)。
**可借鉴**：
- "文本汇编作为 IR 与后端之间的中间表示"——TS 里可输出 `"add 3 1 2"` 再由后端解释/编译，便于调试打印。
- 若 Cyl1nder 走 WASM：同一文本 IR 可发到 WASM 线性内存（每个通道一个 float32 数组），或用 WASM `memcpy` 批量执行；`blend` 三元 → WGSL `select`。
**备注**：`SIMDBuilder` 依赖 vectorclass（第三方，`ZFX/x64/vectorclass/`），TS/WASM 侧不需要 AVX，直接用标量或 TypedArray 循环即可，核心思想不变。

### 1.7 CUDA 后端
**路径**：`ZFX/cuda/{Assembler.cpp,kernel.cu,NVRTC.cuh}`、`include/zfx/cuda.h`
**核心思想**：同一文本汇编被 CUDA 后端翻译为 PTX/CUDA 代码，经 NVRTC 运行时编译为 kernel；`kernel.cu` 中每条通道一个线程，属性通道在全局内存。
**可借鉴**：证明"一个 IR + 多后端"（CPU SIMD / GPU / 未来 WebGPU）是可行架构——Cyl1nder 可把同一公式 IR 编译到 JS/WGSL 双后端。

### 1.8 使用范式（wrangle + BVH 邻居）
**路径**：`projects/ZenoFX/pnbvhw.cpp`（`sorted_bvh_vectors_wrangle`）、`misc/tools/sph.zfx`（SPH 内核 ZFX 示例，commit `791c9a364^`）
**核心思想**：每点一个线程/循环：用 LBVH `iter_neighbors` 收集邻居 → 按距离排序 → 逐邻居把 `@@` 通道灌入 `ctx.channel` → 执行 JIT `exec`（SIMD 跑表达式）→ 累加。ZFX 语言里 `@pos`=本点属性、`@@pos`=邻居属性、`$radius`=uniform、三元 `?:`、`length` 等内置函数；SPH 示例含 WPoly6/Spiky 风格核函数。
**可借鉴**：Cyl1nder 的"点云邻域计算"（风场、碰撞、聚类）可组合 TS 版 LBVH + 表达式求值，逻辑完全一致。

---

## 2. FastFLIP 数值求解器（OpenVDB + SIMD）

> `projects/FastFLIP/`：FLIP_vdb.cpp(141KB)、simd_vdb_poisson*.cpp(>200KB)、simd_viscosity3d.cpp(148KB) 等。依赖 OpenVDB/partio 子模块，当前无法编译；本文提炼算法思想。

### 2.1 FLIP 主循环（P2G / G2P / 投影）
**路径**：`projects/FastFLIP/FLIP_vdb.cpp`（当前树）；历史删除的 zeno1.x 包装节点 `zeno/src/nodes/flip/flipsolver.cpp`（commit `0de89a1bb^`，Win32 IPC 子进程解算器 + zencache 缓存）
**核心思想**：
- 粒子→网格（P2G）：按权重把粒子速度散布到交错网格（MAC 布局，`StaggeredBoxSampler` 在面心采样）；`normalize_p2g_velocity` 处理"某面权重为 0 但邻居有速度"的缺失分量，用 27 邻域有效面平均补全。
- 网格投影：解 Poisson 压力方程（见 2.2），速度减去压力梯度（`ProjectionOp` 思路，Euler 侧亦有）。
- 网格→粒子（G2P）：`PointAdvect` + 速度插值回粒子，FLIP 混合（保留粒子速度增量 + 网格速度）。
- 网格速度外推（2.4）与白水（2.5）补充。
**可借鉴**：Web 端做"演示级流体"可用简化版（规则网格 + 共轭梯度），不需要 OpenVDB；P2G 缺失分量补全是数值鲁棒性的好例子。

### 2.2 VDB 上的 SIMD 多重网格 Poisson 求解器
**路径**：`projects/FastFLIP/simd_vdb_poisson.h/.cpp`、`simd_vdb_poisson_uaamg.h/.cpp`
**核心思想**：
- 7 点 Laplacian（Ng 2009 流固耦合）：对角项按"面权重 + 液相/气相 fraction"组装——液相面权重 1、固相 0、气相除以 `fraction_liquid`；`Laplacian_with_level` 每层持有 `m_Diagonal + m_Neg_x/y/z_entry` 稀疏矩阵（OpenVDB 稀疏树存储）。
- 层级：从最细 SDF 逐层 coarsening（`coarsening` 构造），`m_dof_idx` 记录自由度重编号。
- 求解器：**V-cycle**、**μ-cycle**（mucycle，多种光滑器模板：RBGS 红黑 Gauss-Seidel、SRJ 计划松弛 Jacobi、SPAI0 稀疏近似逆）、**K-cycle**；粗层用 **Eigen SimplicialLDLT 精确解**。
- SIMD：`alignas(32)` 的 `simd_laplacian_apply_op` 用 AVX 同时对 leaf 内多体素求值；`vdb_SIMD_IO.h` 做网格<->SIMD 缓冲搬运。
**复杂度**：多重网格每 V 循环 O(N)（N=未知量），远优于 CG 的 O(N·κ) 迭代。
**可借鉴**：Web/TS 上若做规则网格流体，"多重网格 + 红黑 Gauss-Seidel + 粗层直接解"是最优实践；TS 可写稠密/稀疏矩阵版，OpenVDB 换成 `Float32Array` 分层数组即可。
**备注**：`simd_vdb_poisson_uaamg` 是 UAAMG（代数多重网格变体）实验，读 `*.h` 头文件即可理解数据结构（`m_v_cycle_*`、`m_K_cycle_*` 缓存）。

### 2.3 变分粘性
**路径**：`projects/FastFLIP/simd_viscosity3d.h/.cpp`
**核心思想**：变分粘性（variational viscosity）——把粘性隐式化为对称正定系统（类似 Poisson），按自由度重编号 + 多重网格/预条件求解；支持从节点参数接受粘性场（commit `d88ccc973 solve variational viscosity` / `de70276a9 accept variational viscosity input`）。
**可借鉴**：概念（隐式粘性 = SPD 系统）对 Web 流体预览够用；细节依赖 VDB/Eigen，不必搬。

### 2.4 速度外推（空域填充）
**路径**：`projects/FastFLIP/vdb_velocity_extrapolator.cpp`（25KB）
**核心思想**：对"液体边界外一层"的空速度体素，用 6 邻域（面相邻）中已定义邻居做加权平均（`tempvel`/`valcount`），迭代多轮把速度外推到近空气区域；`empty_indicator` 标记需要填充的块，leaf 级并行（TBB）。
**可借鉴**：外推是流体/粒子上屏必需的（否则边界速度为 0 导致呆板）；TS 规则网格上"多轮 6 邻域平均 + 有效计数"实现成本极低。

### 2.5 白水（泡沫/气泡/水雾）
**路径**：`projects/FastFLIP/whitewater.cpp`
**核心思想**：从速度/曲率/涡量/加速度多判据发射白水粒子：
- `checkAngle`：速度与法线夹角 < 阈值（浪尖）；
- 曲率 `meanCurvature`（`curv_emit`）、加速度（`acc_emit`，用上一帧速度差）、涡量 `curl`（`vor_emit`）各自带 `ClampMap` 权重；
- 深度限幅（`LimitDepth`）、固体 SDF 排除；`dt` 缩放发射数量；每线程独立缓冲（`std::map<thread::id, vector>`）避免锁竞争。
- 泡沫/气泡阻力模型见 FastFLIP 历史 commit（`79f972db5 drag for foam and bubble`、`f85aa0215 switch drag force model`）。
**可借鉴**：Web 特效"水花/泡沫"的发射判据组合（速度夹角 + 曲率 + 涡量 + 加速度，各自 clamp-map 到 [0,1]）可直接照搬为 TS 算法。

### 2.6 解析体积分数（SDF → 液相体积）
**路径**：`projects/FastFLIP/volume_fractions.cpp`、`levelset_util.cpp`
**核心思想**：
- 1D `fraction_inside(phiL, phiR)`：线性插值零点，返回"线段内侧比例"（若两端都在内=1，都在外=0）。
- 2D：按角点内/外数量分 4 类（0/1/2/3 个负值），旋转数组到规范位形后，用三角形面积公式（`0.5*side0*side1`）解析求面积；对角情形用中心点符号消歧。
- 3D：先排 4 个 phi（`sort`），按落入"四面体/三棱柱"位形套用解析公式：`sorted_tet_fraction = phi0^3/((phi0-phi1)(phi0-phi2)(phi0-phi3))`、`sorted_prism_fraction = a*b*(1-d)+b*(1-c)*d+c*d`；立方体 = 两种五四面体剖分的平均（权重 1/12、2/12）。
**复杂度**：O(1) 每体素。
**可借鉴**：★★★★ 纯公式、无依赖，TS/WASM 几十行可搬。Cyl1nder 做"液面渲染/体素化预览"（SDF→体积分数→渲染/质量估计）可直接用。

### 2.7 Morton 编码（空间序）
**路径**：`projects/FastFLIP/morton_encoding.h`
**核心思想**：3 个 21 位坐标按位交织成 64 位 Z-order（zyx 交织）；用 256 项查表（`morton256_x/y/z`，每字节预展开）+ 移位合并，比逐位循环快；类内静态单例缓存表。
**复杂度**：O(1) 编码。
**可借鉴**：TS 用 `BigInt` 或 4×16 位查表可实现；用于粒子排序/空间局部性（Web 端 point cloud 排序、LOD 分块）。

---

## 3. 空间数据结构（ZenoFX）

### 3.1 线性 BVH（LBVH）
**路径**：`projects/ZenoFX/LinearBvh.h/.cpp`、`pnbvhw.cpp`
**核心思想**：
- 构建：对 prim 元素（point/line/tri/tet）包围盒做排序，得到**level-order 线性数组**：`sortedBvs[]` 每个槽 = 节点包围盒，`levels[]` = 该节点深度，`auxIndices[]` = 叶子存元素下标、内部节点存"右子树起点"（skip 指针）。
- 查询（`iter_neighbors` / `iter_neighbors_radius` / `find_nearest` / `find_nearest_within_group`）：`node=0; while(node!=-1 && node!=numNodes){ for(;level;--level,++node) if(!intersect(box,pos)) break; if(level==0){leaf 处理; node++} else node=auxIndices[node]; }` —— 利用 skip 指针在整棵子树不命中时 O(1) 跳过。
- `distance(box,x)`：盒外距离（`abs(x-center)-(max-min)/2` 截断到 0 + 长度）。
- `find_nearest_within_group`：支持组谓词（同一属性组）且可带 UV 距离混合。
- `refit()`：几何变化时自底向上重算盒。
**复杂度**：构建 O(N log N)（排序），查询 O(log N + K)（K=命中数），最坏 O(N)。
**可借鉴**：★★★★★ 这是 Web 上做"拾取/最近点/邻居/碰撞"的最佳模板——three.js 场景里把包围盒数组 + skip 指针直接放进 TS `Float32Array`，查询免递归、缓存友好；`find_nearest_within_group` 的"距离+UV 距离加权"对曲面投影/贴图对齐很实用。

### 3.2 点/线/面距离 + 重心权重
**路径**：`projects/ZenoFX/SpatialUtils.hpp`
**核心思想**：
- `dist_pp/dist_pe/dist_pt` 返回距离**同时回填重心权重 `ws`**（`dist_pe` 分 3 类：端点/内部投影；`dist_pt` 是 Eberly 的 DistPointTriangle 区域判定（region 0-6），返回 `(1-s-t, s, t)`）。
- 带 `strictly_greater/loosely_greater` 容差比较。
**复杂度**：O(1)。
**可借鉴**：★★★★ 源码即文档（Eberly Boost 许可）。Cyl1nder 做"点到网格最近点 + 重心坐标"（拾取 UV、变形器、投影）直接移植，TS 三份函数即可。

---

## 4. 渲染算法（zenovis）

### 4.1 GPU 拾取（FrameBufferPicker）
**路径**：`zenovis/src/bate/FrameBufferPicker.cpp`（另见 `FrameBufferRender.h`）
**核心思想**：id 着色 FBO（GL_RGB32UI 整数纹理）：
- 三个 shader 变体：对象模式（输出 `uvec3(objId,0,0)`）、顶点模式（`gl_VertexID+1`）、图元模式（`gl_PrimitiveID+1`）；另有 `empty` 与 `empty_and_offset`（写深度偏移用于"空区域不遮挡"）。
- `draw()`：遍历 GraphicsManager 里所有 graphic，每个用唯一 `objectId` 画一遍到 FBO；`id_table[objId]→名字` 维护映射。
- 单点拾取 `getPicked(x,y)`：`glReadPixels(1x1, GL_RGB_INTEGER, GL_UNSIGNED_INT)`，坐标翻转 `h-y-1`；对象模式返回名字，元素模式返回 `名字:元素下标`。
- 矩形框选 `getPicked(x0,y0,x1,y1)`：读矩形像素，对象模式收集去重 objId 集合，元素模式收集 `objId→元素集合`；`PICK_MODE` 切换。
- 深度拾取 `getDepth`：读 `GL_DEPTH_COMPONENT`。
**复杂度**：绘制 O(场景)，读回 O(框选像素)。
**可借鉴**：★★★★★ three.js 完全同构：`WebGLRenderTarget` + 整数 id 顶点色 → `readRenderTargetPixels` → 解码；顶点/图元/对象三级粒度 + 框选去重是现成功能清单；深度拾取可用 `gl.readPixels(GL_DEPTH)`。

### 4.2 增量对象管理（双缓冲 Map + stamp-change）
**路径**：`zeno/include/zeno/utils/MapStablizer.h`、`zenovis/include/zenovis/bate/GraphicsManager.h`、`zenovis/src/ObjectsManager.cpp`
**核心思想**：
- `MapStablizer<Map>`：内部 `m_curr/m_next` 双缓冲；`insertPass()` 返回 RAII `InsertPass`——`may_emplace(key)` 若 key 已存在则把旧值搬到 `m_next` 并返回 false（**不重建**），否则返回 true；`try_emplace` 填新值；作用域退出 `swap(m_curr,m_next)`；`has_changed()` 比较键集合。
- `GraphicsManager::load_objects`：只对 `may_emplace` 为真的 key 调 `makeGraphic` 新建 GPU 对象；`draw()` 遍历既有对象——**增量的关键是不动未变对象**。
- `ObjectsManager::load_objects`：结合求解器写回的 `userData["stamp-change"]`：`TotalChange`（全重建）/`DataChange`（仅数据，按 `stamp-dataChange-hint` 局部更新）/`ShapeChange`/`UnChanged`（完全复用旧对象）；`isRealTimeObject` 走实时通道（`realtime_graphics`）。
**复杂度**：O(键数) 每帧，重建量 = 变更量。
**可借鉴**：★★★★★ Cyl1nder 前端直接采用：`Map<string, {object3D, stamp}>` + 每帧 diff；求解器/后端在对象上标注 `stamp`（全变/数据变/形状变/未变），前端按级别只更新 position/geometry/整树。这正是"Houdini 逐帧流 + three.js 增量渲染"的落地模式。

### 4.3 属性打包 + UV→切线
**路径**：`zenovis/src/bate/GraphicPrimitive.cpp`
**核心思想**：
- 线元素展开：`lines[i]=(a,b)` → 两个独立顶点（pos/clr/nrm/uv/tang 各一份），避免 OpenGL line 顶点属性歧义；`parsePointsDrawBuffer` 五点交织打包。
- 三角形切线：`f=1/(Δuv0.x*Δuv1.y-Δuv1.x*Δuv0.y)`；`tangent = f*(Δuv1.y*e0 - Δuv0.y*e1)`（e0/e1 为边向量），UV 缺失置 0；带 `1e-5` 防除零。
- `computeTrianglesTangent` 支持按三角形面积加权累计到顶点（`tang1[v] += area*tang[i]`，见 `#if 0` 旧实现思路）。
**可借鉴**：three.js `BufferGeometry` 对应：lines→`LineSegments` 展开顶点、切线→`computeTangents` 或自写（公式同上）；"属性按需打包 + 缺省补 0"策略直接复用。

### 4.4 高斯泼溅（射线追踪版，历史 commit）
**路径**：commit `b993c3f47`: `zenovis/xinxinoptix/GassionSplatting.h`（合并 commit `145f64a8d`）
**核心思想**：
- SH 球谐颜色：degree 0-3 常系数（`SH_C0..SH_C3_*`），按视线方向 `EvalSH(dir, params, offset, level)` 求和 + 0.5 偏置；`GassionDensity(relPos, conic)` 为 conic 矩阵高斯密度（该提交内为占位）。
- 用法：光追 kernel 命中 splat 时按视线与 splat 的高斯权重贡献颜色。
**可借鉴**：★★★ 泼溅预览/降噪渲染：SH 系数→颜色是纯公式（TS 可直接搬）；`conic` 高斯权重对 Web 泼溅渲染（three.js 自定义 shader / points）同样成立。
**备注**：WIP 性质代码（`GassionDensity` 返回 0），读作"算法草图"。

### 4.5 历史渲染试验（zhxxvis / OptiX）
**路径**：`zenovis/zhxxvis/`（preIntegrate.cpp 24KB、voxelizeProgram.h 34KB、shaders.h 65KB）、`zenovis/xinxinoptix/`（PTKernel.cu、Shape.h、zxxglslvec.h）
**核心思想**：旧 GL 渲染器有体素化（voxelizeProgram）、预积分（preIntegrate，体绘制/半透明）；OptiX 路径追踪器按 BSDF 分文件（`DeflMatShader.cu`、`sss`、`transmission`），`zxxglslvec.h` 是 CUDA 侧 GLSL 风格 vec 库。
**可借鉴**：概念层（体素化 → Web 用 3D 纹理/JSM 体素；预积分 → 前端可用 2D LUT）。不建议搬 C++ 渲染本体。

---

## 5. 数据结构

### 5.1 AttrVector（SoA 属性容器）
**路径**：`zeno/include/zeno/types/AttrVector.h`（历史 commit `45508c698` 调整过 unmerge/filter）
**核心思想**：`values`（基础属性，通常 pos）+ `attrs: map<string, variant<vector<vec3f>, vector<float>, vector<vec3i>, vector<int>, vector<vec2f>, vector<vec2i>, vector<vec4f>, vector<vec4i>>>`；`attr<T>(name)` 类型安全访问；`update()/resize()/reserve()` 把长度变化同步到所有属性；`attr_visit/foreach_attr` 类型擦除遍历；`add_attr<T>(name)` 惰性建列。
**可借鉴**：★★★★★ Web 端直接映射为 `Map<string, Float32Array|Int32Array>` + `attr<T>` 泛型访问 + `resizeAll(n)`；比每属性独立数组的"属性个数 × 顶点数"管理清晰，且天然 TypedArray 传输（同 `ObjectCodecPrimitive.cpp` 二进制布局）。

### 5.2 PrimitiveObject 多拓扑
**路径**：`zeno/include/zeno/types/PrimitiveObject.h`（及 `PrimitiveUtils.h`）
**核心思想**：一个对象同时持有 `verts/points/lines/tris/quads/polys/loops/edges/uvs` 多套拓扑 + 每套拓扑独立的属性集合（`verts.attr`、`tris.attr`...）；`polys+loops` 支持任意多边形。
**可借鉴**：three.js 只需 position+index，但"每拓扑独立属性槽"对前端属性面板/按元素着色很实用；`tris.attr("uv0")` 约定与 Houdini 每面 UV 对齐。

### 5.3 关键帧曲线求值
**路径**：`zeno/include/zeno/types/CurveObject.h`（`CurveType.h` 定义 B-spline 类型枚举）
**核心思想**：
- `CurveData`：控制点（值 + 左/右手柄）+ 段类型（Bezier/Linear/Constant）+ 循环类型（clamp/cycle/mirror）。
- `eval(x)`：先按循环类型把 x 折叠到定义域（mirror 用 `floor&1` + `fmod` 翻转）；`lower_bound` 定位段；Bezier 段用**二分求逆**（100 次上限，`eval_bezier_value` 对 x 反解 t）求值，Linear 直接 lerp。
- `updateRange` 做范围归一化重映射；`CurveObject` 支持 `x/y/z/w` 多键曲线，`eval(vec)` 逐分量。
**可借鉴**：★★★★★ Houdini 通道曲线/参数曲线面板的求值内核可直接移植：TS 二分求逆 + cycle 折叠 + `lower_bound`，百行内；`BCurveObject`（3D 点列）可对接 B-spline 采样（`CurveType` 枚举含 LINEAR/BEZIER/CATROM/BSPLINE）。

---

## 6. 数学库

### 6.1 静态 vec 库
**路径**：`zeno/include/zeno/utils/vec.h`
**核心思想**：`vec<N,T>: std::array<T,N>` + 运算符重载 + 类型 trait（`is_vec_promotable`/`is_vec_castable`，标量↔向量混算的编译期策略）；`dot/length/normalize(带保护)/cross(2D/3D)/mix/unmix/clamp/minmax/fract`。
**可借鉴**：TS 可用 `[number,number,number]` + 泛型或 class；重点是"标量↔向量提升"规则明确化，避免 GLSL 与 JS 混算坑。

### 6.2 正交基 ONB
**路径**：`zeno/include/zeno/utils/orthonormal.h`
**核心思想**：Frisvad 2012 无分支法线→正切系（`a=1/(1+nz)`、`t=(1-nx²a, -nxny a, -nx)`，`b=(-nxny a, 1-ny²a, -ny)`，z 向下极值特判）；`pixarONB`（up 向量叉乘）+ `guidedONB/guidedPixarONB`（给定近似切向的引导）。
**可借鉴**：Web 端切线空间（法线贴图、环境采样、粒子对齐）直接用 Frisvad 公式，比 `cross(n, up)` 数值稳。

### 6.3 确定性随机（Wang hash）
**路径**：`zeno/include/zeno/utils/wangsrng.h`
**核心思想**：Wang 整型哈希（`(i^61)^(i>>16)`、`*9`、`^<<4`、`*0x27d4eb2d`、`^>>15`）作为状态机；seed 可由多维坐标异或组合（`seedx^randomize(seedy^...)`），从而**每像素/每粒子独立可复现**；提供 uint32/64、int、float[0,1)、double、bool 提取。
**复杂度**：O(1)，无状态共享 → 可并行。
**可借鉴**：★★★★★ Web 粒子/撒点/噪声的确定性随机首选（与 three.js `MathUtils` 互补）；TS 实现 15 行。

### 6.4 球谐（SH）求值
**路径**：commit `b993c3f47`: `GassionSplatting.h` 的 `EvalSH`
**核心思想**：degree 0-3 实球谐基（SH_C 常系数表），按方向 (x,y,z) 计算各阶基函数与系数点积。
**可借鉴**：环境光/泼溅/IBL 预览的 SH 求值是纯公式，TS/WGSL 直接搬系数表。

---

## 7. 气体 CFD（Euler 项目，最小可读示例）

**路径**：`projects/Euler/Libs/{WENO.h, TVDRK.h, AdvectionOp.h, ProjectionOp.h, StateDense.h, GasSimulator.h}`（当前树，`Libs/` 子目录）

### 7.1 WENO 重构 + LLF 通量
**核心思想**：
- `WENO2/WENO3`：光滑指示子 `s_i`（相邻差平方/二阶差分组合），权重 `a_i ∝ C_i/(ε+s_i)²`（C=1/3,2/3 或 0.1,0.6,0.3），加权组合候选模板多项式 → 无振荡高阶重构。
- `WENO2_LLF/WENO3_LLF`：先做 Lax-Friedrichs 分裂（`α=max|u|`，左右通量 ±αq），再分别对两侧重构。
- `First_LLF`：一阶迎风 LLF。
**复杂度**：O(1) 每面/步。
**可借鉴**：★★★★★ 纯算术，TS 可直接实现；Web 端"烟雾/气体预览"用 2D/3D WENO-LLF + 投影即成型（与 FastFLIP 思路一致但无 OpenVDB 依赖）。

### 7.2 TVD-RK 时间积分
**核心思想**：`TVDRK2/TVDRK3` 返回 Butcher 系数（RK2: (1,0,1),(.5,.5,.5)；RK3: (1,0,1),(.75,.25,.25),(1/3,2/3,2/3)），`GasSimulator` 按 substep 组合显式更新。
**可借鉴**：TS 数值积分模板，3 行代码。

### 7.3 混合边界条件
**核心思想**（`AdvectionOp.h::mixed_bc_flux`）：按 stencil 两侧 cell 类型（GAS/FREE/INLET/SOLID/BOUND）组合：外部类型时做外插（`U[0]=U[1]`）；固体边界构造"反射 stencil"（`U_r = 2*u_interface - U_interior`）与"可穿透 stencil"（直接外插），按 `i_frac`（可穿透比例）混合。
**可借鉴**：Web 流体 Demo 的边界处理照抄这套 if-else 决策表即可，语义清晰。

---

## 8. 网格处理（zeno/src/nodes/neo）

**路径**：`zeno/src/nodes/neo/`（39 个算子文件，当前树）

### 8.1 对偶网格 PrimDualMesh
**核心思想**：把多边形网格转对偶（面→点、邻接面→边）；`keepBounds` 保留边界边（用 `map<pair<int,int>,int>` 记录"边界边→面"，内部边标记 -1）；支持 `polygonate` 预处理（把 tris/quads 统一为 polys）。
**可借鉴**：TS 拓扑算法模板（半边遍历 + 边字典），用于前端网格重拓扑预览。

### 8.2 简单细分 PrimSubdiv
**核心思想**（`#if 0` 历史实现）：三角形细分：边中点 + 面心 + 顶点，`edgelut: map<pair<int,int>,vector<int>>` 建边→面邻接，生成 4 个新面/三角形（类 Loop 一步）；属性插值 `interpAttrs`。
**可借鉴**：TS 实现"边字典 + 顶点池追加"的细分骨架（Loop/Catmull-Clark 的共用底座）。

### 8.3 撒点 + Poisson 过滤 PrimScatter
**核心思想**：按密度属性/`density` 参数生成候选点（面内随机 + 重心坐标），再做 **Poisson 过滤**：`minRadius` 时建均匀网格哈希 `lut: unordered_map<vec3i, vector<int>>`，对每点查 27 邻格，距离 < minRadius 则擦除；`revamp` 索引压缩后 `forall_attr` 重排所有属性。
**复杂度**：哈希 O(N)，27 邻格常数，总体近似 O(N)。
**可借鉴**：★★★★ 前端撒点/去重直接照搬（TS `Map<string,number[]>` 键=格坐标），`forall_attr` 同步重排思想与 AttrVector 配合。

### 8.4 其他
- `PrimGenerateONB`：用 6.2 的 ONB 给每点生成切线系（法线贴图/导向）。
- `PrimMatchUV/PrimCodecUVs`：UV 匹配/编解码；`CalcGeometryUV` 项目集成 **xatlas**（334KB，UV 图集展开）+ tinyply/OBJ IO——第三方针线（atlas 展开）Web 端可用 three.js `UVUnwrapper` 类库替代，但"UV 对齐/每面 UV"约定可借鉴（见 `PrimMatchUV`、`multiuv` 分支 `1471db8e7`）。

---

## 9. git 历史中有价值但已不在 HEAD 的算法/模式

| 内容 | commit | 路径 | 价值 |
|---|---|---|---|
| 早期 SIMD 试验（1D blur 20x） | `6054a0287` | `CudaTest`（历史） | 证明 SIMD/GPU 加速路径；Web 对应 WASM SIMD/WebGPU |
| 早期 LBM 格子玻尔兹曼（taichi 导入 + SIMD 向量化） | `3c06503c5`/`cd58eccde`/`aabc035dc` | `AeroLBM`（历史） | LBM 思路（f_eq 碰撞/流），TS 可做 2D 烟雾预览 |
| zeno1.x FlipSolver 子进程解算器 | `0de89a1bb^` | `zeno/src/nodes/flip/flipsolver.cpp` | 求解器独立进程 + Win32 共享内存/管道 IPC + 帧缓存（zencache）——Cyl1nder"后端求解器 ⇄ Web 前端"的进程/缓存模式参考 |
| 旧 ZFX（VM 解释汇编） | `projects/.unusedTools/OldZFX/`（HEAD 仍在） | `old/zfx/{compile,assemble,zfx}.cpp` | 解释→JIT 演化对照 |
| SPH 内核 ZFX 示例 | `791c9a364^` | `misc/tools/sph.zfx` | ZFX 语言用法样例（@/@@/$、三元、核函数） |
| 高斯泼溅 | `b993c3f47` | `zenovis/xinxinoptix/GassionSplatting.h` | SH + conic 草图 |
| ScreenSpaceProjectedGrid（海洋屏幕空间投影网格） | `04bff29c6` | `zeno/src/nodes/CameraNodes.cpp` | WIP 存根（hitOnFloor 射线落水平面），读作思路：把无穷海洋网格投影到屏幕空间细分 |

---

## 10. 给 Cyl1nder 的落地优先级建议

1. **先搬 ZFX 编译管线骨架**（tokenizer→AST→IR→passes→emit），TS 实现，输出 JS 函数；公式参数/表达式即插即用——收益最大。
2. **LBVH + SpatialUtils**：TS 版 `Float32Array` 线性 BVH + 点/线/面距离（带重心权重），供拾取/最近点/邻居/碰撞。
3. **GPU 拾取**：three.js FBO id 拾取（对象/顶点/图元三级 + 框选）。
4. **增量对象管理**：`Map<key,{obj3D,stamp}>` + stamp-change 四级（Total/Data/Shape/UnChanged）。
5. **AttrVector→TypedArray 映射** + `ObjectCodecPrimitive` 二进制布局（解码同构，见 legacy）。
6. **曲线求值**（CurveObject 二分求逆 + cycle）与 **Wang RNG**、**Frisvad ONB** 直接入工具库。
7. 数值/流体：volume_fractions、fraction_inside、WENO-LLF、速度外推、白水判据为**可选高级项**（TS/WASM 纯实现，用于 Web 预览）。
