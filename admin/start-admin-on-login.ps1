$ErrorActionPreference = "SilentlyContinue"
$adminRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 3456

# Do not start a second copy when the development server is already running.
$listener = Get-NetTCPConnection -LocalPort $port -State Listen | Select-Object -First 1
if ($listener) { exit 0 }

$nodeExe = "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) { $nodeExe = $nodeCommand.Source }
}
if (-not (Test-Path -LiteralPath $nodeExe)) { exit 1 }

Start-Process -FilePath $nodeExe -ArgumentList "server.js" -WorkingDirectory $adminRoot -WindowStyle Hidden
