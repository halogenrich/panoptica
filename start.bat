@echo off
setlocal
cd /d "%~dp0"
title Perovskite Lab

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required: https://nodejs.org
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo Node.js 22.13 or newer is required ^(this computer has an older one^): https://nodejs.org
  pause
  exit /b 1
)

rem files removed in 0.3.0 (older update scripts did not delete them)
for %%f in (Substrate SolutionPrep Spin OrganicEvap MetalEvap Stack Stack3D) do if exist apps\web\src\views\%%f.tsx del apps\web\src\views\%%f.tsx

rem 1) Dependencies: only on the first run, or when a package.json changed (after an update)
node tools\stamp.cjs check install
if errorlevel 1 (
  echo Installing dependencies ^(first run or after an update^)...
  call npm.cmd install
  if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
  node tools\stamp.cjs save install
)

rem 2) Web app: only when it was never built or its source changed
node tools\stamp.cjs check build
if errorlevel 1 (
  echo Building the web app...
  call npm.cmd run build
  if errorlevel 1 ( echo Build failed. & pause & exit /b 1 )
  node tools\stamp.cjs save build
)

if "%PORT%"=="" set PORT=3000
set HOST=127.0.0.1
if /i "%~1"=="lan" set HOST=0.0.0.0
echo.
echo Perovskite Lab is starting at http://localhost:%PORT%
echo Close this window to stop it.
if /i "%~1"=="lan" (
  echo Other computers and phones on the same network can open:
  powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { '  http://' + $_.IPAddress + ':%PORT%' }"
  echo   http://%COMPUTERNAME%:%PORT%
  echo Allow Node.js in the Windows firewall prompt the first time.
)
echo.
if not "%OPEN_BROWSER%"=="0" start "" /min cmd /c "timeout /t 4 >nul & start http://localhost:%PORT%"
call npm.cmd start
rem stopped by Admin settings > Updates: the update window takes over
if exist updates\restarting (del updates\restarting & exit)
pause
