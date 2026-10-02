@echo off
setlocal
set "VSWHERE=C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" exit /b 1
for /f "usebackq delims=" %%I in (`"%VSWHERE%" -latest -products * -property installationPath`) do set "VSPATH=%%I"
if not defined VSPATH exit /b 1
call "%VSPATH%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1
if not exist "%~dp0build" mkdir "%~dp0build"
cl /nologo /std:c++17 /EHsc /O2 /W4 /LD /DUNICODE /D_UNICODE "%~dp0FirawExplorerCommand.cpp" /Fo"%~dp0build\FirawExplorerCommand.obj" /Fe"%~dp0build\FirawExplorerCommand.dll" /link /DEF:"%~dp0FirawExplorerCommand.def" shell32.lib ole32.lib advapi32.lib
if errorlevel 1 exit /b 1
cl /nologo /std:c++17 /EHsc /O2 /W4 /DUNICODE /D_UNICODE "%~dp0test-command.cpp" /Fo"%~dp0build\test-command.obj" /Fe"%~dp0build\test-command.exe" ole32.lib
exit /b %errorlevel%
