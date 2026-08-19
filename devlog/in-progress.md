# 进行中任务与剩余评估（v0.1.00118）

> 主进程写。本文件是**当前唯一的进度真相**：`next-round-plan.md` 是上一轮的交接稿，
> 与本文件冲突时以本文件为准。每条结论都标注了**验证方式**——写「已验证」的都在
> 代码/浏览器/磁盘上实证过，没验的一律写「未验证」。

## 0 本轮结论速览

| 项 | 状态 |
|---|---|
| bug A 双击缩放 | **已修，浏览器实证**（拦 `zoom` 管道的 `source === "dblclick"`；滚轮仍可用） |
| bug B Alt 生成 dot | **已修，浏览器实证**（白点渲染、连接数不变、线不进选中态） |
| dot 渲染不显示 / 连线断联 | **已修**（dot 改为连接装饰件 + 自绘连线组件） |
| Ctrl+dot 残留 | **已移除**（Ctrl 分支改 Alt，`insertDotAt` 删除） |
| dot NodeKind 清理 | **已完成**（见 §2） |

**不需要退回 Ctrl+dot。** 两个 bug 都在真实浏览器里验证通过，不是"单测过了就宣布完成"。

**本轮验证基线**：tsc 0 / vitest **582**（34 文件，原 579，+3 来自改写后的
`waypoint-neutral.test.ts`）/ `vite build` 通过 /
`waypoint-verify.spec.ts` **4 passed** / `round18-reconnect.spec.ts` **5 passed**
（后两项在 Edge 真实浏览器里跑，桥 8375 + vite 8376 均在线）。

## 1 dot 改造（本轮主线）

### 设计：dot 不再是节点，而是连接上的 waypoint

旧实现把 dot 做成真 `NodeKind`，插入 = 删 1 条连接 + 加 1 个节点 + 加 2 条连接，
并触发 `onNetworkChanged`。用户明确要求「dot 不应参与任何 cook 过程，它只是装饰符」，
旧实现与这条要求直接冲突：它进拓扑、要 cook 特例、删掉留两截半线。

现在 `waypoint` 是**连接的可选属性**（`ConnectionWaypoint {x,y}`）：
- 拓扑始终不变 → cook 完全不受影响，缓存身份（`chain-cache` 由 `specs` 构成）不变
- 连接永远是**一条**，不可能出现半截线
- 断联时连接本身消失，waypoint 随之消失，无需清理逻辑
- 无 waypoint 时**不输出该键** → 旧存档字节不变

已确认全部 `node-graph.json` 与项目 `graph.json` **没有任何存档含 dot 节点**，
所以无迁移负担，直接删而不是保兼容层。

### 为什么必须自绘连线

rete 自带 `Connection` 只认 `useConnection()` 给的 path，而 `classicConnectionPath`
签名写死两个点，塞不进中点。所以新增 `ConnectionView.tsx`，用
`waypointConnectionPath(start, end, waypoint)` 自己算 `d`，并在中点补 `<circle>`。

**DOM 契约（改动会静默打断十几处调用点）**：
- 根节点保留 `data-testid="connection"`：全部 CSS 与 `closest()` 靠它
- 连线本体必须是**第一个 `<path>` 后代**：`graph-interact` / `graph-model` / `graph`
  共 14 处 `view.element.querySelector("path")` 拿它加类并调
  `getTotalLength`/`getPointAtLength` 做命中测试
- 所以圆点用 `<circle>` 且排在 path 之后，**绝不能是第二个 `<path>`**
- 接管渲染后，原本由 rete `styled.svg`/`styled.path` 提供的基础样式必须逐条补齐
  （9999px 画布、`fill:none`、`stroke-width`、path 上的 `pointer-events:auto`）——
  少一条，连线的 hover 与命中测试就废

### 配色

圆点颜色走**兄弟选择器**跟随线本身的类型类，不在组件里重复
`applyConnectionTypeVisual` 的类型查表（那是线色唯一真源，复制必然跑偏）：
未接类型 = 白色，`cyl-wire-float` → 绿，`cyl-wire-vec3` → 蓝。

geo 线上的点**取白色**而非 `#ff6b6b`：同色点压在同色线上只剩描边可见，
等于没有把手；且旧 `.cyl-rp-dot.unwired` 已确立「未定类型 = 中性白」的约定。

### Alt 手势

`Alt + 左键`点线生成 waypoint，拖动跟手，甩远（112px = 命中半径 14px × 8）删除。

关键顺序：Alt 分支**必须在 `trackedConnId` 赋值之前**拦截——这是「不出转接预览、
线也不进选中态」的全部原因。另一处 `clearConnectionSelection` 处理器**保持忽略 Alt**，
否则会在生成 waypoint 的同时把线的选中态清掉。

**Alt 从未被浏览器或系统屏蔽**，是我们自己的处理器在 `if (e.altKey) return` 忽略它。
所谓「alt 键屏蔽问题」不存在，改个条件即可。

### 实测踩到的真 bug（单测看不见）

`pointermove` 监听挂在 `container`（图面板元素）上而非 window，所以指针一离开面板
就收不到事件：20 步的甩动只有 3 个 move 到达，距离永远够不着阈值，甩远删除**不触发**。
既有 reconnect 手势没暴露这问题，因为它在 `pointerup`（window 级）上确认。

这条只有在真浏览器里拖过才会发现——**「tsc 0 + vitest 全绿」不构成 UI 验证**。

## 2 dot 收尾（已完成）

`dot` NodeKind 已删干净：`NodeKind` 联合类型、`makeDotNode` / `dotSeq` /
`claimDotLabel`、`network.ts` 的 dot passthrough、`undo.ts` 的 `dot-add` 变体、
`graph-undo.ts` 的整个 `dot-add` 分支、`NodeView` 的 dot 渲染分支与配色助手、
`.cyl-rp-dot` 全部 CSS（-85 行，花括号平衡已核）。

保留（同名不同物，别误删）：`getConnectionWaypoint`/`setConnectionWaypoint`、
`circle.cyl-wp-dot` 样式、`.cyl-channel-dot`（通道面板）、dot-grid 背景。
`nodeview.css:303` 还有一处 `.cyl-rp-dot` 字样，是解释新圆点描边由来的**注释**，
不是活规则。

### 两个测试已改写为验证新性质

- `dot-neutral.test.ts` → **`waypoint-neutral.test.ts`**。旧测试靠 `as NetworkSnapshot`
  强转塞一个 `kind:"dot"` 节点，所以 `"dot"` 移出联合类型后它**照样编译通过、
  照样全绿**——已经在验证一个不存在的行为。新测试驱动真实 `NodeEditor`，验证
  结构层面的不可能出错：快照逐字节一致、`computeOutputs` 逐字节一致、
  `traceChainSpecs` 的 `specs` 不变（= `chain-cache` 签名不变）、连接数恒定、
  compute 快照上根本没有 `waypoint` 键。
- `round18-reconnect.spec.ts` 的 `Ctrl+click splices a _dot_` → **Alt+click 产生
  waypoint**：断言连接数**仍是 3**（不是 4）、原边仍端到端、无 dot 节点、
  且 waypoint 挂在那一条连接上。

**教训**：`as` 强转会让类型删除静默失效。删联合类型成员后，别信"测试还绿"，
要去看测试里是不是用强转绕过了类型检查。

## 3 剩余任务评估

优先级按「解锁其他任务的程度 × 用户可感知度」排，不是按编号。

### 已完成（本轮核对过，别重做）

| 任务 | 结论 | 验证方式 |
|---|---|---|
| #1 快照目录 `<场景名>_<serial>` | 已实现 + 自动迁移 + 旧目录读取兜底 | 磁盘实证：`beginTest-1_C1-msm6dsp7-ob6t/` 存在 |
| #2 save 后 load 变默认场景 | **根因已修**：成员图写进了项目槽位（`graph-scope.ts` 显式建模图归属） | 读 `graph-scope.ts` 的事故复盘 |
| #3 面板跟随选中 | 已实现，display flag 仅作首次兜底 | 读 `main.ts:807-861` |
| #5 overview 已换绑徽标残留 | 已修：加时效窗口 | 读 `overview.ts:219-239` |

**#1 的遗留**：同一 serial 现在有**两个**快照目录（新名 + 旧名），因为迁移遇到
`skipped:target-exists` 就不动。写入落在新目录（实证 mtime 20:30 vs 旧 19:40），
读取有兜底所以不出错，但旧目录是**残留**，需要清理策略。另有一个孤儿目录
`beginTest-1_C1-msm006pg-8fz7` 不在注册表里。

### 未完成

**#4 obj/sop 层级 + 双击进入 + 改名 UI** —— 工作量最大，且是其他任务的前置。
- 现状：`NodeKind` 全平铺，**没有层级概念**；进入成员靠 channel 的 display chip 而非双击
- bug A 是它的前置，**已修**，双击现在可以安全定义为「进入节点」
- 建议给节点加 `netKind`（`obj` | `sop`），而不是继续往 `NodeKind` 堆
- 必须接到已有的 `app/graph-scope.ts` 上，**别引入第二套状态**——本轮的数据丢失事故
  正是「用 `currentProjectId` 推断图归属」造成的
- 用户还要求：新场景直接进 `/P1-…`，下面**不自动创建**任何节点

**#6 项目根节点显示 hip 绝对地址** —— 最小的一条，建议先做。
- `makeProjectNode(id, label, x, y)` 目前**没有 hip 参数**（已核对签名）
- `ProjectRef` 已有 `hip`/`hipName`，协议三处已同步 → 只需传进来 + 渲染副标题
- 省略**必须**用 `app/elide.ts` 的 `elide()`，完整值进 `title`（`development-standards.md`
  第 58 行铁律：砍尾会把两个不同 serial 显示成同一个字符串）

**#7 地址系统相对引用自动更新** —— 模块已建好但**没接线**。
- `ref-registry.ts` 已实现登记表 + 边界安全重写 + `audit`/`auditRename` 预览（36 例测试）
- 但**全仓库没有任何文件 import 它**，`NodeView.tsx` 的 `commitName` 也没调
  → 接入 `commitName → rewriteOnRename` 就是这个任务的全部工作量
- 照 Houdini 的**登记制**：改名时推送重写，只重写登记过的引用；
  不要扫描参数猜哪个像路径——猜测正是 Houdini 明确不做的事
- **附带地址栏 bug（已定位根因）**：`setChannelDisplayHandler` 先把
  `graphScope` 设成 member 并立即刷地址栏，而图的替换在 `activateSession` 里另行发生。
  地址是**乐观更新**的，所以图没切过去时地址栏已经变了。修法是等图切换落地后再刷地址。

**#8 in/out 端口升级 + 桥接与映射系统统一** —— 范围最大，建议拆多轮。
- 已就位：端口配色、`canConnectSockets` 类型校验、错误红三角链路、单端口 address 形态
- 缺：address string 变化后**实时重建端口**；float↔vec3 自动转换；两套系统统一
- **发现一处配色与需求不符**：用户要求 float=浅蓝、vec3=深绿，
  现有实现是 float=绿 `#7ce3a8`、vec3=蓝 `#7fb0ff`，**两者是反的**。
  动 #8 时要先确认按哪个改——改配色会同时影响线色、端口色与 waypoint 圆点色（三处联动）
- `canConnectSockets` 目前要求**类型严格相等**，所以 float→vec3 今天是被直接拒绝的，
  自动转换确实未实现
- 别合并 `ADDRESS_GRAPH_SCHEMA = 4` 与 `PROJECT_GRAPH_SCHEMA = 3`（语义不同，
  且有两条冻结断言互相夹死）
- 端口重建不能破坏既有连线的缓存身份（`chain-cache` 签名由 `specs` 构成）

## 4 纪律（本轮新增）

- **UI 改动必须在浏览器里验证**。本轮的 fling bug（`pointermove` 挂 container 而非
  window）在 tsc 0 + vitest 579 全绿的情况下依然存在。既有 e2e 全部依赖活桥、
  桥没起就整体 skip，于是纯前端渲染问题永远验不到——新增
  `web/e2e/waypoint-verify.spec.ts` 时刻意让它只依赖 `__cylGraph`。
- **e2e 取线上的点之前必须先 fit**。不 fit 时线的中点会落在视口外（实测 x=1591,y=1001），
  鼠标根本碰不到，测试会以"取不到点"的形式假失败。
- **`locator.dblclick()` 在本项目不可用**：dockview 的 `.dv-void-container` 覆盖层
  会让 Playwright 的 actionability 检查永远判定被遮挡。用 `page.mouse.dblclick(裸坐标)`。
- **桥重启走 `hda/scripts/bridge_control.py` 的 `restart_bridge()`**（按端口 8375/8376
  精确定位，不按 PID 杀）。该文件不在 Houdini 的 import path 上，要用
  `importlib.util.spec_from_file_location` 按路径加载。
- **pwsh 首个 token 必须是受信前缀**（`node`/`npm`/`git`/`.venv\scripts\python`）；
  以 `Set-Content`/`Remove-Item`/赋值开头会被沙箱拒。PowerShell **没有** heredoc。
- **`npx --prefix web` 在管道下会报 `$LASTEXITCODE` 未设置并吞掉输出**；
  跑 playwright 直接 `cd web ; node node_modules/@playwright/test/cli.js`。
- 写文件超过 ~50 行会被静默截断成 `...[N chars omitted]...`，分块写完 grep 一遍。
- **注释里写 `*/` 会提前终止 JSDoc 块**。本轮实例：在 `/** */` 里写
  `cyl-wire-*/drop-target` 直接产生 33 个解析错误。要列举类名模式时写成
  `cyl-wire-x / drop-target / reconnect-x 等`，别用 glob 星号紧跟斜杠。
- **`useConnection` 不在 `rete-react-plugin` 包根导出**，只能取
  `Presets.classic.useConnection`（与 `NodeView.tsx` 取 `RefSocket` 同款写法）。
  按直觉写 `import { useConnection } from "rete-react-plugin"` 编译不过。
- **`git` 也是受信前缀，但 PowerShell 没有 heredoc**：写多行中文 commit message
  用 `write` 工具落到文件再 `git commit -F <file>`（放 `bridge/data/` 下，已 gitignore，
  提交后删）。`git commit -F - <<'EOF'` 会被 PowerShell 解析器直接拒。
- **编辑工具会连带吃掉 UTF-8 BOM**。本仓库 `web/src` 是 BOM 混用状态（12 有 / 56 无），
  改一行版本号却出现 `-\uFEFF...` 的首行 diff 就是它。功能上无害，但会把
  「纯删除」的 diff 污染成看不清的改动——提交前用
  `foreach($f in (git diff --cached --name-only)){ ... "^-\uFEFF" ... }` 扫一遍并补回。
