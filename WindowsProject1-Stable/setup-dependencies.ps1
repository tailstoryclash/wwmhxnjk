$ErrorActionPreference = 'Stop'
$ortId = 'Microsoft.ML.OnnxRuntime.DirectML'
$ortVersion = '1.24.4'
$directmlId = 'Microsoft.AI.DirectML'
$directmlVersion = '1.15.4'
$repoRoot = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $repoRoot 'vendor'
$work = Join-Path ([System.IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString('N'))

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-Package([string]$BaseAddress, [string]$Id, [string]$Version, [string]$Destination) {
    $lowerId = $Id.ToLowerInvariant()
    $lowerVersion = $Version.ToLowerInvariant()
    $packageUrl = "$($BaseAddress.TrimEnd('/'))/$lowerId/$lowerVersion/$lowerId.$lowerVersion.nupkg"
    Write-Host "Downloading $Id $Version from the NuGet.org v3 package feed..."
    Invoke-WebRequest -Uri $packageUrl -OutFile $Destination -UseBasicParsing
}

function Copy-PackageEntries([string]$PackagePath, [string]$Destination, [string[]]$Prefixes) {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName.EndsWith('/')) { continue }
            $prefix = $null
            foreach ($candidate in $Prefixes) {
                if ($entry.FullName.StartsWith($candidate, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $prefix = $candidate
                    break
                }
            }
            if (-not $prefix) { continue }

            $relative = $entry.FullName.Substring($prefix.Length).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
            if (-not $relative) { continue }
            $target = Join-Path $Destination (Join-Path $prefix.TrimEnd('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar) $relative)
            $targetDirectory = Split-Path -Parent $target
            New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
            $sourceStream = $entry.Open()
            try {
                $targetStream = [System.IO.File]::Open($target, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
                try { $sourceStream.CopyTo($targetStream) }
                finally { $targetStream.Dispose() }
            } finally { $sourceStream.Dispose() }
        }
    } finally { $archive.Dispose() }
}

try {
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    $serviceIndex = Invoke-RestMethod -Uri 'https://api.nuget.org/v3/index.json'
    $packageBase = $serviceIndex.resources |
        Where-Object { $_.'@type' -like 'PackageBaseAddress/3.0.0*' } |
        Select-Object -First 1 -ExpandProperty '@id'
    if (-not $packageBase) { throw 'NuGet.org service index did not advertise the v3 PackageBaseAddress resource.' }

    $ortPackage = Join-Path $work 'onnxruntime-directml.nupkg'
    $directmlPackage = Join-Path $work 'directml.nupkg'
    Get-Package $packageBase $ortId $ortVersion $ortPackage
    Get-Package $packageBase $directmlId $directmlVersion $directmlPackage

    $ortStage = Join-Path $work 'ort'
    $directmlStage = Join-Path $work 'directml'
    Copy-PackageEntries $ortPackage $ortStage @('build/native/include/', 'runtimes/win-x64/native/')
    Copy-PackageEntries $directmlPackage $directmlStage @('include/', 'bin/x64-win/')

    $required = @(
        (Join-Path $ortStage 'build\native\include\onnxruntime_cxx_api.h'),
        (Join-Path $ortStage 'build\native\include\dml_provider_factory.h'),
        (Join-Path $ortStage 'runtimes\win-x64\native\onnxruntime.lib'),
        (Join-Path $ortStage 'runtimes\win-x64\native\onnxruntime.dll'),
        (Join-Path $ortStage 'runtimes\win-x64\native\onnxruntime_providers_shared.dll'),
        (Join-Path $directmlStage 'include\DirectML.h'),
        (Join-Path $directmlStage 'bin\x64-win\DirectML.dll')
    )
    foreach ($path in $required) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Package contents did not include the expected file: $path" }
    }

    $ortRoot = Join-Path $vendor 'ort-directml-1.24.4'
    $directmlRoot = Join-Path $vendor 'directml-1.15.4'
    New-Item -ItemType Directory -Path $vendor -Force | Out-Null
    New-Item -ItemType Directory -Path $ortRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $directmlRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $ortStage '*') -Destination $ortRoot -Recurse -Force
    Copy-Item -Path (Join-Path $directmlStage '*') -Destination $directmlRoot -Recurse -Force

    Write-Host "Restored ONNX Runtime DirectML $ortVersion and DirectML $directmlVersion under vendor\." -ForegroundColor Green
    Write-Warning 'This script restores public inference dependencies only. It does not download or replace the original KeyAuth source, includes, or libraries.'
} catch {
    Write-Error "Dependency restore failed: $($_.Exception.Message)"
    exit 1
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}
