@echo off
cd /d "%~dp0"
for /f %%v in ('node -p "require('./package.json').version"') do echo Perovskite Lab version %%v
pause
