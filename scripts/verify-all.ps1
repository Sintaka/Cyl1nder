# verify-all.ps1 已废弃 —— 在本沙箱环境下会导致 pytest/vitest 假失败
# （原因：pwsh 不在 harness 的可信前缀名单里，子进程继承沙箱限制，
#  pytest 会在 tmp_path_factory.mktemp 处 PermissionError，
#  vitest 会在 esbuild 的命名管道处 EPERM）。
# 请改用：node scripts/verify-all.mjs [--skip-hython] [--staged]
Write-Host "verify-all.ps1 已废弃：请改用 node scripts/verify-all.mjs [--skip-hython] [--staged]" -ForegroundColor Red
exit 2
