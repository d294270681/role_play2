@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0web"
if errorlevel 1 (
  echo [RPG] Cannot open the web directory.
  pause
  exit /b 1
)
set "RPG_NODE=%~dp0ai\runtime\node\node.exe"
if exist "%RPG_NODE%" goto node_ready
set "RPG_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  echo [RPG] Node.js was not found. Install Node.js 22 or newer, then run the dependency installer.
  pause
  exit /b 1
)
:node_ready
"%RPG_NODE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo [RPG] Node.js 22 or newer is required. See docs/ environment setup guide.
  pause
  exit /b 1
)
if not exist "node_modules\express\package.json" goto dependencies_missing
if not exist "client\dist\index.html" goto dependencies_missing
set "RPG_PORT=%~1"
if not defined RPG_PORT set "RPG_PORT=8000"
echo [RPG] Starting server at http://127.0.0.1:%RPG_PORT%/
echo [RPG] Keep this window open. Press Ctrl+C to stop.
echo [RPG] Open the web page, then select Settings to configure your model API.
echo [RPG] Environment guide: http://127.0.0.1:%RPG_PORT%/guide
"%RPG_NODE%" server\index.js "%RPG_PORT%"
set "RPG_EXIT_CODE=%ERRORLEVEL%"
if not "%RPG_EXIT_CODE%"=="0" (
  echo [RPG] Server stopped with exit code %RPG_EXIT_CODE%.
  pause
)
exit /b %RPG_EXIT_CODE%

:dependencies_missing
echo [RPG] Web dependencies or the built client are missing.
echo [RPG] Run the dependency installer BAT in the project root, then start again.
echo [RPG] See docs/ for the environment setup guide.
pause
exit /b 1
