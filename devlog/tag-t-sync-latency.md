# `transform1/t` 同步为什么要 ~1 秒（实测定位）

> 用户问题原话：「Cyl1nderTag2 同步 transform1 中的 t 属性要大概 1 秒才能反应过去」。
> 本文每条数字都是**在活 Houdini（pid 62520 / 22.0.368）与活桥（v0.1.00158）上实测的**，
> 没有一条来自推断。推断过的地方全部标注「未验证」。

## 结论（一句话）

**那 1 秒不在桥、也不在 Houdini，而是 web 侧自驱动轮询链的平均等待。**
`transform1/t` 从 Houdini 流向 web **完全是拉取式**的（没有任何推送），
重取周期实测 2.1s / 4.2s 双峰 —— 值在随机时刻改变，平均要等半个周期 ≈ **1.06s**。
用户感到的「大概 1 秒」就是这个平均值，不是某个 1 秒常量。

## 实测数据

| 路径 | 实测 | 组成 |
|---|---|---|
| 桥读一次 vec3（`GET .../mappings/transform1/t/value`） | **212 ms** | 5 次 MCP 串行 |
| 桥写一次 vec3（`PUT` 同端点） | **50 ms** | 2 次 MCP |
| 单次 MCP 往返（`parameters.get_parameter`） | **~50 ms** | Houdini 主线程 dispatcher |
| `mcp.health` 探针 | **~3 ms** | 不经 dispatcher，所以极快 |
| web 侧重取周期（用户真浏览器） | **2.28–2.65s / 4.07–4.45s 双峰** | 见下 |

读的 5 次调用里**有一次是注定失败的**：`parameters.get_parameter(parm_name="t")`
对元组参数恒报「Parameter 't' not found」，之后才逐分量取 `tx`/`ty`/`tz`。
即 212 ms ≈ 3（health）+ 50（必失败）+ 50×3（分量）。

## 叠加机制（原写「三个」，查下来是四个 —— §1b 是排查中途才发现的独立缺陷）

### 1. 没有推送，只有拉取
吊牌心跳会捎带参数值，但 `TAG_HEARTBEAT_INTERVAL = 60.0`（`hda/src/cyl1nder_tag.py:29`），
且 `heartbeat()` 一进门就按这个节流 return（同文件 370-371 行）、**只在 cook 时才跑**。
所以它不构成一条实时通路。

### 1b. 快通路对 `t` 是**静默失效**的（本轮实测查清，独立缺陷）
`GET /api/hda/{serial}/channel-values` 是那条**有** 0.25s 缓存的批量快通路，
参数面板每 250ms 就轮询它（`web/src/app/channel-panel.ts:249,303`）。
对本 serial 实测返回 **`{"ok":true,"values":{}}`**。

根因不是「没有通道」——`/api/channels` 里那条 `kind=param` / `transform1/t` 的行确实在。
是 `houdini_routes.py:409-426` 的循环对每个通道只打一次
`parameters.get_parameter(parm_name="t")`，**没有 vec3 逐分量兜底**；
元组参数这一下必然 `status == "error"` → 第 422-423 行 `continue` 跳过。

于是它**把「读不出来」返回成了「读到了空集」**（`ok: True`）：
参数面板里 `t` 干脆不出现，而不是报错。这正是 devlog 反复记的那类「看不见的失败」。
后果：`t` 吃不到那 0.25s 缓存，只能落到**无任何缓存**的 per-mapping 端点，由 web 自己轮询。

**改前基线实测**（该 serial 名下**只有一条** param 通道 `/obj/geo1/transform1/t` type=vec3）：
```
run 1 -> 320ms  ok=True  keys=0   {"ok":true,"values":{}}
run 2 ->   2ms  ok=True  keys=0   ← 0.25s 缓存忠实地把「空集」也缓存了
run 3 ->   1ms  ok=True  keys=0
run 4 ->   0ms  ok=True  keys=0
```
**1 条通道进、0 个值出**，而 `ok` 仍是 `true`。缓存让这个空答案更廉价地重复给出 ——
一个说谎的快通路比慢通路更坏。

### 写方向是好的（专门核实过，不是假设）
只修 GET 会不会造出「面板显示得出 `t`、一改就失败」的更差状态？**不会。**
`PUT /api/hda/{serial}/channel-values` 走 `_send_cv_pending`
（`houdini_routes.py:515-518`），把 `value` 原样交给 `parameters.set_parameter` ——
与 mapping 端点同一形状。代码同形不算证明，所以对活 Houdini 实测了一次幂等写：

```
set t=[0.0153,0.7108,0]  ->  status success   timing_ms 54.57 / 10 / 48.44
之后读回 transform1.t    =  0.0153, 0.7108, 0   （值未变）
```

**`set_parameter` 本来就收列表**，所以 vec3 的写从来没坏过。
读坏写好的根因是两侧走的 HOM 不同：读经 `node.parm(name)`（元组参数恒为 None），
写经能收元组的 `set_parameter`。**只修 GET 是完整的，不会造出半修状态。**

### 2. 轮询链的周期由「读延迟」决定，且会自己错过一拍
链条是 `armExternRefPoll`(2000ms) → `scheduleWriteback`(120ms 去抖) →
`pushWritebackOnce` → `prefetchExternRefs` → 重新 arm。所以每 **2120ms** 才检查一次 TTL，
而 TTL 判据是 `Date.now() - at < EXTERN_REF_TTL_MS`，其中 `at` 是**值到达**的时刻
（`main.ts:1367`）。

于是出现一个自造的错拍：读要 212ms > 去抖 120ms，
第一次检查时「距上次到达」只有 1908ms < 2000ms → **跳过**，要再等一个 2120ms。

```
实测（用户真浏览器，前台）：低簇 n=6 均值 2.430s   模型 2.120s
                            高簇 n=7 均值 4.242s   模型 4.240s   ← 吻合到 2ms
```

**平均staleness = 周期/2 + 读延迟 ≈ 1.06s ~ 2.3s。** 这就是那「大概 1 秒」。

### 3. 后台标签页会停摆两分钟（顺带发现，比原问题更严重）
同一份 trace 的尾段实测到 **120.251s** 的重取周期（n=6，散布仅 1.5s）：

```
121.514  119.983  120.002  120.027  119.981  119.997
```

这是 Chrome 的 intensive throttling（后台标签每分钟只唤醒一次定时器）
撞上**两级串联 setTimeout**（2000ms 的 poll + 120ms 的去抖）——
每级各等一次唤醒 = 2 分钟。**切走标签页再切回来，`t` 是两分钟前的值。**

## 两条我实测**否掉**的路

### `asyncio.gather` 并发读分量：毫无收益
逐分量读是串行的，看起来该并发。实测否掉：

```
3 次串行 -> 155 / 157 ms
3 次并发 -> 155 / 156 ms   ← 一模一样
```

**Houdini dispatcher 把所有 mcp.execute 排到主线程串行执行**，并发只是让它们排队。
（这与 `_find_port_by_pid` 的 16 端口并发扫描不同：那些是**探活**，走 `mcp.health`
不经 dispatcher，所以并发真的有效。同一份代码里两种调用的并发收益完全不同。）

### devlog 里「vec3 写回要 ~1s，因为桥逐分量打 3 次 MCP」是错的
这句话写在 `main.ts:1262-1263`（单飞守卫的立论依据）与 in-progress §-14。
实测：**写是 1 次 `set_parameter` 收列表，共 2 次 MCP，50ms。**
逐分量的是**读**，不是写。

**这条结论由计时本身判定，不靠读代码**（读代码只能看出「打算怎么做」，
计时才能证明「实际做了几次」）。单次 MCP 往返实测 ~50ms、`mcp.health` ~3ms
（不经 dispatcher），于是两种实现的耗时预测差一个数量级：

| 假设 | 预测耗时 | 实测 |
|---|---|---|
| 1 次 `set_parameter` 收列表（+health） | 3 + 50 ≈ **53ms** | **50 / 52 / 59ms** ✅ |
| 逐分量 3 次 `set_parameter`（+health） | 3 + 150 ≈ **153ms** | 从未出现 ❌ |

单飞守卫**本身仍有价值**（防并发重复推送，会刷掉用户在 Houdini 的撤销栈），
所以不要因为这条更正就去删它 —— 只是它的注释把理由说反了，
会误导下一个人去优化一个不存在的写瓶颈。

## 当初的修法提案（保留原文，便于对照最终做法）

> **这一节是诊断当天写下的提案，不是最终结论。** 四条后来全部落地（见下方总账），
> 但其中**第 3 条的做法被实测改掉了** —— 保留原文正是为了记住这个偏差。

1. **读改成一次 `code.execute_python` 取整个 parmTuple**：实测 **52ms**（对比 212ms，4x）。
   `[p.eval() for p in node.parmTuple("t")]` 实测返回 `[0.0153,0.7108,0.0]`。
   顺带消掉那次注定失败的调用。
2. **TTL 判据或 arm 时机改一处**，消掉「错过一拍」：周期从 4.24s 回到 2.12s。
   （arm 从**值到达**起算，或 TTL 判据留出 ≥ 读延迟的余量。）
3. **合并两级 setTimeout 为一级**，把后台停摆从 120s 降到 60s；
   要真正修好需改成 `visibilitychange` 时立即重取（后台不轮询、切回来补一次）。
4. 让 `channel-values` 批量端点支持 vec3 兜底，`t` 就能吃到那 0.25s 缓存。

**第 3 条提案错了一半**：「合并两级 setTimeout 降到 60s」只是把乘数从 2 降到 1，
后台仍然每分钟打一次桥、值仍然最多陈旧 60s —— 那是**缓解**，不是修好。
最终按后半句做（隐藏零请求 + 可见即追赶），于是后台请求量归零、切回来立刻拿新值，
**两头都变好**，一级二级的问题根本不需要讨论。
教训：提案里带「降到 X」的措辞要警惕 —— 它往往意味着**缓解**而不是**修好**。

## 落地情况（v0.1.00159 起，逐版本累积）

### 修法 1 已落地并**在真 Houdini 上**验到（`bridge/bridge/mapping_routes.py`）
`get_mapping_value` 的 vec3 分支改成先走新的 `_read_vec3_tuple`（一次
`code.execute_python` 取整个元组），失败才退到既有的 `_read_vec3_components`（安全网，
行为一字未改）。**vec3 不再发那次注定失败的 `get_parameter("t")`**。

单测用的是 stub，所以按本项目自己的教训（「测试全绿不等于代码被执行过」）
又把两个函数**直接对 8100 上的活 Houdini** 跑了一遍：

```
NEW _read_vec3_tuple      value=[0.0153,0.7108,0.0]  median= 53ms
OLD _read_vec3_components value=[0.0153,0.7108,0.0]  median=158ms
```

**值完全一致** —— 所以这是等价替换，不只是更快。

### 整端点实测（桥重启到 00159 之后，非推算）
```
BEFORE  samples 456 232 211 215 207 210 211 211   min 207  median 211
AFTER   samples 363  88  52  53  51  52  52  53   min  51  median  52
```
**211 → 52ms，4.06x**（我此前按 3+53 推算 ~56ms，实测比推算还好一点）。
两次首发（456 / 363）是冷启动，第二发起就进稳态。返回值仍是 `[0.0153,0.7108,0]`。

### 一个连带结论：修法 1 直接抽掉了修法 2 要治的那个病根
漏拍的成立条件是**读延迟 > 去抖时长**（212ms > 120ms），于是第一次 TTL 检查时
年龄 = 2120 − 212 = 1908ms < 2000ms 被跳过。读降到 52ms 之后：
年龄 = 2120 − 52 = **2068ms ≥ 2000ms** —— **即便没有修法 2 的 slack 也能通过**。

所以两个修法不是各自独立的：**修法 1 消掉了触发条件，修法 2 让判据不再依赖读延迟**。
加上 slack（门槛 1880ms）后的余量是 `2120 − 1880 = 240ms`，
当前读延迟 52ms，**余量约 4.6x** —— 读再慢 4 倍也不会重新丢拍。

### 用户数据在重启后完好
通道行 11 条（与重启前一致）、锚点 3、条目 7，`transform1/t` 行仍是
`type=vec3 kind=param`；`Cyl1nderTag2` 锚点 `pid=62520 port=8100 alive=True`。
用户页面自行重连（WS 4 个客户端、`lastSeen 0s`），两个 workspace 都从快照恢复。

### 「重连会不会用旧快照覆盖掉浏览器里的图」——查实了，不会
这是我重启前最担心的一条，四条证据闭合：

1. `GET /api/hda/C1-msm6dsp7-ob6t/snapshot` 实测 **`snapshot` 有、但没有 `graph` 字段**；
2. `restoreGraph` 第一行是 `if (!d?.nodes) return;`（`graph-model.ts:2238`），
   而它**返回在** `removeConnection`/`removeNode` 那两个销毁循环（2251-2252 行）**之前**
   —— 没有 graph 时它是彻底的 no-op，一根线都不会动；
3. 页面实测活着（`lastSeen` 6 秒内前进 6.04s）；
4. 磁盘上最新 `node-graph.json` 是 08-19 22:33 且**无一提到** `transform1`
   —— 我**重启前**就查过一次，所以这不是重启造成的。

**结论**：图在浏览器里完好，但**只在浏览器里**。
所以要拿到本轮的 web 侧修复，用户必须**先 Ctrl+S 存图、再刷新** ——
直接刷新会丢掉那张图（vite 的 reload 与这里无关，是"内存态从未落盘"本身的性质）。

4 例新单测；两条变异测试都确认会红：把 `_read_vec3_tuple` 写死返回 None → 单次读那条红；
去掉长度校验 → 畸形形状那条红（2 分量被放过）。桥全量 **450 passed**。

**错误路径也对着活 Houdini 逐个走过**（单测用 stub，证不出 Houdini 真实的失败形态）：

| 输入 | 结果 |
|---|---|
| `transform1/t`（正常） | `[0.0153,0.7108,0.0]` |
| `transform1/tx`（parmTuple 尺寸 1） | `None` |
| 不存在的参数 / 不存在的节点 | `None` |
| `transform1/scale`（float） | `None` |

五条全部干净返回 `None`、**没有异常漏出**，于是一律落到逐分量安全网。
最后两行有额外意义：`type=vec3` 的条目指向一个 float 时，现在是**如实失败**，
而不是拼出一个假 vec3 —— 静默给出错误位姿比读不到更坏。

其中一条测试断言的是**「`parameters.get_parameter` 一次都没被调用」** ——
这正是本修法的全部意义，只断言「值对」的测试抓不到那次浪费的往返。

## 第三个缺陷：轮询链一旦断就**永不自愈**（本轮实测撞到）

`armExternRefPoll` 是一条**自续的链式定时器**：定时器触发时先把自己置空，
再靠 `scheduleWriteback` → `pushWritebackOnce` → `prefetchExternRefs` 把自己 arm 回来。

而 `pushWritebackOnce` 在到达 `prefetchExternRefs` **之前**有两个提前 return：

```
main.ts:1376   if (!pid) return;              // 没有项目
main.ts:1380   } catch { return; }            // 图还没就绪
```

任何一个在「定时器已置空、还没 re-arm」的那一刻命中 → **这条链就永久死掉**，
直到别的事件再调一次 `scheduleWriteback()`。**没有任何自愈路径。**

### 实测撞到（我自己制造的场景）
把桥（8375）重启之后，用户页面**是活的**：`lastSeen` 6 秒内前进 6.04s（那是 1s 时间轴
轮询在跑）、WS 4 个客户端、两个 workspace 都从快照恢复了。
但 `transform1/t` 的 `data-get` **388s+ 一次都没有** —— 远超后台节流的 120s。

**未验证**：我无法从桥侧断定是两个 return 里哪一个命中的（那要读浏览器内存态）。
但「链结构上允许永久死亡」是读代码可证的，「链现在确实死了而页面活着」是实测的。

**这比原问题更严重**：原问题是「慢 1 秒」，这个是「**彻底停掉且看不出来**」——
页面一切正常、日志没有错误、值就是不再更新。又一个「看不见的失败」。

### 已修（`web/src/core/poll-loop.ts`，新模块）
抽成一个注入计时器的自愈状态机 `createPollLoop({intervalMs, onTick, setTimer, clearTimer})`。
**关键顺序**：定时器触发时**先无条件重排下一轮，再跑 `onTick`**，且 `onTick` 的异常被吞掉
—— 于是下游任何提前 return 或抛错都杀不死这条链。

`main.ts` 侧的三处接线（每一处都是有意的，不是顺手改的）：
- `prefetchExternRefs` 地址为空 → **显式 `disarm()`**。以前"不 arm 就自然停"，
  现在循环会无条件重排，不主动关就会在空图上永远轮询；
- `pushWritebackOnce` 的 `!pid` → `disarm()`（没项目无从解析逻辑名；
  项目加载会经 `flushStoreView → scheduleWriteback` 重新按需 arm）；
- `getNetworkSnapshot()` 的 `catch` → **保持武装**，只 return。
  这正是本缺陷本身，注释里明确写了「不要在这里 disarm」——否则下一个人会"顺手修好"它。

计时器注入让这个状态机能在 `environment: "node"` 下真正被单测（无 DOM、无 `vi.useFakeTimers`，
手动记录 pending 回调再手动触发，这样**重排与执行的先后**才能被精确断言）。

5 例新单测。**变异测试**：把重排挪到 `onTick` 之后（放进 `try` 里，
与真实缺陷形态一致）→ 第 1 例（抛异常的 tick 杀不死循环）与第 4 例（顺序锚点：
`onTick` 内部 `isArmed()` 已为 true）**双双变红**，另 3 例照绿（正确，它们不依赖这个顺序）。

第 4 例是刻意加的：它断言的是**机制**（重排先于工作），而第 1 例断言的是**症状**。
只有症状测试的话，换一种同样错误的实现可能照样绿。

子智能体额外加了一个「世代号」（`disarm()` 也自增，过期回调认出不匹配就不作数），
超出我给的 API 规格。我逐路走过 arm→fire→disarm→arm 与「`onTick` 内部自己调 `disarm()`」
（那正是地址为空那条路）两条时序，判定正确后保留。

验证：tsc **0** / vitest **940**（51 文件，+5）。

## 落地总账（截至 v0.1.00167）

> 第 4 项的状态在 v0.1.00167 被**收窄**：端点那半是真的，但用户看到的症状是
> 「参数面板里 `t` 不出现」，面板那条路我当时没走完就宣布已修。详见 in-progress §-40。

| # | 问题 | 状态 | 实测 |
|---|---|---|---|
| 1 | vec3 读发一次注定失败的 `get_parameter` | **已修**（00159） | 端点 211 → 52ms，4.06x |
| 2 | web TTL 判据漏一拍 | **已修**（00159） | 周期 4.24s → 2.12s |
| 3 | 轮询链断了不自愈 | **已修**（00161） | 5 例单测 + 变异测试双红 |
| 4 | `channel-values` 对 vec3 静默失效 | **已修**（读 00161／写 00168） | keys 0 → 1；vec3 行改成三个 number 框，推数组 |
| 5 | 后台标签页停摆 120s | **已修**（00162） | 隐藏零请求 + 可见即追赶 |
| 6 | `PUT channel-values` 对失败的写**谎报成功** | **已修**（桥 00168／面板 00169） | 逐通道回报 `failed`；变异测试 4 条红 |
| 7 | 面板整批共用一个 `r.ok` → 混批里**成功的通道也变红** | **已修**（00169） | `dotStateFor`；变异测试精确红 1 条 |
| 8 | `throttled`（已接受、尚未尝试）被当成成功 → **画绿点** | **已修**（00169） | `web/src` 里原先只有 `putTimeline` 认识它 |

> 第 6 项是查第 4 项的写侧时撞到的，**比第 4 项严重且不限于 vec3**：任何逐通道写失败
> （路径写错／参数被锁／类型不符）都被报成成功，而面板状态点只看 `r.ok`
> —— 用户看到绿色「已同步」，写却没落地。详见 in-progress §-41。
>
> **明细那半也补齐了（00169）**：`client.ts` 现在带 `failed`/`throttled`，横幅具名到通道。
> 我一度以为这条是阻断性的（绿点不会变红），读到 `client.ts:578` 的 `ok: body?.ok ?? true`
> 才发现 `??` 只兜 null/undefined、`ok:false` 原样穿过 —— 更正记在 §-41。

### #5 的修法：隐藏时不轮询，可见时立刻补一次（v0.1.00162）
病根不是常量太大，是**两级串联 setTimeout**（本轮询 2000ms + 写回去抖 120ms）
撞上 Chrome 后台「约 1 次/分钟」的唤醒节流 —— 每级各等一次唤醒 = ~120s。
所以调小任何一个常量都没用：级数才是乘数。

给 `createPollLoop` 加两个**可选注入**依赖（`isHidden` / `onVisibilityChange`）：
- 隐藏时 `arm()` 只记「意图」不排定时器 → 后台**零请求**（原来是每 ~120s 打一次桥）；
- 变可见时**立刻补一次 `onTick`** → 拿到新值不用等下一次被节流的唤醒（最多省 120s 陈旧）。

**两头都比原来好**，不是取舍。两个依赖都可选，缺省时行为与改动前逐字节一致
（有一条测试专门钉住这个向后兼容）——因为本模块单测跑在无 DOM 的 node 环境，
绝不能直接摸 `document`。

**这不是新发明的模式**：`main.ts:737` 的 1s 时间轴兜底轮询**一直**就有可见性门控
（`if (!serial || document.visibilityState !== "visible") return;`）。
本轮只是把同一条房规补给图外引用轮询 —— 它此前是这一类轮询里唯一没有门控的。
（顺带解释了一个现象：用户切走标签页后 `lastSeen` 会冻住，那正是这条既有门控在起作用，
不是页面死了。排查时别把它当故障。）

`isArmed()` 的语义随之改成报**意图**（`wanted`）而不是「有没有真实定时器」：
隐藏中 `arm()` 过的循环必须报 `true`，否则调用方会以为自己 arm 失败了。
`arm()` 的守卫也因此必须从 `timerId` 改判 `wanted` —— 若仍判 `timerId`，
隐藏期间每次 `arm()` 都会重排一个定时器。

**最要紧的那条新测试是「反复活防护」**：`disarm()` 之后任何可见性事件都必须是 no-op。
没有它，`prefetchExternRefs` 在空地址表上 `disarm()` 之后，一次切标签页就能让空图
永远轮询下去。变异测试（去掉 `!wanted` 守卫）确认它会红。

7 例新测试（含 `dispose()` 退订）。**未接线**：`dispose()` 已导出但 `main.ts` 里没有
调用点 —— 该文件本来就没有 SPA 销毁路径（`createAutosave` / `createHdaWatchdog` 的
`stop()` 同样从未被调用），刻意不为它现造一个。

### 顺带：这一条**不能**由 #3 的自愈覆盖
#3 是「链断了」，#5 是「链被节流」。两者症状像（值长时间不更新），机制完全不同 ——
自愈只保证链不死，不会让被钳到 1 次/分钟的唤醒变快。分开修、分开测。

## 关于本轮的桥重启（方法记一笔）

官方 shelf `cyl1nder::reload_bridge` 走 `restart_bridge()`，它 `_kill_port(8375)`
**加** `_kill_port(8376)`。而 8376 上是用户那张**只存在于浏览器里的未存图** ——
vite 客户端在 `client.mjs:863-871` 明确写着：WS 断开后 `waitForSuccessfulPing` 成功
就 `location.reload()`。**杀 vite = 用户的图必然丢。**

改用更保守的组合：只 `_kill_port(8375)` + `start_bridge()`。
`start_bridge` 内部调 `ensure_frontend()`，而它第一件事就是
`if frontend_healthy(url): return "ui OK (already up)"` —— **vite 活着就不碰它**。

仍然走项目自己的 `bridge_control` 模块、仍然只按端口定位（不猜 pid），
比官方路径**少杀一个进程**。实测结果：桥到 00159、vite 仍 HTTP 200、
MCP pid 62520 未动、用户页面自行重连（WS 4 客户端、`lastSeen` 持续前进）、
通道行 11 条与锚点/条目全部完好。

**要点**：「官方路径」是为了避免按 pid 乱杀，不是要求必须连带杀 vite。
当官方路径的副作用会破坏用户数据时，按同一模块、同一判据做更小的那个动作。
