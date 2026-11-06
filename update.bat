@echo off
setlocal enabledelayedexpansion
set "ROOTDIR=%PSC_ROOT%"
if not defined ROOTDIR set "ROOTDIR=%~dp0"
cd /d "%ROOTDIR%"
title Perovskite Lab - update

rem update.bat [zip] [restart] [lan]   restart: started by the app (Admin settings > Updates); waits for it to stop, then starts it again
set ZIP=%~1
set MODE=%~2
set NET=%~3
rem every step also goes to updates\update.log (shown in Admin settings > Updates)
if not exist updates mkdir updates
>>updates\update.log echo.
call :log Update started (mode: %MODE%)
if "%ZIP%"=="" (
  for /f "usebackq delims=" %%f in (`powershell -NoProfile -Command "(Get-ChildItem @('updates\perovskite-lab*.zip', ($env:USERPROFILE + '\Downloads\perovskite-lab*.zip')) -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName"`) do set ZIP=%%f
)
if /i "%MODE%"=="restart" (
  call :log Waiting for the app to stop...
  powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){ if(-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)){exit 0}; Start-Sleep 1 }; exit 1"
  if errorlevel 1 call :log The app did not stop within 90 s.
)
if "%ZIP%"=="" (
  call :log No perovskite-lab*.zip found in the updates folder or in Downloads.
  echo Usage: update.bat [path\to\perovskite-lab.zip]
  pause & exit /b 1
)

powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue){exit 1}"
if errorlevel 1 (
  call :log The app is running. Close its window first, then run update.bat again.
  pause & exit /b 1
)

for /f %%v in ('node -p "require('./package.json').version"') do set OLD=%%v
call :log Current version: %OLD%
call :log Update file: %ZIP%

if exist apps\server\data.db (
  if exist apps\server\db-tools.cjs (
    pushd apps\server & node db-tools.cjs backup update & popd
    call :log Database backed up.
  ) else (
    if not exist backups mkdir backups
    for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do copy apps\server\data.db backups\data-%%t-update.db >nul
    echo Database backed up in the backups folder.
  )
)

set TMPD=%TEMP%\psc-update
if exist "%TMPD%" rmdir /s /q "%TMPD%"
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%TMPD%' -Force"
if errorlevel 1 ( call :log Could not read the zip. & pause & exit /b 1 )
if not exist "%TMPD%\perovskite-lab" ( call :log This zip is not a Perovskite Lab update. & pause & exit /b 1 )

robocopy "%TMPD%\perovskite-lab" "%CD%" /E /XD node_modules backups config updates /XF data.db data.db-wal data.db-shm /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 ( call :log Copy failed. & pause & exit /b 1 )
rem source folders are mirrored so files removed in a release are removed here too
for %%d in (apps\web\src apps\server\src packages\core\src packages\schema\src) do robocopy "%TMPD%\perovskite-lab\%%d" "%CD%\%%d" /MIR /NFL /NDL /NJH /NJS /NP >nul
rmdir /s /q "%TMPD%"

for /f %%v in ('node -p "require('./package.json').version"') do set NEW=%%v
call :log Updated: %OLD% to %NEW%
if exist updates\restarting del updates\restarting
call :log Starting the app...
call start.bat %NET%
goto :eof

:log
echo %*
>>updates\update.log echo [%date% %time:~0,8%] %*
goto :eof
