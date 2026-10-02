param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$targetRoot = [System.IO.Path]::GetFullPath($Target)
[System.IO.Directory]::CreateDirectory($targetRoot) | Out-Null
$prefix = $targetRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
$zip = [System.IO.Compression.ZipFile]::OpenRead([System.IO.Path]::GetFullPath($Archive))
try {
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $dest = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($targetRoot, $name))
    if (!$dest.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes target directory' }
    if ($entry.FullName.EndsWith('/')) { [System.IO.Directory]::CreateDirectory($dest) | Out-Null; continue }
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($dest)) | Out-Null
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
  }
} finally { $zip.Dispose() }
