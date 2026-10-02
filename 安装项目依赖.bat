@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 exit /b 1
set "RPG_NODE=%~dp0ai\runtime\node\node.exe"
set "RPG_NPM=%~dp0ai\runtime\node\npm.cmd"
if not exist "%RPG_NODE%" goto system_node
if not exist "%RPG_NPM%" goto system_node
set "PATH=%~dp0ai\runtime\node;%PATH%"
goto runtime_ready

:system_node
set "RPG_NODE=node"
set "RPG_NPM=npm.cmd"
where node >nul 2>nul
if errorlevel 1 goto runtime_missing
where npm.cmd >nul 2>nul
if errorlevel 1 goto runtime_missing

:runtime_ready
"%RPG_NODE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 goto runtime_missing
echo [RPG] Installing web server dependencies...
call "%RPG_NPM%" --prefix "%~dp0web" ci
if errorlevel 1 goto install_failed
echo [RPG] Installing web client dependencies...
call "%RPG_NPM%" --prefix "%~dp0web\client" ci
if errorlevel 1 goto install_failed
echo [RPG] Building the web client...
call "%RPG_NPM%" --prefix "%~dp0web\client" run build
if errorlevel 1 goto install_failed
echo [RPG] Ready. Run the game startup BAT in the project root.
echo [RPG] Configure the text model API on the web page. Local images are optional.
pause
exit /b 0

:runtime_missing
echo [RPG] Node.js 22 or newer and npm are required.
echo [RPG] Install Node.js LTS from https://nodejs.org/en/download then run this BAT again.
pause
exit /b 1

:install_failed
echo [RPG] Installation failed. Check the error above and your network, then retry.
echo [RPG] See docs/ for the environment setup guide.
pause
exit /b 1
