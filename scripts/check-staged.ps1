# check-staged.ps1 —— 已废弃（2026-08-21），请改用：
#   node scripts/check-hygiene.mjs
# 新版是 .mjs（pwsh 不在沙箱可信前缀名单），且多查一条本脚本查不到的东西：
# 工作树里夹在文件中间的游离 U+FEFF（旧版只看 staged diff，查不到已提交的）。
Write-Host "check-staged.ps1 已废弃，请改用：node scripts/check-hygiene.mjs" -ForegroundColor Yellow
exit 2
