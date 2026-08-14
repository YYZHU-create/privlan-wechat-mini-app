param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\backups")
)

$ErrorActionPreference = "Stop"
if (-not $env:DATABASE_URL) { throw "DATABASE_URL is required." }
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) { throw "pg_dump was not found in PATH." }

$resolved = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($resolved) | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$backup = Join-Path $resolved "atelier-os-$stamp.dump"

& pg_dump --dbname $env:DATABASE_URL --format custom --no-owner --file $backup
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backup)) { throw "pg_dump failed with exit code $LASTEXITCODE." }

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $backup).Hash.ToLowerInvariant()
$manifest = [ordered]@{ createdAt = (Get-Date).ToUniversalTime().ToString("o"); file = [System.IO.Path]::GetFileName($backup); sha256 = $hash; bytes = (Get-Item -LiteralPath $backup).Length }
$manifestPath = "$backup.manifest.json"
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output $backup
Write-Output $manifestPath
