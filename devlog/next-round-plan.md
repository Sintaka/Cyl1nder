# 下一轮任务落盘（v0.1.00118+）

> 2026-08-19 主进程写给下一轮 agent。当前分支 `codex/develop`，最后提交见 `git log`。
> 基线：**pytest 317 / tsc 0 / vitest 579**。场景：`beginTest-2.hip`，3 个已注册节点、6 条映射条目。
> 先读 `development-standards.md`（铁律）与 `project-mapping-design.md`（映射系统权威）。

## 0 两个待修 bug（已定位到行，可直接改）

### bug A：双击 nodeview 会放大

**根因**：rete 的 `Zoom` 类自己绑了 `dblclick`
（`rete-area-plugin.esm.js:326` → `onzoom(delta, ox, oy, 'dblclick')`）。
不是我们的代码调的。

**修法**：`zoom` 是可取消的管线事件，`ZoomEventParams` 带 `source?: ZoomSource`
（已在 `_types/area.d.ts` 确认）。在 `graph.ts` 里 `area.addPipe` 拦掉
`source === 'dblclick'` 即可——**只挡双击，滚轮缩放不动**。

参照既有先例：同文件 `area.area.setDragHandler(null)`（graph.ts:316）就是同类
「拆掉 rete 默认交互」的做法，注释也在那儿。

**为什么必须挡**：#4 要求 obj 层「双击进入节点」。双击同时触发缩放的话，
进入动作会伴随一次视图跳动，手感直接废掉。所以这条是 #4 的前置。

**验证**：双击画布空白 / 双击节点，`area.area.transform.k` 不变；滚轮缩放仍正常。

### bug B：Alt + 左键 在线上应生成 dot，而不是转接预览/选中

**现状**（`graph-interact.ts:1334` 起的 pointerdown 处理器）：
- 1353 行：`if (e.ctrlKey)` → `insertDotAt`（**Ctrl** 才插 dot，且插的是真节点）
- 1363 行：无修饰键落到 `trackedConnId = connId` → 拖动即「转接预览」，单击即「选中线」
- 1039 行（另一个处理器）：`if (e.altKey || …) return` —— Alt 当前被直接忽略

**修法**：
1. 1353 行的 `e.ctrlKey` 改成 `e.altKey`，并且**必须在 1363 行取 grab 之前拦截**
   —— 顺序就是「不出现转接预览、不选中线」的全部原因。
2. 调用目标从 `insertDotAt`（插节点）换成新的 waypoint 写入
   （`setConnectionWaypoint` + 重绘该连接）。
3. Alt+拖动 = 生成后继续跟随鼠标移动该 waypoint；甩出连线一定距离则删除。
4. 1039 行那个 `clearConnectionSelection` 处理器保持忽略 Alt（它已经这么做了），
   否则会在生成 waypoint 的同时把线的选中态清掉。

**验证**：Alt+单击线 → 出现白点、线不进入选中态、无虚线预览；
Alt+拖动 → 点跟手；甩远 → 点消失且**线仍完整**（一条，不是两条半截）。

## 1 已完成的地基（本轮已提交，别重做）

| 提交 | 内容 |
|---|---|
| `45c0028` | waypoint 数据模型：`ConnectionWaypoint{x,y}` + get/set，挂在连接上 |
| `(next)` | `waypoint-path.ts`：两段贝塞尔路径生成（纯函数，5 例测试） |

**关键约定**（照 `bypass` 抄的，别改）：
- waypoint 是**连接的可选属性**，参与序列化，但 `getNetworkSnapshot` / `network.ts`
  **永不读它** —— 它是纯装饰件
- 无 waypoint 时**不输出该键**，所以旧快照字节不变
- 非有限坐标一律当无；存副本，外部改动不污染

**为什么不做成节点**（实测过的教训）：旧 `dot` 是真 `NodeKind`，`insertDotAt` 干的是
「删 1 条连接 + 加 1 个节点 + 加 2 条连接」并触发 `onNetworkChanged`。后果：
- 进入拓扑，`network.ts:214` 得为一个纯装饰物写 passthrough 特例
- 删掉它留下两条半截线
- 还要 `dotSeq` / `claimDotLabel` / undo 的 `dot-add` 分支伺候

改成连接属性后：
- 连接始终是**一条**，不可能半截
- 拓扑不变 → cook 完全不受影响
- 断联时连接本身消失，waypoint 随之消失

**已确认无迁移负担**：扫过全部 `node-graph.json` 与项目 `graph.json`，
**没有任何存档含 dot 节点**，所以 `NodeKind` 里的 `"dot"` 可以直接删干净。

## 2 dot 收尾（承上）

1. `customize.connection` 自定义连线组件，消费 `waypointConnectionPath`，
   并在 waypoint 处渲染圆点（未接线白色 → 已有 `.cyl-rp-dot.unwired` 配色可复用）
2. Alt 手势（见 bug B）
3. **删干净** `dot` NodeKind：`makeDotNode` / `dotSeq` / `claimDotLabel` /
   undo 的 `dot-add` 分支 / `network.ts:214` 的 dot passthrough / Tab 面板条目
4. 改测试：`dot-neutral.test.ts` → waypoint 版；
   `e2e/round18-reconnect.spec.ts:257` 现在断言「Ctrl+click splices a _dot_ node」，
   要改成 Alt+click 产生 waypoint 且**连接数不变**

## 3 剩余四个大任务

见下节各自的「现状 / 目标 / 已知坑」。**动手前先读对应现状文件**，
不要照本文档的描述凭空写——本文档只保证方向正确，不保证行号仍准。

### 任务 #4：obj / sop 层级 + 双击进入 + 改名 UI

**目标**（用户原话归纳）：学 Houdini 的 `/obj` 与 obj 内 sop 的关系。第一层
（含其中建的 subnet，可套娃）**不是 sop**；进入 geometry 类节点后才是 sop。
obj 层进入方式是**双击**（不是点右上角 display flag）。左上角支持改名，
名称下方小字显示序列号（已有）**与 hip 中的绝对地址（需新增）**。

**现状**：
- `NodeKind = input|output|null|transform|dot|project|channel`，**没有层级概念**，
  所有节点平铺在一张图里
- 进入成员靠 channel 节点的 display chip（`setChannelDisplayHandler`），不是双击
- 新建图默认就塞 `_input_`/`_output_`（`graph.ts:325`），
  但用户要求「新场景直接进 `/P1-…`，下面不自动创建任何东西，
  让用户自己建 geometry 节点、进去才是 sop」

**建议**：给节点加 `netKind`（`obj` | `sop`），而不是继续往 `NodeKind` 堆。
`geo` 类节点可进入，进入后图切到它的 sop 子图。分类同时整理：
`inoutput` / `transform` 这些**只在 sop 层**可创建。

**已知坑**：`app/graph-scope.ts` 已经建模了「图是谁的」，层级要接到它上面，
**别再引入第二套状态**——本轮的数据丢失事故正是「用 `currentProjectId`
推断图归属」造成的。另外 bug A（双击缩放）是本任务前置，先修。

### 任务 #6：项目根节点显示 hip 绝对地址

**目标**：根目录那个黄色指示节点（如 `P1-msyiasx0-a2gf`）下方显示当前对应的
hip 绝对地址（一般过长，**中间省略**）与名称。

**现状**：`makeProjectNode(id, label)` 只有 id 与 label，没有 hip。
`ProjectRef` 已有 `hip` / `hipName`（协议三处已同步）。

**做法**：hip 传进 `makeProjectNode`，NodeView 的 project 分支渲染副标题。
省略**必须**用 `app/elide.ts` 的 `elide()`，完整值进 `title`——
这是 `development-standards.md` 的铁律，**不要**用 CSS `text-overflow`
（它砍尾，而序列号的辨识位在尾部）。

### 任务 #7：地址系统适应相对引用自动更新

**目标**：`/P1-…/geo1` 下，在根目录把 `geo1` 改名成 `geo2`，
内部节点路径与所有引用（含 object merge 式引用）自动跟随。

**已完成**：`web/src/nodes2/ref-registry.ts`（36 例测试）已实现登记表、
边界安全重写（`geo1` 改名不碰 `geo10`）、`audit` / `auditRename` 预览。
**尚未接到改名 UI —— 这是本任务的全部工作量。**

**Houdini 的真实机制**（已实机验证，详见 `reference-registry-design.md`）：
不是求值时解析，而是**改名时推送重写**。它维护名字依赖登记表
（`parmsReferencingThis()` / `opdepend -N`），只重写**登记过的** `NodeReference`
参数；VEX 字符串、Python、拼接表达式一律静默失效——同一串路径在
`centroid()` 里被重写、在 VEX `point()` 里悄悄失效，判据是**登记**而非文本匹配。

**所以照抄登记制，不要扫描节点参数猜哪个像路径**——猜测正是 Houdini 明确不做的事，
也是它失效清单的来源。未登记 = 不重写，且这一点要在 UI 上说清楚，
而不是假装所有引用都保得住。

**接入点**：`NodeView.tsx` 的 `commitName` → `rewriteOnRename(old, new)`；
桥侧映射的 `rel`（`mapping.py` 的 entry）同样要跟随。

### 任务 #8：in/out 端口全面升级 + 桥接与映射系统统一

**目标**（用户原话要点）：
- in/output 节点 parm 加一个 string，**其余端口按每次更新 string 后实时生成**
- 端口类型**问桥接/映射系统**要
- 之前的 hda sop 与引用 tag 对齐，都走桥接映射系统，**两个系统统一**
- 数据类型 `geo` / `float` / `vec3`，端口颜色朱红 / 浅蓝 / 深绿
- 类型不符**直接报错**（红三角 + info 说明原因）
- `float → vec3` 自动转换（三分量都取该值）；`vec3 → float` 取第一个通道
- output 改 string 时 kick 映射桥接系统并注册；若已有映射通道指向，
  检查指向的 out 节点是否存在，否则报错让用户自己删
- Houdini 侧要 cook 某个映射通道的值时，直接执行并返回

**已就位（别重做）**：
- 端口配色：`socketTypeClass` + `.cyl-port-float/-vec3`；连线 `cyl-wire-float/-vec3`
- 类型校验：`canConnectSockets` + `canMakeConnection` 钩子拒绝错配
- 错误系统**已接通**：`findMultiSourceErrors` → `multiSourceErrorsToNodeErrors`
  → `setNodeErrors` → NodeView 红三角（在 `dataflow.flush` 里调用）
- 单端口 + address 形态：`makeInputNode(true)`，schema 4

**缺的**：address string 变化后按映射系统类型**实时重建端口**；
float↔vec3 自动转换；桥接与映射两套系统统一。

**已知坑**：
- `ADDRESS_GRAPH_SCHEMA = 4` 与 `PROJECT_GRAPH_SCHEMA = 3` 是两个独立常量，
  **别合并**（v3 = 项目图，v4 = 单端口 address 形态，语义不同）
- 端口重建**不能**破坏既有连线的缓存身份：`chain-cache` 签名由 `specs` 构成，
  改端口前先确认不会让整链失效
- 类型来源是桥侧 `MappingEntry.type`（`geo|float|vec3`），
  已在 `GET /api/projects/{pid}/mappings` 返回里

## 4 纪律（本轮踩过的，别重犯）

- **写文件超过 ~50 行会被静默截断**成 `...[N chars omitted]...`。本轮中招 6 次，
  其中 3 次写进了已提交的 devlog。**分块写，写完 grep 一遍 `chars omitted`**。
- **APEX 写入只在一次性副本节点上做**，绝不碰用户活动节点；
  绝不对 `animation` Data parm 调 `revertToDefaults()`（会清空整个场景）。
- **不要用 `hou.hipFile.load(..., suppress_save_prompt=True)` 清理自己的测试文件**
  —— 那会丢弃用户未保存改动。本轮因此丢了两个我自己建的节点。
- 加 HDA 参数走**就地 patch 定义**（`type().definition().setParmTemplateGroup`），
  别用 `build_hda.py` 全量重建（它开头就 `hipFile.clear()`）。
- 新增 bridge 模块/路由后**必须重启桥**（走 shelf `cyl1nder::reload_bridge`，
  不按 PID 杀进程）。
- pwsh 命令首个 token 必须是受信前缀（`git` / `node` / `.venv\scripts\python` 等），
  前面加赋值或 `Remove-Item` 会被沙箱拒。PowerShell **没有** heredoc。

## 5 现有限制（已知未解决，别当 bug 重新调查）

以下每条都是**已确认的现状**，不是待查问题。动手前先看这里，省一轮排查。

### 5.1 交互 / UI

| 限制 | 细节 | 状态 |
|---|---|---|
| dot 无法从自身拖出连线 | 锚点是 `pointer-events:none`（为保住 10×10 圆整体可拖，并避开 ±12px 反向命中区）。改接线仍可用几何 reconnect 层 | 待用户拍板；要支持需在 `graph.ts` 给 `getDOMSocketPosition` 自定义 `offset` |
| 可进入节点未禁用 | 用户要求「修好但暂不启用」，现仍启用 | 按要求保留 |
| 项目根节点无 hip 地址 | 任务 #6 | 未做 |
| 面板跟随选中已修，但 project/channel 无参数 | 选中它们时 Spreadsheet 给**空表**（刻意——显示别的节点几何更糟） | 已完成，符合预期 |

### 5.2 实时性

**`apex-ctrl` 没有推送通道。** 值的流动全靠：吊牌心跳（**60s** 节流）+ 用户显式
探测 + 分量写入时的 read-modify-write（每次都过 Houdini 主线程）。

后果：连续拖动 gizmo 驱动 APEX 控制器时的时序**从未验证过**——这是整条链上
唯一没在浏览器里跑过的部分。要做实时拖动得先设计推送，不是调参数能解决的。

### 5.3 清理

- `清理空项目` **只删 0 成员项目**。线上那批残留各持 1 个失效成员，够不着，
  只能逐行点删除。要一键清完需要新的「清理失效项目」（按成员通道是否还在
  `/api/channels` 判定）——这是**按启发式删用户数据**，我没擅自加。
- `POST /api/scenes/cleanup` 只删「无效」快照目录（空/缺件/meta 损坏）。
  测试产物有完整 `meta.json`，所以它一个都删不掉——本轮 970 个是手工清的。

### 5.4 被冻结测试锁住的两处设计妥协

这两处**不是随手写的**，改之前先读原因，否则会打破既有断言：

1. **`PROJECT_GRAPH_SCHEMA` 仍是 3，另加 `ADDRESS_GRAPH_SCHEMA = 4`。**
   `project-graph.test.ts` 有两条断言互相夹死：一条要求 project+channel 图等于该常量，
   另一条要求 null+channel 图字面等于 `3`，两者分类相同 → 任何 bump 都会破其中一条。
   最终语义是对的（v3=项目图、v4=单端口 address 形态），**别去合并这两个常量**。
2. **`makeInputNode()` / `makeOutputNode()` 默认仍是 4 端口**，单端口靠传 `true` 开启。
   有冻结测试直接连 `output.out1`，rete 会抛
   `target node doesn't have input with a key out1`。`buildGraph` 已传 `true`，
   所以**新图就是单端口**，语义达标；默认值是为兼容而反过来的。

### 5.5 数据现状（部分不可恢复）

- **`P1-msyiasx0-a2gf/graph.json` 的项目根结构已被覆盖**（成员图写进了项目槽位，
  根因已修）。原内容**不可知、无备份**，我没有伪造恢复——需要重建。
- `beginTest-1_recovered.hip` **保留未删**：与 `beginTest-1.hip` 的 SHA256 **不同**，
  所以不能断言它是冗余的。是否删由你定。
  （我一度说过两者「字节一致」，那句是错的——当时只比了几个节点名的出现次数。）
- 本轮的破坏性操作都留了备份，**都在 `bridge/data/` 下且已被 gitignore**：
  `snapshots-residue-backup-*.zip`（0.64 MB）、`registry.json.bak-*`、
  `projects.json.bak-*`、`mappings.json.bak-*`。确认无用后自行删。
- `sandbox_sceneanimate` 与 `apex_ctrl_tag` 是我重建的（新 serial
  `C1-msz03wf5-u0ym`）。它们是**测试用副本**，不是你的资产；
  你原来的 `sceneanimate1` 从未被碰过。

### 5.6 未验证 / 不要当已完成

- **多层 additive 动画层合成、层权重、`flattenedLayers()`** —— 历史遗留未验证项。
- **`Scene.writeToGeometry()` / 节点 `editanimation` 机制** —— 回写活动节点的替代路径，
  未单独验证（现行 `saveToGeometry` + 保留全部顶层 prim 的路径已验证零误差）。
- **web 端到端**：错误角标、类型化端口、waypoint 都只有单测与构建验证，
  **没有在浏览器里点过**。e2e 覆盖的是旧版面。
- 你节点上仍有我早期失败写入留下的**结构残留**（历史记录里提过），未清理。
