> ⚠️ 状态注记（v0.1.00104）：参数面板已落地（见 params-user-guide.md）；本文仍是对标 Houdini 的设计参考。

# Parm 面板系统设计（对标 Houdini Parameter 面板）

> 状态：**本轮仅设计，不实现**（2026-08-11 · 分支 codex/cyl1nder-v0）
> 范围：web 前端 Params 面板 + 节点参数模型；不动 bridge 协议、不动 hda、不动 graph 拓扑。
> 调研来源：Houdini hou.ParmTemplate / hou.parmTemplateType / hou.FolderParmTemplate 官方文档；ComfyUI_frontend DeepWiki（widget system）；dev.to「Schema-Driven Forms in React」对比文。

## 0. TL;DR

- 选型结论：**自研轻量 schema + 控件注册表（纯 DOM）**；借鉴 Houdini「ParmTemplate（定义）/ ParmTuple（值）分离」模型、ComfyUI widget registry、JSON Forms「数据 schema 与 UI schema 分离」；**不引入** RJSF / uniforms / Formily / @mui 等 React 表单库。
- 核心设计：`ParmDef`（元数据，定义放代码侧 registry）+ `node.params`（值，沿用现形状）分离；类型体系 15 种；folder/separator 布局；Group+Class 复合模板直接对接 groups.ts；按钮 Phase1 只做前端 action。
- 落地：Phase1 = 类型+元数据+分组；Phase2 = 按钮/脚本/可见性/可更改性 + 元数据编辑；Phase3 = 打磨（slider / color picker / ramp / menu script / tabs）。

## 1. 现状能力（web/src/app/param.ts）

| 维度 | 现状 |
|---|---|
| 数据形状 | `ParamInfo{name,type,value}`；`ParamPanelInfo{label,kind,params}`；`node.params: Array<{name,type,value}>`（graph.ts CylNode） |
| 控件 | float/int → number 输入；string 且 name==="class" → 硬编码 select（autoguess/points/vertices/prim/detail）；其他 string → text |
| 渲染 | 纯 DOM 字符串拼接，无框架、无 import |
| 编辑流 | input/change → 重建 params 数组 → onChange → main.ts `setNodeParams` + `runNetwork` |
| 持久化 | 值随 `serializeGraph()`（schemaVersion 2）→ 快照；`restoreGraph()` 还原；`getNetworkSnapshot()` 供计算（network.ts `paramValue()`） |

缺口（本设计要补）：
- 类型不全：无 vector / toggle / button / menu / color / ramp / range slider。
- 无布局：无分组 / folder / separator / 折叠 / 同行紧凑。
- 无元数据：label / default / min / max / step / script / visible / enabled / help 全无。
- class 选项在 param.ts 与 network.ts `GROUP_CLASSES` 重复维护。
- group 表达式无实时校验（groups.ts 解析器已就绪但面板未用）。
- 无按钮/动作、无条件可见性/可编辑性、无默认值/重置。

## 2. 调研：现成方案清单 + 选型结论

### 2.1 Houdini 参数面板构成（参考模型）

| 概念 | 说明 | 借鉴点 |
|---|---|---|
| Pane Tab | 参数面板是 Houdini pane 的一种（另有 network / spreadsheets 等） | 我们已是 dock panel，无需引入 pane 概念 |
| ParmTemplate | 参数**定义**（元数据）：name / label / type / components / namingScheme / look / help / hidden / conditionals / scriptCallback | **定义与值分离**——`ParmDef` 照此设计 |
| ParmTuple / Parm | 参数**实例值**；`t` tuple 含 tx/ty/tz 三个 Parm | 值只存值，元数据不冗余存 |
| parmTemplateType | Int / Float / String / Toggle / Menu / Button / FolderSet / Folder / Separator / Label / Ramp / Data | 类型枚举直接对齐 |
| Folder / FolderSet | 折叠节 / 顶部 tab 组；可嵌套 | 取「单列折叠节」，tabs 留 Phase3 |
| Multiparm | Folder 的 multiparm 变体（Simple / List / Tabbed）；默认实例数；`#` 后缀 | Phase3 可选（多实例列表） |
| Button + scriptCallback | 按钮回调脚本（python / hscript，常用 `hou.phm().xxx()` 调 HDA Python 模块） | 按钮设计（§7） |
| Conditionals | disable when / hide when 表达式（`{ parm == 1 }`） | 可见性/可更改性（§8） |
| Menu / Menu Script | 下拉枚举；可脚本动态生成选项 | menu + options；动态选项 Phase3 |
| Ramp | 曲线参数 | 预留 Phase3 |
| look | 数值 tuple 显示为 vector 或 color | color 类型 |
| joinsWithNext / hideLabel / help | 行式布局微调 | 可选字段 |

### 2.2 开源可借鉴库（前端生态）

| 方案 | 形态 | 关键点 | 对本项目 |
|---|---|---|---|
| react-jsonschema-form | JSON Schema → 表单 | widget 定制强；React 依赖；语义 = 提交表单/校验 | 不用（重、React、语义不符） |
| uniforms | schema adapter + theme | 多 schema 适配；React 依赖 | 不用 |
| Formily | 阿里表单方案 | schema + 组件注册；生态大、学习成本高 | 不用 |
| JSON Forms | Data Schema + UI Schema | **数据/布局分离 + rules 引擎**；有 Vanilla renderer | 借鉴「数据 schema 与 UI schema 分离」 |
| @mui / 通用组件库 | 组件库 | 暗色 Houdini 紧凑行式主题不匹配、体积大 | 不用 |
| ComfyUI frontend | InputSpec → widget 构造器注册表 → DOM/Vue 渲染；DYNAMICCOMBO / control widgets | **widget registry 模式**；大型节点前端同款做法 | 借鉴「类型 → 控件注册表」 |
| Blender node editor | 侧栏单列折叠 panels（Node / Color…） | 简单分类 + 折叠 | 借鉴「单列折叠分组」 |
| Unreal / Substance details | 行式 label+control，按类别折叠 | 行式布局骨架 | 借鉴布局 |

### 2.3 选型结论

| 选项 | 结论 | 理由 |
|---|---|---|
| 直接用（RJSF / uniforms / Formily / @mui） | ❌ | 铁律：零新依赖优先、无 UI 框架；这些全是 React 生态（本项目仅在 rete-react-plugin 内用 React 渲染节点，面板是纯 DOM）；语义是「表单提交+校验」而非「实时参数编辑+回调+条件显隐」；暗色 DCC 风格需大量定制，改造成本 ≥ 自研 |
| 借鉴（架构/模式） | ✅ | Houdini 定义/值分离、ComfyUI widget registry、JSON Forms UI-schema 分离、Blender 折叠单列 |
| 自研（小模块） | ✅ | 面板低频（选中节点才渲染）、类型集固定（约 15 种）、无网络往返、与现有 params 数据形状天然契合；延续 groups.ts「手写紧凑解析器」先例；预计 1 个目录约 600 行 + defs |

## 3. 参数类型体系

| ParmType | Houdini 对应 | 渲染控件 | 存储 value | 备注 |
|---|---|---|---|---|
| int | Int | number 输入（整型步进） | number | min / max / step |
| float | Float | number 输入；range:"minmax" 时换 slider | number | range:"free" \| "minmax" |
| vec2 / vec3 / vec4 | Float n 分量 | N 个 number 同行（轴标 x/y/z/w） | number[] | look:"vector" |
| color | Float + look=color | 色块 + N 个 number（Phase3 可 color picker） | number[] | look:"color" |
| bool | Toggle | checkbox / switch | boolean | |
| menu | Menu (ordered) | select | string（选项 token） | options:{value,label}[] |
| string | String | text 输入 | string | |
| button | Button | button | 无（不存值） | 见 §7 |
| separator | Separator | 分隔线（可带小标题） | 无 | 布局 |
| label | Label | 静态文本 | 无 | 布局 |
| folder | Folder | 折叠节（默认展开） | 无 | 布局，见 §5 |
| ramp | Ramp | 曲线编辑（Phase3） | {pos,value,interp}[] | 预留 |
| data | Data | 隐藏（内部值） | unknown | 预留（如 serial / rev） |

规则：无值型（button / separator / label / folder）不进 `node.params`，只存在于 `ParmDef` 顺序中（决定布局与顺序）。

## 4. 参数元数据 Schema（TS interface 草案）

```ts
// 值——沿用 node.params 形状（向后兼容，serializeGraph v2 不变）
interface ParamValue { name: string; type: string; value: unknown }

type ParmType =
  | "int" | "float" | "vec2" | "vec3" | "vec4"
  | "bool" | "menu" | "string" | "color"
  | "button" | "separator" | "label" | "folder" | "ramp" | "data";

interface ParmOption { value: string; label: string }

// 定义（元数据）——Houdini ParmTemplate 对应物
interface ParmDef {
  name: string;                  // 内部名（Houdini parm name）
  label?: string;                // 显示 label，缺省 = name
  type: ParmType;
  default?: unknown;             // 缺省按类型：int/float=0、bool=false、vec=zeros、string="", menu=首个 option
  min?: number; max?: number;    // 数值范围（范围）
  step?: number;                 // int 缺省 1；float 缺省 0.001
  range?: "free" | "minmax";     // 档位/滑杆：free=输入框，minmax=range slider（Phase3 平滑）
  options?: ParmOption[];        // 仅 menu
  script?: ParmScript;           // 仅 button（Phase2 扩展 onChange 脚本）
  visibleWhen?: string;          // 可见性条件式（§8），空 = 恒可见
  enabledWhen?: string;          // 可更改性条件式（§8），空 = 恒可编辑
  group?: string;                // 所属 folder 名（扁平 defs 按此分组，§5）
  help?: string;                 // hover 提示
  look?: "vector" | "color";     // vec 系显示形态
  components?: string[];         // 轴标，缺省 x/y/z/w 按类型
  hidden?: boolean;              // 静态隐藏（data 型用）
  joinWithNext?: boolean;        // 与下一项同行（Houdini joinsWithNext）
}

interface ParmScript {
  kind: "frontend";              // Phase1 只支持前端 action
  actionId: string;              // 注册表分发（§7）
  // Phase2 扩展：kind:"bridge" | "hda" + target（白名单回调名）
}

// 复合参数（§6）
type ParmTemplate = ParmDef | { type: "groupFilter"; name: string; label?: string; classDefault?: GroupClass };
```

## 5. 分组/分类/折叠布局

| 元素 | 渲染 | 说明 |
|---|---|---|
| folder | 折叠节：标题条（label + 箭头）+ 子项，默认展开 | Houdini Folder；单列分类即可（Blender 式） |
| separator | 1px 分隔线；可带小标题 | Houdini Separator |
| 普通 parm 行 | label 左、控件右（控件列对齐） | Houdini parm pane 行式布局 |
| joinWithNext | 与下一项同行、紧凑 | vec 天然一行（多字段控件自包含，通常不需此字段） |

布局模型（推荐 A）：
- A（推荐）：`ParmDef[]` 保持**扁平**，用 `group` 字段归组；渲染器按序扫描构建 folder 树。defs/快照形状简单，数组顺序 = 渲染顺序。
- B：folder 嵌套 children（Houdini FolderParmTemplate 同款）。嵌套语义更强，但 defs 变树、更重；Phase3 需要时再升级。
- folder 可再套 folder（递归渲染）；顶部 tabs（FolderSet）Phase3 可选。

## 6. Group(String) + Group Type(enum) 复合参数模板

- 定义：一个 `{type:"groupFilter"}` 模板展开为两个普通 ParmDef（与现状 transform 的 group/class 完全兼容）：

| 展开项 | type | label | 默认 | 备注 |
|---|---|---|---|---|
| `<name>`（如 group） | string | Group | "" | 占位提示「空=全部 · @attr · 1-5 · ^排除」 |
| `<name>_class`（如 class） | menu | Group Type | "autoguess" | options = groups.ts GroupClass 五个值 |

- 联动规则：
  - group 文本改变 → 调 `parseGroupExpression(expr, cls)`（groups.ts）实时校验；能返回 GroupFilter 即合法；**不合法 → 红框 + 错误 tooltip，仅提示不阻断**（Houdini 行为近似）。
  - class 切换 → 只作 `cls` 传入；autoguess 由网络层解析（network.ts `toGroupClass` 现状）。
  - class 不改变 group 文本；两者无双向推导。
- 消费侧：网络层 `paramValue(node,"group") / paramValue(node,"class")` 读取（现状不变）；节点实现从「group+class 两个值」直接构 `parseGroupExpression`。
- 消除重复：`GROUP_CLASSES`（network.ts）与 param.ts 硬编码选项统一收敛到 groups.ts `GroupClass` 单源。

## 7. 按钮参数（脚本执行）

| 模式 | 执行位置 | 触发 | 建议 |
|---|---|---|---|
| 前端 action（推荐 Phase1） | 浏览器 | 点击 → 前端注册表 `ACTION_REGISTRY[actionId]()` → 改 params → 走既有 onChange/rerun | 零协议改动、零延迟；覆盖 reset / randomize / 参考视图等纯前端动作 |
| 桥转发（Phase2） | 桥 Python | 点击 → POST 桥 → 按 nodePath + actionId 执行 | 安全：**不允许快照带任意脚本串**（注入风险）；改为白名单回调名（HDA 侧 `cyl1nder_btn_<actionId>`），桥只转发 id |
| Houdini 直接回调（Phase2+） | Houdini | 经桥触发 HDA Python module 命名函数 | 需 HDA 侧暴露命名函数；协议变更必须同步 protocol.py / types.ts / protocol.md（铁律 3） |

- 参照：Houdini button 的 scriptCallback + scriptCallbackLanguage；HDA 内惯例 `hou.phm().fn()`。
- 存储：`ParmScript{kind, actionId}`；actionId 白名单注册，未知 id → 按钮禁用 + 提示。

## 8. 可见性/可更改性表达式

- 语法（借鉴 Houdini conditionals，取小子集）：
  - 原子：`name op value`；op ∈ `== != > >= < <=`；value 为数字或字符串；`!` 取反前缀。
  - 组合：`&`（与）、`|`（或）、`()` 分组。
  - 例：`{ class == "points" }`、`{ tx > 0 & ty < 1 }`、`{ !group == "" }`。
- 语义：`visibleWhen` 为假 → 隐藏该行（Houdini hide when）；`enabledWhen` 为假 → 控件 disabled（Houdini disable when 反向）。
- 求值：读取节点当前 params 快照；每次 onChange 全量重算面板（面板小、可接受，不做增量依赖图）。
- 实现：新增 `web/src/nodes2/parms/conditions.ts`，手写小解析器（延续 groups.ts 风格，约 100 行）；数值比较逻辑可与 groups.ts 对齐复用。
- 安全：表达式只读参数值、无函数调用、无任意求值（禁止 eval / Function）。

## 9. 持久化（沿用 node.params 渲染路径）

| 项 | 方案 |
|---|---|
| 值 | 继续存 `node.params: ParamValue[]`；serializeGraph（schemaVersion 2）形状不变 → **旧快照直接兼容** |
| 定义 | 默认 defs 放代码侧 registry `PARM_DEFS: Record<NodeKind, ParmDef[]>`（不进快照，省 token）；按节点 kind（transform 等）取 |
| 覆盖 | 仅当用户编辑元数据（Phase2）才存 `node.parmOverrides?: Record<string, Partial<ParmDef>>`；bump schemaVersion→3，restoreGraph 兼容 v2（无 defs → registry 缺省） |
| 渲染路径 | main.ts `refreshSelectionPanels` → `renderParams(el, {label,kind,params}, onChange)` 签名不变；renderParams 内部改为：取 defs（registry+overrides）→ 构建布局 → 渲染；onChange 语义不变（setNodeParams + runNetwork） |
| 顺序 | 渲染顺序 = defs 顺序；无值型项只控制布局，不参与计算/序列化值 |
| 网络计算 | network.ts `paramValue()` 不变；groupFilter 由 group + class 两个值读取（§6） |

## 10. 落地分期

| 阶段 | 内容 | 验证 |
|---|---|---|
| Phase1 类型+元数据+分组 | 新目录 `web/src/nodes2/parms/`（types / registry / render / defs）；类型 int/float/vec/color/bool/menu/string/separator/label/folder；groupFilter 复合模板；transform 迁移到 defs（tx/ty/tz/group/class 行为不变）；无协议/快照变更 | `tsc --noEmit` + vitest（控件渲染、groupFilter 校验、布局顺序） |
| Phase2 按钮/脚本/可见性 | 前端 action 注册表；conditionals（visible/enabled）；元数据编辑 UI + per-node overrides（schemaVersion 3）；按钮桥转发（白名单；若涉及协议 → 铁律 3 三端同步） | 上述 + 桥 pytest（若协议变） |
| Phase3 打磨/扩展 | range slider、color picker、ramp 曲线、menu script 动态选项、folderSet tabs、嵌套 folder、multiparm 预留 | 同上 + E2E |

## 11. 明确标注

**本轮仅设计，不实现。** 本文件不产生任何代码改动；实现另起分支与 devlog 条目，按 AGENTS.md 铁律（协议单源、零新依赖、devlog 每 commit 一句话）执行。