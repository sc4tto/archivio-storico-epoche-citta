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

if ([string]::IsNullOrWhiteSpace($ArchiveRoot)) {
  $ArchiveRoot = Join-Path $PSScriptRoot "..\..\.."
}
else {
  $ArchiveRoot = ([string]$ArchiveRoot).Trim().Trim('"')
}

$ArchiveRoot = [System.IO.Path]::GetFullPath($ArchiveRoot)
$SoftwareRoot = Join-Path $ArchiveRoot "_software\Viaggio_Musicale"
$script:Checks = New-Object System.Collections.ArrayList

$ExpectedScales = @(
  "JIAHU_M282_20_HEXATONIC",
  "UGARIT_H6_NID_QABLI_FRAMEWORK",
  "BAGHDAD_URMAWI_RAST_FRAMEWORK",
  "ATHENS_ARISTOXENUS_TENSE_DIATONIC_OCTAVE"
)

$Found = @{}

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

    foreach ($Scale in @($Container.scales)) {
      $ScaleId = [string]$Scale.scale_id

      if ($ExpectedScales -contains $ScaleId) {
        $Found[$ScaleId] = $Scale
      }
    }
  }
  catch {
  }
}

foreach ($ScaleId in $ExpectedScales) {
  $Present = $Found.ContainsKey($ScaleId)

  $ScaleMessage = if ($Present) {
    "Scala trovata."
  }
  else {
    "Scala non trovata."
  }

  Add-Check `
    -Code ("SCALE_" + $ScaleId) `
    -Passed $Present `
    -Message $ScaleMessage

  if (-not $Present) {
    continue
  }

  $Scale = $Found[$ScaleId]

  Add-Check `
    -Code ("BASIS_" + $ScaleId) `
    -Passed (
      -not [string]::IsNullOrWhiteSpace(
        [string]$Scale.comparison_basis
      )
    ) `
    -Message "comparison_basis presente."

  Add-Check `
    -Code ("RELIABILITY_" + $ScaleId) `
    -Passed ($null -ne $Scale.transition_reliability) `
    -Message "transition_reliability presente."

  Add-Check `
    -Code ("APPROX_STATUS_" + $ScaleId) `
    -Passed (
      -not [string]::IsNullOrWhiteSpace(
        [string]$Scale.approximation.status
      )
    ) `
    -Message "approximation.status presente."

  Add-Check `
    -Code ("HARMONY_WARNING_" + $ScaleId) `
    -Passed (
      -not [string]::IsNullOrWhiteSpace(
        [string]$Scale.harmonization.warning
      )
    ) `
    -Message "Avvertenza sull'armonizzazione moderna presente."
}

$JourneyJsPath = Join-Path `
  $SoftwareRoot `
  "assets\center-journey.js"

$CssPath = Join-Path `
  $SoftwareRoot `
  "assets\transition-reliability.css"

Add-Check `
  -Code "JAVASCRIPT" `
  -Passed (Test-Path -LiteralPath $JourneyJsPath -PathType Leaf) `
  -Message "Motore JavaScript presente."

Add-Check `
  -Code "CSS" `
  -Passed (Test-Path -LiteralPath $CssPath -PathType Leaf) `
  -Message "Stile dell'affidabilita presente."

if (Test-Path -LiteralPath $JourneyJsPath -PathType Leaf) {
  $JourneyJs = Get-Content `
    -LiteralPath $JourneyJsPath `
    -Raw `
    -Encoding UTF8

  Add-Check `
    -Code "DOCUMENTARY_COST" `
    -Passed ($JourneyJs -match "documentaryCost") `
    -Message "Calcolo del costo documentale installato."

  Add-Check `
    -Code "VARIANT_SENSITIVITY" `
    -Passed ($JourneyJs -match "variantSensitivity") `
    -Message "Analisi delle mappature alternative installata."

  Add-Check `
    -Code "EXPORT_RELIABILITY" `
    -Passed ($JourneyJs -match "documentary_penalty") `
    -Message "Esportazione dei metadati di affidabilita installata."
}

$Failures = @(
  $Checks |
  Where-Object {
    -not $_.passed
  }
)

$ReportPath = Join-Path `
  $SoftwareRoot `
  "generated\RAPPORTO_AFFIDABILITA_TRANSIZIONI.txt"

$Lines = New-Object System.Collections.ArrayList

[void]$Lines.Add("VERIFICA AFFIDABILITA DELLE TRANSIZIONI")
[void]$Lines.Add("========================================")
[void]$Lines.Add("")
[void]$Lines.Add(
  "Controlli superati: " +
  ($Checks.Count - $Failures.Count) +
  " / " +
  $Checks.Count
)
[void]$Lines.Add("Problemi: " + $Failures.Count)
[void]$Lines.Add("")

foreach ($Check in $Checks) {
  $Status = if ($Check.passed) {
    "OK"
  }
  else {
    "ERRORE"
  }

  [void]$Lines.Add(
    $Status +
    " | " +
    $Check.code +
    " | " +
    $Check.message
  )
}

[void]$Lines.Add("")

if ($Failures.Count -eq 0) {
  [void]$Lines.Add(
    "ESITO FINALE: MOTORE DI AFFIDABILITA PRONTO"
  )
}
else {
  [void]$Lines.Add(
    "ESITO FINALE: IL MOTORE RICHIEDE CORREZIONI"
  )
}

[System.IO.File]::WriteAllLines(
  $ReportPath,
  [string[]]$Lines,
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
