param(
  [string]$ArchiveRoot = ""
)

$ErrorActionPreference = "Stop"

function Write-Utf8Bom {
  param(
    [string]$Path,
    [string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($true)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Normalize-DisplayLabel {
  param([string]$Value)

  $text = [System.Net.WebUtility]::HtmlDecode([string]$Value)
  $text = $text -replace "<[^>]+>", ""
  $text = $text -replace "^\d{2}_", ""
  $text = $text -replace "_", " "
  $text = $text -replace "\s+", " "
  return $text.Trim()
}

function Convert-ToStableId {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return "SENZA_ID"
  }

  $normalized = $Value.Normalize(
    [System.Text.NormalizationForm]::FormD
  )

  $builder = New-Object System.Text.StringBuilder

  foreach ($character in $normalized.ToCharArray()) {
    $category = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory(
      $character
    )

    if (
      $category -ne
      [System.Globalization.UnicodeCategory]::NonSpacingMark
    ) {
      [void]$builder.Append($character)
    }
  }

  $result = $builder.ToString().Normalize(
    [System.Text.NormalizationForm]::FormC
  )

  $result = $result.ToUpperInvariant()
  $result = $result -replace "[^A-Z0-9]+", "_"
  $result = $result.Trim("_")

  if ([string]::IsNullOrWhiteSpace($result)) {
    return "SENZA_ID"
  }

  return $result
}

function Read-Required {
  param([string]$Prompt)

  while ($true) {
    $value = Read-Host $Prompt

    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value.Trim()
    }

    Write-Host "Il campo e obbligatorio." -ForegroundColor Yellow
  }
}

function Read-Choice {
  param(
    [string]$Prompt,
    [string[]]$Allowed
  )

  while ($true) {
    $value = (Read-Host $Prompt).Trim()

    foreach ($allowedValue in $Allowed) {
      if (
        $value.Equals(
          $allowedValue,
          [System.StringComparison]::OrdinalIgnoreCase
        )
      ) {
        return $allowedValue
      }
    }

    Write-Host (
      "Valori ammessi: " +
      ($Allowed -join ", ")
    ) -ForegroundColor Yellow
  }
}

function Select-FromList {
  param(
    [string]$Prompt,
    [object[]]$Items,
    [scriptblock]$LabelSelector
  )

  if ($Items.Count -eq 0) {
    throw "Nessuna opzione disponibile: $Prompt"
  }

  Write-Host ""
  Write-Host $Prompt
  Write-Host ("-" * $Prompt.Length)

  for ($index = 0; $index -lt $Items.Count; $index += 1) {
    $label = & $LabelSelector $Items[$index]
    Write-Host ("[" + ($index + 1) + "] " + $label)
  }

  while ($true) {
    $answer = Read-Host "Numero"
    $number = 0

    if (
      [int]::TryParse($answer, [ref]$number) -and
      $number -ge 1 -and
      $number -le $Items.Count
    ) {
      return $Items[$number - 1]
    }

    Write-Host "Selezione non valida." -ForegroundColor Yellow
  }
}

function Get-CatalogCenters {
  param([string]$CentersDirectory)

  $items = New-Object System.Collections.ArrayList
  $indexPath = Join-Path $CentersDirectory "index.html"

  if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
    return @()
  }

  $html = [System.IO.File]::ReadAllText(
    $indexPath,
    [System.Text.Encoding]::UTF8
  )

  $pattern = '<a\b[^>]*href\s*=\s*"([^"]+)/index\.html"[^>]*>.*?<strong[^>]*>(.*?)</strong>'
  $options = (
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )

  $matches = [System.Text.RegularExpressions.Regex]::Matches(
    $html,
    $pattern,
    $options
  )

  foreach ($match in $matches) {
    $folderName = [System.Net.WebUtility]::HtmlDecode(
      [string]$match.Groups[1].Value
    )

    $folderName = $folderName -replace "^[.][\\/]", ""
    $folderName = $folderName -replace "[\\/]$", ""

    if ($folderName -match "[\\/]") {
      continue
    }

    $fullPath = Join-Path $CentersDirectory $folderName

    if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
      continue
    }

    $label = Normalize-DisplayLabel (
      [string]$match.Groups[2].Value
    )

    [void]$items.Add([PSCustomObject]@{
      folder_name = $folderName
      label = $label
      full_path = [System.IO.Path]::GetFullPath($fullPath)
    })
  }

  return @($items)
}

function Read-Source {
  param(
    [string]$SourceId,
    [string]$Purpose
  )

  Write-Host ""
  Write-Host ("Fonte per: " + $Purpose)
  Write-Host ("Source ID: " + $SourceId)

  $grade = Read-Choice `
    -Prompt "Classe della fonte [A/B]" `
    -Allowed @("A", "B")

  return [PSCustomObject]@{
    source_id = $SourceId
    purpose = $Purpose
    title = Read-Required "Titolo"
    author = Read-Required "Autore o curatore"
    year = Read-Required "Anno"
    publisher_or_journal = Read-Required "Editore o rivista"
    identifier = Read-Required "DOI, URL o identificatore"
    pages = Read-Required "Pagine o sezione pertinente"
    grade = $grade
  }
}

function Parse-IntegerList {
  param(
    [string]$Prompt,
    [int]$Minimum,
    [int]$Maximum
  )

  while ($true) {
    $raw = Read-Host $Prompt
    $parts = @(
      $raw -split "[,; ]+" |
      Where-Object {
        -not [string]::IsNullOrWhiteSpace($_)
      }
    )

    $values = New-Object System.Collections.ArrayList
    $valid = $parts.Count -gt 0

    foreach ($part in $parts) {
      $number = 0

      if (
        -not [int]::TryParse($part, [ref]$number) -or
        $number -lt $Minimum -or
        $number -gt $Maximum
      ) {
        $valid = $false
        break
      }

      [void]$values.Add($number)
    }

    if ($valid) {
      return @($values)
    }

    Write-Host (
      "Inserire numeri fra " +
      $Minimum +
      " e " +
      $Maximum +
      ", separati da virgole."
    ) -ForegroundColor Yellow
  }
}

function Parse-TextList {
  param([string]$Prompt)

  while ($true) {
    $raw = Read-Host $Prompt
    $values = @(
      $raw -split "[,;]+" |
      ForEach-Object {
        $_.Trim()
      } |
      Where-Object {
        -not [string]::IsNullOrWhiteSpace($_)
      }
    )

    if ($values.Count -gt 0) {
      return $values
    }

    Write-Host "Inserire almeno un valore." -ForegroundColor Yellow
  }
}

function Backup-File {
  param(
    [string]$Path,
    [string]$BackupRoot,
    [string]$ArchiveRoot
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return
  }

  $relativePath = $Path.Substring(
    $ArchiveRoot.Length
  ).TrimStart("\")

  $destination = Join-Path $BackupRoot $relativePath
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

$SoftwareRoot = Join-Path $ArchiveRoot "_software\Viaggio_Musicale"
$PolicyPath = Join-Path $SoftwareRoot "config\documented-center-policy.json"
$TemplatePath = Join-Path $SoftwareRoot "templates\TEMPLATE_musica-centro-documentata.json"

try {
  $Policy = Get-Content `
    -LiteralPath $PolicyPath `
    -Raw `
    -Encoding UTF8 |
  ConvertFrom-Json

  $ProfileTemplate = Get-Content `
    -LiteralPath $TemplatePath `
    -Raw `
    -Encoding UTF8 |
  ConvertFrom-Json
}
catch {
  Write-Error ("Configurazione non valida: " + $_.Exception.Message)
  exit 3
}

$PeriodDirectories = @(
  Get-ChildItem `
    -LiteralPath $ArchiveRoot `
    -Directory `
    -ErrorAction Stop |
  Where-Object {
    $_.Name -match "^\d{2}_P\d+"
  } |
  Sort-Object Name
)

$Period = Select-FromList `
  -Prompt "Seleziona il periodo storico" `
  -Items $PeriodDirectories `
  -LabelSelector {
    param($item)
    Normalize-DisplayLabel $item.Name
  }

$PeriodId = ""

if ($Period.Name -match "^\d{2}_(P\d+)") {
  $PeriodId = $Matches[1]
}
else {
  throw "ID del periodo non determinabile."
}

$PeriodOrder = 0

if ($Period.Name -match "^(\d{2})_") {
  $PeriodOrder = [int]$Matches[1]
}

$AreaMap = @{
  "01" = "ASW"
  "02" = "NEA"
  "03" = "SA"
  "04" = "EA"
  "05" = "SEA"
  "06" = "EUR_MED"
  "07" = "AFR_SUB"
  "08" = "MESO"
  "09" = "ANDES"
  "10" = "N_AMERICA"
  "11" = "OCEANIA"
}

$AreaDirectories = @(
  Get-ChildItem `
    -LiteralPath $Period.FullName `
    -Directory `
    -ErrorAction Stop |
  Where-Object {
    $_.Name -match "^\d{2}_"
  } |
  Sort-Object Name
)

$Area = Select-FromList `
  -Prompt "Seleziona l'area geografica" `
  -Items $AreaDirectories `
  -LabelSelector {
    param($item)
    Normalize-DisplayLabel $item.Name
  }

$AreaPrefix = ""

if ($Area.Name -match "^(\d{2})_") {
  $AreaPrefix = $Matches[1]
}

$AreaId = if ($AreaMap.ContainsKey($AreaPrefix)) {
  $AreaMap[$AreaPrefix]
}
else {
  "AREA_" + $AreaPrefix
}

$CentersDirectory = Join-Path $Area.FullName "Centri abitati"
$Centers = @(
  Get-CatalogCenters -CentersDirectory $CentersDirectory
)

$Center = Select-FromList `
  -Prompt "Seleziona il centro ufficiale" `
  -Items $Centers `
  -LabelSelector {
    param($item)
    $item.label
  }

$CenterId = Convert-ToStableId $Center.label
$PeriodLabel = Normalize-DisplayLabel $Period.Name
$AreaLabel = Normalize-DisplayLabel $Area.Name

Write-Host ""
Write-Host "DATI DELLA TRADIZIONE"
Write-Host "---------------------"

$TraditionLabel = Read-Required "Nome della tradizione"
$TraditionId = Convert-ToStableId $TraditionLabel
$HistoricalTraditionName = Read-Required "Nome storico o descrizione storica"

Write-Host ""
Write-Host "DATI DELLA SCALA O DEL SISTEMA"
Write-Host "------------------------------"

$ScaleName = Read-Required "Nome della scala o del sistema d'intonazione"
$ScaleId = (
  "SCALE-" +
  $TraditionId +
  "-" +
  (Convert-ToStableId $ScaleName)
)

$ExistingScale = $null
$ExistingContainerFile = $null

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
    $ExistingContainer = Get-Content `
      -LiteralPath $ContainerFile.FullName `
      -Raw `
      -Encoding UTF8 |
    ConvertFrom-Json

    foreach ($Scale in @($ExistingContainer.scales)) {
      if (
        [string]$Scale.scale_id -eq $ScaleId -and
        [string]$ExistingContainer.tradition.id -eq $TraditionId
      ) {
        $ExistingScale = $Scale
        $ExistingContainerFile = $ContainerFile
        break
      }
    }

    if ($null -ne $ExistingScale) {
      break
    }
  }
  catch {
  }
}

$HistoricalTuning = ""
$Notes12Tet = @()
$PitchClasses = @()
$CenterLabel = ""
$CenterPitchClass = 0
$CenterType = ""
$ApproximationQuality = ""

if ($null -ne $ExistingScale) {
  Write-Host ""
  Write-Host (
    "Scala canonica gia presente: " +
    $ExistingScale.name
  ) -ForegroundColor Green

  Write-Host (
    "Contenitore: " +
    $ExistingContainerFile.FullName
  )

  $ScaleName = [string]$ExistingScale.name
}
else {
  $HistoricalTuning = Read-Required (
    "Descrizione storica dell'accordatura o degli intervalli"
  )

  $Notes12Tet = Parse-TextList (
    "Note dell'approssimazione 12-TET, separate da virgole"
  )

  $PitchClasses = Parse-IntegerList `
    -Prompt "Pitch class 0-11, nello stesso ordine" `
    -Minimum 0 `
    -Maximum 11

  if ($Notes12Tet.Count -ne $PitchClasses.Count) {
    Write-Error (
      "Il numero delle note deve coincidere con il numero delle pitch class."
    )
    exit 4
  }

  $CenterLabel = Read-Required "Centro musicale o tonica"
  $CenterPitchClasses = Parse-IntegerList `
    -Prompt "Pitch class del centro musicale 0-11" `
    -Minimum 0 `
    -Maximum 11

  if ($CenterPitchClasses.Count -ne 1) {
    Write-Error "Inserire una sola pitch class per il centro musicale."
    exit 5
  }

  $CenterPitchClass = $CenterPitchClasses[0]
  $CenterType = Read-Required "Tipo del centro musicale"
  $ApproximationQuality = Read-Required (
    "Qualita dell'approssimazione 12-TET"
  )
}

Write-Host ""
Write-Host "AFFERMAZIONI DOCUMENTALI"
Write-Host "------------------------"

$CenterTraditionClaim = Read-Required (
  "Affermazione che collega il centro alla tradizione"
)

$TraditionScaleClaim = Read-Required (
  "Affermazione che documenta la scala o l'accordatura"
)

$ChronologyStatement = Read-Required (
  "Motivazione della compatibilita cronologica"
)

$GeographyRelation = Read-Choice `
  -Prompt (
    "Relazione geografica [" +
    ($Policy.allowed_geography_relations -join "/") +
    "]"
  ) `
  -Allowed @($Policy.allowed_geography_relations)

$GeographyStatement = Read-Required (
  "Motivazione della compatibilita geografica"
)

$SourceTimestamp = Get-Date -Format "yyyyMMddHHmmss"
$Source1Id = "SRC-" + $CenterId + "-CT-" + $SourceTimestamp
$Source1 = Read-Source `
  -SourceId $Source1Id `
  -Purpose "collegamento centro-tradizione"

$SameSourceAnswer = Read-Choice `
  -Prompt "La stessa fonte documenta anche la scala? [SI/NO]" `
  -Allowed @("SI", "NO")

if ($SameSourceAnswer -eq "SI") {
  $Source2 = $Source1
  $Source2Id = $Source1Id
}
else {
  $Source2Id = "SRC-" + $CenterId + "-TS-" + $SourceTimestamp
  $Source2 = Read-Source `
    -SourceId $Source2Id `
    -Purpose "collegamento tradizione-scala"
}

$Reviewer = Read-Required "Nome del revisore responsabile"

Write-Host ""
Write-Host "RIEPILOGO"
Write-Host "---------"
Write-Host ("Periodo: " + $PeriodId + " — " + $PeriodLabel)
Write-Host ("Area: " + $AreaId + " — " + $AreaLabel)
Write-Host ("Centro: " + $Center.label)
Write-Host ("Tradizione: " + $TraditionLabel)
Write-Host ("Scala: " + $ScaleName)
Write-Host ("Fonte centro-tradizione: " + $Source1.title)
Write-Host ("Fonte tradizione-scala: " + $Source2.title)
Write-Host ""
Write-Host (
  "Il comando verifica la completezza strutturale, non sostituisce "
  + "la valutazione scientifica delle fonti."
) -ForegroundColor Yellow

$Confirmation = Read-Host (
  "Scrivi " +
  [string]$Policy.required_confirmations.final_keyword +
  " per pubblicare"
)

if (
  -not $Confirmation.Equals(
    [string]$Policy.required_confirmations.final_keyword,
    [System.StringComparison]::Ordinal
  )
) {
  Write-Host ""
  Write-Host "Pubblicazione annullata. Nessuna cartella creata."
  exit 0
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $SoftwareRoot (
  "backups\documented-center-case-" +
  $Timestamp
)

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null

$PackageDirectory = Join-Path $Center.full_path "dati\musica_documentata"
$ProfilePath = Join-Path $PackageDirectory "musica-centro.json"
$SourcesTextPath = Join-Path $PackageDirectory "FONTI_DOCUMENTATE.txt"
$ManifestTextPath = Join-Path $PackageDirectory "MANIFESTO_DOCUMENTAZIONE.txt"

if (Test-Path -LiteralPath $ProfilePath -PathType Leaf) {
  Backup-File `
    -Path $ProfilePath `
    -BackupRoot $BackupRoot `
    -ArchiveRoot $ArchiveRoot
}

New-Item `
  -ItemType Directory `
  -Path $PackageDirectory `
  -Force |
Out-Null

$AllSources = New-Object System.Collections.ArrayList
[void]$AllSources.Add($Source1)

if ($Source2Id -ne $Source1Id) {
  [void]$AllSources.Add($Source2)
}

$ProfileId = (
  $PeriodId +
  "-" +
  $AreaId +
  "-" +
  $CenterId +
  "-MUSIC-DOCUMENTED"
)

$Now = (Get-Date).ToString("o")

$ProfileTemplate.profile_id = $ProfileId
$ProfileTemplate.scope.center_id = $CenterId
$ProfileTemplate.scope.center_label = $Center.label
$ProfileTemplate.scope.folder_name = $Center.folder_name
$ProfileTemplate.period.id = $PeriodId
$ProfileTemplate.period.label = $PeriodLabel
$ProfileTemplate.period.order = $PeriodOrder
$ProfileTemplate.area.id = $AreaId
$ProfileTemplate.area.label = $AreaLabel
$ProfileTemplate.documentation.statement = (
  $CenterTraditionClaim +
  " " +
  $TraditionScaleClaim
)
$ProfileTemplate.documentation.geography_relation = $GeographyRelation
$ProfileTemplate.documentation.chronology_statement = $ChronologyStatement
$ProfileTemplate.documentation.geography_statement = $GeographyStatement
$ProfileTemplate.musical_evidence = @(
  [PSCustomObject]@{
    evidence_id = $ProfileId + "-CENTER-TRADITION"
    type = "center_tradition"
    status = "documentato"
    statement = $CenterTraditionClaim
    source_ids = @($Source1Id)
  },
  [PSCustomObject]@{
    evidence_id = $ProfileId + "-TRADITION-SCALE"
    type = "tradition_scale"
    status = "documentato"
    statement = $TraditionScaleClaim
    source_ids = @($Source2Id)
  }
)
$ProfileTemplate.tradition_links = @(
  [PSCustomObject]@{
    tradition_id = $TraditionId
    relation_status = "documentato"
    source_ids = @($Source1Id)
  }
)
$ProfileTemplate.scale_links = @(
  [PSCustomObject]@{
    scale_id = $ScaleId
    relation_status = "documentato"
    source_ids = @($Source2Id)
  }
)
$ProfileTemplate.documents = @(
  [PSCustomObject]@{
    document_id = $ProfileId + "-SOURCES"
    label = "Fonti documentate"
    path = "./FONTI_DOCUMENTATE.txt"
    type = "text"
  },
  [PSCustomObject]@{
    document_id = $ProfileId + "-MANIFEST"
    label = "Manifesto della documentazione"
    path = "./MANIFESTO_DOCUMENTAZIONE.txt"
    type = "text"
  }
)
$ProfileTemplate.sources = @($AllSources)
$ProfileTemplate.review.reviewer = $Reviewer
$ProfileTemplate.review.last_reviewed = $Now

Write-Utf8Bom `
  -Path $ProfilePath `
  -Content ($ProfileTemplate | ConvertTo-Json -Depth 100)

$TraditionsDirectory = Join-Path $Area.full_path "Tradizioni musicali"
New-Item `
  -ItemType Directory `
  -Path $TraditionsDirectory `
  -Force |
Out-Null

$TargetContainerFile = $null
$TargetContainer = $null

foreach ($ContainerFile in $ContainerFiles) {
  try {
    $CandidateContainer = Get-Content `
      -LiteralPath $ContainerFile.FullName `
      -Raw `
      -Encoding UTF8 |
    ConvertFrom-Json

    if (
      [string]$CandidateContainer.tradition.id -eq $TraditionId -and
      [string]$CandidateContainer.period.id -eq $PeriodId -and
      [string]$CandidateContainer.area.id -eq $AreaId
    ) {
      $TargetContainerFile = $ContainerFile.FullName
      $TargetContainer = $CandidateContainer
      break
    }
  }
  catch {
  }
}

if ($null -eq $TargetContainer) {
  $ExistingTraditionDirectories = @(
    Get-ChildItem `
      -LiteralPath $TraditionsDirectory `
      -Directory `
      -ErrorAction SilentlyContinue
  )

  $MaximumPrefix = 0

  foreach ($ExistingDirectory in $ExistingTraditionDirectories) {
    if ($ExistingDirectory.Name -match "^(\d{2})_") {
      $prefix = [int]$Matches[1]

      if ($prefix -gt $MaximumPrefix) {
        $MaximumPrefix = $prefix
      }
    }
  }

  $NewPrefix = ($MaximumPrefix + 1).ToString("00")
  $TraditionDirectory = Join-Path $TraditionsDirectory (
    $NewPrefix +
    "_" +
    $TraditionId
  )

  $TraditionDataDirectory = Join-Path $TraditionDirectory "dati"

  New-Item `
    -ItemType Directory `
    -Path $TraditionDataDirectory `
    -Force |
  Out-Null

  $TargetContainerFile = Join-Path `
    $TraditionDataDirectory `
    "musica-container.json"

  $TargetContainer = [PSCustomObject]@{
    schema_version = 1
    container_id = (
      "CONTAINER-" +
      $PeriodId +
      "-" +
      $AreaId +
      "-" +
      $TraditionId
    )
    record_status = "documentato"
    area = [PSCustomObject]@{
      id = $AreaId
      label = $AreaLabel
    }
    period = [PSCustomObject]@{
      id = $PeriodId
      label = $PeriodLabel
      order = $PeriodOrder
    }
    tradition = [PSCustomObject]@{
      id = $TraditionId
      label = $TraditionLabel
      historical_name = $HistoricalTraditionName
      documentation_status = "documentato"
    }
    scales = @()
    sources = @()
    documents = @()
  }
}
else {
  Backup-File `
    -Path $TargetContainerFile `
    -BackupRoot $BackupRoot `
    -ArchiveRoot $ArchiveRoot
}

$ScaleAlreadyPresent = $false

foreach ($Scale in @($TargetContainer.scales)) {
  if ([string]$Scale.scale_id -eq $ScaleId) {
    $ScaleAlreadyPresent = $true
    break
  }
}

if (-not $ScaleAlreadyPresent) {
  $NewScale = [PSCustomObject]@{
    scale_id = $ScaleId
    name = $ScaleName
    documentation_status = "documentato"
    historical_tuning = [PSCustomObject]@{
      description = $HistoricalTuning
      source_ids = @($Source2Id)
    }
    center = [PSCustomObject]@{
      label = $CenterLabel
      type = $CenterType
      pitch_class = $CenterPitchClass
    }
    notes_12tet = @($Notes12Tet)
    pitch_classes_12tet = @($PitchClasses)
    approximation = [PSCustomObject]@{
      system = "12-TET"
      quality = $ApproximationQuality
      warning = (
        "Approssimazione moderna utilizzata per il confronto e "
        + "l'armonizzazione; non coincide automaticamente con "
        + "l'intonazione storica."
      )
    }
    source_ids = @($Source2Id)
    documents = @()
  }

  $TargetContainer.scales = @($TargetContainer.scales) + @($NewScale)
}

$ExistingSourceIds = @(
  @($TargetContainer.sources) |
  ForEach-Object {
    [string]$_.source_id
  }
)

foreach ($Source in @($AllSources)) {
  if (-not ($ExistingSourceIds -contains [string]$Source.source_id)) {
    $TargetContainer.sources = @($TargetContainer.sources) + @($Source)
  }
}

Write-Utf8Bom `
  -Path $TargetContainerFile `
  -Content ($TargetContainer | ConvertTo-Json -Depth 100)

$SourcesLines = New-Object System.Collections.ArrayList

[void]$SourcesLines.Add("FONTI DOCUMENTATE")
[void]$SourcesLines.Add("==================")
[void]$SourcesLines.Add("")
[void]$SourcesLines.Add("Centro: " + $Center.label)
[void]$SourcesLines.Add("Tradizione: " + $TraditionLabel)
[void]$SourcesLines.Add("Scala: " + $ScaleName)
[void]$SourcesLines.Add("")

foreach ($Source in @($AllSources)) {
  [void]$SourcesLines.Add("Source ID: " + $Source.source_id)
  [void]$SourcesLines.Add("Finalita: " + $Source.purpose)
  [void]$SourcesLines.Add("Classe: " + $Source.grade)
  [void]$SourcesLines.Add("Titolo: " + $Source.title)
  [void]$SourcesLines.Add("Autore: " + $Source.author)
  [void]$SourcesLines.Add("Anno: " + $Source.year)
  [void]$SourcesLines.Add("Editore o rivista: " + $Source.publisher_or_journal)
  [void]$SourcesLines.Add("Identificatore: " + $Source.identifier)
  [void]$SourcesLines.Add("Pagine: " + $Source.pages)
  [void]$SourcesLines.Add("")
}

Write-Utf8Bom `
  -Path $SourcesTextPath `
  -Content ($SourcesLines -join [Environment]::NewLine)

$ManifestText = @"
MANIFESTO DELLA DOCUMENTAZIONE MUSICALE
=======================================

Profilo:
$ProfileId

Periodo:
$PeriodId — $PeriodLabel

Area:
$AreaId — $AreaLabel

Centro:
$($Center.label)

Tradizione:
$TraditionId — $TraditionLabel

Scala:
$ScaleId — $ScaleName

STATO
-----
documentato

COLLEGAMENTO CENTRO-TRADIZIONE
------------------------------
$CenterTraditionClaim

Fonte:
$Source1Id

COLLEGAMENTO TRADIZIONE-SCALA
-----------------------------
$TraditionScaleClaim

Fonte:
$Source2Id

COMPATIBILITA CRONOLOGICA
-------------------------
$ChronologyStatement

Esito:
compatibile

COMPATIBILITA GEOGRAFICA
------------------------
Tipo:
$GeographyRelation

Motivazione:
$GeographyStatement

Esito:
compatibile

METODO
------
La cartella musica_documentata e stata creata soltanto dopo la compilazione
dei campi obbligatori, l'inserimento di fonti A o B e la conferma finale
DOCUMENTATO.

Il controllo automatico verifica coerenza e completezza strutturale.
Non sostituisce la revisione scientifica delle fonti.

APPROSSIMAZIONE 12-TET
----------------------
La rappresentazione 12-TET e utilizzata dal programma per confronti,
modulazioni e armonizzazioni occidentali proposte. Non costituisce da sola
una prova dell'intonazione storica.

Revisore:
$Reviewer

Data:
$Now
"@

Write-Utf8Bom `
  -Path $ManifestTextPath `
  -Content $ManifestText

Write-Host ""
Write-Host "Caso documentato pubblicato." -ForegroundColor Green
Write-Host ("Centro: " + $Center.label)
Write-Host ("Pacchetto: " + $PackageDirectory)
Write-Host ("Contenitore: " + $TargetContainerFile)
Write-Host ("Backup: " + $BackupRoot)
Write-Host ""

Start-Process -FilePath $PackageDirectory

exit 0
