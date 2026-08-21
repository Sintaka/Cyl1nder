# 沙箱与运行环境实测事实（按需查阅）

> 从 `development-standards.md` 拆出（v0.1.00182）——它们是**遇到才需要**的具体事实，
> 不该占每轮的上下文预算。**触发条件**：要写 `.mjs` 编排脚本、要用 `spawnSync`
> 读子进程输出、要定退出码、或 git 命令行为反常时，来查这里。
> 全部为实测结论，不是推测。

---

### 附：`git <cmd> ... -- <path> --output=<file>` 里的 `--output=` 会被当成**路径**（2026-08-21 实测）
我想把 diff 落盘再读，写成：
```powershell
git diff eaacadc..HEAD -- bridge/bridge/protocol.py --output=$out   # 错
```
结果：**没有生成任何文件**（`Get-Content` 报路径不存在），diff 照常打到 stdout。
原因：`--` 之后的一切都是 **pathspec**，`--output=...` 被当成了一个（不存在的）文件名去匹配。

正确写法是把选项放到 `--` **之前**：
```powershell
git diff eaacadc..HEAD --output=$out -- bridge/bridge/protocol.py   # 对
```
**教训**：`--` 是硬边界，它后面**不再有选项**。同类还有
`git log --output=... -- <path>`。这个错误**不报错**，只是静默不生成文件 ——
如果我当时用 `if (Test-Path $out)` 之类去兜，就会得到一个"看起来什么都没查到"的假阴性。

### 附：发过 `AbortSignal.timeout()` 之后别用 `process.exit()`（Node v24 / Windows 实测）
`probe-live.mjs` 第一版在打印完汇总后 `process.exit(0)`，进程**崩在 libuv 断言**上：
```
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c
退出码 -1073740791
```
每一项检查其实都已正确完成、汇总也算好了 —— **崩的是退出那一步**。
根因：`AbortSignal.timeout()` 留下的定时器 handle 还在关闭流程中，
此时 `process.exit()` 强行斩断事件循环，触发竞态。实测 Node **v24.14.0** 必现。

**纪律**：
- 脚本里**发过任何异步请求/定时器之后**，用 `process.exitCode = N` 让事件循环自然耗尽，
  **不要 `process.exit(N)`**；
- **纯同步的早退可以照旧用 `process.exit()`** —— 例如参数解析失败、
  「环境不满足前提、一个请求都还没发」这种（`probe-live.mjs:53` 与 `:120` 就是故意保留的）。
  判据是「此刻有没有在飞的 handle」，不是「哪个写法更好」。
- **别拿「没有异步 handle」的实验去否证这个现象**：我自己写了
  「40 条 `console.log` + `process.exit(0)`」的探针，一条不少地通过了，
  于是我判定「flush 假设被否证」—— 但那个探针**压根没有在飞的定时器**，
  测的不是同一件事。**反证探针必须包含被怀疑的那个变量。**

### 附：`$Args` 是自动变量，当参数名会被遮蔽成空数组（2026-08-21 实测）
`release-step.ps1` 第一版打印了全部 6 步、`== 6/6 完成 ==`、**exit 0**，
但**什么都没做**：版本号没变、三份索引一个没生成。**又一次谎报成功，这次长在工具里。**

根因是这个签名：
```powershell
function Invoke-NodeStep([string]$Label, [string[]]$Args) { & node @Args }
```
`$Args` 是 PowerShell **自动变量**，声明成参数会被遮蔽。实测：
```
Bad(参数名 $Args)     -> Args.Count=0     content=[]
Good(参数名 $NodeArgs) -> NodeArgs.Count=2 content=[scripts/bump-version.mjs,build]
```
于是 `& node @Args` 退化成裸 `& node`，而**裸 `node` 在非交互下 exit 0**（实测 `bare node exit=[0]`）
—— 每一步都「成功」。

**纪律**：
- 别用 `$Args`（也别用 `$Input`/`$Host`/`$Error`/`$Matches`）当参数名；
- **判定外部命令成功要同时看「参数数组非空」**：空参数跑起来也可能 exit 0；
- `pwsh -File` **不会**把子命令退出码带出去（实测 `INNER_EXIT=1` 而 `OUTER_EXIT=0`），
  想让外层看见必须显式 `exit $code`；
- 脚本写完**必须验它真的改了东西**（版本号变了没、索引文件的 mtime 动了没），
  **不能只看它自报的 exit 0** —— 这与「只见过它说 OK 的检测器等于没测过」是同一条。
