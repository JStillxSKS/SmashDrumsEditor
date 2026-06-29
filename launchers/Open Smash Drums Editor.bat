@echo off
setlocal
cd /d "%~dp0.."
set "RELEASE=%CD%\release"
set "EXE=%RELEASE%\Smash-Drums-Editor-0.1.0-portable.exe"
set "UNPACKED=%RELEASE%\win-unpacked\Smash Drums Editor.exe"

if exist "%EXE%" (
  start "" "%EXE%"
  exit /b 0
)
if exist "%UNPACKED%" (
  start "" "%UNPACKED%"
  exit /b 0
)

echo Smash Drums Editor EXE not found.
echo Run "Build Smash Drums Editor.bat" in the launchers folder to create it.
pause
exit /b 1