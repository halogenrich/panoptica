@echo off
setlocal
cd /d "%~dp0"
title Perovskite Lab - restore a backup

powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue){exit 1}"
if errorlevel 1 (
  echo The app is running. Close its window first, then run restore.bat again.
  pause & exit /b 1
)
cd apps\server
node db-tools.cjs restore %1
pause
