@echo off
rem installed by PANOPTICA Setup: its own Node sits next to the app folder (run this as an administrator)
if exist "%~dp0..\node\node.exe" set "PATH=%~dp0..\node;%PATH%"
cd /d "%~dp0apps\server"
if "%~2"=="" (
  echo Usage: reset-password.bat USERNAME NEWPASSWORD ^(min 10 characters^)
  pause
  exit /b 1
)
node reset-password.cjs %1 %2
pause
