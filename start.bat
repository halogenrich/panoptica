@echo off
setlocal
cd /d "%~dp0"
title PANOPTICA

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 26 or newer is required: https://nodejs.org
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>=26?0:1)"
if errorlevel 1 (
  echo Node.js 26 or newer is required ^(this computer has an older one^): https://nodejs.org
  pause
  exit /b 1
)

rem A built package (0.39 and later; built.json marks it) runs as it is: nothing is installed or built on this computer.
set BUILT=0
if exist built.json if exist apps\server\dist\server.mjs set BUILT=1
rem a built package clears what an install from source, before 0.39, left behind
if "%BUILT%"=="1" if not exist .git (
  for %%d in (node_modules packages apps\web\src apps\web\public apps\web\node_modules apps\server\src apps\server\node_modules) do if exist %%d rmdir /s /q %%d
  for %%f in (apps\web\index.html apps\web\vite.config.ts apps\web\tsconfig.json apps\web\package.json apps\server\package.json apps\server\tsconfig.json tools\smoke.mjs tools\update-e2e.mjs tools\notes.mjs tools\stamp.cjs tools\package.mjs tools\sign-package.mjs docs\architecture.md package-lock.json tsconfig.base.json eslint.config.js .prettierrc.json .prettierignore .editorconfig .git-blame-ignore-revs) do if exist %%f del /q %%f
)
if "%BUILT%"=="1" goto run

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

:run
if "%PORT%"=="" set PORT=3000
set HOST=127.0.0.1
if /i "%~1"=="lan" set HOST=0.0.0.0
echo.
echo PANOPTICA is starting at http://localhost:%PORT%
echo Close this window to stop it.
if /i "%~1"=="lan" (
  echo Other computers and phones on the same network can open:
  powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { '  http://' + $_.IPAddress + ':%PORT%' }"
  echo   http://%COMPUTERNAME%:%PORT%
  echo Allow Node.js in the Windows firewall prompt the first time.
)
echo.
if not "%OPEN_BROWSER%"=="0" start "" /min cmd /c "timeout /t 4 >nul & start http://localhost:%PORT%"
if "%BUILT%"=="1" (
  pushd apps\server
  node --no-warnings dist\server.mjs
  popd
) else (
  call npm.cmd start
)
rem stopped by Admin settings > Updates: the update window takes over
if exist updates\restarting (del updates\restarting & exit)
pause
