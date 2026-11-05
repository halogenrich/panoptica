@echo off
cd /d "%~dp0apps\server"
if "%~2"=="" (
  echo Usage: reset-password.bat USERNAME NEWPASSWORD ^(min 10 characters^)
  pause
  exit /b 1
)
node reset-password.cjs %1 %2
pause
