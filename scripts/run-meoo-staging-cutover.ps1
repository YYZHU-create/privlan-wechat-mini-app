[CmdletBinding()]
param(
  [ValidateSet('preflight','apply-target-schema','migrate')]
  [string]$Mode = 'preflight',
  [ValidateSet('PRE_T2','POST_T2_PRE_AUTHORITATIVE','POST_AUTHORITATIVE')]
  [string]$Phase,
  [Parameter(Mandatory = $true)]
  [string]$TargetProjectId,
  [string]$SourceEnvPath = "$env:LOCALAPPDATA\AtelierOS\Secrets\staging-postgres.env"
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = Get-Command node -ErrorAction Stop
if ((Split-Path -Leaf $SourceEnvPath) -eq 'runtime-secrets.json') { throw 'CUTOVER_SOURCE_SECRET_REJECTED' }
if (-not (Test-Path -LiteralPath $SourceEnvPath)) { throw 'CUTOVER_SOURCE_SECRET_MISSING' }

$line = Get-Content -LiteralPath $SourceEnvPath | Where-Object { $_ -match '^(?:export\s+)?ATELIER_REAL_POSTGRES_URL=' } | Select-Object -First 1
if (-not $line) { throw 'CUTOVER_SOURCE_SECRET_VARIABLE_MISSING' }
$value = ($line -replace '^(?:export\s+)?ATELIER_REAL_POSTGRES_URL=', '').Trim()
if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) { $value = $value.Substring(1, $value.Length - 2) }
if (-not $value) { throw 'CUTOVER_SOURCE_SECRET_VALUE_INVALID' }

$previous = $env:ATELIER_REAL_POSTGRES_URL
try {
  $env:ATELIER_REAL_POSTGRES_URL = $value
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  $phaseArg = if ($Phase) { "--phase=$Phase" } else { $null }
  $args = @('admin/meoo-staging-cutover.js', "--$Mode", "--target-project=$TargetProjectId")
  if ($phaseArg) { $args += $phaseArg }
  & $node.Source @args
  exit $LASTEXITCODE
} finally {
  if ($null -eq $previous) { Remove-Item Env:ATELIER_REAL_POSTGRES_URL -ErrorAction SilentlyContinue }
  else { $env:ATELIER_REAL_POSTGRES_URL = $previous }
}