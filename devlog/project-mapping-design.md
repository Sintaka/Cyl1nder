# 项目化 + 映射系统设计（v0.1.00114）

> 2026-08-16 · 项目优先重构 + 映射系统 + 类型化端口。
> 标注「**实机验证**」的结论经 fxhoudinimcp（8100）在 Houdini 22.0.368 上实测。
> 关联：`tag-hda-plan.md`（主计划）· `protocol.md`（协议单源）· `apex-runtime-knowledge.md`（APEX 权威）

## 0 问题陈述（用户原话归纳）

- 「目前的对接很多是绝对编码，项目是以序列号挨个打开的，这太乱了」
- 「node 中引用相对地址（相对于映射系统），映射系统负责管理 houdini 的地址」
- 「要考虑一个 tag 节点可能被移动的情况，在每次 hda cook 的时候需要检测如果相对位置改变则在映射系统中更新」
- 「nodeview 中的 input 和 output 需要升级，可以就一个 in/out 端口然后填入关联的相对地址」
- 「现在开始需要把 geo 和别 float 的数据线出现在同一个 node 系统而不是只有 geo，注意端口连线区分，直接对齐 houdini vop / cop 系统的连线」
- 「当前阶段如果有多个 out 直接报错让用户手动管理」
- 「映射系统需要兼容 apex scene animate，tag hda 可以更新一下，给出标记模式」

## 1 三个坏味道与对应修法

| 坏味道 | 具体表现 | 修法 |
|---|---|---|
| 绝对编码 | node 里存 `/obj/geo1/transform1/tx`；吊牌一移动全断 | 映射系统：node 只存**逻辑名**，绝对路径由锚点解析 |
| 按 serial 逐个打开 | 入口是 `?serial=`，一个页面一个 HDA | 入口改 `?project=`，项目为管理单位 |
| 项目全是序列号 | 9 个残留项目，label 就是成员 serial，无删除入口 | 项目优先 overview：改名/删除/清理空项目 |

## 2 映射系统

### 2.1 核心：锚点 = 吊牌 serial

移动容错的支点是「找一个移动时不变的东西」。吊牌的 `cyl1nder_serial` 创建即生成、持久化、不可变、复制生成新号（铁律 1）——**移动/改名都不变**，正好当锚点。

```
mappings.json
{
  "anchors": { "C1-msyhkp0l-8oiw": { nodePath, hip, mode, lastSeen, movedAt } },
  "entries": { "P1-xxx": { "<逻辑名>": { anchor, rel, kind, adapter, type, label } } }
}
```

吊牌每次 cook 上报自身 `nodePath` → 移动只改 `anchors` **一处**，其下全部 entry 自动跟随。

### 2.2 解析规则（两侧必须一致）

```
absolutePath = <锚点 nodePath 所在网络> + "/" + entry.rel
             = dirname(anchor.nodePath) + "/" + rel
```

`rel` 以吊牌**所在网络**为基准 = **兄弟节点语义**。

**为什么不是「相对吊牌自身」**：目标（`transform1`、`sceneanimate1`）是吊牌的**兄弟**节点，不是它的子节点。本轮开发时第一版把 apex 条目 join 到**上游节点**上，算出 `/obj/geo1/sceneaddcharacter1/sandbox_sceneanimate/point_1` —— 既是错的，又与桥侧 `dirname(anchor.nodePath)` 分叉（同一条 rel 两侧算出不同绝对路径）。**HDA 侧与桥侧的基准必须逐字一致**，这是本设计最容易踩的坑。

跨网络（目标不在吊牌所在网络下）时 `rel` 退回**绝对路径**：仍能解析，只是失去移动容错。这是有意的降级，不是静默错误。

### 2.3 逻辑名

- 默认取 `rel` 本身（`sandbox_sceneanimate/point_1`）——这正是用户要在 node 里写的相对地址。
- **作用域 = 项目内唯一**；不同项目可用同名指向不同锚点。
- 可含 `/`。桥用 `{name:path}` 捕获，因此 `/value` 后缀路由**必须先于**裸 `{name:path}` 声明，否则被吞（`channel_routes.py` 里已有同款教训）。

### 2.4 谁建 entry

吊牌**不知道**自己属于哪个项目（项目是 web 侧概念）。因此：

1. 吊牌 cook 注册通道时带上 `rel`/`type`/`mode`（`ChannelRef` 新增字段）。
2. 桥在注册路由里按成员关系分发：**含该吊牌的每个项目**各建/更新一条 entry（`channel_routes._sync_mapping_entry`）。
3. 全程 best-effort —— 映射同步失败绝不让注册失败。

这样 HDA 保持薄（不认识项目），项目归属由桥收口。

## 3 吊牌标记模式（mode）

新增 `mode` 参数（MenuParmTemplate）：

| mode | 条目写法 | 解析基准 | 产出 |
|---|---|---|---|
| `parm`（默认） | `tx` / `transform1/tx` | **上游节点**（旧语义不变） | `kind=param`, `type=float` |
| `apex` | `<sceneanimate>/<控制器>[/<tx…sz>]` | **吊牌所在网络**（兄弟语义） | `kind=data`, `adapter=apex-ctrl`, `type=vec3\|float` |

显式 `@<adapter>:<nodePath>/<parm>` 条目**与 mode 无关**，旧写法照旧可用。

分量后缀（`tx…sz`）判类型：有后缀 → `float`（单分量），无后缀 → `vec3`（整体位姿）。

**坑（实机踩到）**：`mode` 是 MenuParmTemplate，`parm.eval()` 返回**索引整数**（0/1）而不是 token，必须 `evalAsString()`。项目里 `_parm()` helper 用的是 `eval()`，所以 mode 单独走 `_read_mode()`。

## 4 移动检测（本轮修的真 bug）

### 4.1 症状

在 Houdini 里移动或改名吊牌后，映射一直是旧路径，**整个会话都不会自愈**。

### 4.2 根因

```python
# 旧（有 bug）
def _fingerprint(entries, upstream): ...   # 漏了吊牌自身路径
```

指纹只认「条目原文 + 上游节点」。吊牌自身改名时两者都没变 → 指纹不变 → `_FINGERPRINTS` 命中 → **不重注册**。而 `_FINGERPRINTS` 是模块级 dict，只在 Houdini 重启/热重载时清空。

### 4.3 修法

```python
def _fingerprint(entries, upstream, tag_path="", mode="parm"): ...
```

并且**重注册即刻上报锚点**（`_LAST_HEARTBEAT = 0.0` 绕过 5s 心跳节流）——移动后映射必须立刻跟上，不能等下一个心跳窗口。

### 4.4 实机验证

活动场景 `/obj/geo1/apex_ctrl_tag` 改名为 `apex_ctrl_tag_renamed`：

```
fingerprint     0ec7ac9b09a06ac5 -> 9408bb1cdcf027ec   （变了 = 会重注册）
anchor          -> /obj/geo1/apex_ctrl_tag_renamed  (movedAt set)
逻辑名          sandbox_sceneanimate/point_1        不变
绝对路径        自动跟随
按逻辑名读值    point_1 -> t:[0.18, 0.42, 0.2]      仍然可用
```

改名前后都能读到 APEX 控制器真实世界位姿，请求里**不含任何绝对路径**。

## 5 端点

见 `protocol.md`「项目管理端点」「映射系统」两节（协议单源）。要点：

- 映射路由**先于**项目路由挂载：`/api/projects/{pid}/mappings/...` 段更长更具体，否则被 `/api/projects/{projectId}` 的路径参数吞掉。
- `DELETE /api/projects/{pid}` 级联：mappings 分区 + `projects/<pid>/graph.json`（复用 `snapshot.project_graph_path`，不另算路径）。
- 锚点移动 → WS 广播 `{type:"anchor-moved", serial, oldPath, newPath, names}`。**逻辑名不变**，web 侧不需要改地址，仅提示与刷新。
- 轨迹新增 action `anchor-move`。

## 5.1 锚点 -> Houdini 实例的端口定位（踩坑）

映射的 value 端点要经 fxhoudinimcp 读写，得先知道**哪个** Houdini 实例。

直觉做法 `_resolve_port(anchor_serial)` 是**错的**：吊牌**不在 `registry.json` 里**
（那是 `put_inputs` 写的，吊牌从不调它），于是 `rec=None` → `hip=""` → 一路掉到
`discover_first()`，也就是「拿第一个活口当答案」。单实例时碰巧对，多开 Houdini
时会写到错的实例——dev 规范明令禁止这么猜（`pid == os.getpid()` / hip 才是可靠判据）。

修法：`mapping_routes._resolve_port_for_anchor` 按**锚点记录的 pid + 端口**定位：
① 记录的 `mcpPort` 且 `health.pid` 相符 → 直接用（零扫描）；② 否则按 pid 扫
8100..8115 找回该实例；③ 都不行才退回 `_resolve_port`（保留 registry.mcpPort /
失败短缓存等既有逻辑）。

> ⚠️ **本节第一版写的是「按 hip 定位」，那是错的**（见 §5.3）：`mcp.health` 实测不回
> `hip_file`，`discover_by_hip` 恒为 `None`，那条 fallback 是死代码——单实例下恰好被
> `_resolve_port` 兜住，所以看起来能用。已改为按 pid。

顺带记录：吊牌 serial 不进 registry 也是「打开吊牌项目显示 HDA 离线」的根因之一——
项目视图因此改为**成员聚合判活**（有 geo HDA 成员用其 registry lastSeen，纯吊牌项目
用锚点 lastSeen），而不是拿单一 serial 的 registry 记录说事。

顺带记录：吊牌 serial 不进 registry 也是「打开吊牌项目显示 HDA 离线」的根因之一——
项目视图因此改为**成员聚合判活**（有 geo HDA 成员用其 registry lastSeen，纯吊牌项目
用锚点 lastSeen），而不是拿单一 serial 的 registry 记录说事。

## 5.2 存活判定：降级前实证（pid + 端口）

### 为什么心跳不够

**吊牌只在 cook 时心跳。** 长期不 cook 是完全正常的——它是侧挂件，上游不变就不重算。
所以「心跳超时」只能证明「最近没 cook 过」，**不能**证明实例没了。

实测：线上一个健康吊牌的 live 心跳已 2938s，而成员快照更是 13081s。按心跳年龄判定
会把活得好好的实例说成离线——这是猜，不是事实。

### 做法

吊牌 cook 心跳时连自身身份一起上报：

| 字段 | 来源 | 为什么可靠 |
|---|---|---|
| `pid` | `os.getpid()` | 吊牌代码跑在 Houdini 进程里，这就是那个实例的 pid。铁律：**pid 是认定实例的唯一可靠判据** |
| `mcpPort` | `cyl1nder_houdini_mcp.known_port()` | 后台发现线程的结果（0 = 尚未发现）。**绝不在 cook 主线程扫端口**——同步 HTTP 是死锁红线 |

锚点记下这两项后，降级前可以**实证**：按记录端口发 `mcp.health`，比对
`pid == 记录的 pid`。三种结论互不相同：

| 探测结果 | 含义 | UI 该说什么 |
|---|---|---|
| `alive && pidMatched` | 同一实例活着，只是没 cook | 在线（未 cook） |
| `alive && !pidMatched` | 端口有人应答，但**换了进程**（Houdini 重开过） | 失联（实例已更换）——**不能**算健康 |
| `!alive` | 记录端口不通，且扫遍窗口没有哪个端口报出这个 pid | 失联 |
| `expectedPid == 0` | 旧版吊牌从未上报 pid | 无法验证（别给假结论） |

端口对不上时**按 pid 扫端口**重新定位（见 §5.3），探测成功顺带把锚点的 `mcpPort`
修正到实际端口（自愈）。

### 5.3 踩坑：`mcp.health` 不回 hip_file，按 hip 定位是死代码

重定位的第一版写的是「按 hip 重新定位（实例重开到别的端口但 hip 不变）」。
**实测 `mcp.health` 只回 `{status, pid, houdini_version}`——没有 hip_file**：

```
discover_by_hip(<exact hip>) -> None
health(8100)                 -> {'status':'ok','pid':54656,'houdini_version':'22.0.368'}
```

所以 `discover_by_hip` 恒为 `None`，两处 fallback（probe 重定位、
`_resolve_port_for_anchor` 优先定位）都是死代码。单实例下恰好被 `_resolve_port`
兜住，**所以看起来是能用的**——这是最难发现的一类错。dev 规范里其实早写过
「实测安装版 health 不带 hip_file」，本轮仍照直觉写错了一遍。

改为按 **pid** 扫 `8100..8115`（`_find_port_by_pid`）：pid 既是铁律认定的唯一可靠判据，
又确实在 health 响应里。

**实机验证**：把锚点端口写成错的 8199（真实实例在 8100）→ 探测按 pid 扫回 8100、
`mcpPort` 自愈为 8100、`pidMatched=True`；把期望 pid 改成 999999（模拟 Houdini 重开）
→ `alive=True` 但 `pidMatched=False`、`verifiedAlive` 保持 False。

测试同步纠正：原 fixture 在 fake health 里塞了 `hip_file` —— 真实响应根本没这个键，
mock 出来只会让测试相信一件假事。已移除全部 `hip_file` mock，并补「扫描窗口里有
别的活 Houdini（pid 不同）时绝不误采」用例。

### 心跳间隔放宽到 60s

既然存活由探测负责，心跳就不必频繁：`TAG_HEARTBEAT_INTERVAL` 从 **5s 放宽到 60s**，
只做低频「我还在 + 位置/pid/端口摘要」上报。

### 纪律

- 探测是**按需**动作（用户点「检测」/ 展开项目时一次），**绝不进渲染路径或轮询**——
  每次探测都是一次 Houdini 往返。
- `pid` 变化 = 实例重开过，此前的验证结论作废（`verifiedAlive` 重置）。
- 上报 0 值**绝不覆盖**已知的 pid/端口（旧版吊牌不带这些字段，覆盖会弄丢能力）。

## 6 类型化端口（nodeview）

- socket 类型 `geo` / `float` / `vec3`；连线校验**类型不符不允许连**（此前 `ConnectionPresets.classic.setup()` 来者不拒）。
- 配色对齐 Houdini VOP「按类型着色」的读图习惯：geo 灰白 / float 绿 `#7ce3a8` / vec3 蓝 `#7fb0ff`。
- `_input_`/`_output_` 从 4 端口改 **1 端口 + `address`（逻辑名）+ `type`**。
- **多个 out 连同一端口 → 报错**（用户明确要求手动管理），不再静默取第一条。
- 非 geo 端口不参与几何计算，值走映射系统按逻辑名读写。

### 兼容策略（最高风险项）

4 端口形态贯穿 dataflow / chain-cache / 快照 / 10+ e2e。因此**双形态并存**而非一次性迁移：

- `PROJECT_GRAPH_SCHEMA` 3 → **4**（4 = 单端口 + 地址形态）
- 读到旧图（v2/v3，或 input 节点已有 `in1`）→ 保持**旧 4 端口形态不变**
- 只有新建图用单端口
- `address`/`type` 仅非空时序列化 → v2/v3 输出**字节级不变**

## 6.1 `-0` 在值往返中被规范化（已确认无害）

映射值经 JSON 往返时 **`-0` 会变成 `0`**（`JSON.stringify(-0) === "0"`，JSON 规范没有负零）。
读 apex 控制器旋转常见 `r: [0.0, -0.0, 0.0]`，写回后是 `[0, 0, 0]`。

**实机验证结论：无害。** `hou.hmath.buildRotate(0,-0,0)*T == buildRotate(0,0,0)*T` 为
`True`，`hou.Vector3(0,-0,0) == hou.Vector3(0,0,0)` 为 `True`——变换数学不看符号位。
参数层面 `parm.set(-0.0)` 读回 `repr` 确实是 `-0.0`（与 `0.0` 的 repr 不同），但数值相等，
Houdini 参数语义不靠负零区分。

记在这里是因为：**若将来有任何一端靠 `-0` 的符号位表达语义，这条链路会静默丢掉它**。
web 侧已就此写了显式断言（`channelValueString(-0) === "0"`），不是让测试「过了就算」。

## 7 未做 / 已知限制

- **一个逻辑名只绑一个锚点**；跨 hip 映射不做（`hip` 仅作校验与显示）。
- 逻辑名冲突（两个锚点在同一项目产出同名 rel）：v1 后写覆盖先写，无自动改名。
- 多层 additive 动画层 / 层权重合成仍未验证（沿 v0.1.00113 的未验证项）。
- 非 geo 端口的**实时**推送没有：`apex-ctrl` 无 push 通道，吊牌心跳节流 5s，分量写是「读-改-写」。连续拖动的时序稳定性未实测。
- 旧 `?serial=` 链接经 `ensure` 重定向到项目，但书签语义变了（落到项目视图而非单 serial 工作区）。

## 8 纪律（沿用并强化）

- APEX 写入一律在**一次性副本节点**上做，绝不碰用户活动节点；绝不对 `animation` Data parm 调 `revertToDefaults()`（v0.1.00113 因此弄坏过用户节点）。
- **不要用 `build_hda.py` 全量重建来加参数**：它开头就 `hipFile.clear()`，会清空用户场景。给已装 HDA 加参数走「就地 patch 定义」：`type().definition().setParmTemplateGroup(...)`。
- 新增 bridge 模块/路由后**必须重启桥**才生效（`ADAPTERS`/路由在进程启动时构建）；重启走 shelf `cyl1nder::reload_bridge`，**不按 PID 杀进程**。
