param(
  [string]$ArchiveRoot = ""
)

$ErrorActionPreference = "Stop"

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


function Add-ScanMessage {
  param(
    [System.Collections.ArrayList]$Messages,
    [string]$Severity,
    [string]$Category,
    [string]$File,
    [string]$Message
  )

  [void]$Messages.Add([PSCustomObject]@{
    severity = $Severity
    category = $Category
    file = $File
    message = $Message
  })
}

function To-FileUrl {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return ""
  }

  try {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    return ([System.Uri]::new($fullPath)).AbsoluteUri
  }
  catch {
    return ""
  }
}

function Resolve-Document {
  param(
    [object]$Document,
    [string]$BaseDirectory,
    [string]$ArchiveRoot,
    [string]$SourceFile,
    [string]$OwnerId,
    [System.Collections.ArrayList]$Messages
  )

  if ($null -eq $Document) {
    return $null
  }

  $pathValue = [string]$Document.path

  if ([string]::IsNullOrWhiteSpace($pathValue)) {
    $Document |
      Add-Member -NotePropertyName "_exists" -NotePropertyValue $false -Force
    $Document |
      Add-Member -NotePropertyName "_blocked" -NotePropertyValue $false -Force
    $Document |
      Add-Member -NotePropertyName "_file_url" -NotePropertyValue "" -Force
    $Document |
      Add-Member -NotePropertyName "_relative_path" -NotePropertyValue "" -Force

    Add-ScanMessage `
      -Messages $Messages `
      -Severity "warning" `
      -Category "document_path_missing" `
      -File $SourceFile `
      -Message ("Document path missing for " + $OwnerId)

    return $Document
  }

  try {
    if ([System.IO.Path]::IsPathRooted($pathValue)) {
      $resolvedPath = [System.IO.Path]::GetFullPath($pathValue)
    }
    else {
      $resolvedPath = [System.IO.Path]::GetFullPath(
        (Join-Path $BaseDirectory $pathValue)
      )
    }

    $archivePrefix = $ArchiveRoot.TrimEnd("\") + "\"
    $insideArchive =
      $resolvedPath.StartsWith(
        $archivePrefix,
        [System.StringComparison]::OrdinalIgnoreCase
      )

    $exists = $false
    $blocked = -not $insideArchive

    if (-not $blocked) {
      $exists = Test-Path -LiteralPath $resolvedPath -PathType Leaf
    }

    $relativePath = ""

    if ($insideArchive) {
      $relativePath = $resolvedPath.Substring($ArchiveRoot.Length).TrimStart("\")
    }

    $fileUrl = ""

    if ($exists -and -not $blocked) {
      $fileUrl = To-FileUrl $resolvedPath
    }

    $extension = [System.IO.Path]::GetExtension($resolvedPath).ToLowerInvariant()

    $Document |
      Add-Member -NotePropertyName "_exists" -NotePropertyValue $exists -Force
    $Document |
      Add-Member -NotePropertyName "_blocked" -NotePropertyValue $blocked -Force
    $Document |
      Add-Member -NotePropertyName "_resolved_path" -NotePropertyValue $resolvedPath -Force
    $Document |
      Add-Member -NotePropertyName "_relative_path" -NotePropertyValue $relativePath -Force
    $Document |
      Add-Member -NotePropertyName "_file_url" -NotePropertyValue $fileUrl -Force
    $Document |
      Add-Member -NotePropertyName "_extension" -NotePropertyValue $extension -Force

    if ($blocked) {
      Add-ScanMessage `
        -Messages $Messages `
        -Severity "warning" `
        -Category "document_outside_archive" `
        -File $SourceFile `
        -Message ("External document path blocked for " + $OwnerId + ": " + $pathValue)
    }
    elseif (-not $exists) {
      Add-ScanMessage `
        -Messages $Messages `
        -Severity "warning" `
        -Category "document_not_found" `
        -File $SourceFile `
        -Message ("Document not found for " + $OwnerId + ": " + $pathValue)
    }

    return $Document
  }
  catch {
    $Document |
      Add-Member -NotePropertyName "_exists" -NotePropertyValue $false -Force
    $Document |
      Add-Member -NotePropertyName "_blocked" -NotePropertyValue $false -Force
    $Document |
      Add-Member -NotePropertyName "_file_url" -NotePropertyValue "" -Force
    $Document |
      Add-Member -NotePropertyName "_relative_path" -NotePropertyValue "" -Force

    Add-ScanMessage `
      -Messages $Messages `
      -Severity "warning" `
      -Category "document_path_invalid" `
      -File $SourceFile `
      -Message ("Invalid document path for " + $OwnerId + ": " + $_.Exception.Message)

    return $Document
  }
}

if ([string]::IsNullOrWhiteSpace($ArchiveRoot)) {
  $ArchiveRoot = Join-Path $PSScriptRoot "..\..\.."
}
else {
  $ArchiveRoot = ([string]$ArchiveRoot).Trim().Trim('"')
}

try {
  $ArchiveRoot = [System.IO.Path]::GetFullPath($ArchiveRoot)
}
catch {
  Write-Error ("Invalid archive path: " + $ArchiveRoot)
  exit 2
}

if (-not (Test-Path -LiteralPath $ArchiveRoot -PathType Container)) {
  Write-Error ("Archive folder not found: " + $ArchiveRoot)
  exit 3
}

$SoftwareRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot "..")
)

$MarkerPath = Join-Path $ArchiveRoot "archivio-musicale.json"
$DataFileName = "musica-container.json"
$ExcludedDirectories = @(
  ".git",
  "_software",
  "node_modules",
  "generated",
  "cache"
)

if (Test-Path -LiteralPath $MarkerPath -PathType Leaf) {
  try {
    $marker = Get-Content -LiteralPath $MarkerPath -Raw -Encoding UTF8 |
      ConvertFrom-Json

    if ($marker.data_file_name) {
      $DataFileName = [string]$marker.data_file_name
    }

    if ($marker.excluded_directories) {
      $ExcludedDirectories = @($marker.excluded_directories)
    }
  }
  catch {
    Write-Warning "archivio-musicale.json cannot be read. Default values will be used."
  }
}

$Theme = $null
$Rules = $null

try {
  $Theme = Get-Content `
    -LiteralPath (Join-Path $SoftwareRoot "config\theme.json") `
    -Raw `
    -Encoding UTF8 |
    ConvertFrom-Json
}
catch {
  Write-Warning ("theme.json cannot be read: " + $_.Exception.Message)
}

try {
  $Rules = Get-Content `
    -LiteralPath (Join-Path $SoftwareRoot "config\modulation-rules.json") `
    -Raw `
    -Encoding UTF8 |
    ConvertFrom-Json
}
catch {
  Write-Warning ("modulation-rules.json cannot be read: " + $_.Exception.Message)
}

$Messages = New-Object System.Collections.ArrayList
$Containers = New-Object System.Collections.ArrayList
$ContainerIds = @{}
$ScaleIds = @{}

$Files = @(
  Get-ChildItem `
    -LiteralPath $ArchiveRoot `
    -Recurse `
    -File `
    -Filter $DataFileName `
    -ErrorAction SilentlyContinue
)

foreach ($file in $Files) {
  $relative = $file.FullName.Substring($ArchiveRoot.Length).TrimStart("\")
  $segments = $relative -split "[\\/]"

  $excluded = $false

  foreach ($segment in $segments) {
    if ($ExcludedDirectories -contains $segment) {
      $excluded = $true
      break
    }
  }

  if ($excluded) {
    continue
  }

  try {
    $container = Get-Content `
      -LiteralPath $file.FullName `
      -Raw `
      -Encoding UTF8 |
      ConvertFrom-Json

    $fileErrors = New-Object System.Collections.ArrayList

    if ($null -eq $container.schema_version) {
      [void]$fileErrors.Add("schema_version is missing")
    }

    if (-not $container.container_id) {
      [void]$fileErrors.Add("container_id is missing")
    }

    if (-not $container.area.id -or -not $container.area.label) {
      [void]$fileErrors.Add("area is invalid")
    }

    if (-not $container.period.id -or -not $container.period.label) {
      [void]$fileErrors.Add("period is invalid")
    }

    if (-not $container.tradition.id -or -not $container.tradition.label) {
      [void]$fileErrors.Add("tradition is invalid")
    }

    if (-not $container.scales -or @($container.scales).Count -eq 0) {
      [void]$fileErrors.Add("no scales found")
    }

    if ($container.container_id) {
      $containerKey = [string]$container.container_id

      if ($ContainerIds.ContainsKey($containerKey)) {
        [void]$fileErrors.Add("duplicate container_id: " + $containerKey)
      }
      else {
        $ContainerIds[$containerKey] = $relative
      }
    }

    foreach ($scale in @($container.scales)) {
      if (-not $scale.scale_id) {
        [void]$fileErrors.Add("scale without scale_id")
        continue
      }

      $scaleKey = [string]$scale.scale_id

      if ($ScaleIds.ContainsKey($scaleKey)) {
        [void]$fileErrors.Add("duplicate scale_id: " + $scaleKey)
      }
      else {
        $ScaleIds[$scaleKey] = $relative
      }

      if (-not $scale.name) {
        [void]$fileErrors.Add("scale without name: " + $scaleKey)
      }

      if ($null -eq $scale.center.pitch_class) {
        [void]$fileErrors.Add("scale without center.pitch_class: " + $scaleKey)
      }
      else {
        $centerPitchClass = [int]$scale.center.pitch_class

        if ($centerPitchClass -lt 0 -or $centerPitchClass -gt 11) {
          [void]$fileErrors.Add("center.pitch_class outside 0-11: " + $scaleKey)
        }
      }

      $pcs = @($scale.pitch_classes_12tet)

      if ($pcs.Count -lt 3) {
        [void]$fileErrors.Add("not enough pitch classes: " + $scaleKey)
      }

      foreach ($pc in $pcs) {
        $pitchClass = [int]$pc

        if ($pitchClass -lt 0 -or $pitchClass -gt 11) {
          [void]$fileErrors.Add(
            "invalid pitch class " + $pitchClass + " in " + $scaleKey
          )
        }
      }
    }

    if ($fileErrors.Count -gt 0) {
      foreach ($message in $fileErrors) {
        Add-ScanMessage `
          -Messages $Messages `
          -Severity "error" `
          -Category "container_validation" `
          -File $relative `
          -Message ([string]$message)
      }

      continue
    }

    $resolvedContainerDocuments = New-Object System.Collections.ArrayList

    foreach ($document in @($container.documents)) {
      $resolved = Resolve-Document `
        -Document $document `
        -BaseDirectory $file.DirectoryName `
        -ArchiveRoot $ArchiveRoot `
        -SourceFile $relative `
        -OwnerId ([string]$container.container_id) `
        -Messages $Messages

      if ($null -ne $resolved) {
        [void]$resolvedContainerDocuments.Add($resolved)
      }
    }

    $container.documents = @($resolvedContainerDocuments)

    foreach ($scale in @($container.scales)) {
      $resolvedScaleDocuments = New-Object System.Collections.ArrayList

      foreach ($document in @($scale.documents)) {
        $resolved = Resolve-Document `
          -Document $document `
          -BaseDirectory $file.DirectoryName `
          -ArchiveRoot $ArchiveRoot `
          -SourceFile $relative `
          -OwnerId ([string]$scale.scale_id) `
          -Messages $Messages

        if ($null -ne $resolved) {
          [void]$resolvedScaleDocuments.Add($resolved)
        }
      }

      $scale.documents = @($resolvedScaleDocuments)
    }

    # ARRAY_NORMALIZATION_V2
    Set-ArrayProperty -Object $container -Name "scales"
    Set-ArrayProperty -Object $container -Name "documents"
    Set-ArrayProperty -Object $container -Name "sources"

    if ($null -ne $container.tradition) {
      Set-ArrayProperty -Object $container.tradition -Name "source_ids"
    }

    foreach ($scale in @($container.scales)) {
      Set-ArrayProperty -Object $scale -Name "notes_12tet"
      Set-ArrayProperty -Object $scale -Name "pitch_classes_12tet"
      Set-ArrayProperty -Object $scale -Name "source_ids"
      Set-ArrayProperty -Object $scale -Name "documents"

      if ($null -ne $scale.historical_tuning) {
        Set-ArrayProperty `
          -Object $scale.historical_tuning `
          -Name "source_ids"

        Set-ArrayProperty `
          -Object $scale.historical_tuning `
          -Name "measured_natural_sequence"

        Set-ArrayProperty `
          -Object $scale.historical_tuning `
          -Name "measured_intervals_cents"

        Set-ArrayProperty `
          -Object $scale.historical_tuning `
          -Name "scale_degrees_from_keynote"
      }
    }

    $container |
      Add-Member `
        -NotePropertyName "_source_file" `
        -NotePropertyValue $relative `
        -Force

    $container |
      Add-Member `
        -NotePropertyName "_source_directory" `
        -NotePropertyValue $file.DirectoryName `
        -Force

    $container |
      Add-Member `
        -NotePropertyName "_directory_url" `
        -NotePropertyValue (To-FileUrl $file.DirectoryName) `
        -Force

    [void]$Containers.Add($container)
  }
  catch {
    Add-ScanMessage `
      -Messages $Messages `
      -Severity "error" `
      -Category "container_read" `
      -File $relative `
      -Message $_.Exception.Message
  }
}

$ScaleCount = 0
$DocumentCount = 0
$MissingDocumentCount = 0

foreach ($container in $Containers) {
  $ScaleCount += @($container.scales).Count

  foreach ($document in @($container.documents)) {
    $DocumentCount += 1

    if ($document._exists -ne $true -or $document._blocked -eq $true) {
      $MissingDocumentCount += 1
    }
  }

  foreach ($scale in @($container.scales)) {
    foreach ($document in @($scale.documents)) {
      $DocumentCount += 1

      if ($document._exists -ne $true -or $document._blocked -eq $true) {
        $MissingDocumentCount += 1
      }
    }
  }
}

$Catalog = [PSCustomObject]@{
  schema_version = 1
  generated_at = (Get-Date).ToString("o")
  archive_root = $ArchiveRoot
  data_file_name = $DataFileName
  theme = $Theme
  rules = $Rules
  containers = [object[]]@($Containers)
  errors = [object[]]@($Messages)
  stats = [PSCustomObject]@{
    files_found = @($Files).Count
    containers = @($Containers).Count
    scales = $ScaleCount
    documents = $DocumentCount
    missing_documents = $MissingDocumentCount
    errors = @($Messages).Count
  }
}

$GeneratedDirectory = Join-Path $SoftwareRoot "generated"
$LogDirectory = Join-Path $SoftwareRoot "logs"

New-Item -ItemType Directory -Path $GeneratedDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null

$Json = $Catalog | ConvertTo-Json -Depth 100
$CatalogJs = "window.ARCHIVE_CATALOG = " + $Json + ";"

Set-Content `
  -LiteralPath (Join-Path $GeneratedDirectory "catalog.js") `
  -Value $CatalogJs `
  -Encoding UTF8

Set-Content `
  -LiteralPath (Join-Path $GeneratedDirectory "scan-report.json") `
  -Value $Json `
  -Encoding UTF8

$LogLine = (
  (Get-Date).ToString("s") +
  " | containers=" + @($Containers).Count +
  " | scales=" + $ScaleCount +
  " | documents=" + $DocumentCount +
  " | missing_documents=" + $MissingDocumentCount +
  " | messages=" + @($Messages).Count
)

Add-Content `
  -LiteralPath (Join-Path $LogDirectory "scansioni.log") `
  -Value $LogLine `
  -Encoding UTF8

Write-Host ""
Write-Host "Catalog updated."
Write-Host ("Archive: " + $ArchiveRoot)
Write-Host ("Valid containers: " + @($Containers).Count)
Write-Host ("Scales: " + $ScaleCount)
Write-Host ("Documents: " + $DocumentCount)
Write-Host ("Missing documents: " + $MissingDocumentCount)
Write-Host ("Messages: " + @($Messages).Count)
Write-Host ""

exit 0
