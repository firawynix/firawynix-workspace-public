@echo off
setlocal
set "VSWHERE=C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" exit /b 1
for /f "usebackq delims=" %%I in (`"%VSWHERE%" -latest -products * -property installationPath`) do set "VSPATH=%%I"
if not defined VSPATH exit /b 1
call "%VSPATH%\VC\Auxiliary\Build\vcvars32.bat" >nul
if errorlevel 1 exit /b 1
if not exist "%~dp0build\x86" mkdir "%~dp0build\x86"
cl /nologo /std:c++17 /EHsc /O2 /W4 /LD /DUNICODE /D_UNICODE "%~dp0FirawExplorerCommand.cpp" /Fo"%~dp0build\x86\FirawExplorerCommand.obj" /Fe"%~dp0build\x86\FirawExplorerCommand.dll" /link /DEF:"%~dp0FirawExplorerCommand.def" shell32.lib ole32.lib advapi32.lib
exit /b %errorlevel%
