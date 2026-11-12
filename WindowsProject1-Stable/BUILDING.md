# Windows build and deployment

## Requirements

- Windows 10/11 x64, Visual Studio or Build Tools with the C++ workload, MSBuild, the configured MSVC platform toolset (`v145` by default), and a Windows 10/11 SDK.
- The original KeyAuth source project and its dependency headers/libraries under `..\vendor\keyauth` (see below). This source is not included in the reviewed copy and is not restored by the dependency setup script.
- ONNX Runtime DirectML 1.24.4 and DirectML 1.15.4. These are the pinned [ONNX Runtime package](https://www.nuget.org/packages/Microsoft.ML.OnnxRuntime.DirectML/1.24.4) and [DirectML package](https://www.nuget.org/packages/Microsoft.AI.DirectML/1.15.4) from NuGet.org. Restore them with PowerShell:

  ```powershell
  .\setup-dependencies.ps1
  ```

  The script follows [NuGet.org's documented v3 package-base-address resource](https://learn.microsoft.com/en-us/nuget/api/package-base-address-resource) and restores only the x64 native headers and runtime files into the existing `vendor\ort-directml-1.24.4` and `vendor\directml-1.15.4` layout. It does not fetch or replace KeyAuth files.
- The default `trt` backend additionally requires TensorRT 10.11 and CUDA 11.8 SDK headers and x64 libraries at the paths in `WindowsProject1.vcxproj`. Use the `winml` backend to avoid the TensorRT/CUDA SDK requirement.

Run builds from an x64 Visual Studio Developer Command Prompt. Both build scripts run `check-prerequisites.ps1` before compilation. It checks compiler/build tools, Windows SDK files, KeyAuth source/includes/libraries, ONNX Runtime/DirectML, and TensorRT/CUDA for the `trt` backend. Missing diagnostic scripts under `..\tools` are warnings only; the build continues without those optional diagnostics. Non-default SDK roots can be supplied using the matching MSBuild environment properties: `TensorRTRoot`, `AlbionCudaRoot`, `AlbionOrtRoot`, and `AlbionDirectMLRoot`.

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

## Required KeyAuth files

The project builds `..\vendor\keyauth\library.vcxproj` and links the resulting `library_x64.lib`; it also expects these files/libraries in the corresponding `vendor\keyauth` directories:

- `auth.hpp`, `nlohmann\json.hpp`
- Curl headers reachable under `curl` (for example `curl\curl.h`, `curl\curl\curl.h`, or `curl\include\curl\curl.h`) and `curl\libcurl.lib`
- `libsodium\sodium.h` or `libsodium\include\sodium.h`, plus `libsodium\libsodium.lib`
- `curl\zlib.lib` or `zlib.lib`

Restore the original KeyAuth source and matching dependencies from the project owner. Do not replace authentication with stubs or bypasses. The prebuilt Release library alone is insufficient for the scripts, which rebuild the KeyAuth project.
