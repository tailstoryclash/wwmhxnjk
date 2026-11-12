param(
    [ValidateSet('trt', 'winml')]
    [string]$Backend = 'trt',
    [ValidateSet('Release', 'Debug')]
    [string]$Configuration = 'Release',
    [string]$Toolset = 'v145'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$errors = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Require-File([string]$Path, [string]$Reason) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        $script:errors.Add("Missing $Reason : $Path")
    }
}

function Require-AnyFile([string[]]$Paths, [string]$Reason) {
    foreach ($path in $Paths) {
        if (Test-Path -LiteralPath $path -PathType Leaf) { return }
    }
    $script:errors.Add("Missing $Reason (looked in: $($Paths -join ', '))")
}

Write-Host "Build preflight: $Configuration x64 / $Backend / $Toolset"

foreach ($command in @('msbuild.exe', 'cl.exe')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        $errors.Add("$command is not available. Open a Visual Studio x64 Developer Command Prompt with the C++ workload installed.")
    }
}

if (-not $env:VCTargetsPath -or -not (Test-Path -LiteralPath $env:VCTargetsPath -PathType Container)) {
    $errors.Add('Visual C++ MSBuild targets are not initialized. Run this from a Visual Studio x64 Developer Command Prompt or install the C++ build tools.')
} else {
    $toolsetProps = Join-Path $env:VCTargetsPath "Platforms\x64\PlatformToolsets\$Toolset\Toolset.props"
    Require-File $toolsetProps "Visual C++ $Toolset toolset"
}

$sdkRoot = $env:WindowsSdkDir
if (-not $sdkRoot) {
    try {
        $sdkRoot = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots' -Name KitsRoot10 -ErrorAction Stop).KitsRoot10
    } catch {
        $sdkRoot = $null
    }
}
$sdkVersion = $null
if ($sdkRoot -and (Test-Path -LiteralPath (Join-Path $sdkRoot 'Include'))) {
    $sdkVersion = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Include') -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^10\.' } |
        Sort-Object Name -Descending |
        Select-Object -First 1 -ExpandProperty Name
}
if (-not $sdkVersion) {
    $errors.Add('Windows 10/11 SDK was not found. Install a Windows SDK from Visual Studio Installer (Individual components).')
} else {
    Require-File (Join-Path $sdkRoot "Include\$sdkVersion\um\Windows.h") 'Windows SDK headers'
    Require-File (Join-Path $sdkRoot "Include\$sdkVersion\ucrt\stdio.h") 'Windows SDK UCRT headers'
    Require-File (Join-Path $sdkRoot "Lib\$sdkVersion\um\x64\kernel32.lib") 'Windows SDK x64 libraries'
    Require-File (Join-Path $sdkRoot "Lib\$sdkVersion\ucrt\x64\ucrt.lib") 'Windows SDK UCRT x64 library'
}

$keyAuth = Join-Path $root '..\vendor\keyauth'
Require-File (Join-Path $keyAuth 'library.vcxproj') 'original KeyAuth source project'
Require-File (Join-Path $keyAuth 'auth.hpp') 'KeyAuth auth.hpp include'
Require-File (Join-Path $keyAuth 'nlohmann\json.hpp') 'KeyAuth nlohmann/json.hpp include'
Require-File (Join-Path $keyAuth 'curl\curl.h') 'KeyAuth curl headers'
Require-File (Join-Path $keyAuth 'libsodium\sodium.h') 'KeyAuth libsodium headers'
Require-File (Join-Path $keyAuth 'curl\libcurl.lib') 'KeyAuth libcurl.lib'
Require-File (Join-Path $keyAuth 'libsodium\libsodium.lib') 'KeyAuth libsodium.lib'
Require-AnyFile @((Join-Path $keyAuth 'curl\zlib.lib'), (Join-Path $keyAuth 'zlib.lib')) 'KeyAuth zlib.lib'

$ort = Join-Path $root '..\vendor\ort-directml-1.24.4'
$directml = Join-Path $root '..\vendor\directml-1.15.4'
Require-File (Join-Path $ort 'build\native\include\onnxruntime_cxx_api.h') 'ONNX Runtime C++ header (1.24.4)'
Require-File (Join-Path $ort 'build\native\include\dml_provider_factory.h') 'ONNX Runtime DirectML provider header (1.24.4)'
Require-File (Join-Path $ort 'runtimes\win-x64\native\onnxruntime.lib') 'ONNX Runtime x64 import library (1.24.4)'
Require-File (Join-Path $ort 'runtimes\win-x64\native\onnxruntime.dll') 'ONNX Runtime x64 DLL (1.24.4)'
Require-File (Join-Path $ort 'runtimes\win-x64\native\onnxruntime_providers_shared.dll') 'ONNX Runtime shared provider DLL (1.24.4)'
Require-File (Join-Path $directml 'include\DirectML.h') 'DirectML header (1.15.4)'
Require-File (Join-Path $directml 'bin\x64-win\DirectML.dll') 'DirectML x64 DLL (1.15.4)'

if ($Backend -eq 'trt') {
    $tensorrt = 'C:\TensorRT-10.11.0.33'
    $cuda = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8'
    Require-File (Join-Path $tensorrt 'include\NvInfer.h') 'TensorRT SDK header (set TensorRTRoot in the project if installed elsewhere)'
    Require-File (Join-Path $tensorrt 'lib\nvinfer_10.lib') 'TensorRT x64 import library'
    Require-File (Join-Path $cuda 'include\cuda_runtime_api.h') 'CUDA SDK header (set AlbionCudaRoot in the project if installed elsewhere)'
    Require-File (Join-Path $cuda 'lib\x64\cudart.lib') 'CUDA x64 import library'
}

foreach ($tool in @('diagnostics.py', 'offline_model_check.py')) {
    $toolPath = Join-Path $root "..\tools\$tool"
    if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) {
        $warnings.Add("Optional tools\$tool is missing; the application build can continue, but that diagnostic feature will be unavailable.")
    }
}

foreach ($warning in $warnings) { Write-Warning $warning }
if ($errors.Count -gt 0) {
    Write-Host 'Preflight failed. No compilation was started.' -ForegroundColor Red
    foreach ($message in $errors) { Write-Host "  ERROR: $message" -ForegroundColor Red }
    if ($errors | Where-Object { $_ -match 'KeyAuth' }) {
        Write-Host 'Restore the original KeyAuth source and its curl/libsodium/zlib includes and libraries under vendor\keyauth. Authentication is intentionally not stubbed or bypassed.'
    }
    if ($errors | Where-Object { $_ -match 'ONNX Runtime|DirectML' }) {
        Write-Host 'Run .\setup-dependencies.ps1 to restore the pinned public ONNX Runtime and DirectML packages.'
    }
    exit 1
}

Write-Host 'Preflight passed; starting build.' -ForegroundColor Green
exit 0
