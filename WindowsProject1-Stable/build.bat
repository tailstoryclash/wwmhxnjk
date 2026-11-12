@echo off
setlocal
rem FIX-V11-BUILD: explicit, repeatable x64 variants; no hidden WGC argument.
rem Usage: build.bat false [trt^|winml] [wgc]
if not "%~1"=="" if /I not "%~1"=="false" goto :usage
set "TRT=true"
set "BACKEND=trt"
if /I "%~2"=="winml" set "TRT=false"
if /I "%~2"=="winml" set "BACKEND=winml"
if not "%~2"=="" if /I not "%~2"=="winml" if /I not "%~2"=="trt" goto :usage
set "WGC=false"
if /I "%~3"=="wgc" set "WGC=true"
if not "%~3"=="" if /I not "%~3"=="wgc" goto :usage
if not "%~4"=="" goto :usage
if not defined ALBION_INTEROP set "ALBION_INTEROP=%TRT%"
if not defined ALBION_TOOLSET set "ALBION_TOOLSET=v145"
if not defined ALBION_CONFIGURATION set "ALBION_CONFIGURATION=Release"
if /I not "%ALBION_CONFIGURATION%"=="Release" if /I not "%ALBION_CONFIGURATION%"=="Debug" goto :usage
where msbuild >nul 2>nul
if errorlevel 1 (
 echo Open a Developer Command Prompt for Visual Studio Build Tools.
 exit /b 1
)
pushd "%~dp0"
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-prerequisites.ps1" -Backend "%BACKEND%" -Configuration "%ALBION_CONFIGURATION%" -Toolset "%ALBION_TOOLSET%"
if errorlevel 1 goto :failed
msbuild "..\vendor\keyauth\library.vcxproj" /m /t:Rebuild /p:Configuration=%ALBION_CONFIGURATION% /p:Platform=x64 /p:PlatformToolset=%ALBION_TOOLSET% "/p:OutDir=%CD%\keyauth-lib\%ALBION_CONFIGURATION%\\"
if errorlevel 1 goto :failed
msbuild WindowsProject1.vcxproj /m /t:Rebuild /p:Configuration=%ALBION_CONFIGURATION% /p:Platform=x64 /p:PlatformToolset=%ALBION_TOOLSET% /p:AlbionD3DInterop=%ALBION_INTEROP% /p:AlbionWgc=%WGC% /p:AlbionTensorRT=%TRT%
if errorlevel 1 goto :failed
copy /y "x64\%ALBION_CONFIGURATION%\WindowsProject1.exe" "albion-ui-centered.exe" >nul
if errorlevel 1 goto :failed
rem Keep the relocated executable's ONNX Runtime/DirectML dependencies beside it.
for %%F in (onnxruntime.dll onnxruntime_providers_shared.dll DirectML.dll) do (
 if exist "x64\%ALBION_CONFIGURATION%\%%F" (
  copy /y "x64\%ALBION_CONFIGURATION%\%%F" "%%F" >nul
  if errorlevel 1 goto :failed
 ) else (
  echo WARNING: %%F was not staged; the ORT/DirectML runtime may be unavailable.
 )
)
rem FIX-V11.1-TRT-SEARCH: like the original build, NVIDIA DLLs next to the EXE
rem are NOT replaced. Overwriting them with TensorRTRoot DLLs broke engines that
rem were built for the TensorRT in PATH. Opt-in copy (only missing files):
rem   set ALBION_COPY_NVIDIA_DLLS=1
if "%ALBION_COPY_NVIDIA_DLLS%"=="1" for %%F in ("x64\%ALBION_CONFIGURATION%\nvinfer*.dll" "x64\%ALBION_CONFIGURATION%\cudart64_110.dll") do if exist "%%~F" if not exist "%CD%\%%~nxF" (
 copy "%%~F" "%CD%\" >nul
 if errorlevel 1 goto :failed
)
if exist "..\tools\diagnostics.py" (
 if not exist tools mkdir tools
 copy /y "..\tools\diagnostics.py" "tools\diagnostics.py" >nul
 if errorlevel 1 goto :failed
) else echo WARNING: optional tools\diagnostics.py is missing; build continues without diagnostics.
if exist "..\tools\offline_model_check.py" (
 if not exist tools mkdir tools
 copy /y "..\tools\offline_model_check.py" "tools\offline_model_check.py" >nul
 if errorlevel 1 goto :failed
) else echo WARNING: optional tools\offline_model_check.py is missing; build continues without model checks.
echo CRT: application and KeyAuth use /MT to match bundled curl/zlib/libsodium.
popd
exit /b 0
:failed
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" set "RC=1"
echo Build or file copy failed. Read the FIRST compiler/linker error above.
popd
exit /b %RC%
:usage
echo Usage: build.bat false [trt^|winml] [wgc]
echo Optional environment: ALBION_TOOLSET, ALBION_CONFIGURATION=Release or Debug.
echo Run setup-dependencies.ps1 first to restore the pinned public ORT/DirectML packages.
exit /b 2
