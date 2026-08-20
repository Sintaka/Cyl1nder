# 进行中任务与剩余评估（v0.1.00134）

> 主进程写。本文件是**进度与计划的唯一真相**——原 `next-round-plan.md` 已并入本文件
> 并删除（用户要求：不塞多个文件，以免浪费 token）。每条结论都标注了**验证方式**：
> 写「已验证」的都在代码/浏览器/磁盘上实证过，没验的一律写「未验证」。

## -9 图外 `ch()` 引用（v0.1.00133，**实机三行日志为证**）

`ch("../transform1/tx")` 指向的东西**不在 web 图里**时（web 图只有用户手搭的那几个节点，
Houdini 场景里绝大多数节点没有对应物），此前直接返回 undefined。现在补上读侧：
`client.getMappingValue` + `collectExternRefAddresses`（只收真的图外的，图内兄弟已能
同步解析）+ 预取填缓存 + 解析器收一个**注入的同步查表**。

**为什么预取而不是让解析器 await**：`resolveWritebackValue` 跑在同步热路径（每帧 flush），
改成异步会让整条取值链变成 Promise 且顺序不可预测。预取把「异步」限制在一处。
而预取本身**不能 await**（这条读实测 15.2s，await 会把每帧 flush 卡死），改成即发即忘 +
in-flight 去重 + 值到了自己调一次 `scheduleWriteback`。

取不到一律**不写进缓存** → 解析器查不到 → 这次不写。绝不塞 0 占位：
那会把「读不到」变成「值是 0」，静默清零用户参数。dict 形状（APEX ctrl 的 `{ctrl,t,r}`）
如实记一条日志跳过。

**实机（三行按序为证）**：
```
停止重试 transform1/t：… 单个数值 2                      ← 修前（字面量）
图外引用就绪 sandbox_sceneanimate/point_1/ty = 0.150023   ← 图外读到了
停止重试 transform1/t：… 单个数值 0.150023                ← 解析器用上了它
```
第 3 行的拒绝是**正确行为**：float 源进 vec3 端口本就该被拦。

### 让我定位到 bug 的那个小改动
拒绝消息原来只说「引用给出的是单个数值」，于是「取到了 0.150023」与「其实还是字面量 2」
**长得一模一样**。加上实际值后一眼看出是 `2`。**看不出区别的日志等于没有日志。**

## -8 参数读从 15.3s 降到 1.1s / 85ms（v0.1.00134，**实测**）

排查「图外 `ch()` 引用不生效」时撞到的，价值远超原问题 —— 这条读在**写回、param 面板、
端口下拉**上都在用。

### 根因：陈旧锚点 pid 触发 16 端口徒劳扫描
Houdini 重启后，**未重新 cook** 的吊牌其锚点记录还是旧 pid（心跳只在 cook 时发）。实测：

```
C1-msz03wf5-u0ym  pid=28720  mcpPort=8100   ← 陈旧（重启前）
C1-mt09nkms-bwxp  pid=57720  mcpPort=8100   ← 当前（我手动 cook 过）
探 8100..8115 → 15.2s，只有 (8100, pid 57720) 活着
```

每次读：探记录端口 → pid 不符 → 扫 16 端口找**已不存在**的 28720 →
`health()` 默认 1.0s × 16 = 16s，与实测 15217/15271/15286ms 吻合。

### 两个叠加的修法
1. **失败短缓存**（30s）：「扫空」是稳定结论，不必每次读都重新证明。
   **命中从不缓存** —— 端口在实例重开后会变，命中必须现探（与 dev 规范一致）。
2. **并发扫描**：16 次探测彼此独立，串行毫无必要。最坏耗时 ≈ 单次超时。
   判据一字未改（仍只认 `health.pid == expected_pid`）；并发只改「多快问完」，不改「信谁」。
   取**最小端口**让结果可复现，否则线程调度顺序会让答案每次不同。

```
首读 15324ms → 1139ms    重复读 → 84ms
```

### 一个绿测试掩盖的错误
写完 `_find_port_by_pid_cached` 时**忘了 `import time`**，而 416 个测试全绿 ——
没有一条测试走这条路径。若不是顺手 grep 了 import，这会是运行期 NameError。
补了 5 例测试。**「测试全绿」不等于「代码被执行过」。**

## -7 Shift+Enter 自动接线（v0.1.00132，**浏览器实证两条路径 + 撤销**）

用户原话：「选择状态在 input 上而且我 tab, 选择到 output, 此时 shift + Enter,
output 可以自动同步当前选择的 n 个 input 并且在后面填入相同的序列号, 端口一一连接」。

### 两条路径都实测过
| 路径 | 实录 |
|---|---|
| palette（用户原话那条）：选 input → Tab → 选 output → Shift+Enter | `paletteOpen=1` 节点 4→5（现建 `_output_2`）、连线 2→3，新 output 拿到 `address=C1-… type=vec3 port=transform1/t` |
| palette 关闭：已选中 input + output | 腾空前 `kept existing wire … mirrored 0`；腾空后 `wired _input_ -> _output_` 、连线 1→2 |
| 撤销 | `freed=1 afterWire=2 afterUndo=1`，日志 `undo shake (0 cut / 1 added)`；撤销后项目图两条连线完好 |

### 配对规则（子智能体中途改对的那条）
它先按**下标**配对，重读用户原话「找第一个匹配的连接」之后改成**按序扫描剩余候选池、
取第一个类型合得上的、用掉即移除**。同类型时退化成下标对应；混类型时能多连出若干条
且不交叉。**被拒的一对不推进 output 游标** —— 否则一次不匹配会把后面全部错位一格。

### `_output_` 是单端口，所以是 n 对 n（用户已确认这是他要的）
`makeOutputNode(singlePort)` 只有 `out0`（v0.1.00121 起），所以「一个 output 吸收 n 个
input」在形状上不成立。选 n 个 input + n 个 output（或重复手势 n 次）。
用户 2026-08-20 明确回答：**就要现在这种 n 对 n**，不改多端口。

### 撤销为什么用模块级 setter
`undoManager` 要从 attachTabSearch → startShiftEnterWire → runShiftEnterWire 穿三层签名，
三个签名都会被这一个功能污染。本文件已为 `setApplyNodeParamsHandler` /
`setRenameHandler` 立了同一模式，照它做。复用既有 `shake` action
（`cut: []` + `added: [...]` = 只加了线），不新造 action 类型。
两条防谎报：**只记 `addConnection` 返回 true 的线**（记被拒的线会让 Ctrl+Z 去删不存在的线）、
**接了 0 根不推条目**（推空条目会让用户按一次 Ctrl+Z 什么都没发生，比没有撤销更困惑）。

### 探针教训：选择态在 `node.selected` 上
我在「怎么选中两个节点」上失败了**五次**（Ctrl+click 是替换而非累加、`selectable`
不在公开 api 上）。真相在 `graph-interact.ts` 的读法：多选没有别的 API，就是
`editor.getNodes()` 过滤 `node.selected`（`graph.ts:1035` 的 frameSelection 同款）。
**该早点读代码，而不是连试五次点击方式。**

## -6 vec3 通道打通（v0.1.00131，**实机验证，distinct 值**）

用户把吊牌 entries 从 `tx` 改成 `t`，但 Cyl1nder 仍识别成 float。三处都要改：

**1. HDA 侧硬编码 float。** `cyl1nder_tag.py` 的 parm 分支恒返回 `"type": "float"`。
判据应当是 **parm 与 parmTuple 的互斥**（实测 `/obj/geo1/transform1`：
`parm("t")->None` 而 `parmTuple("t")->size 3`；`tx` 恰好相反）。修后 `t -> vec3`。

**2. vec3「写得进、读不出」。** `parameters.get_parameter` 走 `node.parm(name)`，
元组参数取不到，读 `t` 报「Parameter 't' not found ... Did you mean: tz, ty, tx」；
而写走 `set_parameter` 收列表所以成功。那个工具属于官方 fxhoudinimcp，不改它 ——
在桥侧按分量兜底拼（`t` → `tx`/`ty`/`tz`），缺任一分量返回 None 而**不补 0**
（两个分量拼出的位姿是错的，比读不到更坏）。

**3. web 图里没有 `t` 这个参数。** `planVecGroups` 的 vec3 只是**显示层**分组，
数据仍是三个 float。所以 `ch("../transform1/t")` 必须由取值侧把三分量拼起来 ——
这就是用户要的「属性系统自动处理 vec3 关系」，写在取值侧而不是让用户改写成三条引用。

**实机（distinct 值，不是 [0,0,0] 那种弱证明）**：web 侧设 tx=7 ty=8 tz=9 →
null 引用框先填标量 `2`（被拦下，原因可读）→ 改成 `ch("../transform1/t")` →
自动重试推 `[7,8,9]` → Houdini `parmTuple("t")` = **(7.0, 8.0, 9.0)**。

### 退役过时注册条目（用户 #2）
根因是**注册只有 upsert、心跳只 touch、谁都不负责删** —— 吊牌每改一次 entries
就留下旧行。心跳新增 `names`（本次声明的全部 rel），桥据此扫**两份账**：
`channels` 的行 + `mappings` 的条目。只扫前者的话映射条目还在，端口下拉里仍看得到
过时逻辑名（实测撞到）。`names` 缺省或空集 → 什么都不删（空列表与「声明了空集」
必须区分，否则一次异常解析会清空全部条目）。

**连带教训**：退役注册条目会让**已存图产生悬空引用** —— 用户存档里的
`_output_`/`_input_` 仍指向被我退役的 `transform1/tx`。清理注册表时必须同时看一眼存档。

### 我自己修错一次的地方
写回的「拒绝」集合我先按 `graphVersion` 清。**那是错的**：graphVersion 只在
connectioncreate/remove 与 nodecreate/remove 时自增（graph.ts:599），**改参数不算**，
而这里的拒绝几乎总是改参数就能修好 → 等于永不重试（探针实测：填对 `ch()` 之后仍然
只看到旧拒绝日志）。改成 `Map<key, 被拒时的值>`：值变了就再试。

## -5 通道函数引用 `ch()`（v0.1.00130，用户提议，**已落地并实机验证**）

用户提议引用框照 Houdini 写 `ch(../transform1/tx)`，并指出 `../` 的含义是「先跳到 null
所在那一层，因为参数属于节点里面一层」。**这个语义他说对了**，我实测确认。

### 实测（`/obj/vexref_probe`，两个 xform 兄弟节点，HScript 参数表达式）

| 写法 | 求值 | 含义 |
|---|---|---|
| `ch("../transform1/tx")` | **3.75** | 成功 —— `../` 跳到节点所在网络 |
| `ch("transform1/tx")` | **0.0** | **裸形式在 Houdini 里根本不解析**（会去找子节点） |
| `chf("../transform1/tx")` | **0.0** | **`chf` 不是 HScript 函数**，只存在于 VEX |
| `chs("../transform1/tx")` | 3.75 | 成功 |

另外 `hou.exprLanguage` 只有 `Hscript` / `Python` —— **参数表达式没有 Vex 这个选项**，
VEX 的 `ch()` 只在 wrangle 里。所以「参数栏的 ch」与「VEX 的 ch」是两个同名函数。

### 两处因此必须显式对齐（否则同一串字在两个系统里含义不同）

1. **我们的裸 `transform1/tx` 是自己的历史写法**，不是 Houdini 写法。它是**网络相对**的，
   等价于 Houdini 的 `../transform1/tx`。既有图里全是裸的，所以**继续支持**。
2. **在 `ch(...)` 里必须写 `../`**。写裸的直接报错并给出正确写法 ——
   静默当成网络相对会让用户以为 Houdini 也这么认，那是最难查的一类坑。

`chf` 我们**接受**当 float 别名（用户会照 VEX 习惯写，在这里报错毫无价值）；
`../../` 报错而不是当成一层（映射系统的 rel 以「锚点所在网络」为基准，没有更上一层的
表示法，静默折叠会指向错误节点）。

### 取值：本图内同步解析
`ch("../<节点标签>/<参数名>")` 指的是同网络的兄弟节点，而那些节点就在 snapshot 里，
所以**不必打桥、不必 await**（flush 是同步热路径）。解析不到 → `undefined` =
这次不写，**绝不兜底写 0**。

**实机**：null 的引用框填 `ch("../transform1/tx")`（走真实 param 面板打字），
浏览器实录 `[writeback] transform1/tx = 6.5`，Houdini 里 `/obj/geo1/transform1.tx` = 6.5。

**探针教训**：`__cylGraph.setNodeParams` 这个 debug hook **不通知 store**，
所以 `flushStoreView → scheduleWriteback` 不会跑。第一版探针因此看到「值都对但没有推送」，
我一度以为解析失败。测「改参数会不会触发下游」必须走**真实 param 面板**。

## -4 写回全链路已通（v0.1.00129，**实机验证**）

`null1.ref_slot0 = "2"` → web 侧自动解析并推送 → 桥 → **Houdini 里
`/obj/geo1/transform1.tx` = 2.0**（从 Houdini 直接读，不是读桥的回显）。
浏览器实录：`[writeback] transform1/tx = 2`。

三处缺口，最要紧的是**我自己留的**：v0.1.00125 那道「读写同名 → 409」守卫，
在 v0.1.00126 按用户 A/B 实测改成 wrangle 语义之后就成了残留，实测正是它把
`transform1/tx` 的写回打成 409。**416 个测试没有一条断言过那个 409** ——
未被测试覆盖的行为，只有删掉时才会发现它还在拦人。

链路组成（都已落地）：
- `client.putWritebackTarget/deleteWritebackTarget` — `_output_` 改目的地时登记指针；
  目的地填不全 → **删指针**（「清空」与「从未设过」语义必须一致，否则桥一直等
  一个不会来的写回）。
- `pushWritebackOnce`（去抖 120ms、latest-wins）— 只推**变化过**的值
  （反复写同值会刷掉用户在 Houdini 的撤销栈）、算不出值就跳过（**绝不兜底写 0**）、
  成环被拒**不重试**（环不会因为再发一次消失）。
- 桥侧 cook 回落：没指针就把 input 原样搬回给 HDA；tag 一律短路（吊牌是标记设计）。

**仍未做**：`resolveWritebackValue` 只认「数字字面量」与 transform 的 tx/ty/tz。
填**相对地址**（`transform1/tx`）当引用源还不会取值 —— 那需要向桥读值、是异步的，
而 flush 是同步热路径。这条单独做。

## -3 wrangle 语义实测（v0.1.00126，桥的读写模型就照它建）

用户提出「桥自动处理 input/output，学 VEX：输入不会在执行中改变，输出统一推到最后」。
他给的例子是 `vector t1=@P; @P=value2; vector t2=@P;`，并说 t1 与 t2 都是原值。

**我在真 Houdini 里测了**（grid 4 点 + attribwrangle，跑完即删）：

```
vector t1 = @P;  @P = set(99,99,99);  vector t2 = @P;
v@probe_cross = point(0, "P", (@ptnum+1) % @Numpt);
```

| 观测 | 结果 | 含义 |
|---|---|---|
| `t1` | `(-1,0,-1)` 各点原值 | 读到输入 |
| `t2` | **`(99,99,99)`** | **同元素的写，自己看得见** |
| `probe_cross` | 每点都是 `(-1,0,-1)` | **跨元素读看到输入快照** |

### 更正：**取决于写法，两种机制**（用户的 A/B 实测，`execting_test1/2`）

我上面那条「他的细节说反了」**是我错了** —— 我只测了 `@P`（绑定属性）就下了通用结论。
用户用两个 point wrangle 做了干净的 A/B：同一段代码，只换写入方式。

| 节点 | 写法 | t1 | t2 | 最终 P |
|---|---|---|---|---|
| `execting_test2` | `v@P = {4.4,5.5,6.6}` | `1.1,2.2,3.3` | **`4.4,5.5,6.6`** | `4.4,5.5,6.6` |
| `execting_test1` | `setpointattrib(0,'P',0,…)` | `1.1,2.2,3.3` | **`1.1,2.2,3.3`** | `4.4,5.5,6.6` |

最终 `P` 相同，`t2` 不同。所以是**两种写入语义**：

- **绑定属性 `v@P`**：写进**本元素的局部寄存器**，同一趟里后续读**立刻看得见**，
  元素跑完才提交。
- **set 类函数 `setpointattrib`**：**几何级排队写**，整趟跑完才落地，
  期间任何读（**包括自己这个元素**）都看不到 —— 用户记的「setpoint 是不行的」正确。

**对桥的意义**：`CookTxn` 的两个读方法**恰好对上这两种机制**，不用改实现，只需明确对应：
- `read()`（快照，看不到本趟写）= `setpointattrib` 语义 → **写回 Houdini 参数走这条**。
  参数写回本质是"几何级/场景级"的副作用，让它对本趟不可见才不会自我影响。
- `read_own()`（看得见自己的写）= `v@P` 语义 → 仅当同一个写者要复读自己刚写的值时用。

**默认必须是 `read()`**：跨节点读一律快照，否则计算结果依赖求值顺序。

搬到桥上就是 `cook_txn.py`：`read()` 冻结输入快照、`read_own()` 看得见自己的写、
`write()` 只记账、`flush()` 末尾统一落地（按名排序、值未变则跳过、单条失败不连累其余）。

**连带结论**：v0.1.00125 那条「读写同名 = 环，拒绝写入」**判错了**。在 wrangle 语义下
`t1=@P; @P=v` 恰恰是合法形状。所以 `cook_cycle.py` 降级成**诊断**
（`GET /api/projects/{pid}/cook-cycles` 仍可查，UI 可提示「本趟结束后才生效」），
不再挂在写入口上拦人。执行顺序的保证移到 `cook_txn.py`。

**写回目标不限于 HDA**：用户明确「还不一定是通过 hda 传回去, 也可能是 python runtime」
（APEX / Scene Animate 没暴露常规接口）。所以 `CookTxn` 的 reader/writer 是**注入**的，
本类不认识 HTTP 也不认识 Houdini —— 将来换 python runtime 写回不用改它。

## -2 v0.1.00124 三个自伤教训（**同类改动前先读这节**）

一天内我用三种方式把同一件事做错，都是「删掉一个概念时顺手删多了」。

**1. 删「按 serial 寻址」时把「按 serial 取数据」也删了 → 76 个 e2e 全挂。**
把 `?project=&member=` 分支改成只进项目根、不激活会话，于是没有 `hello`、
`session.ts` 永不 `setStatus("ok")`、几何永远不来。
**判据**：serial 有两种身份 —— 页面地址（该删）与 WS 数据通道（本来就该按 serial 走，
`client.ts` 的 `ws?serial=` 从来没动过，正是同一个道理）。

**2. 自己拼步骤绕开既有入口函数 → 只做了一半。**
用 `enterProjectMode + activateSession` 代替 `enterMemberWorkspace`，结果
`#cyl-serial` 是空的（探针实录 `input="" store="C1-…"`）：会话对、store 对，
但**画输入框那一步在 enterMemberWorkspace 里**。
**判据**：已有一个函数干这件事时，复用它再覆盖差异那一步，别重拼一遍。

**3. 拿 `graphScope` 去实现「地址显示」→ Ctrl+S 不再保存。**
把 scope 改成 `project` 让地址变短，`canWriteProjectGraph` 随之变真，
Ctrl+S 走进「保存项目图」分支、**再也不发 snapshot PUT**（5 个 e2e）。
**判据**：`scope` 回答「该写哪个槽位」，`address` 回答「给人看什么」。
这正是 `graph-scope.ts` 头部那场事故的形状，我又踩了一次。

**排查方法上值得留的**：两个听起来很像的假设都被实测证伪 ——
「e2e 残留 serial 太多」（清到只剩 1 个真的 + 重新 cook，仍然失败）、
「lifecycle 150s staleness 判离线」（读代码确认只控横幅）。
真因靠探针拿到：零 JS 错误 + store 日志里没有 `hello`。**别在两次猜测之后继续猜。**

**清理纪律**：桥**关闭时会把内存里的 registry 写回磁盘**，所以桥在跑的时候改
`registry.json` 必被覆盖（实测 prune 到 1 条、重启后又变回 16 条）。
要清就走桥的端点，或在 restart 的停机窗口里改。

## -1 项目定位与下一阶段目标（用户 2026-08-20 口述，**新会话从这里读起**）

**Cyl1nder 最强的地方是 python runtime edit**，不是几何程序化。用户原话：
「Cyl1nder 最强大的是 python runtime edit, 就是针对 animate scene 那种**没暴露普通 io 口**
但是又有**运行时 python 接入辅助需求**（虽然是一次性操作而不是程序化, 但也很重要）」。

这句话有两个直接后果，别再走反方向：

1. **不要在 Cyl1nder 里重新发明几何操作。** 用户明确：「merge 在 houdini sop 中更多是对
   几何体操作, 先不考虑 merge 操作, 因为那个可以放到 houdini 里面」。几何该回 Houdini。
   （这条正好解掉了「每槽独立类型」此前的阻塞：null 不是 merge，是 N 条独立直通通道，
   于是根本不需要合并语义 —— 见 §2.2。）
2. **价值在"运行时能改到别人改不到的东西"**：APEX / Scene Animate 那类
   没有常规 IO 端口、只能靠运行时 Python 介入的场景。一次性操作也算价值。

**下一阶段目标（用户已去新会话推进）**：与 **Cascadeur** 联动。
- 动机：Houdini 传统流程是动画数据经 USD/FBX 传入、再用 `add animation` 之类 SOP
  程序化叠加 —— 这条路**用不到 Cascadeur 的 runtime 摆 pose 的 AI 模型**。
- 参照物：Unreal 有 LiveLink DLL，「到时候抓过来用」。
- 现状：**未开工**。APEX 侧已有的知识见 `apex-runtime-knowledge.md`；
  本轮明确「apex 先不管, 标注后续再支持」，所以 apex-ctrl 的实时推送仍是空白（见 §5.1）。

## 0 本轮结论速览

| 项 | 状态 |
|---|---|
| bug A 双击缩放 | **已修，浏览器实证**（拦 `zoom` 管道的 `source === "dblclick"`；滚轮仍可用） |
| bug B Alt 生成 dot | **已修，浏览器实证**（白点渲染、连接数不变、线不进选中态） |
| dot 渲染不显示 / 连线断联 | **已修**（dot 改为连接装饰件 + 自绘连线组件） |
| Ctrl+dot 残留 | **已移除**（Ctrl 分支改 Alt，`insertDotAt` 删除） |
| dot NodeKind 清理 | **已完成**（见 §2） |

> **dot 标记（v0.1.00119 用户拍板）**：手感不顺，**本轮起暂不再动**。现状可用：
> Alt+左键点线生成白点、拖动跟手、甩远删除；已知限制是**无法从 dot 自身拖出连线**
> （锚点 `pointer-events:none`，为保住 10×10 圆整体可拖并避开 ±12px 反向命中区）。
> 要继续做需在 `graph.ts` 给 `getDOMSocketPosition` 自定义 `offset` —— 等有明确需求再说。

**不需要退回 Ctrl+dot。** 两个 bug 都在真实浏览器里验证通过，不是"单测过了就宣布完成"。

**本轮验证基线**：tsc 0 / vitest **582**（34 文件；原 579 − 旧 `dot-neutral` 的 2 条
+ 新 `waypoint-neutral` 的 5 条 = 582，文件数不变因为是重命名）/ `vite build` 通过 /
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

**修法与两处易读错的地方**：手势期间额外在 window 挂一份 capture 阶段 `pointermove`，
`clearWaypointDrag()` 负责摘掉（置空即幂等，绑定侧也早退，一次手势不可能挂两个）。

1. **没用 `setPointerCapture`**：它会把后续所有 pointer 事件**重定向**到捕获元素，
   于是 rete 自己的插件与那个仍在喂 `lastGraphMouse`/转接预览的 container 监听器
   看到的 `e.target` 全变了。window 监听是**纯增量**的：只加投递，不改 targeting、
   传播与 `preventDefault` 行为。（附带好处：jsdom 没实现 `setPointerCapture`，
   用它将来写单测会直接抛错。）
2. **window 与 container 不是「谁先到谁算」的竞争关系**：window 是捕获路径的根，
   对**每一个** pointermove 都先触发，所以改完之后 container 分支永远不做 waypoint
   的活，它只是兜底（也是 jsdom 里直接朝 container 派发事件时会走的那条路）。
   按事件对象身份去重不是在仲裁竞争，而是让**唯一权威路径**确定性地生效——
   读 `onWaypointMove` 时别理解成两个对等监听器抢同一个事件。

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

## 2.2 null 节点动态输入端口（v0.1.00121，用户需求 #3）

规则：**端口数 = 最高已接线下标 + 2**，因此永远恰好留一个空位、绝不留两个。
out 端口数随 in 决定（用户：「out 不用，理论上 in 端口总会保留一个任意以供用户接入」）。

**中间空洞刻意保留**：端口 key **就是**连接的身份。删掉 `in1` 会让 `in2` 改名，
它那条线就断了。所以只在末尾伸缩，中间不压缩。

**类型冲突是「连不上」而不是「删线」**：第一条线一落地就把所有端口（含那个空位）
retype，于是第二条不匹配的线在 `canConnectSockets` 就被拒——用户看到的是连不上，
和 Houdini 本身的行为一致。冲突粒度是**族级**，所以 float ↔ vec3 仍可互连。

**但有两条路绕过插件**：`restoreGraph`（读档直接 `addConnection`）与 undo 重放。
那两条路上冲突的线会真的存在，所以补了 `findPortTypeConflicts`（**只报告、不删线**）
并接进 `dataflow.ts` 那一次 `setNodeErrors`——删线等于替用户丢数据，
红三角 + 原因让他自己决定。它要 `editor` 而不是快照：类型冲突是 socket 层的事实。

**`type` 参数对机器可写、对用户只读**：它必须留着真值，因为
`isDefaultAddressParam` 靠 `=== geo` 剔除它，那正是旧快照字节兼容的依据。
`setNodeParams` 每次都用 `derivePortType` 覆盖它（capabilities 优先、映射表兜底、
「不知道」就不动而不是猜 geo），并导出 `isDerivedParam` 供参数面板把那行画成禁用。

**一处诚实的偏差**（子智能体主动指出，我认可）：「旧图往返视觉零变化」做不到——
读档后的 null 会多出一个空位圆点，那正是这个功能本身。拓扑、端口 key、schema 版本、
已接线端口的颜色都不变；空 null 现在渲染成灰而不是红，那是「类型还不知道」的诚实表达。

## 2.3 删掉 `?serial=` 之后暴露的层级判定 bug（v0.1.00120）

**症状**：9 个 e2e 挂在 `createTransform` 返回 null 上（`round2/3/4-nodeview/5-nodeview`）。
**根因**：`getCurrentNetKind()` 原先只看栈深度——`netStack.length === 0 ? "obj" : "sop"`。
`?serial=` 入口删除后，成员工作区改由 `?project=…&member=…` 打开，也是**深度 0**，
于是「深度 0 == obj」把成员图判成 obj 层；Tab 面板按层过滤后**只剩 geo**，
`transform` / `null` / `_input_` / `_output_` 全被滤掉。
探针实测：`netKind=obj allRows=["geo"]`。

**修法**：层级是**图的属性**，不是入口或深度的属性。深度 >0 恒为 sop；深度 0 看
`isProjectMode()`（图里有没有 project 节点）：项目根图 = `obj`，成员工作区 = `sop`
（它就是一个 HDA 内部的内容，本身已在 sop 语义里）。
修后探针：`netKind=sop allRows=["_input_","_output_","null","transform"]`。

**不用 URL 有没有 member 参数当判据**：图被换掉之后 URL 立刻失真。

**连带**：`hierarchy-verify.spec.ts:84` 原本断言成员工作区是 `"obj"` ——
那条断言把 bug 写进了测试。已改为 `"sop"` 并注明原因。
全量 e2e 因此从 **9 failed / 91 passed** 变成 **100 passed / 0 failed**
（本轮开工前的基线是 10 failed / 89 passed）。

**教训**：删掉一个入口会让「深度 0」的含义悄悄改变。凡是从「有几层」推断「这是什么层」
的地方，都要问一句「新入口会不会也从第 0 层进来」。

**另一条教训（关于怎么读子智能体的报告）**：那 9 个失败被连续两份报告判成
「pre-existing，与本次改动无关」，理由是「失败信息里不提 project/member/serial」
且「单独跑也失败」。两条观察都是真的，结论却是错的 —— 单独跑也失败正说明它**不是**
偶发，而回归的因果链（删入口 → 深度 0 语义变 → 层级判错 → 面板过滤掉 transform）
根本不会在错误信息里出现 `serial` 字样。

**判据只能是「改动前后各跑一次」**，不能是「错误信息里有没有相关字眼」。
本轮开工前基线 10 failed / 89 passed，其中并**没有** `createTransform` 那 9 条；
修掉 netKind 之后是 100 passed / 0 failed。差值才是证据。

## 2.4 层级实现里顺带修掉的一个潜伏 bug

`enterByName` 原先的顺序是**先注册层级变化等待者、再调 `enterNode`**。
`enterNode` 返回 `false`（节点不存在 / 不可进入）时那个 promise 不会被兑现，
于是它**挂在那里等下一次无关的层级变化**才被唤醒——一次失败的地址栏导航会让
后续某次正常的进入/退出触发一个早已过期的回调。
改法：抽出 `enterNodeAwaited(nodeId)`，只在 `enterNode` 真的返回 true 之后才 await，
`__cylHier.enter` 与地址栏共用它（钩子跑的就是用户那条路径，不是平行实现）。

## 2.5 项目重建（v0.1.00119，用户授权）

用户原话：「对于项目重建，你可以直接把 …\beginTest-1 中的 Cyl1nder 快照删了重来都行」。

已做：
1. 旧快照目录 `…\beginTest-1\Cyl1nder\` 整个删除（**先归档**到
   `bridge/data/snapshot-backup-beginTest-1-*`，该目录已 gitignore）。删掉的三个子目录里
   有两个是同一 serial 的重名残留（新名 `beginTest-1_C1-msm6dsp7-ob6t` + 旧名
   `C1-msm6dsp7-ob6t`，迁移遇 `skipped:target-exists` 留下的），一个是不在注册表里的孤儿
   `beginTest-1_C1-msm006pg-8fz7`。
2. `projects.json` 清空为 `[]`、`mappings.json` 清空为 `{anchors:{},entries:{}}`
   （两者都先 `.bak-<时间戳>` 备份）。清掉的残留里有一个死锚点
   `C1-msyhkp0l-8oiw`：pid 54656 已不存在（实例现为 28720），且与
   `C1-msz03wf5-u0ym` **指向同一个 nodePath**。
3. **必须重启桥才算清干净**：桥把 projects/mappings 持在内存里，直接改盘上文件会被
   它下一次落盘覆盖回去（实测：改完文件后 `GET /api/projects` 仍返回旧项目）。
   走 `bridge_control.restart_bridge()` 重启后 `GET /api/projects` 返回 `{"projects":[]}`。

**教训**：清桥侧状态不能只动文件，要么走桥的端点，要么改完重启。

### v0.1.00120 清掉 3 个孤儿项目图

项目图搬到 hip 旁之后，`bridge/data/projects/` 里剩下 3 个**孤儿**（项目记录已不存在，
因此永远不会被读、也永远不会被迁移——迁移要靠活记录提供 hip 才触发）：

| 目录 | 内容 | 判断 |
|---|---|---|
| `P1-msu9mqna-8e8s` | schema 3，project「P2a-demo」+ channel「cyl1ndertag」 | 早期演示项目，记录已删 |
| `P1-msyiasx0-a2gf` | **schema 2，只有裸 `_input_`/`_output_`** | 正是 v0.1.00117 那次「成员图覆盖项目根」的**受损产物**，不是可恢复数据 |
| `P1-msyqxnfg-ct3c` | schema 2，同上形态 | 同上 |

已归档到 `bridge/data/orphan-project-graphs-*`（gitignore）后移除，`projects/` 现为空。
活项目 `P1-mszw0wfu-d3u3` 读取正常（schema 5、hip 旁）。

**留着的坏处**：它们会让「项目图在哪」这个问题永远有两个答案，下一轮 agent 看到
`bridge/data/projects/` 有货就会以为搬迁没做完。

### 重建后的干净基线（实机实证）

```
project P1-msztfncq-1yyn | hip: beginTest-2.hip | members: hda:C1-msm6dsp7-ob6t, tag:C1-msz03wf5-u0ym
  entries: 4
    sandbox_sceneanimate/point_1     | type: vec3  | kind: data | ok: true
    sandbox_sceneanimate/point_1/tx  | type: float | kind: data | ok: true
    sandbox_sceneanimate/point_1/ty  | type: float | kind: data | ok: true
    sandbox_sceneanimate/point_1/tz  | type: float | kind: data | ok: true
```

即：hip 已绑定（task #6 有数据可显）、成员按 hip 自动归拢成一个项目、
4 条映射条目带真实类型且全部 `ok: true`（task #8 的类型来源到位）。
**吊牌的注册在内部 `cyl1nder_tag_py` 里**，force 外层节点不一定触发，
要 `n.node("cyl1nder_tag_py").cook(force=True)`。

### 重建时实测到的三件事（都不是本轮引入的 bug，但会误导下一轮）

1. **e2e fixture 会覆盖真实节点的注册记录。** 全部 `round*-*.spec.ts` 都用
   `client.pushInputs(serial, …, { nodePath: "/obj/test/Cyl1nder1", label: "Cyl1nder1" })`
   打到**当前活着的 serial** 上（`beforeAll` 取 `/api/serials` 的最后一个）。跑完 e2e 后
   `registry.json` 里那条的 `nodePath` 就变成 `/obj/test/Cyl1nder1`——一个不存在的节点。
   **且 cook 一次修不回来**：心跳只刷 `lastSeen`，`nodePath` 只在**真的 push 输入**时写，
   而 `_push_inputs_if_changed` 在几何没变时直接跳过。实测 `force_cook` 后 `lastSeen`
   归零但 `nodePath` 仍是假的。要修得让上游几何真的变一次。
2. **项目的 `hip` 不会被回填 —— 本轮已修（桥侧）。**
   根因：web 侧 `client.ensureProject(serial)` **从不带 hip**（它手上只有 serial，
   `listSerials()` 只回字符串数组），于是 `POST /api/projects/ensure` 一路走到
   `projects.create(label=serial)`，建出一个 **hip 为空**的项目；而项目 hip
   **没有任何回填路径**——成员之后 push 刷的是 `registry`，不补项目那一栏。
   实测重建后的 `P1-mszskx8f-0yf2` 的 hip 一直是空串，即使成员 registry 里已有正确 hip。
   后果：nodeview 项目根无地址可显，**task #6 直接失去数据来源**；overview 也只能显示序列号。

   修法（`project_routes.ensure_project`）：调用方没带 hip 时**回退读
   `registry.get(serial).hip`**——那是 HDA cook 时自报的可信值——再走既有
   `bind_serial_to_hip()`，于是「同一个 hip 只有一个项目」这条既有语义真的生效。
   registry 里也没有时保持旧语义（建 `label=serial` 的无 hip 项目），**绝不编造 hip**。
   实机验证：删掉那个空 hip 项目后重新 ensure →
   `hip: …/beginTest-2.hip`、`hipName: beginTest-2.hip`（此前是 `""`）。
   两条 pytest 钉住（回退命中 / registry 也无 hip 时不变）。
3. **`cyl1nder_get_status`（MCP）读的是快照文件，不是 live 注册表。** 实测它回报
   `lastSeen` 已 40000s，而 `bridge/data/registry.json` 里同一条是 0s 前刚更新的。
   排查"HDA 是不是没连上桥"时**别信它**，直接读 `registry.json` 或
   `GET /api/serials`；否则会把活得好好的链路误判成失联（本轮差点就此下错结论）。

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
- **Houdini 的真实机制（已实机验证，详见 `reference-registry-design.md`）**：不是求值时
  解析，而是**改名时推送重写**。它维护名字依赖登记表（`parmsReferencingThis()` /
  `opdepend -N`），只重写**登记过的** `NodeReference` 参数；VEX 字符串、Python、拼接
  表达式一律静默失效——同一串路径在 `centroid()` 里被重写、在 VEX `point()` 里悄悄失效，
  判据是**登记**而非文本匹配。所以照抄登记制：未登记 = 不重写，且这一点要在 UI 上
  说清楚，而不是假装所有引用都保得住。
- **附带地址栏 bug（已修）**：`setChannelDisplayHandler` 原先先把 `graphScope` 设成
  member 并立即刷地址栏，而图的替换在 `activateSession` 里另行发生。
  **`activateSession` 不保证任何事**：它 `void loadSnapshot(serial)` 即返回，图交换在
  `loadSnapshotIntoStore` 内部，**且仅当该成员有存图**（`if (g?.nodes?.length)`）。
  所以成员没有存图时，地址会指向一个 nodeview 从未去过的地方。

  修法：`pendingMemberScope` 登记待兑现归属 → `restoreGraph` 真的落地后由
  `commitPendingMemberScope(serial)` 才写 scope + 刷地址；serial 不匹配则丢弃
  （快速连点不会留下过期地址）；成员无存图那条分支**明确 log 原因**，
  否则「点了 display 地址没变」会变成下一个查不明白的症状。

  地址栏的 2 段 `/P1-…/C1-…/` 分支**也已收口到同一套机制**（v0.1.00119）：
  它原先同样是乐观更新，只是入口不同（手打地址 vs 点 display chip）。两个入口共用
  一套机制，就不会一个诚实一个乐观。17 例浏览器 e2e 验证该分支行为未回归。

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

### 被冻结测试锁住的两处设计妥协（改之前先读原因）

1. **`PROJECT_GRAPH_SCHEMA` 仍是 3，另加 `ADDRESS_GRAPH_SCHEMA = 4`、`HIER_GRAPH_SCHEMA = 5`。**
   `project-graph.test.ts:135` 要求「含 project/channel 的图 === `PROJECT_GRAPH_SCHEMA`」，
   而 `:163` 对**同类图**要求字面量 `3` —— 两条互相夹死，bump 任何一个都会破其中一条。
   语义上三个数各有其意（3 = 项目图、4 = 单端口 address 形态、5 = 含层级），
   **要加版本就新增常量，别 bump 旧的**。
2. **`makeInputNode()` / `makeOutputNode()` 默认仍是 4 端口**，单端口靠传 `true` 开启。
   有冻结测试直接连 `output.out1`，rete 会抛
   `target node doesn't have input with a key out1`。`buildGraph` 已传 `true`，
   所以**新图就是单端口**，语义达标；默认值是为兼容而反过来的。
- 端口重建不能破坏既有连线的缓存身份（`chain-cache` 签名由 `specs` 构成）

## 4 纪律（本轮新增）

- **UI 改动必须在浏览器里验证**。本轮的 fling bug（`pointermove` 挂 container 而非
  window）在 tsc 0 + vitest 579 全绿的情况下依然存在。既有 e2e 全部依赖活桥、
  桥没起就整体 skip，于是纯前端渲染问题永远验不到——新增
  `web/e2e/waypoint-verify.spec.ts` 时刻意让它只依赖 `__cylGraph`。
- **e2e 取线上的点之前必须先 fit**。不 fit 时线的中点会落在视口外（实测 x=1591,y=1001），
  鼠标根本碰不到，测试会以"取不到点"的形式假失败。
- **查 FastAPI 路由表要走 `.original_router`**（v0.1.00120 实测）。本仓这个版本把
  `include_router` 进来的路由包成 `_IncludedRouter`，**既没有 `.path` 也没有 `.routes`**，
  所以直接遍历 `app.routes` 过滤 `.path` 会**什么都不打印**——那是过滤器空转，
  不是「没有冲突」。以后在本仓看到「我查了路由表，是干净的」，先怀疑是踩了这个坑。
  静态查完还要在装好的 `create_app()` 上**行为验证**一次（打一遍旧路由确认没被吞）。
- **判定「某个 serial 是什么」绝不能拿 registry 命中当依据**：`SerialRegistry.touch()`
  对任何合法 serial 首次接触就自动登记（`registry.py:125`，本意是让 idle HDA 在桥重启后
  重新出现）。所以吊牌只要轮询过 `/pending` 就会进 registry。
  正确顺序是**先看通道表里的 `kind:"tag"` 正面证据，再把 registry 命中读作 hda**。
  `project-mapping-design.md` §5.1 说的「吊牌不在 registry 里」只对 `put_inputs` 那条路
  成立，**不足以当判据**——按它反过来写会把所有轮询过的吊牌判成 hda。
- **`?serial=` 打开的图里 `_input_` 是旧 4 端口形态，没有 address 参数**（实测
  `outs:["in0","in1","in2","in3"]`、`params:[]`）——它是从存档恢复的，而
  `detectLegacyPorts` 判定旧形态就原样重建。所以要测 address / 映射类型 / 引用登记
  这些**只存在于单端口形态**的行为，必须自己 `makeInputNode(true)` 建节点，
  别复用图里现成的那个 `_input_`（否则参数写不进去，症状是 address 读回来是 null，
  很容易误判成"写入逻辑坏了"）。
- **`locator.dblclick()` 在本项目不可用**：dockview 的 `.dv-void-container` 覆盖层
  会让 Playwright 的 actionability 检查永远判定被遮挡。用 `page.mouse.dblclick(裸坐标)`。
- **e2e 里 `await import("/src/...")` 拿到的模块实例是否与应用同一份，取决于 HMR 状态
  ——所以绝不能依赖它**（v0.1.00119 实测）。
  vite 把入口发成 `/src/main.ts?t=1787127560559`（HMR cache-buster），而 `main.ts`
  import 的是**裸** `/src/nodes2/graph.ts`：
  - **冷加载**：测试 import 的裸 specifier 与 main.ts 的一致 → **同一实例**，能用；
  - **一旦某次 HMR 给链上模块盖了 `?t=`**：specifier 分叉 → 浏览器实例化**第二份**，
    `activeGraph`/`netStack` 全空 → `serializeGraphFromRoot()` 返回 null、
    `getNetPath()` 恒 `[]`（这正是本轮先看到的症状）。

  所以它是**间歇的、依赖编辑历史的**——比稳定失败更糟：同一份 spec 现在 5/5 通过，
  中途改过几次源码之后就会挂，而源码本身没变。**结论**：凡要驱动模块级状态的 e2e，
  一律走应用自己挂出来的调试钩子（`__cylGraph` / `__cylHier`），
  **不要**用动态 import 去拿模块级函数。
  （本轮先下的结论「动态 import 必然是另一个实例」是错的——那只是恰好处在 HMR
   已分叉的状态；两次测量都是真的，测的是不同的 HMR 状态。）
- **桥重启走 `hda/scripts/bridge_control.py` 的 `restart_bridge()`**（按端口 8375/8376
  精确定位，不按 PID 杀）。该文件不在 Houdini 的 import path 上，要用
  `importlib.util.spec_from_file_location` 按路径加载。
- **pwsh 首个 token 必须是受信前缀**（`node`/`npm`/`git`/`.venv\scripts\python`）；
  以 `Set-Content`/`Remove-Item`/赋值开头会被沙箱拒。PowerShell **没有** heredoc。
- **`npx --prefix web` 在管道下会报 `$LASTEXITCODE` 未设置并吞掉输出**；
  跑 playwright 直接 `cd web ; node node_modules/@playwright/test/cli.js`。
- **写入长度截断与 BOM 已升为开发规范铁律**，见 `development-standards.md` 的
  「写入长度：分块，且写完必查」与「Shell：项目硬性要求 pwsh 7」两节。
  本文件不再重复细则，以免两处漂移。
- **注释里写 `*/` 会提前终止 JSDoc 块**。本轮实例：在 `/** */` 里写
  `cyl-wire-*/drop-target` 直接产生 33 个解析错误。要列举类名模式时写成
  `cyl-wire-x / drop-target / reconnect-x 等`，别用 glob 星号紧跟斜杠。
- **`useConnection` 不在 `rete-react-plugin` 包根导出**，只能取
  `Presets.classic.useConnection`（与 `NodeView.tsx` 取 `RefSocket` 同款写法）。
  按直觉写 `import { useConnection } from "rete-react-plugin"` 编译不过。
- **`git` 也是受信前缀，但 PowerShell 没有 heredoc**：写多行中文 commit message
  用 `write` 工具落到文件再 `git commit -F <file>`（放 `bridge/data/` 下，已 gitignore，
  提交后删）。`git commit -F - <<'EOF'` 会被 PowerShell 解析器直接拒。
- **BOM 两个来源要分清**（细则见 development-standards.md）：shell 侧靠 pwsh 7 解决
  （5.1 兜底才会注入）；**`edit`/`write` 工具吃掉已有 BOM 是工具行为，与 shell 无关**，
  仍需提交前扫 `^-\uFEFF` 并补回。
- **APEX 写入只在一次性副本节点上做**，绝不碰用户活动节点；绝不对 `animation` Data parm
  调 `revertToDefaults()`（会清空整个场景）。
- **不要用 `hou.hipFile.load(..., suppress_save_prompt=True)` 清理自己的测试文件**
  —— 那会丢弃用户未保存改动。
- 加 HDA 参数走**就地 patch 定义**（`type().definition().setParmTemplateGroup`），
  别用 `build_hda.py` 全量重建（它开头就 `hipFile.clear()`）。
- 新增 bridge 模块/路由后**必须重启桥**（走 `bridge_control.restart_bridge()`，
  不按 PID 杀进程）。

## 5 现有限制（已确认现状，别当 bug 重新调查）

以下每条都是**已确认的现状**，不是待查问题。动手前先看这里，省一轮排查。

### 5.1 实时性

**`apex-ctrl` 没有推送通道。** 值的流动全靠：吊牌心跳（**60s** 节流）+ 用户显式探测
+ 分量写入时的 read-modify-write（每次都过 Houdini 主线程）。

后果：连续拖动 gizmo 驱动 APEX 控制器时的时序**从未验证过**——这是整条链上唯一
没在浏览器里跑过的部分。要做实时拖动得先设计推送，不是调参数能解决的。

### 5.2 清理

- `清理空项目` **只删 0 成员项目**。持有失效成员的残留项目够不着，只能逐行点删除。
  要一键清完需要「清理失效项目」（按成员通道是否还在 `/api/channels` 判定）——
  这是**按启发式删用户数据**，没擅自加。
- `POST /api/scenes/cleanup` 只删「无效」快照目录（空/缺件/meta 损坏）。测试产物有完整
  `meta.json`，所以它一个都删不掉。

### 5.3 未验证 / 不要当已完成

- **多层 additive 动画层合成、层权重、`flattenedLayers()`** —— 历史遗留未验证项。
- **`Scene.writeToGeometry()` / 节点 `editanimation` 机制** —— 回写活动节点的替代路径，
  未单独验证（现行 `saveToGeometry` + 保留全部顶层 prim 的路径已验证零误差）。
- **一个逻辑名只绑一个锚点**；跨 hip 映射不做（`hip` 仅作校验与显示）。
- 逻辑名冲突（两个锚点在同一项目产出同名 rel）：v1 后写覆盖先写，无自动改名。
