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

## 三个叠加机制

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

## 修法（按性价比排序，均已实测验证可行性）

1. **读改成一次 `code.execute_python` 取整个 parmTuple**：实测 **52ms**（对比 212ms，4x）。
   `[p.eval() for p in node.parmTuple("t")]` 实测返回 `[0.0153,0.7108,0.0]`。
   顺带消掉那次注定失败的调用。
2. **TTL 判据或 arm 时机改一处**，消掉「错过一拍」：周期从 4.24s 回到 2.12s。
   （arm 从**值到达**起算，或 TTL 判据留出 ≥ 读延迟的余量。）
3. **合并两级 setTimeout 为一级**，把后台停摆从 120s 降到 60s；
   要真正修好需改成 `visibilitychange` 时立即重取（后台不轮询、切回来补一次）。
4. 让 `channel-values` 批量端点支持 vec3 兜底，`t` 就能吃到那 0.25s 缓存。

## 落地情况（v0.1.00159）

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

**值完全一致** —— 所以这是等价替换，不只是更快。整端点 ≈ 3(health) + 53 = **~56ms**，
对比改前实测基线 **211ms**（8 次采样 min 207 / median 211）。

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

### 仍未做（如实标注）
- 修法 2/3（web 轮询错拍、后台停摆）：本轮派了子智能体，**合并结果见 §-33**。
- 修法 4（`channel-values` 支持 vec3，见 §1b 那个静默失效）：**未做**，
  刻意不与修法 1 同轮并行——两者都改桥、都要跑同一套 pytest，写集会打架。
