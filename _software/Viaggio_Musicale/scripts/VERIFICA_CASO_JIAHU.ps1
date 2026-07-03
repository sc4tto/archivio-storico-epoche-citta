param(
  [string]$ArchiveRoot = ""
)

$ErrorActionPreference = "Stop"

function Add-Check {
  param(
    [string]$Code,
    [bool]$Passed,
    [string]$Message
  )

  [void]$script:Checks.Add([PSCustomObject]@{
    code = $Code
    passed = $Passed
    message = $Message
  })
}

function Is-ArrayValue {
  param([object]$Value)

  return (
    $null -ne $Value -and
    $Value -is [System.Array]
  )
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

$SoftwareRoot = Join-Path $ArchiveRoot "_software\Viaggio_Musicale"
$script:Checks = New-Object System.Collections.ArrayList

$ProfileFiles = @(
  Get-ChildItem `
    -LiteralPath $ArchiveRoot `
    -Recurse `
    -File `
    -Filter "musica-centro.json" `
    -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -match "[\\/]01_Jiahu[\\/]dati[\\/]musica_documentata[\\/]musica-centro\.json$"
  }
)

$ProfileFileMessage = if ($ProfileFiles.Count -eq 1) {
  "Profilo Jiahu individuato."
}
else {
  "Atteso un solo profilo Jiahu; trovati: " + $ProfileFiles.Count
}

Add-Check `
  -Code "PROFILE_FILE" `
  -Passed ($ProfileFiles.Count -eq 1) `
  -Message $ProfileFileMessage

$Profile = $null

if ($ProfileFiles.Count -eq 1) {
  try {
    $Profile = Get-Content `
      -LiteralPath $ProfileFiles[0].FullName `
      -Raw `
      -Encoding UTF8 |
    ConvertFrom-Json

    Add-Check `
      -Code "PROFILE_JSON" `
      -Passed $true `
      -Message "musica-centro.json leggibile."
  }
  catch {
    Add-Check `
      -Code "PROFILE_JSON" `
      -Passed $false `
      -Message $_.Exception.Message
  }
}

if ($null -ne $Profile) {
  Add-Check `
    -Code "PROFILE_STATUS" `
    -Passed ([string]$Profile.record_status -eq "documentato") `
    -Message ("record_status = " + [string]$Profile.record_status)

  Add-Check `
    -Code "TRADITION_ARRAY" `
    -Passed (Is-ArrayValue $Profile.tradition_links) `
    -Message "tradition_links deve essere un array."

  Add-Check `
    -Code "SCALE_ARRAY" `
    -Passed (Is-ArrayValue $Profile.scale_links) `
    -Message "scale_links deve essere un array."

  Add-Check `
    -Code "EVIDENCE_ARRAY" `
    -Passed (Is-ArrayValue $Profile.musical_evidence) `
    -Message "musical_evidence deve essere un array."

  Add-Check `
    -Code "SOURCE_ARRAY" `
    -Passed (Is-ArrayValue $Profile.sources) `
    -Message "sources deve essere un array."

  $TraditionFound = @(
    @($Profile.tradition_links) |
    Where-Object {
      $_.tradition_id -eq "JIAHU_BONE_FLUTE_PRACTICE" -and
      $_.relation_status -eq "documentato"
    }
  ).Count -gt 0

  Add-Check `
    -Code "TRADITION_LINK" `
    -Passed $TraditionFound `
    -Message "Collegamento documentato alla pratica dei flauti di Jiahu."

  $ScaleFound = @(
    @($Profile.scale_links) |
    Where-Object {
      $_.scale_id -eq "JIAHU_M282_20_HEXATONIC" -and
      $_.relation_status -eq "documentato"
    }
  ).Count -gt 0

  Add-Check `
    -Code "SCALE_LINK" `
    -Passed $ScaleFound `
    -Message "Collegamento documentato alla scala M282:20."

  Add-Check `
    -Code "CHRONOLOGY" `
    -Passed (
      [string]$Profile.documentation.chronology_status -eq "compatibile"
    ) `
    -Message (
      "Cronologia: " +
      [string]$Profile.documentation.chronology_status
    )

  Add-Check `
    -Code "GEOGRAPHY" `
    -Passed (
      [string]$Profile.documentation.geography_status -eq "compatibile" -and
      [string]$Profile.documentation.geography_relation -eq "nel_centro"
    ) `
    -Message (
      "Geografia: " +
      [string]$Profile.documentation.geography_status +
      " / " +
      [string]$Profile.documentation.geography_relation
    )
}

$ContainerFiles = @(
  Get-ChildItem `
    -LiteralPath $ArchiveRoot `
    -Recurse `
    -File `
    -Filter "musica-container.json" `
    -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -notmatch "[\\/]_software[\\/]"
  }
)

$MatchingContainer = $null
$MatchingScale = $null

foreach ($ContainerFile in $ContainerFiles) {
  try {
    $Container = Get-Content `
      -LiteralPath $ContainerFile.FullName `
      -Raw `
      -Encoding UTF8 |
    ConvertFrom-Json

    if (
      [string]$Container.tradition.id -eq
      "JIAHU_BONE_FLUTE_PRACTICE"
    ) {
      $MatchingContainer = $Container

      foreach ($Scale in @($Container.scales)) {
        if (
          [string]$Scale.scale_id -eq
          "JIAHU_M282_20_HEXATONIC"
        ) {
          $MatchingScale = $Scale
          break
        }
      }

      break
    }
  }
  catch {
  }
}

Add-Check `
  -Code "CONTAINER" `
  -Passed ($null -ne $MatchingContainer) `
  -Message "Contenitore canonico della tradizione Jiahu."

Add-Check `
  -Code "CANONICAL_SCALE" `
  -Passed (
    $null -ne $MatchingScale -and
    [string]$MatchingScale.documentation_status -eq "documentato"
  ) `
  -Message "Scala canonica M282:20 documentata."

if ($null -ne $MatchingScale) {
  Add-Check `
    -Code "NOTES_12TET_ARRAY" `
    -Passed (Is-ArrayValue $MatchingScale.notes_12tet) `
    -Message "notes_12tet deve essere un array."

  Add-Check `
    -Code "PITCH_CLASSES_ARRAY" `
    -Passed (Is-ArrayValue $MatchingScale.pitch_classes_12tet) `
    -Message "pitch_classes_12tet deve essere un array."

  Add-Check `
    -Code "MEASURED_SEQUENCE" `
    -Passed (
      @(
        $MatchingScale.historical_tuning.measured_natural_sequence
      ).Count -ge 6
    ) `
    -Message "Sequenza storico-acustica presente."

  Add-Check `
    -Code "APPROXIMATION_WARNING" `
    -Passed (
      -not [string]::IsNullOrWhiteSpace(
        [string]$MatchingScale.approximation.warning
      )
    ) `
    -Message "Avvertenza 12-TET presente."

  Add-Check `
    -Code "HARMONIZATION_WARNING" `
    -Passed (
      -not [string]::IsNullOrWhiteSpace(
        [string]$MatchingScale.harmonization.warning
      )
    ) `
    -Message "Avvertenza armonizzazione moderna presente."
}

$IndexPath = Join-Path `
  $SoftwareRoot `
  "generated\center-music-index.json"

$IndexAdmitted = $false

if (Test-Path -LiteralPath $IndexPath -PathType Leaf) {
  try {
    $Index = Get-Content `
      -LiteralPath $IndexPath `
      -Raw `
      -Encoding UTF8 |
    ConvertFrom-Json

    $IndexAdmitted = @(
      @($Index.profiles) |
      Where-Object {
        $_.profile_id -eq "P1-EA-JIAHU-MUSIC-DOCUMENTED"
      }
    ).Count -gt 0
  }
  catch {
    $IndexAdmitted = $false
  }
}

Add-Check `
  -Code "INDEX_ADMISSION" `
  -Passed $IndexAdmitted `
  -Message "Jiahu presente nell'indice dei profili ammessi."

$Failures = @(
  $Checks |
  Where-Object {
    -not $_.passed
  }
)

$ReportPath = Join-Path `
  $SoftwareRoot `
  "generated\RAPPORTO_VERIFICA_JIAHU.txt"

$ReportLines = New-Object System.Collections.ArrayList

[void]$ReportLines.Add("VERIFICA DEL PRIMO CASO DOCUMENTATO — JIAHU")
[void]$ReportLines.Add("============================================")
[void]$ReportLines.Add("")
[void]$ReportLines.Add(
  "Controlli superati: " +
  ($Checks.Count - $Failures.Count) +
  " / " +
  $Checks.Count
)
[void]$ReportLines.Add(
  "Problemi: " +
  $Failures.Count
)
[void]$ReportLines.Add("")

foreach ($Check in $Checks) {
  [void]$ReportLines.Add(
    $(if ($Check.passed) { "OK" } else { "ERRORE" }) +
    " | " +
    $Check.code +
    " | " +
    $Check.message
  )
}

[void]$ReportLines.Add("")
$FinalOutcome = if ($Failures.Count -eq 0) {
  "ESITO FINALE: JIAHU PRONTO COME MODELLO DOCUMENTALE"
}
else {
  "ESITO FINALE: JIAHU RICHIEDE CORREZIONI"
}

[void]$ReportLines.Add($FinalOutcome)

[System.IO.File]::WriteAllLines(
  $ReportPath,
  [string[]]$ReportLines,
  (New-Object System.Text.UTF8Encoding($true))
)

Write-Host ""
Write-Host (
  "Controlli superati: " +
  ($Checks.Count - $Failures.Count) +
  " / " +
  $Checks.Count
)
Write-Host ("Problemi: " + $Failures.Count)
Write-Host ("Rapporto: " + $ReportPath)
Write-Host ""

Start-Process -FilePath $ReportPath

if ($Failures.Count -gt 0) {
  exit 3
}

exit 0
