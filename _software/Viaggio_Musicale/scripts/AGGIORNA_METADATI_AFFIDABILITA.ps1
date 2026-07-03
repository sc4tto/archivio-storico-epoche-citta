param(
  [string]$ArchiveRoot = ""
)

$ErrorActionPreference = "Stop"

function Write-JsonUtf8Bom {
  param(
    [string]$Path,
    [object]$Value
  )

  $Json = ConvertTo-Json -InputObject $Value -Depth 100
  $Encoding = New-Object System.Text.UTF8Encoding($true)
  [System.IO.File]::WriteAllText($Path, $Json, $Encoding)
}

function Set-Property {
  param(
    [object]$Object,
    [string]$Name,
    [object]$Value
  )

  if ($null -eq $Object) {
    return
  }

  $Object |
    Add-Member `
      -NotePropertyName $Name `
      -NotePropertyValue $Value `
      -Force
}

function Backup-File {
  param(
    [string]$Path,
    [string]$ArchiveRoot,
    [string]$BackupRoot
  )

  $Relative = $Path.Substring(
    $ArchiveRoot.Length
  ).TrimStart("\")

  $Destination = Join-Path $BackupRoot $Relative
  $Directory = Split-Path -Parent $Destination

  New-Item `
    -ItemType Directory `
    -Path $Directory `
    -Force |
  Out-Null

  Copy-Item `
    -LiteralPath $Path `
    -Destination $Destination `
    -Force
}

if ([string]::IsNullOrWhiteSpace($ArchiveRoot)) {
  $ArchiveRoot = Join-Path $PSScriptRoot "..\..\.."
}
else {
  $ArchiveRoot = ([string]$ArchiveRoot).Trim().Trim('"')
}

$ArchiveRoot = [System.IO.Path]::GetFullPath($ArchiveRoot)
$SoftwareRoot = Join-Path $ArchiveRoot "_software\Viaggio_Musicale"

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $SoftwareRoot (
  "backups\transition-reliability-metadata-" +
  $Timestamp
)

$Updated = New-Object System.Collections.ArrayList
$Warnings = New-Object System.Collections.ArrayList

$Definitions = @{
  "JIAHU_M282_20_HEXATONIC" = [PSCustomObject]@{
    comparison_basis = "measured_acoustic_data"
    approximation_status = "approssimazione_da_misure"
    transition_reliability = [PSCustomObject]@{
      historical_pitch_comparison = "alta"
      interval_structure_comparison = "alta"
      twelve_tet_transition = "media-alta"
      reason = (
        "Le altezze del reperto sono state misurate; la riduzione " +
        "12-TET arrotonda gli scarti in cent."
      )
    }
  }

  "UGARIT_H6_NID_QABLI_FRAMEWORK" = [PSCustomObject]@{
    comparison_basis = (
      "documented_tuning_name_and_conventional_mapping"
    )
    approximation_status = "sintesi_operativa"
    transition_reliability = [PSCustomObject]@{
      historical_pitch_comparison = "bassa"
      structural_scale_comparison = "media"
      twelve_tet_transition = "bassa-media"
      reason = (
        "Il nome dell'accordatura e il quadro eptatonico sono " +
        "documentati; altezza assoluta e trascrizione melodica no."
      )
    }
  }

  "BAGHDAD_URMAWI_RAST_FRAMEWORK" = [PSCustomObject]@{
    comparison_basis = (
      "documented_modal_framework_ambiguous_mapping"
    )
    approximation_status = "sintesi_operativa_con_ambiguita"
    transition_reliability = [PSCustomObject]@{
      historical_pitch_comparison = "bassa"
      modal_structure_comparison = "media"
      twelve_tet_transition = "bassa-media"
      reason = (
        "Il modo e il sistema a diciassette posizioni sono " +
        "documentati; la conversione microtonale in 12-TET e ambigua."
      )
    }
  }

  "ATHENS_ARISTOXENUS_TENSE_DIATONIC_OCTAVE" = [PSCustomObject]@{
    comparison_basis = (
      "documented_interval_structure_conventional_pitch"
    )
    approximation_status = "sintesi_operativa"
    transition_reliability = [PSCustomObject]@{
      historical_pitch_comparison = "bassa"
      interval_structure_comparison = "alta"
      twelve_tet_transition = "media"
      reason = (
        "La struttura intervallare e documentata; il centro Mi e " +
        "il temperamento 12-TET sono rappresentazioni moderne."
      )
    }
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
    $_.FullName -notmatch "[\\/]backups[\\/]"
  }
)

foreach ($ContainerFile in $ContainerFiles) {
  try {
    $Container = Get-Content `
      -LiteralPath $ContainerFile.FullName `
      -Raw `
      -Encoding UTF8 |
    ConvertFrom-Json

    $Changed = $false

    foreach ($Scale in @($Container.scales)) {
      $ScaleId = [string]$Scale.scale_id

      if (-not $Definitions.ContainsKey($ScaleId)) {
        continue
      }

      if (-not $Changed) {
        Backup-File `
          -Path $ContainerFile.FullName `
          -ArchiveRoot $ArchiveRoot `
          -BackupRoot $BackupRoot

        $Changed = $true
      }

      $Definition = $Definitions[$ScaleId]

      Set-Property `
        -Object $Scale `
        -Name "comparison_basis" `
        -Value $Definition.comparison_basis

      Set-Property `
        -Object $Scale `
        -Name "transition_reliability" `
        -Value $Definition.transition_reliability

      if ($null -eq $Scale.approximation) {
        Set-Property `
          -Object $Scale `
          -Name "approximation" `
          -Value ([PSCustomObject]@{})
      }

      Set-Property `
        -Object $Scale.approximation `
        -Name "status" `
        -Value $Definition.approximation_status

      [void]$Updated.Add(
        $ScaleId +
        " | " +
        $ContainerFile.FullName
      )
    }

    if ($Changed) {
      Write-JsonUtf8Bom `
        -Path $ContainerFile.FullName `
        -Value $Container
    }
  }
  catch {
    [void]$Warnings.Add(
      $ContainerFile.FullName +
      " | " +
      $_.Exception.Message
    )
  }
}

$ReportPath = Join-Path `
  $SoftwareRoot `
  "generated\RAPPORTO_METADATI_AFFIDABILITA.txt"

$Lines = New-Object System.Collections.ArrayList

[void]$Lines.Add("METADATI DI AFFIDABILITA DELLE TRANSIZIONI")
[void]$Lines.Add("===========================================")
[void]$Lines.Add("")
[void]$Lines.Add("Scale aggiornate: " + $Updated.Count)
[void]$Lines.Add("Avvisi: " + $Warnings.Count)
[void]$Lines.Add("")

foreach ($Item in $Updated) {
  [void]$Lines.Add("AGGIORNATA | " + $Item)
}

foreach ($Warning in $Warnings) {
  [void]$Lines.Add("AVVISO | " + $Warning)
}

New-Item `
  -ItemType Directory `
  -Path (Split-Path -Parent $ReportPath) `
  -Force |
Out-Null

[System.IO.File]::WriteAllLines(
  $ReportPath,
  [string[]]$Lines,
  (New-Object System.Text.UTF8Encoding($true))
)

Write-Host ""
Write-Host ("Scale aggiornate: " + $Updated.Count)
Write-Host ("Avvisi: " + $Warnings.Count)
Write-Host ("Backup: " + $BackupRoot)
Write-Host ("Rapporto: " + $ReportPath)
Write-Host ""

exit 0
