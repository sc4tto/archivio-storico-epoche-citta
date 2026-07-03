param(
  [string]$ArchiveRoot = ""
)

$ErrorActionPreference = "Stop"

function Write-JsonUtf8Bom {
  param(
    [string]$Path,
    [object]$Value
  )

  $json = ConvertTo-Json -InputObject $Value -Depth 100
  $encoding = New-Object System.Text.UTF8Encoding($true)
  [System.IO.File]::WriteAllText($Path, $json, $encoding)
}

function Set-ArrayProperty {
  param(
    [object]$Object,
    [string]$Name
  )

  if ($null -eq $Object) {
    return
  }

  $current = $null
  $property = $Object.PSObject.Properties[$Name]

  if ($null -ne $property) {
    $current = $property.Value
  }

  $Object |
    Add-Member `
      -NotePropertyName $Name `
      -NotePropertyValue ([object[]]@($current)) `
      -Force
}

function Backup-SourceFile {
  param(
    [string]$Path,
    [string]$ArchiveRoot,
    [string]$BackupRoot
  )

  $relative = $Path.Substring(
    $ArchiveRoot.Length
  ).TrimStart("\")

  $destination = Join-Path $BackupRoot $relative
  $destinationDirectory = Split-Path -Parent $destination

  New-Item `
    -ItemType Directory `
    -Path $destinationDirectory `
    -Force |
  Out-Null

  Copy-Item `
    -LiteralPath $Path `
    -Destination $destination `
    -Force
}

if ([string]::IsNullOrWhiteSpace($ArchiveRoot)) {
  $ArchiveRoot = Join-Path $PSScriptRoot "..\..\.."
}
else {
  $ArchiveRoot = ([string]$ArchiveRoot).Trim().Trim('"')
}

$ArchiveRoot = [System.IO.Path]::GetFullPath($ArchiveRoot)

if (-not (Test-Path -LiteralPath $ArchiveRoot -PathType Container)) {
  Write-Error ("Archivio non trovato: " + $ArchiveRoot)
  exit 2
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$SoftwareRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot "..")
)
$BackupRoot = Join-Path $SoftwareRoot (
  "backups\array-normalization-v2-" +
  $Timestamp
)

$ChangedFiles = New-Object System.Collections.ArrayList
$Warnings = New-Object System.Collections.ArrayList

$ProfileFiles = @(
  Get-ChildItem `
    -LiteralPath $ArchiveRoot `
    -Recurse `
    -File `
    -Filter "musica-centro.json" `
    -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -match "[\\/]dati[\\/]musica_documentata[\\/]"
  }
)

foreach ($ProfileFile in $ProfileFiles) {
  try {
    $Profile = Get-Content `
      -LiteralPath $ProfileFile.FullName `
      -Raw `
      -Encoding UTF8 |
    ConvertFrom-Json

    Backup-SourceFile `
      -Path $ProfileFile.FullName `
      -ArchiveRoot $ArchiveRoot `
      -BackupRoot $BackupRoot

    Set-ArrayProperty -Object $Profile -Name "musical_evidence"
    Set-ArrayProperty -Object $Profile -Name "tradition_links"
    Set-ArrayProperty -Object $Profile -Name "scale_links"
    Set-ArrayProperty -Object $Profile -Name "documents"
    Set-ArrayProperty -Object $Profile -Name "sources"
    Set-ArrayProperty -Object $Profile -Name "notes"

    foreach ($link in @($Profile.tradition_links)) {
      Set-ArrayProperty -Object $link -Name "source_ids"
    }

    foreach ($link in @($Profile.scale_links)) {
      Set-ArrayProperty -Object $link -Name "source_ids"
    }

    foreach ($evidence in @($Profile.musical_evidence)) {
      Set-ArrayProperty -Object $evidence -Name "source_ids"
    }

    Write-JsonUtf8Bom `
      -Path $ProfileFile.FullName `
      -Value $Profile

    [void]$ChangedFiles.Add(
      $ProfileFile.FullName.Substring(
        $ArchiveRoot.Length
      ).TrimStart("\")
    )
  }
  catch {
    [void]$Warnings.Add(
      "PROFILO | " +
      $ProfileFile.FullName +
      " | " +
      $_.Exception.Message
    )
  }
}

$ContainerFiles = @(
  Get-ChildItem `
    -LiteralPath $ArchiveRoot `
    -Recurse `
    -File `
    -Filter "musica-container.json" `
    -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -notmatch "[\\/]_software[\\/]" -and
    $_.FullName -notmatch "[\\/]_backup[\\/]"
  }
)

foreach ($ContainerFile in $ContainerFiles) {
  try {
    $Container = Get-Content `
      -LiteralPath $ContainerFile.FullName `
      -Raw `
      -Encoding UTF8 |
    ConvertFrom-Json

    Backup-SourceFile `
      -Path $ContainerFile.FullName `
      -ArchiveRoot $ArchiveRoot `
      -BackupRoot $BackupRoot

    Set-ArrayProperty -Object $Container -Name "scales"
    Set-ArrayProperty -Object $Container -Name "sources"
    Set-ArrayProperty -Object $Container -Name "documents"

    if ($null -ne $Container.tradition) {
      Set-ArrayProperty -Object $Container.tradition -Name "source_ids"
    }

    foreach ($Scale in @($Container.scales)) {
      Set-ArrayProperty -Object $Scale -Name "notes_12tet"
      Set-ArrayProperty -Object $Scale -Name "pitch_classes_12tet"
      Set-ArrayProperty -Object $Scale -Name "source_ids"
      Set-ArrayProperty -Object $Scale -Name "documents"

      if ($null -ne $Scale.historical_tuning) {
        Set-ArrayProperty `
          -Object $Scale.historical_tuning `
          -Name "source_ids"

        Set-ArrayProperty `
          -Object $Scale.historical_tuning `
          -Name "measured_natural_sequence"

        Set-ArrayProperty `
          -Object $Scale.historical_tuning `
          -Name "measured_intervals_cents"

        Set-ArrayProperty `
          -Object $Scale.historical_tuning `
          -Name "scale_degrees_from_keynote"
      }
    }

    Write-JsonUtf8Bom `
      -Path $ContainerFile.FullName `
      -Value $Container

    [void]$ChangedFiles.Add(
      $ContainerFile.FullName.Substring(
        $ArchiveRoot.Length
      ).TrimStart("\")
    )
  }
  catch {
    [void]$Warnings.Add(
      "CONTENITORE | " +
      $ContainerFile.FullName +
      " | " +
      $_.Exception.Message
    )
  }
}

$ReportPath = Join-Path `
  $SoftwareRoot `
  "generated\RAPPORTO_NORMALIZZAZIONE_ARRAY.txt"

$ReportLines = New-Object System.Collections.ArrayList

[void]$ReportLines.Add("NORMALIZZAZIONE DEGLI ARRAY MUSICALI — V2")
[void]$ReportLines.Add("==========================================")
[void]$ReportLines.Add("")
[void]$ReportLines.Add(
  "File normalizzati: " +
  $ChangedFiles.Count
)
[void]$ReportLines.Add(
  "Avvisi non bloccanti: " +
  $Warnings.Count
)
[void]$ReportLines.Add("")

foreach ($file in $ChangedFiles) {
  [void]$ReportLines.Add("NORMALIZZATO | " + $file)
}

foreach ($warning in $Warnings) {
  [void]$ReportLines.Add("AVVISO | " + $warning)
}

New-Item `
  -ItemType Directory `
  -Path (Split-Path -Parent $ReportPath) `
  -Force |
Out-Null

[System.IO.File]::WriteAllLines(
  $ReportPath,
  [string[]]$ReportLines,
  (New-Object System.Text.UTF8Encoding($true))
)

Write-Host ""
Write-Host ("File normalizzati: " + $ChangedFiles.Count)
Write-Host ("Avvisi non bloccanti: " + $Warnings.Count)
Write-Host ("Backup: " + $BackupRoot)
Write-Host ("Rapporto: " + $ReportPath)
Write-Host ""

# Warnings are recorded but do not stop regeneration.
exit 0
