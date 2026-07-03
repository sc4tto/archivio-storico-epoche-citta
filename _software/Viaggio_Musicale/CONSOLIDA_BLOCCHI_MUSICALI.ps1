param(
  [string]$ArchiveRoot = "C:\Users\miche\Desktop\Archivio_storico_epoche_citta"
)

$ErrorActionPreference = "Stop"

function Write-Utf8Bom {
  param(
    [string]$Path,
    [string]$Content
  )

  $Encoding = New-Object System.Text.UTF8Encoding($true)
  [System.IO.File]::WriteAllText($Path, $Content, $Encoding)
}

function Backup-File {
  param(
    [string]$Path,
    [string]$ArchiveRoot,
    [string]$BackupRoot
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return
  }

  $Relative = [System.IO.Path]::GetFullPath($Path).Substring(
    [System.IO.Path]::GetFullPath($ArchiveRoot).Length
  ).TrimStart("\")

  $Destination = Join-Path $BackupRoot $Relative
  $DestinationDirectory = Split-Path -Parent $Destination

  New-Item `
    -ItemType Directory `
    -Path $DestinationDirectory `
    -Force |
  Out-Null

  Copy-Item `
    -LiteralPath $Path `
    -Destination $Destination `
    -Force
}

$ArchiveRoot = [System.IO.Path]::GetFullPath($ArchiveRoot)
$SoftwareRoot = Join-Path $ArchiveRoot "_software\Viaggio_Musicale"

if (-not (Test-Path -LiteralPath $SoftwareRoot -PathType Container)) {
  Write-Error ("Viaggio_Musicale non trovato: " + $SoftwareRoot)
  exit 2
}

$CatalogScript = Join-Path $SoftwareRoot "scripts\AGGIORNA_CATALOGO.ps1"
$IndexScript = Join-Path $SoftwareRoot "scripts\AGGIORNA_INDICE_PROFILI_CENTRI.ps1"

foreach ($Required in @($CatalogScript, $IndexScript)) {
  if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) {
    Write-Error ("Script ufficiale non trovato: " + $Required)
    exit 3
  }
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $SoftwareRoot (
  "backups\consolidamento-musicale-" + $Timestamp
)

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null

$GeneratedFiles = @(
  (Join-Path $SoftwareRoot "generated\catalog.js"),
  (Join-Path $SoftwareRoot "generated\center-music-index.js"),
  (Join-Path $SoftwareRoot "generated\center-music-index.json")
)

foreach ($GeneratedFile in $GeneratedFiles) {
  Backup-File `
    -Path $GeneratedFile `
    -ArchiveRoot $ArchiveRoot `
    -BackupRoot $BackupRoot
}

Write-Host "============================================================"
Write-Host "CONSOLIDAMENTO GLOBALE — VIAGGIO MUSICALE"
Write-Host "============================================================"
Write-Host ""
Write-Host "Questa operazione esegue le scansioni globali ufficiali."
Write-Host "Può richiedere diversi minuti."
Write-Host ""

Write-Host "[1/2] Ricostruzione globale del catalogo..." -ForegroundColor Cyan

& powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File $CatalogScript `
  -ArchiveRoot $ArchiveRoot

if ($LASTEXITCODE -ne 0) {
  Write-Error (
    "AGGIORNA_CATALOGO.ps1 non riuscito. Codice: " +
    $LASTEXITCODE
  )
  exit 4
}

Write-Host "[2/2] Ricostruzione globale dell'indice dei profili..." -ForegroundColor Cyan

& powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File $IndexScript `
  -ArchiveRoot $ArchiveRoot

if ($LASTEXITCODE -ne 0) {
  Write-Error (
    "AGGIORNA_INDICE_PROFILI_CENTRI.ps1 non riuscito. Codice: " +
    $LASTEXITCODE
  )
  exit 5
}

$CatalogCount = 0
$ScaleCount = 0
$ProfileCount = 0
$RejectedCount = 0
$ErrorCount = 0

$CatalogPath = Join-Path $SoftwareRoot "generated\catalog.js"
$IndexPath = Join-Path $SoftwareRoot "generated\center-music-index.json"

try {
  $CatalogText = [System.IO.File]::ReadAllText(
    $CatalogPath,
    [System.Text.Encoding]::UTF8
  )

  $CatalogText = [System.Text.RegularExpressions.Regex]::Replace(
    $CatalogText,
    "^\s*window\.ARCHIVE_CATALOG\s*=\s*",
    ""
  )

  $CatalogText = [System.Text.RegularExpressions.Regex]::Replace(
    $CatalogText,
    ";\s*$",
    ""
  )

  $Catalog = $CatalogText | ConvertFrom-Json
  $CatalogCount = @($Catalog.containers).Count
  $ScaleCount = [int]$Catalog.stats.scales
}
catch {
}

try {
  $Index = Get-Content `
    -LiteralPath $IndexPath `
    -Raw `
    -Encoding UTF8 |
  ConvertFrom-Json

  $ProfileCount = @($Index.profiles).Count
  $RejectedCount = @($Index.rejected).Count
  $ErrorCount = (
    @($Index.errors).Count +
    @($Index.container_errors).Count
  )
}
catch {
}

$ReportPath = Join-Path $SoftwareRoot (
  "generated\RAPPORTO_CONSOLIDAMENTO_GLOBALE_" +
  $Timestamp +
  ".txt"
)

$Report = @"
CONSOLIDAMENTO GLOBALE — VIAGGIO MUSICALE
=========================================

Data:
$((Get-Date).ToString("o"))

Archivio:
$ArchiveRoot

Backup:
$BackupRoot

Contenitori:
$CatalogCount

Scale o sistemi:
$ScaleCount

Profili ammessi:
$ProfileCount

Profili respinti:
$RejectedCount

Errori:
$ErrorCount

Esito:
COMPLETATO

Metodo:
Rigenerazione completa mediante gli script ufficiali della repository.
"@

Write-Utf8Bom -Path $ReportPath -Content $Report

Write-Host ""
Write-Host "Consolidamento completato." -ForegroundColor Green
Write-Host ("Contenitori: " + $CatalogCount)
Write-Host ("Scale o sistemi: " + $ScaleCount)
Write-Host ("Profili ammessi: " + $ProfileCount)
Write-Host ("Profili respinti: " + $RejectedCount)
Write-Host ("Errori: " + $ErrorCount)
Write-Host ("Rapporto: " + $ReportPath)
Write-Host ("Backup: " + $BackupRoot)
Write-Host ""

Start-Process -FilePath $ReportPath

if ($RejectedCount -gt 0 -or $ErrorCount -gt 0) {
  exit 6
}

exit 0
