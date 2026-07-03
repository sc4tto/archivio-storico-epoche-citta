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

function Resolve-Document {
  param(
    [object]$Document,
    [string]$ProfileDirectory,
    [string]$ArchiveRoot
  )

  $pathValue = [string]$Document.path
  $resolvedPath = ""

  try {
    if ([System.IO.Path]::IsPathRooted($pathValue)) {
      $resolvedPath = [System.IO.Path]::GetFullPath($pathValue)
    }
    else {
      $resolvedPath = [System.IO.Path]::GetFullPath(
        (Join-Path $ProfileDirectory $pathValue)
      )
    }
  }
  catch {
    $resolvedPath = ""
  }

  $insideArchive = $false

  if (-not [string]::IsNullOrWhiteSpace($resolvedPath)) {
    $insideArchive = $resolvedPath.StartsWith(
      $ArchiveRoot.TrimEnd("\") + "\",
      [System.StringComparison]::OrdinalIgnoreCase
    )
  }

  $exists = (
    $insideArchive -and
    (Test-Path -LiteralPath $resolvedPath -PathType Leaf)
  )

  return [PSCustomObject]@{
    document_id = [string]$Document.document_id
    label = [string]$Document.label
    type = [string]$Document.type
    path = $pathValue
    relative_path = if ($insideArchive) {
      $resolvedPath.Substring($ArchiveRoot.Length).TrimStart("\")
    }
    else {
      ""
    }
    exists = $exists
    blocked = -not $insideArchive
    file_url = if ($exists) {
      To-FileUrl $resolvedPath
    }
    else {
      ""
    }
  }
}

if ([string]::IsNullOrWhiteSpace($ArchiveRoot)) {
  $ArchiveRoot = Join-Path $PSScriptRoot "..\..\.."
}
else {
  $ArchiveRoot = ([string]$ArchiveRoot).Trim().Trim('"')
}

$ArchiveRoot = [System.IO.Path]::GetFullPath($ArchiveRoot)
$SoftwareRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot "..")
)

$ContainerMap = @{}
$ContainerErrors = New-Object System.Collections.ArrayList

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
  } |
  Sort-Object FullName
)

foreach ($ContainerFile in $ContainerFiles) {
  try {
    $Container = Get-Content `
      -LiteralPath $ContainerFile.FullName `
      -Raw `
      -Encoding UTF8 |
    ConvertFrom-Json

    $TraditionId = [string]$Container.tradition.id

    if (
      [string]::IsNullOrWhiteSpace($TraditionId) -or
      -not (Is-Documented $Container.tradition.documentation_status)
    ) {
      continue
    }

    $ContainerSourceIds = @(
      @($Container.sources) |
      ForEach-Object {
        [string]$_.source_id
      } |
      Where-Object {
        -not [string]::IsNullOrWhiteSpace($_)
      }
    )

    foreach ($Scale in @($Container.scales)) {
      if (-not (Is-Documented $Scale.documentation_status)) {
        continue
      }

      $ScaleId = [string]$Scale.scale_id

      if ([string]::IsNullOrWhiteSpace($ScaleId)) {
        continue
      }

      $key = $TraditionId + "|" + $ScaleId

      $ContainerMap[$key] = [PSCustomObject]@{
        container_file = $ContainerFile.FullName
        container_id = [string]$Container.container_id
        tradition_id = $TraditionId
        scale_id = $ScaleId
        source_ids = $ContainerSourceIds
      }
    }
  }
  catch {
    [void]$ContainerErrors.Add([PSCustomObject]@{
      file = $ContainerFile.FullName.Substring(
        $ArchiveRoot.Length
      ).TrimStart("\")
      message = $_.Exception.Message
    })
  }
}

$Profiles = New-Object System.Collections.ArrayList
$Rejected = New-Object System.Collections.ArrayList
$Errors = New-Object System.Collections.ArrayList

$ProfileFiles = @(
  Get-ChildItem `
    -LiteralPath $ArchiveRoot `
    -Recurse `
    -File `
    -Filter "musica-centro.json" `
    -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -match "[\\/]dati[\\/]musica_documentata[\\/]musica-centro\.json$" -and
    $_.FullName -notmatch "[\\/]_software[\\/]" -and
    $_.FullName -notmatch "[\\/]_backup[\\/]"
  } |
  Sort-Object FullName
)

foreach ($ProfileFile in $ProfileFiles) {
  try {
    $Profile = Get-Content `
      -LiteralPath $ProfileFile.FullName `
      -Raw `
      -Encoding UTF8 |
    ConvertFrom-Json

    Set-ArrayProperty -Object $Profile -Name "musical_evidence"
    Set-ArrayProperty -Object $Profile -Name "tradition_links"
    Set-ArrayProperty -Object $Profile -Name "scale_links"
    Set-ArrayProperty -Object $Profile -Name "documents"
    Set-ArrayProperty -Object $Profile -Name "sources"

    foreach ($link in @($Profile.tradition_links)) {
      Set-ArrayProperty -Object $link -Name "source_ids"
    }

    foreach ($link in @($Profile.scale_links)) {
      Set-ArrayProperty -Object $link -Name "source_ids"
    }

    foreach ($evidence in @($Profile.musical_evidence)) {
      Set-ArrayProperty -Object $evidence -Name "source_ids"
    }

    $Reasons = New-Object System.Collections.ArrayList

    if ($Profile.record_type -ne "center_music_profile") {
      [void]$Reasons.Add("record_type non valido")
    }

    if (-not (Is-Documented $Profile.record_status)) {
      [void]$Reasons.Add("record_status non documentato")
    }

    $SourceIds = @(
      @($Profile.sources) |
      ForEach-Object {
        [string]$_.source_id
      } |
      Where-Object {
        -not [string]::IsNullOrWhiteSpace($_)
      }
    )

    if ($SourceIds.Count -eq 0) {
      [void]$Reasons.Add("nessuna fonte registrata")
    }

    $ValidTraditions = @(
      @($Profile.tradition_links) |
      Where-Object {
        Is-Documented $_.relation_status
      }
    )

    $ValidScales = @(
      @($Profile.scale_links) |
      Where-Object {
        Is-Documented $_.relation_status
      }
    )

    $ResolvedTraditionLinks = New-Object System.Collections.ArrayList
    $ResolvedScaleLinks = New-Object System.Collections.ArrayList
    $CompleteChainFound = $false

    foreach ($TraditionLink in $ValidTraditions) {
      $TraditionSourceIds = @($TraditionLink.source_ids)

      if ($TraditionSourceIds.Count -eq 0) {
        continue
      }

      $TraditionSourcesResolved = $true

      foreach ($SourceId in $TraditionSourceIds) {
        if (-not ($SourceIds -contains [string]$SourceId)) {
          $TraditionSourcesResolved = $false
          break
        }
      }

      if (-not $TraditionSourcesResolved) {
        continue
      }

      foreach ($ScaleLink in $ValidScales) {
        $ScaleSourceIds = @($ScaleLink.source_ids)

        if ($ScaleSourceIds.Count -eq 0) {
          continue
        }

        $ScaleSourcesResolved = $true

        foreach ($SourceId in $ScaleSourceIds) {
          if (-not ($SourceIds -contains [string]$SourceId)) {
            $ScaleSourcesResolved = $false
            break
          }
        }

        if (-not $ScaleSourcesResolved) {
          continue
        }

        $key = (
          [string]$TraditionLink.tradition_id +
          "|" +
          [string]$ScaleLink.scale_id
        )

        if ($ContainerMap.ContainsKey($key)) {
          $CompleteChainFound = $true

          if (-not (
            @($ResolvedTraditionLinks) |
            Where-Object {
              $_.tradition_id -eq $TraditionLink.tradition_id
            }
          )) {
            [void]$ResolvedTraditionLinks.Add($TraditionLink)
          }

          [void]$ResolvedScaleLinks.Add($ScaleLink)
        }
      }
    }

    if (-not $CompleteChainFound) {
      [void]$Reasons.Add(
        "nessuna catena documentata centro-tradizione-scala risolta"
      )
    }

    $PackageDirectory = $ProfileFile.DirectoryName
    $DataDirectory = [System.IO.Directory]::GetParent(
      $PackageDirectory
    )
    $CenterDirectory = $DataDirectory.Parent

    if (
      $null -eq $CenterDirectory.Parent -or
      $CenterDirectory.Parent.Name -ne "Centri abitati"
    ) {
      [void]$Reasons.Add(
        "il pacchetto non appartiene a un centro ufficiale"
      )
    }

    $ResolvedDocuments = New-Object System.Collections.ArrayList

    foreach ($Document in @($Profile.documents)) {
      [void]$ResolvedDocuments.Add(
        (Resolve-Document `
          -Document $Document `
          -ProfileDirectory $PackageDirectory `
          -ArchiveRoot $ArchiveRoot)
      )
    }

    if (
      @(
        @($ResolvedDocuments) |
        Where-Object {
          -not $_.exists
        }
      ).Count -gt 0
    ) {
      [void]$Reasons.Add("uno o piu documenti non esistono")
    }

    if ($Reasons.Count -gt 0) {
      [void]$Rejected.Add([PSCustomObject]@{
        file = $ProfileFile.FullName.Substring(
          $ArchiveRoot.Length
        ).TrimStart("\")
        profile_id = [string]$Profile.profile_id
        reasons = @($Reasons)
      })

      continue
    }

    $relativeCenter = $CenterDirectory.FullName.Substring(
      $ArchiveRoot.Length
    ).TrimStart("\")

    [void]$Profiles.Add([PSCustomObject]@{
      profile_id = [string]$Profile.profile_id
      record_status = "documentato"
      center_id = [string]$Profile.scope.center_id
      center_label = [string]$Profile.scope.center_label
      center_folder = $CenterDirectory.Name
      center_relative_path = $relativeCenter
      center_directory_url = To-FileUrl $CenterDirectory.FullName
      profile_file_url = To-FileUrl $ProfileFile.FullName
      period = $Profile.period
      area = $Profile.area
      documentation = $Profile.documentation
      musical_evidence = [object[]]@($Profile.musical_evidence)
      tradition_links = [object[]]@($ResolvedTraditionLinks)
      scale_links = [object[]]@($ResolvedScaleLinks)
      sources = [object[]]@($Profile.sources)
      review = $Profile.review
      documents = [object[]]@($ResolvedDocuments)
      counts = [PSCustomObject]@{
        evidence = @($Profile.musical_evidence).Count
        traditions = @($ResolvedTraditionLinks).Count
        scales = @($ResolvedScaleLinks).Count
        sources = @($Profile.sources).Count
        documents = @($ResolvedDocuments).Count
      }
    })
  }
  catch {
    [void]$Errors.Add([PSCustomObject]@{
      file = $ProfileFile.FullName.Substring(
        $ArchiveRoot.Length
      ).TrimStart("\")
      message = $_.Exception.Message
    })
  }
}

$Index = [PSCustomObject]@{
  schema_version = 3
  generated_at = (Get-Date).ToString("o")
  storage_model = "center_local_documented_package"
  archive_root = $ArchiveRoot
  profiles = [object[]]@($Profiles)
  rejected = [object[]]@($Rejected)
  errors = [object[]]@($Errors)
  container_errors = [object[]]@($ContainerErrors)
  stats = [PSCustomObject]@{
    profiles = @($Profiles).Count
    rejected = @($Rejected).Count
    errors = @($Errors).Count
    container_errors = @($ContainerErrors).Count
    statuses = [PSCustomObject]@{
      documentato = @($Profiles).Count
      sintesi = 0
      inferito = 0
      non_documentato = 0
      altro = 0
    }
  }
}

$GeneratedDirectory = Join-Path $SoftwareRoot "generated"
New-Item -ItemType Directory -Path $GeneratedDirectory -Force | Out-Null

$Json = $Index | ConvertTo-Json -Depth 100
$JavaScript = "window.CENTER_MUSIC_INDEX = " + $Json + ";"

Set-Content `
  -LiteralPath (Join-Path $GeneratedDirectory "center-music-index.js") `
  -Value $JavaScript `
  -Encoding UTF8

Set-Content `
  -LiteralPath (Join-Path $GeneratedDirectory "center-music-index.json") `
  -Value $Json `
  -Encoding UTF8

$ReportLines = New-Object System.Collections.ArrayList

[void]$ReportLines.Add("VALIDAZIONE DATI MUSICALI DOCUMENTATI")
[void]$ReportLines.Add("======================================")
[void]$ReportLines.Add("")
[void]$ReportLines.Add(
  "Profili ammessi: " +
  @($Profiles).Count
)
[void]$ReportLines.Add(
  "Profili respinti: " +
  @($Rejected).Count
)
[void]$ReportLines.Add(
  "Errori dei profili: " +
  @($Errors).Count
)
[void]$ReportLines.Add(
  "Errori dei contenitori: " +
  @($ContainerErrors).Count
)
[void]$ReportLines.Add("")

foreach ($Profile in $Profiles) {
  [void]$ReportLines.Add(
    "AMMESSO | " +
    $Profile.center_label +
    " | " +
    $Profile.profile_id
  )
}

foreach ($Item in $Rejected) {
  [void]$ReportLines.Add(
    "RESPINTO | " +
    $Item.file +
    " | " +
    ($Item.reasons -join "; ")
  )
}

foreach ($ErrorItem in $Errors) {
  [void]$ReportLines.Add(
    "ERRORE | " +
    $ErrorItem.file +
    " | " +
    $ErrorItem.message
  )
}

$ReportPath = Join-Path `
  $GeneratedDirectory `
  "RAPPORTO_VALIDAZIONE_DATI_DOCUMENTATI.txt"

[System.IO.File]::WriteAllLines(
  $ReportPath,
  [string[]]$ReportLines,
  (New-Object System.Text.UTF8Encoding($true))
)

Write-Host ""
Write-Host "Documented center music index updated."
Write-Host ("Admitted profiles: " + @($Profiles).Count)
Write-Host ("Rejected profiles: " + @($Rejected).Count)
Write-Host ("Errors: " + @($Errors).Count)
Write-Host ("Report: " + $ReportPath)
Write-Host ""

exit 0
