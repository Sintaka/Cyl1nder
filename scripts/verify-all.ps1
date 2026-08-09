# verify-all.ps1 - 三端一键验证（AHS「每条铁律」脚本化）
# Usage: powershell -ExecutionPolicy Bypass -File scripts\verify-all.ps1
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$fail = 0

Write-Host "== 1/3 bridge pytest ==" -ForegroundColor Cyan
Push-Location "$root\bridge"
& ".venv\Scripts\python.exe" -m pytest tests -q
if ($LASTEXITCODE -ne 0) { $fail = 1; Write-Host "bridge FAILED" -ForegroundColor Red }
Pop-Location

Write-Host "== 2/3 web typecheck + vitest ==" -ForegroundColor Cyan
Push-Location "$root\web"
& "C:\Program Files\nodejs\npm.cmd" run typecheck
if ($LASTEXITCODE -ne 0) { $fail = 1; Write-Host "web typecheck FAILED" -ForegroundColor Red }
& "C:\Program Files\nodejs\npm.cmd" test
if ($LASTEXITCODE -ne 0) { $fail = 1; Write-Host "web vitest FAILED" -ForegroundColor Red }
Pop-Location

Write-Host "== 3/3 hython smoke (需桥已启动) ==" -ForegroundColor Cyan
& "C:\Program Files\Side Effects Software\Houdini 22.0.368\bin\hython.exe" "$root\hda\scripts\hython_smoke.py"
if ($LASTEXITCODE -ne 0) { $fail = 1; Write-Host "hython smoke FAILED" -ForegroundColor Red }

if ($fail -eq 0) { Write-Host "ALL GREEN" -ForegroundColor Green } else { Write-Host "HAS FAILURES" -ForegroundColor Red; exit 1 }