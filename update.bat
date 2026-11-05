@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Perovskite Lab - update

set ZIP=%~1
if "%ZIP%"=="" (
  for /f "usebackq delims=" %%f in (`powershell -NoProfile -Command "(Get-ChildItem ($env:USERPROFILE + '\Downloads\perovskite-lab*.zip') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName"`) do set ZIP=%%f
)
if "%ZIP%"=="" (
  echo No perovskite-lab*.zip found in Downloads.
  echo Usage: update.bat [path\to\perovskite-lab.zip]
  pause & exit /b 1
)

powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue){exit 1}"
if errorlevel 1 (
  echo The app is running. Close its window first, then run update.bat again.
  pause & exit /b 1
)

for /f %%v in ('node -p "require('./package.json').version"') do set OLD=%%v
echo Current version: %OLD%
echo Update file:     %ZIP%

if exist apps\server\data.db (
  if exist apps\server\db-tools.cjs (
    pushd apps\server & node db-tools.cjs backup update & popd
  ) else (
    if not exist backups mkdir backups
    for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do copy apps\server\data.db backups\data-%%t-update.db >nul
    echo Database backed up in the backups folder.
  )
)

set TMPD=%TEMP%\psc-update
if exist "%TMPD%" rmdir /s /q "%TMPD%"
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%TMPD%' -Force"
if errorlevel 1 ( echo Could not read the zip. & pause & exit /b 1 )
if not exist "%TMPD%\perovskite-lab" ( echo This zip is not a Perovskite Lab update. & pause & exit /b 1 )

robocopy "%TMPD%\perovskite-lab" "%CD%" /E /XD node_modules backups /XF data.db data.db-wal data.db-shm /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 ( echo Copy failed. & pause & exit /b 1 )
rem source folders are mirrored so files removed in a release are removed here too
for %%d in (apps\web\src apps\server\src packages\core\src packages\schema\src) do robocopy "%TMPD%\perovskite-lab\%%d" "%CD%\%%d" /MIR /NFL /NDL /NJH /NJS /NP >nul
rmdir /s /q "%TMPD%"

for /f %%v in ('node -p "require('./package.json').version"') do set NEW=%%v
echo Updated: %OLD% -^> %NEW%
echo Starting...
call start.bat
