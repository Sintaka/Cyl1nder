# check-staged.ps1 — 提交前卫生检查（只看**新增行**，按文件类型分别判据）
# Usage: pwsh -File scripts\check-staged.ps1
#
# 为什么要有这个脚本：我在会话里手搓的那版 grep（直接在整个 staged diff 里找
# `chars omitted` / `MUTATION` / `??`）**三次误报**，最后一次我甚至在它打红之后照样
# 提交了 —— 因为命中的全是 devlog 散文里**描述这些检查本身**的字。
#
# **一个被训练成可以忽略的检查，比没有检查更坏。** 所以判据必须精确到"红了就一定有事"：
#   1. 只看**新增行**（`^+`），删除行与上下文不算 —— 移除一个坏字符不该报红；
#   2. 散文与代码分开：devlog/*.md 允许谈论这些标记，代码文件不允许；
#   3. 截断标记按**真实形态**判（`...[数字 chars omitted]...`），不是任意出现这三个词；
#   4. 乱码按**真实形态**判（3 个以上连续 `?`）—— JS 的 `??` 运算符和散文引用它都是合法的。

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path $env:TEMP "cyl-staged-$PID.diff"
$problems = @()

# **绝不把 git 的 stdout 接进管道**：本环境下 `& git … | Out-File` 会直接撞
# 「Program 'git.exe' failed to run: 拒绝访问 / StandardOutputEncoding …」。
# 改用 git 自己的 `--output=`（它自己写文件，全程没有管道）——本脚本第一版就是
# 栽在这里：跑到提交关口才炸，而当时它把这个失败报成了 exit 1（= 发现问题），
# 我差点以为真有卫生问题。
# **必须 try/catch 包住**：顶部 `$ErrorActionPreference = "Stop"` 会把「找不到可执行文件」
# 变成**终止性**错误，PowerShell 直接以它自己的 exit 1 退出 —— 下面那个 exit 3 分支
# 根本到不了。实测过：把 git 换成不存在的名字，得到的是 **1 而不是 3**，
# 也就是"工具坏了"又一次伪装成"发现问题"。这正是本脚本要消灭的那种含混。
$gitCode = 0
try {
  & git -C $root diff --cached "--output=$tmp"
  $gitCode = $LASTEXITCODE
} catch {
  Write-Host "TOOL FAILURE —— git 无法执行：$($_.Exception.Message)" -ForegroundColor Red
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  exit 3
}
if ($gitCode -ne 0 -or -not (Test-Path $tmp)) {
  Write-Host "TOOL FAILURE —— git diff 没跑成（exit $gitCode）；这**不是**卫生结论，别当成通过或失败" -ForegroundColor Red
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  exit 3   # 3 = 工具自身失败，与 1（发现问题）严格区分
}
$lines = Get-Content $tmp -Encoding utf8 -ErrorAction SilentlyContinue
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

if ($null -eq $lines -or $lines.Count -eq 0) {
  # 空 diff 同样按 VACUOUS 处理（与下面 addedCount 那条同一条理由）：
  # 什么都没暂存时说"通过"，等于给一次空检查发合格证。
  Write-Host "VACUOUS —— staged diff 为空，没有东西可检查，不构成通过" -ForegroundColor Yellow
  exit 2
}

# 逐行走，跟踪当前文件；只在「新增行」上判据
$file = ""
$isProse = $false
$isSelf = $false
$addedCount = 0
foreach ($ln in $lines) {
  if ($ln -like "+++ b/*") {
    $file = $ln.Substring(6)
    $isProse = ($file -like "devlog/*") -or ($file -like "*.md")
    # **本脚本自己必须豁免**：它的判据字符串与注释里必然含有它要找的那些形态。
    # 第一次跑就撞到了这个（它把自己判红 2 处）—— 那不是 bug，是"检查器必然包含
    # 自己的模式"这条固有性质。豁免范围**只限本文件**，不是整个 scripts/。
    $isSelf = ($file -like "*check-staged.ps1")
    continue
  }
  if ($isSelf) { continue }
  if ($ln -like "--- *") { continue }
  # BOM 被吃掉：删除行以 BOM 开头（这条**只看删除行**，与其余相反）
  if ($ln -match "^-\uFEFF") { $problems += "BOM 被移除: $file" ; continue }
  if (-not $ln.StartsWith("+")) { continue }
  if ($ln.StartsWith("+++")) { continue }
  $addedCount++
  $body = $ln.Substring(1)

  # 引用行（Markdown 代码块/行内代码/引言）在散文里是**在谈论**这些形态，不是犯了它们。
  # 判据：散文文件里，行内含反引号、或以缩进/`>`/表格竖线开头 —— 这些是"引用"的标志。
  # 实测教训：我第一版只给 MUTATION 开了散文豁免，忘了截断与乱码两条，于是本文件
  # 记录金丝雀输出时**又被自己判红两次** —— 与它要消灭的误报是同一类。
  $isQuoted = $isProse -and ($body -match '`' -or $body -match '^\s*[>|]' -or $body -match '^\s{4,}' -or $body -match '←')

  # 1) 写工具静默截断的真实形态：...[1234 chars omitted]...
  if (-not $isQuoted -and $body -match '\[\d+\s+chars\s+omitted\]') {
    $problems += "写工具截断残留: $file :: $($body.Trim())"
  }
  # 2) 变异测试标记：只在代码文件里算问题（散文要能讨论它）
  if (-not $isProse -and $body -match 'MUTATION[- ]?TEST|MUTATION ONLY') {
    $problems += "变异测试标记残留: $file :: $($body.Trim())"
  }
  # 3) 中文乱码的真实形态：3 个以上连续 ?（`??` 运算符与散文引用都放过）
  if (-not $isQuoted -and $body -match '\?{3,}') {
    $problems += "疑似中文乱码: $file :: $($body.Trim())"
  }
}

Write-Host "扫过 $addedCount 行新增内容" -ForegroundColor Cyan
if ($problems.Count -eq 0) {
  # **空扫描不许报绿**：0 行意味着这次检查什么都没看，说"OK"就是在撒谎 ——
  # 本会话踩过一次：手搓检查里 git 没跑成、`$d` 是空串，两条判据都"通过"了。
  # 一个在什么都没检查时也说 OK 的检查器，正是它自己要防的那种谎报。
  if ($addedCount -eq 0) {
    Write-Host "VACUOUS —— 没有可检查的新增行（全部文件被豁免或 diff 为空），本次不构成通过" -ForegroundColor Yellow
    exit 2
  }
  Write-Host "HYGIENE OK" -ForegroundColor Green
  exit 0
}
Write-Host "发现 $($problems.Count) 个问题：" -ForegroundColor Red
$problems | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
exit 1
