param([string]$Source = "BASELINE_FILE", [string]$Target = "MODIFIED_FILE")
Set-StrictMode -Version Latest
$sourcePath = [IO.Path]::GetFullPath($Source)
$targetPath = [IO.Path]::GetFullPath($Target)
Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
Write-Output "ROLLBACK_RESULT=PASS; restored=$targetPath from=$sourcePath"
