[CmdletBinding()]
param(
  [string]$HealthUrl = "",
  [switch]$RequireProductionValues
)
$ErrorActionPreference = "Stop"
$required = @(
  "ATELIER_LICENSE_PEPPER", "ATELIER_MASTER_KEY", "ATELIER_OPS_EMAIL",
  "ATELIER_OPS_PASSWORD", "ATELIER_APPOINTMENT_GATEWAY_TOKEN", "ATELIER_OPENID_HASH_KEY"
)
$results = [ordered]@{}
function EnvValue([string]$Name) {
  $item = Get-Item ("Env:" + $Name) -ErrorAction SilentlyContinue
  if ($item) { return [string]$item.Value }
  return ""
}
function Check([string]$Name, [bool]$Ok, [string]$Detail) {
  $status = if ($Ok) { "PASS" } else { "NOT_READY" }
  $results[$Name] = [ordered]@{ status = $status; detail = $Detail }
  Write-Output ("{0}={1} :: {2}" -f $Name, $status, $Detail)
}
$branch = (git branch --show-current 2>$null).Trim()
$sha = (git rev-parse HEAD 2>$null).Trim()
Check "SOURCE_COMMIT" ($sha -match '^[0-9a-f]{40}$') ("sha=" + $sha + "; branch=" + $branch)
Check "AUTO_MIGRATE_STEADY_STATE" ((EnvValue "ATELIER_AUTO_MIGRATE") -eq "0") ("ATELIER_AUTO_MIGRATE=" + (EnvValue "ATELIER_AUTO_MIGRATE"))
Check "LEGACY_FALLBACK_DISABLED" ((EnvValue "PRIVLAN_LEGACY_FALLBACK") -eq "0") ("PRIVLAN_LEGACY_FALLBACK=" + (EnvValue "PRIVLAN_LEGACY_FALLBACK"))
Check "GIT_SYNC_DISABLED" ((EnvValue "PRIVLAN_DISABLE_GIT_SYNC") -eq "1") ("PRIVLAN_DISABLE_GIT_SYNC=" + (EnvValue "PRIVLAN_DISABLE_GIT_SYNC"))
$missing = @($required | Where-Object { [string]::IsNullOrWhiteSpace((EnvValue $_)) })
Check "PRODUCTION_SECRET_PRESENCE" ($missing.Count -eq 0) ("missing_count=" + $missing.Count)
$meoo = (EnvValue "ATELIER_DB_BACKEND").ToLowerInvariant() -eq "meoo"
$dbOk = $false
if ($meoo) {
  $dbOk = ((EnvValue "SUPABASE_URL") -match '^https://') -and -not [string]::IsNullOrWhiteSpace((EnvValue "SUPABASE_SERVICE_ROLE_KEY"))
} else {
  $dbOk = (EnvValue "DATABASE_URL") -match '^postgres(?:ql)?://'
}
if ($meoo) { $dbDetail = "backend=meoo; URL/key presence checked" } else { $dbDetail = "backend=native; DATABASE_URL format checked" }
Check "DATABASE_CONFIGURATION" $dbOk $dbDetail
if ($HealthUrl) {
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 20; Check "HEALTH_ENDPOINT" ($r.StatusCode -eq 200) ("HTTP=" + $r.StatusCode) }
  catch { Check "HEALTH_ENDPOINT" $false "request failed" }
} else { Check "HEALTH_ENDPOINT" $false "HealthUrl not supplied" }
foreach ($tool in @("docker", "pg_dump", "pg_restore")) {
  $available = $null -ne (Get-Command $tool -ErrorAction SilentlyContinue)
  Check ("TOOL_" + $tool.ToUpperInvariant()) $available ("available=" + $available)
}
$notReady = @($results.Values | Where-Object { $_.status -eq "NOT_READY" }).Count
if ($notReady -eq 0) { Write-Output "PRODUCTION_READINESS_CHECK=PASS" } else { Write-Output "PRODUCTION_READINESS_CHECK=NOT_READY" }
if ($RequireProductionValues -and $notReady -gt 0) { exit 2 }
exit 0
