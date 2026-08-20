# Shift+Enter 自动接线（`_input_` → `_output_` 镜像）

选中若干 `_input_` 再选 `_output_`，Shift+Enter 把 serial **逐字抄过去**、端口配对、
一一连线，新建的 output 摆到右侧。绝不新建你没要的节点，绝不删已有连线。

用户原话：「选择状态在 input 上而且我 tab, 选择到 output, 此时 shift + Enter,
output 可以自动同步当前选择的 n 个 input 并且在后面填入相同的序列号, 端口一一连接」。

版本：v0.1.00131（实现）· 00132（撤销）· 00144（防拖散 e2e）· 00149（面板刷新 e2e）。
过程记录见 `in-progress.md` §-19 / §-24。

---

## 四个会被后人重新争论的决定

### 1. 配对是「首次匹配扫描」，**不是下标对应**
子智能体先写的是按下标配对，重读用户原话「**找第一个匹配的连接**」后改掉了。
现在：input 按**视觉顺序**（y 再 x）逐个处理，每个都在剩余候选池里顺序扫描、
取第一个类型合得上的 output，**用掉即移除**。

- 同类型的常见情形：第一个就匹配 → 退化成"上面接上面"，与下标对应等价；
- 混类型：跨过合不上的继续找 → 接上的线严格更多，且顺序扫描 + 用掉即移除
  天然不会交叉。

**被拒的一对不推进 output 游标** —— 否则一次不匹配会把后面全部错位一格（有专门测试）。

> ⚠️ 子智能体最后一份报告里仍写着"pairing is by index, not by name" —— 那是**它自己
> 后来推翻的**旧设计。以代码（`graph-interact.ts` 的 `planShiftEnterWire` 注释）为准。

### 2. `port` 参数是 **serial 的逻辑端口**，永远不是 rete 的 socket key
单端口形态下 socket key 恒为 `in0`/`out0`，而 `port` 参数存的是 `in2` / `transform1/tx`
这类逻辑名。实现时曾把 `sourceOutput` 取自 `port`，那会连到一个**不存在的 key**。
不变量由「socket key 恒为 in0/out0」那条测试钉住。

### 3. `layout` 由调用方给，不由函数自己决定
`area.translate(id)` 会发 `nodetranslated`，若该 id 是**被 pick 的**节点，
rete 的 selectableNodes 管道会把**其余所有选中节点**按同一位移搬走。
而 `accumulateOnCtrl()` 意味着 Ctrl+click **既 pick 又累加** —— 窗口路径下用户点中的
那个 `_output_` 正是被 pick 的那个，一次镜像就能把他排好的全部 `_input_` 拖散。

- **palette 路径 `layout = true`**：节点刚 `addNode`、位置还没人选过，本就该摆；
- **窗口路径 `layout = false`**：位置是用户选的，我们无权动。

这同时是更对的产品行为（"整理插入位置"只适用于刚建的节点），不只是更安全。

### 4. 与视口 Enter 的隔离在**按键层**，不靠监听器顺序
`shortcuts.ts` 的 Enter 分支加了 `if (e.shiftKey) return;` —— Shift+Enter **结构上
不可能**落进 Enter 分支。两个监听器都挂在 `window` 上，靠注册顺序或 `stopPropagation`
会在将来某次重构里失效。

---

## 验证方式

| 断言 | 覆盖 |
|---|---|
| 纯规划器（配对/跳过/不合格 output/摆位） | `web/tests/shift-enter-wire.test.ts` 24 例 |
| 窗口路径**不移动**任何已摆好的节点 | `web/e2e/round23-shift-enter.spec.ts` |
| 镜像后 param 面板显示新 serial | 同上第二条 |
| 撤销（Ctrl+Z 删掉刚接的线） | 实机 `freed=1 → afterWire=2 → afterUndo=1` |

两条 e2e 都做过**变异测试**（把被测行为改回旧版，确认测试会红）：
- `layout = true` 于窗口路径 → 四个节点坐标全变、测试红 ✅
- 去掉 `notifySelection()` → 测试**仍绿**：面板其实由 v0.1.00131 接的
  `setApplyNodeParamsHandler → api.setNodeParams` 通知，那行**不承重**。
  保留它当廉价保险（那个 handler 本就是"可选的前门"）。

### 写这两条测试时踩的坑（都被反向断言抓住）
1. 只断言"坐标没变"会在**功能整体失效**时也通过 → 必须配 `expect(wired).toBeGreaterThan(0)`；
2. 合成 serial 在桥里没有能力清单 → 规划器如实拒绝（`port in0 has no counterpart`），
   夹具要先 `pushInputs` 给它真实端口；
3. 夹具写 `type:"float"` 但端口类型由 serial 的**真实能力**派生 → output 侧成了 `geo`，
   `canConnectSockets` 正确拒了跨族连线。夹具自相矛盾，不是功能有错。

**只断言"没有变化"的测试，在功能整体失效时也会通过。** 每条这样的断言都要配一条反向断言。

---

## 监听器不会叠加（已核实，无需去重守卫）

`attachShiftEnterWire` 在 `attachTabSearch` 里注册了一个 `window` keydown。
若图会被重建，叠加的监听器会导致**一次按键做多次镜像**（这个手势会改图，比 Tab 面板严重）。
核实过不会发生：`createReteGraph` 只有一个调用点（`main.ts` 顶层 `await`，结果赋给模块级
`const graph`，不在任何可重入函数里）；`graph.ts` 的 `destroy()` 存在但**无人调用**，
没有 teardown/rebuild 循环。

同一条也保证了「旧 4 端口 output 被写坏」那条路是**构造上**关闭的：规划器在配对**之前**
就把不合格 output 滤掉，`pairs` 只可能引用可用 output —— 不靠运行时检查。

## 仍未做

- **n 对 n 是刻意的**：`_output_` 自 v0.1.00121 起是单端口（只有 `out0`），
  所以「一个 output 吸收 n 个 input」形状上不成立。选 n 个 input + n 个 output，
  或重复手势 n 次。用户已确认要这种。
- palette 路径新建节点**不进撤销栈**（与既有 palette 建节点行为一致）。
