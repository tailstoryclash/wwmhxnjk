# Windows build and deployment

## Requirements

- Windows 10/11 x64, Visual Studio or Build Tools with the C++ workload, MSBuild, the configured MSVC platform toolset (`v145` by default), and a Windows 10/11 SDK.
- The supplied sibling `vendor` and `tools` folders, extracted beside this project. They include the original KeyAuth source and dependencies, ONNX Runtime DirectML 1.24.4, DirectML 1.15.4, and diagnostic scripts. Keep these folders alongside this project when packaging source for a build.
- The default `trt` backend additionally requires TensorRT 10.11 and CUDA 11.8 SDK headers and x64 libraries at the paths in `WindowsProject1.vcxproj`. Use the `winml` backend to avoid the TensorRT/CUDA SDK requirement.

The public inference packages can be restored if needed using `setup-dependencies.ps1`. It downloads the pinned x64 files from NuGet.org into the existing vendor layout; it does not download or replace KeyAuth. See [NuGet.org's documented package-base-address resource](https://learn.microsoft.com/en-us/nuget/api/package-base-address-resource).

Run builds from an x64 Visual Studio Developer Command Prompt. Both build scripts run `check-prerequisites.ps1` before compilation. It checks compiler/build tools, Windows SDK files, KeyAuth source/includes/libraries, ONNX Runtime/DirectML, and TensorRT/CUDA for the `trt` backend. Missing diagnostic scripts under `tools` are warnings only; the build continues without those optional diagnostics. Non-default SDK roots can be supplied using the matching MSBuild environment properties: `TensorRTRoot`, `AlbionCudaRoot`, `AlbionOrtRoot`, and `AlbionDirectMLRoot`.

## Build

```bat
build.bat false trt
```

The legacy build supports `trt` or `winml`, optional `wgc`, and `ALBION_CONFIGURATION=Release|Debug`. It copies the application to `albion-ui-centered.exe` and places `onnxruntime.dll`, `onnxruntime_providers_shared.dll`, and `DirectML.dll` beside it so the relocated executable can load its inference runtime. For TensorRT deployment, `ALBION_COPY_NVIDIA_DLLS=1` copies available NVIDIA DLLs from the build output without replacing existing files.

The modular build is build-only and writes to a variant-specific folder:

```bat
build_modular.cmd trt
build_modular.cmd winml wgc
```

ONNX Runtime/DirectML DLLs are staged beside the modular executable. Set `ALBION_COPY_RUNTIME_ASSETS=true` to also request TensorRT/CUDA runtime assets and optional tools. Neither script launches the application.

## KeyAuth

The project builds `vendor/keyauth/library.vcxproj` and links the resulting `library_x64.lib`; the supplied matching Auth, Curl, libsodium, nlohmann, and zlib sources/headers/libraries are under `vendor/keyauth`. The scripts rebuild the KeyAuth library rather than relying on the prebuilt Release library alone. Authentication is unchanged and is not stubbed or bypassed.

The original KeyAuth project declares toolset `v143`; the application build scripts explicitly pass the configured `ALBION_TOOLSET` (default `v145`) to both projects. Keep that default unless selecting a toolset installed in Visual Studio.
