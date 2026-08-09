# Installs the Houdini MCP plugin (fork) into the user Houdini prefs dir (houdini22.0).
# Run in PowerShell:  powershell -ExecutionPolicy Bypass -File mcp\install_houdini_plugin.ps1
$ErrorActionPreference = "Stop"

$src = "C:\Users\Administrator\Documents\Codex\tools\houdini-mcp-codex-windows-stdio-fixes\houdini_plugin"
$dst = Join-Path $env:USERPROFILE "Documents\houdini22.0"

if (-not (Test-Path $src)) { Write-Error "plugin source not found: $src"; exit 1 }

New-Item -ItemType Directory -Force -Path (Join-Path $dst "python")  | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dst "toolbar") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dst "packages") | Out-Null

Copy-Item (Join-Path $src "python") $dst -Recurse -Force
Copy-Item (Join-Path $src "toolbar") $dst -Recurse -Force
Copy-Item (Join-Path $src "houdini_mcp.json") (Join-Path $dst "packages\houdini_mcp.json") -Force

Write-Output "Houdini MCP plugin installed to $dst"
Write-Output "Next: restart Houdini, open shelf 'Houdini MCP' -> Start Remote (port 18811)."
Write-Output "Then verify from Codex: cyl1nder_ping equivalent -> ping_houdini / get_scene_info."