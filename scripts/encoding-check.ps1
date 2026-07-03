$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false, $true)
$extensions = @('*.js', '*.json', '*.wxml', '*.wxss', '*.md')
$files = Get-ChildItem -Path $PSScriptRoot\.. -Recurse -File -Include $extensions
$failed = @()

foreach ($file in $files) {
  try {
    $content = [System.IO.File]::ReadAllText($file.FullName, $utf8NoBom)
    [void]$content
  } catch {
    $failed += $file.FullName
  }
}

if ($failed.Count -gt 0) {
  Write-Output 'The following files are not valid UTF-8:'
  $failed | ForEach-Object { Write-Output $_ }
  exit 1
}

Write-Output 'All checked files are valid UTF-8.'
