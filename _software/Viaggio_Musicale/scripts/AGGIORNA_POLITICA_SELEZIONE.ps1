param(
  [string]$SoftwareRoot = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($SoftwareRoot)) {
  $SoftwareRoot = Join-Path $PSScriptRoot ".."
}

$SoftwareRoot = [System.IO.Path]::GetFullPath($SoftwareRoot)
$PolicyPath = Join-Path $SoftwareRoot "config\selection-policy.json"
$GeneratedDirectory = Join-Path $SoftwareRoot "generated"
$GeneratedPath = Join-Path $GeneratedDirectory "selection-policy.js"

if (-not (Test-Path -LiteralPath $PolicyPath -PathType Leaf)) {
  Write-Error ("Selection policy not found: " + $PolicyPath)
  exit 2
}

try {
  $Policy = Get-Content `
    -LiteralPath $PolicyPath `
    -Raw `
    -Encoding UTF8 |
  ConvertFrom-Json
}
catch {
  Write-Error ("Selection policy is invalid: " + $_.Exception.Message)
  exit 3
}

New-Item -ItemType Directory -Path $GeneratedDirectory -Force | Out-Null

$Json = $Policy | ConvertTo-Json -Depth 30
$JavaScript = "window.SELECTION_POLICY = " + $Json + ";"

Set-Content `
  -LiteralPath $GeneratedPath `
  -Value $JavaScript `
  -Encoding UTF8

Write-Host (
  "Selection policy updated. Default mode: " +
  [string]$Policy.default_mode
)

exit 0
