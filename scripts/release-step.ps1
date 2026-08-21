# release-step.ps1 — 已废弃。旧版辅助函数把参数声明成 $Args（PowerShell
# 自动变量同名遮蔽成空数组），导致 & node @Args 退化成裸 node，裸调用在
# 非交互下 exit 0，于是全部 6 步"假装成功"但什么都没做（版本号未变、索引未重生成）。
# 加上 pwsh 编排在本沙箱下不可信（子进程继承限制，见 development-standards.md），
# 该实现已整体移植为 scripts/release-step.mjs，此文件仅打印提示，不再自动转发执行。
Write-Host "release-step.ps1 已废弃，请改用：node scripts/release-step.mjs" -ForegroundColor Red
exit 2
