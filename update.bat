@echo off
setlocal enabledelayedexpansion
set "ROOTDIR=%PSC_ROOT%"
if not defined ROOTDIR set "ROOTDIR=%~dp0"
cd /d "%ROOTDIR%"
title PANOPTICA - update

rem update.bat [zip] [restart] [lan]   restart: started by the app (Admin settings > Updates); waits for it to stop, then starts it again
rem the port PANOPTICA listens on (0.51: given by the app; 3000 when run by hand)
if not defined PORT set PORT=3000
set ZIP=%~1
set MODE=%~2
set NET=%~3
rem installed by PANOPTICA Setup (0.47): the app runs as the PANOPTICA task, with no window and nobody to press a key
set "HOLD=pause"
if defined PANOPTICA_TASK set "HOLD=type nul"

rem every step also goes to updates\update.log (shown in Admin settings > Updates)
if not exist updates mkdir updates
>>updates\update.log echo.
call :log Update started (mode: %MODE%)
if "%ZIP%"=="" (
  for /f "usebackq delims=" %%f in (`powershell -NoProfile -Command "(Get-ChildItem @('updates\panoptica*.zip', 'updates\perovskite-lab*.zip', ($env:USERPROFILE + '\Downloads\panoptica*.zip'), ($env:USERPROFILE + '\Downloads\perovskite-lab*.zip')) -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName"`) do set ZIP=%%f
)
if /i "%MODE%"=="restart" (
  call :log Waiting for the app to stop...
  powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){ if(-not (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue)){exit 0}; Start-Sleep 1 }; exit 1"
  if errorlevel 1 call :log The app did not stop within 90 s.
)
if "%ZIP%"=="" (
  call :log No panoptica*.zip found in the updates folder or in Downloads.
  echo Usage: update.bat [path\to\panoptica.zip]
  %HOLD% & exit /b 1
)

powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue){exit 1}"
if errorlevel 1 (
  call :log The app is running. Close its window first, then run update.bat again.
  %HOLD% & exit /b 1
)

for /f %%v in ('node -p "require('./package.json').version"') do set OLD=%%v
call :log Current version: %OLD%
call :log Update file: %ZIP%
rem only packages signed by PANOPTICA are installed: the signature file sits next to the zip
node tools\verify-package.cjs "%ZIP%"
if errorlevel 1 goto unsigned
call :log Signature checked.

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
if errorlevel 1 ( call :log Could not read the zip. & %HOLD% & exit /b 1 )
rem releases before 0.36 were called Perovskite Lab: their zips hold a perovskite-lab folder
set SRC=
if exist "%TMPD%\panoptica" set "SRC=%TMPD%\panoptica"
if not defined SRC if exist "%TMPD%\perovskite-lab" set "SRC=%TMPD%\perovskite-lab"
if not defined SRC ( call :log This zip is not a PANOPTICA update. & %HOLD% & exit /b 1 )

robocopy "%SRC%" "%CD%" /E /XD node_modules backups config updates /XF data.db data.db-wal data.db-shm /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 ( call :log Copy failed. & %HOLD% & exit /b 1 )
rem the built folders are mirrored so files removed in a release are removed here too
for %%d in (apps\web\dist apps\server\dist) do if exist "%SRC%\%%d" robocopy "%SRC%\%%d" "%CD%\%%d" /MIR /NFL /NDL /NJH /NJS /NP >nul
rmdir /s /q "%TMPD%"
rem installed by PANOPTICA Setup (0.49): no script is left to run by hand; the app keeps this one in internal\ for itself
if exist config\install.json (
  if not exist internal mkdir internal
  copy /y update.bat internal\update.bat >nul
  for %%f in (start start-network update version restore) do for %%e in (bat command sh) do if exist %%f.%%e del /q %%f.%%e
  if exist install-shortcut.sh del /q install-shortcut.sh
)

for /f %%v in ('node -p "require('./package.json').version"') do set NEW=%%v
call :log Updated: %OLD% to %NEW%
if exist updates\restarting del updates\restarting
rem 0.52: the update also brings another Node, made ready by the app in updates\runtime; swapped while nothing runs on it
set SWAPPED=
if defined PANOPTICA_TASK if defined RUNTIME if exist "%RUNTIME%\version" call :swap
call :log Starting the app...
call :again
if defined SWAPPED call :settle
goto :eof

rem ---- the runtime (0.52): Setup's Node is in ..\node, next to the app's folder; the old one waits in ..\node.old until
rem PANOPTICA answers on the new one, and goes back in place when it does not
:swap
for %%i in ("%CD%\..\node") do set "NODEDIR=%%~fi"
if not exist "%NODEDIR%\node.exe" (
  call :log No Node folder next to the app: Node not changed.
  goto :eof
)
rem the version file has one line (LF only: read with for /f, which ends lines at LF too)
for /f "usebackq delims=" %%v in ("%RUNTIME%\version") do set TONODE=%%v
for /f %%v in ('node -p "process.versions.node"') do set FROMNODE=%%v
rem the file the app downloaded is checked again before anything changes
node tools\verify-package.cjs "%RUNTIME%\..\runtime.zip" >nul 2>&1
if errorlevel 1 (
  call :log The Node %TONODE% file was refused: Node %FROMNODE% kept.
  call :runtimefailed refused
  goto :eof
)
call :log Changing Node %FROMNODE% to %TONODE%...
powershell -NoProfile -Command "$d='%NODEDIR%\'; for($i=0;$i -lt 30;$i++){ if(-not (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) })){exit 0}; Start-Sleep 1 }; exit 1"
if errorlevel 1 (
  call :log Node %FROMNODE% is still running: Node not changed.
  call :runtimefailed locked
  goto :eof
)
if exist "%NODEDIR%.old" rmdir /s /q "%NODEDIR%.old"
powershell -NoProfile -Command "for($i=0;$i -lt 10;$i++){ try { Rename-Item -LiteralPath '%NODEDIR%' -NewName 'node.old' -ErrorAction Stop; exit 0 } catch { Start-Sleep 1 } }; exit 1"
if errorlevel 1 (
  call :log The Node folder is in use: Node not changed.
  call :runtimefailed locked
  goto :eof
)
powershell -NoProfile -Command "try { Move-Item -LiteralPath '%RUNTIME%' -Destination '%NODEDIR%' -ErrorAction Stop; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  if exist "%NODEDIR%" rmdir /s /q "%NODEDIR%"
  powershell -NoProfile -Command "Rename-Item -LiteralPath '%NODEDIR%.old' -NewName 'node'"
  call :log Node %TONODE% could not be put in place: Node %FROMNODE% kept.
  call :runtimefailed locked
  goto :eof
)
del /q "%NODEDIR%\version" 2>nul
del /q "%RUNTIME%\..\runtime.zip" "%RUNTIME%\..\runtime.zip.sig" 2>nul
set SWAPPED=1
goto :eof

:settle
if not defined RUNTIME_WAIT set RUNTIME_WAIT=120
call :log Waiting for PANOPTICA on Node %TONODE%, up to %RUNTIME_WAIT% s...
powershell -NoProfile -Command "for($i=0;$i -lt %RUNTIME_WAIT%;$i++){ if(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue){exit 0}; Start-Sleep 1 }; exit 1"
if not errorlevel 1 (
  rmdir /s /q "%NODEDIR%.old" 2>nul
  call :log PANOPTICA runs on Node %TONODE%.
  goto :eof
)
call :log PANOPTICA did not start on Node %TONODE%: putting Node %FROMNODE% back.
schtasks /end /tn "%PANOPTICA_TASK%" >nul 2>&1
powershell -NoProfile -Command "$d='%NODEDIR%\'; for($i=0;$i -lt 30;$i++){ $p = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) }); if(-not $p){exit 0}; $p | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep 1 }; exit 1"
powershell -NoProfile -Command "for($i=0;$i -lt 15;$i++){ try { if(Test-Path -LiteralPath '%NODEDIR%'){ Remove-Item -LiteralPath '%NODEDIR%' -Recurse -Force -ErrorAction Stop }; Rename-Item -LiteralPath '%NODEDIR%.old' -NewName 'node' -ErrorAction Stop; exit 0 } catch { Start-Sleep 1 } }; exit 1"
if errorlevel 1 call :log Could not put Node %FROMNODE% back: run PANOPTICA Setup again.
call :runtimefailed start
call :log Starting the app on Node %FROMNODE%...
call :again
goto :eof

rem told to the admins by the app when it starts (updates\runtime-failed.txt)
:runtimefailed
>updates\runtime-failed.txt echo to=%TONODE%
>>updates\runtime-failed.txt echo from=%FROMNODE%
>>updates\runtime-failed.txt echo reason=%~1
if exist "%RUNTIME%" rmdir /s /q "%RUNTIME%"
goto :eof

:unsigned
call :log The update is not signed by PANOPTICA. Nothing was changed.
rem the app stopped for this update: it runs again, on the version it had
if /i "%MODE%"=="restart" (
  if exist updates\restarting del updates\restarting
  call :log Starting the app again...
  call :again
  goto :eof
)
%HOLD%
exit /b 1

:again
rem started again the way it ran: through its task, or its start script
if defined PANOPTICA_TASK (
  call :log Starting the PANOPTICA task...
  schtasks /run /tn "%PANOPTICA_TASK%" >nul
) else (
  call start.bat %NET%
)
goto :eof

:log
echo %*
>>updates\update.log echo [%date% %time:~0,8%] %*
goto :eof
