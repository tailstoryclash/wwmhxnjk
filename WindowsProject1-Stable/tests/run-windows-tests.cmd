@echo off
setlocal
where cl >nul 2>nul
if errorlevel 1 (
 echo Open an x64 Native Tools Command Prompt for Visual Studio.
 exit /b 1
)
set "TESTDIR=%TEMP%\albion-core-tests-%RANDOM%-%RANDOM%"
if exist "%TESTDIR%" exit /b 1
mkdir "%TESTDIR%"
if errorlevel 1 exit /b 1
pushd "%TESTDIR%"
cl /nologo /std:c++20 /EHsc /W4 /utf-8 /I"%~dp0.." "%~dp0..\stable_core_tests.cpp" /Fe:stable-core-tests.exe /link user32.lib shell32.lib ole32.lib
if errorlevel 1 goto :failed
stable-core-tests.exe
if errorlevel 1 goto :failed
popd
rmdir /s /q "%TESTDIR%"
exit /b 0
:failed
popd
echo Test failed. Build output retained in "%TESTDIR%".
exit /b 1
