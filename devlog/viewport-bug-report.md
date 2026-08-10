# Cyl1nder 3D Viewport 显示 bug 调试报告

- 日期：2026-08-10
- 仓库：D:\code\dev\Cyl1nder
- 目标：Cyl1nder（Houdini ⇄ 本地桥 8375 ⇄ Web 前端 8376 中间站）3D viewport「一堆几何叠在一起 + 重叠伪影 + display 日志不跟 node graph」问题
- 结论：已定位根因并**完成代码修复 + 重新验证**（typecheck / 单测 / e2e 全过）

---

## 1. 复现环境（真实环境，非静态推演）

- 桥 8375 在线、vite 8376 在线（调试期间发现 8376 的 vite 进程已挂，已用 `node node_modules\vite\bin\vite.js` 以隐藏窗口重启，恢复服务）。
- 用桥 REST 造了两个测试 serial（避免污染真实 HDA）：
  - `C1-msnd1p81-68mp`：4 路输入全部带几何 + 4 路输出镜像（in0=球体 18pt/30faces、in1=圆环曲线 16pt、in2=方盒 8pt/6faces、in3=折线 3pt；颜色分别对应 INPUT_COLORS 蓝/橙/绿/紫，输出统一红 #ff5252）。
  - `C1-msndcvcu-kj1k`：只有 4 路输入、无输出（用来测 output display 无数据时的回退逻辑）。
- 用 Playwright（headless Edge）+ 桥 snapshot 持久化 node graph（`restoreGraph`）在 input/output 之间**确定性插入 null 节点**（null.in0 接 input.inK、null.out0 接 output.outK，其余 3 路直连），逐个点击 null 的 D 显示按钮，读 `.cyl-log` 的 `[viewport] visibility/display focus` 日志，并用 canvas 像素直方图量化视口里实际画了哪些颜色（每色像素数）。

## 2. 根因分析

### 2.1 显示逻辑 bug（核心）
- 位置：`web/src/main.ts` 的 `refreshNodeFlags()`（约 55 行）。
- 旧逻辑只按**节点类型**（kind：input/output/null）决定显示，从不看 display flag 挂在图里的**哪个端口**：
  - `input` display → `setDisplayFocus("inputs", null)` → **4 路输入全部一起显示**（这是用户看到「一堆几何叠在一起」的主因；对 `_input_` 源节点显示全部输入本身合理，但用户期望视口跟随图的 display 位置）。
  - `null` display → 同样走 `showInputs` 分支 + `setDisplayFocus("inputs", null)` → **4 路输入全部显示**，完全不看这个 null 到底接的是哪一段（bug 核心）。
  - `output` display 且无输出时 → `showInputs = outDisplay && !hasOutputs` → **点击 output 却显示 inputs**（误导性回退）。
- `viewport/renderer.ts:165` 的 `setDisplayFocus(kind, index)` 其实早就支持按端口（index=0..3）显示，但 `refreshNodeFlags()` 永远只传 `null`，等于这段按端口能力是**死代码**——这就是「显示逻辑过时、与 node view 的 display flag 脱节」的直接证据。
- 日志层面：`[viewport] display focus inputs index=null` 永远打 null，看不到具体端口，所以用户觉得「日志没有真正根据 node graph 的 display flag 位置显示」。

### 2.2 重叠伪影来源（逐项排查）
| 来源 | 是否默认开启 | 实测表现 |
|---|---|---|
| 4 路输入同时显示（input/null display 的旧逻辑） | 是（默认 `_input_` display） | **主因**。Unlit 模式下 in0=37106px、in1=420px、in2=27885px、in3=218px 同屏 |
| debug box（B 键 `toggleDebugBoxes`，renderer.ts:39/158） | **否**（构造时 `visible=false`） | 开启后仅多出 2 个小盒：红盒 @(4,0,0)、蓝盒 @(0,4,0)，像素 ~230–399px，位于主几何右侧，**干扰很小但确实存在**；默认不干扰 |
| reference wireframe（右键节点勾 Wireframe） | **否**（flags 默认 false） | 开启后 `setReference` 用**固定蓝色 0x4fc3f7** 在**同一位置**再画一遍有曲线的输入（in1/in3）的半透明线，直接盖住原色曲线（实测 in1/in3 的纯色像素归零），是**条件性双画伪影** |
| inputs 与 outputs 同时显示 | 否 | 旧逻辑里两者互斥（有输出时 output display 只显示 outputs），不是伪影来源 |
| GridHelper | 总是 | 只是网格线，非伪影 |

### 2.3 debug box 是否干扰
默认不干扰（构造时 `this.debugBoxes.visible = false`）。只有用户按过 B 才会显示；且盒子在 +X/+Y 远处，尺寸 0.6，与主几何重叠很小。但红/蓝盒颜色与 output 红、in0 蓝相同，易被误认为「Houdini 传进来的 box」——这是用户困惑「debug box 还是 Houdini 的 box」的合理来源。

## 3. 修复（已实施）

### 3.1 `web/src/nodes2/graph.ts`
- 接口新增 `getDisplayPortIndex(): number | null`（约 53 行）。
- 实现（约 284 行）：找到当前 display 节点，若为 null 节点则查询 `editor.getConnections()` 中 `target=该 null && targetInput="in0"` 的连接，从 `sourceOutput`（`in0..in3`）解析出上游输入端口号；非 null 节点/未连接返回 null。

### 3.2 `web/src/main.ts` — `refreshNodeFlags()`（约 55 行）
- 语义改为按端口：
  - `_input_` display → 显示全部 4 路输入（源视图，保持）。
  - `null` display → `setDisplayFocus("inputs", graph.getDisplayPortIndex())`：**只显示穿过该 null 的那一段输入**。
  - `_output_` display → 只显示 outputs；无 outputs 时**什么都不显示**（去掉旧的「显示 inputs 回退」）。
  - 无 display 节点 → 仍显示 inputs（安全源视图）。
- 日志现在会打出 `[viewport] display focus inputs index=0..3`，直接反映 node graph 的 display 位置。

### 3.3 未改（说明）
- `renderer.ts` 的 `setDisplayFocus/setVisibility/toggleDebugBoxes` 无需改动（按端口能力原本就在）。
- 调试中曾尝试把 `.cyl-log` 刷新挪到 emit 尾部让日志即时包含 `[viewport]` 静默行，但会导致 e2e smoke 断言 `hello`（40 行窗口）滚出，已回退该改动，仅保留核心修复。
- debug box 与 reference wireframe 属条件性小干扰，作为后续建议（见 §5），未改行为。

## 4. 实测：4 条输入线段 × display 按钮矩阵

测试方式：input.inK → null.in0 → null.out0 → output.outK（K=0..3），其余直连；点 `_input_` / null 的 D / `_output_` 的 D，读 `.cyl-log` 日志 + 像素直方图。shown = 该颜色像素数 > 40。

### 4.1 修复前（git HEAD 代码）
| 输入线段 | 默认(`_input_` D) | 显示接在 inK 上的 null | 显示 `_output_`（有输出） |
|---|---|---|---|
| in0 | 显示（in0=37106） | 显示 in0+in1+in2+in3（**4 路全显**） | out 红 65629，in0-3 全 0 |
| in1 | 显示（in1=420） | 显示 in0+in1+in2+in3（**4 路全显**） | 同上 |
| in2 | 显示（in2=27885） | 显示 in0+in1+in2+in3（**4 路全显**） | 同上 |
| in3 | 显示（in3=218） | 显示 in0+in1+in2+in3（**4 路全显**） | 同上 |
- 关键日志：`[viewport] display focus inputs index=null`（永远 null）。
- 附加：`_output_` display 且**无输出**（serial B）→ 旧逻辑 `visibility inputs=true outputs=false`（显示 inputs，误导）。

### 4.2 修复后（当前代码）
| 输入线段 | 默认(`_input_` D) | 显示接在 inK 上的 null | 显示 `_output_`（有输出） |
|---|---|---|---|
| in0 | 显示全部 4 路（源视图，符合预期） | **只显示 in0**（in1/2/3/out=0） | out 红，in0-3 全 0 |
| in1 | 显示全部 4 路 | **只显示 in1**（其余 0） | 同上 |
| in2 | 显示全部 4 路 | **只显示 in2**（其余 0） | 同上 |
| in3 | 显示全部 4 路 | **只显示 in3**（其余 0） | 同上 |
- 关键日志：`[viewport] display focus inputs index=0/1/2/3`（随 display 节点位置变化）。
- `_output_` display 且无输出（serial B）→ `visibility inputs=false outputs=false`，视口空（Houdini 语义，不再误导显示 inputs）。

## 5. 验证汇总

- `node node_modules\typescript\bin\tsc --noEmit` → exit 0
- `npm test`（vitest）→ 13/13 通过
- `npx playwright test`（e2e smoke）→ 通过
- 真实浏览器复测：4 线段矩阵修复前后对比如 §4（像素直方图 + 日志双重确认）

## 6. 后续建议（未实施，供参考）
1. **reference wireframe 双画**：`refreshNodeFlags` 里 `setReference` 用固定蓝色在几何同一位置再画一遍有曲线的输入，会盖掉原色。建议：refs 只画当前未显示的几何，或放到主几何下层 / 仅 wireframe 显示模式使用，或按各自输入真实颜色上色。
2. **debug box 入口**：B 键会添加与 output 红 / in0 蓝同色的盒子，容易误判；建议换明显不同的调试色（如黄/品红）并默认彻底隐藏。
3. **日志即时性**：`pushLogSilent` 的 `[viewport]` 行要等下一次 emit 才出现在 `.cyl-log`（40 行窗口）。若想即时可见，可给 viewport 日志单独渲染通道，但要注意 e2e 对 `.cyl-log` 内容（`hello`）的 40 行窗口依赖。
4. **e2e 脆弱点**：smoke 断言 `.cyl-log` 含 `hello`，日志一多就会被挤出 40 行窗口（与本次修复无关的既有脆弱点），建议改为断言 status ok + inspector 内容。

## 7. 改动文件清单
- `web/src/main.ts`：`refreshNodeFlags()` 改为按端口显示（null→`getDisplayPortIndex()`，output 无数据不再回退 inputs）。
- `web/src/nodes2/graph.ts`：新增 `getDisplayPortIndex()`（接口 + 实现）。
- 测试 serial（新增，可在调试后删除）：`C1-msnd1p81-68mp`、`C1-msndcvcu-kj1k`。
---

## v0.1.00037 ???2026-08-11???? viewport/nodeview ??

### A. 4 ??????node graph ????? viewport ?????
- ???node view ????? 4 ??????? `_input_`/`_output_` ??????
- ????? `scene/node-graph.json` ?? **1 ?? + 4 ????**?source/target ???????? id??rete2 `editor.removeNode()` ??????????????? ? `restoreGraph` ????????"????"?`serializeGraph` ???????? ? ?????
- ???`restoreGraph` ? `removeConnection` ??**??**?????????`serializeGraph` ????????????????????? serial???? 1 ??/4 ?? conns???????=0????????
- ??????/???"????"???????????? removeNode ?????????????????????

### B. ??????????/? dock ??
- ????????????? docking ????????????
- ???`.cyl-mode-menu` ? `position: absolute`?left/top ? `getBoundingClientRect()`??????? ????????????? dock ?? overflow ?????
- ???`position: fixed`??????????????? pointerdown ?????pointerup ?? >4px ???"??"????????????"??"????????/?????????? toggle??
- ???`document` ???? pointerdown ??????? modeBtn ????????????? document ???

### C. ????? fov fake??????
- ??wheel/Alt+?? ? `cam.zoom` ? updateProjectionMatrix?fov ?????????"????"????????
- ??`dollyCamera()` ????????????0.2~200 ????wheel `delta*0.02`?Alt+?? `delta*0.5`?`cam.zoom` ? 1?? AHS ?????

### D. display ???????
- `_input_` display ? `setDisplayFocus("inputs", 0)`???? in0??`_output_` display ? `setDisplayFocus("outputs", 0)`????? `_input_` ?? ? ???? in0????????

### E. ?? 4 ??????
- 14x14 ????chips ?? `margin:-4px -6px 0 6px` ?????????? chip `border-top-right-radius:6px` ???????
- ??`.cyl-rp-head` ???????? 113 ? + ???? 219 ????? `align-items:center` ???? ? ????**??**?flex-start????? margin ???chip ?????
- display ? ring?`box-shadow 0 0 0 1px #60a5fa`????????`.displayed.selected` ???????0,2,0?? ? ring + ???? `rgba(253,224,71,.4)` ?????`.selected` ???????????
---

## v0.1.00038 ???2026-08-11???? dolly ??
- ???? ??????/????????? ???????????????
- ???`web/src/viewport/controls.ts` `dollyCamera`????? `dir = target - cam.position`?? dist<0.001 ?? return????????? dist ?? 0 ? `dir.normalize()` ?????? **NaN** ? ???? NaN ? ???????????? 0.2 ????????"???"?"????"?????
- ???dist<1e-4 ??? `cam.getWorldDirection().negate()`??? NaN????? `cam.position = target + dir * (-next)`?`next = clamp(dist - amount, 0.05, 500)`???????????fov/zoom ?????
- ???wheel-in 200 ??? 5.41?0.05 ??????????wheel-out 400 ? 2.45?500 ???cam.zoom ? 1?
- ???dolly ?????"????"??????position ? target+dir*dist ????????????????????????????
