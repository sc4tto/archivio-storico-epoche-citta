param(
  [string]$ArchiveRoot = ""
)

$ErrorActionPreference = "Stop"

function Normalize-DisplayLabel {
  param([string]$Value)

  $text = [System.Net.WebUtility]::HtmlDecode([string]$Value)
  $text = $text -replace "<[^>]+>", ""
  $text = $text -replace "^\d{2}_", ""
  $text = $text -replace "_", " "
  $text = $text -replace "\s+", " "
  return $text.Trim()
}

function Clean-PeriodLabel {
  param([string]$Value)

  $text = Normalize-DisplayLabel $Value
  $text = $text -replace "^P\d+\s*[·\-–—]\s*", ""
  return $text.Trim()
}

function Get-CatalogItemDefinitions {
  param(
    [string]$CategoryDirectory,
    [bool]$FallbackToAllDirectories = $false
  )

  $items = New-Object System.Collections.ArrayList
  $seen = @{}
  $indexPath = Join-Path $CategoryDirectory "index.html"

  if (Test-Path -LiteralPath $indexPath -PathType Leaf) {
    try {
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

        if ($seen.ContainsKey($folderName)) {
          continue
        }

        $directoryPath = Join-Path $CategoryDirectory $folderName

        if (-not (Test-Path -LiteralPath $directoryPath -PathType Container)) {
          continue
        }

        $label = Normalize-DisplayLabel (
          [string]$match.Groups[2].Value
        )

        if ([string]::IsNullOrWhiteSpace($label)) {
          $label = Normalize-DisplayLabel $folderName
        }

        $seen[$folderName] = $true

        [void]$items.Add([PSCustomObject]@{
          folder_name = $folderName
          label = $label
          full_path = [System.IO.Path]::GetFullPath($directoryPath)
          source = "catalog_index"
        })
      }
    }
    catch {
      Write-Warning (
        "Could not parse catalog index: " +
        $indexPath +
        " | " +
        $_.Exception.Message
      )
    }
  }

  if ($items.Count -eq 0) {
    $directories = @(
      Get-ChildItem `
        -LiteralPath $CategoryDirectory `
        -Directory `
        -ErrorAction SilentlyContinue |
      Sort-Object Name
    )

    foreach ($directory in $directories) {
      $hasIndex = Test-Path `
        -LiteralPath (Join-Path $directory.FullName "index.html") `
        -PathType Leaf

      if (-not $FallbackToAllDirectories -and -not $hasIndex) {
        continue
      }

      [void]$items.Add([PSCustomObject]@{
        folder_name = $directory.Name
        label = Normalize-DisplayLabel $directory.Name
        full_path = $directory.FullName
        source = if ($hasIndex) {
          "folder_index"
        } else {
          "folder_fallback"
        }
      })
    }
  }

  return @($items)
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

$DocumentExtensions = @(
  ".html",
  ".htm",
  ".txt",
  ".md",
  ".json",
  ".pdf"
)

function Get-Documents {
  param(
    [string]$Directory,
    [string]$ArchiveRoot
  )

  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    return @()
  }

  $documents = New-Object System.Collections.ArrayList

  $found = @(
    Get-ChildItem `
      -LiteralPath $Directory `
      -File `
      -ErrorAction SilentlyContinue |
    Where-Object {
      $DocumentExtensions -contains $_.Extension.ToLowerInvariant()
    } |
    Sort-Object Name
  )

  foreach ($file in $found) {
    $relative = $file.FullName.Substring(
      $ArchiveRoot.Length
    ).TrimStart("\")

    [void]$documents.Add([PSCustomObject]@{
      name = $file.Name
      label = Normalize-DisplayLabel $file.BaseName
      extension = $file.Extension.ToLowerInvariant()
      relative_path = $relative
      full_path = $file.FullName
      file_url = To-FileUrl $file.FullName
      size_bytes = $file.Length
      modified_at = $file.LastWriteTime.ToString("o")
    })
  }

  return @($documents)
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

$ExcludedRootDirectories = @(
  ".git",
  "_software",
  "_dati_musicali_test",
  "node_modules"
)

$periods = New-Object System.Collections.ArrayList
$errors = New-Object System.Collections.ArrayList
$ignoredClassificationDirectories = 0

$periodDirectories = @(
  Get-ChildItem `
    -LiteralPath $ArchiveRoot `
    -Directory `
    -ErrorAction SilentlyContinue |
  Where-Object {
    ($ExcludedRootDirectories -notcontains $_.Name) -and
    ($_.Name -match "^\d{2}_P\d+")
  } |
  Sort-Object Name
)

foreach ($periodDir in $periodDirectories) {
  try {
    $periodId = $periodDir.Name

    if ($periodDir.Name -match "^\d{2}_(P\d+)") {
      $periodId = $Matches[1]
    }

    $areas = New-Object System.Collections.ArrayList

    $areaDirectories = @(
      Get-ChildItem `
        -LiteralPath $periodDir.FullName `
        -Directory `
        -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -match "^\d{2}_"
      } |
      Sort-Object Name
    )

    foreach ($areaDir in $areaDirectories) {
      $areaId = $areaDir.Name

      if ($areaDir.Name -match "^(\d{2})_") {
        $areaId = "AREA_" + $Matches[1]
      }

      $categories = New-Object System.Collections.ArrayList

      $categoryDirectories = @(
        Get-ChildItem `
          -LiteralPath $areaDir.FullName `
          -Directory `
          -ErrorAction SilentlyContinue |
        Where-Object {
          $_.Name -in @("Centri abitati", "Tradizioni musicali")
        } |
        Sort-Object Name
      )

      foreach ($categoryDir in $categoryDirectories) {
        $items = New-Object System.Collections.ArrayList
        $fallbackAll = $categoryDir.Name -eq "Tradizioni musicali"

        $definitions = @(
          Get-CatalogItemDefinitions `
            -CategoryDirectory $categoryDir.FullName `
            -FallbackToAllDirectories $fallbackAll
        )

        if ($categoryDir.Name -eq "Centri abitati") {
          $allDirectories = @(
            Get-ChildItem `
              -LiteralPath $categoryDir.FullName `
              -Directory `
              -ErrorAction SilentlyContinue
          )

          $ignoredClassificationDirectories += (
            $allDirectories.Count - $definitions.Count
          )
        }

        foreach ($definition in $definitions) {
          $itemDir = Get-Item `
            -LiteralPath $definition.full_path `
            -ErrorAction Stop

          $itemDocuments = New-Object System.Collections.ArrayList

          foreach ($doc in @(
            Get-Documents `
              -Directory $itemDir.FullName `
              -ArchiveRoot $ArchiveRoot
          )) {
            [void]$itemDocuments.Add($doc)
          }

          foreach ($subDir in @(
            Get-ChildItem `
              -LiteralPath $itemDir.FullName `
              -Directory `
              -ErrorAction SilentlyContinue |
            Where-Object {
              $_.Name -in @("dati", "documenti", "testi")
            }
          )) {
            foreach ($doc in @(
              Get-Documents `
                -Directory $subDir.FullName `
                -ArchiveRoot $ArchiveRoot
            )) {
              [void]$itemDocuments.Add($doc)
            }
          }

          $relativeItem = $itemDir.FullName.Substring(
            $ArchiveRoot.Length
          ).TrimStart("\")

          $indexPath = Join-Path $itemDir.FullName "index.html"

          [void]$items.Add([PSCustomObject]@{
            id = (
              $periodId +
              "__" +
              $areaId +
              "__" +
              $categoryDir.Name +
              "__" +
              $itemDir.Name
            )
            label = [string]$definition.label
            directory_name = $itemDir.Name
            relative_path = $relativeItem
            full_path = $itemDir.FullName
            index_url = if (
              Test-Path -LiteralPath $indexPath -PathType Leaf
            ) {
              To-FileUrl $indexPath
            } else {
              ""
            }
            documents = @($itemDocuments)
          })
        }

        $categoryDocuments = @(
          Get-Documents `
            -Directory $categoryDir.FullName `
            -ArchiveRoot $ArchiveRoot
        )

        $categoryId = if ($categoryDir.Name -eq "Centri abitati") {
          "centri_abitati"
        } else {
          "tradizioni_musicali"
        }

        [void]$categories.Add([PSCustomObject]@{
          id = $categoryId
          label = $categoryDir.Name
          relative_path = $categoryDir.FullName.Substring(
            $ArchiveRoot.Length
          ).TrimStart("\")
          index_url = if (
            Test-Path `
              -LiteralPath (Join-Path $categoryDir.FullName "index.html") `
              -PathType Leaf
          ) {
            To-FileUrl (Join-Path $categoryDir.FullName "index.html")
          } else {
            ""
          }
          documents = $categoryDocuments
          items = @($items)
        })
      }

      [void]$areas.Add([PSCustomObject]@{
        id = $areaId
        label = Normalize-DisplayLabel $areaDir.Name
        directory_name = $areaDir.Name
        relative_path = $areaDir.FullName.Substring(
          $ArchiveRoot.Length
        ).TrimStart("\")
        index_url = if (
          Test-Path `
            -LiteralPath (Join-Path $areaDir.FullName "index.html") `
            -PathType Leaf
        ) {
          To-FileUrl (Join-Path $areaDir.FullName "index.html")
        } else {
          ""
        }
        documents = @(
          Get-Documents `
            -Directory $areaDir.FullName `
            -ArchiveRoot $ArchiveRoot
        )
        categories = @($categories)
      })
    }

    [void]$periods.Add([PSCustomObject]@{
      id = $periodId
      label = Normalize-DisplayLabel $periodDir.Name
      directory_name = $periodDir.Name
      relative_path = $periodDir.FullName.Substring(
        $ArchiveRoot.Length
      ).TrimStart("\")
      index_url = if (
        Test-Path `
          -LiteralPath (Join-Path $periodDir.FullName "index.html") `
          -PathType Leaf
      ) {
        To-FileUrl (Join-Path $periodDir.FullName "index.html")
      } else {
        ""
      }
      documents = @(
        Get-Documents `
          -Directory $periodDir.FullName `
          -ArchiveRoot $ArchiveRoot
      )
      areas = @($areas)
    })
  }
  catch {
    [void]$errors.Add([PSCustomObject]@{
      path = $periodDir.FullName
      message = $_.Exception.Message
    })
  }
}

$areaCount = 0
$categoryCount = 0
$itemCount = 0
$documentCount = 0

foreach ($period in $periods) {
  $documentCount += @($period.documents).Count
  $areaCount += @($period.areas).Count

  foreach ($area in @($period.areas)) {
    $documentCount += @($area.documents).Count
    $categoryCount += @($area.categories).Count

    foreach ($category in @($area.categories)) {
      $documentCount += @($category.documents).Count
      $itemCount += @($category.items).Count

      foreach ($item in @($category.items)) {
        $documentCount += @($item.documents).Count
      }
    }
  }
}

$Index = [PSCustomObject]@{
  schema_version = 2
  generated_at = (Get-Date).ToString("o")
  archive_root = $ArchiveRoot
  periods = @($periods)
  errors = @($errors)
  stats = [PSCustomObject]@{
    periods = @($periods).Count
    areas = $areaCount
    categories = $categoryCount
    items = $itemCount
    documents = $documentCount
    ignored_classification_directories = $ignoredClassificationDirectories
    errors = @($errors).Count
  }
}

$GeneratedDirectory = Join-Path $SoftwareRoot "generated"
$LogDirectory = Join-Path $SoftwareRoot "logs"

New-Item -ItemType Directory -Path $GeneratedDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null

$Json = $Index | ConvertTo-Json -Depth 100
$JavaScript = "window.LOCAL_ARCHIVE_INDEX = " + $Json + ";"

Set-Content `
  -LiteralPath (Join-Path $GeneratedDirectory "archive-index.js") `
  -Value $JavaScript `
  -Encoding UTF8

Set-Content `
  -LiteralPath (Join-Path $GeneratedDirectory "archive-index.json") `
  -Value $Json `
  -Encoding UTF8

Write-Host ""
Write-Host "Local archive index updated."
Write-Host ("Periods: " + @($periods).Count)
Write-Host ("Areas: " + $areaCount)
Write-Host ("Valid items: " + $itemCount)
Write-Host (
  "Ignored classification directories: " +
  $ignoredClassificationDirectories
)
Write-Host ("Documents: " + $documentCount)
Write-Host ("Errors: " + @($errors).Count)
Write-Host ""

exit 0
