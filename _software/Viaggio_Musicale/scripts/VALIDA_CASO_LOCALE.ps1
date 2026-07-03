param(
  [Parameter(Mandatory = $true)]
  [string]$ContainerPath,

  [Parameter(Mandatory = $true)]
  [string]$ProfilePath,

  [string]$ArchiveRoot = "",

  [switch]$UpdateIndexes
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

function To-FileUrl {
  param([string]$Path)

  try {
    return ([System.Uri]::new(
      [System.IO.Path]::GetFullPath($Path)
    )).AbsoluteUri
  }
  catch {
    return ""
  }
}

function Is-Documented {
  param([object]$Value)

  return (
    ([string]$Value).Trim().ToLowerInvariant() -eq "documentato"
  )
}

function Set-Property {
  param(
    [object]$Object,
    [string]$Name,
    [object]$Value
  )

  $Object |
    Add-Member `
      -NotePropertyName $Name `
      -NotePropertyValue $Value `
      -Force
}

function Set-ArrayProperty {
  param(
    [object]$Object,
    [string]$Name,
    [object[]]$Value
  )

  Set-Property `
    -Object $Object `
    -Name $Name `
    -Value ([object[]]@($Value))
}

function Add-ValidationError {
  param(
    [System.Collections.ArrayList]$Errors,
    [string]$Message
  )

  [void]$Errors.Add($Message)
}

function Get-RelativePathInsideArchive {
  param(
    [string]$Path,
    [string]$Root
  )

  $FullPath = [System.IO.Path]::GetFullPath($Path)
  $FullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd("\")
  $Prefix = $FullRoot + "\"

  if (-not $FullPath.StartsWith(
    $Prefix,
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
    throw ("Percorso esterno all'archivio: " + $FullPath)
  }

  return $FullPath.Substring($FullRoot.Length).TrimStart("\")
}

function Resolve-DocumentPath {
  param(
    [object]$Document,
    [string]$BaseDirectory,
    [string]$Root
  )

  $PathValue = [string]$Document.path

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return [PSCustomObject]@{
      valid = $false
      message = "documento senza path"
      resolved_path = ""
      relative_path = ""
      file_url = ""
      extension = ""
    }
  }

  try {
    if ([System.IO.Path]::IsPathRooted($PathValue)) {
      $ResolvedPath = [System.IO.Path]::GetFullPath($PathValue)
    }
    else {
      $ResolvedPath = [System.IO.Path]::GetFullPath(
        (Join-Path $BaseDirectory $PathValue)
      )
    }

    $RelativePath = Get-RelativePathInsideArchive `
      -Path $ResolvedPath `
      -Root $Root

    $Exists = Test-Path -LiteralPath $ResolvedPath -PathType Leaf

    return [PSCustomObject]@{
      valid = $Exists
      message = if ($Exists) {
        ""
      }
      else {
        "documento non trovato: " + $PathValue
      }
      resolved_path = $ResolvedPath
      relative_path = $RelativePath
      file_url = if ($Exists) {
        To-FileUrl $ResolvedPath
      }
      else {
        ""
      }
      extension = [System.IO.Path]::GetExtension(
        $ResolvedPath
      ).ToLowerInvariant()
    }
  }
  catch {
    return [PSCustomObject]@{
      valid = $false
      message = (
        "percorso documento non valido: " +
        $PathValue +
        " | " +
        $_.Exception.Message
      )
      resolved_path = ""
      relative_path = ""
      file_url = ""
      extension = ""
    }
  }
}

function Resolve-CatalogDocument {
  param(
    [object]$Document,
    [string]$BaseDirectory,
    [string]$Root
  )

  $Result = Resolve-DocumentPath `
    -Document $Document `
    -BaseDirectory $BaseDirectory `
    -Root $Root

  $Copy = (
    ($Document | ConvertTo-Json -Depth 30) |
    ConvertFrom-Json
  )

  Set-Property -Object $Copy -Name "_exists" -Value $Result.valid
  Set-Property -Object $Copy -Name "_blocked" -Value $false
  Set-Property -Object $Copy -Name "_resolved_path" -Value $Result.resolved_path
  Set-Property -Object $Copy -Name "_relative_path" -Value $Result.relative_path
  Set-Property -Object $Copy -Name "_file_url" -Value $Result.file_url
  Set-Property -Object $Copy -Name "_extension" -Value $Result.extension

  return $Copy
}

function Resolve-ProfileDocument {
  param(
    [object]$Document,
    [string]$BaseDirectory,
    [string]$Root
  )

  $Result = Resolve-DocumentPath `
    -Document $Document `
    -BaseDirectory $BaseDirectory `
    -Root $Root

  return [PSCustomObject]@{
    document_id = [string]$Document.document_id
    label = [string]$Document.label
    type = [string]$Document.type
    path = [string]$Document.path
    relative_path = $Result.relative_path
    exists = $Result.valid
    blocked = $false
    file_url = $Result.file_url
  }
}

function Read-WindowJson {
  param(
    [string]$Path,
    [string]$VariableName
  )

  $Text = [System.IO.File]::ReadAllText(
    $Path,
    [System.Text.Encoding]::UTF8
  )

  $PrefixPattern = (
    "^\s*" +
    [System.Text.RegularExpressions.Regex]::Escape(
      "window." + $VariableName
    ) +
    "\s*=\s*"
  )

  $Text = [System.Text.RegularExpressions.Regex]::Replace(
    $Text,
    $PrefixPattern,
    ""
  )

  $Text = [System.Text.RegularExpressions.Regex]::Replace(
    $Text,
    ";\s*$",
    ""
  )

  return ($Text | ConvertFrom-Json)
}

function Test-SourceIds {
  param(
    [object[]]$SourceIds,
    [hashtable]$AvailableIds,
    [System.Collections.ArrayList]$Errors,
    [string]$Owner
  )

  foreach ($SourceIdValue in @($SourceIds)) {
    $SourceId = [string]$SourceIdValue

    if ([string]::IsNullOrWhiteSpace($SourceId)) {
      Add-ValidationError `
        -Errors $Errors `
        -Message ($Owner + ": source_id vuoto")
      continue
    }

    if (-not $AvailableIds.ContainsKey($SourceId)) {
      Add-ValidationError `
        -Errors $Errors `
        -Message (
          $Owner +
          ": source_id non risolto: " +
          $SourceId
        )
    }
  }
}

if (-not (Test-Path -LiteralPath $ContainerPath -PathType Leaf)) {
  Write-Error ("Contenitore non trovato: " + $ContainerPath)
  exit 2
}

if (-not (Test-Path -LiteralPath $ProfilePath -PathType Leaf)) {
  Write-Error ("Profilo non trovato: " + $ProfilePath)
  exit 3
}

$ContainerPath = [System.IO.Path]::GetFullPath($ContainerPath)
$ProfilePath = [System.IO.Path]::GetFullPath($ProfilePath)

if ([string]::IsNullOrWhiteSpace($ArchiveRoot)) {
  $Probe = [System.IO.Directory]::GetParent(
    (Split-Path -Parent $ProfilePath)
  )

  while ($null -ne $Probe) {
    if (
      Test-Path `
        -LiteralPath (Join-Path $Probe.FullName "archivio-musicale.json") `
        -PathType Leaf
    ) {
      $ArchiveRoot = $Probe.FullName
      break
    }

    $Probe = $Probe.Parent
  }
}

if ([string]::IsNullOrWhiteSpace($ArchiveRoot)) {
  Write-Error "Radice dell'archivio non individuata."
  exit 4
}

$ArchiveRoot = [System.IO.Path]::GetFullPath($ArchiveRoot)
$SoftwareRoot = Join-Path $ArchiveRoot "_software\Viaggio_Musicale"
$GeneratedDirectory = Join-Path $SoftwareRoot "generated"

try {
  $ContainerRelative = Get-RelativePathInsideArchive `
    -Path $ContainerPath `
    -Root $ArchiveRoot

  $ProfileRelative = Get-RelativePathInsideArchive `
    -Path $ProfilePath `
    -Root $ArchiveRoot
}
catch {
  Write-Error $_.Exception.Message
  exit 5
}

$Errors = New-Object System.Collections.ArrayList

try {
  $Container = Get-Content `
    -LiteralPath $ContainerPath `
    -Raw `
    -Encoding UTF8 |
  ConvertFrom-Json
}
catch {
  Write-Error (
    "Contenitore JSON non leggibile: " +
    $_.Exception.Message
  )
  exit 6
}

try {
  $Profile = Get-Content `
    -LiteralPath $ProfilePath `
    -Raw `
    -Encoding UTF8 |
  ConvertFrom-Json
}
catch {
  Write-Error (
    "Profilo JSON non leggibile: " +
    $_.Exception.Message
  )
  exit 7
}

if ($null -eq $Container.schema_version) {
  Add-ValidationError -Errors $Errors -Message "container.schema_version mancante"
}

if ([string]::IsNullOrWhiteSpace([string]$Container.container_id)) {
  Add-ValidationError -Errors $Errors -Message "container_id mancante"
}

if (-not (Is-Documented $Container.record_status)) {
  Add-ValidationError -Errors $Errors -Message "container.record_status non documentato"
}

if (
  [string]::IsNullOrWhiteSpace([string]$Container.area.id) -or
  [string]::IsNullOrWhiteSpace([string]$Container.area.label)
) {
  Add-ValidationError -Errors $Errors -Message "container.area non valida"
}

if (
  [string]::IsNullOrWhiteSpace([string]$Container.period.id) -or
  [string]::IsNullOrWhiteSpace([string]$Container.period.label)
) {
  Add-ValidationError -Errors $Errors -Message "container.period non valido"
}

if (
  [string]::IsNullOrWhiteSpace([string]$Container.tradition.id) -or
  -not (Is-Documented $Container.tradition.documentation_status)
) {
  Add-ValidationError -Errors $Errors -Message "container.tradition non documentata"
}

$ContainerSourceIds = @{}
foreach ($Source in @($Container.sources)) {
  $SourceId = [string]$Source.source_id

  if ([string]::IsNullOrWhiteSpace($SourceId)) {
    Add-ValidationError -Errors $Errors -Message "fonte del contenitore senza source_id"
    continue
  }

  if ($ContainerSourceIds.ContainsKey($SourceId)) {
    Add-ValidationError `
      -Errors $Errors `
      -Message ("source_id duplicato nel contenitore: " + $SourceId)
  }
  else {
    $ContainerSourceIds[$SourceId] = $true
  }

  if (@("A", "B") -notcontains ([string]$Source.grade).ToUpperInvariant()) {
    Add-ValidationError `
      -Errors $Errors `
      -Message ("classe fonte non ammessa: " + $SourceId)
  }
}

Test-SourceIds `
  -SourceIds ([object[]]@($Container.tradition.source_ids)) `
  -AvailableIds $ContainerSourceIds `
  -Errors $Errors `
  -Owner ("tradizione " + [string]$Container.tradition.id)

$ScaleIds = @{}
foreach ($Scale in @($Container.scales)) {
  $ScaleId = [string]$Scale.scale_id

  if ([string]::IsNullOrWhiteSpace($ScaleId)) {
    Add-ValidationError -Errors $Errors -Message "scala senza scale_id"
    continue
  }

  if ($ScaleIds.ContainsKey($ScaleId)) {
    Add-ValidationError `
      -Errors $Errors `
      -Message ("scale_id duplicato nel contenitore: " + $ScaleId)
  }
  else {
    $ScaleIds[$ScaleId] = $true
  }

  if (-not (Is-Documented $Scale.documentation_status)) {
    Add-ValidationError `
      -Errors $Errors `
      -Message ("scala non documentata: " + $ScaleId)
  }

  if ([string]::IsNullOrWhiteSpace([string]$Scale.name)) {
    Add-ValidationError `
      -Errors $Errors `
      -Message ("scala senza nome: " + $ScaleId)
  }

  $CenterPitchClass = -1

  try {
    $CenterPitchClass = [int]$Scale.center.pitch_class
  }
  catch {
    $CenterPitchClass = -1
  }

  if ($CenterPitchClass -lt 0 -or $CenterPitchClass -gt 11) {
    Add-ValidationError `
      -Errors $Errors `
      -Message ("center.pitch_class non valido: " + $ScaleId)
  }

  $PitchClasses = @($Scale.pitch_classes_12tet)

  if ($PitchClasses.Count -lt 3) {
    Add-ValidationError `
      -Errors $Errors `
      -Message ("meno di tre pitch class: " + $ScaleId)
  }

  foreach ($PitchClassValue in $PitchClasses) {
    $PitchClass = -1

    try {
      $PitchClass = [int]$PitchClassValue
    }
    catch {
      $PitchClass = -1
    }

    if ($PitchClass -lt 0 -or $PitchClass -gt 11) {
      Add-ValidationError `
        -Errors $Errors `
        -Message (
          "pitch class non valida in " +
          $ScaleId +
          ": " +
          [string]$PitchClassValue
        )
    }
  }

  Test-SourceIds `
    -SourceIds ([object[]]@($Scale.source_ids)) `
    -AvailableIds $ContainerSourceIds `
    -Errors $Errors `
    -Owner ("scala " + $ScaleId)

  if ($null -ne $Scale.historical_tuning) {
    Test-SourceIds `
      -SourceIds ([object[]]@($Scale.historical_tuning.source_ids)) `
      -AvailableIds $ContainerSourceIds `
      -Errors $Errors `
      -Owner ("accordatura " + $ScaleId)
  }
}

if ($ScaleIds.Count -eq 0) {
  Add-ValidationError -Errors $Errors -Message "nessuna scala o sistema nel contenitore"
}

$ContainerDirectory = Split-Path -Parent $ContainerPath

foreach ($Document in @($Container.documents)) {
  $Result = Resolve-DocumentPath `
    -Document $Document `
    -BaseDirectory $ContainerDirectory `
    -Root $ArchiveRoot

  if (-not $Result.valid) {
    Add-ValidationError `
      -Errors $Errors `
      -Message (
        "contenitore " +
        [string]$Container.container_id +
        ": " +
        $Result.message
      )
  }
}

foreach ($Scale in @($Container.scales)) {
  foreach ($Document in @($Scale.documents)) {
    $Result = Resolve-DocumentPath `
      -Document $Document `
      -BaseDirectory $ContainerDirectory `
      -Root $ArchiveRoot

    if (-not $Result.valid) {
      Add-ValidationError `
        -Errors $Errors `
        -Message (
          "scala " +
          [string]$Scale.scale_id +
          ": " +
          $Result.message
        )
    }
  }
}

if ([string]$Profile.record_type -ne "center_music_profile") {
  Add-ValidationError -Errors $Errors -Message "profile.record_type non valido"
}

if (-not (Is-Documented $Profile.record_status)) {
  Add-ValidationError -Errors $Errors -Message "profile.record_status non documentato"
}

if (-not (Is-Documented $Profile.documentation.status)) {
  Add-ValidationError -Errors $Errors -Message "profile.documentation.status non documentato"
}

if ([string]$Profile.documentation.chronology_status -ne "compatibile") {
  Add-ValidationError -Errors $Errors -Message "cronologia non confermata"
}

if ([string]$Profile.documentation.geography_status -ne "compatibile") {
  Add-ValidationError -Errors $Errors -Message "geografia non confermata"
}

if (
  @("nel_centro", "territorio_immediato", "regionale_motivata") -notcontains
  ([string]$Profile.documentation.geography_relation)
) {
  Add-ValidationError -Errors $Errors -Message "geography_relation non ammessa"
}

if ($Profile.documentation.historical_system_resolvable -ne $true) {
  Add-ValidationError -Errors $Errors -Message "sistema storico non risolvibile"
}

$ProfileSourceIds = @{}
foreach ($Source in @($Profile.sources)) {
  $SourceId = [string]$Source.source_id

  if ([string]::IsNullOrWhiteSpace($SourceId)) {
    Add-ValidationError -Errors $Errors -Message "fonte del profilo senza source_id"
    continue
  }

  if ($ProfileSourceIds.ContainsKey($SourceId)) {
    Add-ValidationError `
      -Errors $Errors `
      -Message ("source_id duplicato nel profilo: " + $SourceId)
  }
  else {
    $ProfileSourceIds[$SourceId] = $true
  }

  if (@("A", "B") -notcontains ([string]$Source.grade).ToUpperInvariant()) {
    Add-ValidationError `
      -Errors $Errors `
      -Message ("classe fonte non ammessa nel profilo: " + $SourceId)
  }
}

foreach ($Evidence in @($Profile.musical_evidence)) {
  Test-SourceIds `
    -SourceIds ([object[]]@($Evidence.source_ids)) `
    -AvailableIds $ProfileSourceIds `
    -Errors $Errors `
    -Owner ("evidenza " + [string]$Evidence.evidence_id)
}

$TraditionChainFound = $false
foreach ($Link in @($Profile.tradition_links)) {
  Test-SourceIds `
    -SourceIds ([object[]]@($Link.source_ids)) `
    -AvailableIds $ProfileSourceIds `
    -Errors $Errors `
    -Owner ("collegamento tradizione " + [string]$Link.tradition_id)

  if (
    [string]$Link.tradition_id -eq [string]$Container.tradition.id -and
    (Is-Documented $Link.relation_status)
  ) {
    $TraditionChainFound = $true
  }
}

$ScaleChainFound = $false
foreach ($Link in @($Profile.scale_links)) {
  Test-SourceIds `
    -SourceIds ([object[]]@($Link.source_ids)) `
    -AvailableIds $ProfileSourceIds `
    -Errors $Errors `
    -Owner ("collegamento scala " + [string]$Link.scale_id)

  if (
    $ScaleIds.ContainsKey([string]$Link.scale_id) -and
    (Is-Documented $Link.relation_status)
  ) {
    $ScaleChainFound = $true
  }
}

if (-not $TraditionChainFound) {
  Add-ValidationError -Errors $Errors -Message "collegamento alla tradizione non risolto"
}

if (-not $ScaleChainFound) {
  Add-ValidationError -Errors $Errors -Message "collegamento alla scala non risolto"
}

$ProfileDirectory = Split-Path -Parent $ProfilePath

foreach ($Document in @($Profile.documents)) {
  $Result = Resolve-DocumentPath `
    -Document $Document `
    -BaseDirectory $ProfileDirectory `
    -Root $ArchiveRoot

  if (-not $Result.valid) {
    Add-ValidationError `
      -Errors $Errors `
      -Message (
        "profilo " +
        [string]$Profile.profile_id +
        ": " +
        $Result.message
      )
  }
}

$PackageDirectory = [System.IO.Directory]::GetParent($ProfilePath).FullName
$DataDirectory = [System.IO.Directory]::GetParent($PackageDirectory)
$CenterDirectory = if ($null -ne $DataDirectory) {
  $DataDirectory.Parent
}
else {
  $null
}

if (
  $null -eq $CenterDirectory -or
  $null -eq $CenterDirectory.Parent -or
  $CenterDirectory.Parent.Name -ne "Centri abitati"
) {
  Add-ValidationError -Errors $Errors -Message "profilo esterno a un centro canonico"
}
elseif (
  [string]$Profile.scope.folder_name -ne [string]$CenterDirectory.Name
) {
  Add-ValidationError `
    -Errors $Errors `
    -Message (
      "scope.folder_name non coincide con il centro: " +
      [string]$Profile.scope.folder_name +
      " / " +
      [string]$CenterDirectory.Name
    )
}

if ($Errors.Count -gt 0) {
  Write-Host ""
  Write-Host "VALIDAZIONE LOCALE FALLITA" -ForegroundColor Red

  foreach ($Message in $Errors) {
    Write-Host ("- " + $Message) -ForegroundColor Red
  }

  exit 10
}

Write-Host ""
Write-Host "Validazione locale completata." -ForegroundColor Green
Write-Host ("Contenitore: " + [string]$Container.container_id)
Write-Host ("Profilo: " + [string]$Profile.profile_id)

if (-not $UpdateIndexes) {
  exit 0
}

New-Item -ItemType Directory -Path $GeneratedDirectory -Force | Out-Null

$RuntimeContainer = (
  ($Container | ConvertTo-Json -Depth 100) |
  ConvertFrom-Json
)

$ResolvedContainerDocuments = New-Object System.Collections.ArrayList
foreach ($Document in @($RuntimeContainer.documents)) {
  [void]$ResolvedContainerDocuments.Add(
    (Resolve-CatalogDocument `
      -Document $Document `
      -BaseDirectory $ContainerDirectory `
      -Root $ArchiveRoot)
  )
}
Set-ArrayProperty `
  -Object $RuntimeContainer `
  -Name "documents" `
  -Value ([object[]]@($ResolvedContainerDocuments))

foreach ($Scale in @($RuntimeContainer.scales)) {
  $ResolvedScaleDocuments = New-Object System.Collections.ArrayList

  foreach ($Document in @($Scale.documents)) {
    [void]$ResolvedScaleDocuments.Add(
      (Resolve-CatalogDocument `
        -Document $Document `
        -BaseDirectory $ContainerDirectory `
        -Root $ArchiveRoot)
    )
  }

  Set-ArrayProperty `
    -Object $Scale `
    -Name "documents" `
    -Value ([object[]]@($ResolvedScaleDocuments))

  Set-ArrayProperty `
    -Object $Scale `
    -Name "notes_12tet" `
    -Value ([object[]]@($Scale.notes_12tet))

  Set-ArrayProperty `
    -Object $Scale `
    -Name "pitch_classes_12tet" `
    -Value ([object[]]@($Scale.pitch_classes_12tet))

  Set-ArrayProperty `
    -Object $Scale `
    -Name "source_ids" `
    -Value ([object[]]@($Scale.source_ids))

  if ($null -ne $Scale.historical_tuning) {
    Set-ArrayProperty `
      -Object $Scale.historical_tuning `
      -Name "source_ids" `
      -Value ([object[]]@($Scale.historical_tuning.source_ids))

    Set-ArrayProperty `
      -Object $Scale.historical_tuning `
      -Name "measured_natural_sequence" `
      -Value ([object[]]@($Scale.historical_tuning.measured_natural_sequence))

    Set-ArrayProperty `
      -Object $Scale.historical_tuning `
      -Name "measured_intervals_cents" `
      -Value ([object[]]@($Scale.historical_tuning.measured_intervals_cents))

    Set-ArrayProperty `
      -Object $Scale.historical_tuning `
      -Name "scale_degrees_from_keynote" `
      -Value ([object[]]@($Scale.historical_tuning.scale_degrees_from_keynote))
  }
}

Set-ArrayProperty `
  -Object $RuntimeContainer `
  -Name "scales" `
  -Value ([object[]]@($RuntimeContainer.scales))

Set-ArrayProperty `
  -Object $RuntimeContainer `
  -Name "sources" `
  -Value ([object[]]@($RuntimeContainer.sources))

Set-ArrayProperty `
  -Object $RuntimeContainer.tradition `
  -Name "source_ids" `
  -Value ([object[]]@($RuntimeContainer.tradition.source_ids))

Set-Property `
  -Object $RuntimeContainer `
  -Name "_source_file" `
  -Value $ContainerRelative

Set-Property `
  -Object $RuntimeContainer `
  -Name "_source_directory" `
  -Value $ContainerDirectory

Set-Property `
  -Object $RuntimeContainer `
  -Name "_directory_url" `
  -Value (To-FileUrl $ContainerDirectory)

$CatalogPath = Join-Path $GeneratedDirectory "catalog.js"

if (Test-Path -LiteralPath $CatalogPath -PathType Leaf) {
  try {
    $Catalog = Read-WindowJson `
      -Path $CatalogPath `
      -VariableName "ARCHIVE_CATALOG"
  }
  catch {
    Write-Error (
      "catalog.js non leggibile. Eseguire il consolidamento globale. " +
      $_.Exception.Message
    )
    exit 11
  }
}
else {
  $Theme = Get-Content `
    -LiteralPath (Join-Path $SoftwareRoot "config\theme.json") `
    -Raw `
    -Encoding UTF8 |
  ConvertFrom-Json

  $Rules = Get-Content `
    -LiteralPath (Join-Path $SoftwareRoot "config\modulation-rules.json") `
    -Raw `
    -Encoding UTF8 |
  ConvertFrom-Json

  $Catalog = [PSCustomObject]@{
    schema_version = 1
    generated_at = ""
    archive_root = $ArchiveRoot
    data_file_name = "musica-container.json"
    theme = $Theme
    rules = $Rules
    containers = [object[]]@()
    errors = [object[]]@()
    stats = [PSCustomObject]@{}
  }
}

$IncomingScaleIds = @{}
foreach ($Scale in @($RuntimeContainer.scales)) {
  $IncomingScaleIds[[string]$Scale.scale_id] = $true
}

$NewContainers = New-Object System.Collections.ArrayList

foreach ($ExistingContainer in @($Catalog.containers)) {
  $SameContainer = (
    [string]$ExistingContainer.container_id -eq
    [string]$RuntimeContainer.container_id
  )

  $SameSourceFile = (
    [string]$ExistingContainer._source_file -eq
    $ContainerRelative
  )

  if ($SameContainer -or $SameSourceFile) {
    continue
  }

  foreach ($ExistingScale in @($ExistingContainer.scales)) {
    $ExistingScaleId = [string]$ExistingScale.scale_id

    if ($IncomingScaleIds.ContainsKey($ExistingScaleId)) {
      Write-Error (
        "scale_id già presente in un altro contenitore: " +
        $ExistingScaleId
      )
      exit 12
    }
  }

  [void]$NewContainers.Add($ExistingContainer)
}

[void]$NewContainers.Add($RuntimeContainer)

$SortedContainers = @(
  @($NewContainers) |
  Sort-Object `
    @{ Expression = { [int]$_.period.order } }, `
    @{ Expression = { [string]$_.area.label } }, `
    @{ Expression = { [string]$_.tradition.label } }
)

$CatalogErrors = @(
  @($Catalog.errors) |
  Where-Object {
    [string]$_.file -ne $ContainerRelative
  }
)

$ScaleCount = 0
$DocumentCount = 0
$MissingDocumentCount = 0

foreach ($CatalogContainer in $SortedContainers) {
  $ScaleCount += @($CatalogContainer.scales).Count

  foreach ($Document in @($CatalogContainer.documents)) {
    $DocumentCount += 1

    if ($Document._exists -ne $true) {
      $MissingDocumentCount += 1
    }
  }

  foreach ($Scale in @($CatalogContainer.scales)) {
    foreach ($Document in @($Scale.documents)) {
      $DocumentCount += 1

      if ($Document._exists -ne $true) {
        $MissingDocumentCount += 1
      }
    }
  }
}

Set-Property `
  -Object $Catalog `
  -Name "generated_at" `
  -Value ((Get-Date).ToString("o"))

Set-Property `
  -Object $Catalog `
  -Name "archive_root" `
  -Value $ArchiveRoot

Set-ArrayProperty `
  -Object $Catalog `
  -Name "containers" `
  -Value ([object[]]@($SortedContainers))

Set-ArrayProperty `
  -Object $Catalog `
  -Name "errors" `
  -Value ([object[]]@($CatalogErrors))

Set-Property `
  -Object $Catalog `
  -Name "stats" `
  -Value ([PSCustomObject]@{
    files_found = @($SortedContainers).Count
    containers = @($SortedContainers).Count
    scales = $ScaleCount
    documents = $DocumentCount
    missing_documents = $MissingDocumentCount
    errors = @($CatalogErrors).Count
  })

$CatalogJson = $Catalog | ConvertTo-Json -Depth 100
Write-Utf8Bom `
  -Path $CatalogPath `
  -Content ("window.ARCHIVE_CATALOG = " + $CatalogJson + ";")

$RuntimeProfileDocuments = New-Object System.Collections.ArrayList
foreach ($Document in @($Profile.documents)) {
  [void]$RuntimeProfileDocuments.Add(
    (Resolve-ProfileDocument `
      -Document $Document `
      -BaseDirectory $ProfileDirectory `
      -Root $ArchiveRoot)
  )
}

$ResolvedTraditionLinks = @(
  @($Profile.tradition_links) |
  Where-Object {
    [string]$_.tradition_id -eq [string]$Container.tradition.id -and
    (Is-Documented $_.relation_status)
  }
)

$ResolvedScaleLinks = @(
  @($Profile.scale_links) |
  Where-Object {
    $ScaleIds.ContainsKey([string]$_.scale_id) -and
    (Is-Documented $_.relation_status)
  }
)

$CenterRelative = Get-RelativePathInsideArchive `
  -Path $CenterDirectory.FullName `
  -Root $ArchiveRoot

$RuntimeProfile = [PSCustomObject]@{
  profile_id = [string]$Profile.profile_id
  record_status = "documentato"
  center_id = [string]$Profile.scope.center_id
  center_label = [string]$Profile.scope.center_label
  center_folder = [string]$CenterDirectory.Name
  center_relative_path = $CenterRelative
  center_directory_url = To-FileUrl $CenterDirectory.FullName
  profile_file_url = To-FileUrl $ProfilePath
  period = $Profile.period
  area = $Profile.area
  documentation = $Profile.documentation
  musical_evidence = [object[]]@($Profile.musical_evidence)
  tradition_links = [object[]]@($ResolvedTraditionLinks)
  scale_links = [object[]]@($ResolvedScaleLinks)
  sources = [object[]]@($Profile.sources)
  review = $Profile.review
  documents = [object[]]@($RuntimeProfileDocuments)
  counts = [PSCustomObject]@{
    evidence = @($Profile.musical_evidence).Count
    traditions = @($ResolvedTraditionLinks).Count
    scales = @($ResolvedScaleLinks).Count
    sources = @($Profile.sources).Count
    documents = @($RuntimeProfileDocuments).Count
  }
}

$IndexJsonPath = Join-Path $GeneratedDirectory "center-music-index.json"
$IndexJsPath = Join-Path $GeneratedDirectory "center-music-index.js"

if (Test-Path -LiteralPath $IndexJsonPath -PathType Leaf) {
  try {
    $Index = Get-Content `
      -LiteralPath $IndexJsonPath `
      -Raw `
      -Encoding UTF8 |
    ConvertFrom-Json
  }
  catch {
    Write-Error (
      "center-music-index.json non leggibile. " +
      "Eseguire il consolidamento globale. " +
      $_.Exception.Message
    )
    exit 13
  }
}
else {
  $Index = [PSCustomObject]@{
    schema_version = 3
    generated_at = ""
    storage_model = "center_local_documented_package"
    archive_root = $ArchiveRoot
    profiles = [object[]]@()
    rejected = [object[]]@()
    errors = [object[]]@()
    container_errors = [object[]]@()
    stats = [PSCustomObject]@{}
  }
}

$NewProfiles = New-Object System.Collections.ArrayList

foreach ($ExistingProfile in @($Index.profiles)) {
  if (
    [string]$ExistingProfile.profile_id -eq
      [string]$RuntimeProfile.profile_id -or
    [string]$ExistingProfile.center_relative_path -eq
      $CenterRelative
  ) {
    continue
  }

  [void]$NewProfiles.Add($ExistingProfile)
}

[void]$NewProfiles.Add($RuntimeProfile)

$SortedProfiles = @(
  @($NewProfiles) |
  Sort-Object `
    @{ Expression = { [int]$_.period.order } }, `
    @{ Expression = { [string]$_.area.label } }, `
    @{ Expression = { [string]$_.center_label } }
)

$Rejected = @(
  @($Index.rejected) |
  Where-Object {
    [string]$_.file -ne $ProfileRelative
  }
)

$ProfileErrors = @(
  @($Index.errors) |
  Where-Object {
    [string]$_.file -ne $ProfileRelative
  }
)

$ContainerErrors = @(
  @($Index.container_errors) |
  Where-Object {
    [string]$_.file -ne $ContainerRelative
  }
)

Set-Property `
  -Object $Index `
  -Name "generated_at" `
  -Value ((Get-Date).ToString("o"))

Set-Property `
  -Object $Index `
  -Name "archive_root" `
  -Value $ArchiveRoot

Set-ArrayProperty `
  -Object $Index `
  -Name "profiles" `
  -Value ([object[]]@($SortedProfiles))

Set-ArrayProperty `
  -Object $Index `
  -Name "rejected" `
  -Value ([object[]]@($Rejected))

Set-ArrayProperty `
  -Object $Index `
  -Name "errors" `
  -Value ([object[]]@($ProfileErrors))

Set-ArrayProperty `
  -Object $Index `
  -Name "container_errors" `
  -Value ([object[]]@($ContainerErrors))

Set-Property `
  -Object $Index `
  -Name "stats" `
  -Value ([PSCustomObject]@{
    profiles = @($SortedProfiles).Count
    rejected = @($Rejected).Count
    errors = @($ProfileErrors).Count
    container_errors = @($ContainerErrors).Count
    statuses = [PSCustomObject]@{
      documentato = @($SortedProfiles).Count
      sintesi = 0
      inferito = 0
      non_documentato = 0
      altro = 0
    }
  })

$IndexJson = $Index | ConvertTo-Json -Depth 100

Write-Utf8Bom `
  -Path $IndexJsonPath `
  -Content $IndexJson

Write-Utf8Bom `
  -Path $IndexJsPath `
  -Content ("window.CENTER_MUSIC_INDEX = " + $IndexJson + ";")

$SafeProfileId = (
  [string]$Profile.profile_id -replace "[^A-Za-z0-9_-]", "_"
)

$ReportPath = Join-Path $GeneratedDirectory (
  "RAPPORTO_VALIDAZIONE_INCREMENTALE_" +
  $SafeProfileId +
  ".txt"
)

$Report = @"
VALIDAZIONE E AGGIORNAMENTO INCREMENTALE
========================================

Contenitore:
$ContainerPath

Profilo:
$ProfilePath

Container ID:
$($Container.container_id)

Tradizione:
$($Container.tradition.id)

Profilo ID:
$($Profile.profile_id)

Catalogo:
AGGIORNATO

Indice dei profili:
AGGIORNATO

Contenitori complessivi:
$(@($SortedContainers).Count)

Scale o sistemi complessivi:
$ScaleCount

Profili complessivi:
$(@($SortedProfiles).Count)

Metodo:
Aggiornamento degli indici ufficiali senza scansione ricorsiva globale.

Controllo globale consigliato:
Eseguire CONSOLIDA_BLOCCHI_MUSICALI.cmd dopo tre blocchi.
"@

Write-Utf8Bom -Path $ReportPath -Content $Report

Write-Host ""
Write-Host "Aggiornamento incrementale completato." -ForegroundColor Green
Write-Host ("Catalogo: " + $CatalogPath)
Write-Host ("Indice: " + $IndexJsonPath)
Write-Host ("Profili complessivi: " + @($SortedProfiles).Count)
Write-Host ("Rapporto: " + $ReportPath)
Write-Host ""

exit 0
